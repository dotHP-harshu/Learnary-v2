"use client";

import { useState } from "react";
import supabase from "../../supabase/supabase";
import {
  callAI,
  ackAIRequest,
  describeAIError,
  RETRYABLE_AI_CODES,
} from "../../services/ai/aiClient";
import useAIResume from "../../hooks/useAIResume";
import { buildTaskAssistPayload } from "../../utils/taskAssistPayload";
import { taskScope } from "../../utils/aiScopes";
import ContextUsed from "../ui/ContextUsed";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Input from "../ui/Input";
import ErrorState from "../ui/ErrorState";
import Markdown from "../ui/Markdown";
import { useToast } from "../ui/Toast";
import {
  Sparkles,
  ListTree,
  BookOpen,
  Lightbulb,
  Dumbbell,
} from "lucide-react";

// Assist for one task: break-down results are drafts confirmed before anything
// is created; explain/hint/practice are read-only; outages never block manual work.

const ACTIONS = [
  { key: "break_down_task", label: "Break down", Icon: ListTree, cost: 2 },
  { key: "explain_task", label: "Explain", Icon: BookOpen, cost: 1 },
  { key: "give_hint", label: "Hints", Icon: Lightbulb, cost: 1 },
  { key: "generate_practice", label: "Practice", Icon: Dumbbell, cost: 2 },
];

const PRIORITY_LABELS = { low: "Low", medium: "Medium", high: "High" };

// Stable list: useAIResume subscribes to all four actions sharing one scope.
const TASK_ASSIST_ACTIONS = ACTIONS.map(({ key }) => key);

export default function TaskAssist({ task, collectionId, collectionTitle, open, onClose, userKey, onCreated }) {
  const toast = useToast();
  const [active, setActive] = useState(null); // action key
  const [result, setResult] = useState(null);
  const [contextUsed, setContextUsed] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const [errorState, setErrorState] = useState(null);
  const [recovering, setRecovering] = useState(false);

  const scope = task?.id ? taskScope(task.id) : null;

  const applyResult = (actionKey, data) => {
    setActive(actionKey);
    setErrorState(null);
    setContextUsed(Array.isArray(data?.context_used) ? data.context_used : null);
    if (actionKey === "break_down_task") {
      const children = data?.breakdown?.child_tasks ?? [];
      setResult(children);
      setSelected(new Set(children.map((_, i) => i)));
    } else if (actionKey === "explain_task") {
      setResult(data?.explanation ?? null);
    } else if (actionKey === "give_hint") {
      setResult(data?.hints?.hints ?? []);
    } else {
      setResult(data?.practice ?? null);
    }
  };

  // Recover an assist result that outlived this modal (tab switch, reload,
  // navigation, frozen tab). The scope is the task; the four actions share it.
  useAIResume(TASK_ASSIST_ACTIONS, scope, {
    enabled: Boolean(open && userKey && scope),
    userKey,
    onPendingChange: setRecovering,
    onSucceeded: ({ action, data, requestId }) => {
      setRecovering(false);
      if (!data) {
        ackAIRequest(action, scope, userKey, requestId);
        return;
      }
      applyResult(action, data);
      ackAIRequest(action, scope, userKey, requestId);
    },
    onFailed: ({ code }) => {
      setRecovering(false);
      setErrorState(describeAIError(code));
    },
    onMissing: () => setRecovering(false),
  });

  const run = async (actionKey) => {
    if (!scope) return;
    setActive(actionKey);
    setResult(null);
    setContextUsed(null);
    setErrorState(null);
    setSelected(new Set());
    setRecovering(false);
    let response;
    try {
      response = await callAI(
        actionKey,
        buildTaskAssistPayload({
          actionKey,
          task,
          collectionId,
          collectionTitle,
        })
      );
    } catch (err) {
      setErrorState(err?.message || "The request failed. Please try again.");
      return;
    }
    if (!response.ok) {
      if (RETRYABLE_AI_CODES.has(response.code)) {
        // The server may still finish; the recovery hook polls and applies it.
        // Drop the direct-path spinner so the recovery state owns the UI.
        setActive(null);
        setRecovering(true);
        return;
      }
      setErrorState(describeAIError(response.code, response.message));
      return;
    }
    applyResult(actionKey, response.data);
    ackAIRequest(actionKey, scope, userKey, response.requestId);
  };

  const toggle = (i) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const createSelected = async () => {
    const chosen = result.filter((_, i) => selected.has(i));
    if (!chosen.length) return;
    setCreating(true);
    const rows = chosen.map((child) => ({
      title: child.title,
      description: child.description
        ? `${child.description}\n\n— sub-task of "${task.title}"`
        : `Sub-task of "${task.title}"`,
      priority: child.priority,
      difficulty: child.difficulty,
      estimated_minutes: child.estimated_minutes,
      collection_id: collectionId,
      user_id: userKey,
      source: "ai",
      status: "pending",
    }));
    let error;
    try {
      ({ error } = await supabase.from("tasks").insert(rows));
    } catch (err) {
      error = err;
    }
    setCreating(false);
    if (error) {
      toast.error("Couldn't create the sub-tasks. Please try again.", {
        action: { label: "Retry", onClick: createSelected },
      });
      return;
    }
    toast.success(`${rows.length} sub-task${rows.length === 1 ? "" : "s"} created.`);
    onCreated?.();
    onClose();
  };

  const close = () => {
    setActive(null);
    setResult(null);
    setContextUsed(null);
    setErrorState(null);
    setRecovering(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={`Task assist — ${task.title}`}>
      <div
        className="flex flex-col gap-4"
        aria-busy={Boolean(recovering || (active && !result && !errorState))}
      >
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Assist actions">
          {ACTIONS.map(({ key, label, Icon }) => (
            <Button
              key={key}
              variant="secondary"
              disabled={Boolean(recovering || (active && !result && !errorState))}
              onClick={() => run(key)}
              className={
                active === key
                  ? "border-accent bg-accent-soft text-accent"
                  : ""
              }
            >
              <Icon size={16} aria-hidden />
              {label}
            </Button>
          ))}
        </div>

        {recovering && !result && !errorState && (
          <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
            <Sparkles size={14} className="animate-pulse text-accent" aria-hidden />
            Recovering your previous result…
          </p>
        )}

        {!recovering && active && !result && !errorState && (
          <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
            <Sparkles size={14} className="animate-pulse text-accent" aria-hidden />
            Working… this uses one request.
          </p>
        )}

        {errorState && <ErrorState title="Request failed" message={errorState} />}

        {contextUsed && result && <ContextUsed items={contextUsed} className="text-fg-muted" />}

        {Array.isArray(result) && active === "break_down_task" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-fg-muted">
              Proposed sub-tasks — choose which ones to create:
            </p>
            <ul className="flex flex-col gap-2">
              {result.map((child, i) => (
                <li key={i}>
                  <label className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-muted p-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={() => toggle(i)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-fg">{child.title}</span>
                      {child.description && (
                        <span className="mt-0.5 block text-xs text-fg-muted">
                          {child.description}
                        </span>
                      )}
                      <span className="mt-1 block text-xs text-fg-muted">
                        {child.estimated_minutes} min · {child.difficulty} ·{" "}
                        {PRIORITY_LABELS[child.priority] ?? child.priority} priority
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setActive(null)}>
                Back
              </Button>
              <Button onClick={createSelected} loading={creating} disabled={selected.size === 0}>
                Create {selected.size} sub-task{selected.size === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        )}

        {result && active === "explain_task" && typeof result === "object" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-fg">{result.summary}</p>
            <Markdown className="text-sm leading-relaxed text-fg">
              {result.explanation}
            </Markdown>
            {result.example && (
              <details className="rounded-lg border border-border bg-surface-muted p-3">
                <summary className="cursor-pointer text-sm font-medium text-accent">
                  Worked example
                </summary>
                <Markdown className="mt-2 text-sm leading-relaxed text-fg-muted">
                  {result.example}
                </Markdown>
              </details>
            )}
            <Button variant="ghost" className="self-start" onClick={() => setActive(null)}>
              Back
            </Button>
          </div>
        )}

        {Array.isArray(result) && active === "give_hint" && (
          <div className="flex flex-col gap-3">
            <ol className="flex flex-col gap-2">
              {result.map((hint, i) => (
                <li key={i} className="rounded-lg border border-border bg-surface-muted p-3">
                  <Markdown className="text-sm text-fg">{hint}</Markdown>
                </li>
              ))}
            </ol>
            <p className="text-xs text-fg-muted">
              Hints escalate gradually — try the earlier ones before the last.
            </p>
            <Button variant="ghost" className="self-start" onClick={() => setActive(null)}>
              Back
            </Button>
          </div>
        )}

        {result && active === "generate_practice" && typeof result === "object" && (
          <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
            <p className="text-sm text-fg-muted">{result.prompt}</p>
            <ol className="flex flex-col gap-3">
              {result.exercises.map((ex, i) => (
                <li key={i} className="rounded-lg border border-border bg-surface-muted p-3">
                  <p className="text-sm font-medium text-fg">
                    {i + 1}. {ex.question}
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-accent">
                      Show answer key
                    </summary>
                    <Markdown className="mt-2 text-sm leading-relaxed text-fg-muted">
                      {ex.answer_key}
                    </Markdown>
                  </details>
                </li>
              ))}
            </ol>
            <Button variant="ghost" className="self-start" onClick={() => setActive(null)}>
              Back
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
