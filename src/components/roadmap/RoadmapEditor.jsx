"use client";

import { useState } from "react";
import Input from "../ui/Input";
import Button from "../ui/Button";
import IconButton from "../ui/IconButton";
import Modal from "../ui/Modal";
import Card from "../ui/Card";
import Select from "../ui/Select";
import Chip from "../ui/Chip";
import { useToast } from "../ui/Toast";
import {
  callAI,
  ackAIRequest,
  describeAIError,
  RETRYABLE_AI_CODES,
} from "../../services/ai/aiClient";
import useAIResume from "../../hooks/useAIResume";
import { roadmapStageScope } from "../../utils/aiScopes";
import {
  renumberDraft,
  validateDraftForSave,
  validateDraftPrerequisites,
  draftTotalMinutes,
} from "../../utils/roadmapDraft";
import {
  ChevronDown,
  ChevronUp,
  Info,
  Lightbulb,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

// Draft review/edit surface: edit fields and ordering; regenerate a single
// stage via an explicit Replace/Discard preview. Nothing persists until Save.

const DIFFICULTIES = ["beginner", "intermediate", "advanced"];
const TASK_TYPES = ["study", "practice", "project", "review"];

/** Global step number where a stage's steps start. */
function stageStartNumber(draft, stageIndex) {
  let n = 0;
  for (let i = 0; i < stageIndex; i++) {
    draft.stages[i].milestones.forEach((m) => (n += m.steps.length));
  }
  return n + 1;
}

export default function RoadmapEditor({
  draft,
  setDraft,
  collectionId,
  weeklyStudyMinutes,
  onSave,
  onDiscard,
  saving,
  userKey,
}) {
  const toast = useToast();
  const [regenerating, setRegenerating] = useState(null); // stageIndex | null
  const [regenContext, setRegenContext] = useState("");
  const [regenStageIndex, setRegenStageIndex] = useState(null);
  const [proposal, setProposal] = useState(null); // {stageIndex, stage}
  const stageScope = roadmapStageScope(collectionId);

  // Recover a stage regeneration that outlived this editor. The stage index is
  // kept in the journal's `meta`, so a remount still knows where to apply it.
  useAIResume("regenerate_roadmap_stage", stageScope, {
    enabled: Boolean(userKey && stageScope && draft),
    userKey,
    onPendingChange: (pending, meta) =>
      setRegenerating(pending ? meta?.stageIndex ?? null : null),
    onSucceeded: ({ data, meta, requestId }) => {
      const stageIndex = meta?.stageIndex;
      setRegenerating(null);
      if (stageIndex == null || !data?.stage) {
        ackAIRequest("regenerate_roadmap_stage", stageScope, userKey, requestId);
        return;
      }
      setProposal({ stageIndex, stage: data.stage });
      ackAIRequest("regenerate_roadmap_stage", stageScope, userKey, requestId);
    },
    onFailed: ({ code }) => {
      setRegenerating(null);
      toast.error(describeAIError(code));
    },
    onMissing: () => setRegenerating(null),
  });

  // All mutations go through this: validate prereqs → renumber → set.
  const update = (mutate) => {
    const next = renumberDraft(mutate(structuredClone(draft)));
    const { draft: clean } = validateDraftPrerequisites(next);
    setDraft(clean);
  };

  const setStageField = (stageIndex, field, value) =>
    update((d) => {
      d.stages[stageIndex][field] = value;
      return d;
    });

  const moveStage = (stageIndex, delta) =>
    update((d) => {
      const target = stageIndex + delta;
      if (target < 0 || target >= d.stages.length) return d;
      [d.stages[stageIndex], d.stages[target]] = [
        d.stages[target],
        d.stages[stageIndex],
      ];
      return d;
    });

  const deleteStage = (stageIndex) =>
    update((d) => {
      d.stages.splice(stageIndex, 1);
      return d;
    });

  const addStage = () =>
    update((d) => {
      d.stages.push({
        title: "",
        description: "",
        milestones: [{ title: "", description: "", steps: [blankStep()] }],
      });
      return d;
    });

  const setMilestoneField = (stageIndex, msIndex, field, value) =>
    update((d) => {
      d.stages[stageIndex].milestones[msIndex][field] = value;
      return d;
    });

  const deleteMilestone = (stageIndex, msIndex) =>
    update((d) => {
      d.stages[stageIndex].milestones.splice(msIndex, 1);
      return d;
    });

  const addMilestone = (stageIndex) =>
    update((d) => {
      d.stages[stageIndex].milestones.push({
        title: "",
        description: "",
        steps: [blankStep()],
      });
      return d;
    });

  function blankStep() {
    return {
      title: "",
      description: "",
      learning_objective: "",
      estimated_minutes: 30,
      difficulty: "beginner",
      task_type: "study",
      prerequisite_steps: [],
    };
  }

  const setStepField = (stageIndex, msIndex, stepIndex, field, value) =>
    update((d) => {
      d.stages[stageIndex].milestones[msIndex].steps[stepIndex][field] = value;
      return d;
    });

  const deleteStep = (stageIndex, msIndex, stepIndex) =>
    update((d) => {
      d.stages[stageIndex].milestones[msIndex].steps.splice(stepIndex, 1);
      return d;
    });

  const addStep = (stageIndex, msIndex) =>
    update((d) => {
      d.stages[stageIndex].milestones[msIndex].steps.push(blankStep());
      return d;
    });

  // ---- stage regeneration --------------------------------------------------
  const openRegenerate = (stageIndex) => {
    setRegenStageIndex(stageIndex);
    setRegenContext("");
  };

  const regenerate = async () => {
    const stageIndex = regenStageIndex;
    setRegenStageIndex(null);
    setRegenerating(stageIndex);
    let result;
    try {
      result = await callAI("regenerate_roadmap_stage", {
        context: { collection_id: collectionId },
        input: {
          goal: draft.goal,
          stage_title: draft.stages[stageIndex].title,
          stage_context: regenContext.trim() || null,
          weekly_study_minutes: weeklyStudyMinutes ?? null,
        },
        resumeScope: stageScope,
        // Without this the client would not know which stage to replace after
        // a remount — the server result carries only the new stage.
        resumeMeta: { stageIndex },
      });
    } catch (err) {
      setRegenerating(null);
      toast.error(err?.message || "Regeneration failed. Please try again.");
      return;
    }
    setRegenerating(null);
    if (!result.ok) {
      if (RETRYABLE_AI_CODES.has(result.code)) {
        // The server may still finish; the recovery hook applies it.
        setRegenerating(stageIndex);
        return;
      }
      toast.error(describeAIError(result.code, result.message));
      return;
    }
    setProposal({ stageIndex, stage: result.data.stage });
    ackAIRequest(
      "regenerate_roadmap_stage",
      stageScope,
      userKey,
      result.requestId
    );
  };

  const acceptProposal = () =>
    update((d) => {
      const { stageIndex, stage } = proposal;
      // Local prerequisite numbers → global numbers for the merged draft.
      const start = stageStartNumber(d, stageIndex);
      const merged = {
        title: stage.title,
        description: stage.description,
        milestones: stage.milestones.map((milestone) => ({
          title: milestone.title,
          description: milestone.description,
          steps: milestone.steps.map((step) => ({
            ...step,
            // Local → global; refs into later steps of this stage resolve
            // after renumbering, refs outside the stage are dropped.
            prerequisite_steps: (step.prerequisite_steps ?? []).map(
              (p) => start + p - 1
            ),
          })),
        })),
      };
      d.stages[stageIndex] = merged;
      return d;
    });

  const saveError = validateDraftForSave(draft);
  const total = draftTotalMinutes(draft);

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
        <div className="flex flex-col gap-4">
          <Input
            label="Roadmap title"
            value={draft.title}
            onChange={(e) => update((d) => ((d.title = e.target.value), d))}
            maxLength={140}
            placeholder="e.g. Full-stack development learning path"
          />
          <Input
            label="Learning goal"
            value={draft.goal}
            onChange={(e) => update((d) => ((d.goal = e.target.value), d))}
            maxLength={140}
          />

          {(draft.rationale || draft.assumptions.length > 0) && (
            <div className="rounded-lg border border-border bg-surface-muted p-4">
              {draft.rationale && (
                <div className="flex items-start gap-2">
                  <Lightbulb size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                  <p className="text-sm leading-relaxed text-fg">{draft.rationale}</p>
                </div>
              )}
              {draft.assumptions.length > 0 && (
                <div className={`flex items-start gap-2 ${draft.rationale ? "mt-3" : ""}`}>
                  <Info size={16} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden />
                  <ul className="list-inside list-disc text-sm leading-relaxed text-fg-muted">
                    {draft.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {draft.stages.map((stage, stageIndex) => (
        <Card key={stage.id} className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="accent" size="md">
                Stage {stageIndex + 1}
              </Chip>
              {regenerating === stageIndex && (
                <span role="status" className="text-xs text-accent">
                  Regenerating stage…
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <IconButton
                label={`Move stage ${stageIndex + 1} up`}
                size="sm"
                variant="ghost"
                disabled={stageIndex === 0}
                onClick={() => moveStage(stageIndex, -1)}
              >
                <ChevronUp size={16} />
              </IconButton>
              <IconButton
                label={`Move stage ${stageIndex + 1} down`}
                size="sm"
                variant="ghost"
                disabled={stageIndex === draft.stages.length - 1}
                onClick={() => moveStage(stageIndex, 1)}
              >
                <ChevronDown size={16} />
              </IconButton>
              <IconButton
                label={`Regenerate stage ${stageIndex + 1}`}
                size="sm"
                variant="ghost"
                disabled={regenerating !== null || saving}
                onClick={() => openRegenerate(stageIndex)}
              >
                <RefreshCw size={16} />
              </IconButton>
              <IconButton
                label={`Delete stage ${stageIndex + 1}`}
                size="sm"
                variant="ghost"
                onClick={() => deleteStage(stageIndex)}
              >
                <Trash2 size={16} />
              </IconButton>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-4">
            <Input
              label={`Stage ${stageIndex + 1} title`}
              value={stage.title}
              onChange={(e) => setStageField(stageIndex, "title", e.target.value)}
              maxLength={140}
            />
            <Input
              label="Stage description (optional)"
              value={stage.description ?? ""}
              onChange={(e) => setStageField(stageIndex, "description", e.target.value)}
              maxLength={600}
            />

            {stage.milestones.map((milestone, msIndex) => (
              <div key={milestone.id} className="rounded-lg border border-border bg-surface-muted p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      label={`Milestone ${msIndex + 1} title`}
                      value={milestone.title}
                      onChange={(e) =>
                        setMilestoneField(stageIndex, msIndex, "title", e.target.value)
                      }
                      maxLength={140}
                    />
                  </div>
                  <IconButton
                    label={`Delete milestone ${msIndex + 1}`}
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteMilestone(stageIndex, msIndex)}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </div>

                <ul className="mt-3 flex flex-col gap-2">
                  {milestone.steps.map((step, stepIndex) => (
                    <li
                      key={step.id}
                      className="rounded-lg border border-border bg-surface p-3"
                    >
                      <div className="grid gap-2 sm:grid-cols-[1fr_7rem]">
                        <Input
                          aria-label={`Title for step ${step.step_number}`}
                          value={step.title}
                          onChange={(e) =>
                            setStepField(stageIndex, msIndex, stepIndex, "title", e.target.value)
                          }
                          maxLength={140}
                          placeholder={`Step ${step.step_number} title`}
                        />
                        <Input
                          type="number"
                          min={5}
                          max={600}
                          value={step.estimated_minutes ?? ""}
                          onChange={(e) =>
                            setStepField(
                              stageIndex,
                              msIndex,
                              stepIndex,
                              "estimated_minutes",
                              e.target.value === "" ? null : Number(e.target.value)
                            )
                          }
                          placeholder="min"
                          aria-label={`Estimated minutes for step ${step.step_number}`}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {/* Plain wrapper keeps the Select primitive's w-full
                            chrome inline in this flex-wrap row. */}
                        <div className="w-36">
                          <Select
                            aria-label={`Difficulty for step ${step.step_number}`}
                            value={step.difficulty ?? "beginner"}
                            onChange={(e) =>
                              setStepField(stageIndex, msIndex, stepIndex, "difficulty", e.target.value)
                            }
                          >
                            {DIFFICULTIES.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="w-32">
                          <Select
                            aria-label={`Task type for step ${step.step_number}`}
                            value={step.task_type ?? "study"}
                            onChange={(e) =>
                              setStepField(stageIndex, msIndex, stepIndex, "task_type", e.target.value)
                            }
                          >
                            {TASK_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </Select>
                        </div>
                        {step.prerequisite_steps?.length > 0 && (
                          <span className="text-xs text-fg-muted">
                            after step {step.prerequisite_steps.join(", step ")}
                          </span>
                        )}
                        <IconButton
                          label={`Delete step ${step.step_number}`}
                          size="sm"
                          variant="ghost"
                          className="ml-auto"
                          onClick={() => deleteStep(stageIndex, msIndex, stepIndex)}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </li>
                  ))}
                </ul>

                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => addStep(stageIndex, msIndex)}
                >
                  <Plus size={14} aria-hidden />
                  Add step
                </Button>
              </div>
            ))}

            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              onClick={() => addMilestone(stageIndex)}
            >
              <Plus size={14} aria-hidden />
              Add milestone
            </Button>
          </div>
        </Card>
      ))}

      <div className="flex flex-col gap-3">
        <Button size="sm" variant="secondary" className="self-start" onClick={addStage}>
          <Plus size={14} aria-hidden />
          Add stage
        </Button>

        {saveError && (
          <p id="roadmap-save-error" role="alert" className="text-sm text-warning">
            Not saved yet: {saveError}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <p className="text-sm text-fg">
            <span className="font-semibold">{draft.stages.length}</span> stage
            {draft.stages.length === 1 ? "" : "s"} · about{" "}
            <span className="font-semibold tabular-nums">
              {Math.round(total / 60)} h
            </span>{" "}
            estimated
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onDiscard} disabled={saving}>
              Discard draft
            </Button>
            <Button
              onClick={onSave}
              loading={saving}
              disabled={Boolean(saveError)}
              aria-describedby={saveError ? "roadmap-save-error" : undefined}
            >
              Save roadmap
            </Button>
          </div>
        </div>
      </div>

      {/* Regenerate context prompt */}
      <Modal
        open={regenStageIndex !== null}
        onClose={() => setRegenStageIndex(null)}
        title={`Regenerate stage ${
          regenStageIndex !== null ? regenStageIndex + 1 : ""
        }`}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="What should change? (optional)"
            value={regenContext}
            onChange={(e) => setRegenContext(e.target.value)}
            maxLength={600}
            placeholder="e.g. too theoretical, add more practice"
          />
          <p className="text-xs text-fg-muted">
            Only this stage is regenerated — other stages stay untouched, and
            you'll review the proposal before it replaces anything. Uses one
            request.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRegenStageIndex(null)}>
              Cancel
            </Button>
            <Button onClick={regenerate}>Regenerate</Button>
          </div>
        </div>
      </Modal>

      {/* Proposed stage preview — replace only after explicit approval */}
      <Modal
        open={proposal !== null}
        onClose={() => setProposal(null)}
        title="Proposed replacement stage"
      >
        {proposal && (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                Current
              </p>
              <p className="text-sm text-fg">{draft.stages[proposal.stageIndex].title}</p>
            </div>
            <div className="rounded-lg border border-accent/40 bg-accent-soft/50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-accent">
                Proposed
              </p>
              <p className="mt-1 text-sm font-semibold text-fg">{proposal.stage.title}</p>
              {proposal.stage.description && (
                <p className="mt-1 text-sm text-fg-muted">{proposal.stage.description}</p>
              )}
              <ul className="mt-3 flex flex-col gap-2">
                {proposal.stage.milestones.map((m, i) => (
                  <li key={i} className="text-sm text-fg">
                    <span className="font-medium">{m.title}</span>
                    <ul className="ml-4 mt-1 list-disc text-fg-muted">
                      {m.steps.map((s, j) => (
                        <li key={j}>
                          {s.title}{" "}
                          <span className="text-xs">
                            ({s.estimated_minutes} min · {s.difficulty} · {s.task_type})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setProposal(null)}>
                Discard proposal
              </Button>
              <Button onClick={acceptProposal}>Replace stage</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
