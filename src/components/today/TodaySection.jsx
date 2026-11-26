"use client";

import { useContext, useEffect, useRef, useState } from "react";
import UserContext from "../../context/userContext";
import supabase from "../../supabase/supabase";
import { get as idbGet } from "idb-keyval";
import {
  callAI,
  describeAIError,
  ackAIRequest,
} from "../../services/ai/aiClient";
import { fetchLearningProfile } from "../../services/profile";
import {
  fetchPlans,
  setPlanItemStatus,
  discardPlan,
} from "../../services/plans";
import { countDueCards } from "../../services/practice";
import { getUserKey } from "../../utils/getUserKey";
import { learnerToday, formatPlanDate } from "../../utils/learnerDate";
import {
  loadPersistedPlanDraft,
  persistPlanDraft,
  clearPersistedPlanDraft,
} from "../../utils/planDraft";
import useAIResume from "../../hooks/useAIResume";
import useMountedRef from "../../hooks/useMountedRef";
import {
  rankTodayTasks,
  pickFocus,
  groupByBucket,
  pickQuickPlan,
  learnerDayBounds,
  nextDateStr,
} from "../../utils/todayPlanner";
import Skeleton from "../ui/Skeleton";
import Button from "../ui/Button";
import Card from "../ui/Card";
import Chip from "../ui/Chip";
import SegmentedControl from "../ui/SegmentedControl";
import EmptyState from "../ui/EmptyState";
import { useToast } from "../ui/Toast";
import PlanDraft from "./PlanDraft";
import Link from "next/link";
import { Brain } from "lucide-react";
import {
  CalendarClock,
  ChevronDown,
  CircleAlert,
  CalendarDays,
  CircleCheck,
  ListTodo,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";

// Today dashboard section: date, review queue, focus tasks, quick plan. Assistant
// outages never block the manual path.

const ITEM_TYPE_LABELS = { task: "Task", review: "Review", practice: "Practice" };

const BUCKET_STATES = {
  overdue: "overdue",
  due: "due",
  scheduled: "scheduled",
  later: "later",
};

// One pending task row. Module scope (rather than a component declared inside
// TodaySection's render) so React keeps the same component identity and the
// rows are not remounted on every state change.
function TaskRow({ task, state, onDoToday, onToggle, pending, pendingToday }) {
  const collectionTitle = task.collections?.title;
  return (
    <li className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-surface-muted p-3">
      {state === "overdue" && (
        <CircleAlert size={16} className="shrink-0 text-error" aria-hidden />
      )}
      {state === "due" && (
        <CalendarClock size={16} className="shrink-0 text-warning" aria-hidden />
      )}
      {state === "scheduled" && (
        <CalendarDays size={16} className="shrink-0 text-accent" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{task.title}</p>
        {collectionTitle && (
          <p className="truncate text-xs text-fg-muted">{collectionTitle}</p>
        )}
      </div>
      {state !== "scheduled" && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDoToday(task)}
          disabled={pendingToday}
        >
          Do today
        </Button>
      )}
      <button
        type="button"
        role="switch"
        aria-checked="false"
        aria-label={task.title}
        aria-busy={pending}
        disabled={pending}
        onClick={() => onToggle(task)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border-strong transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Square size={11} className="text-fg-muted" aria-hidden />
      </button>
    </li>
  );
}

function TodaySection() {
  const { user } = useContext(UserContext);
  const toast = useToast();
  const userKey = getUserKey(user);
  const mountedRef = useMountedRef();
  // Invalidates an in-flight generation when the learner switches to a manual
  // draft, resumes a saved one, or discards the plan.
  const generationToken = useRef(0);

  const [today, setToday] = useState(null);
  const [timezone, setTimezone] = useState(null);
  const [pendingTasks, setPendingTasks] = useState(null); // all unfinished tasks
  const [collections, setCollections] = useState([]);
  const [planData, setPlanData] = useState(null); // {plan, history}
  const [draft, setDraft] = useState(null); // in-memory plan draft being edited
  const [offline, setOffline] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);
  // Learner's saved daily budget: null = unknown — the UI then says the time
  // is an estimate instead of silently assuming 60 minutes.
  const [availableMinutes, setAvailableMinutes] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dueCards, setDueCards] = useState(null); // exact due count; null = loading/unknown
  const [pendingIds, setPendingIds] = useState(new Set()); // in-flight row actions

  const beginAction = (id) => setPendingIds((prev) => new Set(prev).add(id));
  const endAction = (id) =>
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  useEffect(() => {
    let active = true;

    const loadTasks = async () => {
      if (!navigator.onLine) {
        return ((await idbGet("tasks")) ?? []).filter((t) => !t.completed);
      }
      const { data, error } = await supabase
        .from("tasks")
        .select("*, collections (title)")
        .eq("user_id", userKey)
        .eq("completed", false)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        if (active) toast.error("Couldn't load today's tasks.");
        return [];
      }
      return data ?? [];
    };

    // Collections for plan-item assignment. Offline, fall back to the cached
    // snapshot instead of a query that cannot succeed; online, refresh from
    // Supabase.
    const loadCollections = async () => {
      if (!navigator.onLine) return (await idbGet("collections")) ?? [];
      const { data, error } = await supabase
        .from("collections")
        .select("collection_id, title, created_at")
        .eq("user_id", userKey)
        .order("created_at", { ascending: false })
        .limit(50);
      return error ? [] : data ?? [];
    };

    const load = async () => {
      const { data: profile } = await fetchLearningProfile(userKey);
      if (!active) return;
      const tz = profile?.timezone ?? null;
      setTimezone(tz);
      const date = learnerToday(tz);
      setToday(date);
      // Restore an unsaved draft (including edits) from before a tab switch
      // or reload. It is still client-side only until the learner accepts.
      const persistedDraft = loadPersistedPlanDraft(userKey, date);
      if (persistedDraft) setDraft(persistedDraft);

      // The four reads are independent once the learner's date is known:
      // fetch them together instead of paying four round trips in sequence.
      const [tasks, cols, plans, due] = await Promise.all([
        loadTasks().catch(() => []),
        loadCollections().catch(() => []),
        fetchPlans(userKey, date).catch(() => ({ data: null, offline: false })),
        countDueCards().catch(() => ({ data: null })),
      ]);
      if (!active) return;

      setPendingTasks(tasks);
      setCollections(cols);
      setPlanData(plans.data);
      setOffline(Boolean(plans.offline));
      if (profile?.daily_study_minutes) {
        setAvailableMinutes(profile.daily_study_minutes);
      }
      // Review queue: due flashcards for the daily dashboard. Exact count —
      // a fetch-length count would cap at the limit.
      setDueCards(due.data);
      setLoading(false);
    };

    if (user) load();
    if (navigator.onLine) {
      callAI("status").then((result) => {
        if (active) setAiAvailable(Boolean(result.ok && result.data?.available));
      });
    } else {
      setAiAvailable(false);
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // The draft (generated or manual) stays in sessionStorage until accepted,
  // so switching tabs no longer throws away the generation or its edits. The
  // key is always today's date — the same one the restore path reads.
  useEffect(() => {
    if (!draft || !userKey || !today) return;
    persistPlanDraft(userKey, today, draft);
  }, [draft, userKey, today]);

  const planScope = today ? `plan:${today}` : null;

  // Build the editable draft from a generation result. Persisted immediately
  // (not only from the effect) so it survives even an instant unmount.
  const draftFromAIResult = (data) => {
    const budget = data.available_minutes ?? availableMinutes;
    // The server records whether the number was the 60-minute fallback, so a
    // resumed draft keeps calling it an estimate instead of adopting it.
    const estimated =
      data.available_minutes_estimated ?? availableMinutes == null;
    return {
      planId: null,
      date: today,
      availableMinutes: budget,
      availableIsEstimate: estimated,
      rationale: data.plan.rationale,
      assumptions: [
        ...(estimated
          ? [
              "No saved daily time budget — planned for an estimated 60 minutes. Adjust below.",
            ]
          : []),
        ...(data.plan.assumptions ?? []),
      ],
      source: "ai",
      items: data.plan.items,
    };
  };

  // Recover a generation that outlived this component (tab switch, reload,
  // PWA backgrounding). The server already stored the result for idempotency;
  // this rehydrates the same editable draft without a second model call.
  useAIResume("generate_daily_plan", planScope, {
    enabled: Boolean(userKey && planScope) && !loading && !draft,
    userKey,
    onPendingChange: (pending) => setGenerating(pending),
    onSucceeded: ({ data, requestId }) => {
      // An unusable succeeded payload must not be replayed on every mount.
      if (!data?.plan) {
        ackAIRequest("generate_daily_plan", planScope, userKey, requestId);
        return;
      }
      generationToken.current += 1;
      const next = draftFromAIResult(data);
      persistPlanDraft(userKey, today, next);
      setDraft(next);
      ackAIRequest("generate_daily_plan", planScope, userKey, requestId);
    },
    onFailed: ({ code }) => {
      toast.error(describeAIError(code));
    },
  });

  const refreshPlan = async () => {
    const plans = await fetchPlans(userKey, today);
    setPlanData(plans.data);
  };

  const refreshTasks = async () => {
    const { data } = await supabase
      .from("tasks")
      .select("*, collections (title)")
      .eq("user_id", userKey)
      .eq("completed", false)
      .order("created_at", { ascending: false })
      .limit(100);
    setPendingTasks(data ?? []);
  };

  // ---- task classification + focus ----------------
  // Learner-timezone "today" via learnerDayBounds, deterministic ranking
  // (most-overdue first, never recency-excluded), and up to three primary
  // focus picks with everything else collapsed but accessible.
  const rankedTasks = rankTodayTasks(pendingTasks ?? [], today, timezone);
  const { focus, rest } = pickFocus(rankedTasks, 3);
  const groupedRest = groupByBucket(rest);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const restCount = rest.length;
  const hasBuckets = focus.length > 0 || restCount > 0;

  const renderBucket = (bucket, entries) =>
    entries.length > 0 && (
      <div>
        <p
          className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${
            bucket === "overdue"
              ? "text-error"
              : bucket === "due"
                ? "text-warning"
                : bucket === "scheduled"
                  ? "text-accent"
                  : "text-fg-muted"
          }`}
        >
          {bucket === "overdue" && `Overdue (${entries.length})`}
          {bucket === "due" && `Due today (${entries.length})`}
          {bucket === "scheduled" && `Scheduled today (${entries.length})`}
          {bucket === "later" && `Other tasks (${entries.length})`}
        </p>
        <ul className="flex flex-col gap-2">
          {entries.slice(0, 8).map(({ task, bucket: b }) => (
            <TaskRow
              key={task.id}
              task={task}
              state={BUCKET_STATES[b] ?? "later"}
              onDoToday={doToday}
              onToggle={toggleTask}
              pending={pendingIds.has(task.id)}
              pendingToday={pendingIds.has(`today-${task.id}`)}
            />
          ))}
        </ul>
      </div>
    );

  // ---- task actions ----------------
  const toggleTask = async (task) => {
    if (pendingIds.has(task.id)) return;
    if (!navigator.onLine) {
      toast.error("You're offline — task updates need a connection.");
      return;
    }
    beginAction(task.id);
    const { error } = await supabase
      .from("tasks")
      .update({
        completed: true,
        completed_at: new Date().toISOString(),
        status: "completed",
      })
      .eq("id", task.id)
      .eq("user_id", userKey);
    endAction(task.id);
    if (error) {
      toast.error("Couldn't complete the task. Please try again.", {
        action: { label: "Retry", onClick: () => toggleTask(task) },
      });
      return;
    }
    toast.success(`Completed "${task.title}"`);
    refreshTasks();
  };

  const doToday = async (task) => {
    const key = `today-${task.id}`;
    if (pendingIds.has(key)) return;
    if (!navigator.onLine) {
      toast.error("You're offline — task updates need a connection.");
      return;
    }
    beginAction(key);
    const { error } = await supabase
      .from("tasks")
      .update({ scheduled_for: today })
      .eq("id", task.id)
      .eq("user_id", userKey);
    endAction(key);
    if (error) {
      toast.error("Couldn't reschedule the task. Please try again.", {
        action: { label: "Retry", onClick: () => doToday(task) },
      });
      return;
    }
    toast.success(`"${task.title}" scheduled for today.`);
    refreshTasks();
  };

  // ---- plan actions ----------------------------------------------------------
  const startManualPlan = () => {
    // A manual draft replaces any pending generation for today.
    generationToken.current += 1;
    if (planScope) ackAIRequest("generate_daily_plan", planScope, userKey);
    // Pre-pick from the deterministic ranking: most pressing first, up to six
    // into the editable draft.
    const picked = rankedTasks.slice(0, 6);
    setDraft({
      planId: null,
      date: today,
      availableMinutes, // may be null → PlanDraft labels the 60-min fallback an estimate
      availableIsEstimate: availableMinutes == null,
      rationale: null,
      assumptions: availableMinutes == null ? ["No saved daily time budget — using an estimated 60 minutes. Adjust below."] : [],
      source: "manual",
      items: picked.map(({ task }) => ({
        task_id: task.id,
        title: task.title,
        estimated_minutes: task.estimated_minutes ?? 30,
        priority: task.priority ?? "medium",
        type: "task",
      })),
    });
  };

  // Quick plan: "I have 15 minutes" — a smaller selection of tasks that
  // genuinely fit the budget, never shrunken estimates.
  const quickPlan = (minutes) => {
    generationToken.current += 1;
    if (planScope) ackAIRequest("generate_daily_plan", planScope, userKey);
    const items = pickQuickPlan(rankedTasks, minutes);
    if (items.length === 0) {
      toast.info(
        `Nothing fits in ${minutes} min — your smallest task needs more time. Try a bigger window.`
      );
      return;
    }
    setDraft({
      planId: null,
      date: today,
      availableMinutes: minutes,
      availableIsEstimate: false,
      rationale: `A ${minutes}-minute session — small, finishable steps.`,
      assumptions: availableMinutes == null && minutes !== 60 ? ["Using your chosen time for today."] : [],
      source: "manual",
      items,
    });
  };

  const generatePlan = async () => {
    const scope = planScope;
    const token = ++generationToken.current;
    setGenerating(true);
    const { startMs } = learnerDayBounds(today, timezone);
    const offered = (pendingTasks ?? []).slice(0, 50).map((task) => {
      const due = task.due_at ? new Date(task.due_at).getTime() : null;
      return {
        task_id: task.id,
        title: task.title,
        estimated_minutes: task.estimated_minutes ?? null,
        priority: task.priority ?? "medium",
        difficulty: task.difficulty ?? null,
        scheduled_for: task.scheduled_for ?? null,
        due_at: task.due_at ?? null,
        overdue: due !== null && due < startMs,
      };
    });
    const result = await callAI("generate_daily_plan", {
      context: {},
      input: {
        date: today,
        available_minutes: availableMinutes ?? 60,
        available_minutes_estimated: availableMinutes == null,
        tasks: offered,
        weekly_study_minutes: null,
      },
      resumeScope: scope,
    });
    // Unmounted mid-request: leave the persisted handle in place so the next
    // mount can recover the stored result instead of losing the generation.
    // A manual draft chosen meanwhile also wins over this late result.
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
    const next = draftFromAIResult(result.data);
    persistPlanDraft(userKey, today, next);
    setDraft(next);
    ackAIRequest("generate_daily_plan", scope, userKey, result.requestId);
  };

  const resumeDraft = () => {
    // The saved draft wins over any still-pending generation.
    generationToken.current += 1;
    if (planScope) ackAIRequest("generate_daily_plan", planScope, userKey);
    const p = planData.plan;
    setDraft({
      planId: p.id,
      date: p.plan_date,
      availableMinutes: p.available_minutes ?? availableMinutes,
      availableIsEstimate: (p.available_minutes ?? availableMinutes) == null,
      rationale: p.rationale,
      assumptions: [],
      source: "draft",
      items: (p.study_plan_items ?? []).map((item) => ({
        task_id: item.task_id,
        title: item.title,
        estimated_minutes: item.estimated_minutes ?? 30,
        priority: "medium",
        type: item.item_type,
        // Keep the per-item collection chosen when the plan was created;
        // otherwise accepting the resumed draft files proposed tasks in the
        // default (most recent) collection.
        collectionId: item.collection_id ?? undefined,
      })),
    });
  };

  const discardDraft = async () => {
    generationToken.current += 1;
    clearPersistedPlanDraft(userKey, today);
    if (planScope) ackAIRequest("generate_daily_plan", planScope, userKey);
    setDraft(null);
    await refreshPlan();
  };

  const onItemCheck = async (item, status) => {
    const key = `item-${item.id}`;
    if (pendingIds.has(key)) return;
    beginAction(key);
    const { error, offline: offlineWrite } = await setPlanItemStatus(
      userKey,
      item,
      status
    );
    endAction(key);
    if (error || offlineWrite) {
      toast.error(
        offlineWrite
          ? "You're offline — reconnect to update the plan."
          : error
      );
      // A linked task may already have changed; refresh online so the UI
      // reflects the server instead of a stale optimistic state.
      if (!offlineWrite) {
        refreshPlan();
        refreshTasks();
      }
      return;
    }
    refreshPlan();
    refreshTasks();
  };

  const unplan = async () => {
    const key = "plan-discard";
    if (pendingIds.has(key)) return;
    beginAction(key);
    const { error } = await discardPlan(userKey, planData.plan.id);
    endAction(key);
    if (error) {
      toast.error("Couldn't remove the plan. Please try again.", {
        action: { label: "Retry", onClick: unplan },
      });
      return;
    }
    toast.success("Plan discarded. Your tasks are untouched.");
    setDraft(null);
    refreshPlan();
  };

  // Postpone: push the underlying task to tomorrow and mark the plan item
  // skipped. Nothing is deleted.
  const postponeItem = async (item) => {
    if (offline) {
      toast.error("You're offline — reconnect to postpone.");
      return;
    }
    const key = `postpone-${item.id}`;
    if (pendingIds.has(key)) return;
    beginAction(key);
    try {
      const tomorrow = nextDateStr(today);
      if (item.task_id) {
        const { error } = await supabase
          .from("tasks")
          .update({ scheduled_for: tomorrow })
          .eq("id", item.task_id)
          .eq("user_id", userKey);
        if (error) {
          toast.error("Couldn't postpone the task. Please try again.", {
            action: { label: "Retry", onClick: () => postponeItem(item) },
          });
          return;
        }
      }
      const { error, offline: offlineWrite } = await setPlanItemStatus(userKey, item, "skipped");
      if (error || offlineWrite) {
        toast.error(offlineWrite ? "You're offline — reconnect to postpone." : "Couldn't update the plan item. Please try again.");
        return;
      }
      toast.success(`"${item.title}" moved to tomorrow.`);
      refreshPlan();
      refreshTasks();
    } finally {
      endAction(key);
    }
  };

  // ---- render ---------------------------------------------------------------

  if (loading || !today) {
    return (
      <section aria-label="Today">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-3 h-28 rounded-xl" />
      </section>
    );
  }

  const plan = planData?.plan;
  const hasPlan = plan && plan.status !== "discarded";

  return (
    <section aria-label="Today">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-fg">Today</h2>
        <p className="text-sm text-fg-muted">
          {formatPlanDate(today)}
          {timezone ? ` · ${timezone}` : ""}
        </p>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {/* Review queue — hidden when the count is unknown (loading/offline)
            rather than showing a stale or partial number */}
        {dueCards > 0 && (
          <div className="lg:col-span-2">
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft">
                <Brain size={17} className="text-accent" aria-hidden />
              </span>
              <p className="min-w-0 flex-1 text-sm text-fg">
                <span className="font-medium">
                  {dueCards} card{dueCards === 1 ? "" : "s"} due for
                  review
                </span>
                <span className="block text-xs text-fg-muted">
                  Active recall keeps what you learned from fading.
                </span>
              </p>
              <Button as={Link} href="/practice?review=1">
                Start review
              </Button>
            </Card>
          </div>
        )}

        {/* Tasks: primary focus (max 3) + collapsed rest */}
        <div className="flex flex-col gap-3">
          {!hasBuckets ? (
            <EmptyState
              icon={ListTodo}
              title="Nothing scheduled for today"
              description="Nothing is due or scheduled today. Pick tasks below or plan the day to make progress."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {focus.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    Primary focus
                  </p>
                  <ul className="flex flex-col gap-2">
                    {focus.map(({ task, bucket }) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        state={BUCKET_STATES[bucket] ?? "later"}
                        onDoToday={doToday}
                        onToggle={toggleTask}
                        pending={pendingIds.has(task.id)}
                        pendingToday={pendingIds.has(`today-${task.id}`)}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {restCount > 0 && (
                <div>
                  <button
                    type="button"
                    aria-expanded={showAllTasks}
                    onClick={() => setShowAllTasks((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-fg-muted transition-colors hover:text-fg"
                  >
                    <ChevronDown
                      size={13}
                      aria-hidden
                      className={`transition-transform duration-200 ${showAllTasks ? "rotate-180" : ""}`}
                    />
                    {showAllTasks ? "Show fewer tasks" : `Show ${restCount} more task${restCount === 1 ? "" : "s"}`}
                  </button>
                  {showAllTasks && (
                    <div className="mt-3 flex flex-col gap-3">
                      {renderBucket("overdue", groupedRest.overdue)}
                      {renderBucket("due", groupedRest.due)}
                      {renderBucket("scheduled", groupedRest.scheduled)}
                      {renderBucket("later", groupedRest.later)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Plan */}
        <div className="flex flex-col gap-3">
          {draft ? (
            <PlanDraft
              plan={draft}
              userKey={userKey}
              pendingTasks={pendingTasks ?? []}
              collections={collections}
              defaultCollectionId={collections[0]?.collection_id ?? null}
              onChange={(next) => setDraft(next)}
              onAccepted={() => {
                generationToken.current += 1;
                clearPersistedPlanDraft(userKey, today);
                if (planScope) {
                  ackAIRequest("generate_daily_plan", planScope, userKey);
                }
                setDraft(null);
                refreshPlan();
                refreshTasks();
              }}
              onDiscarded={discardDraft}
            />
          ) : hasPlan && plan.status === "draft" ? (
            <Card className="p-5">
              <h3 className="text-base font-semibold text-fg">Saved plan draft</h3>
              <p className="mt-1 text-sm text-fg-muted">
                {plan.study_plan_items?.length ?? 0} items ·{" "}
                {plan.estimated_minutes ?? "?"} min. Review and accept it to put
                it to work.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={resumeDraft}>
                  Review draft
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pendingIds.has("plan-discard")}
                  onClick={async () => {
                    const key = "plan-discard";
                    if (pendingIds.has(key)) return;
                    beginAction(key);
                    const { error } = await discardPlan(userKey, plan.id);
                    endAction(key);
                    if (error) toast.error("Couldn't discard the draft. Please try again.");
                    else {
                      clearPersistedPlanDraft(userKey, today);
                      refreshPlan();
                    }
                  }}
                >
                  Discard
                </Button>
              </div>
            </Card>
          ) : hasPlan ? (
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-fg">
                  Today's plan
                  <Chip tone="neutral" size="sm" className="ml-2 align-middle capitalize">
                    {plan.status}
                  </Chip>
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={unplan}
                  disabled={pendingIds.has("plan-discard")}
                >
                  <Trash2 size={14} aria-hidden />
                  Remove plan
                </Button>
              </div>
              {plan.rationale && (
                <p className="mt-1 text-sm text-fg-muted">{plan.rationale}</p>
              )}
              <p className="mt-2 text-xs tabular-nums text-fg-muted">
                {plan.estimated_minutes ?? "?"} min planned
                {plan.available_minutes ? ` of ${plan.available_minutes} available` : ""}
              </p>
              <ol className="mt-3 flex flex-col gap-2">
                {(plan.study_plan_items ?? []).map((item, index) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-surface-muted p-3"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm font-medium ${
                          item.status === "completed" || item.status === "skipped"
                            ? "text-fg-muted line-through"
                            : "text-fg"
                        }`}
                      >
                        {item.title}
                      </p>
                      <p className="text-xs text-fg-muted">
                        {ITEM_TYPE_LABELS[item.item_type] ?? item.item_type} ·{" "}
                        {item.estimated_minutes ?? "?"} min
                      </p>
                    </div>
                    {item.status === "pending" ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onItemCheck(item, "skipped")}
                          disabled={pendingIds.has(`item-${item.id}`)}
                        >
                          Skip
                        </Button>
                        {item.task_id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => postponeItem(item)}
                            disabled={pendingIds.has(`postpone-${item.id}`)}
                          >
                            <CalendarDays size={13} aria-hidden />
                            Postpone
                          </Button>
                        )}
                        <button
                          type="button"
                          role="switch"
                          aria-checked="false"
                          aria-label={item.title}
                          aria-busy={pendingIds.has(`item-${item.id}`)}
                          disabled={pendingIds.has(`item-${item.id}`)}
                          onClick={() => onItemCheck(item, "completed")}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border-strong transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Square size={11} className="text-fg-muted" aria-hidden />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Reopen plan item: ${item.title}`}
                        aria-busy={pendingIds.has(`item-${item.id}`)}
                        disabled={pendingIds.has(`item-${item.id}`)}
                        onClick={() => onItemCheck(item, "pending")}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-success bg-success text-success-fg disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <CircleCheck size={12} aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          ) : (
            <Card className="p-5">
              <EmptyState
                icon={CalendarDays}
                title="No plan for today yet"
                description="Build a realistic study plan from your tasks — by hand or generated for you."
              />
              {/* Quick planning: a smaller selection that fits, never
                  shrunken estimates. */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <span className="text-xs text-fg-muted">Short on time?</span>
                {[15, 30, 45].map((minutes) => (
                  <Button
                    key={minutes}
                    size="sm"
                    variant="secondary"
                    onClick={() => quickPlan(minutes)}
                  >
                    I have {minutes} min
                  </Button>
                ))}
              </div>
              {/* An unsaved budget is an estimate, stated out loud and
                  changeable in one tap. */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <span className="text-xs text-fg-muted">
                  {availableMinutes == null
                    ? "No daily time saved — plans below assume 60 min:"
                    : "Daily budget:"}
                </span>
                <SegmentedControl
                  size="sm"
                  ariaLabel="Daily time budget"
                  options={[15, 30, 45, 60].map((minutes) => ({
                    value: minutes,
                    label: `${minutes} min`,
                  }))}
                  value={availableMinutes}
                  onChange={setAvailableMinutes}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" variant="secondary" onClick={startManualPlan}>
                  Plan manually
                </Button>
                <Button
                  size="sm"
                  onClick={generatePlan}
                  loading={generating}
                  disabled={!aiAvailable || generating}
                >
                  <Sparkles size={14} aria-hidden />
                  Generate plan
                </Button>
              </div>
            </Card>
          )}

          {!aiAvailable && !draft && (
            <p className="text-xs text-fg-muted">
              Generation is unavailable right now
              {offline ? " (you're offline)" : ""} — manual planning always works.
            </p>
          )}

          {/* Plan history */}
          {(planData?.history ?? []).length > 0 && (
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Recent plans
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {planData.history
                  .filter((h) => h.id !== plan?.id)
                  .slice(0, 5)
                  .map((h) => (
                    <li key={h.id} className="flex items-center justify-between text-sm">
                      <span className="text-fg">{formatPlanDate(h.plan_date)}</span>
                      <span className="text-xs tabular-nums text-fg-muted">
                        {h.estimated_minutes ?? "?"} min
                      </span>
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}

export default TodaySection;
