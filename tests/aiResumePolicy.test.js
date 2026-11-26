import { describe, expect, it } from "vitest";
import {
  MAX_WAIT_MS,
  isExpired,
  nextPollDelay,
  nextRetryDelay,
  shouldPoll,
} from "../src/utils/aiResumePolicy.js";

describe("polling backoff", () => {
  it("grows then caps", () => {
    expect(nextPollDelay(0)).toBe(4_000);
    expect(nextPollDelay(1)).toBe(6_000);
    expect(nextPollDelay(2)).toBe(10_000);
    expect(nextPollDelay(3)).toBe(15_000);
    expect(nextPollDelay(10)).toBe(15_000);
  });

  it("backs off faster for lookup failures than for pending work", () => {
    expect(nextRetryDelay(0)).toBe(5_000);
    expect(nextRetryDelay(10)).toBe(30_000);
  });
});

describe("expiry", () => {
  it("measures the deadline from the request start, not the mount", () => {
    const startedAt = 1_000;
    expect(isExpired({ startedAt }, startedAt + MAX_WAIT_MS - 1)).toBe(false);
    expect(isExpired({ startedAt }, startedAt + MAX_WAIT_MS)).toBe(true);
  });

  it("never expires an entry without a start time", () => {
    expect(isExpired({}, Date.now())).toBe(false);
    expect(isExpired(null, Date.now())).toBe(false);
  });
});

describe("visibility", () => {
  it("polls only while the page can make progress", () => {
    expect(shouldPoll("hidden")).toBe(false);
    expect(shouldPoll("visible")).toBe(true);
    expect(shouldPoll("prerender")).toBe(true);
  });
});
