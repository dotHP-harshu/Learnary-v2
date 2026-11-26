"use client";

import { useEffect, useRef } from "react";
import {
  ackAIRequest,
  hydrateAIJournal,
  isAIRequestActive,
  readNewestAIRequest,
  resumeAIRequest,
  subscribeAIRequests,
} from "../services/ai/aiClient";
import {
  MAX_WAIT_MS,
  isExpired,
  nextPollDelay,
  nextRetryDelay,
  shouldPoll,
} from "../utils/aiResumePolicy";

/**
 * Resume a generation that outlived the component that started it, or that
 * failed while still mounted (timeout, dropped connection, frozen tab).
 *
 * It reads the durable journal, skips requests the caller still owns, polls
 * `resume_request` with backoff while visible, and wakes on
 * visibilitychange / pageshow / focus / online / resume. It never aborts an
 * in-flight generation when the page is hidden.
 *
 * The caller must call `ackAIRequest(action, scope, userKey, requestId)` after
 * it has actually applied the result — not before.
 *
 * @param {string|string[]} action one action, or several sharing a scope
 * @param {string} scope
 * @param {{
 *   enabled?: boolean,
 *   userKey?: string|null,
 *   onPendingChange?: (pending: boolean, meta?: object|null) => void,
 *   onSucceeded?: (result: {action: string, data: object|null,
 *     resultRef: string|null, requestId: string, meta: object|null}) => void,
 *   onFailed?: (result: {code: string, action: string,
 *     meta: object|null}) => void,
 *   onMissing?: () => void,
 * }} options
 */
export default function useAIResume(
  action,
  scope,
  {
    enabled = true,
    userKey,
    onPendingChange,
    onSucceeded,
    onFailed,
    onMissing,
  } = {}
) {
  const handlers = useRef({});
  handlers.current = {
    onPendingChange,
    onSucceeded,
    onFailed,
    onMissing,
  };

  const actions = Array.isArray(action) ? action : [action];
  const actionKey = actions.filter(Boolean).join("|");
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (!enabled || !scope || !userKey || !actionKey) return;

    let cancelled = false;
    let timer = null;
    let attempt = 0;
    let ticking = false;
    const delivered = new Set();

    const visible = () =>
      typeof document === "undefined" ? true : shouldPoll(document.visibilityState);

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = (delay) => {
      if (cancelled || !visible()) return;
      clearTimer();
      timer = setTimeout(tick, delay);
    };

    const deliver = async (entry) => {
      if (cancelled || delivered.has(entry.requestId)) return;
      delivered.add(entry.requestId);
      handlers.current.onPendingChange?.(false);
      try {
        await handlers.current.onSucceeded?.({
          action: entry.action,
          scope,
          data: entry.result ?? null,
          resultRef: entry.resultRef ?? null,
          requestId: entry.requestId,
          meta: entry.meta ?? null,
        });
      } catch (error) {
        // Leave the journal intact so the next mount can retry the handoff.
        delivered.delete(entry.requestId);
        console.error("[useAIResume] onSucceeded handler failed", error);
      }
    };

    const fail = (entry, code) => {
      clearTimer();
      handlers.current.onPendingChange?.(false);
      handlers.current.onFailed?.({
        code,
        action: entry.action,
        scope,
        meta: entry.meta ?? null,
      });
    };

    const tick = async (force = false) => {
      if (cancelled || ticking || !visible()) return;
      ticking = true;
      try {
        try {
          await hydrateAIJournal(userKey, force ? { force: true } : undefined);
        } catch {
          /* the journal is best-effort; keep the last known state */
        }
        if (cancelled) return;

        const entry = readNewestAIRequest(userKey, actionsRef.current, scope);
        if (!entry) {
          handlers.current.onPendingChange?.(false);
          return;
        }

        // The component that started this call still owns its result.
        if (isAIRequestActive(entry.requestId)) return;

        if (entry.status === "succeeded" && (entry.result !== undefined || entry.resultRef)) {
          await deliver(entry);
          return;
        }
        if (entry.status === "failed") {
          ackAIRequest(entry.action, scope, userKey, entry.requestId);
          fail(entry, entry.errorCode ?? "INTERNAL_ERROR");
          return;
        }
        if (isExpired(entry)) {
          ackAIRequest(entry.action, scope, userKey, entry.requestId);
          fail(entry, "INTERRUPTED");
          return;
        }

        const result = await resumeAIRequest(entry.action, scope, userKey);
        if (cancelled) return;
        if (!result) {
          handlers.current.onPendingChange?.(false);
          return;
        }

        if (result.status === "pending") {
          handlers.current.onPendingChange?.(true, entry.meta ?? null);
          schedule(nextPollDelay(attempt++));
          return;
        }

        // The lookup itself failed (offline, server error). The generation may
        // still be running, so keep polling quietly — don't claim "generating"
        // for a request we simply cannot check right now.
        if (result.status === "unavailable") {
          if (Date.now() - entry.startedAt >= MAX_WAIT_MS) {
            ackAIRequest(entry.action, scope, userKey, entry.requestId);
            fail(entry, result.code ?? "NETWORK_ERROR");
            return;
          }
          schedule(nextRetryDelay(attempt++));
          return;
        }

        handlers.current.onPendingChange?.(false);
        if (result.status === "succeeded") {
          await deliver({
            ...entry,
            status: "succeeded",
            result: result.data ?? null,
            resultRef: result.resultRef ?? null,
          });
        } else if (result.status === "failed") {
          fail(entry, result.code);
        } else {
          handlers.current.onMissing?.();
        }
      } finally {
        ticking = false;
      }
    };

    const onVisibilityChange = () => {
      if (!visible()) {
        // Freezing/backgrounding must not cancel the request. Stop the timer
        // so a hidden tab does not burn the per-IP recovery allowance.
        clearTimer();
        return;
      }
      attempt = 0;
      tick(true);
    };

    const onLifecycle = () => {
      if (!visible()) return;
      attempt = 0;
      tick(true);
    };

    const unsubscribe = subscribeAIRequests((event) => {
      if (cancelled || event.scope !== scope) return;
      if (event.action && !actionsRef.current.includes(event.action)) return;
      if (event.type === "released") {
        attempt = 0;
        tick(false);
      }
    });

    tick(false);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
      document.addEventListener("resume", onLifecycle);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("pageshow", onLifecycle);
      window.addEventListener("focus", onLifecycle);
      window.addEventListener("online", onLifecycle);
    }

    return () => {
      cancelled = true;
      clearTimer();
      unsubscribe();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        document.removeEventListener("resume", onLifecycle);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("pageshow", onLifecycle);
        window.removeEventListener("focus", onLifecycle);
        window.removeEventListener("online", onLifecycle);
      }
    };
  }, [actionKey, scope, enabled, userKey]);
}
