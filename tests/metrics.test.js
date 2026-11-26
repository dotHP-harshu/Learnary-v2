import { describe, expect, it } from "vitest";
import { buildMetrics } from "../src/services/analytics.js";

// Pure aggregation: no Supabase, no IndexedDB, no clock except for
// inactive_days. Time zone is pinned to UTC so the buckets are deterministic.

const metricsFor = (overrides = {}) =>
  buildMetrics({
    tasks: [
      { id: "t1", completed_at: "2026-11-20T10:00:00Z" },
      { id: "t2", completed_at: "2026-11-20T23:30:00Z" },
      { id: "t3", completed_at: null },
    ],
    reviews: [{ id: "r1", reviewed_at: "2026-11-21T01:00:00Z" }],
    attempts: [],
    roadmaps: [],
    dueCards: 0,
    timezone: "UTC",
    ...overrides,
  });

describe("buildMetrics", () => {
  it("counts completed tasks and reviews", () => {
    const m = metricsFor();
    expect(m.tasks_completed).toBe(2);
    expect(m.cards_reviewed).toBe(1);
    expect(m.window_days).toBe(90);
  });

  it("counts one active day per distinct learner day", () => {
    const m = metricsFor();
    expect(m.active_days).toBe(2);
    expect(m.heatmap).toEqual(
      expect.arrayContaining([
        { day: "2026-11-20", tasks: 2, reviews: 0 },
        { day: "2026-11-21", tasks: 0, reviews: 1 },
      ])
    );
  });

  it("buckets by the learner's time zone, not UTC", () => {
    const m = metricsFor({ timezone: "Asia/Tokyo" });
    // 2026-11-20T23:30Z is already 2026-11-21 in Tokyo.
    expect(m.active_days).toBe(2);
    expect(m.heatmap).toEqual(
      expect.arrayContaining([
        { day: "2026-11-20", tasks: 1, reviews: 0 },
        { day: "2026-11-21", tasks: 1, reviews: 1 },
      ])
    );
  });

  it("averages only scoreable attempts and ignores bad legacy rows", () => {
    const m = metricsFor({
      attempts: [
        { id: "a1", score: 4, max_score: 5, completed_at: "2026-11-20T12:00:00Z" }, // 80
        { id: "a2", score: null, max_score: 5, completed_at: "2026-11-20T12:05:00Z" }, // null
        { id: "a3", score: 2, max_score: 0, completed_at: "2026-11-21T12:00:00Z" }, // null
        { id: "a4", score: 999, max_score: 10, completed_at: "2026-11-21T12:30:00Z" }, // clamped to 100
      ],
    });

    expect(m.quiz_attempts).toBe(4);
    expect(m.avg_quiz_score).toBe(90); // (80 + 100) / 2
    expect(m.quiz_trend).toEqual([
      { day: "2026-11-20", attempts: 2, avg_score: 80 },
      { day: "2026-11-21", attempts: 2, avg_score: 100 },
    ]);
  });

  it("reports no quiz average when nothing is scoreable", () => {
    const m = metricsFor({
      attempts: [{ id: "a1", score: null, max_score: 0, completed_at: "2026-11-20T12:00:00Z" }],
    });
    expect(m.quiz_attempts).toBe(1);
    expect(m.avg_quiz_score).toBe(null);
    expect(m.quiz_trend[0].avg_score).toBe(null);
  });

  it("excludes skipped roadmap steps from eligible progress", () => {
    const m = metricsFor({
      roadmaps: [
        {
          id: "rm1",
          title: "TypeScript",
          status: "active",
          roadmap_steps: [
            { status: "completed" },
            { status: "skipped" },
            { status: "pending" },
          ],
          roadmap_stages: [
            {
              roadmap_milestones: [{ status: "completed" }, { status: "not_started" }],
            },
          ],
        },
      ],
    });

    expect(m.roadmap_progress).toEqual([
      {
        id: "rm1",
        title: "TypeScript",
        status: "active",
        steps_completed: 1,
        steps_eligible: 2,
        steps_skipped: 1,
        milestones_completed: 1,
        milestones_total: 2,
        percent: 50,
      },
    ]);
  });

  it("reports zero percent for a roadmap whose steps are all skipped", () => {
    const m = metricsFor({
      roadmaps: [
        {
          id: "rm1",
          title: "Empty",
          status: "draft",
          roadmap_steps: [{ status: "skipped" }],
          roadmap_stages: [],
        },
      ],
    });
    expect(m.roadmap_progress[0]).toMatchObject({ steps_eligible: 0, percent: 0 });
  });

  it("returns an ISO-derived last-activity gap or null when there is none", () => {
    const withActivity = metricsFor();
    expect(Number.isInteger(withActivity.inactive_days)).toBe(true);
    expect(withActivity.inactive_days).toBeGreaterThanOrEqual(0);

    const empty = buildMetrics({
      tasks: [],
      reviews: [],
      attempts: [],
      roadmaps: [],
      dueCards: 0,
      timezone: "UTC",
    });
    expect(empty.inactive_days).toBe(null);
    expect(empty.active_days).toBe(0);
    expect(empty.avg_quiz_score).toBe(null);
  });

  it("passes due cards through", () => {
    expect(metricsFor({ dueCards: 7 }).due_cards).toBe(7);
  });
});
