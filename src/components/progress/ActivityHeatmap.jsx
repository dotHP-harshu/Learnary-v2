"use client";

import { learnerToday, addDays, weekdayIndex } from "../../utils/learnerDate";

// Activity heatmap: ~13 weeks × 7 grid of task completions + review events in
// the learner's time zone, plus a visually-hidden data table for accessibility.
const WEEKS = 13;
const LEVELS = [
  { max: 0, className: "bg-border/60", label: "No activity" },
  { max: 2, className: "bg-accent/25", label: "1–2 events" },
  { max: 5, className: "bg-accent/60", label: "3–5 events" },
  { max: Infinity, className: "bg-accent", label: "6+ events" },
];

function levelOf(count) {
  return LEVELS.find((l) => count <= l.max) ?? LEVELS[0];
}

export default function ActivityHeatmap({ heatmap, timezone }) {
  // Grid runs oldest → newest, aligned so the last column ends today (the
  // learner's today, not the device's).
  const byDay = new Map(heatmap.map((d) => [d.day, d.tasks + d.reviews]));
  const todayKey = learnerToday(timezone);
  const endOffset = 6 - weekdayIndex(todayKey); // pad to Saturday for full weeks
  const cells = [];
  for (let i = WEEKS * 7 - 1; i >= -endOffset; i--) {
    const key = addDays(todayKey, -i);
    cells.push({
      key,
      future: i < 0,
      count: byDay.get(key) ?? 0,
    });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const total = heatmap.reduce((s, d) => s + d.tasks + d.reviews, 0);
  const activeDays = heatmap.filter((d) => d.tasks + d.reviews > 0).length;

  return (
    <section aria-label="Activity heatmap">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-fg-muted">Activity</h2>
      <p className="mb-3 text-xs text-fg-muted">
        Task completions and flashcard review events — last {WEEKS} weeks.
      </p>

      <div className="overflow-x-auto pb-1">
        <div
          className="grid w-min grid-flow-col gap-1"
          role="img"
          aria-hidden="true"
          aria-label={`Activity heatmap: ${total} events across ${activeDays} active days in the last ${WEEKS} weeks.`}
        >
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-rows-7 gap-1">
              {week.map((cell) => {
                const level = levelOf(cell.count);
                return (
                  <span
                    key={cell.key}
                    title={`${cell.key}: ${cell.count} event${cell.count === 1 ? "" : "s"}`}
                    className={`h-3 w-3 rounded-sm ${
                      cell.future ? "opacity-0" : level.className
                    }`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 text-2xs text-fg-muted">
        <span>Less</span>
        {LEVELS.map((l) => (
          <span key={l.label} className={`h-3 w-3 rounded-sm ${l.className}`} />
        ))}
        <span>More</span>
      </div>

      {/* Accessible alternative */}
      <table className="sr-only">
        <caption>
          Activity by day: task completions and review events.
        </caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Events</th>
          </tr>
        </thead>
        <tbody>
          {heatmap.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.tasks + d.reviews}</td>
            </tr>
          ))}
          {heatmap.length === 0 && (
            <tr>
              <td colSpan={2}>No recorded activity in this period.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
