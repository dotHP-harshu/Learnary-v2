import { describe, expect, it } from "vitest";
import {
  addDays,
  formatPlanDate,
  lastNDays,
  learnerDayKey,
  learnerToday,
  weekdayIndex,
} from "../src/utils/learnerDate.js";

describe("learnerDayKey", () => {
  it("buckets the same instant into different days per time zone", () => {
    const instant = "2026-01-01T20:00:00Z";
    expect(learnerDayKey(instant, "Asia/Tokyo")).toBe("2026-01-02");
    expect(learnerDayKey(instant, "America/Los_Angeles")).toBe("2026-01-01");
    expect(learnerDayKey(instant, "UTC")).toBe("2026-01-01");
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(learnerDayKey(new Date("2026-01-01T20:00:00Z"), "Asia/Tokyo")).toBe("2026-01-02");
  });

  it("falls back to the device zone for an invalid time zone instead of throwing", () => {
    expect(learnerDayKey("2026-01-01T20:00:00Z", "Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("learnerToday", () => {
  it("returns a YYYY-MM-DD string even for an invalid time zone", () => {
    expect(learnerToday("Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("agrees with the day key of the current instant", () => {
    const tz = "Asia/Tokyo";
    expect(learnerToday(tz)).toBe(learnerDayKey(new Date(), tz));
  });
});

describe("date-string helpers", () => {
  it("adds and subtracts days across month and year boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-11-24", 0)).toBe("2026-11-24");
  });

  it("does not consult the device zone (DST-safe day arithmetic)", () => {
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // US DST start
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02"); // US DST end
  });

  it("builds an oldest-first window ending at the given day", () => {
    expect(lastNDays("2026-11-24", 3)).toEqual([
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
    ]);
  });

  it("computes a zone-independent weekday index", () => {
    expect(weekdayIndex("2026-11-24")).toBe(2); // Tuesday
    expect(weekdayIndex("2026-11-29")).toBe(0); // Sunday
  });

  it("formats a plain date without throwing", () => {
    expect(typeof formatPlanDate("2026-11-24")).toBe("string");
    expect(formatPlanDate("2026-11-24")).not.toBe("");
  });
});
