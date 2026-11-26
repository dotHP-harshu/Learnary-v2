// Roadmap client. Persistence happens only when the user accepts a draft; task
// creation is a separate explicit step. Reads fall back to the idb cache when offline.

import supabase from "../supabase/supabase";
import { get as idbGet, set as idbSet } from "idb-keyval";

const cacheKey = (collectionId) => `roadmap:${collectionId}`;

/**
 * Load the collection's saved roadmap (nested stages → milestones → steps)
 * plus its prerequisite pairs. Offline: last cached snapshot.
 * @returns {Promise<{data: object|null, error: string|null, offline: boolean}>}
 */
export async function fetchRoadmap(collectionId, userKey) {
  if (!collectionId || !userKey) {
    return { data: null, error: "Missing collection or user.", offline: false };
  }

  if (!navigator.onLine) {
    const cached = await idbGet(cacheKey(collectionId));
    return {
      data: cached?.roadmap?.user_id === userKey ? cached : null,
      error: null,
      offline: true,
    };
  }

  const { data, error } = await supabase
    .from("learning_roadmaps")
    .select(
      `*,
       roadmap_stages (
         *,
         roadmap_milestones (
           *,
           roadmap_steps ( * )
         )
       )`
    )
    .eq("collection_id", collectionId)
    .eq("user_id", userKey)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { data: null, error: error.message, offline: false };
  if (!data) return { data: null, error: null, offline: false };

  const { data: prereqs, error: prereqError } = await supabase
    .from("roadmap_step_prerequisites")
    .select("step_id, prerequisite_step_id")
    .eq("roadmap_id", data.id);

  if (prereqError) return { data: null, error: prereqError.message, offline: false };

  const stages = (data.roadmap_stages ?? [])
    .sort((a, b) => a.order_index - b.order_index)
    .map((stage) => ({
      ...stage,
      roadmap_milestones: (stage.roadmap_milestones ?? [])
        .sort((a, b) => a.order_index - b.order_index)
        .map((milestone) => ({
          ...milestone,
          roadmap_steps: (milestone.roadmap_steps ?? []).sort(
            (a, b) => a.order_index - b.order_index
          ),
        })),
    }));

  const snapshot = { roadmap: { ...data, roadmap_stages: stages }, prerequisites: prereqs ?? [] };
  await idbSet(cacheKey(collectionId), snapshot);
  return { data: snapshot, error: null, offline: false };
}

/**
 * Persist an accepted draft atomically via the save_roadmap RPC — or, when
 * `previousRoadmapId` is given, via replace_roadmap (edit a saved roadmap).
 * Either way, roadmap → stages → milestones → steps → prerequisite pairs
 * commit in one transaction, so a failure anywhere leaves no partial
 * roadmap. Prerequisite pairs carry draft step numbers; the server resolves
 * them to the inserted ids (a missing number rolls everything back). Cycle
 * rejection stays client-side.
 *
 * Editing path: steps converted from a saved snapshot carry
 * `existing_step_id` (re-links that step's tasks) and `status` (progress
 * carried forward); steps added in the editor carry neither and start as
 * not_started.
 *
 * @param {string} collectionId     the text collection_id
 * @param {string} userKey          canonical user id (unused by the RPC,
 *                                  which derives the caller from auth.uid())
 * @param {object} draft            client draft (see src/utils/roadmapDraft.js)
 * @param {{previousRoadmapId?: string|null}} [options]
 * @returns {Promise<{data: object|null, error: string|null, offline: boolean}>}
 */
export async function saveRoadmap(collectionId, userKey, draft, options = {}) {
  if (!navigator.onLine) {
    return { data: null, error: "You are offline. Reconnect to save the roadmap.", offline: true };
  }

  // Prerequisite pairs [step_number, prerequisite_step_number] from the draft.
  const prerequisites = [];
  for (const stage of draft.stages) {
    for (const milestone of stage.milestones) {
      for (const step of milestone.steps) {
        for (const ref of step.prerequisite_steps ?? []) {
          prerequisites.push([step.step_number, ref]);
        }
      }
    }
  }

  const payload = {
    collection_id: collectionId,
    title: draft.title,
    goal: draft.goal,
    current_level: draft.current_level ?? null,
    target_level: draft.target_level ?? null,
    estimated_total_minutes: draft.estimated_total_minutes ?? null,
    stages: draft.stages.map((stage) => ({
      title: stage.title,
      description: stage.description ?? null,
      milestones: (stage.milestones ?? []).map((milestone) => ({
        title: milestone.title,
        description: milestone.description ?? null,
        steps: (milestone.steps ?? []).map((step) => ({
          step_number: step.step_number,
          title: step.title,
          description: step.description ?? null,
          learning_objective: step.learning_objective ?? null,
          estimated_minutes: step.estimated_minutes ?? null,
          difficulty: step.difficulty ?? null,
          task_type: step.task_type ?? null,
          status: step.status ?? null,            // carried from the snapshot
          old_step_id: step.existing_step_id ?? null, // task re-link key
        })),
      })),
    })),
    prerequisites,
  };

  const rpcName = options.previousRoadmapId ? "replace_roadmap" : "save_roadmap";
  const rpcArgs = options.previousRoadmapId
    ? { p_payload: payload, p_previous_roadmap_id: options.previousRoadmapId }
    : { p_payload: payload };

  const { data, error } = await supabase.rpc(rpcName, rpcArgs);
  if (error) return { data: null, error: error.message, offline: false };
  const result = data ?? {};
  if (result.ok === false) {
    return { data: null, error: result.code ?? "SAVE_FAILED", offline: false };
  }
  return { data: { roadmapId: result.roadmap_id }, error: null, offline: false };
}

/**
 * Create tasks from selected roadmap steps. Caller is responsible for
 * duplicate prevention (the UI filters already-created steps before offering
 * the checkboxes).
 * @returns {Promise<{data: number|null, error: string|null, offline: boolean}>}
 */
export async function createTasksFromSteps(collectionId, userKey, steps) {
  if (!navigator.onLine) {
    return { data: null, error: "You are offline. Reconnect to create tasks.", offline: true };
  }

  // Each task carries its source step id (`tasks.roadmap_step_id`) — a stable
  // link instead of title matching, so duplicate
  // prevention and step-status propagation work across renames.
  const rows = steps.map((step) => ({
    collection_id: collectionId,
    user_id: userKey,
    roadmap_step_id: step.id,
    title: step.title,
    description: step.description,
    difficulty: step.difficulty,
    estimated_minutes: step.estimated_minutes ?? null,
    status: "pending",
    completed: false,
    source: "roadmap",
  }));

  const { error } = await supabase.from("tasks").insert(rows);
  if (error) return { data: null, error: error.message, offline: false };
  return { data: rows.length, error: null, offline: false };
}

/**
 * Set one roadmap step's status (not_started/in_progress/completed/skipped —
 * the DB check constraint validates the value). Checked update: the returned
 * rows distinguish "saved" from "step no longer visible" (deleted elsewhere),
 * which Supabase would otherwise report as success. Online-only like every
 * other write.
 */
export async function updateStepStatus(stepId, status) {
  if (!navigator.onLine) {
    return { data: null, error: "You are offline — reconnect to update progress.", offline: true };
  }
  const { data, error } = await supabase
    .from("roadmap_steps")
    .update({ status })
    .eq("id", stepId)
    .select("id");
  if (error) return { data: null, error: error.message, offline: false };
  if (!data || data.length === 0) {
    return { data: null, error: "STEP_NOT_FOUND", offline: false };
  }
  return { data: true, error: null, offline: false };
}
