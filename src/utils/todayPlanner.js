// Today planner core. Pure functions only — no I/O — so classification, ranking,
// focus selection and quick planning stay deterministic and easy to verify.
import { addDays } from "./learnerDate";

/** Priority weight (lower ranks first). Unknown priority ranks as medium. */
export function priorityRank(priority) {
  if (priority === "high") return 0;
  if (priority === "low") return 2;
  return 1;
}

/**
 * Offset (ms) that must be ADDED to a UTC instant to get the wall-clock time
 * in `timezone` rendered as if it were UTC. ( Intl parts parsed back as UTC
 * minus the actual instant. )
 */
function zonedOffsetMs(instant, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(instant)
    .reduce((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  const asUTC = Date.parse(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`
  );
  return asUTC - instant.getTime();
}

/**
 * UTC ms of local midnight on `dateStr` (YYYY-MM-DD) in the learner's time
 * zone. Without a zone, falls back to the device-local parse (the historical
 * behavior for unsaved profiles). Iterates to converge on DST boundaries.
 */
export function learnerDayStartMs(dateStr, timezone) {
  if (!timezone) return new Date(`${dateStr}T00:00:00`).getTime();
  let ms = Date.parse(`${dateStr}T00:00:00Z`);
  for (let i = 0; i < 3; i++) {
    ms = Date.parse(`${dateStr}T00:00:00Z`) - zonedOffsetMs(new Date(ms), timezone);
  }
  return ms;
}

/** YYYY-MM-DD + 1 day (UTC-safe arithmetic on the date string itself). */
export function nextDateStr(dateStr) {
  return addDays(dateStr, 1);
}

/** Start and end (exclusive) of the learner's day, in UTC ms. */
export function learnerDayBounds(dateStr, timezone) {
  const startMs = learnerDayStartMs(dateStr, timezone);
  const endMs = learnerDayStartMs(nextDateStr(dateStr), timezone);
  return { startMs, endMs };
}

export const BUCKETS = ["overdue", "due", "scheduled", "later"];


/**
 * Classify one pending task against the learner's today and rank it:
 * bucket order → due date (most overdue / soonest due first) → priority →
 * title. Deterministic: the same rows always produce the same order.
 */
export function classifyTask(task, dateStr, timezone) {
  const { startMs, endMs } = learnerDayBounds(dateStr, timezone);
  const dueMs = task.due_at ? new Date(task.due_at).getTime() : null;
  if (dueMs !== null && dueMs < startMs) return { bucket: "overdue", dueMs };
  if (dueMs !== null && dueMs < endMs) return { bucket: "due", dueMs };
  if (task.scheduled_for === dateStr) return { bucket: "scheduled", dueMs };
  return { bucket: "later", dueMs };
}

function compareRanked(a, b) {
  if (a.bucket !== b.bucket) return BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket);
  if (a.dueMs != null && b.dueMs != null && a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
  const p = priorityRank(a.task.priority) - priorityRank(b.task.priority);
  if (p !== 0) return p;
  return String(a.task.title).localeCompare(String(b.task.title));
}

/**
 * Rank every pending task. Returns an array of {task, bucket, dueMs} in
 * display order — overdue tasks sorted MOST overdue first, so an old
 * overdue task is never pushed below a newer one merely by recency.
 */
export function rankTodayTasks(tasks, dateStr, timezone) {
  return (tasks ?? [])
    .map((task) => ({ task, ...classifyTask(task, dateStr, timezone) }))
    .sort(compareRanked);
}

/** Group a ranked list into the four buckets (for the expanded view). */
export function groupByBucket(ranked) {
  const groups = { overdue: [], due: [], scheduled: [], later: [] };
  for (const entry of ranked) groups[entry.bucket].push(entry);
  return groups;
}

/**
 * Primary focus: the first `max` ranked tasks. Everything else comes back as
 * `rest` — accessible, never deleted.
 */
export function pickFocus(ranked, max = 3) {
  return { focus: ranked.slice(0, max), rest: ranked.slice(max) };
}

/** Estimate used when a task carries none (one focused session default). */
const FALLBACK_ESTIMATE = 30;

/**
 * Quick plan ("I have 15 minutes"): pick ranked tasks whose OWN estimate
 * fits the given minutes, oldest obligation first, up to `max` items and
 * within the cumulative budget. Unknown estimates use the fallback. Returns
 * plan items in the PlanDraft shape.
 */
export function pickQuickPlan(ranked, minutes, { max = 3, fallbackEstimate = FALLBACK_ESTIMATE } = {}) {
  const items = [];
  let used = 0;
  for (const { task } of ranked) {
    if (items.length >= max || used >= minutes) break;
    const estimate = task.estimated_minutes ?? fallbackEstimate;
    if (used + estimate > minutes) continue;
    used += estimate;
    items.push({
      task_id: task.id,
      title: task.title,
      estimated_minutes: estimate,
      priority: task.priority ?? "medium",
      type: "task",
    });
  }
  return items;
}
