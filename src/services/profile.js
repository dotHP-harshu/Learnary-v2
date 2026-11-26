// Learning profile client. Reads fall back to the idb cache when offline; writes
// are online-only (never queued — the user retries instead, matching the offline strategy).

import supabase from "../supabase/supabase";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { userCacheKey } from "../utils/idbCacheOwner";

const CACHE_KEY = "learning_profile";

/** Fields the client may write; everything else is ignored. */
const WRITABLE_FIELDS = [
  "primary_goal",
  "current_level",
  "target_level",
  "study_days",
  "daily_study_minutes",
  "weekly_study_minutes",
  "timezone",
  "preferred_explanation_style",
  "onboarding_completed_at",
];

export function pickWritableFields(fields) {
  const clean = {};
  for (const key of WRITABLE_FIELDS) {
    if (fields[key] !== undefined) clean[key] = fields[key];
  }
  return clean;
}

/**
 * Load the caller's learning profile. Online: fresh read, cached to idb.
 * Offline: last cached profile (or null — no fabricated data).
 * @returns {Promise<{data: object|null, error: string|null, offline: boolean}>}
 */
export async function fetchLearningProfile(userKey) {
  if (!userKey) return { data: null, error: "No signed-in user." };

  if (!navigator.onLine) {
    const key = userCacheKey(userKey, CACHE_KEY);
    const cached = key ? await idbGet(key) : undefined;
    return { data: cached?.user_id === userKey ? cached : null, error: null, offline: true };
  }

  const { data, error } = await supabase
    .from("learning_profiles")
    .select("*")
    .eq("user_id", userKey)
    .maybeSingle();

  if (error) return { data: null, error: error.message, offline: false };

  if (data) {
    const key = userCacheKey(userKey, CACHE_KEY);
    if (key) await idbSet(key, data);
  }
  return { data, error: null, offline: false };
}

/**
 * Create or update the caller's profile (RLS: own rows only).
 * @returns {Promise<{data: object|null, error: string|null, offline: boolean}>}
 */
export async function saveLearningProfile(userKey, fields) {
  if (!userKey) return { data: null, error: "No signed-in user." };
  if (!navigator.onLine) {
    return { data: null, error: "You are offline. Reconnect to save your profile.", offline: true };
  }

  const payload = { user_id: userKey, ...pickWritableFields(fields) };
  const { data, error } = await supabase
    .from("learning_profiles")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .single();

  if (error) return { data: null, error: error.message, offline: false };

  const key = userCacheKey(userKey, CACHE_KEY);
  if (key) await idbSet(key, data);
  return { data, error: null, offline: false };
}

// localStorage fallback for "skipped onboarding" when the DB is unreachable.
// Namespaced per user: a shared browser must not let one account's skip
// decision hide onboarding from the next account, which would leave every assistant
// action without goal/level/time-budget context.
const ONBOARDING_SKIPPED_PREFIX = "learnary.onboarding.skipped";

const onboardingSkippedKey = (userKey) =>
  `${ONBOARDING_SKIPPED_PREFIX}.${userKey}`;

export function isOnboardingSkippedLocally(userKey) {
  if (!userKey) return false;
  try {
    return localStorage.getItem(onboardingSkippedKey(userKey)) === "1";
  } catch {
    return false;
  }
}

export function setOnboardingSkippedLocally(userKey) {
  if (!userKey) return;
  try {
    localStorage.setItem(onboardingSkippedKey(userKey), "1");
  } catch {
    /* private mode: the DB flag remains the source of truth */
  }
}

/** Remove every skip flag (legacy global key included) on sign-out. */
export function clearOnboardingSkippedLocally() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (
        key === ONBOARDING_SKIPPED_PREFIX ||
        key.startsWith(`${ONBOARDING_SKIPPED_PREFIX}.`)
      ) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* storage unavailable — nothing to clear */
  }
}
