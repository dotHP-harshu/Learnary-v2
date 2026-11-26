// Pre-flight check for the Learnary AI gateway.
//
// The tutor fails closed with AI_MISCONFIGURED ("Generation is unavailable on
// this deployment") whenever quota accounting is not usable. This script
// pinpoints which piece is missing — service key, SQL/RPC grants, or the Groq
// provider — without making a generation call or consuming quota.
//
//   npm run ai:doctor
//
// Read-only: it never writes to Supabase and never asks the model to generate.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function loadEnvFile(name) {
  const path = resolve(ROOT, name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith("#")) continue;
    const value = match[2].replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "");
    out[match[1]] = value;
  }
  return out;
}

const env = { ...loadEnvFile(".env"), ...loadEnvFile(".env.local"), ...process.env };

const ok = (label, detail = "") => console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
const bad = (label, detail = "") => console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
const warn = (label, detail = "") => console.log(`  warn  ${label}${detail ? ` — ${detail}` : ""}`);

// Never echo any part of a secret: the doctor's output is often pasted into a
// bug report or screenshot. The scheme is implied by the variable name and the
// length is enough to spot a truncated copy.
const fingerprint = (value) => (!value ? "(empty)" : `${value.length} chars`);

const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
const publishable = env.NEXT_PUBLIC_SUPABASE_API;
const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const serviceKeyName = env.SUPABASE_SECRET_KEY
  ? "SUPABASE_SECRET_KEY"
  : "SUPABASE_SERVICE_ROLE_KEY";
const groqKey = env.GROQ_API_KEY;
const groqModel = env.GROQ_MODEL;
const aiEnabled = env.LEARNARY_AI_ENABLED === "true";

let failures = 0;

console.log("\nLearnary AI doctor\n");

// ---- 1. Environment -------------------------------------------------------
console.log("Environment");
if (url) ok("NEXT_PUBLIC_SUPABASE_URL", url);
else {
  bad("NEXT_PUBLIC_SUPABASE_URL", "missing");
  failures += 1;
}

if (publishable?.startsWith("sb_publishable_") || publishable?.startsWith("eyJ")) {
  ok("NEXT_PUBLIC_SUPABASE_API", fingerprint(publishable));
} else {
  bad("NEXT_PUBLIC_SUPABASE_API", publishable ? "unexpected format" : "missing");
  failures += 1;
}

if (serviceKey?.startsWith("sb_secret_") || serviceKey?.startsWith("eyJ")) {
  ok(serviceKeyName, fingerprint(serviceKey));
} else if (serviceKey?.startsWith("sb_publishable_")) {
  bad(serviceKeyName, "this is the PUBLISHABLE key, not a secret/service key");
  failures += 1;
} else if (serviceKey) {
  warn(serviceKeyName, "unrecognised format — expected sb_secret_… or eyJ…");
} else {
  bad(
    "service key",
    "neither SUPABASE_SECRET_KEY nor SUPABASE_SERVICE_ROLE_KEY is set"
  );
  failures += 1;
}

if (groqKey) ok("GROQ_API_KEY", fingerprint(groqKey));
else {
  bad("GROQ_API_KEY", "missing");
  failures += 1;
}
if (groqModel) ok("GROQ_MODEL", groqModel);
else {
  bad("GROQ_MODEL", "missing");
  failures += 1;
}
ok("LEARNARY_AI_ENABLED", aiEnabled ? "true" : "false (generation is dark)");
if (!aiEnabled) failures += 1;

// ---- 2. Supabase: can the service key move quota counters? ----------------
console.log("\nSupabase quota accounting");
if (!url || !serviceKey) {
  bad("skipped", "needs the project URL and a service key");
} else {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  try {
    // Read-only RPC granted to service_role only. A 200 proves the key maps
    // to service_role, the function exists, and EXECUTE is granted.
    //
    // The cap must be a positive integer: the function rejects 0 with
    // VALIDATION_ERROR, which previously made a healthy deployment look broken.
    // A high cap guarantees the check passes; the doctor never writes.
    const response = await fetch(`${url}/rest/v1/rpc/ai_global_budget_check`, {
      method: "POST",
      headers,
      body: JSON.stringify({ p_daily_token_cap: 1_000_000_000 }),
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const message = body?.error?.message ?? body?.message ?? text.slice(0, 160);

    if (response.status === 200) {
      ok("service key → service_role", "quota RPC reachable");
    } else if (/permission denied for function/i.test(message)) {
      bad(
        "quota RPC",
        "function exists but service_role has no EXECUTE (re-apply supabase/setup.sql, section 6)"
      );
      failures += 1;
    } else if (/could not find the function|PGRST202/i.test(message)) {
      bad(
        "quota RPC",
        "ai_global_budget_check is missing — apply supabase/setup.sql to this project"
      );
      failures += 1;
    } else if (/invalid api key|invalid jwt|no api key/i.test(message)) {
      bad("service key rejected", message);
      failures += 1;
    } else {
      bad("quota RPC", `HTTP ${response.status} — ${message}`);
      failures += 1;
    }
  } catch (error) {
    bad("quota RPC", `network error — ${error.message}`);
    failures += 1;
  }
}

// ---- 3. Groq: key validity and model availability -------------------------
console.log("\nGroq provider");
if (!groqKey) {
  bad("skipped", "needs GROQ_API_KEY");
} else {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${groqKey}` },
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const message = body?.error?.message ?? body?.message ?? text.slice(0, 160);

    if (response.status === 403 && /access denied|network settings/i.test(message)) {
      // Groq refuses the caller's network/region before checking the key.
      bad(
        "Groq network",
        "the provider is blocking this network/region — this is NOT a key problem. Turn off any VPN / try another network, or deploy from a supported region."
      );
      failures += 1;
    } else if (response.status === 401 || response.status === 403) {
      bad("GROQ_API_KEY rejected", `HTTP ${response.status} — ${message}`);
      failures += 1;
    } else if (!response.ok) {
      warn("Groq models endpoint", `HTTP ${response.status} — ${message}`);
    } else {
      const ids = (body?.data ?? []).map((model) => model.id);
      ok("GROQ_API_KEY accepted", `${ids.length} models visible`);
      if (groqModel && ids.length > 0 && !ids.includes(groqModel)) {
        bad(
          "GROQ_MODEL",
          `"${groqModel}" is not in the account's model list — copy the exact id from console.groq.com`
        );
        failures += 1;
      } else if (groqModel) {
        ok("GROQ_MODEL available");
      }
    }
  } catch (error) {
    bad("Groq request", `network error — ${error.message}`);
    failures += 1;
  }
}

// ---- Verdict --------------------------------------------------------------
console.log("");
if (failures === 0) {
  console.log("All checks passed. Restart the dev server and generation should work.\n");
  process.exitCode = 0;
} else {
  console.log(
    `${failures} check${failures === 1 ? "" : "s"} failed. Fix the items above, then restart ` +
      "the dev server (server env vars are read at startup).\n"
  );
  process.exitCode = 1;
}
