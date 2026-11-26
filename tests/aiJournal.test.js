import { describe, expect, it } from "vitest";
import { createJournal } from "../src/services/ai/aiJournal.js";

// The journal is the durability layer for recovery. These tests use in-memory
// fakes for IndexedDB + sessionStorage so the merge, TTL and ack rules are
// verified without a browser.

function createFakeIdb() {
  const store = new Map();
  return {
    store,
    get: async (key) => store.get(key),
    set: async (key, value) => {
      store.set(key, value);
    },
    del: async (key) => {
      store.delete(key);
    },
    keys: async () => [...store.keys()],
  };
}

function createFakeSession() {
  const map = new Map();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function makeJournal(clock = { value: 1_000 }) {
  const idb = createFakeIdb();
  const session = createFakeSession();
  const journal = createJournal({
    ...idb,
    session,
    now: () => clock.value,
  });
  return { journal, idb, session, clock };
}

const pending = (overrides = {}) => ({
  requestId: "req-1",
  action: "give_hint",
  scope: "task:1",
  payloadHash: "hash",
  startedAt: 1_000,
  status: "pending",
  ...overrides,
});

describe("journal reads and writes", () => {
  it("round-trips an entry after hydration", async () => {
    const { journal } = makeJournal();
    await journal.hydrate("user-a");
    await journal.write("user-a", pending());

    const entry = journal.read("user-a", "give_hint", "task:1");
    expect(entry.requestId).toBe("req-1");
    expect(entry.status).toBe("pending");
  });

  it("does not leak entries across users", async () => {
    const { journal } = makeJournal();
    await journal.hydrate("user-a");
    await journal.write("user-a", pending());

    expect(journal.read("user-b", "give_hint", "task:1")).toBe(null);
    await journal.hydrate("user-b");
    expect(journal.read("user-b", "give_hint", "task:1")).toBe(null);
    expect(journal.read("user-a", "give_hint", "task:1")).toBe(null);
  });

  it("round-trips recovery metadata", async () => {
    const { journal } = makeJournal();
    await journal.hydrate("user-a");
    await journal.write(
      "user-a",
      pending({ action: "regenerate_roadmap_stage", meta: { stageIndex: 2 } })
    );

    expect(
      journal.read("user-a", "regenerate_roadmap_stage", "task:1").meta
    ).toEqual({ stageIndex: 2 });
  });
});

describe("acknowledgement", () => {
  it("clears only a matching request id", async () => {
    const { journal } = makeJournal();
    await journal.hydrate("user-a");
    await journal.write("user-a", pending());

    expect(journal.clear("user-a", "give_hint", "task:1", "other")).toBe(false);
    expect(journal.read("user-a", "give_hint", "task:1")).not.toBe(null);

    expect(journal.clear("user-a", "give_hint", "task:1", "req-1")).toBe(true);
    expect(journal.read("user-a", "give_hint", "task:1")).toBe(null);
  });

  it("does not resurrect a cleared entry on forced rehydration", async () => {
    const { journal } = makeJournal();
    await journal.hydrate("user-a");
    await journal.write("user-a", pending());
    journal.clear("user-a", "give_hint", "task:1", "req-1");

    await journal.hydrate("user-a", { force: true });
    expect(journal.read("user-a", "give_hint", "task:1")).toBe(null);
  });

  it("clears a whole scope except the named action", async () => {
    const { journal } = makeJournal();
    await journal.hydrate("user-a");
    await journal.write("user-a", pending({ requestId: "keep", action: "explain_task" }));
    await journal.write("user-a", pending({ requestId: "drop", action: "give_hint" }));
    await journal.write(
      "user-a",
      pending({ requestId: "other", action: "give_hint", scope: "task:2" })
    );

    journal.clearScope("user-a", "task:1", "explain_task");

    expect(journal.read("user-a", "explain_task", "task:1").requestId).toBe("keep");
    expect(journal.read("user-a", "give_hint", "task:1")).toBe(null);
    expect(journal.read("user-a", "give_hint", "task:2").requestId).toBe("other");
  });
});

describe("storage layers", () => {
  it("never writes the result body to sessionStorage", async () => {
    const { journal, session } = makeJournal();
    await journal.hydrate("user-a");
    await journal.write(
      "user-a",
      pending({ status: "succeeded", result: { secret: "answer" } })
    );

    const raw = session.getItem(journal.keyFor("user-a", "give_hint", "task:1"));
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw).result).toBeUndefined();
  });

  it("merges a newer IndexedDB entry during hydration", async () => {
    const { journal, idb } = makeJournal();
    const key = journal.keyFor("user-a", "give_hint", "task:1");
    await idb.set(key, pending({ requestId: "from-idb", updatedAt: 2_000 }));

    await journal.hydrate("user-a");
    expect(journal.read("user-a", "give_hint", "task:1").requestId).toBe("from-idb");
  });

  it("prefers a newer in-memory write over a stale stored copy", async () => {
    const { journal, idb } = makeJournal();
    const key = journal.keyFor("user-a", "give_hint", "task:1");
    await idb.set(key, pending({ requestId: "stale", updatedAt: 1_000 }));

    await journal.hydrate("user-a");
    await journal.write("user-a", pending({ requestId: "fresh" }));

    expect(journal.read("user-a", "give_hint", "task:1").requestId).toBe("fresh");
  });
});

describe("retention", () => {
  it("drops a pending entry after 24 hours", async () => {
    const { journal, clock } = makeJournal();
    await journal.hydrate("user-a");
    await journal.write("user-a", pending());

    clock.value += 24 * 60 * 60 * 1000 + 1;
    expect(journal.read("user-a", "give_hint", "task:1")).toBe(null);
  });

  it("keeps a completed entry until its longer terminal TTL", async () => {
    const { journal, clock } = makeJournal();
    await journal.hydrate("user-a");
    await journal.write(
      "user-a",
      pending({ status: "succeeded", result: { ok: true } })
    );

    clock.value += 6 * 24 * 60 * 60 * 1000;
    expect(journal.read("user-a", "give_hint", "task:1")).not.toBe(null);

    clock.value += 2 * 24 * 60 * 60 * 1000;
    expect(journal.read("user-a", "give_hint", "task:1")).toBe(null);
  });
});

describe("newest lookup", () => {
  it("picks the most recently started action in a shared scope", async () => {
    const { journal } = makeJournal();
    await journal.hydrate("user-a");
    await journal.write(
      "user-a",
      pending({ requestId: "older", action: "explain_task", startedAt: 1_000 })
    );
    await journal.write(
      "user-a",
      pending({ requestId: "newer", action: "give_hint", startedAt: 2_000 })
    );

    const newest = journal.readNewest(
      "user-a",
      ["explain_task", "give_hint"],
      "task:1"
    );
    expect(newest.requestId).toBe("newer");
  });
});
