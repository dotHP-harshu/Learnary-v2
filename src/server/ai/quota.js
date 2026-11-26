import "server-only"; // boundary: never import this module from a Client Component

// Server-only quota accounting client.
//
// Why a separate client: the quota functions are revoked from `authenticated`
// in `supabase/setup.sql` so a signed-in user cannot refund their own credits or
// inflate the shared global budget through PostgREST. Only the Route Handler,
// after it has verified the caller's JWT, may move those counters — and it
// does so with the service-role key, passing the verified user id explicitly
// because a service-role JWT has no `auth.uid()`.
//
// The client is created only for accounting calls. User data (tasks, quizzes,
// tutor history) keeps using the caller-scoped client so RLS remains the
// authorization boundary for everything a user can read or write.

import { createClient } from "@supabase/supabase-js";
import { AI_CONFIG } from "./config.js";

/**
 * @returns {import("@supabase/supabase-js").SupabaseClient | null} null when
 * the deployment defines neither SUPABASE_SECRET_KEY (new `sb_secret_...`
 * key) nor SUPABASE_SERVICE_ROLE_KEY (legacy service_role JWT) — callers must
 * fail closed rather than using the user-scoped client for accounting.
 */
export function createQuotaClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = AI_CONFIG.serviceRoleKey;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
