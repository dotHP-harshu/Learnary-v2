import { describe, expect, it } from "vitest";
import {
  hashPayload,
  resolveRequestId,
  stableStringify,
} from "../src/utils/aiRequestIdentity.js";

describe("stableStringify", () => {
  it("is independent of object key order", () => {
    const a = stableStringify({ b: 2, a: 1, nested: { y: 1, x: 2 } });
    const b = stableStringify({ nested: { x: 2, y: 1 }, a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("preserves array order", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

describe("hashPayload", () => {
  it("is stable for the same payload regardless of key order", async () => {
    const one = await hashPayload("explain_task", { a: 1, b: 2 }, { task: 1 });
    const two = await hashPayload("explain_task", { b: 2, a: 1 }, { task: 1 });
    expect(one).toBe(two);
  });

  it("changes when the payload changes", async () => {
    const one = await hashPayload("give_hint", {}, { task: { id: "a" } });
    const two = await hashPayload("give_hint", {}, { task: { id: "b" } });
    expect(one).not.toBe(two);
  });

  it("changes when the action changes", async () => {
    const one = await hashPayload("explain_task", {}, {});
    const two = await hashPayload("give_hint", {}, {});
    expect(one).not.toBe(two);
  });
});

describe("resolveRequestId", () => {
  it("reuses the id only for an in-flight payload with a matching hash", () => {
    const existing = { requestId: "req-1", payloadHash: "hash-a", status: "pending" };
    expect(
      resolveRequestId({ existing, identity: "hash-a", newId: "req-2" })
    ).toBe("req-1");
    expect(
      resolveRequestId({ existing, identity: "hash-b", newId: "req-2" })
    ).toBe("req-2");
  });

  it("never reuses an id after the request reached a terminal state", () => {
    const existing = {
      requestId: "req-1",
      payloadHash: "hash-a",
      status: "succeeded",
    };
    expect(
      resolveRequestId({ existing, identity: "hash-a", newId: "req-2" })
    ).toBe("req-2");
  });

  it("uses the new id when there is no existing entry", () => {
    expect(
      resolveRequestId({ existing: null, identity: "hash-a", newId: "req-2" })
    ).toBe("req-2");
  });
});
