import "server-only"; // boundary: never import this module from a Client Component

// Shared learner-context engine: assembles the saved profile/preferences
// each action needs.
//
// ONE server-side source of learner context for every action: the route
// fetches the saved learning profile and each action receives only its
// task-relevant slice — never the whole account history. The slice selection
// and the transparency descriptors are pure functions, so the prompt layer
// and the "this reply uses …" UI can never drift apart.
//
// Ownership: fetchLearnerProfile always runs with the caller's authenticated
// Supabase client — RLS guarantees the row belongs to the caller; a fetch
// failure simply means no profile context (no foreign data is ever seen).
//
// Roadmap actions are deliberately absent from the slice map: their input
// already carries the goal/levels/availability the user confirmed in the
// roadmap form, and injecting the stored profile would duplicate or
// contradict those values.

/** Profile columns any action may need (bounded — no whole-row selects). */
export const LEARNER_PROFILE_COLUMNS =
  "primary_goal, current_level, target_level, study_days, daily_study_minutes, weekly_study_minutes, timezone, preferred_explanation_style";

/**
 * Fetch the caller's saved learning profile. Returns null when there is no
 * profile yet (fresh users) — actions must tolerate missing preferences.
 */
export async function fetchLearnerProfile(supabase, userId) {
  if (!userId) return null;
  const { data } = await supabase
    .from("learning_profiles")
    .select(LEARNER_PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/** Which saved profile preferences each action's prompt receives. */
export const LEARNER_KEYS_BY_ACTION = {
  tutor_chat: ["primary_goal", "current_level", "preferred_explanation_style"],
  explain_task: ["primary_goal", "current_level", "preferred_explanation_style"],
  give_hint: ["primary_goal", "current_level", "preferred_explanation_style"],
  break_down_task: ["primary_goal", "current_level", "daily_study_minutes"],
  generate_practice: ["current_level", "preferred_explanation_style"],
  generate_quiz: ["current_level"],
  generate_flashcards: ["current_level"],
  generate_daily_plan: ["daily_study_minutes", "study_days"],
  generate_weekly_review: ["primary_goal"],
};

const clip = (value, max) =>
  value.length > max ? `${value.slice(0, max)}…` : value;

/**
 * Pure: prompt lines for exactly the requested keys. A key without a saved
 * value produces no line — missing information is never invented.
 */
export function learnerProfileLines(profile, keys = []) {
  if (!profile) return [];
  const lines = [];
  if (keys.includes("primary_goal") && profile.primary_goal) {
    lines.push(`Learner goal: ${clip(profile.primary_goal.trim(), 200)}`);
  }
  if (keys.includes("current_level") && profile.current_level) {
    lines.push(`Current level: ${profile.current_level}`);
  }
  if (keys.includes("target_level") && profile.target_level) {
    lines.push(`Target level: ${profile.target_level}`);
  }
  if (keys.includes("daily_study_minutes") && profile.daily_study_minutes != null) {
    lines.push(`Daily time budget: about ${profile.daily_study_minutes} minutes`);
  }
  if (keys.includes("weekly_study_minutes") && profile.weekly_study_minutes != null) {
    lines.push(`Weekly time budget: about ${profile.weekly_study_minutes} minutes`);
  }
  if (keys.includes("study_days") && Array.isArray(profile.study_days) && profile.study_days.length) {
    lines.push(`Preferred study days: ${profile.study_days.join(", ")}`);
  }
  if (keys.includes("timezone") && profile.timezone) {
    lines.push(`Time zone: ${profile.timezone}`);
  }
  if (keys.includes("preferred_explanation_style") && profile.preferred_explanation_style) {
    lines.push(`Preferred explanation style: ${clip(profile.preferred_explanation_style.trim(), 120)}`);
  }
  return lines;
}

/** Pure: the prompt context block for an action (null when nothing applies). */
export function learnerBlockForAction(action, profile) {
  const lines = learnerProfileLines(profile, LEARNER_KEYS_BY_ACTION[action] ?? []);
  return lines.length ? lines.join("\n") : null;
}

/** Human labels for the transparency indicator. */
const KEY_LABELS = {
  primary_goal: "your learning goal",
  current_level: "your current level",
  target_level: "your target level",
  study_days: "your preferred study days",
  daily_study_minutes: "your daily time budget",
  weekly_study_minutes: "your weekly time budget",
  timezone: "your time zone",
  preferred_explanation_style: "your preferred explanation style",
};

/**
 * Pure: transparency descriptors for the profile slice an action receives —
 * listed only when the corresponding value actually exists.
 */
export function learnerContextUsed(action, profile) {
  if (!profile) return [];
  const keys = LEARNER_KEYS_BY_ACTION[action] ?? [];
  return keys
    .filter((key) => learnerProfileLines(profile, [key]).length > 0)
    .map((key) => KEY_LABELS[key]);
}

/** Descriptors for the object context attached to an action (task/space). */
export function objectContextUsed(contextType) {
  if (contextType === "task") return ["the selected task"];
  if (contextType === "collection") return ["the selected learning space"];
  return [];
}
