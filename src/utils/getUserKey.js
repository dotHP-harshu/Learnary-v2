import supabase from "../supabase/supabase";

/**
 * Canonical authenticated user key for DB `user_id` values.
 *
 * Standardizes on the real authenticated user ID, with a defensive fallback
 * for stale/cached user objects that may lack `id`.
 *
 * Before relying on this against the live DB, run `supabase/diagnostics.sql`
 * on the Supabase project.
 */
export function getUserKey(user) {
  if (user?.id) return user.id;
  return user?.identities?.[0]?.id ?? null;
}

/** Authenticated Supabase user for the current session. */
export async function getAuthUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}
