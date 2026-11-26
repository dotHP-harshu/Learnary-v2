// Local learner date: today's date in the user's saved time zone, falling back
// to the device time zone. Returns YYYY-MM-DD.

export function learnerToday(timezone) {
  const fmt = (tz) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return parts.format(new Date()); // en-CA → YYYY-MM-DD
  };
  try {
    return fmt(timezone || undefined);
  } catch {
    try {
      return fmt(undefined); // device zone
    } catch {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
    }
  }
}

/**
 * Day key (YYYY-MM-DD) for ANY timestamp in the learner's saved time zone —
 * the one consistent timezone rule for activity metrics.
 */
export function learnerDayKey(timestamp, timezone) {
  const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const fmt = (tz) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  try {
    return fmt(timezone || undefined);
  } catch {
    try {
      return fmt(undefined);
    } catch {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
    }
  }
}

export function formatPlanDate(dateStr) {
  try {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// ---- pure date-string helpers ------------------------------------------------
// All operate on YYYY-MM-DD strings and never consult the device clock, so
// chart buckets and heatmap grids are deterministic for the learner's day.

/** YYYY-MM-DD + n days (n may be negative). */
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Array of `n` day keys ending at `endDateStr`, oldest first. */
export function lastNDays(endDateStr, n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) days.push(addDays(endDateStr, -i));
  return days;
}

/** Weekday of a YYYY-MM-DD string: 0 (Sun) … 6 (Sat) — zone-independent. */
export function weekdayIndex(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}
