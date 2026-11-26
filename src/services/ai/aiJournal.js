// Durable, user-scoped journal for in-flight assistant requests.
//
// Layers:
//   1. An in-memory Map — synchronous reads/writes, so an ack is visible
//      immediately and a recovery poll cannot race a caller that just applied
//      the result.
//   2. IndexedDB (idb-keyval) — survives reloads and tab discards, and is
//      shared by every tab of the same origin.
//   3. sessionStorage — a synchronous metadata mirror (never the result body)
//      so a reload can still find the request id even if the IDB write was
//      interrupted.
//
// Entries are keyed by user + action + scope: one recoverable slot per feature
// instance. The request id is the server-side idempotency key; the payload is
// stored only as a hash.

import {
  get as idbGet,
  set as idbSet,
  del as idbDel,
  keys as idbKeys,
} from "idb-keyval";

const PREFIX = "learnary:ai:req:";

// A pending row cannot outlive the server's 90 s deadline, but the client may
// be offline for a while. Keep the id long enough to retry later; the hook
// stops waiting after MAX_WAIT_MS and the server reports a stale row as failed.
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
// A completed result is useful until the learner returns to the feature. Keep
// it long enough for that, but not forever.
const TERMINAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// An ack removes the entry from memory first and from IDB asynchronously. A
// forced re-hydration during that window must not resurrect it.
const TOMBSTONE_MS = 30_000;

const keyFor = (userKey, action, scope) =>
  `${PREFIX}${userKey}:${action}:${scope ?? "default"}`;

function isStale(entry, now) {
  const ttl = entry.status === "pending" ? PENDING_TTL_MS : TERMINAL_TTL_MS;
  const at = entry.updatedAt ?? entry.startedAt ?? 0;
  return now - at > ttl;
}

function metadataOnly(entry) {
  if (!entry) return null;
  const rest = { ...entry };
  delete rest.result;
  return rest;
}

/**
 * @param {{
 *   get: (key: string) => Promise<any>,
 *   set: (key: string, value: any) => Promise<any>,
 *   del: (key: string) => Promise<any>,
 *   keys: () => Promise<string[]>,
 *   session?: Storage | null,
 *   now?: () => number,
 * }} options
 */
export function createJournal({
  get,
  set,
  del,
  keys,
  session = null,
  now = () => Date.now(),
} = {}) {
  let memory = new Map();
  let currentUserKey = null;
  let hydrated = false;
  let hydrating = null;
  let hydratingUser = null;
  const tombstones = new Map(); // key -> expiresAt

  const tombstoned = (key) => {
    const until = tombstones.get(key);
    if (!until) return false;
    if (until <= now()) {
      tombstones.delete(key);
      return false;
    }
    return true;
  };

  const readSession = (key) => {
    if (!session) return null;
    try {
      const raw = session.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const writeSession = (key, entry) => {
    if (!session) return;
    try {
      session.setItem(key, JSON.stringify(metadataOnly(entry)));
    } catch {
      /* quota/unavailable — IDB and memory still work */
    }
  };

  const removeSession = (key) => {
    if (!session) return;
    try {
      session.removeItem(key);
    } catch {
      /* noop */
    }
  };

  const sessionKeys = () => {
    if (!session) return [];
    const out = [];
    try {
      for (let i = 0; i < session.length; i++) {
        const key = session.key(i);
        if (key?.startsWith(PREFIX)) out.push(key);
      }
    } catch {
      /* noop */
    }
    return out;
  };

  const drop = (key) => {
    memory.delete(key);
    removeSession(key);
    tombstones.set(key, now() + TOMBSTONE_MS);
    try {
      Promise.resolve(del?.(key)).catch(() => {
        /* IDB unavailable — the tombstone still blocks rehydration */
      });
    } catch {
      /* IDB unavailable — the tombstone still blocks rehydration */
    }
  };

  async function hydrate(userKey, { force = false } = {}) {
    if (!userKey) {
      memory = new Map();
      currentUserKey = null;
      hydrated = false;
      return;
    }
    if (!force && hydrated && currentUserKey === userKey) return;
    if (hydrating && hydratingUser === userKey) return hydrating;

    hydratingUser = userKey;
    hydrating = (async () => {
      const previous = memory;
      const next = new Map();
      const userPrefix = `${PREFIX}${userKey}:`;

      for (const key of sessionKeys()) {
        if (!key.startsWith(userPrefix) || tombstoned(key)) continue;
        const entry = readSession(key);
        if (entry) next.set(key, entry);
      }

      if (keys && get) {
        try {
          const storedKeys = await keys();
          for (const key of storedKeys ?? []) {
            if (typeof key !== "string" || !key.startsWith(userPrefix)) continue;
            if (tombstoned(key)) continue;
            const entry = await get(key);
            if (!entry) continue;
            const existing = next.get(key);
            if (!existing || (entry.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
              next.set(key, entry);
            }
          }
        } catch {
          /* IndexedDB unavailable — session/memory still work */
        }
      }

      // Keep a local write that has not reached IDB yet.
      for (const [key, entry] of previous) {
        if (!key.startsWith(userPrefix) || tombstoned(key)) continue;
        const existing = next.get(key);
        if (!existing || (entry.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
          next.set(key, entry);
        }
      }

      memory = next;
      currentUserKey = userKey;
      hydrated = true;
      prune();
    })();

    try {
      await hydrating;
    } finally {
      hydrating = null;
      hydratingUser = null;
    }
  }

  function read(userKey, action, scope) {
    if (!userKey || userKey !== currentUserKey) return null;
    const key = keyFor(userKey, action, scope);
    if (tombstoned(key)) return null;
    const entry = memory.get(key) ?? readSession(key);
    if (!entry) return null;
    if (isStale(entry, now())) {
      drop(key);
      return null;
    }
    if (!memory.has(key)) memory.set(key, entry);
    return entry;
  }

  function readNewest(userKey, actions, scope) {
    let newest = null;
    for (const action of actions ?? []) {
      const entry = read(userKey, action, scope);
      if (entry && (!newest || (entry.startedAt ?? 0) > (newest.startedAt ?? 0))) {
        newest = entry;
      }
    }
    return newest;
  }

  async function write(userKey, entry) {
    if (!userKey || !entry?.action) return null;
    const stored = { ...entry, updatedAt: now() };
    const key = keyFor(userKey, stored.action, stored.scope);
    tombstones.delete(key);
    memory.set(key, stored);
    writeSession(key, stored);
    try {
      await set?.(key, stored);
    } catch {
      /* memory + session still carry the handle */
    }
    return stored;
  }

  function clear(userKey, action, scope, requestId) {
    if (!userKey) return false;
    const key = keyFor(userKey, action, scope);
    const entry = memory.get(key) ?? readSession(key);
    if (requestId && entry?.requestId && entry.requestId !== requestId) {
      return false;
    }
    drop(key);
    return true;
  }

  function clearScope(userKey, scope, exceptAction) {
    if (!userKey) return;
    const userPrefix = `${PREFIX}${userKey}:`;
    for (const [key, entry] of [...memory]) {
      if (!key.startsWith(userPrefix) || entry.scope !== scope) continue;
      if (exceptAction && entry.action === exceptAction) continue;
      drop(key);
    }
  }

  function list(userKey) {
    if (!userKey || userKey !== currentUserKey) return [];
    const at = now();
    const userPrefix = `${PREFIX}${userKey}:`;
    const out = [];
    for (const [key, entry] of [...memory]) {
      if (!key.startsWith(userPrefix)) continue;
      if (isStale(entry, at)) {
        drop(key);
        continue;
      }
      out.push(entry);
    }
    return out;
  }

  function prune() {
    const at = now();
    for (const [key, entry] of [...memory]) {
      if (isStale(entry, at)) drop(key);
    }
    for (const [key, until] of [...tombstones]) {
      if (until <= at) tombstones.delete(key);
    }
  }

  return {
    hydrate,
    read,
    readNewest,
    write,
    clear,
    clearScope,
    list,
    prune,
    keyFor,
    isStale,
  };
}

const browserSession = (() => {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
})();

export const journal = createJournal({
  get: idbGet,
  set: idbSet,
  del: idbDel,
  keys: idbKeys,
  session: browserSession,
});
