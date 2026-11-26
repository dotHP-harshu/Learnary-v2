"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import Skeleton from "../ui/Skeleton";
import EmptyState from "../ui/EmptyState";
import ErrorState from "../ui/ErrorState";
import { useToast } from "../ui/Toast";
import { listDueCards, reviewCard, describeAIError } from "../../services/practice";
import { ALGORITHM } from "../../utils/spacedRepetition";
import { CheckCircle2, Eye, X } from "lucide-react";

const RATINGS = [
  { value: "again", label: "Again" },
  { value: "hard", label: "Hard" },
  { value: "good", label: "Good" },
  { value: "easy", label: "Easy" },
];

// Review session: due cards one at a time, back revealed only on user action,
// four-point recall rating, every review logged. Reviews are plain DB writes (works offline).
export default function ReviewSession({ userKey, onDone, onExit }) {
  const toast = useToast();
  const [queue, setQueue] = useState(null); // null = loading
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [rating, setRating] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [error, setError] = useState(null);
  const shownAt = useRef(null);

  const load = useCallback(async () => {
    setError(null);
    // Serve the whole due queue, not a page of it: a 20-cap made every 21st+
    // due card unreachable from the session. 200 is far beyond any real
    // backlog (each review reschedules its card out of the queue), so the
    // "Card X of N" counter matches the true queue.
    const { data, error: loadError, offline } = await listDueCards(200);
    if (loadError) {
      setError(`Couldn't load your review queue. ${loadError}`);
      return;
    }
    setQueue(data);
    if (offline) {
      toast.info("You're offline — reviews need a connection.");
    }
  }, [toast]);

  useEffect(() => {
    if (userKey) load();
  }, [userKey, load]);

  // Per-card timer: elapsed_ms must cover the current card, not the whole
  // session (the old once-per-load timestamp inflated every card after the
  // first). Reset whenever the queue or the position changes.
  useEffect(() => {
    shownAt.current = Date.now();
  }, [queue, position]);

  const current = queue?.[position] ?? null;
  const finished = queue !== null && position >= queue.length;

  const handleRate = async (value, retryActionId) => {
    if (rating || !current) return;
    setRating(true);
    // One UUID per user action; reused on retry so a lost response can't
    // double-record the same rating.
    const actionId = retryActionId ?? crypto.randomUUID();
    const elapsedMs = shownAt.current ? Date.now() - shownAt.current : null;
    const { error: reviewError, data } = await reviewCard(
      userKey,
      current,
      value,
      elapsedMs,
      actionId
    );
    setRating(false);
    if (reviewError) {
      toast.error(describeAIError("INTERNAL_ERROR", reviewError), {
        action: { label: "Retry", onClick: () => handleRate(value, actionId) },
      });
      return;
    }
    // A replay (retry after a lost response) counts as success; the RPC
    // returned the already-committed card state.
    if (data?.replay) toast.info("Review already saved.");
    setReviewedCount((n) => n + 1);
    setRevealed(false);
    setPosition((p) => p + 1);
  };

  if (queue === null && !error) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4" aria-busy="true">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-28 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorState title="" message={error} onRetry={load} retryLabel="Retry" />;
  }

  if (queue.length === 0) {
    return (
      <div>
        <EmptyState
          icon={CheckCircle2}
          title="All caught up"
          description="No cards are due right now. New cards join the queue after their first review."
        />
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" onClick={onExit}>
            Back to practice
          </Button>
        </div>
      </div>
    );
  }

  if (finished) {
    return (
      <div>
        <EmptyState
          icon={CheckCircle2}
          title="Session complete"
          description={`${reviewedCount} card${reviewedCount === 1 ? "" : "s"} reviewed. The next due dates were scheduled with ${ALGORITHM.version}.`}
        />
        <div className="mt-3 flex justify-center">
          <Button onClick={onDone}>Back to practice</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm text-fg-muted">
          Card {position + 1} of {queue.length}
        </span>
        <Button variant="ghost" size="sm" onClick={onExit}>
          <X size={13} aria-hidden /> End session
        </Button>
      </div>

      <div
        className="flex min-h-40 flex-col items-center justify-center gap-4 rounded-lg border border-border bg-surface-muted p-6 text-center"
        aria-live="polite"
      >
        <p className="text-base text-fg">{current.front}</p>
        {revealed ? (
          <>
            <p className="text-base font-medium text-fg">{current.back}</p>
            {current.explanation && (
              <p className="text-sm text-fg-muted">{current.explanation}</p>
            )}
          </>
        ) : (
          <Button onClick={() => setRevealed(true)}>
            <Eye size={15} aria-hidden /> Reveal answer
          </Button>
        )}
      </div>

      {revealed && (
        <div className="mt-3">
          <p className="mb-1.5 text-center text-xs text-fg-muted">
            How well did you recall it?
          </p>
          <div className="grid grid-cols-4 gap-2">
            {RATINGS.map((r) => (
              <Button
                key={r.value}
                variant="secondary"
                disabled={Boolean(rating)}
                onClick={() => handleRate(r.value)}
                className="w-full"
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
