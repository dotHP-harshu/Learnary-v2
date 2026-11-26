"use client";

import { useContext, useEffect, useState } from "react";
import userContext from "../../context/userContext";
import supabase from "../../supabase/supabase";
import { callAI, describeAIError } from "../../services/ai/aiClient";
import Card from "../ui/Card";
import ErrorState from "../ui/ErrorState";
import Skeleton from "../ui/Skeleton";
import {
  Bot,
  CircleAlert,
  CircleCheck,
  Coins,
  Gauge,
  Timer,
} from "lucide-react";

// Usage dashboard: enforced daily credit quota, informational provider-reported
// token counts, and per-response output caps. Usage failure never renders as zero.

const formatReset = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
};

const sumTokens = (rows, key) =>
  rows.reduce((sum, r) => sum + Number(r[key] ?? 0), 0);

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted p-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-fg">{value}</p>
      {hint && <p className="text-2xs text-fg-muted">{hint}</p>}
    </div>
  );
}

export default function AIUsageSection() {
  const { user } = useContext(userContext);
  const [statusState, setStatusState] = useState({ status: "loading" });
  const [historyState, setHistoryState] = useState({ status: "loading" });

  useEffect(() => {
    let active = true;

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatusState({ status: "offline" });
      setHistoryState({ status: "offline" });
      return;
    }

    callAI("status").then((result) => {
      if (!active) return;
      if (result.ok) setStatusState({ status: "ready", data: result.data });
      else setStatusState({ status: "error", code: result.code, message: result.message });
    });

    supabase
      .rpc("read_ai_usage_history", { p_days: 30 })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setHistoryState({ status: "error", message: error.message });
        else setHistoryState({ status: "ready", rows: data ?? [] });
      });

    return () => {
      active = false;
    };
  }, [user]);

  const header = (
    <div className="mb-4 flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft">
        <Bot size={18} className="text-accent" aria-hidden />
      </span>
      <div>
        <h2 className="text-base font-semibold text-fg">Usage</h2>
        <p className="text-xs text-fg-muted">Allowance, token consumption, limits</p>
      </div>
    </div>
  );

  if (statusState.status === "loading" || historyState.status === "loading") {
    return (
      <Card className="p-6">
        {header}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      </Card>
    );
  }

  if (statusState.status === "error") {
    return (
      <Card className="p-6">
        {header}
        <ErrorState
          title="Couldn't load usage"
          message={describeAIError(statusState.code, statusState.message)}
        />
      </Card>
    );
  }

  if (statusState.status === "offline") {
    return (
      <Card className="p-6">
        {header}
        <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          You're offline — usage shows fresh numbers once you reconnect.
        </p>
      </Card>
    );
  }

  const s = statusState.data;
  const resetTime = formatReset(s.reset_at);
  const rows = historyState.status === "ready" ? historyState.rows : null;
  const last7 = rows?.slice(0, 7) ?? [];
  const total30 = rows ? sumTokens(rows, "input_tokens") + sumTokens(rows, "output_tokens") : null;
  const tokensToday = (s.input_tokens_today ?? 0) + (s.output_tokens_today ?? 0);

  return (
    <Card className="p-6">
      {header}

      {/* Block 1 — daily allowance (weighted credits): the enforced quota */}
      <div className="mb-2 flex items-center gap-2">
        <Coins size={15} className="text-accent" aria-hidden />
        <h3 className="text-sm font-semibold text-fg">Daily allowance</h3>
        {s.available ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-success">
            <CircleCheck size={13} aria-hidden /> Available
          </span>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-warning">
            <CircleAlert size={13} aria-hidden /> Unavailable
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-fg-muted">
        Measured in credits (weighted units per feature) — this is what is
        actually enforced. Resets daily at 00:00 UTC
        {resetTime ? ` (about ${resetTime} your time)` : ""}.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Credits used today" value={s.daily_units_used ?? 0} />
        <Stat label="Credits remaining" value={s.daily_units_remaining ?? 0} />
        <Stat label="Daily limit" value={s.daily_units_limit ?? "—"} />
        <Stat label="Resets at" value={resetTime ? "00:00 UTC" : "daily"} hint={resetTime ? `≈ ${resetTime} local` : null} />
      </div>

      {/* Block 2 — actual provider-reported token consumption */}
      <div className="mb-2 mt-6 flex items-center gap-2">
        <Timer size={15} className="text-accent" aria-hidden />
        <h3 className="text-sm font-semibold text-fg">Token consumption</h3>
      </div>
      <p className="mb-3 text-xs text-fg-muted">
        Actual tokens reported by the provider for your requests
        (input + output). Informational — while credits are the allowance, no
        token-based cap is enforced. Daily usage history needs{" "}
        <code className="text-2xs">supabase/setup.sql</code> applied to
        your Supabase project.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Input tokens today" value={s.input_tokens_today ?? 0} />
        <Stat label="Output tokens today" value={s.output_tokens_today ?? 0} />
        <Stat label="Total tokens today" value={tokensToday} />
        <Stat
          label="Last 7 days (total)"
          value={rows ? sumTokens(last7, "input_tokens") + sumTokens(last7, "output_tokens") : "—"}
        />
      </div>
      {rows && (
        <p className="mt-2 text-xs tabular-nums text-fg-muted">
          {total30} tokens over the last 30 days ·{" "}
          {rows.length} active day{rows.length === 1 ? "" : "s"}
        </p>
      )}
      {historyState.status === "error" && (
        <p className="mt-2 text-xs text-warning">
          Usage history unavailable{historyState.message ? ` — ${historyState.message}` : ""}. Today's token numbers above are still live.
        </p>
      )}

      {/* Block 3 — generation limits (per response, NOT the daily allowance) */}
      <div className="mb-2 mt-6 flex items-center gap-2">
        <Gauge size={15} className="text-accent" aria-hidden />
        <h3 className="text-sm font-semibold text-fg">Generation limits</h3>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat
          label="Max output per response"
          value={`${s.max_output_tokens_per_response ?? "—"} tokens`}
          hint="Caps the size of one generated reply"
        />
        <Stat
          label="What this is NOT"
          value="Not a daily allowance"
          hint="The daily allowance is the credit quota above"
        />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-fg-muted">
        When you use these features, your selected learning context is sent to
        the provider for processing — never your password, keys, or other
        learners' data. Credits exist to keep the shared capacity available
        for everyone.
      </p>
    </Card>
  );
}
