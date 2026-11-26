import { describe, expect, it } from "vitest";
import {
  flashcardScope,
  planScope,
  quizAttemptScope,
  quizScope,
  roadmapScope,
  roadmapStageScope,
  taskScope,
  tutorScope,
  weeklyReviewScope,
} from "../src/utils/aiScopes.js";

describe("recovery scopes", () => {
  it("returns null for missing identifiers", () => {
    expect(planScope(null)).toBe(null);
    expect(roadmapScope(null)).toBe(null);
    expect(roadmapStageScope(null)).toBe(null);
    expect(taskScope(null)).toBe(null);
    expect(quizAttemptScope(null)).toBe(null);
  });

  it("builds stable, collision-free keys", () => {
    const scopes = [
      planScope("2026-01-01"),
      roadmapScope("col-1"),
      roadmapStageScope("col-1"),
      taskScope("task-1"),
      quizScope(),
      quizAttemptScope("quiz-1"),
      flashcardScope(),
      weeklyReviewScope(),
      tutorScope("conv-1"),
      tutorScope(null),
    ];
    expect(new Set(scopes).size).toBe(scopes.length);
  });

  it("uses a dedicated new-conversation slot for the tutor", () => {
    expect(tutorScope(null)).toBe("tutor:new");
    expect(tutorScope("conv-1")).toBe("tutor:conv-1");
  });
});
