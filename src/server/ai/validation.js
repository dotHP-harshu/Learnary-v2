import "server-only"; // boundary: never import this module from a Client Component

// Request envelope validation for /api/learnary-ai.
// Zod is the single validation point before any auth/quota/provider work.

import { z } from "zod";
import { AI_ACTIONS } from "./config.js";

const uuid = z.string().uuid();

export const requestSchema = z.object({
  version: z.literal(1),
  // Own-property check, not `in`: `"toString" in AI_ACTIONS` is true because
  // `in` walks the prototype chain, which would let inherited Object methods
  // pass the allowlist and skip quota (cost is undefined).
  action: z
    .string()
    .refine((a) => Object.hasOwn(AI_ACTIONS, a), {
      message: "Unknown action",
    }),
  request_id: uuid,
  context: z
    .object({
      collection_id: z.string().min(1).max(128).nullable().optional(),
      roadmap_id: uuid.nullable().optional(),
      task_id: uuid.nullable().optional(),
      conversation_id: uuid.nullable().optional(),
      // resume_request only: the original request being looked up.
      original_request_id: uuid.nullable().optional(),
      original_action: z.string().min(1).max(64).nullable().optional(),
    })
    .optional(),
  // Action-specific payloads are validated per action; for now bound the
  // shape so nothing unbounded reaches the server.
  input: z.record(z.string(), z.unknown()).default({}),
});

export function parseRequest(body) {
  const result = requestSchema.safeParse(body);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  const issue = result.error.issues[0];
  return {
    ok: false,
    error: `${issue.path.join(".") || "body"}: ${issue.message}`,
  };
}
