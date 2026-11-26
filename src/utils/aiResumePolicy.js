// Polling policy for assistant recovery. Kept pure so the timing rules are
// testable without React or real timers.

export const POLL_BASE_MS = 4_000;
export const POLL_MAX_MS = 15_000;
export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 30_000;

// The route caps generation at 90 s; wait slightly longer before declaring a
// pending handle interrupted.
export const MAX_WAIT_MS = 100_000;

const STEPS = [1, 1.5, 2.5, 3.75, 6];

function delay(base, max, attempt) {
  const factor = STEPS[Math.min(Math.max(attempt, 0), STEPS.length - 1)];
  return Math.min(Math.round(base * factor), max);
}

export const nextPollDelay = (attempt = 0) =>
  delay(POLL_BASE_MS, POLL_MAX_MS, attempt);

export const nextRetryDelay = (attempt = 0) =>
  delay(RETRY_BASE_MS, RETRY_MAX_MS, attempt);

export function isExpired(entry, now = Date.now()) {
  return Boolean(entry?.startedAt) && now - entry.startedAt >= MAX_WAIT_MS;
}

export function shouldPoll(visibilityState) {
  return visibilityState !== "hidden";
}
