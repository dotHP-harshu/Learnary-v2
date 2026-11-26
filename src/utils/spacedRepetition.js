// Spaced-repetition scheduling engine. Pure functions, no I/O — scheduling is
// deterministic and unit-testable; constants are documented in the Practice UI footer.

export const ALGORITHM = {
  version: "sm2-lite-v1",
  // Again re-shows the card within the same session; the other ratings are
  // day-based. Coefficients are deliberately conservative (SM-2 inspired).
  constants: {
    AGAIN_MINUTES: 10,
    HARD_MULT: 1.2,
    GOOD_START_DAYS: 1,
    EASY_START_DAYS: 3,
    EASY_BONUS: 1.3,
    EASE_START: 2.5,
    EASE_MIN: 1.3,
    EASE_MAX: 3.0,
    AGAIN_EASE_PENALTY: 0.2,
    EASE_DELTA: 0.15,
    MAX_DAYS: 365,
  },
};

/**
 * @param {{rating: "again"|"hard"|"good"|"easy",
 *          intervalDays?: number|null, easeFactor?: number|null,
 *          now?: Date}} state
 * @returns {{nextReviewAt: string, intervalDays: number, easeFactor: number}}
 *   nextReviewAt is an ISO timestamp; intervalDays is the stored
 *   day-based interval (0 for the Again/10-minute case).
 */
export function scheduleNext({ rating, intervalDays, easeFactor, now }) {
  const c = ALGORITHM.constants;
  const base = now ?? new Date();
  const prevInterval = Math.max(0, Number(intervalDays) || 0);
  const prevEase = clamp(
    easeFactor == null ? c.EASE_START : Number(easeFactor),
    c.EASE_MIN,
    c.EASE_MAX
  );

  let ease = prevEase;
  let interval;

  switch (rating) {
    case "again":
      // Relearn: short intra-session interval, ease drops hard.
      ease = clamp(ease - c.AGAIN_EASE_PENALTY, c.EASE_MIN, c.EASE_MAX);
      interval = 0;
      break;
    case "hard":
      ease = clamp(ease - c.EASE_DELTA, c.EASE_MIN, c.EASE_MAX);
      // Must always move forward: round(1 * 1.2) === 1 and round(2 * 1.2)
      // === 2, so without the +1 floor a card rated "hard" on every review
      // would be stuck on a 1–2 day interval forever.
      interval =
        prevInterval <= 0
          ? c.GOOD_START_DAYS
          : Math.max(
              prevInterval + 1,
              Math.round(prevInterval * c.HARD_MULT)
            );
      break;
    case "easy":
      ease = clamp(ease + c.EASE_DELTA, c.EASE_MIN, c.EASE_MAX);
      interval =
        prevInterval <= 0
          ? c.EASY_START_DAYS
          : Math.round(prevInterval * ease * c.EASY_BONUS);
      break;
    case "good":
    default:
      interval =
        prevInterval <= 0 ? c.GOOD_START_DAYS : Math.round(prevInterval * ease);
      break;
  }

  interval = Math.min(interval, c.MAX_DAYS);

  const next =
    rating === "again"
      ? new Date(base.getTime() + c.AGAIN_MINUTES * 60_000)
      : new Date(base.getTime() + interval * 86_400_000);

  return {
    nextReviewAt: next.toISOString(),
    intervalDays: interval,
    easeFactor: Math.round(ease * 100) / 100,
  };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
