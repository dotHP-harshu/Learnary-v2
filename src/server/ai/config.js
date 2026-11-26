import "server-only"; // boundary: never import this module from a Client Component

// Server-only configuration for the Learnary tutor service.
// Every value comes from server-side environment variables (Vercel env
// vars WITHOUT the NEXT_PUBLIC_ prefix — that prefix would leak them into
// the browser bundle). Never hardcode a model ID.

function intEnv(name, fallback, min = 0) {
  const raw = process.env[name];
  if (!raw) return fallback;
  // Strict on purpose: "1600abc" must not silently become 1600, and a token
  // or timeout limit of 0 would disable the bound it is meant to enforce.
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= min ? parsed : fallback;
}

export const AI_CONFIG = {
  // Global kill switch. Default off: the tutor stays dark until the
  // owner explicitly enables it.
  enabled: process.env.LEARNARY_AI_ENABLED === "true",
  provider: process.env.LEARNARY_AI_PROVIDER || "groq",
  apiKey: process.env.GROQ_API_KEY || null,
  // The deployment owner confirms the model ID in the Groq console and sets
  // it here. No fallback model is invented.
  model: process.env.GROQ_MODEL || null,
  // Server-only privileged key used exclusively for quota accounting
  // (reserve/release/record). Never exposed to the browser, never prefixed
  // with NEXT_PUBLIC_, and never used for user data access. When it is
  // missing, assistant requests fail closed instead of falling back to the
  // browser-callable path.
  //
  // Both Supabase key generations are accepted: SUPABASE_SERVICE_ROLE_KEY
  // holds the legacy `eyJ...` service_role JWT, SUPABASE_SECRET_KEY holds the
  // newer `sb_secret_...` key (see Settings → API Keys). Whichever the
  // deployment provides, the same Postgres `service_role` is assumed.
  serviceRoleKey:
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    null,
  // Default when a prompt does not declare its own budget.
  maxOutputTokens: intEnv("LEARNARY_AI_MAX_OUTPUT_TOKENS", 1600, 1),
  // Hard per-response ceiling. Prompt-level budgets (roadmap needs 16k) are
  // clamped to this, so a prompt cannot silently exceed the deployment's
  // intended spend. Must be >= the default above.
  maxOutputTokensCap: Math.max(
    intEnv("LEARNARY_AI_MAX_OUTPUT_TOKENS_CAP", 16_384, 1),
    intEnv("LEARNARY_AI_MAX_OUTPUT_TOKENS", 1600, 1)
  ),
  // Application policy limits — starting values, owner-tunable.
  userDailyUnits: intEnv("LEARNARY_AI_DAILY_USER_UNITS", 10, 1),
  globalDailyUnits: intEnv("LEARNARY_AI_GLOBAL_DAILY_UNITS", 500, 1),
  // Deployment-wide spend ceiling in provider tokens (the provider's billing
  // unit, so no per-model price table is needed). Checked before each
  // reservation; the day's counter comes from ai_usage_global_daily.
  globalDailyTokens: intEnv("LEARNARY_AI_GLOBAL_DAILY_TOKENS", 2_000_000, 1),
  // Abuse control: fixed-window request limits (see supabase/setup.sql).
  ipRequestsPerMinute: intEnv("LEARNARY_AI_IP_REQUESTS_PER_MINUTE", 30, 1),
  userRequestsPerMinute: intEnv("LEARNARY_AI_USER_REQUESTS_PER_MINUTE", 20, 1),
  // Bounded request body size.
  maxBodyBytes: intEnv("LEARNARY_AI_MAX_BODY_BYTES", 64 * 1024, 1),
  // Default when a prompt does not declare its own timeout.
  providerTimeoutMs: intEnv("LEARNARY_AI_PROVIDER_TIMEOUT_MS", 30_000, 1),
  // Hard per-request timeout ceiling, kept under the route's maxDuration so
  // the handler can still return a JSON error.
  providerTimeoutCapMs: intEnv(
    "LEARNARY_AI_MAX_PROVIDER_TIMEOUT_MS",
    85_000,
    1
  ),
};

/**
 * Action registry: the server-side allowlist + cost units. Unknown actions
 * are rejected. `ping` and `status` are infrastructure actions for
 * verification and the usage UI — not product features.
 */
export const AI_ACTIONS = {
  ping: { cost: 0, providerCall: true, phase: 1 },
  status: { cost: 0, providerCall: false, phase: 1 },
  // Recovery lookup for a generation that outlived its component (tab switch,
  // reload, PWA backgrounding). Reads the stored idempotency result only — no
  // provider call and no quota.
  resume_request: { cost: 0, providerCall: false, phase: 1 },
  generate_roadmap: { cost: 4, providerCall: true, phase: 2 },
  regenerate_roadmap_stage: { cost: 2, providerCall: true, phase: 2 },
  break_down_task: { cost: 2, providerCall: true, phase: 3 },
  explain_task: { cost: 1, providerCall: true, phase: 3 },
  give_hint: { cost: 1, providerCall: true, phase: 3 },
  generate_practice: { cost: 2, providerCall: true, phase: 3 },
  tutor_chat: { cost: 1, providerCall: true, phase: 4 },
  generate_quiz: { cost: 2, providerCall: true, phase: 5 },
  // Deterministic MCQ scoring is entirely local, so the global kill switch
  // must not disable quiz submission. The route gates only the short-answer
  // branch on `enabled` (and refunds the unit when AI is dark).
  submit_quiz_attempt: { cost: 1, providerCall: false, phase: 5 },
  generate_flashcards: { cost: 2, providerCall: true, phase: 5 },
  generate_daily_plan: { cost: 2, providerCall: true, phase: 3 },
  generate_weekly_review: { cost: 2, providerCall: true, phase: 6 },
};

export function actionConfig(action) {
  return AI_ACTIONS[action] ?? null;
}

/** Typed application error for the response envelope. */
export class AIAppError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "AIAppError";
    this.code = code;
    this.extra = extra;
  }
}
