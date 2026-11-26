import "server-only"; // boundary: never import this module from a Client Component

// Practice actions (quiz + flashcards). Model output is untrusted: quiz
// content is re-typed and bounded, MCQ answer keys must match their own
// options, and the sanitized projection strips the key before it ever
// reaches the client (the answer key stays server-side until attempt
// evaluation).

import { z } from "zod";
import { AIAppError } from "./config.js";

export const QUIZ_SCHEMA_VERSION = 1;

// ---- shared bounds ---------------------------------------------------------
const LIMITS = {
  topic: 200,
  notes: 2000,
  prompt: 500,
  option: 200,
  expected: 500,
  explanation: 800,
  concept: 120,
  rubric: 400,
  title: 140,
  front: 300,
  back: 600,
  questionsMin: 3,
  questionsMax: 12,
  optionsMin: 2,
  optionsMax: 6,
  cardsMin: 3,
  cardsMax: 20,
};

const cleanText = (max) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .refine((s) => s.length > 0 && s.length <= max, {
      message: `Must be 1–${max} characters`,
    });

const cleanOptional = (max) =>
  z
    .string()
    // Models routinely send an explicit null for "not applicable" fields;
    // accept it rather than rejecting an otherwise usable quiz.
    .nullable()
    .optional()
    .transform((s) => (s ?? "").replace(/\s+/g, " ").trim() || null)
    .refine((s) => s === null || s.length <= max, {
      message: `Max ${max} characters`,
    });

// ---- input schemas -----------------------------------------------------------

/**
 * Shared context for quiz/flashcard generation.
 * topic/notes come from the client (user's own data — treated as data, not
 * instructions, in the prompt); task_id/collection_id are ownership-checked
 * by the route and only used to fetch context + link the saved row.
 */
export const quizInputSchema = z.object({
  topic: cleanOptional(LIMITS.topic),
  notes: cleanOptional(LIMITS.notes),
  question_count: z.number().int().min(3).max(12).catch(6),
  difficulty: z
    .enum(["mixed", "beginner", "intermediate", "advanced"])
    .catch("mixed"),
  collection_id: z.string().trim().max(128).nullable().optional(),
  task_id: z.string().uuid().nullable().optional(),
});

export const flashcardInputSchema = z.object({
  topic: cleanOptional(LIMITS.topic),
  notes: cleanOptional(LIMITS.notes),
  card_count: z.number().int().min(3).max(20).catch(10),
  collection_id: z.string().trim().max(128).nullable().optional(),
  task_id: z.string().uuid().nullable().optional(),
});

// ---- quiz content (output) ---------------------------------------------------

const quizQuestionSchema = z.object({
  prompt: cleanText(LIMITS.prompt),
  type: z.enum(["mcq", "short_answer"]),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).catch("beginner"),
  // MCQ only; short answers have no options.
  options: z
    .array(cleanText(LIMITS.option))
    .max(LIMITS.optionsMax)
    .nullable()
    .optional(),
  expected_answer: cleanText(LIMITS.expected),
  explanation: cleanText(LIMITS.explanation),
  concept: cleanOptional(LIMITS.concept),
  rubric: cleanOptional(LIMITS.rubric),
});

const quizContentSchema = z.object({
  title: cleanText(LIMITS.title),
  questions: z.array(quizQuestionSchema).min(LIMITS.questionsMin).max(LIMITS.questionsMax),
});

/** Normalize model output into the stored quiz content shape. */
export function parseQuiz(content) {
  const parsed = parseWith(quizContentSchema, content, "An unusable quiz was returned. Please try again.");

  // Deduplicate near-identical prompts.
  const seen = new Set();
  const questions = parsed.questions.filter((q) => {
    const key = q.prompt.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (questions.length < LIMITS.questionsMin) {
    throw invalid("Too few distinct questions were returned. Please try again.");
  }

  const normalized = questions.map((q, index) => {
    if (q.type === "mcq") {
      // The key must match one of the model's own options — anything else is
      // an impossible question.
      const unique = [...new Set(q.options ?? [])];
      if (unique.length < LIMITS.optionsMin) {
        throw invalid("An MCQ without usable options was returned. Please try again.");
      }
      const match = unique.find(
        (o) => o.toLowerCase() === q.expected_answer.toLowerCase()
      );
      if (!match) {
        throw invalid("An MCQ answer was not among its options. Please try again.");
      }
      return {
        ...q,
        index,
        options: unique,
        // Canonical key: exact option casing, so scoring compares cleanly.
        expected_answer: match,
        rubric: "Exact option match",
      };
    }
    // short_answer: rubric is required for assisted evaluation.
    if (!q.rubric) {
      throw invalid("A short-answer question without a rubric was returned. Please try again.");
    }
    return { ...q, index, options: null };
  });

  return { title: parsed.title, questions: normalized };
}

/** Client-facing projection: questions only, no keys. */
export function sanitizeQuizContent(parsed) {
  return {
    title: parsed.title,
    questions: parsed.questions.map((q) => ({
      index: q.index,
      prompt: q.prompt,
      type: q.type,
      difficulty: q.difficulty,
      ...(q.type === "mcq" ? { options: q.options } : {}),
    })),
  };
}

/** Deterministic MCQ scoring: case-insensitive exact match. */
export function scoreMcq(expected, answer) {
  if (typeof answer !== "string") return false;
  return answer.trim().toLowerCase() === expected.toLowerCase();
}

// ---- quiz attempt (input + scoring result) ----------------------------------

export const submitAttemptInputSchema = z.object({
  quiz_id: z.string().uuid(),
  // One entry per question index; null/empty value = skipped question.
  answers: z
    .array(
      z.object({
        index: z.number().int().min(0).max(LIMITS.questionsMax - 1),
        value: z.string().max(LIMITS.expected).nullable().catch(null),
      })
    )
    .max(LIMITS.questionsMax),
});

/**
 * Score one attempt. MCQs are deterministic; short answers are returned for
 * model-assisted evaluation by the route (needs the provider). Throws if the
 * quiz has no questions or the attempt is empty.
 */
export function scoreAttempt(content, answers) {
  const byIndex = new Map(
    (answers ?? []).map((a) => [Number(a.index), a.value ?? null])
  );
  const feedback = [];
  let score = 0;
  const shortAnswers = [];

  content.questions.forEach((q) => {
    const value = byIndex.get(q.index) ?? null;
    if (q.type === "mcq") {
      const correct = scoreMcq(q.expected_answer, value);
      if (correct) score += 1;
      feedback.push({
        index: q.index,
        type: "mcq",
        verdict: value == null || value === "" ? "skipped" : correct ? "correct" : "incorrect",
        given: value,
        expected: q.expected_answer,
        explanation: q.explanation,
        concept: q.concept,
      });
    } else {
      shortAnswers.push({ question: q, given: value, index: q.index });
    }
  });

  return {
    feedback,
    score,
    maxScore: content.questions.length,
    shortAnswers, // pending evaluation (empty for all-MCQ quizzes)
    hasShortAnswers: shortAnswers.length > 0,
  };
}

// ---- flashcards (output) -----------------------------------------------------

const flashcardSchema = z.object({
  front: cleanText(LIMITS.front),
  back: cleanText(LIMITS.back),
  explanation: cleanOptional(LIMITS.back),
});

const flashcardOutputSchema = z.object({
  cards: z.array(flashcardSchema).min(LIMITS.cardsMin).max(LIMITS.cardsMax),
});

export function parseFlashcards(content) {
  const parsed = parseWith(
    flashcardOutputSchema,
    content,
    "Unusable flashcards were returned. Please try again."
  );
  // Deduplicate fronts.
  const seen = new Set();
  const cards = parsed.cards.filter((c) => {
    const key = c.front.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (cards.length < LIMITS.cardsMin) {
    throw invalid("Too few distinct cards were returned. Please try again.");
  }
  return { cards };
}

// ---- short-answer evaluation (submit_quiz_attempt) ----------------------------

const shortAnswerEvaluationsSchema = z.array(
  z.object({
    index: z.number().int().min(0).max(LIMITS.questionsMax - 1),
    verdict: z.enum(["correct", "partial", "incorrect"]),
    confidence: z.enum(["low", "medium", "high"]).catch("medium"),
    feedback: cleanText(LIMITS.explanation),
  })
);

/**
 * Validate the evaluator's JSON for exactly the questions that were sent.
 * Verdicts map to points: correct 1, partial 0.5, incorrect 0 — the score
 * is an indicator for this attempt only.
 */
export function parseShortAnswerEvaluations(content, expectedIndices) {
  let parsed;
  try {
    parsed = shortAnswerEvaluationsSchema.parse(extractJson(content));
  } catch (error) {
    if (error instanceof AIAppError) throw error;
    throw invalid("Could not evaluate your short answers. Please retry — nothing was lost.");
  }
  const byIndex = new Map(parsed.map((e) => [e.index, e]));
  return expectedIndices.map((index) => {
    const evaluation = byIndex.get(index) ?? {
      index,
      verdict: "incorrect",
      confidence: "low",
      feedback: "The evaluator did not return a verdict for this answer.",
    };
    const points =
      evaluation.verdict === "correct" ? 1 : evaluation.verdict === "partial" ? 0.5 : 0;
    return { ...evaluation, points };
  });
}

// ---- shared parse helpers -----------------------------------------------------

const invalid = (message = "An unexpected response was returned. Please try again.") =>
  new AIAppError("AI_INVALID_RESPONSE", message);

function extractJson(content) {
  const text = String(content ?? "");
  // Works for object and array roots (the evaluator replies with an array).
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i !== -1);
  const ends = [text.lastIndexOf("}"), text.lastIndexOf("]")].filter((i) => i !== -1);
  if (!starts.length || !ends.length) {
    throw invalid();
  }
  const start = Math.min(...starts);
  const end = Math.max(...ends);
  if (end <= start) {
    throw invalid();
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw invalid();
  }
}

function parseWith(schema, content, message) {
  try {
    return schema.parse(extractJson(content));
  } catch (error) {
    if (error instanceof AIAppError) throw error;
    throw invalid(message);
  }
}
