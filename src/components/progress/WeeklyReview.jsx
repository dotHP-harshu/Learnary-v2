"use client";

import { useContext, useEffect, useRef, useState } from "react";
import UserContext from "../../context/userContext";
import { useToast } from "../ui/Toast";
import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";
import Skeleton from "../ui/Skeleton";
import Card from "../ui/Card";
import {
  callAI,
  describeAIError,
  ackAIRequest,
} from "../../services/ai/aiClient";
import {
  cacheWeeklyReview,
  loadCachedWeeklyReview,
} from "../../services/analytics";
import { getUserKey } from "../../utils/getUserKey";
import useOnlineStatus from "../../hooks/useOnlineStatus";
import useAIResume from "../../hooks/useAIResume";
import useMountedRef from "../../hooks/useMountedRef";
import { Sparkles, TriangleAlert } from "lucide-react";

// On-demand weekly review: the user triggers it — never automatic. The metrics
// sent are shown as evidence beside the summary, which cites only those numbers.
export default function WeeklyReview({ metrics, timezone }) {
  const { user } = useContext(UserContext);
  const toast = useToast();
  const [review, setReview] = useState(null); // {review, metrics, generatedAt}
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const online = useOnlineStatus();
  const userKey = getUserKey(user);
  const mountedRef = useMountedRef();
  const generationToken = useRef(0);
  const resumeScope = "weekly";

  useEffect(() => {
    let active = true;
    loadCachedWeeklyReview().then((cached) => {
      if (active) {
        setReview(cached ?? null);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Recover a generation that outlived this component (tab switch, reload,
  // PWA backgrounding). A cached review may already be visible; the recovered
  // result replaces it when it arrives.
  useAIResume("generate_weekly_review", resumeScope, {
    enabled: Boolean(userKey) && !loading,
    userKey,
    onPendingChange: setGenerating,
    onSucceeded: ({ data, requestId }) => {
      // An unusable succeeded payload must not be replayed on every mount.
      if (!data?.review) {
        ackAIRequest("generate_weekly_review", resumeScope, userKey, requestId);
        return;
      }
      generationToken.current += 1;
      const payload = {
        review: data.review,
        metrics: data.metrics ?? null,
        generatedAt: new Date().toISOString(),
      };
      setReview(payload);
      cacheWeeklyReview(payload);
      ackAIRequest("generate_weekly_review", resumeScope, userKey, requestId);
    },
    onFailed: ({ code }) => toast.error(describeAIError(code)),
  });

  const generate = async () => {
    if (generating || !metrics) return;
    const token = ++generationToken.current;
    setGenerating(true);
    // The exact metrics sent with the request, displayed as evidence beside
    // the summary.
    const metricsPayload = {
      tasks_completed: metrics.tasks_completed,
      active_days: metrics.active_days,
      cards_reviewed: metrics.cards_reviewed,
      due_cards: metrics.due_cards,
      quiz_attempts: metrics.quiz_attempts,
      avg_quiz_score: metrics.avg_quiz_score,
      roadmap_steps_completed: metrics.roadmap_progress.reduce(
        (s, r) => s + r.steps_completed,
        0
      ),
      milestones_completed: metrics.roadmap_progress.reduce(
        (s, r) => s + r.milestones_completed,
        0
      ),
      overdue_tasks: metrics.overdue_tasks,
      inactive_days: metrics.inactive_days ?? 0,
    };
    const result = await callAI("generate_weekly_review", {
      input: { period_days: 7, timezone, metrics: metricsPayload },
      resumeScope,
    });
    // Unmounted mid-request: keep the handle so the next mount can recover it.
    if (!mountedRef.current) return;
    if (generationToken.current !== token) {
      setGenerating(false);
      return;
    }
    setGenerating(false);
    if (!result.ok) {
      toast.error(describeAIError(result.code, result.message));
      return;
    }
    if (!result.data?.review) {
      toast.error("Generation returned an empty review. Please try again.");
      return;
    }
    const payload = {
      review: result.data.review,
      metrics: result.data.metrics ?? metricsPayload,
      generatedAt: new Date().toISOString(),
    };
    setReview(payload);
    cacheWeeklyReview(payload);
    ackAIRequest("generate_weekly_review", resumeScope, userKey, result.requestId);
  };

  return (
    <section aria-label="Weekly review">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-muted">Weekly review</h2>
        <Button
          size="sm"
          onClick={generate}
          loading={generating}
          disabled={!metrics || !online || !userKey}
        >
          <Sparkles size={14} aria-hidden />
          {review ? "Regenerate" : "Generate weekly review"}
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : !review ? (
        <EmptyState
          icon={Sparkles}
          title="No weekly review yet"
          description="Generate one any time — it summarizes your last 7 days from the metrics shown on this page. Never automatic, never on a schedule."
        />
      ) : (
        <Card className="p-4">
          <p className="text-2xs text-fg-muted">
            Generated · {new Date(review.generatedAt).toLocaleString()} ·
            based only on the metrics sent with the request
          </p>
          {review.metrics && (
            <p className="mt-1.5 text-2xs text-fg-muted">
              Evidence: {review.metrics.tasks_completed} tasks completed ·{" "}
              {review.metrics.active_days} active days ·{" "}
              {review.metrics.cards_reviewed} cards reviewed ·{" "}
              {review.metrics.quiz_attempts} quizzes
              {review.metrics.avg_quiz_score != null
                ? ` (avg ${review.metrics.avg_quiz_score}%)`
                : ""}{" "}
              · {review.metrics.roadmap_steps_completed} roadmap steps ·{" "}
              {review.metrics.overdue_tasks} overdue
            </p>
          )}
          <p className="mt-2 text-sm leading-relaxed text-fg">
            {review.review.summary}
          </p>
          {review.review.highlights?.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {review.review.highlights.map((h, i) => (
                <li key={i} className="text-sm text-fg">
                  · {h}
                </li>
              ))}
            </ul>
          )}
          {review.review.focus_areas?.length > 0 && (
            <div className="mt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Focus areas (with evidence)
              </h3>
              <ul className="mt-1 flex flex-col gap-1.5">
                {review.review.focus_areas.map((f, i) => (
                  <li key={i} className="text-sm text-fg">
                    <span className="font-medium">{f.area}</span>
                    <span className="block text-xs text-fg-muted">
                      evidence: {f.evidence}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review.review.next_steps?.length > 0 && (
            <div className="mt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Next steps
              </h3>
              <ul className="mt-1 flex flex-col gap-1">
                {review.review.next_steps.map((s, i) => (
                  <li key={i} className="text-sm text-fg">
                    {i + 1}. {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review.review.restart_note && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-2.5 text-sm text-warning">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              {review.review.restart_note}
            </p>
          )}
          <p className="mt-3 text-2xs text-fg-muted">
            A review of activity — not a measure of mastery.
          </p>
        </Card>
      )}

      {!online && (
        <p className="mt-2 text-xs text-fg-muted">
          You're offline — the weekly review needs a connection, but your cached
          review is shown above.
        </p>
      )}
    </section>
  );
}
