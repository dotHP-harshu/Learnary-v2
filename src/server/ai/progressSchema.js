import "server-only"; // boundary: never import this module from a Client Component

// Weekly review action. The client aggregates its own metrics from source
// rows (learner timezone) and sends the bounded numbers; the model may only
// cite those numbers and must not infer mastery. Output is re-typed and
// bounded before display.

import { z } from "zod";
import { AIAppError } from "./config.js";

// ---- input: bounded metrics (aggregate metrics only) ------------------------

export const weeklyReviewInputSchema = z.object({
  period_days: z.number().int().min(7).max(28).catch(7),
  timezone: z.string().trim().max(60).optional(),
  metrics: z.object({
    tasks_completed: z.number().int().min(0).max(2000),
    active_days: z.number().int().min(0).max(90),
    cards_reviewed: z.number().int().min(0).max(5000),
    due_cards: z.number().int().min(0).max(5000),
    quiz_attempts: z.number().int().min(0).max(200),
    avg_quiz_score: z.number().int().min(0).max(100).nullable().catch(null),
    roadmap_steps_completed: z.number().int().min(0).max(500),
    milestones_completed: z.number().int().min(0).max(200),
    overdue_tasks: z.number().int().min(0).max(500),
    inactive_days: z.number().int().min(0).max(365).catch(0),
  }),
});

// ---- output ------------------------------------------------------------------

const cleanText = (max) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .refine((s) => s.length > 0 && s.length <= max, {
      message: `Must be 1–${max} characters`,
    });

const weeklyReviewOutputSchema = z.object({
  summary: cleanText(900),
  highlights: z.array(cleanText(220)).max(5).catch([]),
  focus_areas: z
    .array(
      z.object({
        area: cleanText(120),
        // Every recommendation must cite the evidence it is based
        // on (e.g. "3 of 5 planned sessions completed").
        evidence: z.string().transform((s) => s.trim().slice(0, 220)),
      })
    )
    .max(4)
    .catch([]),
  next_steps: z.array(cleanText(220)).min(1).max(5),
  // Shown only after inactivity — gentle, never punitive.
  restart_note: cleanText(300).nullable().catch(null),
});

const invalid = (message = "The weekly review came back unusable. Please try again.") =>
  new AIAppError("AI_INVALID_RESPONSE", message);

export function parseWeeklyReview(content) {
  const text = String(content ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw invalid();
  let parsed;
  try {
    parsed = weeklyReviewOutputSchema.parse(JSON.parse(text.slice(start, end + 1)));
  } catch (error) {
    if (error instanceof AIAppError) throw error;
    throw invalid();
  }
  // The restart note is only meaningful after real inactivity.
  return {
    ...parsed,
    restart_note: parsed.restart_note,
  };
}
