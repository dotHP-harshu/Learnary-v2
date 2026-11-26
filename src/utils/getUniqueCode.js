/**
 * URL-safe collection key for NEW collections.
 *
 * Security note: this is not an authorization boundary — every
 * read is scoped by RLS on `user_id`, and the key is not a share token. It
 * still must not be predictable, so the unique part comes from
 * `crypto.randomUUID()` rather than `Math.random()`. The readable slug stays
 * for legible URLs; legacy rows keep their original keys.
 */
function getUniqueCode(content) {
  const slug = String(content ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  const unique =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return slug ? `${slug}-${unique}` : unique;
}

export default getUniqueCode;
