"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import EmptyState from "../ui/EmptyState";
import Skeleton from "../ui/Skeleton";
import Input from "../ui/Input";
import Textarea from "../ui/Textarea";
import Select from "../ui/Select";
import Chip from "../ui/Chip";
import ErrorState from "../ui/ErrorState";
import Modal from "../ui/Modal";
import {
  generateQuiz,
  listQuizzes,
  deleteQuiz,
  getQuizForAttempt,
  listAttempts,
  submitQuizAttempt,
  describeAIError,
} from "../../services/practice";
import { ackAIRequest, RETRYABLE_AI_CODES } from "../../services/ai/aiClient";
import { quizAttemptScope } from "../../utils/aiScopes";
import {
  ListChecks,
  Sparkles,
  Trash2,
} from "lucide-react";
import useOnlineStatus from "../../hooks/useOnlineStatus";
import useAIResume from "../../hooks/useAIResume";
import useMountedRef from "../../hooks/useMountedRef";

// Quiz studio: generate from topic/notes/task context, list recent quizzes,
// take (runner), delete. Generation is online-only and says so.
export default function QuizStudio({ userKey, toast }) {
  const [quizzes, setQuizzes] = useState(null); // null = loading
  const [listError, setListError] = useState(null);
  const [form, setForm] = useState({
    topic: "",
    notes: "",
    question_count: 6,
    difficulty: "mixed",
  });
  const [generating, setGenerating] = useState(false);
  const [lastRequest, setLastRequest] = useState(null); // source of the last generated quiz
  const [activeQuizId, setActiveQuizId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const online = useOnlineStatus();
  const mountedRef = useMountedRef();
  const generationToken = useRef(0);
  const resumeScope = "quiz";

  const loadQuizzes = useCallback(async () => {
    setListError(null);
    const { data, error, offline } = await listQuizzes();
    if (error) {
      setListError(`Couldn't load quizzes. ${error}`);
      return;
    }
    setQuizzes(data);
    if (offline) {
      toast.info("You're offline — showing cached quizzes (read-only).");
    }
  }, [toast]);

  useEffect(() => {
    if (userKey) loadQuizzes();
  }, [userKey, loadQuizzes]);

  // Recover a generation that outlived this component (tab switch, reload,
  // PWA backgrounding). The quiz row is already saved server-side; the stored
  // result reference reopens it without a second model call.
  useAIResume("generate_quiz", resumeScope, {
    // Don't yank the learner out of a quiz they opened while a generation
    // finishes; the handle stays until they return to the studio.
    enabled: Boolean(userKey) && !activeQuizId,
    userKey,
    onPendingChange: setGenerating,
    onSucceeded: async ({ resultRef, requestId }) => {
      generationToken.current += 1;
      await loadQuizzes();
      if (!mountedRef.current) return;
      if (resultRef) setActiveQuizId(resultRef);
      ackAIRequest("generate_quiz", resumeScope, userKey, requestId);
    },
    onFailed: ({ code }) => toast.error(describeAIError(code)),
  });

  const handleGenerate = async (event, source) => {
    event?.preventDefault?.();
    // "Retry with a fresh quiz" reuses the request that produced the current
    // quiz instead of the (cleared) form fields.
    const request = source ?? {
      topic: form.topic.trim(),
      notes: form.notes.trim(),
      question_count: form.question_count,
      difficulty: form.difficulty,
    };
    if (generating || (!request.topic && !request.notes)) return;
    const token = ++generationToken.current;
    setGenerating(true);
    const result = await generateQuiz(
      {
        topic: request.topic || undefined,
        notes: request.notes || undefined,
        question_count: request.question_count,
        difficulty: request.difficulty,
      },
      { resumeScope }
    );
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
    if (!result.data?.quiz_id) {
      toast.error("Generation returned an empty quiz. Please try again.");
      return;
    }
    toast.success(`Quiz saved: ${result.data.title}`);
    setLastRequest(request);
    setForm((f) => ({ ...f, topic: "", notes: "" }));
    await loadQuizzes();
    if (!mountedRef.current || generationToken.current !== token) return;
    setActiveQuizId(result.data.quiz_id);
    ackAIRequest("generate_quiz", resumeScope, userKey, result.requestId);
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const { error } = await deleteQuiz(deleteTarget.id);
    setDeleting(false);
    if (error) {
      toast.error(`Couldn't delete. ${error}`);
      return;
    }
    if (activeQuizId === deleteTarget.id) setActiveQuizId(null);
    setDeleteTarget(null);
    toast.success("Quiz deleted.");
    loadQuizzes();
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Generate form */}
      <form
        onSubmit={handleGenerate}
        className="rounded-xl border border-border bg-surface p-4"
      >
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={15} className="text-accent" aria-hidden />
          <h2 className="text-sm font-semibold text-fg">Generate a quiz</h2>
        </div>
        <div className="flex flex-col gap-3">
          <Input
            aria-label="Topic or notes source"
            value={form.topic}
            onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
            placeholder="Topic (e.g. JavaScript closures)"
            maxLength={200}
          />
          <Textarea
            aria-label="Notes to quiz yourself on"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Or paste your own notes to quiz yourself on (max 2000 chars)"
            maxLength={2000}
          />
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-24">
              <Select
                label="Questions"
                value={form.question_count}
                onChange={(e) =>
                  setForm((f) => ({ ...f, question_count: Number(e.target.value) }))
                }
              >
                {[3, 5, 6, 8, 10, 12].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-full sm:w-36">
              <Select
                label="Difficulty"
                value={form.difficulty}
                onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))}
              >
                {["mixed", "beginner", "intermediate", "advanced"].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              type="submit"
              loading={generating}
              disabled={!online || (!form.topic.trim() && !form.notes.trim())}
              className="w-full sm:ml-auto sm:w-auto"
            >
              Generate quiz
            </Button>
          </div>
          <p className="text-2xs text-fg-muted">
            Generation needs an internet connection. Answers are checked
            after you submit — not before.
          </p>
        </div>
      </form>

      {/* Runner */}
      {activeQuizId && (
        <QuizRunner
          quizId={activeQuizId}
          toast={toast}
          userKey={userKey}
          onGenerateFresh={() => handleGenerate(null, lastRequest)}
          canGenerateFresh={Boolean(lastRequest) && !generating && online}
        />
      )}

      {/* Recent quizzes */}
      <section aria-label="Recent quizzes">
        <h2 className="mb-2 text-sm font-semibold text-fg">Recent quizzes</h2>
        {quizzes === null && !listError ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : listError ? (
          <ErrorState title="" message={listError} onRetry={loadQuizzes} retryLabel="Retry" />
        ) : quizzes.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No quizzes yet"
            description="Generate your first quiz from a topic or your own notes."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {quizzes.map((quiz) => (
              <li
                key={quiz.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5"
              >
                <button
                  type="button"
                  onClick={() => setActiveQuizId(quiz.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm text-fg">{quiz.title}</span>
                  <span className="text-2xs text-fg-muted">
                    {quiz.source === "ai" ? "Auto-generated" : "manual"} ·{" "}
                    {new Date(quiz.created_at).toLocaleDateString()}
                  </span>
                </button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setActiveQuizId(quiz.id)}
                  disabled={!online}
                >
                  Take quiz
                </Button>
                <IconButton
                  label={`Delete quiz: ${quiz.title}`}
                  size="sm"
                  onClick={() => setDeleteTarget(quiz)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title="Delete quiz?"
      >
        <p className="text-sm text-fg-muted">
          “{deleteTarget?.title}” and its questions and past attempts will be
          permanently removed. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => setDeleteTarget(null)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={deleting}>
            Delete quiz
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ---- runner -------------------------------------------------------------------

function QuizRunner({ quizId, toast, userKey, onGenerateFresh, canGenerateFresh }) {
  const [quiz, setQuiz] = useState(null); // sanitized content
  const [loadError, setLoadError] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [attempts, setAttempts] = useState([]);

  const online = useOnlineStatus();
  const attemptScope = quizAttemptScope(quizId);

  const loadQuiz = useCallback(async () => {
    setLoadError(null);
    setResult(null);
    setAnswers({});
    const { data, error } = await getQuizForAttempt(quizId);
    if (error) {
      setLoadError(error);
      return false;
    }
    setQuiz(data);
    return true;
  }, [quizId]);

  const refreshAttempts = useCallback(async () => {
    const history = await listAttempts(quizId);
    setAttempts(history.data ?? []);
  }, [quizId]);

  // Recover a submission whose response was lost. The server scores
  // idempotently by request id, so recovery never creates a second attempt
  // (and never charges short-answer quota twice).
  useAIResume("submit_quiz_attempt", attemptScope, {
    enabled: Boolean(userKey && attemptScope && quiz),
    userKey,
    onPendingChange: setSubmitting,
    onSucceeded: ({ data, requestId, scope }) => {
      setSubmitting(false);
      if (!data) {
        ackAIRequest("submit_quiz_attempt", scope, userKey, requestId);
        return;
      }
      setResult(data);
      ackAIRequest("submit_quiz_attempt", scope, userKey, requestId);
      refreshAttempts();
    },
    onFailed: ({ code }) => {
      setSubmitting(false);
      toast.error(describeAIError(code));
    },
    onMissing: () => setSubmitting(false),
  });

  // Initial/quiz-switch load: resets the answer sheet, then loads history.
  const load = useCallback(async () => {
    const loaded = await loadQuiz();
    if (loaded) await refreshAttempts();
  }, [loadQuiz, refreshAttempts]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (submitting || !quiz) return;
    setSubmitting(true);
    const payload = quiz.content.questions.map((q) => ({
      index: q.index,
      value: answers[q.index] ?? null,
    }));
    const result = await submitQuizAttempt(quizId, payload, {
      resumeScope: attemptScope,
    });
    if (!result.ok) {
      if (RETRYABLE_AI_CODES.has(result.code)) {
        // The attempt may already be scored; keep the composer busy and let
        // the recovery hook surface the result instead of double-submitting.
        setSubmitting(true);
        return;
      }
      setSubmitting(false);
      toast.error(describeAIError(result.code, result.message), {
        action: { label: "Retry", onClick: submit },
      });
      return;
    }
    setSubmitting(false);
    setResult(result.data);
    ackAIRequest(
      "submit_quiz_attempt",
      attemptScope,
      userKey,
      result.requestId
    );
    // Refresh history only — reloading the quiz would clear the result view.
    refreshAttempts();
  };

  if (loadError) {
    return <ErrorState title="" message={loadError} onRetry={load} retryLabel="Retry" />;
  }

  if (!quiz) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4" aria-busy="true">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-16 rounded-lg" />
      </div>
    );
  }

  // Results view
  if (result) {
    const pct =
      result.max_score > 0
        ? Math.round((Number(result.score) / result.max_score) * 100)
        : 0;
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-fg">{quiz.title} — result</h2>
          <span className="text-sm font-semibold text-accent">
            {Number(result.score)} / {result.max_score} ({pct}%)
          </span>
        </div>
        <p className="mb-3 text-2xs text-fg-muted">
          {result.evaluation_type === "ai_assisted"
            ? "Short answers received a model-assisted assessment — you can retry. "
            : ""}
          Score is an indicator for this attempt, not proof of mastery.
        </p>
        <ul className="flex flex-col gap-2.5">
          {result.feedback.map((f) => (
            <li key={f.index} className="rounded-lg border border-border bg-surface-muted p-3">
              <div className="flex items-center gap-2">
                <Chip
                  tone={
                    f.verdict === "correct"
                      ? "success"
                      : f.verdict === "partial"
                        ? "warning"
                        : "error"
                  }
                >
                  {f.verdict}
                </Chip>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">
                  {f.given ? String(f.given) : "(no answer)"}
                </span>
              </div>
              {f.type === "mcq" && (
                <p className="mt-1.5 text-xs text-fg-muted">
                  Correct answer: <span className="text-fg">{f.expected}</span>
                </p>
              )}
              {f.explanation && (
                <p className="mt-1 text-sm text-fg">{f.explanation}</p>
              )}
              {f.concept && (
                <p className="mt-1 text-2xs text-fg-muted">
                  Concept to revise: {f.concept}
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setResult(null);
              setAnswers({});
            }}
          >
            Retake this quiz
          </Button>
          {onGenerateFresh && (
            <Button onClick={onGenerateFresh} disabled={!canGenerateFresh || !online}>
              Retry with a fresh quiz
            </Button>
          )}
        </div>
        {attempts.length > 0 && (
          <p className="mt-2 text-2xs text-fg-muted">
            {attempts.length} attempt{attempts.length > 1 ? "s" : ""} recorded —
            history is never overwritten.
          </p>
        )}
      </div>
    );
  }

  // Question view (no answer keys)
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">{quiz.title}</h2>
        <span className="text-2xs text-fg-muted">
          {quiz.content.questions.length} questions
        </span>
      </div>
      <ol className="flex flex-col gap-4">
        {quiz.content.questions.map((q) => (
          <li key={q.index}>
            <fieldset>
              <legend className="mb-1.5 text-sm text-fg">
                {q.prompt}
                <span className="ml-2 text-2xs text-fg-muted">
                  {q.type === "mcq" ? "choose one" : "short answer"}
                </span>
              </legend>
              {q.type === "mcq" ? (
                <div className="flex flex-col gap-1.5">
                  {q.options.map((option) => (
                    <label
                      key={option}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-fg transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                    >
                      <input
                        type="radio"
                        name={`q-${q.index}`}
                        value={option}
                        checked={answers[q.index] === option}
                        onChange={() => setAnswers((a) => ({ ...a, [q.index]: option }))}
                        className="accent-accent"
                      />
                      {option}
                    </label>
                  ))}
                </div>
              ) : (
                <Textarea
                  aria-label={`Your answer to question ${q.index + 1}`}
                  rows={2}
                  value={answers[q.index] ?? ""}
                  onChange={(e) =>
                    setAnswers((a) => ({ ...a, [q.index]: e.target.value }))
                  }
                  placeholder="Your answer…"
                  maxLength={500}
                />
              )}
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="mt-4">
        <Button onClick={submit} loading={submitting} disabled={!online}>
          Submit answers
        </Button>
        <p className="mt-1.5 text-2xs text-fg-muted">
          MCQ answers are scored on the server; short answers are evaluated
          with model assistance. You can retake or generate a fresh quiz
          anytime — past attempts are kept.
        </p>
      </div>
    </div>
  );
}
