import { describe, expect, it } from "vitest";
import { ALGORITHM, scheduleNext } from "../src/utils/spacedRepetition.js";

const NOW = new Date("2026-11-24T12:00:00Z");
const c = ALGORITHM.constants;

describe("scheduleNext", () => {
  it("'again' re-shows the card in 10 minutes and drops ease", () => {
    const result = scheduleNext({ rating: "again", easeFactor: 2.5, now: NOW });
    expect(result.intervalDays).toBe(0);
    expect(result.nextReviewAt).toBe(
      new Date(NOW.getTime() + c.AGAIN_MINUTES * 60_000).toISOString()
    );
    expect(result.easeFactor).toBe(2.3);
  });

  it("'again' clamps ease at the minimum", () => {
    const result = scheduleNext({ rating: "again", easeFactor: 1.3, now: NOW });
    expect(result.easeFactor).toBe(c.EASE_MIN);
  });

  it("'hard' starts at one day and multiplies an existing interval", () => {
    expect(scheduleNext({ rating: "hard", intervalDays: 0, easeFactor: 2.5, now: NOW }).intervalDays).toBe(1);
    expect(scheduleNext({ rating: "hard", intervalDays: 10, easeFactor: 2.5, now: NOW }).intervalDays).toBe(12);
  });

  it("'hard' always advances by at least a day (1→2, 2→3, never stuck)", () => {
    expect(scheduleNext({ rating: "hard", intervalDays: 1, easeFactor: 2.5, now: NOW }).intervalDays).toBe(2);
    expect(scheduleNext({ rating: "hard", intervalDays: 2, easeFactor: 2.5, now: NOW }).intervalDays).toBe(3);
  });

  it("repeated 'hard' ratings keep growing", () => {
    let intervalDays = 0;
    for (let i = 0; i < 6; i += 1) {
      const next = scheduleNext({ rating: "hard", intervalDays, easeFactor: 2.5, now: NOW });
      expect(next.intervalDays).toBeGreaterThan(intervalDays);
      intervalDays = next.intervalDays;
    }
  });

  it("'good' uses the ease factor on an existing interval", () => {
    const result = scheduleNext({ rating: "good", intervalDays: 2, easeFactor: 2.5, now: NOW });
    expect(result.intervalDays).toBe(5);
    expect(result.nextReviewAt).toBe(new Date(NOW.getTime() + 5 * 86_400_000).toISOString());
  });

  it("'easy' starts at three days and applies the bonus", () => {
    expect(scheduleNext({ rating: "easy", intervalDays: 0, easeFactor: 2.5, now: NOW }).intervalDays).toBe(3);
    // ease 2.5 -> 2.65, interval round(2 * 2.65 * 1.3) = 7
    expect(scheduleNext({ rating: "easy", intervalDays: 2, easeFactor: 2.5, now: NOW }).intervalDays).toBe(7);
  });

  it("caps any interval at MAX_DAYS", () => {
    const result = scheduleNext({ rating: "good", intervalDays: 300, easeFactor: 3.0, now: NOW });
    expect(result.intervalDays).toBe(c.MAX_DAYS);
  });

  it("treats a missing ease factor as the starting ease", () => {
    const result = scheduleNext({ rating: "good", intervalDays: 0, now: NOW });
    expect(result.easeFactor).toBe(c.EASE_START);
  });

  it("clamps out-of-range ease values into [EASE_MIN, EASE_MAX]", () => {
    expect(scheduleNext({ rating: "good", easeFactor: 99, now: NOW }).easeFactor).toBe(c.EASE_MAX);
    expect(scheduleNext({ rating: "good", easeFactor: 0.1, now: NOW }).easeFactor).toBe(c.EASE_MIN);
  });

  it("stays deterministic for a fixed clock", () => {
    const a = scheduleNext({ rating: "good", intervalDays: 1, easeFactor: 2.5, now: NOW });
    const b = scheduleNext({ rating: "good", intervalDays: 1, easeFactor: 2.5, now: NOW });
    expect(a).toEqual(b);
  });
});
