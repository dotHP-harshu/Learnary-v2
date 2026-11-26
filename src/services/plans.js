// Study-plan client. Plans are drafts until the user accepts; acceptance runs in
// one transaction via the accept_study_plan RPC. Writes are online-only; reads fall back to idb.

import supabase from "../supabase/supabase";
import { get as idbGet, set as idbSet } from "idb-keyval";

const cacheKey = (userKey, date) => `plan:${userKey}:${date}`;

/**
 * Load the plan for a date (with items) plus recent plan history.
 * @returns {Promise<{data: {plan, history}|null, error, offline}>}
 */
export async function fetchPlans(userKey, date) {
  if (!userKey) return { data: null, error: "No signed-in user." };

  if (!navigator.onLine) {
    const cached = await idbGet(cacheKey(userKey, date));
    return { data: cached ?? null, error: null, offline: true };
  }

  const { data: plan, error } = await supabase
    .from("study_plans")
    .select("*, study_plan_items (*)")
    .eq("user_id", userKey)
    .eq("plan_date", date)
    .in("status", ["draft", "accepted", "in_progress", "completed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { data: null, error: error.message, offline: false };

  const { data: history, error: historyError } = await supabase
    .from("study_plans")
    .select("id, plan_date, status, estimated_minutes, available_minutes")
    .eq("user_id", userKey)
    .eq("status", "accepted")
    .order("plan_date", { ascending: false })
    .limit(7);

  if (historyError) return { data: null, error: historyError.message, offline: false };

  const items = plan
    ? {
        ...plan,
        study_plan_items: (plan.study_plan_items ?? []).sort(
          (a, b) => a.sequence - b.sequence
        ),
      }
    : null;

  const result = { plan: items, history: history ?? [] };
  await idbSet(cacheKey(userKey, date), result);
  return { data: result, error: null, offline: false };
}

/**
 * Persist a draft plan. `items` are already ordered; each item carries
 * `task_id` (linked) or null (proposed task, created at acceptance).
 */
export async function savePlanDraft(userKey, { date, availableMinutes, rationale, items }) {
  if (!navigator.onLine) {
    return { data: null, error: "You are offline. Reconnect to save the plan.", offline: true };
  }

  const { data: plan, error } = await supabase
    .from("study_plans")
    .insert({
      user_id: userKey,
      plan_date: date,
      status: "draft",
      available_minutes: availableMinutes ?? null,
      estimated_minutes: items.reduce((sum, i) => sum + (i.estimated_minutes ?? 0), 0),
      rationale: rationale ?? null,
    })
    .select("id")
    .single();
  if (error) return { data: null, error: error.message, offline: false };

  const itemError = await insertItems(plan.id, userKey, items);
  if (itemError) return { data: null, error: itemError, offline: false };

  return { data: { planId: plan.id }, error: null, offline: false };
}

async function insertItems(planId, userKey, items) {
  const rows = items.map((item, index) => ({
    study_plan_id: planId,
    user_id: userKey,
    task_id: item.task_id ?? null,
    title: item.title,
    item_type: item.type ?? "task",
    sequence: index,
    estimated_minutes: item.estimated_minutes ?? null,
    collection_id: item.collectionId ?? null, // per-item target collection
    status: "pending",
  }));
  const { error } = await supabase.from("study_plan_items").insert(rows);
  return error?.message ?? null;
}

/**
 * Accept a draft (or fresh generated plan) atomically via the
 * accept_study_plan RPC: proposed items (task_id null) become real tasks in
 * the collection carried on the item itself; existing items keep their
 * task_id. No title matching — two tasks with the same title in different
 * collections stay distinct, and a retry after a lost response returns the
 * committed plan instead of creating duplicates.
 */
export async function acceptPlan(userKey, { planId, date, availableMinutes, rationale, items }) {
  if (!navigator.onLine) {
    return { data: null, error: "You are offline. Reconnect to save the plan.", offline: true };
  }

  const payload = {
    plan_id: planId ?? null,
    plan_date: date,
    available_minutes: availableMinutes ?? null,
    estimated_minutes: items.reduce((sum, i) => sum + (i.estimated_minutes ?? 0), 0),
    rationale: rationale ?? null,
    items: items.map((item, index) => ({
      task_id: item.task_id ?? null,
      title: item.title,
      item_type: item.type ?? "task",
      sequence: index,
      estimated_minutes: item.estimated_minutes ?? null,
      priority: item.priority ?? "medium",
      collection_id: item.task_id ? null : (item.collectionId ?? null),
    })),
  };

  const { data, error } = await supabase.rpc("accept_study_plan", { p_payload: payload });
  if (error) return { data: null, error: error.message, offline: false };
  const result = data ?? {};
  if (result.ok === false) {
    return { data: null, error: result.code ?? "ACCEPT_FAILED", offline: false };
  }
  return {
    data: {
      planId: result.plan_id,
      createdTasks: result.created_tasks ?? 0,
      replay: result.replay ?? false,
    },
    error: null,
    offline: false,
  };
}

/**
 * Set an item's progress status (complete/skip/reopen) from Today. A linked
 * task follows completion/reopen so the plan and the task list never disagree;
 * `skipped` leaves the task untouched (it stays due elsewhere).
 * @returns {Promise<{error: string|null, offline: boolean}>}
 */
export async function setPlanItemStatus(userKey, item, status) {
  if (!navigator.onLine) {
    return { error: "You are offline. Reconnect to update the plan.", offline: true };
  }

  // Accept either the item row or a bare id (older call sites).
  const itemId = typeof item === "string" ? item : item?.id;
  const taskId = typeof item === "string" ? null : item?.task_id;
  if (!itemId) return { error: "Plan item not found.", offline: false };

  const { error } = await supabase
    .from("study_plan_items")
    .update({ status })
    .eq("id", itemId)
    .eq("user_id", userKey);
  if (error) return { error: error.message, offline: false };

  if (taskId && (status === "completed" || status === "pending")) {
    const completed = status === "completed";
    const { error: taskError } = await supabase
      .from("tasks")
      .update({
        completed,
        completed_at: completed ? new Date().toISOString() : null,
        status: completed ? "completed" : "pending",
      })
      .eq("id", taskId)
      .eq("user_id", userKey);
    if (taskError) {
      return {
        error: `Plan item updated, but its task could not be. ${taskError.message}`,
        offline: false,
      };
    }
  }

  return { error: null, offline: false };
}

/** Discard a draft plan. */
export async function discardPlan(userKey, planId) {
  if (!navigator.onLine) {
    return { error: "You are offline. Reconnect to discard the plan.", offline: true };
  }
  const { error } = await supabase
    .from("study_plans")
    .update({ status: "discarded" })
    .eq("id", planId)
    .eq("user_id", userKey);
  return { error: error?.message ?? null, offline: false };
}
