"use client";

import React, { useState } from "react";
import supabase from "../../supabase/supabase";
import { getUserKey } from "../../utils/getUserKey";
import { useToast } from "../ui/Toast";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Chip from "../ui/Chip";
import IconButton from "../ui/IconButton";
import { Check, LoaderCircle, Pencil, Trash2, Sparkles } from "lucide-react";
import TaskAssist from "./TaskAssist";

// Task row: real `role="switch"` completion toggle, Chip-rendered metadata,
// preview-first assist modal, and a labeled IconButton delete.

const PRIORITY_TONES = {
  high: "error",
  medium: "warning",
  low: "neutral",
};

function TaskItem({ task, getTasks, onPatch, user, collection_id, collection_title, onEdit }) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const toast = useToast();

  const userKey = getUserKey(user);

  const deleteTask = async () => {
    if (!navigator.onLine) {
      toast.error("You're offline — deleting a task needs a connection.");
      return;
    }
    setIsUpdating(true);
    const { error } = await supabase
      .from("tasks")
      .delete()
      // Defense in depth: RLS already scopes by owner; pinning the user id too
      // means a future policy mistake cannot turn this into a cross-account
      // write through a crafted id.
      .eq("id", task.id)
      .eq("user_id", userKey);

    setIsUpdating(false);
    if (error) {
      // Keep the dialog open on failure so the user can retry in place.
      toast.error("Couldn't delete the task. Please try again.", {
        action: { label: "Retry", onClick: deleteTask },
      });
      return;
    }
    setConfirmingDelete(false);
    getTasks(userKey);
    toast.success(`Deleted task "${task.title}"`);
  };

  const toggleTask = async () => {
    if (isUpdating) return;

    // Writes only happen online (repo convention): fail fast with an explicit
    // message instead of flip-then-rollback jank when offline.
    if (!navigator.onLine) {
      toast.error("You're offline — task updates need a connection.");
      return;
    }

    // Completion flips `completed` and stamps/clears `completed_at`. Requires
    // the `completed_at` column from `supabase/setup.sql`;
    // until then the database returns a clear error surfaced below instead of
    // failing silently.
    const nextCompleted = !task.completed;
    const patch = {
      completed: nextCompleted,
      completed_at: nextCompleted ? new Date().toISOString() : null,
      // Keep the status field in step with the boolean, so "completed"
      // filters/plan items never read a stale `pending`.
      status: nextCompleted ? "completed" : "pending",
    };

    // Optimistic: the switch and strikethrough react instantly; rolled back
    // below if the write fails. No refetch/toast on success — the visual
    // state change IS the feedback (a toast per toggle was noisy).
    setIsUpdating(true);
    onPatch?.(task.id, patch);

    const { error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", task.id)
      .eq("user_id", userKey);

    setIsUpdating(false);
    if (error) {
      onPatch?.(task.id, {
        completed: task.completed,
        completed_at: task.completed_at ?? null,
        status: task.status ?? (task.completed ? "completed" : "pending"),
      });
      toast.error("Couldn't update the task. Please try again.", {
        action: { label: "Retry", onClick: toggleTask },
      });
      return;
    }

    // Best-effort progress propagation: completing (or reopening) a
    // roadmap-linked task moves its step's status too. A failure here is
    // deliberately silent — the task update itself succeeded, and the step
    // status reconciles from the next roadmap visit.
    if (task.roadmap_step_id) {
      supabase
        .from("roadmap_steps")
        .update({ status: nextCompleted ? "completed" : "in_progress" })
        .eq("id", task.roadmap_step_id)
        .then(
          () => {},
          () => {} // best-effort: never an unhandled rejection
        );
    }
  };

  const dueDate = task.due_at ? new Date(task.due_at) : null;
  const overdue =
    !task.completed && dueDate && dueDate.getTime() < Date.now();

  return (
    <div className="group flex items-start gap-3 rounded-xl border border-border bg-surface p-3.5 pr-2 transition-colors duration-200 hover:border-border-strong">
      <button
        type="button"
        role="switch"
        aria-checked={task.completed}
        aria-label={task.title}
        disabled={isUpdating}
        onClick={toggleTask}
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
          task.completed
            ? "border-success bg-success text-success-fg"
            : "border-border-strong bg-transparent hover:border-accent"
        }`}
      >
        {task.completed && <Check size={14} strokeWidth={3} aria-hidden />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3
            className={`min-w-0 truncate text-sm font-medium ${
              task.completed ? "text-fg-muted line-through" : "text-fg"
            }`}
          >
            {task.title}
          </h3>
          <span className="hidden shrink-0 text-xs text-fg-muted sm:inline">
            {task.completed && task.completed_at
              ? `Completed ${task.completed_at.slice(0, 10)}`
              : `Added ${task.created_at.slice(0, 10)}`}
          </span>
        </div>

        {task.description && (
          <p className="mt-0.5 truncate text-xs text-fg-muted" title={task.description}>
            {task.description}
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {task.priority && task.priority !== "medium" && (
            <Chip tone={PRIORITY_TONES[task.priority] ?? "neutral"}>
              {task.priority} priority
            </Chip>
          )}
          {task.difficulty && <Chip tone="neutral">{task.difficulty}</Chip>}
          {task.estimated_minutes != null && (
            <Chip tone="neutral" className="tabular-nums">
              {task.estimated_minutes} min
            </Chip>
          )}
          {overdue && (
            <Chip tone="error">
              Overdue{dueDate ? ` ${dueDate.toLocaleDateString()}` : ""}
            </Chip>
          )}
          {!overdue && dueDate && !task.completed && (
            <Chip tone="neutral">Due {dueDate.toLocaleDateString()}</Chip>
          )}
          {task.source && task.source !== "manual" && (
            <Chip tone="neutral" className="capitalize">via {task.source}</Chip>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center">
        <IconButton
          label={`Edit task: ${task.title}`}
          variant="ghost"
          size="md"
          disabled={isUpdating}
          onClick={() => onEdit?.()}
          className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pencil size={16} aria-hidden />
        </IconButton>
        <IconButton
          label={`Assist for task: ${task.title}`}
          variant="ghost"
          size="md"
          disabled={isUpdating}
          onClick={() => setAssistOpen(true)}
          className="disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles size={16} aria-hidden />
        </IconButton>
        <IconButton
          label={`Delete task: ${task.title}`}
          variant="ghost"
          size="md"
          disabled={isUpdating}
          onClick={() => setConfirmingDelete(true)}
          className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUpdating ? (
            <LoaderCircle size={16} className="animate-spin" aria-hidden />
          ) : (
            <Trash2 size={16} aria-hidden />
          )}
        </IconButton>
      </div>

      {/* Shared accessible confirmation (same pattern as the collection
          card): stays open, actions disabled, until the delete resolves. */}
      <Modal
        open={confirmingDelete}
        onClose={() => {
          if (!isUpdating) setConfirmingDelete(false);
        }}
        title="Delete task?"
      >
        <p className="text-sm text-fg-muted">
          “{task.title}” will be permanently removed. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => setConfirmingDelete(false)}
            disabled={isUpdating}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={deleteTask}
            loading={isUpdating}
            disabled={isUpdating}
          >
            Delete
          </Button>
        </div>
      </Modal>

      <TaskAssist
        task={task}
        collectionId={collection_id}
        collectionTitle={Array.isArray(collection_title) ? collection_title?.[0]?.title : collection_title}
        open={assistOpen}
        onClose={() => setAssistOpen(false)}
        userKey={userKey}
        onCreated={() => getTasks(userKey)}
      />
    </div>
  );
}

export default TaskItem;
