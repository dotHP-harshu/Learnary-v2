// User-isolated offline cache: a marker clears the whole idb store the moment the
// signed-in user id changes, so an account switch never surfaces the previous user's cached data.
//
// Two layers of protection:
//   1. The owner marker: a different user id wipes the store before it is used
//      (this also covers legacy, unscoped cache keys).
//   2. `scopedKey()` / `userCacheKey()`: cache keys written by the services
//      carry the user id, so even an entry that survived a failed wipe can
//      never be read by another account.
//
// `ensureCacheOwner` is awaited by the auth provider before `loading` is
// cleared. That ordering is what closes the race where a protected page's
// effect read the previous account's cache during sign-in.

import { get as idbGet, set as idbSet, clear as idbClear } from "idb-keyval";
import { clearDataCaches } from "./cacheStorage";

const OWNER_KEY = "cacheOwner";

let activeOwner = null;

/** The user id that currently owns the offline cache (null before auth). */
export function getCacheOwner() {
  return activeOwner;
}

/**
 * Namespace a cache key for the current user. Returns null when no owner is
 * resolved: callers must skip the cache rather than share a global key.
 *
 * @param {string} name
 * @returns {string | null}
 */
export function scopedKey(name) {
  if (!activeOwner) return null;
  return `${activeOwner}:${name}`;
}

/**
 * Namespace a cache key for an explicit user id. Preferred where the caller
 * already has the authenticated user, because it does not depend on module
 * state having been initialised.
 *
 * @param {string | null | undefined} userKey
 * @param {string} name
 * @returns {string | null}
 */
export function userCacheKey(userKey, name) {
  if (!userKey) return null;
  return `${userKey}:${name}`;
}

/**
 * Ensure the IndexedDB cache belongs to `userKey`. Call once per session
 * change (auth provider), and await it before exposing the user to the tree.
 * A falsy `userKey` clears the cache (signed out).
 */
export async function ensureCacheOwner(userKey) {
  if (typeof window === "undefined") {
    activeOwner = userKey ?? null;
    return;
  }
  if (!userKey) {
    await clearCacheOwner();
    return;
  }
  try {
    const owner = await idbGet(OWNER_KEY);
    if (owner !== userKey) {
      await idbClear();
      await idbSet(OWNER_KEY, userKey);
    }
  } catch {
    // Cache isolation is best-effort: a failing IndexedDB must never block
    // the session from resolving. The scoped keys (user id prefix) still
    // prevent one account from reading another's entries.
  }
  activeOwner = userKey;
}

/** Clear offline data for sign-out or an account switch. */
export async function clearCacheOwner() {
  activeOwner = null;
  if (typeof window === "undefined") return;
  try {
    await idbClear();
  } catch {
    /* storage unavailable — nothing to clear */
  }
  await clearDataCaches();
}
