import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCacheOwner,
  ensureCacheOwner,
  getCacheOwner,
  scopedKey,
  userCacheKey,
} from "../src/utils/idbCacheOwner.js";

// These run in the Node environment, where ensureCacheOwner() takes the
// "no window" branch: it only updates the in-memory owner marker. That is
// exactly the logic the browser uses to decide which namespace a cache key
// belongs to, so it is testable without IndexedDB.

describe("cache ownership", () => {
  beforeEach(async () => {
    await clearCacheOwner();
  });

  it("refuses to produce a scoped key before a user is resolved", () => {
    expect(getCacheOwner()).toBe(null);
    expect(scopedKey("practice:quizzes")).toBe(null);
  });

  it("namespaces keys with the signed-in user id", async () => {
    await ensureCacheOwner("user-a");
    expect(getCacheOwner()).toBe("user-a");
    expect(scopedKey("practice:quizzes")).toBe("user-a:practice:quizzes");
  });

  it("re-namespaces when the account changes", async () => {
    await ensureCacheOwner("user-a");
    await ensureCacheOwner("user-b");
    expect(scopedKey("practice:quizzes")).toBe("user-b:practice:quizzes");
  });

  it("clears the owner on sign-out", async () => {
    await ensureCacheOwner("user-a");
    await clearCacheOwner();
    expect(getCacheOwner()).toBe(null);
    expect(scopedKey("practice:quizzes")).toBe(null);
  });

  it("treats a null user as a clear request", async () => {
    await ensureCacheOwner("user-a");
    await ensureCacheOwner(null);
    expect(getCacheOwner()).toBe(null);
  });

  it("two accounts can never share a key for the same cache name", async () => {
    await ensureCacheOwner("user-a");
    const a = scopedKey("progress:metrics");
    await ensureCacheOwner("user-b");
    const b = scopedKey("progress:metrics");
    expect(a).not.toBe(b);
  });
});

describe("userCacheKey", () => {
  it("namespaces an explicit user id", () => {
    expect(userCacheKey("user-a", "learning_profile")).toBe("user-a:learning_profile");
  });

  it("returns null when there is no user id", () => {
    expect(userCacheKey(null, "learning_profile")).toBe(null);
    expect(userCacheKey(undefined, "learning_profile")).toBe(null);
  });
});
