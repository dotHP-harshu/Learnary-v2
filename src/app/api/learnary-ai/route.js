// POST /api/learnary-ai — the single server-side gateway for the tutor
// features. Every request: validate → verify JWT → check kill switch →
// idempotency → quota reservation → provider call → accounting.

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import {
  AI_CONFIG,
  AIAppError,
  actionConfig,
} from "../../../server/ai/config";
import { parseRequest } from "../../../server/ai/validation";
import { PROMPTS, PROMPT_BUILDERS } from "../../../server/ai/prompts";
import {
  parseRoadmapDraft,
  parseStageDraft,
  roadmapInputSchema,
  stageInputSchema,
} from "../../../server/ai/roadmapSchema";
import {
  breakdownInputSchema,
  explainInputSchema,
  hintInputSchema,
  practiceInputSchema,
  dailyPlanInputSchema,
  parseBreakdown,
  parseExplanation,
  parseHints,
  parsePractice,
  parseDailyPlan,
} from "../../../server/ai/taskSchema";
import { generate } from "../../../server/ai/provider";
import { buildEvaluateShortAnswersMessages } from "../../../server/ai/prompts";
import {
  quizInputSchema,
  flashcardInputSchema,
  submitAttemptInputSchema,
  parseQuiz,
  parseFlashcards,
  parseShortAnswerEvaluations,
  sanitizeQuizContent,
  scoreAttempt,
  QUIZ_SCHEMA_VERSION,
} from "../../../server/ai/practiceSchema";
import {
  weeklyReviewInputSchema,
  parseWeeklyReview,
} from "../../../server/ai/progressSchema";
import {
  tutorInputSchema,
  loadWindow,
  buildContextSummary,
  buildTutorMessages,
} from "../../../server/ai/tutor";
import {
  LEARNER_KEYS_BY_ACTION,
  fetchLearnerProfile,
  learnerBlockForAction,
  learnerContextUsed,
  objectContextUsed,
} from "../../../server/ai/learnerContext";
import { createQuotaClient } from "../../../server/ai/quota";

export const runtime = "nodejs";
// Must exceed the longest per-action provider timeout (60 s for roadmap
// generation in server/ai/prompts.js). Without this the platform can kill the
// invocation after the provider was already paid, leaving the reservation
// unreleased and the ai_requests row stuck in `pending`.
export const maxDuration = 90;

// Assistant replies are per-user and per-request: never let a CDN or the service
// worker replay a cached body.
const NO_STORE = { "Cache-Control": "no-store" };

const errorResponse = (requestId, code, message, extra = {}, status = 400) =>
  Response.json(
    {
      version: 1,
      request_id: requestId ?? null,
      ok: false,
      error: { code, message, ...extra },
    },
    { status, headers: NO_STORE }
  );

const okResponse = (requestId, action, data, usage) =>
  Response.json(
    {
      version: 1,
      request_id: requestId,
      ok: true,
      action,
      data,
      usage,
    },
    { headers: NO_STORE }
  );

// Public-safe error message: AIAppError messages are written for the learner
// and are safe to surface; anything else (provider/infra failures) must not
// leak internals to the client — details go to console.error instead.
const publicMessage = (error) =>
  error instanceof AIAppError ? error.message : "Request failed.";

function bearerToken(request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

// Best-effort client IP (Vercel sets x-forwarded-for). Hashed before it ever
// reaches the database, so the rate-limit table holds no addresses.
function clientIpHash(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "";
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

// Idempotency fingerprint: canonical (key-sorted) JSON, hashed. Object key
// order must not change the fingerprint, and the stored value must not be a
// reversible copy of the learner's payload (tutor messages, notes).
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

const payloadFingerprint = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");

/**
 * Fixed-window limiter backed by Postgres.
 * @returns {Promise<number|null>} seconds to wait when limited, else null.
 */
async function hitRateLimit(client, bucket, max, windowSeconds) {
  if (!client) return null;
  try {
    const { data, error } = await client.rpc("ai_rate_limit_hit", {
      p_bucket: bucket,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      // Fail open: a limiter outage must not take the feature down.
      console.error(`[learnary-ai] rate limit check failed: ${error.message}`);
      return null;
    }
    if (data?.ok === false) return Number(data.retry_after_seconds) || 1;
    return null;
  } catch {
    return null;
  }
}

const rateLimitedResponse = (requestId, retryAfter) =>
  errorResponse(
    requestId,
    "AI_RATE_LIMITED",
    "Too many requests. Please slow down and try again.",
    { retry_after_seconds: retryAfter },
    429
  );

export async function POST(request) {
  // Privileged client for accounting + abuse controls. Created first because
  // the IP limiter runs before authentication.
  const quota = createQuotaClient();

  // ---- per-IP burst limit (pre-auth) -------------------------------------
  // Unauthenticated hammering must not reach the JWT check or the database.
  // The counter lives in Postgres, so every serverless instance shares it.
  if (quota) {
    const ipHash = clientIpHash(request);
    if (ipHash) {
      const retryAfter = await hitRateLimit(
        quota,
        `ip:${ipHash}`,
        AI_CONFIG.ipRequestsPerMinute,
        60
      );
      if (retryAfter) return rateLimitedResponse(null, retryAfter);
    }
  }

  // ---- body size bound ----------------------------------------------------
  // Reject an oversized declared body before buffering it, then re-check the
  // bytes actually read: Content-Length can be omitted or spoofed, so it is
  // only a cheap pre-filter — the real cap is measured on the payload.
  const declaredBytes = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > AI_CONFIG.maxBodyBytes) {
    return errorResponse(null, "VALIDATION_ERROR", "Request too large.", {}, 413);
  }

  let raw;
  try {
    raw = await request.text();
  } catch {
    return errorResponse(null, "VALIDATION_ERROR", "Invalid request body.");
  }
  if (Buffer.byteLength(raw, "utf8") > AI_CONFIG.maxBodyBytes) {
    return errorResponse(null, "VALIDATION_ERROR", "Request too large.", {}, 413);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return errorResponse(null, "VALIDATION_ERROR", "Invalid JSON body.");
  }

  const parsed = parseRequest(body);
  if (!parsed.ok) {
    return errorResponse(
      body?.request_id ?? null,
      "VALIDATION_ERROR",
      parsed.error
    );
  }

  const { action, request_id: requestId, context, input } = parsed.data;
  const actionSpec = actionConfig(action);
  // Defence in depth: the envelope allowlist already rejects unknown actions,
  // but every downstream branch assumes a real spec (cost, providerCall).
  if (!actionSpec) {
    return errorResponse(requestId, "VALIDATION_ERROR", "Unknown action.");
  }

  // ---- per-action input validation --------------------------------------
  const INPUT_SCHEMAS = {
    generate_roadmap: roadmapInputSchema,
    regenerate_roadmap_stage: stageInputSchema,
    break_down_task: breakdownInputSchema,
    explain_task: explainInputSchema,
    give_hint: hintInputSchema,
    generate_practice: practiceInputSchema,
    generate_daily_plan: dailyPlanInputSchema,
    tutor_chat: tutorInputSchema,
    generate_quiz: quizInputSchema,
    generate_flashcards: flashcardInputSchema,
    submit_quiz_attempt: submitAttemptInputSchema,
    generate_weekly_review: weeklyReviewInputSchema,
  };
  // ---- auth: identity from the verified JWT, never from the body -------
  // Verified before any per-action state is considered — including before
  // input validation, so unauthenticated callers cannot probe per-action
  // schemas.
  const token = bearerToken(request);
  if (!token) {
    return errorResponse(
      requestId,
      "UNAUTHENTICATED",
      "Sign in to use this feature.",
      {},
      401
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_API,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return errorResponse(
      requestId,
      "UNAUTHENTICATED",
      "Your session has expired. Please sign in again.",
      {},
      401
    );
  }

  // ---- quota accounting (server-authoritative) --------------------------
  // The counters live behind service-role-only functions:
  // the browser cannot move them, and this route passes the id it just
  // verified from the JWT. `quota` is null when SUPABASE_SERVICE_ROLE_KEY is
  // not configured — every quota-touching path then fails closed.
  const userId = authData.user.id;

  // ---- per-user velocity limit (post-auth) ------------------------------
  // The daily allowance bounds total spend; this bounds the RATE so one
  // account cannot burn its whole allowance in a few seconds. Recovery
  // lookups are exempt: they are cheap reads and the UI polls them while a
  // generation is still running.
  if (action !== "resume_request") {
    const retryAfter = await hitRateLimit(
      quota,
      `user:${userId}`,
      AI_CONFIG.userRequestsPerMinute,
      60
    );
    if (retryAfter) return rateLimitedResponse(requestId, retryAfter);
  }

  // ---- resume_request: recover a stored result ---------------------------
  // A generation can outlive the component that started it (tab switch,
  // reload, PWA backgrounding). The result is already persisted for
  // idempotency; return it without another provider call or charge.
  if (action === "resume_request") {
    const originalId = context?.original_request_id;
    if (!originalId) {
      return errorResponse(
        requestId,
        "VALIDATION_ERROR",
        "Missing original request id."
      );
    }
    const { data: prior, error: priorError } = await supabase
      .from("ai_requests")
      .select("action, status, result_json, result_ref, error_code, created_at")
      .eq("request_id", originalId)
      .eq("user_id", userId)
      .maybeSingle();
    if (priorError) {
      return errorResponse(
        requestId,
        "INTERNAL_ERROR",
        "Could not read the request."
      );
    }
    if (!prior) {
      return okResponse(requestId, action, { status: "missing" });
    }
    if (context?.original_action && prior.action !== context.original_action) {
      return errorResponse(
        requestId,
        "VALIDATION_ERROR",
        "Request action mismatch."
      );
    }
    // A function killed mid-generation leaves its row `pending` forever. Once
    // the server deadline has passed it cannot still be running, so report it
    // as interrupted and let the client retry cleanly instead of polling a
    // row that will never change.
    if (prior.status === "pending") {
      const ageMs = Date.now() - new Date(prior.created_at).getTime();
      if (Number.isFinite(ageMs) && ageMs > 95_000) {
        return okResponse(requestId, action, {
          status: "failed",
          original_action: prior.action,
          result: null,
          result_ref: null,
          error_code: "INTERRUPTED",
          created_at: prior.created_at,
        });
      }
    }
    return okResponse(requestId, action, {
      status: prior.status,
      original_action: prior.action,
      result: prior.result_json ?? null,
      result_ref: prior.result_ref ?? null,
      error_code: prior.error_code ?? null,
      created_at: prior.created_at,
    });
  }

  // One refund per request at most: several failure branches can run for the
  // same attempt, and a second release would erase an unrelated unit from the
  // user's daily counter.
  let quotaReleased = false;
  const releaseQuota = async (n) => {
    if (!quota || !n || n <= 0 || quotaReleased) return;
    quotaReleased = true;
    try {
      await quota.rpc("release_ai_quota", { p_user_id: userId, p_units: n });
    } catch {
      // Accounting is best-effort on the failure path: a release that fails
      // must not turn a handled error into a 500.
    }
  };

  const recordUsage = async (usage) => {
    if (!quota || !usage) return;
    try {
      await quota.rpc("record_ai_usage", {
        p_user_id: userId,
        p_input_tokens: usage.promptTokens ?? 0,
        p_output_tokens: usage.completionTokens ?? 0,
      });
    } catch {
      // Token counts are informational; never fail a delivered result on them.
    }
  };

  // Any failure that reached a catch means no usable result was delivered —
  // timeout, outage, provider 429, malformed/truncated JSON, or a save error.
  // The learner must not lose allowance for an outcome they cannot use.
  // `releaseQuota` is idempotent, so branches that already refunded (e.g. an
  // all-MCQ attempt) are unaffected.
  const releaseIfProviderFailed = async () => {
    await releaseQuota(units);
  };

  let validatedInput = input;
  const inputSchema = INPUT_SCHEMAS[action];
  if (inputSchema) {
    const result = inputSchema.safeParse(input ?? {});
    if (!result.success) {
      const issue = result.error.issues[0];
      return errorResponse(
        requestId,
        "VALIDATION_ERROR",
        `input.${issue.path.join(".") || "*"}: ${issue.message}`
      );
    }
    validatedInput = result.data;
  }

  // ---- kill switch -------------------------------------------------------
  if (actionSpec.providerCall && !AI_CONFIG.enabled) {
    return errorResponse(
      requestId,
      "AI_DISABLED",
      "This feature is currently turned off. Manual features remain fully available.",
      {},
      503
    );
  }

  // ---- status action: usage report for the settings/usage UI (no provider
  // call, no quota). Server-authoritative fields: weighted credit units and
  // actual provider-reported tokens are returned separately and clearly
  // named; the per-response max output cap is a different metric from the
  // daily allowance. No global-quota internals are exposed to clients.
  if (action === "status") {
    const { data: usage, error: usageError } = await supabase.rpc(
      "read_ai_usage"
    );
    if (usageError) {
      return errorResponse(
        requestId,
        "INTERNAL_ERROR",
        "Could not read usage."
      );
    }
    const daily_units_used = usage?.requests_used_today ?? 0;
    const daily_units_limit = AI_CONFIG.userDailyUnits;
    const now = new Date();
    const reset_at = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    ).toISOString(); // allowance resets daily at 00:00 UTC
    return okResponse(requestId, action, {
      // Generation needs the key, the model AND the service-role key (quota
      // accounting fails closed without it), so all three are part of
      // "available" — otherwise the UI advertises a feature that cannot run.
      available:
        AI_CONFIG.enabled &&
        Boolean(AI_CONFIG.apiKey && AI_CONFIG.model && AI_CONFIG.serviceRoleKey),
      provider: AI_CONFIG.provider,
      // Weighted daily allowance (credits) — the enforced daily quota:
      daily_units_used,
      daily_units_limit,
      daily_units_remaining: Math.max(0, daily_units_limit - daily_units_used),
      reset_at,
      // Actual provider-reported token consumption (informational):
      input_tokens_today: usage?.input_tokens_today ?? 0,
      output_tokens_today: usage?.output_tokens_today ?? 0,
      // Per-response generation limit — NOT the daily allowance:
      max_output_tokens_per_response: AI_CONFIG.maxOutputTokensCap,
    });
  }

  // ---- idempotency -------------------------------------------------------
  const payloadHash = payloadFingerprint({
    action,
    context,
    input: validatedInput,
  });

  let aiRequestRowId = null;

  const { error: insertError, data: existing } = await supabase
    .from("ai_requests")
    .insert({
      // Identity from the verified JWT (own_insert policy checks
      // user_id = auth.uid() on the new row) — never from the request body.
      user_id: authData.user.id,
      request_id: requestId,
      action,
      payload_hash: payloadHash,
      status: "pending",
      provider: AI_CONFIG.provider,
      model_id: AI_CONFIG.model,
      prompt_version: PROMPTS.ping.version, // overwritten after prompt resolution
    })
    .select("id")
    .single();

  if (insertError?.code === "23505") {
    const { data: prior } = await supabase
      .from("ai_requests")
      .select(
        "id, status, payload_hash, action, result_json, result_ref, created_at"
      )
      .eq("request_id", requestId)
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (prior && prior.payload_hash !== payloadHash) {
      return errorResponse(
        requestId,
        "IDEMPOTENCY_CONFLICT",
        "This request ID was already used with a different payload.",
        {},
        409
      );
    }
    if (prior?.status === "succeeded") {
      // The request already completed — the browser likely lost the
      // response. Return the recorded result: no provider call, no quota
      // spend, nothing re-generated.
      if (prior.result_json) {
        return okResponse(requestId, action, prior.result_json, {
          replayed: true,
        });
      }
      if (prior.action === "generate_quiz" && prior.result_ref) {
        // Quiz content (answer keys) is never copied into result_json, and
        // the browser client has no SELECT on quizzes.content. Replay goes
        // through the same sanitized projection the first response used.
        const { data: savedQuiz } = await supabase.rpc(
          "get_quiz_for_attempt",
          { p_quiz_id: prior.result_ref }
        );
        if (savedQuiz?.id) {
          return okResponse(requestId, action, {
            quiz_id: savedQuiz.id,
            title: savedQuiz.title,
            created_at: savedQuiz.created_at,
            content: savedQuiz.content,
          }, { replayed: true });
        }
      }
    }

    // A crashed invocation leaves its row `pending` forever (the route's
    // maxDuration is 90 s). Reclaim an abandoned row so a retry is not
    // blocked by a 409 until the journal expires.
    if (prior?.status === "pending") {
      const ageMs = Date.now() - new Date(prior.created_at).getTime();
      if (Number.isFinite(ageMs) && ageMs > 95_000) {
        const { data: reclaimed } = await supabase
          .from("ai_requests")
          .update({
            status: "pending",
            error_code: null,
            created_at: new Date().toISOString(),
            prompt_version: PROMPTS.ping.version,
          })
          .eq("id", prior.id)
          .eq("user_id", authData.user.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();
        if (reclaimed?.id) aiRequestRowId = reclaimed.id;
      }
    }

    if (!aiRequestRowId) {
      return errorResponse(
        requestId,
        "IDEMPOTENCY_CONFLICT",
        `Request already ${prior?.status ?? "processing"}.`,
        { retry_after_seconds: 2 },
        409
      );
    }
  } else if (insertError) {
    return errorResponse(requestId, "INTERNAL_ERROR", "Could not register request.");
  } else {
    aiRequestRowId = existing?.id;
  }

  // ---- quota reservation -------------------------------------------------
  // Cost-0 actions (ping) skip reservation entirely: the RPC requires
  // units >= 1 and free actions must not consume or roll back allowance.
  const units = actionSpec.cost;
  let reservation = null;
  if (units > 0) {
    // Fail closed: without the service-role key the counters cannot be moved
    // safely, and falling back to the browser-callable client would let a
    // signed-in user move their own quota counters.
    if (!quota) {
      console.error(
        "[learnary-ai] quota client unavailable: set SUPABASE_SERVICE_ROLE_KEY " +
          "(legacy `eyJ...` service_role JWT) or SUPABASE_SECRET_KEY (`sb_secret_...`) " +
          "in the server environment. Assistant requests fail closed until one is present."
      );
      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: "AI_MISCONFIGURED" })
        .eq("id", aiRequestRowId);
      return errorResponse(
        requestId,
        "AI_MISCONFIGURED",
        "Assistant usage accounting is not configured on this deployment.",
        {},
        503
      );
    }
    // Deployment-wide spend ceiling in provider tokens. Soft cap:
    // checked before the reservation, so one in-flight request may push the
    // day slightly over and the next one is refused.
    const { data: budget } = await quota.rpc("ai_global_budget_check", {
      p_daily_token_cap: AI_CONFIG.globalDailyTokens,
    });
    if (budget?.exhausted) {
      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: "AI_GLOBAL_QUOTA_EXCEEDED" })
        .eq("id", aiRequestRowId);
      return errorResponse(
        requestId,
        "AI_GLOBAL_QUOTA_EXCEEDED",
        "The app-wide assistant budget for today is used up. Manual features remain fully available.",
        { retry_after_seconds: 3600 },
        429
      );
    }

    const { data, error: quotaError } = await quota.rpc(
      "reserve_ai_quota",
      {
        p_user_id: userId,
        p_units: units,
        p_user_daily_limit: AI_CONFIG.userDailyUnits,
        p_global_daily_limit: AI_CONFIG.globalDailyUnits,
      }
    );

    if (quotaError) {
      console.error(
        `[learnary-ai] quota reservation failed: ${quotaError.code ?? "unknown"} — ${quotaError.message ?? "unknown"}`
      );
      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: "AI_MISCONFIGURED" })
        .eq("id", aiRequestRowId);
      return errorResponse(
        requestId,
        "AI_MISCONFIGURED",
        "Assistant usage accounting is not configured on this deployment.",
        {},
        503
      );
    }
    if (!data?.ok) {
      const code = data?.code ?? "AI_USER_QUOTA_EXCEEDED";
      const message =
        code === "AI_GLOBAL_QUOTA_EXCEEDED"
          ? "The app-wide assistant budget for today is used up. Manual features remain fully available."
          : "You have used up your daily allowance for today. Manual features remain fully available.";
      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: code })
        .eq("id", aiRequestRowId);
      return errorResponse(
        requestId,
        code,
        message,
        { requests_used_today: data?.requests_used_today },
        429
      );
    }
    reservation = data;
  }

  // ---- tutor_chat: conversational branch with persistence -----------------
  // Distinct from the one-shot actions: verifies conversation + context
  // ownership, stores the user message idempotently, calls the provider with
  // a bounded window, stores the assistant reply, and keeps history intact
  // on provider failure.
  if (action === "tutor_chat") {
    const { message, mode, context_type, collection_id, task_id, title, regenerate } =
      validatedInput;
    const isRegenerate = regenerate === true;

    // 1-2. Verify conversation + context ownership with caller-scoped access.
    let conversation = null;
    if (context?.conversation_id) {
      const { data } = await supabase
        .from("ai_conversations")
        .select("id, title, status, context_type, collection_id, task_id")
        .eq("id", context.conversation_id)
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if (!data) {
        await supabase
          .from("ai_requests")
          .update({ status: "failed", error_code: "VALIDATION_ERROR" })
          .eq("id", aiRequestRowId);
        await releaseQuota(units);
        return errorResponse(
          requestId,
          "VALIDATION_ERROR",
          "Conversation not found."
        );
      }
      if (data.status === "archived") {
        await supabase
          .from("ai_requests")
          .update({ status: "failed", error_code: "VALIDATION_ERROR" })
          .eq("id", aiRequestRowId);
        await releaseQuota(units);
        return errorResponse(
          requestId,
          "VALIDATION_ERROR",
          "This conversation is archived. Unarchive it to continue."
        );
      }
      conversation = data;
    }

    if (isRegenerate && !conversation) {
      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: "VALIDATION_ERROR" })
        .eq("id", aiRequestRowId);
      await releaseQuota(units);
      return errorResponse(
        requestId,
        "VALIDATION_ERROR",
        "Nothing to regenerate yet."
      );
    }

    if (!isRegenerate && !message) {
      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: "VALIDATION_ERROR" })
        .eq("id", aiRequestRowId);
      await releaseQuota(units);
      return errorResponse(requestId, "VALIDATION_ERROR", "Message is required.");
    }

    // Context records must belong to the caller before anything is created.
    // Regeneration reuses the conversation's stored context (already owned).
    if (!isRegenerate && context_type === "collection" && collection_id) {
      const { data: owned } = await supabase
        .from("collections")
        .select("title")
        .eq("collection_id", collection_id)
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if (!owned) {
        await supabase
          .from("ai_requests")
          .update({ status: "failed", error_code: "VALIDATION_ERROR" })
          .eq("id", aiRequestRowId);
        await releaseQuota(units);
        return errorResponse(
          requestId,
          "VALIDATION_ERROR",
          "Selected collection not found."
        );
      }
    }
    if (!isRegenerate && context_type === "task" && task_id) {
      const { data: owned } = await supabase
        .from("tasks")
        .select("id")
        .eq("id", task_id)
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if (!owned) {
        await supabase
          .from("ai_requests")
          .update({ status: "failed", error_code: "VALIDATION_ERROR" })
          .eq("id", aiRequestRowId);
        await releaseQuota(units);
        return errorResponse(
          requestId,
          "VALIDATION_ERROR",
          "Selected task not found."
        );
      }
    }

    if (!conversation) {
      const { data: created, error: createError } = await supabase
        .from("ai_conversations")
        .insert({
          user_id: authData.user.id,
          title: title || message.slice(0, 60),
          context_type,
          collection_id: context_type === "collection" ? collection_id : null,
          task_id: context_type === "task" ? task_id : null,
        })
        .select("id, title, status")
        .single();
      if (createError) {
        await supabase
          .from("ai_requests")
          .update({ status: "failed", error_code: "INTERNAL_ERROR" })
          .eq("id", aiRequestRowId);
        await releaseQuota(units);
        return errorResponse(
          requestId,
          "INTERNAL_ERROR",
          "Could not start the conversation."
        );
      }
      conversation = created;
    }

    // 5. The user message: normal turns insert it (idempotent by request_id);
    // regenerations reuse the stored last user message. The superseded reply
    // is kept until the replacement is safely stored — a provider failure must
    // never leave the conversation without its last good answer.
    let userMessage;
    let messageReused = false;
    let restoreStatus = null; // status to restore on provider failure
    let previousAssistantId = null;
    if (isRegenerate) {
      const { data: lastAssistant } = await supabase
        .from("ai_messages")
        .select("id")
        .eq("conversation_id", conversation.id)
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(1);
      previousAssistantId = lastAssistant?.[0]?.id ?? null;
      const { data: lastUser } = await supabase
        .from("ai_messages")
        .select("id, content, status")
        .eq("conversation_id", conversation.id)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(1);
      if (!lastUser) {
        await supabase
          .from("ai_requests")
          .update({ status: "failed", error_code: "VALIDATION_ERROR" })
          .eq("id", aiRequestRowId);
        await releaseQuota(units);
        return errorResponse(
          requestId,
          "VALIDATION_ERROR",
          "Nothing to regenerate yet."
        );
      }
      restoreStatus = lastUser.status === "complete" ? null : "failed";
      await supabase
        .from("ai_messages")
        .update({ status: "complete" })
        .eq("id", lastUser.id);
      userMessage = { id: lastUser.id, status: "complete" };
      messageReused = true;
    } else {
      const { data: priorMessage } = await supabase
        .from("ai_messages")
        .select("id, status")
        .eq("request_id", requestId)
        .eq("role", "user")
        .eq("user_id", authData.user.id)
        .maybeSingle();

      if (priorMessage) {
        messageReused = true;
        userMessage = priorMessage;
        // A retried turn re-activates the stored message.
        await supabase
          .from("ai_messages")
          .update({ status: "complete" })
          .eq("id", priorMessage.id);
      } else {
        const { data: inserted, error: insertMsgError } = await supabase
          .from("ai_messages")
          .insert({
            conversation_id: conversation.id,
            user_id: authData.user.id,
            role: "user",
            content: message,
            status: "complete",
            request_id: requestId,
          })
          .select("id, status")
          .single();
        if (insertMsgError) {
          await supabase
            .from("ai_requests")
            .update({ status: "failed", error_code: "INTERNAL_ERROR" })
            .eq("id", aiRequestRowId);
          await releaseQuota(units);
          return errorResponse(
            requestId,
            "INTERNAL_ERROR",
            "Could not save your message."
          );
        }
        userMessage = inserted;
      }
    }

    try {
      // Bounded context + window: the window already contains the user's
      // message; failed/pending rows are excluded from history.
      // Regeneration reuses the conversation's stored context.
      const effectiveType = isRegenerate
        ? (conversation.context_type ?? "general")
        : context_type;
      const effectiveCollectionId = isRegenerate
        ? conversation.collection_id
        : collection_id;
      const effectiveTaskId = isRegenerate ? conversation.task_id : task_id;
      // Shared learner-context engine: one bounded profile fetch, sliced
      // per action by learnerContext.js.
      const profile = await fetchLearnerProfile(supabase, authData.user.id);
      const contextSummary = await buildContextSummary(supabase, {
        profile,
        contextType: effectiveType,
        collectionId: effectiveCollectionId,
        taskId: effectiveTaskId,
      });
      const windowMessages = await loadWindow(supabase, conversation.id);
      const prompt = buildTutorMessages({
        mode,
        contextSummary,
        // Regeneration replaces the previous reply: the superseded row still
        // exists (it is deleted only after a successful replace), so it must
        // not be fed back to the model as history.
        windowMessages: previousAssistantId
          ? (windowMessages ?? []).filter(
              (message) => message.id !== previousAssistantId
            )
          : windowMessages,
      });

      // 6-7. Provider call + accounting.
      const result = await generate({
        model: AI_CONFIG.model,
        messages: prompt.messages,
        maxOutputTokens: Math.min(
          prompt.maxOutputTokens ?? AI_CONFIG.maxOutputTokens,
          AI_CONFIG.maxOutputTokensCap
        ),
        temperature: prompt.temperature ?? 0.7,
        apiKey: AI_CONFIG.apiKey,
        timeoutMs: Math.min(
          prompt.timeoutMs ?? AI_CONFIG.providerTimeoutMs,
          AI_CONFIG.providerTimeoutCapMs
        ),
      });

      await recordUsage(result.usage);

      const { data: assistantMessage, error: assistantError } = await supabase
        .from("ai_messages")
        .insert({
          conversation_id: conversation.id,
          user_id: authData.user.id,
          role: "assistant",
          content: result.content,
          status: "complete",
          request_id: requestId,
          model_id: result.model,
          prompt_version: prompt.version,
          input_tokens: result.usage?.promptTokens ?? null,
          output_tokens: result.usage?.completionTokens ?? null,
        })
        .select("id, content, status, created_at")
        .single();
      if (assistantError) {
        throw new AIAppError(
          "INTERNAL_ERROR",
          "Your message was saved but the reply could not be stored. Retry to regenerate it."
        );
      }

      // The replacement is stored — now retire the superseded reply. Keeping
      // two replies is recoverable; losing the new one is not.
      if (previousAssistantId) {
        const { error: pruneError } = await supabase
          .from("ai_messages")
          .delete()
          .eq("id", previousAssistantId)
          .eq("user_id", authData.user.id);
        if (pruneError) {
          console.error(
            `[learnary-ai] could not retire previous assistant reply: ${pruneError.message}`
          );
        }
      }

      await supabase
        .from("ai_requests")
        .update({
          status: "succeeded",
          model_id: result.model,
          prompt_version: prompt.version,
          // Stored for idempotent replay after a lost response.
          result_json: {
            conversation_id: conversation.id,
            title: conversation.title,
            user_message_id: userMessage.id,
            message_reused: messageReused,
            assistant_message: assistantMessage,
            context_summary: contextSummary,
          },
        })
        .eq("id", aiRequestRowId);

      await supabase
        .from("ai_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversation.id);

      return okResponse(requestId, action, {
        conversation_id: conversation.id,
        title: conversation.title,
        user_message_id: userMessage.id,
        message_reused: messageReused,
        assistant_message: assistantMessage,
        context_summary: contextSummary,
        // Context transparency: exactly what this reply used.
        context_used: [
          ...learnerContextUsed("tutor_chat", profile),
          ...objectContextUsed(effectiveType),
        ],
      }, {
        app_requests_today: reservation?.requests_used_today,
        app_daily_limit: reservation?.app_daily_limit,
      });
    } catch (error) {
      const code = error instanceof AIAppError ? error.code : "INTERNAL_ERROR";
      console.error(`[learnary-ai] action=${action} failed: ${code} — ${error?.message ?? "unknown"}`);
      // Any failure here means no usable result was delivered, so the unit is
      // refunded (idempotent — an all-MCQ attempt already refunded).
      await releaseIfProviderFailed();
      // 8. The user message stays in history, clearly marked retryable —
      // provider failures never corrupt or erase the conversation.
      if (!messageReused) {
        await supabase
          .from("ai_messages")
          .update({ status: "failed" })
          .eq("id", userMessage.id);
      } else if (restoreStatus) {
        await supabase
          .from("ai_messages")
          .update({ status: restoreStatus })
          .eq("id", userMessage.id);
      }
      const retry =
        error instanceof AIAppError && error.extra?.retry_after_seconds
          ? { retry_after_seconds: error.extra.retry_after_seconds }
          : {};
      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: code, prompt_version: "v1" })
        .eq("id", aiRequestRowId);
      const status =
        code === "AI_RATE_LIMITED" ? 429 : code === "INTERNAL_ERROR" ? 500 : 502;
      return errorResponse(
        requestId,
        code,
        publicMessage(error),
        retry,
        status
      );
    }
  }

  // ---- practice generation: shared ownership pre-check ---------------------
  // task_id/collection_id are verified with caller-scoped access; their
  // content is loaded server-side as bounded context — the client never
  // supplies task text for these actions.
  const PRACTICE_ACTIONS = new Set(["generate_quiz", "generate_flashcards"]);
  let practiceContext = null;
  if (PRACTICE_ACTIONS.has(action)) {
    const { collection_id, task_id } = validatedInput;
    practiceContext = { task: null, collection_title: null };
    if (collection_id) {
      const { data: collection } = await supabase
        .from("collections")
        .select("title")
        .eq("collection_id", collection_id)
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if (!collection) {
        await supabase
          .from("ai_requests")
          .update({ status: "failed", error_code: "VALIDATION_ERROR" })
          .eq("id", aiRequestRowId);
        await releaseQuota(units);
        return errorResponse(
          requestId,
          "VALIDATION_ERROR",
          "Selected collection not found."
        );
      }
      practiceContext.collection_title = collection.title;
    }
    if (task_id) {
      const { data: task } = await supabase
        .from("tasks")
        .select("title, description")
        .eq("id", task_id)
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if (!task) {
        await supabase
          .from("ai_requests")
          .update({ status: "failed", error_code: "VALIDATION_ERROR" })
          .eq("id", aiRequestRowId);
        await releaseQuota(units);
        return errorResponse(
          requestId,
          "VALIDATION_ERROR",
          "Selected task not found."
        );
      }
      practiceContext.task = task;
    }
    if (!validatedInput.topic && !validatedInput.notes && !task_id && !collection_id) {
      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: "VALIDATION_ERROR" })
        .eq("id", aiRequestRowId);
      await releaseQuota(units);
      return errorResponse(
        requestId,
        "VALIDATION_ERROR",
        "Provide a topic, notes, or select a task or collection."
      );
    }
  }

  // ---- shared learner context ------------------------------------------------
  // One bounded profile fetch per request; each action's prompt receives only
  // its slice (LEARNER_KEYS_BY_ACTION). Computed BEFORE every prompt-consuming
  // branch below: generate_quiz/generate_flashcards pass `learnerBlock`
  // positionally, and the generic path builds `{ learner: learnerBlock }`.
  // Roadmap actions are excluded by design — their form input already carries
  // the confirmed goal/levels/availability.
  let learnerBlock = null;
  let learnerUsed = [];
  if (LEARNER_KEYS_BY_ACTION[action]) {
    const profile = await fetchLearnerProfile(supabase, authData.user.id);
    learnerBlock = learnerBlockForAction(action, profile);
    learnerUsed = learnerContextUsed(action, profile);
  }
  // Object context for assist actions: the selected task / learning space.
  const objectUsed = objectContextUsed(
    validatedInput.task ? "task" : validatedInput.collection_id ? "collection" : null
  );
  const contextUsed = [...learnerUsed, ...objectUsed];

  // ---- generate_quiz: review-before-save ------------------------------------
  // The full content (answer keys) is stored server-side; the client only
  // ever receives the sanitized projection. "Discard" deletes the row via
  // client CRUD; the row only matters once the learner takes the quiz.
  if (action === "generate_quiz") {
    try {
      const prompt = PROMPT_BUILDERS.generate_quiz(validatedInput, practiceContext, learnerBlock);
      const result = await generate({
        model: AI_CONFIG.model,
        messages: prompt.messages,
        maxOutputTokens: Math.min(
          prompt.maxOutputTokens ?? AI_CONFIG.maxOutputTokens,
          AI_CONFIG.maxOutputTokensCap
        ),
        temperature: prompt.temperature ?? 0.7,
        apiKey: AI_CONFIG.apiKey,
        timeoutMs: Math.min(
          prompt.timeoutMs ?? AI_CONFIG.providerTimeoutMs,
          AI_CONFIG.providerTimeoutCapMs
        ),
      });
      await recordUsage(result.usage);
      const parsed = parseQuiz(result.content);
      // The service-role client writes quizzes: `authenticated` has no INSERT
      // or SELECT on quizzes.content (answer keys). `quota` is non-null here
      // because this action reserved quota before the provider call.
      const { data: savedQuiz, error: quizInsertError } = await quota
        .from("quizzes")
        .insert({
          user_id: authData.user.id,
          collection_id: validatedInput.collection_id ?? null,
          task_id: validatedInput.task_id ?? null,
          title: parsed.title,
          content: parsed,
          schema_version: QUIZ_SCHEMA_VERSION,
          source: "ai",
        })
        .select("id, title, created_at")
        .single();
      if (quizInsertError) {
        throw new AIAppError(
          "INTERNAL_ERROR",
          "The quiz was generated but could not be saved. Please try again."
        );
      }
      await supabase
        .from("ai_requests")
        .update({
          status: "succeeded",
          model_id: result.model,
          prompt_version: prompt.version,
          // result_ref, not result_json: quiz content holds answer keys and
          // must not be duplicated into a client-readable column. A replay
          // re-reads this row and re-sanitizes it.
          result_ref: savedQuiz.id,
        })
        .eq("id", aiRequestRowId);
      return okResponse(requestId, action, {
        quiz_id: savedQuiz.id,
        title: savedQuiz.title,
        created_at: savedQuiz.created_at,
        content: sanitizeQuizContent(parsed),
      }, {
        app_requests_today: reservation?.requests_used_today,
        app_daily_limit: reservation?.app_daily_limit,
      });
    } catch (error) {
      const code = error instanceof AIAppError ? error.code : "INTERNAL_ERROR";
      console.error(`[learnary-ai] action=${action} failed: ${code} — ${error?.message ?? "unknown"}`);
      // Any failure here means no usable result was delivered, so the unit is
      // refunded (idempotent — an all-MCQ attempt already refunded).
      await releaseIfProviderFailed();
      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: code })
        .eq("id", aiRequestRowId);
      const status = code === "AI_RATE_LIMITED" ? 429 : code === "INTERNAL_ERROR" ? 500 : 502;
      return errorResponse(requestId, code, publicMessage(error), {}, status);
    }
  }

  // ---- generate_flashcards: preview only; the client saves
  // the selected cards on acceptance (card content is user-owned, so no
  // key-projection concern).
  if (action === "generate_flashcards") {
    try {
      const prompt = PROMPT_BUILDERS.generate_flashcards(validatedInput, practiceContext, learnerBlock);
      const result = await generate({
        model: AI_CONFIG.model,
        messages: prompt.messages,
        maxOutputTokens: Math.min(
          prompt.maxOutputTokens ?? AI_CONFIG.maxOutputTokens,
          AI_CONFIG.maxOutputTokensCap
        ),
        temperature: prompt.temperature ?? 0.7,
        apiKey: AI_CONFIG.apiKey,
        timeoutMs: Math.min(
          prompt.timeoutMs ?? AI_CONFIG.providerTimeoutMs,
          AI_CONFIG.providerTimeoutCapMs
        ),
      });
      await recordUsage(result.usage);
      const { cards } = parseFlashcards(result.content);
      const flashcardData = {
        cards,
        collection_id: validatedInput.collection_id ?? null,
        task_id: validatedInput.task_id ?? null,
      };
      await supabase
        .from("ai_requests")
        .update({
          status: "succeeded",
          model_id: result.model,
          prompt_version: prompt.version,
          result_json: flashcardData, // card content is user-owned — no keys
        })
        .eq("id", aiRequestRowId);
      return okResponse(requestId, action, flashcardData, {
        app_requests_today: reservation?.requests_used_today,
        app_daily_limit: reservation?.app_daily_limit,
      });
    } catch (error) {
      const code = error instanceof AIAppError ? error.code : "INTERNAL_ERROR";
      console.error(`[learnary-ai] action=${action} failed: ${code} — ${error?.message ?? "unknown"}`);
      // Any failure here means no usable result was delivered, so the unit is
      // refunded (idempotent — an all-MCQ attempt already refunded).
      await releaseIfProviderFailed();
      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: code })
        .eq("id", aiRequestRowId);
      const status = code === "AI_RATE_LIMITED" ? 429 : code === "INTERNAL_ERROR" ? 500 : 502;
      return errorResponse(requestId, code, publicMessage(error), {}, status);
    }
  }

  // ---- submit_quiz_attempt ---------------------------------------------------
  // MCQ scoring is deterministic on the server; short answers are evaluated
  // by the model against the stored rubric and clearly labeled. All-MCQ
  // attempts skip the provider and release the reserved unit.
  if (action === "submit_quiz_attempt") {
    const { quiz_id, answers } = validatedInput;
    // Scoring needs the stored answer keys, so this read uses the service-role
    // client (the browser client cannot SELECT quizzes.content). Ownership is
    // re-checked explicitly because the service client bypasses RLS.
    if (!quota) {
      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: "AI_MISCONFIGURED" })
        .eq("id", aiRequestRowId);
      return errorResponse(
        requestId,
        "AI_MISCONFIGURED",
        "Assistant usage accounting is not configured on this deployment.",
        {},
        503
      );
    }
    const { data: quiz } = await quota
      .from("quizzes")
      .select("id, content")
      .eq("id", quiz_id)
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (!quiz) {
      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: "VALIDATION_ERROR" })
        .eq("id", aiRequestRowId);
      await releaseQuota(units);
      return errorResponse(requestId, "VALIDATION_ERROR", "Quiz not found.");
    }

    const scored = scoreAttempt(quiz.content, answers);

    try {
      let evaluationType = "deterministic";
      if (scored.hasShortAnswers) {
        // The global kill switch disables generation, but MCQ scoring above
        // is local. Only this model-assisted branch depends on the provider.
        if (!AI_CONFIG.enabled) {
          await releaseQuota(units);
          await supabase
            .from("ai_requests")
            .update({ status: "failed", error_code: "AI_DISABLED" })
            .eq("id", aiRequestRowId);
          return errorResponse(
            requestId,
            "AI_DISABLED",
            "Short-answer grading is turned off right now. Multiple-choice quizzes still work.",
            {},
            503
          );
        }
        const prompt = buildEvaluateShortAnswersMessages({
          rubrics: scored.shortAnswers.map((s) => ({
            index: s.index,
            prompt: s.question.prompt,
            expected_answer: s.question.expected_answer,
            rubric: s.question.rubric,
            given: s.given,
          })),
        });
        const result = await generate({
          model: AI_CONFIG.model,
          messages: prompt.messages,
          maxOutputTokens: Math.min(
            prompt.maxOutputTokens ?? AI_CONFIG.maxOutputTokens,
            AI_CONFIG.maxOutputTokensCap
          ),
          temperature: prompt.temperature ?? 0.2,
          apiKey: AI_CONFIG.apiKey,
          timeoutMs: Math.min(
            prompt.timeoutMs ?? AI_CONFIG.providerTimeoutMs,
            AI_CONFIG.providerTimeoutCapMs
          ),
        });
        await recordUsage(result.usage);
        // Eval failure surfaces as AI_INVALID_RESPONSE; nothing is stored,
        // the learner's answers are returned in their request and retryable.
        const evaluations = parseShortAnswerEvaluations(
          result.content,
          scored.shortAnswers.map((s) => s.index)
        );
        const byIndex = new Map(evaluations.map((e) => [e.index, e]));
        for (const short of scored.shortAnswers) {
          const evaluation = byIndex.get(short.index);
          scored.score += evaluation.points;
          scored.feedback.push({
            index: short.index,
            type: "short_answer",
            verdict: evaluation.verdict,
            confidence: evaluation.confidence,
            given: short.given,
            expected: short.question.expected_answer,
            explanation: `${evaluation.feedback}${
              short.question.explanation ? ` — ${short.question.explanation}` : ""
            }`,
            concept: short.question.concept,
          });
        }
        scored.feedback.sort((a, b) => a.index - b.index);
        evaluationType = "ai_assisted";
      } else {
        // No provider call happened — return the reserved unit (cost-0 rule:
        // free actions must not consume allowance).
        await releaseQuota(units);
      }

      // Attempts are written with the service-role client: `authenticated`
      // has no INSERT on quiz_attempts, so a score must come from this route's
      // server-side grading, never from the browser.
      const { data: attempt, error: attemptError } = await quota
        .from("quiz_attempts")
        .insert({
          quiz_id: quiz.id,
          user_id: authData.user.id,
          answers: (answers ?? []).map((a) => ({ index: a.index, value: a.value })),
          score: scored.score,
          max_score: scored.maxScore,
          feedback: scored.feedback,
          evaluation_type: evaluationType,
        })
        .select("id, score, max_score, evaluation_type, completed_at")
        .single();
      if (attemptError) {
        throw new AIAppError(
          "INTERNAL_ERROR",
          "The attempt could not be saved. Please submit again."
        );
      }
      const attemptData = {
        attempt_id: attempt.id,
        score: attempt.score,
        max_score: attempt.max_score,
        evaluation_type: attempt.evaluation_type,
        completed_at: attempt.completed_at,
        feedback: scored.feedback,
      };
      await supabase
        .from("ai_requests")
        .update({
          status: "succeeded",
          model_id: evaluationType === "deterministic" ? null : AI_CONFIG.model,
          prompt_version: "v1",
          result_json: attemptData, // post-submission reveal is allowed
        })
        .eq("id", aiRequestRowId);
      return okResponse(requestId, action, attemptData, {
        app_requests_today: reservation?.requests_used_today,
        app_daily_limit: reservation?.app_daily_limit,
      });
    } catch (error) {
      const code = error instanceof AIAppError ? error.code : "INTERNAL_ERROR";
      console.error(`[learnary-ai] action=${action} failed: ${code} — ${error?.message ?? "unknown"}`);
      // Any failure here means no usable result was delivered, so the unit is
      // refunded (idempotent — an all-MCQ attempt already refunded).
      await releaseIfProviderFailed();
      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: code })
        .eq("id", aiRequestRowId);
      const status = code === "AI_RATE_LIMITED" ? 429 : code === "INTERNAL_ERROR" ? 500 : 502;
      return errorResponse(requestId, code, publicMessage(error), {}, status);
    }
  }

  // ---- prompt resolution -------------------------------------------------
  // Static prompts (ping) come from PROMPTS; input-dependent actions are
  // built by their builder with the validated input. An action with neither
  // is a registered-but-unimplemented action.
  const prompt = PROMPTS[action] ?? PROMPT_BUILDERS[action]?.(validatedInput, { learner: learnerBlock });
  if (!prompt) {
    // Reserved but no prompt defined for this action yet. Release the
    // reservation so it doesn't consume allowance.
    await releaseQuota(units);
    await supabase
      .from("ai_requests")
      .update({ status: "failed", error_code: "NOT_FOUND" })
      .eq("id", aiRequestRowId);
    return errorResponse(
      requestId,
      "NOT_FOUND",
      "This action is not available yet."
    );
  }

  // Structured-output validators: model output is untrusted and must pass
  // schema/quality validation before it reaches the client.
  // `generate_daily_plan` gets the offered tasks so item task_ids can be
  // cross-checked against real ones (the model can't link invented tasks).
  const OUTPUT_PARSERS = {
    generate_roadmap: (content) => ({ roadmap: parseRoadmapDraft(content) }),
    regenerate_roadmap_stage: (content) => ({ stage: parseStageDraft(content) }),
    break_down_task: (content) => ({ breakdown: parseBreakdown(content) }),
    explain_task: (content) => ({ explanation: parseExplanation(content) }),
    give_hint: (content) => ({ hints: parseHints(content) }),
    generate_practice: (content) => ({ practice: parsePractice(content) }),
    generate_daily_plan: (content) => ({
      plan: parseDailyPlan(content, validatedInput.tasks ?? []),
      // Stored with the result so a resumed draft keeps the budget the model
      // actually planned against, even if the profile changed since.
      available_minutes: validatedInput.available_minutes ?? null,
      available_minutes_estimated:
        validatedInput.available_minutes_estimated ?? null,
    }),
    generate_weekly_review: (content) => ({
      review: parseWeeklyReview(content),
      // The exact evidence the review was generated from, for a resumed view.
      metrics: validatedInput.metrics ?? null,
    }),
  };
  const parseOutput = OUTPUT_PARSERS[action];

  try {
    const result = await generate({
      model: AI_CONFIG.model,
      messages: prompt.messages,
      maxOutputTokens: Math.min(
        prompt.maxOutputTokens ?? AI_CONFIG.maxOutputTokens,
        AI_CONFIG.maxOutputTokensCap
      ),
      temperature: prompt.temperature ?? 0.7,
      apiKey: AI_CONFIG.apiKey,
      timeoutMs: Math.min(
        prompt.timeoutMs ?? AI_CONFIG.providerTimeoutMs,
        AI_CONFIG.providerTimeoutCapMs
      ),
    });

    await recordUsage(result.usage);

    let data = { content: result.content };
    if (parseOutput) {
      // Validation failures keep the recorded token usage (the provider call
      // did happen) but surface as AI_INVALID_RESPONSE to the client.
      data = parseOutput(result.content);
    }
    // Context transparency: exactly what this response used.
    if (contextUsed.length) data.context_used = contextUsed;

    await supabase
      .from("ai_requests")
      .update({
        status: "succeeded",
        model_id: result.model,
        prompt_version: prompt.version,
        result_json: data, // draft/assist output — safe to replay verbatim
      })
      .eq("id", aiRequestRowId);

    return okResponse(requestId, action, data, {
      app_requests_today: reservation?.requests_used_today,
      app_daily_limit: reservation?.app_daily_limit,
    });
  } catch (error) {
    const code = error instanceof AIAppError ? error.code : "INTERNAL_ERROR";
    console.error(`[learnary-ai] action=${action} failed: ${code} — ${error?.message ?? "unknown"}`);
    // Any failure here means no usable result was delivered, so the unit is
    // refunded (idempotent — an all-MCQ attempt already refunded).
    await releaseIfProviderFailed();
    const retry =
      error instanceof AIAppError && error.extra?.retry_after_seconds
        ? { retry_after_seconds: error.extra.retry_after_seconds }
        : {};
    await supabase
      .from("ai_requests")
      .update({
        status: "failed",
        error_code: code,
        prompt_version: prompt.version,
      })
      .eq("id", aiRequestRowId);
    const status =
      code === "AI_RATE_LIMITED" ? 429 : code === "INTERNAL_ERROR" ? 500 : 502;
    return errorResponse(
      requestId,
      code,
      publicMessage(error),
      retry,
      status
    );
  }
}
