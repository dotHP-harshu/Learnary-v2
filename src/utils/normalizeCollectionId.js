/**
 * Normalize a collection_id that may have arrived via a colon-prefixed URL
 * (`/tasks/:<id>`). Stale bookmarks can carry a leading colon; strip it
 * defensively.
 */
export function normalizeCollectionId(rawId) {
  return typeof rawId === "string" ? rawId.replace(/^:+/, "") : rawId;
}
