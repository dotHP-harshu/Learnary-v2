"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import UserContext from "../../context/userContext";
import Button from "../ui/Button";
import Card from "../ui/Card";
import Modal from "../ui/Modal";
import IconButton from "../ui/IconButton";
import Chip from "../ui/Chip";
import Select from "../ui/Select";
import SegmentedControl from "../ui/SegmentedControl";
import { useToast } from "../ui/Toast";
import { getUserKey } from "../../utils/getUserKey";
import {
  createTasksFromSteps,
  updateStepStatus,
} from "../../services/roadmap";
import supabase from "../../supabase/supabase";
import {
  Clock,
  Lightbulb,
  Info,
  Pencil,
  Trash2,
  ListChecks,
  List,
  ListTree,
} from "lucide-react";

// Saved roadmap view: simple ordered step list by default, full stage tree as
// the detailed view. Content is validated before saving; never calls the provider.

const TASK_TYPE_LABELS = {
  study: "Study",
  practice: "Practice",
  project: "Project",
  review: "Review",
};

const STEP_STATUSES = ["not_started", "in_progress", "completed", "skipped"];

const STEP_STATUS_LABELS = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Done",
  skipped: "Skipped",
};

// Chip tones for step status / difficulty (semantic: completed → success,
// in-progress → accent, beginner→success / intermediate→warning / advanced→error).
const STEP_STATUS_TONES = {
  not_started: "neutral",
  in_progress: "accent",
  completed: "success",
  skipped: "neutral",
};

const DIFFICULTY_TONES = {
  beginner: "success",
  intermediate: "warning",
  advanced: "error",
};

/**
 * One plan step, shared by the simple and detailed views. Carries the step
 * title, status chip, minutes/difficulty/type chips, the single-commit status
 * select, optional description, and the "After: …" prerequisite line.
 */
function StepRow({ step, status, onSelectStatus, prereqTitles }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`text-sm font-medium ${
            status === "completed"
              ? "text-fg-muted line-through"
              : "text-fg"
          }`}
        >
          {step.title}
        </span>
        <Chip
          tone={STEP_STATUS_TONES[status] ?? "neutral"}
          size="md"
          className={status === "skipped" ? "opacity-70" : ""}
        >
          {STEP_STATUS_LABELS[status] ?? status}
        </Chip>
        {step.estimated_minutes != null && (
          <Chip tone="neutral" size="md" className="tabular-nums">
            {step.estimated_minutes} min
          </Chip>
        )}
        {step.difficulty && (
          <Chip tone={DIFFICULTY_TONES[step.difficulty] ?? "neutral"} size="md">
            {step.difficulty}
          </Chip>
        )}
        <Chip tone="neutral" size="md">
          {TASK_TYPE_LABELS[step.task_type] ?? step.task_type}
        </Chip>

        {/* Single-commit status select: commits on change, optimistic chip
            with rollback on error. */}
        <div className="ml-auto w-36 shrink-0">
          <Select
            aria-label={`Progress for step: ${step.title}`}
            value={status}
            onChange={(e) => onSelectStatus(e.target.value)}
          >
            {STEP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STEP_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {step.description && (
        <p className="mt-1 text-sm text-fg-muted">{step.description}</p>
      )}
      {step.prereqs.length > 0 && (
        <p className="mt-1 text-xs text-fg-muted">
          After: {step.prereqs.map((id) => (prereqTitles ?? new Map()).get(id)).filter(Boolean).join(" · ")}
        </p>
      )}
    </>
  );
}

export default function RoadmapView({ snapshot, collectionId, onEdit, onChanged, onDeleted }) {
  const { user } = useContext(UserContext);
  const toast = useToast();
  const roadmap = snapshot.roadmap;
  const prereqs = useMemo(
    () => snapshot.prerequisites ?? [],
    [snapshot]
  );

  const [tasksModal, setTasksModal] = useState(false);
  const [existingTaskIds, setExistingTaskIds] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Optimistic status overrides: {stepId: status}. A fresh snapshot is the
  // server's truth, so the overrides are dropped whenever one arrives — they
  // must never mask a change made elsewhere (e.g. task-completion propagation).
  const [statusOverrides, setStatusOverrides] = useState({});
  useEffect(() => {
    setStatusOverrides({});
  }, [snapshot]);
  // Simple view (one ordered list) is the default; the detailed stage →
  // milestone tree is one toggle away.
  const [viewMode, setViewMode] = useState("simple");

  // Flattened steps in display order, each with its stage/milestone context.
  // The nested render below maps raw `roadmap_steps` rows (no `prereqs`
  // attached), so it looks steps up here by id — this map is the single
  // place where prerequisite pairs are joined onto step objects.
  const { steps, stepById } = useMemo(() => {
    const list = [];
    const byId = new Map();
    (roadmap.roadmap_stages ?? []).forEach((stage, stageIdx) => {
      (stage.roadmap_milestones ?? []).forEach((milestone, msIdx) => {
        (milestone.roadmap_steps ?? []).forEach((step, stepIdx) => {
          const enriched = {
            ...step,
            stage_title: stage.title,
            milestone_title: milestone.title,
            order: `${stageIdx + 1}.${msIdx + 1}.${stepIdx + 1}`,
            prereqs: prereqs
              .filter((p) => p.step_id === step.id)
              .map((p) => p.prerequisite_step_id),
          };
          list.push(enriched);
          byId.set(step.id, enriched);
        });
      });
    });
    return { steps: list, stepById: byId };
  }, [roadmap, prereqs]);

  const stepTitleById = useMemo(() => {
    const map = new Map();
    steps.forEach((s) => map.set(s.id, s.title));
    return map;
  }, [steps]);

  const statusOf = (step) => statusOverrides[step.id] ?? step.status ?? "not_started";
  const completedCount = steps.filter((s) => statusOf(s) === "completed").length;

  const changeStatus = async (step, status) => {
    if (status === statusOf(step)) return;
    const previous = statusOf(step);
    setStatusOverrides((prev) => ({ ...prev, [step.id]: status })); // optimistic
    const { error, offline } = await updateStepStatus(step.id, status);
    if (error) {
      // Roll the chip back so the UI never lies about saved progress.
      setStatusOverrides((prev) => ({ ...prev, [step.id]: previous }));
      if (error !== "STEP_NOT_FOUND") {
        toast.error(
          offline
            ? "You're offline — reconnect to update progress."
            : "Couldn't update the step. Please try again.",
          offline ? undefined : { action: { label: "Retry", onClick: () => changeStatus(step, status) } }
        );
        return;
      }
      toast.info("That step no longer exists.");
    }
    onChanged?.(); // refresh the snapshot (and the offline cache)
  };

  useEffect(() => {
    if (!tasksModal) return;
    let active = true;
    supabase
      .from("tasks")
      .select("id, roadmap_step_id, title")
      .eq("collection_id", collectionId)
      .eq("user_id", getUserKey(user))
      .eq("source", "roadmap")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          toast.error("Couldn't check which steps already have tasks.");
          setExistingTaskIds({ ids: new Set(), titles: new Set() });
          return;
        }
        // Duplicate check by stable step link; the title set only catches
        // tasks created before the link existed.
        const ids = new Set(
          (data ?? []).map((t) => t.roadmap_step_id).filter(Boolean)
        );
        const titles = new Set(
          (data ?? []).map((t) => t.title.trim().toLowerCase())
        );
        setExistingTaskIds({ ids, titles });
        const isDup = (s) => ids.has(s.id) || titles.has(s.title.trim().toLowerCase());
        setSelected(new Set(steps.filter((s) => !isDup(s)).map((s) => s.id)));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksModal]);

  const alreadyCreated = (step) =>
    existingTaskIds
      ? existingTaskIds.ids.has(step.id) ||
        existingTaskIds.titles.has(step.title.trim().toLowerCase())
      : false;

  const toggleStep = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const createTasks = async () => {
    const chosen = steps.filter((s) => selected.has(s.id));
    if (!chosen.length) return;
    setCreating(true);
    const { data: count, error, offline } = await createTasksFromSteps(
      collectionId,
      getUserKey(user),
      chosen
    );
    setCreating(false);
    if (error) {
      toast.error(
        offline
          ? "You're offline — reconnect to create tasks."
          : "Couldn't create tasks. Please try again.",
        offline ? undefined : { action: { label: "Retry", onClick: createTasks } }
      );
      return;
    }
    setTasksModal(false);
    toast.success(`${count} task${count === 1 ? "" : "s"} added to this collection.`);
    onChanged?.();
  };

  const deleteRoadmap = async () => {
    setDeleting(true);
    const { error } = await supabase
      .from("learning_roadmaps")
      .delete()
      .eq("id", roadmap.id)
      .eq("user_id", getUserKey(user));
    setDeleting(false);
    if (error) {
      toast.error("Couldn't delete the roadmap. Please try again.", {
        action: { label: "Retry", onClick: deleteRoadmap },
      });
      return;
    }
    toast.success("Roadmap deleted. Your tasks are untouched.");
    onDeleted?.();
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-fg">{roadmap.title}</h2>
            <p className="mt-1 text-sm text-fg-muted">{roadmap.goal}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-fg-muted">
              <span className="inline-flex items-center gap-1">
                <Clock size={13} aria-hidden />
                {roadmap.estimated_total_minutes
                  ? `about ${Math.round(roadmap.estimated_total_minutes / 60)} h estimated`
                  : "estimates not set"}
              </span>
              <Chip tone="neutral" size="sm" className="capitalize">
                {roadmap.status}
              </Chip>
              {steps.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <ListChecks size={13} aria-hidden />
                  {completedCount} of {steps.length} step{steps.length === 1 ? "" : "s"} done
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setTasksModal(true)}>
              <ListChecks size={16} aria-hidden />
              Create tasks from steps
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onEdit?.()}>
              <Pencil size={15} aria-hidden />
              Edit roadmap
            </Button>
            <IconButton
              label="Delete roadmap"
              variant="ghost"
              size="sm"
              onClick={() => setDeleteModal(true)}
            >
              <Trash2 size={16} />
            </IconButton>
          </div>
        </div>

        {(roadmap.rationale || (roadmap.assumptions ?? []).length > 0) && (
          <div className="mt-4 rounded-lg border border-border bg-surface-muted p-4">
            {roadmap.rationale && (
              <div className="flex items-start gap-2">
                <Lightbulb size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <p className="text-sm leading-relaxed text-fg">{roadmap.rationale}</p>
              </div>
            )}
            {(roadmap.assumptions ?? []).length > 0 && (
              <div className={`flex items-start gap-2 ${roadmap.rationale ? "mt-3" : ""}`}>
                <Info size={16} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden />
                <ul className="list-inside list-disc text-sm leading-relaxed text-fg-muted">
                  {roadmap.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="flex justify-end">
        <SegmentedControl
          ariaLabel="Plan view"
          value={viewMode}
          onChange={setViewMode}
          options={[
            { value: "simple", label: "Simple", Icon: List },
            { value: "detailed", label: "Detailed", Icon: ListTree },
          ]}
        />
      </div>

      {viewMode === "simple" ? (
        /* Simple view: every step in plan order, regardless of stage/milestone
           grouping — "what are my next steps?" */
        steps.length > 0 && (
          <Card className="p-5">
            <ol className="flex flex-col gap-2">
              {steps.map((step) => {
                const status = statusOf(step);
                return (
                  <li
                    key={step.id}
                    className={`rounded-lg border bg-surface-muted p-3 ${
                      status === "completed"
                        ? "border-success/30"
                        : status === "skipped"
                          ? "border-border opacity-70"
                          : "border-border"
                    }`}
                  >
                    <StepRow
                      step={step}
                      status={status}
                      prereqTitles={stepTitleById}
                      onSelectStatus={(s) => changeStatus(step, s)}
                    />
                    <p className="mt-1 text-xs text-fg-muted">
                      {step.order} · {step.stage_title} · {step.milestone_title}
                    </p>
                  </li>
                );
              })}
            </ol>
          </Card>
        )
      ) : (
        /* Detailed view: the full stage → milestone tree. */
        (roadmap.roadmap_stages ?? []).map((stage, stageIndex) => (
          <Card key={stage.id} className="p-5">
            <div className="flex items-center gap-2">
              <Chip tone="accent" size="md">
                Stage {stageIndex + 1}
              </Chip>
              <h3 className="font-semibold text-fg">{stage.title}</h3>
            </div>
            {stage.description && (
              <p className="mt-1 text-sm text-fg-muted">{stage.description}</p>
            )}

            {(stage.roadmap_milestones ?? []).map((milestone) => (
              <div key={milestone.id} className="mt-4">
                <p className="text-sm font-semibold text-fg">{milestone.title}</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {(milestone.roadmap_steps ?? []).map((rawStep) => {
                    // Enriched lookup: the raw row has no prereqs joined.
                    const step = stepById.get(rawStep.id) ?? { ...rawStep, prereqs: [] };
                    const status = statusOf(step);
                    return (
                      <li
                        key={step.id}
                        className={`rounded-lg border bg-surface-muted p-3 ${
                          status === "completed"
                            ? "border-success/30"
                            : status === "skipped"
                              ? "border-border opacity-70"
                              : "border-border"
                        }`}
                      >
                        <StepRow
                          step={step}
                          status={status}
                          prereqTitles={stepTitleById}
                          onSelectStatus={(s) => changeStatus(step, s)}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </Card>
        ))
      )}

      {/* Create-tasks modal: explicit selection, duplicates pre-filtered */}
      <Modal
        open={tasksModal}
        onClose={() => {
          if (!creating) setTasksModal(false);
        }}
        title="Create tasks from roadmap steps"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            Choose the steps to add as tasks in this collection. Steps that
            already have a task are marked as done.
          </p>
          {existingTaskIds === null ? (
            <p role="status" className="text-sm text-fg-muted">Checking existing tasks…</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {steps.map((step) => {
                const done = alreadyCreated(step);
                return (
                  <li key={step.id}>
                    <label
                      className={`flex items-center gap-2.5 rounded-lg border p-2.5 text-sm ${
                        done
                          ? "border-border bg-surface-muted text-fg-muted"
                          : "border-border bg-surface text-fg"
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={done || creating}
                        checked={selected.has(step.id)}
                        onChange={() => toggleStep(step.id)}
                        className="h-4 w-4 shrink-0 accent-accent"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {step.order} {step.title}
                        </span>
                        <span className="text-xs text-fg-muted">{step.stage_title}</span>
                      </span>
                      {done && (
                        <Chip tone="success" size="sm" className="shrink-0">
                          task exists
                        </Chip>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTasksModal(false)} disabled={creating}>
              Cancel
            </Button>
            <Button
              onClick={createTasks}
              loading={creating}
              disabled={selected.size === 0 || existingTaskIds === null}
            >
              {creating ? "Creating…" : `Create ${selected.size} task${selected.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation (destructive action) */}
      <Modal
        open={deleteModal}
        onClose={() => {
          if (!deleting) setDeleteModal(false);
        }}
        title="Delete this roadmap?"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            "{roadmap.title}" and all its stages, milestones, and steps will be
            permanently deleted. Tasks you already created from it are kept.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteModal(false)} disabled={deleting}>
              Keep it
            </Button>
            <Button variant="danger" onClick={deleteRoadmap} loading={deleting}>
              <Trash2 size={15} aria-hidden />
              Delete roadmap
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
