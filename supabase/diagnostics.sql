-- ============================================================================
-- Learnary — database diagnostics
-- ============================================================================
-- Read-only checks. Run these in the Supabase SQL editor (or psql) whenever
-- setup seems wrong. Nothing here modifies data or schema.
--
--   1. Identity sanity — rows whose user_id has no matching auth.users row.
--   2. Schema/RLS inventory — every policy currently in public.
--   3. Where the data lives — which project/schema actually holds the tables.
--   4. Row counts — quick "is there any data?" check.
-- ============================================================================


-- ============================================================================
-- 1. Identity sanity
-- ============================================================================
-- Expected result: every count is 0. A non-zero count means historical rows
-- were written with a foreign identity ID (e.g. an OAuth provider ID), and the
-- app must be investigated before trusting `user.id` as the identity source.

select
  (select count(*) from public.collections as c
     where not exists (select 1 from auth.users as u where u.id = c.user_id)) as collections_bad_user_id,
  (select count(*) from public.tasks as t
     where not exists (select 1 from auth.users as u where u.id = t.user_id))       as tasks_bad_user_id,
  (select count(*) from public.skillmaps as s
     where not exists (select 1 from auth.users as u where u.id = s.user_id))       as skillmaps_bad_user_id;


-- ============================================================================
-- 2. Schema / RLS inventory
-- ============================================================================

select tablename, policyname, permissive, roles, cmd, qual
from pg_catalog.pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- ============================================================================
-- 3. Where does Learnary's data actually live?
-- ============================================================================
-- Compare `database_name` with the <project-ref> subdomain of
-- NEXT_PUBLIC_SUPABASE_URL. If the tables below are missing but the app works
-- in production, this project is NOT the one the app queries.

select table_schema as "schema",
       table_name   as "table"
from information_schema.tables
where table_name in ('collections', 'tasks', 'skillmaps')
  and table_schema not in ('pg_catalog', 'information_schema', 'supabase_storage')
order by 1, 2;

select current_database() as database_name;


-- ============================================================================
-- 4. Row counts
-- ============================================================================
-- 0/0/0 with tables present would also suggest an abandoned project.

select
  (select count(*) from public.collections) as collections_rows,
  (select count(*) from public.tasks)       as tasks_rows,
  (select count(*) from public.skillmaps)   as skillmaps_rows;


-- ============================================================================
-- 5. Security assumptions
-- ============================================================================
-- Expected result: every value below is `false`. A `true` means a client role
-- can do something the app deliberately reserves for the server (answer keys,
-- scores, quota counters). Re-apply supabase/setup.sql section 9.

select
  has_table_privilege('authenticated', 'public.ai_usage_daily', 'INSERT')
    as auth_can_write_usage,
  has_table_privilege('authenticated', 'public.ai_usage_global_daily', 'SELECT')
    as auth_can_read_global_counters,
  has_table_privilege('authenticated', 'public.quiz_attempts', 'INSERT')
    as auth_can_write_attempts,
  has_table_privilege('authenticated', 'public.quizzes', 'UPDATE')
    as auth_can_edit_quizzes,
  has_column_privilege('authenticated', 'public.quizzes', 'content', 'SELECT')
    as auth_can_read_answer_keys,
  has_function_privilege(
    'authenticated',
    'public.reserve_ai_quota(uuid, integer, integer, integer)',
    'EXECUTE'
  ) as auth_can_reserve_quota;
