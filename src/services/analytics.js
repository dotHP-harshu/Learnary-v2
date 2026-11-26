// Progress analytics service. Aggregates metrics straight from source rows in the
// learner's saved time zone, so every number reconciles; offline reads fall back to the idb cache.

import supabase from "../supabase/supabase";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { learnerDayKey } from "../utils/learnerDate";
import { scopedKey, userCacheKey } from "../utils/idbCacheOwner";

const METRICS_CACHE = "progress:metrics";
const REVIEW_CACHE = "progress:weekly-review";
const WINDOW_DAYS = 91;

/** Aggregate the learner's activity into reconcilable metrics. */
export async function loadMetrics(userKey, timezone) {
  if (!userKey) return { data: null, error: null, offline: false };
  const metricsKey = userCacheKey(userKey, METRICS_CACHE);
  if (!navigator.onLine) {
    const cached = metricsKey ? await idbGet(metricsKey) : undefined;
    return { data: cached ?? null, error: null, offline: true };
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  const [tasksRes, reviewsRes, attemptsRes, overdueRes, roadmapsRes, dueRes] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("id, completed_at")
        .eq("user_id", userKey)
        .eq("completed", true)
        .gte("completed_at", since)
        .order("completed_at", { ascending: false })
        .limit(400),
      supabase
        .from("flashcard_review_logs")
        .select("id, reviewed_at")
        .eq("user_id", userKey)
        .gte("reviewed_at", since)
        .order("reviewed_at", { ascending: false })
        .limit(1000),
      supabase
        .from("quiz_attempts")
        .select("id, score, max_score, completed_at")
        .eq("user_id", userKey)
        .gte("completed_at", since)
        .order("completed_at", { ascending: false })
        .limit(100),
      supabase
        .from("tasks")
        .select("id, due_at")
        .eq("user_id", userKey)
        .eq("completed", false)
        .lt("due_at", new Date().toISOString())
        .limit(100),
      supabase
        .from("learning_roadmaps")
        .select("id, title, status, roadmap_steps ( id, status ), roadmap_stages ( roadmap_milestones ( id, status ) )")
        .eq("user_id", userKey)
        .in("status", ["active", "completed"])
        .limit(10),
      supabase
        .from("flashcards")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userKey)
        .eq("status", "active")
        .lte("next_review_at", new Date().toISOString()),
    ]);

  const firstError =
    tasksRes.error?.message ||
    reviewsRes.error?.message ||
    attemptsRes.error?.message ||
    overdueRes.error?.message ||
    roadmapsRes.error?.message ||
    dueRes.error?.message;
  if (firstError) {
    return { data: null, error: firstError, offline: false };
  }

  const metrics = buildMetrics({
    tasks: tasksRes.data ?? [],
    reviews: reviewsRes.data ?? [],
    attempts: attemptsRes.data ?? [],
    roadmaps: roadmapsRes.data ?? [],
    dueCards: dueRes.count ?? 0,
    timezone,
  });
  // Overdue tasks come straight from the source rows.
  metrics.overdue_tasks = overdueRes.data?.length ?? 0;

  if (metricsKey) await idbSet(metricsKey, metrics);
  return { data: metrics, error: null, offline: false };
}

/**
 * Pure metric builder — exported so it can be exercised directly by the
 * unit tests in tests/metrics.test.js; keep the function pure (no I/O).
 */
export function buildMetrics({ tasks, reviews, attempts, roadmaps, dueCards, timezone }) {
  const byDay = {}; // key → {tasks, reviews}

  const bump = (key, field) => {
    byDay[key] ??= { tasks: 0, reviews: 0 };
    byDay[key][field] += 1;
  };

  let tasksCompleted = 0;
  for (const t of tasks) {
    if (!t.completed_at) continue;
    tasksCompleted += 1;
    bump(learnerDayKey(t.completed_at, timezone), "tasks");
  }

  let cardsReviewed = 0;
  let lastActivityAt = null;
  for (const r of reviews) {
    cardsReviewed += 1;
    bump(learnerDayKey(r.reviewed_at, timezone), "reviews");
    if (!lastActivityAt || r.reviewed_at > lastActivityAt) lastActivityAt = r.reviewed_at;
  }
  for (const t of tasks) {
    if (!t.completed_at) continue;
    if (!lastActivityAt || t.completed_at > lastActivityAt) lastActivityAt = t.completed_at;
  }

  const activeDays = Object.keys(byDay).length;

  // Quiz trend (learner tz), oldest → newest. A legacy row can carry a null
  // score or a non-positive max_score, so the percentage is clamped/guarded
  // rather than producing NaN or a 900% bar.
  const pct = (a) => {
    // `Number(null)` is 0, so check for absent values explicitly — a legacy
    // row with a null score must be excluded, not counted as a zero.
    if (a?.score == null || a?.max_score == null) return null;
    const score = Number(a.score);
    const max = Number(a.max_score);
    if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((score / max) * 100)));
  };
  const quizByDay = {};
  for (const a of attempts) {
    const key = learnerDayKey(a.completed_at, timezone);
    (quizByDay[key] ??= []).push(pct(a));
  }
  const scored = attempts.map(pct).filter((v) => v != null);
  const avgQuizScore = scored.length
    ? Math.round(scored.reduce((sum, v) => sum + v, 0) / scored.length)
    : null;

  // Roadmap progress: skipped steps are explicitly excluded from the
  // eligible set (rule shown in the UI).
  const roadmapsProgress = (roadmaps ?? []).map((r) => {
    const steps = r.roadmap_steps ?? [];
    const eligible = steps.filter((s) => s.status !== "skipped");
    const completed = eligible.filter((s) => s.status === "completed");
    const milestones = (r.roadmap_stages ?? []).flatMap(
      (st) => st.roadmap_milestones ?? []
    );
    const milestonesCompleted = milestones.filter((m) => m.status === "completed").length;
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      steps_completed: completed.length,
      steps_eligible: eligible.length,
      steps_skipped: steps.filter((s) => s.status === "skipped").length,
      milestones_completed: milestonesCompleted,
      milestones_total: milestones.length,
      percent: eligible.length
        ? Math.round((completed.length / eligible.length) * 100)
        : 0,
    };
  });

  const inactiveDays = lastActivityAt
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / 86_400_000)
      )
    : null;

  return {
    window_days: WINDOW_DAYS - 1,
    tasks_completed: tasksCompleted,
    cards_reviewed: cardsReviewed,
    active_days: activeDays,
    quiz_attempts: attempts.length,
    avg_quiz_score: avgQuizScore,
    due_cards: dueCards ?? 0,
    overdue_tasks: 0, // stamped by loadMetrics from the source rows
    roadmap_progress: roadmapsProgress,
    inactive_days: inactiveDays,
    heatmap: Object.entries(byDay).map(([key, v]) => ({ day: key, ...v })),
    quiz_trend: Object.entries(quizByDay)
      .map(([day, scores]) => ({
        day,
        attempts: scores.length,
        avg_score: scores.some((s) => s != null)
          ? Math.round(
              scores.reduce((sum, s) => sum + (s ?? 0), 0) /
                scores.filter((s) => s != null).length
            )
          : null,
      }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}

// ---- weekly review cache (display-only; no DB table) ---------------------------

export async function cacheWeeklyReview(review) {
  const key = scopedKey(REVIEW_CACHE);
  if (key) await idbSet(key, review);
}

export async function loadCachedWeeklyReview() {
  const key = scopedKey(REVIEW_CACHE);
  return key ? idbGet(key) : undefined;
}
