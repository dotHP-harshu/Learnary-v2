"use client";

import { useEffect, useRef, useState } from "react";
import useEscape from "../../hooks/useEscape";
import Button from "../ui/Button";
import Card from "../ui/Card";
import Chip from "../ui/Chip";
import EmptyState from "../ui/EmptyState";
import IconButton from "../ui/IconButton";
import Input from "../ui/Input";
import Select from "../ui/Select";
import { useToast } from "../ui/Toast";
import { acceptPlan, discardPlan } from "../../services/plans";
import supabase from "../../supabase/supabase";
import { nextDateStr } from "../../utils/todayPlanner";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Info,
  Lightbulb,
  ListPlus,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";

// Plan draft editor: reorder, adjust durations, add/remove items; overage is
// shown, never silently exceeded. Accepting persists; discarding discards.

export default function PlanDraft({
  plan, // {planId, date, availableMinutes, rationale, assumptions, items, source}
  userKey,
  pendingTasks,
  collections,
  defaultCollectionId,
  onAccepted,
  onDiscarded,
  onChange,
}) {
  const toast = useToast();
  const [items, setItems] = useState(plan.items);
  // A null saved budget falls back to 60 but is labelled an estimate, never
  // presented as the user's own number. The flag is carried on the draft so it
  // survives a reload; editing the value does not rewrite how it was produced.
  const [availableIsEstimate] = useState(
    plan.availableIsEstimate ?? plan.availableMinutes == null
  );
  const [available, setAvailable] = useState(plan.availableMinutes ?? 60);
  // Proposed items carry their target collection on the item itself;
  // no title-keyed map — two same-titled items stay independent.
  const [accepting, setAccepting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [postponing, setPostponing] = useState(null);

  useEscape(() => setAddOpen(false), addOpen);

  // Surface every edit to the parent so the draft survives an in-app tab
  // switch or a reload. Keyed on the edited fields only: the parent may pass a
  // fresh `plan` object on each save without causing an update loop. The first
  // run is skipped — mounting is not an edit, and rewriting the budget here
  // would turn the estimated 60-minute fallback into an explicit value.
  const editedRef = useRef(false);
  useEffect(() => {
    if (!editedRef.current) {
      editedRef.current = true;
      return;
    }
    onChange?.({
      ...plan,
      items,
      availableMinutes: available,
      availableIsEstimate,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, available]);

  const total = items.reduce((sum, i) => sum + (i.estimated_minutes ?? 0), 0);
  const overage = total - available;

  const setItemMinutes = (index, value) =>
    setItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, estimated_minutes: value === "" ? 0 : Math.max(0, Number(value)) }
          : item
      )
    );

  const move = (index, delta) =>
    setItems((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const remove = (index) =>
    setItems((prev) => prev.filter((_, i) => i !== index));

  // Postpone: push a task-linked item out of today's plan and reschedule the
  // task for tomorrow. Proposed (task-less) items are just removed — nothing
  // exists to reschedule yet.
  const postpone = async (index) => {
    if (postponing !== null) return;
    const item = items[index];
    if (item.task_id) {
      setPostponing(index);
      const tomorrow = nextDateStr(plan.date);
      const { error } = await supabase
        .from("tasks")
        .update({ scheduled_for: tomorrow })
        .eq("id", item.task_id);
      setPostponing(null);
      if (error) {
        toast.error("Couldn't postpone the task. Please try again.", {
          action: { label: "Retry", onClick: () => postpone(index) },
        });
        return;
      }
      toast.success(`"${item.title}" postponed to tomorrow.`);
    }
    remove(index);
  };

  const addItem = (task) => {
    setItems((prev) => [
      ...prev,
      {
        task_id: task.id,
        title: task.title,
        estimated_minutes: task.estimated_minutes ?? 30,
        priority: task.priority ?? "medium",
        type: "task",
      },
    ]);
    setAddOpen(false);
  };

  const addableTasks = pendingTasks.filter(
    (t) => !items.some((item) => item.task_id === t.id)
  );

  const accept = async () => {
    setAccepting(true);
    const resolved = items.map((item) =>
      item.task_id
        ? item
        : { ...item, collectionId: item.collectionId ?? defaultCollectionId }
    );
    const { error, offline, data } = await acceptPlan(userKey, {
      planId: plan.planId ?? null,
      date: plan.date,
      availableMinutes: available,
      rationale: plan.rationale ?? null,
      items: resolved,
    });
    setAccepting(false);
    if (error) {
      toast.error(
        offline
          ? "You're offline — reconnect to save the plan."
          : "Couldn't save the plan. Please try again.",
        offline ? undefined : { action: { label: "Retry", onClick: () => accept() } }
      );
      return;
    }
    if (data?.replay) {
      toast.info("Plan was already saved.");
    } else if (data?.createdTasks > 0) {
      toast.success(
        `Plan saved for today — ${data.createdTasks} new task${data.createdTasks === 1 ? "" : "s"} created in your collections.`
      );
    } else {
      toast.success("Plan saved for today. Tasks are in your collections.");
    }
    onAccepted?.();
  };

  const discard = async () => {
    if (plan.planId) {
      setDiscarding(true);
      const { error } = await discardPlan(userKey, plan.planId);
      setDiscarding(false);
      if (error) {
        toast.error("Couldn't discard the plan. Please try again.", {
          action: { label: "Retry", onClick: discard },
        });
        return;
      }
    }
    onDiscarded?.();
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-fg">
          {plan.source === "ai" ? "Suggested plan" : "Plan draft"}
        </h3>
        <div className="flex items-center gap-2">
          <label htmlFor="plan-available" className="text-xs text-fg-muted">
            Available{availableIsEstimate ? " (estimated)" : ""}
          </label>
          <div className="w-20 shrink-0">
            <Input
              id="plan-available"
              type="number"
              min={10}
              max={960}
              value={available}
              onChange={(e) => setAvailable(Number(e.target.value) || 0)}
              className="tabular-nums"
            />
          </div>
          <span className="text-xs text-fg-muted">min</span>
        </div>
      </div>

      {(plan.rationale || (plan.assumptions ?? []).length > 0) && (
        <div className="mt-3 rounded-lg border border-border bg-surface-muted p-3">
          {plan.rationale && (
            <div className="flex items-start gap-2">
              <Lightbulb size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <p className="text-sm leading-relaxed text-fg">{plan.rationale}</p>
            </div>
          )}
          {(plan.assumptions ?? []).length > 0 && (
            <div className={`flex items-start gap-2 ${plan.rationale ? "mt-2" : ""}`}>
              <Info size={15} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden />
              <ul className="list-inside list-disc text-xs leading-relaxed text-fg-muted">
                {plan.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <ol className="mt-4 flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={`${item.task_id ?? "new"}-${item.title}-${index}`}>
            <div className="flex flex-wrap items-start gap-2 rounded-lg border border-border bg-surface-muted p-3">
              <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{item.title}</p>
                {item.reason && (
                  <p className="mt-0.5 text-xs text-fg-muted">{item.reason}</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {!item.task_id && (
                    <Chip tone="accent" size="sm">
                      new task on accept
                    </Chip>
                  )}
                  {!item.task_id && collections.length > 1 && (
                    <div className="w-40 max-w-full">
                      <Select
                        aria-label={`Collection for ${item.title}`}
                        value={item.collectionId ?? defaultCollectionId ?? ""}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((it, i) =>
                              i === index ? { ...it, collectionId: e.target.value } : it
                            )
                          )
                        }
                      >
                        {collections.map((c) => (
                          <option key={c.collection_id} value={c.collection_id}>
                            {c.title}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1 sm:w-auto">
                <div className="w-16 shrink-0">
                  <Input
                    type="number"
                    min={5}
                    max={240}
                    value={item.estimated_minutes ?? ""}
                    onChange={(e) => setItemMinutes(index, e.target.value)}
                    aria-label={`Minutes for ${item.title}`}
                    className="tabular-nums"
                  />
                </div>
                <span className="text-xs text-fg-muted">min</span>
                <IconButton
                  label={`Move ${item.title} up`}
                  size="sm"
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp size={15} aria-hidden />
                </IconButton>
                <IconButton
                  label={`Move ${item.title} down`}
                  size="sm"
                  variant="ghost"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown size={15} aria-hidden />
                </IconButton>
                <IconButton
                  label={`Postpone ${item.title} to tomorrow`}
                  size="sm"
                  variant="ghost"
                  disabled={postponing !== null}
                  onClick={() => postpone(index)}
                >
                  <CalendarClock size={15} aria-hidden />
                </IconButton>
                <IconButton
                  label={`Remove ${item.title} from plan`}
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(index)}
                >
                  <Trash2 size={15} aria-hidden />
                </IconButton>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {items.length === 0 && (
        <EmptyState
          icon={ListPlus}
          title="No items yet"
          description="Add tasks from your list below."
        />
      )}

      {addOpen ? (
        <div className="mt-3 rounded-lg border border-border bg-surface-muted p-3">
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {addableTasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => addItem(task)}
                  className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-fg transition-colors hover:bg-accent-soft"
                >
                  {task.title}
                  <span className="ml-2 text-xs text-fg-muted">
                    {task.estimated_minutes ? `${task.estimated_minutes} min` : ""}
                  </span>
                </button>
              </li>
            ))}
            {addableTasks.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-fg-muted">
                All pending tasks are already in the plan.
              </li>
            )}
          </ul>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAddOpen(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="mt-3"
          onClick={() => setAddOpen(true)}
          disabled={pendingTasks.length === 0}
        >
          <Plus size={14} aria-hidden />
          Add task to plan
        </Button>
      )}

      <div
        role="status"
        aria-live="polite"
        className={`mt-4 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm ${
          overage > 0
            ? "border-warning/40 bg-warning-soft text-fg"
            : "border-border bg-surface-muted text-fg-muted"
        }`}
      >
        {overage > 0 ? (
          <>
            <TriangleAlert size={16} className="shrink-0 text-warning" aria-hidden />
            <span>
              Plan is <strong className="tabular-nums">{overage} min</strong> over your
              available time. Adjust durations or drop items before accepting.
            </span>
          </>
        ) : (
          <span className="tabular-nums">
            Total: {total} min of {available} min available
            {available - total > 0 ? ` · ${available - total} min spare` : ""}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={discard} disabled={accepting} loading={discarding}>
          Discard plan
        </Button>
        <Button
          onClick={accept}
          loading={accepting}
          aria-describedby="plan-accept-explanation"
          disabled={
            items.length === 0 ||
            overage > 0 ||
            (collections.length === 0 && items.some((item) => !item.task_id))
          }
        >
          Accept plan
        </Button>
      </div>
      {overage > 0 ? (
        <p id="plan-accept-explanation" className="mt-1 text-right text-xs text-fg-muted">
          Resolve the overage to enable accepting.
        </p>
      ) : (
        collections.length === 0 &&
        items.some((item) => !item.task_id) && (
          <p id="plan-accept-explanation" className="mt-1 text-right text-xs text-fg-muted">
            Create a collection first — new tasks from this plan need a home.
          </p>
        )
      )}
    </Card>
  );
}
