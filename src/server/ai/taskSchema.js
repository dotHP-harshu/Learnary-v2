import "server-only"; // boundary: never import this module from a Client Component

// Task + daily-plan action validation. Same rules as roadmapSchema: model
// output is untrusted — re-typed, bounded, and cross-checked before it
// reaches the client. `generate_daily_plan` items may only reference task
// ids that the SERVER passed in as context, so the model can never link
// invented tasks.

import { z } from "zod";
import { AIAppError } from "./config.js";

// ---- shared bounds ---------------------------------------------------------
const LIMITS = {
  title: 140,
  description: 600,
  prose: 2000,
  childTasks: 8,
  planItems: 15,
  hints: 5,
  exercises: 6,
  minutesMin: 5,
  minutesMax: 240,
  planMinutesMax: 480,
};

const cleanText = (max) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .refine((s) => s.length > 0 && s.length <= max, {
      message: `Must be 1–${max} characters`,
    });

const cleanOptionalText = (max) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .refine((s) => s.length <= max, { message: `Max ${max} characters` })
    .transform((s) => s || null)
    .nullable()
    .catch(null);

const minutes = z
  .number()
  .finite()
  .transform((n) => Math.round(n))
  .refine((n) => n >= LIMITS.minutesMin && n <= LIMITS.minutesMax, {
    message: `Estimated minutes must be ${LIMITS.minutesMin}–${LIMITS.minutesMax}`,
  });

const priority = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => ["low", "medium", "high"].includes(v), {
    message: "Unknown priority",
  })
  .catch("medium");

const difficulty = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => ["beginner", "intermediate", "advanced"].includes(v), {
    message: "Unknown difficulty",
  })
  .catch("beginner");

// ---- input schemas ----------------------------------------------------------

/** Shared context sent with task actions (bounded context). */
export const taskContextSchema = z.object({
  title: cleanText(LIMITS.title),
  description: cleanOptionalText(LIMITS.description),
  priority: priority.nullable().optional(),
  difficulty: difficulty.nullable().optional(),
  estimated_minutes: z.number().int().min(0).max(1440).nullable().optional(),
  status: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => ["pending", "in_progress", "completed", "skipped"].includes(v))
    .catch("pending"),
  collection_title: z.string().trim().max(140).nullable().optional(),
});

export const breakdownInputSchema = z.object({
  task: taskContextSchema,
  count: z.number().int().min(2).max(6).catch(4),
  notes: z.string().trim().max(300).nullable().optional(),
});

export const explainInputSchema = z.object({ task: taskContextSchema });
export const hintInputSchema = z.object({ task: taskContextSchema });
export const practiceInputSchema = z.object({ task: taskContextSchema });

/** One pending task offered to the planner (server supplies from the DB). */
export const plannerTaskSchema = z.object({
  task_id: z.string().uuid(),
  title: cleanText(LIMITS.title),
  estimated_minutes: z.number().int().min(0).max(600).nullable().optional(),
  priority: priority.nullable().optional(),
  difficulty: difficulty.nullable().optional(),
  scheduled_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
  overdue: z.boolean().catch(false),
});

export const dailyPlanInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  available_minutes: z.number().int().min(10).max(960),
  // True when `available_minutes` is the 60-minute fallback rather than the
  // learner's saved budget. Persisted with the result so a resumed draft keeps
  // labelling the number as an estimate instead of presenting it as theirs.
  available_minutes_estimated: z.boolean().optional(),
  tasks: z.array(plannerTaskSchema).max(50),
  weekly_study_minutes: z.number().int().min(0).max(10_080).nullable().optional(),
});

// ---- output schemas ---------------------------------------------------------

const childTaskSchema = z.object({
  title: cleanText(LIMITS.title),
  description: cleanOptionalText(LIMITS.description),
  estimated_minutes: minutes.catch(30),
  priority: priority.catch("medium"),
  difficulty: difficulty.catch("beginner"),
});

export const breakdownOutputSchema = z.object({
  child_tasks: z.array(childTaskSchema).min(2).max(LIMITS.childTasks),
});

export const explanationOutputSchema = z.object({
  summary: cleanText(300),
  explanation: cleanText(LIMITS.prose),
  example: cleanOptionalText(LIMITS.prose),
});

export const hintsOutputSchema = z.object({
  hints: z
    .array(cleanText(300))
    .min(1)
    .max(LIMITS.hints),
});

export const practiceOutputSchema = z.object({
  prompt: cleanText(LIMITS.prose),
  exercises: z
    .array(
      z.object({
        question: cleanText(500),
        answer_key: cleanText(LIMITS.prose),
      })
    )
    .min(1)
    .max(LIMITS.exercises),
});

/**
 * Planner output contract. `task_id` nullability is decided by
 * membership: only ids present in the request's `tasks` survive; everything
 * else becomes a proposed task draft (type "task", task_id null).
 */
export const dailyPlanOutputSchema = z.object({
  rationale: cleanText(600),
  assumptions: z.array(cleanText(220)).max(6).catch([]),
  total_estimated_minutes: z
    .number()
    .finite()
    .transform((n) => Math.round(n))
    .refine((n) => n > 0 && n <= LIMITS.planMinutesMax * 4, {
      message: "Plan total out of range",
    })
    .catch(null),
  items: z
    .array(
      z.object({
        task_id: z.string().uuid().nullable().catch(null),
        title: cleanText(LIMITS.title),
        description: cleanOptionalText(LIMITS.description),
        estimated_minutes: minutes,
        priority: priority.catch("medium"),
        sequence: z.number().int().min(1).max(50).catch(1),
        reason: cleanOptionalText(300),
        type: z
          .string()
          .trim()
          .toLowerCase()
          .refine((v) => ["task", "review", "practice"].includes(v))
          .catch("task"),
      })
    )
    .min(1)
    .max(LIMITS.planItems),
});

// ---- helpers ----------------------------------------------------------------

/** Pull the JSON object out of model content (fences, prose). */
function extractJson(content) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const candidate = (fenced?.[1] ?? content).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw invalid();
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw invalid();
  }
}

const invalid = (message = "An unexpected response was returned. Please try again.") =>
  new AIAppError("AI_INVALID_RESPONSE", message);

function parseWith(schema, content, message) {
  try {
    return schema.parse(extractJson(content));
  } catch (error) {
    if (error instanceof AIAppError) throw error;
    throw invalid(message);
  }
}

/** Renumber plan items by sequence, then by array position for ties. */
export function parseDailyPlan(content, offeredTasks) {
  const plan = parseWith(
    dailyPlanOutputSchema,
    content,
    "An unusable plan was returned. Please try again."
  );
  const offeredIds = new Set(offeredTasks.map((t) => t.task_id));
  const items = plan.items
    .map((item, index) => ({
      ...item,
      // The model may only link tasks the user actually has.
      task_id: item.task_id && offeredIds.has(item.task_id) ? item.task_id : null,
      sequence: index + 1, // trust the model's order, not its numbers
    }))
    .sort((a, b) => a.sequence - b.sequence);
  const total =
    plan.total_estimated_minutes ??
    items.reduce((sum, i) => sum + i.estimated_minutes, 0);
  return {
    date: null, // stamped by the client from the local learner date
    rationale: plan.rationale,
    assumptions: plan.assumptions,
    total_estimated_minutes: total,
    items,
  };
}

export function parseBreakdown(content) {
  return parseWith(
    breakdownOutputSchema,
    content,
    "An unusable breakdown was returned. Please try again."
  );
}

export function parseExplanation(content) {
  return parseWith(
    explanationOutputSchema,
    content,
    "An unusable explanation was returned. Please try again."
  );
}

export function parseHints(content) {
  return parseWith(
    hintsOutputSchema,
    content,
    "Unusable hints were returned. Please try again."
  );
}

export function parsePractice(content) {
  return parseWith(
    practiceOutputSchema,
    content,
    "Unusable practice content was returned. Please try again."
  );
}
