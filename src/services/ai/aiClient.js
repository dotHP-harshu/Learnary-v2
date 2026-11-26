// Provider-neutral frontend assistant client. UI components call this — never Groq
// directly, never with secrets. One endpoint, versioned envelope.

import supabase from "../../supabase/supabase";
import { journal } from "./aiJournal";
import { hashPayload, resolveRequestId } from "../../utils/aiRequestIdentity";

const ENDPOINT = "/api/learnary-ai";

// Actions whose result is a user-facing artifact the UI can rehydrate after a
// remount/reload. Infrastructure probes (status/ping) are deliberately
// excluded: their own storage is already the recovery path.
const RESUMABLE_ACTIONS = new Set([
  "generate_daily_plan",
  "generate_roadmap",
  "regenerate_roadmap_stage",
  "generate_flashcards",
  "generate_weekly_review",
  "generate_quiz",
  "break_down_task",
  "explain_task",
  "give_hint",
  "generate_practice",
  "tutor_chat",
  "submit_quiz_attempt",
]);

// Codes where the server may still finish the request even though this fetch
// failed. The journal stays, ownership is released, and useAIResume polls.
export const RETRYABLE_AI_CODES = new Set([
  "PENDING",
  "TIMEOUT",
  "INTERRUPTED",
  "NETWORK_ERROR",
  "OFFLINE",
]);

// In-flight calls owned by the component that started them. The recovery hook
// must not poll (and apply) a result the caller is about to apply itself.
// The watchdog releases a call whose promise never settled (frozen tab).
const CALL_WATCHDOG_MS = 100_000;
const activeCalls = new Map(); // requestId -> startedAt

const listeners = new Set();

function emitAIRequest(event) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* a listener must never break a request */
    }
  }
}

/** Subscribe to journal lifecycle events for recovery hooks. */
export function subscribeAIRequests(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while the component that started this request still owns the result. */
export function isAIRequestActive(requestId) {
  const startedAt = activeCalls.get(requestId);
  if (!startedAt) return false;
  if (Date.now() - startedAt > CALL_WATCHDOG_MS) {
    activeCalls.delete(requestId);
    return false;
  }
  return true;
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

const isOffline = () =>
  typeof navigator !== "undefined" && navigator.onLine === false;

async function authHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  return {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    userKey: session.user?.id ?? null,
  };
}

/** Load the user's journal from IndexedDB/sessionStorage before reading it. */
export async function hydrateAIJournal(userKey, options) {
  if (!userKey) return;
  try {
    await journal.hydrate(userKey, options);
  } catch {
    /* recovery is best-effort */
  }
}

/** The newest journal entry for one of `actions` in `scope`, or null. */
export function readNewestAIRequest(userKey, actions, scope) {
  if (!userKey) return null;
  return journal.readNewest(
    userKey,
    Array.isArray(actions) ? actions : [actions],
    scope ?? "default"
  );
}

/**
 * @param {string} action
 * @param {{context?: object, input?: object, resumeScope?: string,
 *   resumeMeta?: object}} [options]
 * @returns {Promise<{ok: true, data: object, usage: object, requestId: string} |
 *   {ok: false, code: string, message: string, retryAfter?: number}>}
 */
export async function callAI(
  action,
  { context, input, resumeScope, resumeMeta } = {}
) {
  const auth = await authHeaders();
  if (!auth) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Sign in to use these features.",
    };
  }

  const { userKey } = auth;
  const scope = resumeScope ?? "default";
  const journaled =
    RESUMABLE_ACTIONS.has(action) &&
    Boolean(userKey) &&
    typeof window !== "undefined";

  let existing = null;
  let identity = null;
  if (journaled) {
    identity = await hashPayload(action, context, input);
    await hydrateAIJournal(userKey);
    existing = journal.read(userKey, action, scope);
  }

  // Reuse the id only when this is a true retry of the same payload: the
  // server then returns the recorded result instead of charging a second time.
  const requestId = journaled
    ? resolveRequestId({ existing, identity, newId: randomId() })
    : randomId();

  // Claim ownership before the journal write so a recovery tick that runs
  // during the await cannot deliver a result this caller is about to apply.
  activeCalls.set(requestId, Date.now());

  if (journaled) {
    // A deliberate new generation supersedes a sibling action's slot in the
    // same scope (Task Assist shares one scope across four actions).
    journal.clearScope(userKey, scope, action);
    await journal.write(userKey, {
      requestId,
      action,
      scope,
      payloadHash: identity,
      // Each explicit attempt gets a fresh local deadline; the request id is
      // what makes a retry idempotent, not the timestamp.
      startedAt: Date.now(),
      status: "pending",
      meta: resumeMeta ?? existing?.meta ?? null,
    });
  }

  let released = false;

  try {
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: auth.headers,
        body: JSON.stringify({
          version: 1,
          action,
          request_id: requestId,
          context: context ?? {},
          input: input ?? {},
        }),
        // Mirror the server's 90 s maxDuration (route.js): a request that
        // never settles must not leave the composer disabled forever.
        signal: AbortSignal.timeout(95_000),
      });
    } catch (error) {
      // The connection dropped or the deadline elapsed — keep the journal so
      // recovery can fetch the recorded result instead of paying twice.
      released = true;
      if (error?.name === "TimeoutError") {
        return {
          ok: false,
          code: "TIMEOUT",
          message:
            "This is taking too long. Retry — if the generation finished, the saved result is reused at no extra cost.",
        };
      }
      if (error?.name === "AbortError") {
        return {
          ok: false,
          code: "INTERRUPTED",
          message:
            "Generation was interrupted. Retry — a finished result is reused at no extra cost.",
        };
      }
      if (isOffline()) {
        return {
          ok: false,
          code: "OFFLINE",
          message: "You are offline. These features need an internet connection.",
        };
      }
      return {
        ok: false,
        code: "NETWORK_ERROR",
        message:
          "The connection dropped. Retry — a finished result is reused at no extra cost.",
      };
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      released = true;
      return {
        ok: false,
        code: "INTERNAL_ERROR",
        message: "Unexpected server response.",
      };
    }

    if (!payload.ok) {
      const code = payload?.error?.code ?? "INTERNAL_ERROR";
      const message =
        payload?.error?.message ?? "Request failed. Please try again.";
      // A conflict caused by our own still-running request is not a failure:
      // keep the journal so the UI can resume it instead of re-charging.
      if (code === "IDEMPOTENCY_CONFLICT" && /pending|processing/i.test(message)) {
        released = true;
        return {
          ok: false,
          code: "PENDING",
          message: "Still generating — give it a moment.",
          retryAfter: payload?.error?.retry_after_seconds ?? 2,
        };
      }
      // Definitive server-side failure: nothing to recover for this payload.
      if (journaled) journal.clear(userKey, action, scope, requestId);
      return {
        ok: false,
        code,
        message,
        retryAfter: payload?.error?.retry_after_seconds,
      };
    }

    return {
      ok: true,
      data: payload.data,
      usage: payload.usage,
      requestId,
    };
  } finally {
    activeCalls.delete(requestId);
    if (released) emitAIRequest({ type: "released", action, scope, requestId });
  }
}

/**
 * Look up a previously started generation by its persisted request id.
 *
 * Returns `null` when there is no pending handle. Otherwise:
 *   {status:"succeeded", data, resultRef, requestId, meta}
 *   {status:"failed", code, requestId, meta}
 *   {status:"pending", startedAt, requestId, meta}
 *   {status:"missing"}            — the request never reached the server
 *   {status:"unavailable", ...}   — network/auth problem; keep the handle
 *
 * Succeeded results are cached in the journal but NOT cleared here: the caller
 * acknowledges only after it has actually rehydrated the UI. That is what makes
 * a result survive a tab switch or reload that unmounted the original component.
 */
export async function resumeAIRequest(action, scope, userKey) {
  if (!userKey || typeof window === "undefined") return null;
  const slot = scope ?? "default";

  await hydrateAIJournal(userKey);
  const entry = journal.read(userKey, action, slot);
  if (!entry) return null;

  if (entry.status === "succeeded" && (entry.result !== undefined || entry.resultRef)) {
    return {
      status: "succeeded",
      data: entry.result ?? null,
      resultRef: entry.resultRef ?? null,
      requestId: entry.requestId,
      meta: entry.meta ?? null,
    };
  }
  if (entry.status === "failed") {
    journal.clear(userKey, action, slot, entry.requestId);
    return {
      status: "failed",
      code: entry.errorCode ?? "INTERNAL_ERROR",
      requestId: entry.requestId,
      meta: entry.meta ?? null,
    };
  }

  const auth = await authHeaders();
  if (!auth) return { status: "unavailable", code: "UNAUTHENTICATED" };

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        version: 1,
        action: "resume_request",
        request_id: randomId(),
        context: {
          original_request_id: entry.requestId,
          original_action: action,
        },
        input: {},
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return {
      status: "unavailable",
      code: isOffline() ? "OFFLINE" : "NETWORK_ERROR",
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { status: "unavailable", code: "INTERNAL_ERROR" };
  }

  if (!payload.ok) {
    const code = payload?.error?.code ?? "INTERNAL_ERROR";
    // The lookup itself is broken, not the generation. Keep the handle.
    return { status: "unavailable", code };
  }

  // A newer request for the same scope may have started while this lookup was
  // in flight. Never let the older lookup clear or rehydrate over the newer
  // handle: if the journal moved on (or expired), this poll is simply stale.
  const current = journal.read(userKey, action, slot);
  if (!current || current.requestId !== entry.requestId) return null;

  const data = payload.data ?? {};
  if (data.status === "succeeded") {
    const updated = await journal.write(userKey, {
      ...entry,
      status: "succeeded",
      result: data.result ?? null,
      resultRef: data.result_ref ?? null,
      errorCode: null,
    });
    return {
      status: "succeeded",
      data: updated?.result ?? null,
      resultRef: updated?.resultRef ?? null,
      requestId: entry.requestId,
      meta: entry.meta ?? null,
    };
  }
  if (data.status === "failed") {
    journal.clear(userKey, action, slot, entry.requestId);
    return {
      status: "failed",
      code: data.error_code ?? "INTERNAL_ERROR",
      requestId: entry.requestId,
      meta: entry.meta ?? null,
    };
  }
  if (data.status === "pending") {
    return {
      status: "pending",
      startedAt: entry.startedAt,
      requestId: entry.requestId,
      meta: entry.meta ?? null,
    };
  }

  // No row: the request never reached the server (offline at send time).
  journal.clear(userKey, action, slot, entry.requestId);
  return { status: "missing", requestId: entry.requestId, meta: entry.meta ?? null };
}

/** Mark a generation's result as consumed so it is not replayed again. */
export function ackAIRequest(action, scope, userKey, requestId) {
  if (!userKey) return false;
  const slot = scope ?? "default";
  const cleared = journal.clear(userKey, action, slot, requestId);
  if (cleared) emitAIRequest({ type: "cleared", action, scope: slot });
  return cleared;
}

/** Human-friendly message for an assistant error code. */
export function describeAIError(code, fallback) {
  switch (code) {
    case "AI_DISABLED":
      return "Generation is currently turned off. Manual features keep working.";
    case "AI_USER_QUOTA_EXCEEDED":
    case "AI_GLOBAL_QUOTA_EXCEEDED":
      return "The daily allowance for today is used up. Try again tomorrow — manual features keep working.";
    case "AI_RATE_LIMITED":
      return "Generation is temporarily busy. Please try again in a moment.";
    case "AI_PROVIDER_UNAVAILABLE":
    case "AI_PROVIDER_TIMEOUT":
      return "Generation is temporarily unavailable. Please try again shortly.";
    case "AI_PROVIDER_BLOCKED":
      return "The AI provider is blocking this network or region. Try a different network (or turn off any VPN), or deploy from a supported region.";
    case "AI_INVALID_RESPONSE":
      return "Generation returned something unexpected. Please try again.";
    case "UNAUTHENTICATED":
      return "Please sign in again to use these features.";
    case "OFFLINE":
      return "Generation needs an internet connection. Cached learning data stays available.";
    case "TIMEOUT":
      return "This is taking too long. Retry — a finished generation is reused at no extra cost.";
    case "INTERRUPTED":
      return "Generation was interrupted. Retry — a finished result is reused at no extra cost.";
    case "NETWORK_ERROR":
      return "The connection dropped. Retry — a finished result is reused at no extra cost.";
    case "PENDING":
      return "Still generating — give it a moment.";
    case "AI_MISCONFIGURED":
      return "Generation is unavailable on this deployment. Manual features keep working.";
    default:
      return fallback ?? "Something went wrong. Please try again.";
  }
}
