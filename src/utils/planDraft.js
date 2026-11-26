// Today plan draft persistence. The draft is intentionally client-side until
// the learner accepts it; sessionStorage keeps it alive across
// an in-app tab switch or a reload without turning it into a saved plan.
// Keys are namespaced by user and date so a shared browser never resumes one
// account's draft inside another account's session, and yesterday's draft never
// appears on today's page.

const DRAFT_KEY = (userKey, date) => `planDraft:${userKey ?? "anon"}:${date}`;

/** Persist the in-memory draft (including edits made in PlanDraft). */
export function persistPlanDraft(userKey, date, draft) {
  if (!userKey || !date || !draft) return;
  try {
    sessionStorage.setItem(DRAFT_KEY(userKey, date), JSON.stringify(draft));
  } catch {
    /* storage unavailable — the draft stays in memory only */
  }
}

/** Load a previously persisted draft for this learner + date. */
export function loadPersistedPlanDraft(userKey, date) {
  if (!userKey || !date) return null;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY(userKey, date));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items) || !parsed.date) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Clear the draft after accept/discard or when the learner starts a new one. */
export function clearPersistedPlanDraft(userKey, date) {
  if (!userKey || !date) return;
  try {
    sessionStorage.removeItem(DRAFT_KEY(userKey, date));
  } catch {
    /* noop */
  }
}
