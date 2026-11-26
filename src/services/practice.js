// Practice client service. Quizzes + flashcards persist in Supabase; offline reads
// fall back to the idb cache; generation and attempt submission go through /api/learnary-ai.

import supabase from "../supabase/supabase";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { callAI, describeAIError } from "./ai/aiClient";
import { scheduleNext, ALGORITHM } from "../utils/spacedRepetition";
import { scopedKey } from "../utils/idbCacheOwner";

const QUIZZES_CACHE = "practice:quizzes";
const CARDS_CACHE = "practice:cards";

// Offline caches are namespaced per signed-in user. `scopedKey` returns null
// before the auth provider has resolved the owner — in that case we never read
// or write, rather than falling back to a shared key.
const readCache = async (name) => {
  const key = scopedKey(name);
  return key ? idbGet(key) : undefined;
};
const writeCache = async (name, value) => {
  const key = scopedKey(name);
  if (key) await idbSet(key, value);
};

// ---- quizzes -----------------------------------------------------------------

/**
 * Generate a quiz (assistant, online-only). Returns the server-saved quiz with the
 * sanitized content — no answer keys.
 */
export async function generateQuiz(input, { resumeScope } = {}) {
  const result = await callAI("generate_quiz", { input, resumeScope });
  return result;
}

/** Recent quizzes, newest first (history + retry entry points). */
export async function listQuizzes() {
  if (!navigator.onLine) {
    const cached = await readCache(QUIZZES_CACHE);
    return { data: cached ?? [], error: null, offline: true };
  }
  const { data, error } = await supabase
    .from("quizzes")
    .select("id, title, source, collection_id, task_id, created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { data: null, error: error.message, offline: false };
  await writeCache(QUIZZES_CACHE, data ?? []);
  return { data: data ?? [], error: null, offline: false };
}

/**
 * Load one quiz FOR THE RUNNER. The projection is computed server-side by
 * `get_quiz_for_attempt`, which returns questions without `expected_answer`
 * / `rubric` / `explanation`. The runner never reads
 * `quizzes.content` directly: RLS is row-level, so a direct select would ship
 * the answer keys to the browser before the attempt is submitted.
 */
export async function getQuizForAttempt(quizId) {
  if (!navigator.onLine) {
    return {
      data: null,
      error: "You're offline — quizzes need an internet connection.",
      offline: true,
    };
  }
  const { data, error } = await supabase.rpc("get_quiz_for_attempt", {
    p_quiz_id: quizId,
  });
  if (error) return { data: null, error: error.message, offline: false };
  if (!data) return { data: null, error: "Quiz not found.", offline: false };
  return { data, error: null, offline: false };
}

/**
 * Submit an attempt (assistant route: deterministic MCQ scoring + assisted short
 * answers). Returns score, per-question feedback (with explanations — safe
 * post-submission), and evaluation_type ('deterministic' | 'ai_assisted').
 */
export async function submitQuizAttempt(quizId, answers, { resumeScope } = {}) {
  const result = await callAI("submit_quiz_attempt", {
    input: { quiz_id: quizId, answers },
    resumeScope,
  });
  return result;
}

/** Append-only attempt history for one quiz. */
export async function listAttempts(quizId) {
  if (!navigator.onLine) return { data: [], error: null, offline: true };
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select("id, score, max_score, evaluation_type, completed_at")
    .eq("quiz_id", quizId)
    .order("completed_at", { ascending: false })
    .limit(10);
  return { data: data ?? [], error: error?.message ?? null, offline: false };
}

/** Discard a generated-but-not-taken quiz. */
export async function deleteQuiz(quizId) {
  const { error } = await supabase.from("quizzes").delete().eq("id", quizId);
  return { error: error?.message ?? null };
}

// ---- flashcards ---------------------------------------------------------------

/**
 * Generate flashcard candidates (assistant, online-only). Nothing is persisted —
 * the user previews and saves the selected cards.
 */
export async function generateFlashcards(input, { resumeScope } = {}) {
  const result = await callAI("generate_flashcards", { input, resumeScope });
  return result;
}

/** Save selected cards (persist only on acceptance). */
export async function saveGeneratedCards(userKey, cards, refs = {}) {
  if (!navigator.onLine) {
    return { data: null, error: "You're offline — saving needs a connection." };
  }
  const rows = cards.map((c) => ({
    user_id: userKey,
    front: c.front,
    back: c.back,
    explanation: c.explanation || null,
    source: "ai",
    collection_id: refs.collection_id || null,
    task_id: refs.task_id || null,
  }));
  const { data, error } = await supabase.from("flashcards").insert(rows).select();
  return { data, error: error?.message ?? null };
}

/** Manual card creation. */
export async function createCard(userKey, { front, back, explanation }, refs = {}) {
  if (!navigator.onLine) {
    return { data: null, error: "You're offline — saving needs a connection." };
  }
  const { data, error } = await supabase
    .from("flashcards")
    .insert({
      user_id: userKey,
      front,
      back,
      explanation: explanation || null,
      source: "manual",
      collection_id: refs.collection_id || null,
      task_id: refs.task_id || null,
    })
    .select()
    .single();
  return { data, error: error?.message ?? null };
}

/** Card list (management surface). */
export async function listCards() {
  if (!navigator.onLine) {
    const cached = await readCache(CARDS_CACHE);
    return { data: cached ?? [], error: null, offline: true };
  }
  const { data, error } = await supabase
    .from("flashcards")
    .select("id, front, back, explanation, source, status, next_review_at, interval_days, ease_factor, review_count, collection_id, task_id, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { data: null, error: error.message, offline: false };
  await writeCache(CARDS_CACHE, data ?? []);
  return { data: data ?? [], error: null, offline: false };
}

export async function updateCard(cardId, patch) {
  if (!navigator.onLine) {
    return { error: "You're offline — editing needs a connection." };
  }
  const { error } = await supabase
    .from("flashcards")
    .update(patch)
    .eq("id", cardId);
  return { error: error?.message ?? null };
}

export async function setCardStatus(cardId, status) {
  return updateCard(cardId, { status });
}

/**
 * Delete a card. Its review logs cascade; deleting source content only
 * unlinks cards (FK `on delete set null`) — the user-facing rule is
 * "cards survive, source link cleared".
 */
export async function deleteCard(cardId) {
  if (!navigator.onLine) {
    return { error: "You're offline — deleting needs a connection." };
  }
  const { error } = await supabase.from("flashcards").delete().eq("id", cardId);
  return { error: error?.message ?? null };
}

/** Cards due for review, oldest schedule first. */
export async function listDueCards(limit = 20) {
  if (!navigator.onLine) {
    const cached = await readCache("practice:due");
    return { data: cached ?? [], error: null, offline: true };
  }
  const { data, error } = await supabase
    .from("flashcards")
    .select("id, front, back, explanation, interval_days, ease_factor, review_count")
    .eq("status", "active")
    .lte("next_review_at", new Date().toISOString())
    .order("next_review_at", { ascending: true })
    .limit(limit);
  if (error) return { data: null, error: error.message, offline: false };
  await writeCache("practice:due", data ?? []);
  return { data: data ?? [], error: null, offline: false };
}

/**
 * Exact number of cards currently due: count queries return the true
 * total regardless of any fetch limit, so "N cards due" never understates
 * the queue. Offline the count is unknown (null) — callers hide or degrade
 * the badge rather than showing a stale guess.
 */
export async function countDueCards() {
  if (!navigator.onLine) return { data: null, error: null, offline: true };
  const { count, error } = await supabase
    .from("flashcards")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .lte("next_review_at", new Date().toISOString());
  if (error) return { data: null, error: error.message, offline: false };
  return { data: count ?? 0, error: null, offline: false };
}

/**
 * Record one review atomically: the review log and the card's scheduling
 * state commit together via the record_flashcard_review RPC — the
 * sm2-lite-v1 values still come from the pure engine here, so the
 * algorithm stays unit-testable. `clientActionId` (a UUID generated per user
 * action) makes retries idempotent: the RPC returns the already-committed
 * card state instead of writing a second log.
 */
export async function reviewCard(userKey, card, rating, elapsedMs, clientActionId) {
  if (!navigator.onLine) {
    return { data: null, error: "You're offline — reviews need a connection." };
  }
  const { nextReviewAt, intervalDays, easeFactor } = scheduleNext({
    rating,
    intervalDays: card.interval_days,
    easeFactor: card.ease_factor,
  });

  const { data, error } = await supabase.rpc("record_flashcard_review", {
    p_flashcard_id: card.id,
    p_rating: rating,
    p_elapsed_ms: elapsedMs ?? null,
    p_interval_days: intervalDays,
    p_ease_factor: easeFactor,
    p_next_review_at: nextReviewAt,
    p_algorithm_version: ALGORITHM.version,
    p_client_action_id: clientActionId ?? null,
  });
  if (error) return { data: null, error: error.message };
  const result = data ?? {};
  if (result.ok === false) {
    return { data: null, error: result.code ?? "REVIEW_FAILED" };
  }
  return { data: { card: result.card, replay: result.replay ?? false }, error: null };
}

export { describeAIError };
