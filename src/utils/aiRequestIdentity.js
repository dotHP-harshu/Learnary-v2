// Request identity for the client-side recovery journal.
//
// The journal must never persist a prompt, a tutor message or a learner's quiz
// answers. It stores a hash instead: the same action + context + input always
// produces the same hash, so a true retry reuses the server-side request id
// (idempotent replay) while a deliberate repeat generation gets a new one.

/** JSON with object keys sorted, so key order cannot change the hash. */
export function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

// Deterministic fallback for contexts where SubtleCrypto is unavailable
// (non-secure origins). It is not cryptographic, but it only needs to detect
// "same payload" vs "different payload" for local request-id reuse.
function fnv1a(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function hashPayload(action, context, input) {
  const text = `${action}:${stableStringify({
    context: context ?? {},
    input: input ?? {},
  })}`;
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof TextEncoder !== "undefined") {
    try {
      const digest = await subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text)
      );
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      /* fall through to the deterministic fallback */
    }
  }
  return `fnv1a:${fnv1a(text)}`;
}

/** Reuse the recorded id only for a true retry of an in-flight payload. */
export function resolveRequestId({ existing, identity, newId }) {
  if (
    existing?.status === "pending" &&
    existing.payloadHash &&
    existing.payloadHash === identity
  ) {
    return existing.requestId;
  }
  return newId;
}
