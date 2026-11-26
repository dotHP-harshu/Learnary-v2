-- ============================================================================
-- Learnary - complete database setup (single file)
-- ============================================================================
-- Paste this ENTIRE file into the Supabase SQL editor of a fresh project and
-- run it once. It creates everything the app needs:
--
--   • all tables
--   • every RPC the app calls (dashboard, atomic writes, assistant quota, quizzes)
--   • RLS enabled + auth.uid()-scoped policies on every user-owned table
--   • grants/revokes with the final security posture (quota is server-only)
--   • indexes, updated_at triggers, and documentation comments
--
-- This is the complete, consolidated schema for the application.
-- It is written to be re-runnable: `create table if not exists`,
-- `create or replace function`, `drop trigger if exists`, idempotent indexes,
-- and explicit grants/revokes. Re-running it converges an existing project to
-- the same state without deleting data.
--
-- Security model (important):
--   • Browser clients authenticate as `authenticated`; RLS limits every row
--     to its owner (auth.uid()).
--   • Assistant quota/usage accounting functions are executable ONLY by
--     `service_role`; the Next.js Route Handler verifies the JWT first and
--     passes the user id explicitly.
--   • `anon` gets no table access at all.
--   • The shared counters (ai_usage_global_daily, ai_rate_limits) have RLS on
--     with no policies and no client grants.
-- ============================================================================


-- ============================================================================
-- 0. Extensions
-- ============================================================================

create extension if not exists pgcrypto;


-- ============================================================================
-- 1. Core tables
-- ============================================================================

create table if not exists public.collections (
  id             uuid primary key default gen_random_uuid(),
  collection_id  text not null unique,
  user_id        uuid not null references auth.users (id) on delete cascade,
  title          text not null,
  -- Optional collection metadata
  description    text,
  target_outcome text,
  status         text not null default 'active'
                 check (status in ('active', 'completed', 'archived')),
  target_date    date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),
  collection_id     text not null
                    references public.collections (collection_id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  title             text not null,
  completed         boolean not null default false,
  created_at        timestamptz not null default now(),
  -- Additive task fields
  description       text,
  status            text not null default 'pending'
                    check (status in ('pending', 'in_progress', 'completed', 'skipped')),
  priority          text not null default 'medium'
                    check (priority in ('low', 'medium', 'high')),
  difficulty        text check (difficulty in ('beginner', 'intermediate', 'advanced')),
  estimated_minutes integer check (estimated_minutes >= 0),
  due_at            timestamptz,
  scheduled_for     date,
  completed_at      timestamptz,
  source            text not null default 'manual'
                    check (source in ('manual', 'ai', 'roadmap', 'planner')),
  updated_at        timestamptz not null default now()
);

create table if not exists public.skillmaps (
  id            uuid primary key default gen_random_uuid(),
  collection_id text not null unique
                references public.collections (collection_id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  skillmap      text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);


-- ============================================================================
-- 1b. Schema convergence for existing databases
-- ============================================================================
-- `create table if not exists` above is a no-op on an existing database,
-- so columns added later would silently never appear there. These additive
-- statements make a re-run converge without touching existing rows. (The
-- CHECK constraints from the table definitions are not re-added here; the
-- application validates these values and section 9b covers row integrity.)

alter table public.collections
  add column if not exists description    text,
  add column if not exists target_outcome text,
  add column if not exists status         text not null default 'active',
  add column if not exists target_date    date,
  add column if not exists updated_at     timestamptz not null default now();

alter table public.tasks
  add column if not exists description       text,
  add column if not exists status            text not null default 'pending',
  add column if not exists priority          text not null default 'medium',
  add column if not exists difficulty        text,
  add column if not exists estimated_minutes integer,
  add column if not exists due_at            timestamptz,
  add column if not exists scheduled_for     date,
  add column if not exists completed_at      timestamptz,
  add column if not exists source            text not null default 'manual',
  add column if not exists updated_at        timestamptz not null default now();


-- ============================================================================
-- 2. Application tables
-- ============================================================================

-- 2.1 Learning profile (onboarding) -----------------------------------------

create table if not exists public.learning_profiles (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null unique
                              references auth.users (id) on delete cascade,
  primary_goal                text,
  current_level               text check (current_level in ('beginner', 'intermediate', 'advanced')),
  target_level                text check (target_level in ('beginner', 'intermediate', 'advanced', 'job_ready')),
  study_days                  smallint[] check (
                                array_length(study_days, 1) is null
                                or study_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
                              ),
  daily_study_minutes         integer check (daily_study_minutes between 0 and 1440),
  weekly_study_minutes        integer check (weekly_study_minutes between 0 and 10080),
  timezone                    text,
  preferred_explanation_style text,
  onboarding_completed_at     timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- Auto-create the profile at signup.
create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = ''
as $$
begin
  insert into public.learning_profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2.2 Roadmaps ---------------------------------------------------------------

create table if not exists public.learning_roadmaps (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users (id) on delete cascade,
  collection_id            text not null
                           references public.collections (collection_id) on delete cascade,
  title                    text not null,
  goal                     text not null,
  current_level            text,
  target_level             text,
  status                   text not null default 'draft'
                           check (status in ('draft', 'active', 'completed', 'archived')),
  estimated_total_minutes  integer check (estimated_total_minutes >= 0),
  target_date              date,
  schema_version           integer not null default 1,
  generation_id            uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table if not exists public.roadmap_stages (
  id                uuid primary key default gen_random_uuid(),
  roadmap_id        uuid not null references public.learning_roadmaps (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  title             text not null,
  description       text,
  order_index       integer not null check (order_index >= 0),
  status            text not null default 'not_started'
                    check (status in ('not_started', 'in_progress', 'completed', 'skipped')),
  estimated_minutes integer check (estimated_minutes >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.roadmap_milestones (
  id               uuid primary key default gen_random_uuid(),
  roadmap_stage_id uuid not null references public.roadmap_stages (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  title            text not null,
  description      text,
  order_index      integer not null check (order_index >= 0),
  status           text not null default 'not_started'
                   check (status in ('not_started', 'in_progress', 'completed', 'skipped')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.roadmap_steps (
  id                 uuid primary key default gen_random_uuid(),
  milestone_id       uuid not null references public.roadmap_milestones (id) on delete cascade,
  -- Denormalized for same-roadmap prerequisite FKs (kept consistent by app
  -- logic; FK below guarantees membership in the roadmap).
  roadmap_id         uuid not null references public.learning_roadmaps (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  title              text not null,
  description        text,
  learning_objective text,
  estimated_minutes  integer check (estimated_minutes >= 0),
  difficulty         text check (difficulty in ('beginner', 'intermediate', 'advanced')),
  task_type          text check (task_type in ('study', 'practice', 'project', 'review')),
  order_index        integer not null check (order_index >= 0),
  status             text not null default 'not_started'
                     check (status in ('not_started', 'in_progress', 'completed', 'skipped')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Repair a partial previous run that created this table before this column.
alter table public.roadmap_steps
  add column if not exists roadmap_id uuid
  references public.learning_roadmaps (id) on delete cascade;

-- Unique pair-indexes backing the prerequisite composite FKs below. They
-- MUST exist before roadmap_step_prerequisites is created.
create unique index if not exists ux_roadmap_steps_id_roadmap
  on public.roadmap_steps (id, roadmap_id);
create unique index if not exists ux_roadmap_steps_roadmap_id
  on public.roadmap_steps (roadmap_id, id);

-- Prerequisites: join table. Same-roadmap membership is enforced by composite
-- FKs (steps can only reference steps of the same roadmap); cycles are
-- rejected in server logic before insert.
create table if not exists public.roadmap_step_prerequisites (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  step_id              uuid not null references public.roadmap_steps (id) on delete cascade,
  roadmap_id           uuid not null references public.learning_roadmaps (id) on delete cascade,
  prerequisite_step_id uuid not null references public.roadmap_steps (id) on delete cascade,
  created_at           timestamptz not null default now(),
  unique (step_id, prerequisite_step_id),
  foreign key (step_id, roadmap_id)
    references public.roadmap_steps (id, roadmap_id) on delete cascade,
  foreign key (roadmap_id, prerequisite_step_id)
    references public.roadmap_steps (roadmap_id, id) on delete cascade
);

-- Stable task → roadmap-step link + optional parent/child tasks.
alter table public.tasks
  add column if not exists roadmap_step_id uuid
  references public.roadmap_steps (id) on delete set null;

alter table public.tasks
  add column if not exists parent_task_id uuid
  references public.tasks (id) on delete set null;

create index if not exists idx_tasks_roadmap_step
  on public.tasks (roadmap_step_id) where roadmap_step_id is not null;
create index if not exists idx_tasks_parent
  on public.tasks (parent_task_id) where parent_task_id is not null;

-- 2.3 Daily plans ------------------------------------------------------------

create table if not exists public.study_plans (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  plan_date         date not null,
  status            text not null default 'draft'
                    check (status in ('draft', 'accepted', 'in_progress', 'completed', 'discarded')),
  available_minutes integer check (available_minutes >= 0),
  estimated_minutes integer check (estimated_minutes >= 0),
  rationale         text,
  generation_id     uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Explicit active-plan policy: at most one accepted/in-progress plan per
-- user per day; unlimited drafts/history.
create unique index if not exists study_plans_one_active_per_day
  on public.study_plans (user_id, plan_date)
  where status in ('accepted', 'in_progress');

create table if not exists public.study_plan_items (
  id                uuid primary key default gen_random_uuid(),
  study_plan_id     uuid not null references public.study_plans (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  task_id           uuid references public.tasks (id) on delete set null,
  title             text not null,
  item_type         text not null check (item_type in ('task', 'review', 'practice')),
  sequence          integer not null check (sequence >= 0),
  estimated_minutes integer check (estimated_minutes >= 0),
  status            text not null default 'pending'
                    check (status in ('pending', 'completed', 'skipped', 'discarded')),
  collection_id     text references public.collections (collection_id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.study_plan_items
  add column if not exists collection_id text
  references public.collections (collection_id) on delete set null;

create index if not exists idx_plan_items_collection
  on public.study_plan_items (collection_id) where collection_id is not null;

-- 2.4 Tutor conversations ----------------------------------------------------

create table if not exists public.ai_conversations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  context_type  text,
  collection_id text references public.collections (collection_id) on delete set null,
  roadmap_id    uuid references public.learning_roadmaps (id) on delete set null,
  task_id       uuid references public.tasks (id) on delete set null,
  status        text not null default 'active' check (status in ('active', 'archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id             uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  role           text not null check (role in ('user', 'assistant', 'system')),
  content        text not null,
  status         text not null default 'complete'
                 check (status in ('complete', 'failed', 'pending')),
  request_id     uuid,
  model_id       text,
  prompt_version text,
  input_tokens   integer,
  output_tokens  integer,
  created_at     timestamptz not null default now()
);

-- 2.5 Quizzes ----------------------------------------------------------------

create table if not exists public.quizzes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  collection_id   text references public.collections (collection_id) on delete set null,
  roadmap_step_id uuid references public.roadmap_steps (id) on delete set null,
  task_id         uuid references public.tasks (id) on delete set null,
  title           text not null,
  content         jsonb not null,
  schema_version  integer not null default 1,
  source          text not null default 'ai' check (source in ('manual', 'ai')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.quiz_attempts (
  id              uuid primary key default gen_random_uuid(),
  quiz_id         uuid not null references public.quizzes (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  answers         jsonb not null,
  score           numeric,
  max_score       numeric,
  feedback        jsonb,
  evaluation_type text check (evaluation_type in ('deterministic', 'ai_assisted')),
  completed_at    timestamptz not null default now()
);

-- 2.6 Flashcards + spaced repetition ----------------------------------------

create table if not exists public.flashcards (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  collection_id   text references public.collections (collection_id) on delete set null,
  roadmap_step_id uuid references public.roadmap_steps (id) on delete set null,
  task_id         uuid references public.tasks (id) on delete set null,
  front           text not null,
  back            text not null,
  explanation     text,
  source          text not null default 'ai' check (source in ('manual', 'ai')),
  status          text not null default 'active'
                  check (status in ('active', 'suspended', 'archived')),
  -- Scheduling state (updated transactionally with the review log)
  next_review_at  timestamptz,
  interval_days   numeric,
  ease_factor     numeric,
  review_count    integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.flashcard_review_logs (
  id                uuid primary key default gen_random_uuid(),
  flashcard_id      uuid not null references public.flashcards (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  rating            text not null check (rating in ('again', 'hard', 'good', 'easy')),
  interval_days     numeric,
  elapsed_ms        integer,
  reviewed_at       timestamptz not null default now(),
  algorithm_version text not null,
  client_action_id  uuid
);

-- Idempotency for flashcard reviews: a retry after a lost response must not
-- record the same rating twice.
alter table public.flashcard_review_logs
  add column if not exists client_action_id uuid;
-- Per-user idempotency. A global unique key would make two accounts that
-- happen to share a UUID collide, and would turn a per-user retry into a
-- 23505 instead of the RPC's replay path.
drop index if exists public.ux_review_logs_client_action;
create unique index if not exists ux_review_logs_client_action
  on public.flashcard_review_logs (user_id, client_action_id)
  where client_action_id is not null;

-- 2.7 Assistant usage accounting ----------------------------------------------------

create table if not exists public.ai_usage_daily (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  usage_date     date not null,
  request_count  integer not null default 0,
  input_tokens   bigint not null default 0,
  output_tokens  bigint not null default 0,
  estimated_cost numeric,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, usage_date)
);

create table if not exists public.ai_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  request_id     uuid not null,
  action         text not null,
  payload_hash   text not null,
  status         text not null default 'pending'
                 check (status in ('pending', 'succeeded', 'failed')),
  result_ref     uuid,
  -- Recoverable assistant results: exact response payload of a succeeded
  -- request, so a retry after a lost response needs no second provider call.
  result_json    jsonb,
  provider       text not null,
  model_id       text,
  prompt_version text,
  error_code     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, request_id)
);

alter table public.ai_requests
  add column if not exists result_json jsonb;

-- Global daily counter. Not user-owned: only the service functions below
-- (and the service_role role) may touch it.
create table if not exists public.ai_usage_global_daily (
  id             uuid primary key default gen_random_uuid(),
  usage_date     date not null unique,
  request_count  integer not null default 0,
  input_tokens   bigint not null default 0,
  output_tokens  bigint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Fixed-window rate-limit buckets (opaque strings; no user data exposed).
create table if not exists public.ai_rate_limits (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);

create index if not exists ai_rate_limits_window_idx
  on public.ai_rate_limits (window_start);


-- ============================================================================
-- 3. updated_at maintenance triggers
-- ============================================================================

create or replace function public.touch_updated_at()
returns trigger
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  t text;
begin
  foreach t in array array[
    'collections', 'tasks', 'skillmaps',
    'learning_profiles', 'learning_roadmaps', 'roadmap_stages',
    'roadmap_milestones', 'roadmap_steps',
    'study_plans', 'study_plan_items',
    'ai_conversations', 'quizzes', 'flashcards',
    'ai_usage_daily', 'ai_requests', 'ai_usage_global_daily'
  ] loop
    execute format('drop trigger if exists trg_touch_updated_at on public.%I', t);
    execute format(
      'create trigger trg_touch_updated_at before update on public.%I
       for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;


-- Task completion is a server event: the browser decides *whether* a task is
-- done, the database decides *when*. Without this, a client could back- or
-- forward-date `completed_at` (e.g. post activity into a future day), and the
-- analytics/heatmap would report a fabricated timeline. The paired
-- `tasks_completed_at_coherent` check in section 9b still enforces
-- `completed = (completed_at is not null)`.
create or replace function public.stamp_task_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A task created already-complete gets the server clock too; otherwise a
  -- crafted insert could place activity on an arbitrary day. OLD is not
  -- assigned in an insert trigger, hence the explicit branch.
  if tg_op = 'INSERT' then
    new.completed_at = case when new.completed then now() else null end;
    return new;
  end if;

  if new.completed then
    -- First transition to done → server clock. A row that is already done
    -- keeps its original timestamp even if the client sends another value.
    new.completed_at = case
      when old.completed then coalesce(old.completed_at, now())
      else now()
    end;
  else
    new.completed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_task_completion on public.tasks;
create trigger trg_stamp_task_completion
  before insert or update on public.tasks
  for each row execute function public.stamp_task_completion();


-- ============================================================================
-- 4. Dashboard RPCs (app contract; identity from JWT)
-- ============================================================================

create or replace function public.get_total_collections(user_uuid uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  return (select count(*)::integer from public.collections where user_id = v_user);
end;
$$;

create or replace function public.get_total_tasks(user_uuid uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  -- Counts COMPLETED tasks to match the dashboard label "Total Completed
  -- Tasks" (never label created as completed).
  return (
    select count(*)::integer from public.tasks
    where user_id = v_user and completed = true
  );
end;
$$;

-- Active days (all time) in the learner's own calendar. The old signature
-- bucketed by UTC, so a task completed at 23:30 in Asia/Kolkata counted on the
-- previous day and disagreed with the heatmap, which uses the saved zone.
-- The parameter is removed rather than overloaded so there is exactly one
-- `get_active_days` in the database. `p_timezone` null/empty = UTC.
drop function if exists public.get_active_days(uuid);

create or replace function public.get_active_days(p_timezone text default null)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_zone text := coalesce(nullif(p_timezone, ''), 'utc');
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  return (
    select count(distinct (t.completed_at at time zone v_zone)::date)::integer
    from public.tasks t
    where t.user_id = v_user and t.completed_at is not null
  );
end;
$$;


create or replace function public.count_tasks_last_7_days(user_id_input uuid default null)
returns table (task_date date, task_count bigint)
language sql
security definer
set search_path = ''
as $$
  select (t.completed_at at time zone 'utc')::date as task_date,
         count(*) as task_count
  from public.tasks t
  where t.user_id = (select auth.uid())
    and t.completed_at is not null
    and (t.completed_at at time zone 'utc')::date
        >= ((now() at time zone 'utc')::date - 6)
  group by 1
  order by 1;
$$;

-- Learner-timezone variant: day boundaries follow the learner's saved zone
-- instead of UTC. The app prefers this one and falls back to the UTC version.
create or replace function public.count_tasks_completed_last_7_days(
  p_timezone text default null
)
returns table (task_date date, task_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with tz as (
    select coalesce(nullif(p_timezone, ''), 'utc') as zone
  )
  select
    (t.completed_at at time zone tz.zone)::date as task_date,
    count(*)                                    as task_count
  from public.tasks t, tz
  where t.user_id = (select auth.uid())
    and t.completed_at is not null
    and (t.completed_at at time zone tz.zone)::date
        >= ((now() at time zone tz.zone)::date - 6)
  group by 1
  order by 1;
$$;

-- NOTE: COMMENT ON ... IS requires a single string literal (no || concat).
comment on function public.count_tasks_completed_last_7_days(text) is
  'Task completions per day for the caller''s LAST 7 days, bucketed by the learner''s local calendar day (p_timezone, e.g. Asia/Kolkata; null = UTC). Learner-tz counterpart of count_tasks_last_7_days, which buckets by UTC date. Never buckets other users'' rows.';

revoke execute on function public.get_total_collections(uuid) from public, anon;
revoke execute on function public.get_total_tasks(uuid) from public, anon;
revoke execute on function public.get_active_days(text) from public, anon;
revoke execute on function public.count_tasks_last_7_days(uuid) from public, anon;
revoke execute on function public.count_tasks_completed_last_7_days(text) from public, anon;

grant execute on function
  public.get_total_collections(uuid),
  public.get_total_tasks(uuid),
  public.get_active_days(text),
  public.count_tasks_last_7_days(uuid),
  public.count_tasks_completed_last_7_days(text)
  to authenticated;


-- ============================================================================
-- 5. Atomic write RPCs
-- ============================================================================
-- All are security definer with search_path = '', derive the caller from
-- auth.uid() (never from client-supplied ids), validate every referenced row,
-- and run inside a single transaction: an error anywhere rolls back every
-- write. Each returns a jsonb result: {ok:true, ...} or {ok:false, code:...}.

-- 5.1 delete_collection_deep(p_collection_id text)
-- Collection + tasks + skillmaps in one transaction. Returns counts so the
-- success/failure messages can state exactly what was removed.
create or replace function public.delete_collection_deep(p_collection_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_coll   public.collections%rowtype;
  v_skills integer;
  v_tasks  integer;
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if p_collection_id is null or length(trim(p_collection_id)) = 0 then
    raise exception 'VALIDATION_ERROR';
  end if;

  select * into v_coll from public.collections
    where collection_id = p_collection_id and user_id = v_user;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  delete from public.skillmaps
    where collection_id = p_collection_id and user_id = v_user;
  get diagnostics v_skills = row_count;

  delete from public.tasks
    where collection_id = p_collection_id and user_id = v_user;
  get diagnostics v_tasks = row_count;

  -- Belt and braces: the FKs also cascade, but deleting the parent row
  -- explicitly proves the collection itself is gone.
  delete from public.collections where id = v_coll.id and user_id = v_user;
  if not found then
    raise exception 'DELETE_FAILED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'title', v_coll.title,
    'deleted_skillmaps', v_skills,
    'deleted_tasks', v_tasks
  );
end;
$$;

-- 5.2 save_roadmap(p_payload jsonb)
-- Roadmap + stages + milestones + steps + prerequisite pairs in one
-- transaction. Payload contract (all ownership validated server-side):
-- {
--   collection_id: text (must belong to the caller),
--   title, goal: text,
--   current_level, target_level: text?,
--   estimated_total_minutes: int?,
--   stages: [{ title, description?,
--     milestones: [{ title, description?,
--       steps: [{ step_number: int, title, description?,
--                 learning_objective?, estimated_minutes?, difficulty?, task_type? }]
--     })]
--   }],
--   prerequisites: [[step_number, prerequisite_step_number], ...]  (optional)
-- }
create or replace function public.save_roadmap(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user          uuid := (select auth.uid());
  v_payload       jsonb := p_payload;
  v_collection    text;
  v_roadmap_id    uuid;
  v_stage_id      uuid;
  v_milestone_id  uuid;
  v_stage         jsonb;
  v_milestone     jsonb;
  v_step          jsonb;
  v_prereq        jsonb;
  v_stage_idx     integer;
  v_milestone_idx integer;
  v_step_idx      integer;
  v_step_id       uuid;
  v_step_ids      jsonb := '{}'::jsonb;  -- step_number → step id
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  v_collection := v_payload->>'collection_id';
  if v_collection is null
     or coalesce(jsonb_array_length(v_payload->'stages'), 0) = 0
     or coalesce(nullif(v_payload->>'title', ''), '') = ''
     or coalesce(nullif(v_payload->>'goal', ''), '') = '' then
    raise exception 'VALIDATION_ERROR';
  end if;

  if not exists (
    select 1 from public.collections
    where collection_id = v_collection and user_id = v_user
  ) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  insert into public.learning_roadmaps
    (user_id, collection_id, title, goal, current_level, target_level,
     status, estimated_total_minutes, schema_version)
  values
    (v_user, v_collection, v_payload->>'title', v_payload->>'goal',
     v_payload->>'current_level', v_payload->>'target_level', 'active',
     nullif(v_payload->>'estimated_total_minutes', '')::int, 1)
  returning id into v_roadmap_id;

  v_stage_idx := 0;
  for v_stage in select * from jsonb_array_elements(v_payload->'stages') loop
    insert into public.roadmap_stages
      (roadmap_id, user_id, title, description, order_index)
    values
      (v_roadmap_id, v_user, v_stage->>'title', v_stage->>'description',
       v_stage_idx)
    returning id into v_stage_id;

    v_milestone_idx := 0;
    for v_milestone in select * from jsonb_array_elements(
          coalesce(v_stage->'milestones', '[]'::jsonb)) loop
      insert into public.roadmap_milestones
        (roadmap_stage_id, user_id, title, description, order_index)
      values
        (v_stage_id, v_user, v_milestone->>'title',
         v_milestone->>'description', v_milestone_idx)
      returning id into v_milestone_id;

      v_step_idx := 0;
      for v_step in select * from jsonb_array_elements(
            coalesce(v_milestone->'steps', '[]'::jsonb)) loop
        insert into public.roadmap_steps
          (milestone_id, roadmap_id, user_id, title, description,
           learning_objective, estimated_minutes, difficulty, task_type,
           order_index)
        values
          (v_milestone_id, v_roadmap_id, v_user, v_step->>'title',
           v_step->>'description', v_step->>'learning_objective',
           nullif(v_step->>'estimated_minutes', '')::int,
           v_step->>'difficulty', v_step->>'task_type', v_step_idx)
        returning id into v_step_id;

        v_step_ids := v_step_ids
          || jsonb_build_object(v_step->>'step_number', v_step_id);
        v_step_idx := v_step_idx + 1;
      end loop;
      v_milestone_idx := v_milestone_idx + 1;
    end loop;
    v_stage_idx := v_stage_idx + 1;
  end loop;

  for v_prereq in select * from jsonb_array_elements(
        coalesce(v_payload->'prerequisites', '[]'::jsonb)) loop
    insert into public.roadmap_step_prerequisites
      (user_id, roadmap_id, step_id, prerequisite_step_id)
    values
      (v_user, v_roadmap_id,
       (v_step_ids ->> (v_prereq ->> 0))::uuid,
       (v_step_ids ->> (v_prereq ->> 1))::uuid);
    -- A missing step number inserts NULL → not-null violation → the whole
    -- transaction (including the roadmap) rolls back.
  end loop;

  return jsonb_build_object('ok', true, 'roadmap_id', v_roadmap_id);
end;
$$;

-- 5.3 replace_roadmap(p_payload jsonb, p_previous_roadmap_id uuid)
-- Atomic "edit a saved roadmap": insert the replacement, re-link tasks from
-- the previous roadmap's steps to the new ones, then delete the previous
-- roadmap — all in one transaction.
--
-- Payload = the save_roadmap payload plus, per step, two optional keys:
--   status:      'not_started'|'in_progress'|'completed'|'skipped'
--   old_step_id: uuid of the previous step this one replaces.
create or replace function public.replace_roadmap(
  p_payload             jsonb,
  p_previous_roadmap_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user          uuid := (select auth.uid());
  v_payload       jsonb := p_payload;
  v_collection    text;
  v_roadmap_id    uuid;
  v_stage_id      uuid;
  v_milestone_id  uuid;
  v_stage         jsonb;
  v_milestone     jsonb;
  v_step          jsonb;
  v_prereq        jsonb;
  v_stage_idx     integer;
  v_milestone_idx integer;
  v_step_idx      integer;
  v_step_id       uuid;
  v_step_status   text;
  v_step_ids      jsonb := '{}'::jsonb;  -- draft step_number → new step id
  v_old_ids       jsonb := '{}'::jsonb;  -- draft step_number → old step id
  v_key           text;
  v_old_id        text;
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  v_collection := v_payload->>'collection_id';
  if p_previous_roadmap_id is null
     or v_collection is null
     or coalesce(jsonb_array_length(v_payload->'stages'), 0) = 0
     or coalesce(nullif(v_payload->>'title', ''), '') = ''
     or coalesce(nullif(v_payload->>'goal', ''), '') = '' then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- The roadmap being replaced must exist and belong to the caller.
  if not exists (
    select 1 from public.learning_roadmaps
    where id = p_previous_roadmap_id and user_id = v_user
  ) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if not exists (
    select 1 from public.collections
    where collection_id = v_collection and user_id = v_user
  ) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- Pass 1: validate every old_step_id up front.
  for v_stage in select * from jsonb_array_elements(v_payload->'stages') loop
    for v_milestone in select * from jsonb_array_elements(
          coalesce(v_stage->'milestones', '[]'::jsonb)) loop
      for v_step in select * from jsonb_array_elements(
            coalesce(v_milestone->'steps', '[]'::jsonb)) loop
        if coalesce(v_step->>'status', 'not_started') not in
           ('not_started', 'in_progress', 'completed', 'skipped') then
          raise exception 'VALIDATION_ERROR';
        end if;
        if coalesce(v_step->>'old_step_id', '') <> '' then
          if not exists (
            select 1 from public.roadmap_steps
            where id = (v_step->>'old_step_id')::uuid
              and roadmap_id = p_previous_roadmap_id
              and user_id = v_user
          ) then
            raise exception 'VALIDATION_ERROR';
          end if;
        end if;
      end loop;
    end loop;
  end loop;

  -- Pass 2: insert the replacement roadmap.
  insert into public.learning_roadmaps
    (user_id, collection_id, title, goal, current_level, target_level,
     status, estimated_total_minutes, schema_version)
  values
    (v_user, v_collection, v_payload->>'title', v_payload->>'goal',
     v_payload->>'current_level', v_payload->>'target_level', 'active',
     nullif(v_payload->>'estimated_total_minutes', '')::int, 1)
  returning id into v_roadmap_id;

  v_stage_idx := 0;
  for v_stage in select * from jsonb_array_elements(v_payload->'stages') loop
    insert into public.roadmap_stages
      (roadmap_id, user_id, title, description, order_index)
    values
      (v_roadmap_id, v_user, v_stage->>'title', v_stage->>'description',
       v_stage_idx)
    returning id into v_stage_id;

    v_milestone_idx := 0;
    for v_milestone in select * from jsonb_array_elements(
          coalesce(v_stage->'milestones', '[]'::jsonb)) loop
      insert into public.roadmap_milestones
        (roadmap_stage_id, user_id, title, description, order_index)
      values
        (v_stage_id, v_user, v_milestone->>'title',
         v_milestone->>'description', v_milestone_idx)
      returning id into v_milestone_id;

      v_step_idx := 0;
      for v_step in select * from jsonb_array_elements(
            coalesce(v_milestone->'steps', '[]'::jsonb)) loop
        v_step_status := coalesce(v_step->>'status', 'not_started');
        insert into public.roadmap_steps
          (milestone_id, roadmap_id, user_id, title, description,
           learning_objective, estimated_minutes, difficulty, task_type,
           order_index, status)
        values
          (v_milestone_id, v_roadmap_id, v_user, v_step->>'title',
           v_step->>'description', v_step->>'learning_objective',
           nullif(v_step->>'estimated_minutes', '')::int,
           v_step->>'difficulty', v_step->>'task_type', v_step_idx,
           v_step_status)
        returning id into v_step_id;

        v_step_ids := v_step_ids
          || jsonb_build_object(v_step->>'step_number', v_step_id);
        if coalesce(v_step->>'old_step_id', '') <> '' then
          v_old_ids := v_old_ids
            || jsonb_build_object(v_step->>'step_number',
                                  v_step->>'old_step_id');
        end if;
        v_step_idx := v_step_idx + 1;
      end loop;
      v_milestone_idx := v_milestone_idx + 1;
    end loop;
    v_stage_idx := v_stage_idx + 1;
  end loop;

  for v_prereq in select * from jsonb_array_elements(
        coalesce(v_payload->'prerequisites', '[]'::jsonb)) loop
    insert into public.roadmap_step_prerequisites
      (user_id, roadmap_id, step_id, prerequisite_step_id)
    values
      (v_user, v_roadmap_id,
       (v_step_ids ->> (v_prereq ->> 0))::uuid,
       (v_step_ids ->> (v_prereq ->> 1))::uuid);
  end loop;

  -- Pass 3: re-link tasks from the old steps to the new ones.
  for v_key, v_old_id in select * from jsonb_each_text(v_old_ids) loop
    update public.tasks
      set roadmap_step_id = (v_step_ids ->> v_key)::uuid
      where roadmap_step_id = v_old_id::uuid
        and user_id = v_user;
  end loop;

  -- Pass 4: retire the previous roadmap (cascades remove its children; any
  -- task link NOT re-linked above detaches via on-delete-set-null).
  delete from public.learning_roadmaps
    where id = p_previous_roadmap_id and user_id = v_user;
  if not found then
    raise exception 'DELETE_FAILED';
  end if;

  return jsonb_build_object('ok', true, 'roadmap_id', v_roadmap_id);
end;
$$;

-- 5.4 accept_study_plan(p_payload jsonb)
-- Task creation + plan row + plan items in one transaction.
-- Payload contract:
-- {
--   plan_id: uuid?,            -- accepting a saved draft; null = fresh plan
--   plan_date: date,           -- required when plan_id is null
--   available_minutes: int?, estimated_minutes: int?, rationale: text?,
--   items: [{ task_id: uuid?,  -- existing task, must belong to the caller
--             title, item_type: 'task'|'review'|'practice', sequence: int,
--             estimated_minutes: int?, priority?: 'low'|'medium'|'high',
--             collection_id?: text  -- required when task_id is absent
--           }]
-- }
-- Replaying an already-accepted plan returns ok with replay:true.
create or replace function public.accept_study_plan(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_payload  jsonb := p_payload;
  v_plan_id  uuid := nullif(v_payload->>'plan_id', '')::uuid;
  v_item     jsonb;
  v_item_map jsonb := '{}'::jsonb;  -- item index → created task id
  v_new_id   uuid;
  v_coll     text;
  v_created  integer := 0;
  v_idx      integer;
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if coalesce(jsonb_array_length(v_payload->'items'), 0) = 0 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Claim the draft FIRST, before any task is created. This does three things
  -- at once: (1) two concurrent accepts cannot both create tasks, (2) an
  -- already-accepted plan is detected as a replay without touching anything,
  -- and (3) a plan that does not belong to the caller (or is not a draft) is
  -- rejected before the pass-1 inserts run.
  if v_plan_id is not null then
    update public.study_plans
      set status = 'accepted'
      where id = v_plan_id and user_id = v_user and status = 'draft';
    if not found then
      if exists (
        select 1 from public.study_plans
        where id = v_plan_id and user_id = v_user and status = 'accepted'
      ) then
        return jsonb_build_object('ok', true, 'plan_id', v_plan_id,
          'replay', true, 'created_tasks', 0);
      end if;
      raise exception 'PLAN_NOT_FOUND';
    end if;
  end if;

  -- Pass 1: validate existing tasks and create the proposed ones.
  v_idx := 0;
  for v_item in select * from jsonb_array_elements(v_payload->'items') loop
    if coalesce(v_item->>'task_id', '') <> '' then
      if not exists (
        select 1 from public.tasks
        where id = (v_item->>'task_id')::uuid and user_id = v_user
      ) then
        raise exception 'TASK_NOT_OWNED';
      end if;
    else
      v_coll := v_item->>'collection_id';
      if v_coll is null or not exists (
        select 1 from public.collections
        where collection_id = v_coll and user_id = v_user
      ) then
        raise exception 'COLLECTION_REQUIRED';
      end if;
      if coalesce(v_item->>'priority', 'medium') not in ('low', 'medium', 'high') then
        raise exception 'VALIDATION_ERROR';
      end if;
      if coalesce(v_item->>'item_type', 'task') not in ('task', 'review', 'practice') then
        raise exception 'VALIDATION_ERROR';
      end if;

      insert into public.tasks
        (user_id, collection_id, title, description, priority,
         estimated_minutes, status, completed, source)
      values
        (v_user, v_coll, v_item->>'title', nullif(v_item->>'description', ''),
         v_item->>'priority', nullif(v_item->>'estimated_minutes', '')::int,
         'pending', false, 'planner')
      returning id into v_new_id;

      v_item_map := v_item_map || jsonb_build_object(v_idx::text, v_new_id);
      v_created := v_created + 1;
    end if;
    v_idx := v_idx + 1;
  end loop;

  -- Pass 2: the plan row was already claimed above; only its draft items need
  -- to be replaced with the resolved rows.
  if v_plan_id is not null then
    -- Rewrite the draft's items with resolved task ids (same transaction).
    delete from public.study_plan_items
      where study_plan_id = v_plan_id and user_id = v_user;
  else
    if nullif(v_payload->>'plan_date', '') is null then
      raise exception 'VALIDATION_ERROR';
    end if;
    insert into public.study_plans
      (user_id, plan_date, status, available_minutes, estimated_minutes, rationale)
    values
      (v_user, (v_payload->>'plan_date')::date, 'accepted',
       nullif(v_payload->>'available_minutes', '')::int,
       nullif(v_payload->>'estimated_minutes', '')::int,
       v_payload->>'rationale')
    returning id into v_plan_id;
    -- A second accepted plan for the same day violates
    -- study_plans_one_active_per_day → exception → full rollback.
  end if;

  -- Pass 3: final item rows.
  v_idx := 0;
  for v_item in select * from jsonb_array_elements(v_payload->'items') loop
    insert into public.study_plan_items
      (study_plan_id, user_id, task_id, title, item_type, sequence,
       estimated_minutes, collection_id)
    values
      (v_plan_id, v_user,
       case when coalesce(v_item->>'task_id', '') <> ''
            then (v_item->>'task_id')::uuid
            else (v_item_map ->> v_idx::text)::uuid end,
       v_item->>'title', coalesce(v_item->>'item_type', 'task'), v_idx,
       nullif(v_item->>'estimated_minutes', '')::int,
       v_item->>'collection_id');
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('ok', true, 'plan_id', v_plan_id,
    'created_tasks', v_created);
end;
$$;

-- 5.5 record_flashcard_review(...)
-- Review log + card scheduling state in one transaction. The SM-2-lite
-- computation stays in src/utils/spacedRepetition.js; this RPC validates
-- ownership + idempotency and commits both writes together.
-- Replaying the same client_action_id returns replay:true with the same card
-- state instead of writing a second log.
create or replace function public.record_flashcard_review(
  p_flashcard_id      uuid,
  p_rating            text,
  p_elapsed_ms        integer,
  p_interval_days     numeric,
  p_ease_factor       numeric,
  p_next_review_at    timestamptz,
  p_algorithm_version text,
  p_client_action_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_card public.flashcards%rowtype;
  v_log  public.flashcard_review_logs%rowtype;
begin
  if v_user is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if p_rating not in ('again', 'hard', 'good', 'easy')
     or p_next_review_at is null
     or p_interval_days is null or p_interval_days < 0
     or p_ease_factor is null or p_ease_factor <= 0
     or coalesce(nullif(p_algorithm_version, ''), '') = '' then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Idempotent replay: same action id → same result, no second log.
  if p_client_action_id is not null then
    select * into v_log from public.flashcard_review_logs
      where client_action_id = p_client_action_id and user_id = v_user;
    if found then
      if v_log.flashcard_id <> p_flashcard_id then
        return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
      end if;
      select * into v_card from public.flashcards
        where id = p_flashcard_id and user_id = v_user;
      if not found then
        return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
      end if;
      return jsonb_build_object('ok', true, 'replay', true,
        'card', to_jsonb(v_card));
    end if;
  end if;

  if not exists (
    select 1 from public.flashcards
    where id = p_flashcard_id and user_id = v_user
  ) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  insert into public.flashcard_review_logs
    (flashcard_id, user_id, rating, interval_days, elapsed_ms,
     reviewed_at, algorithm_version, client_action_id)
  values
    (p_flashcard_id, v_user, p_rating, p_interval_days,
     greatest(coalesce(p_elapsed_ms, 0), 0), now(), p_algorithm_version,
     p_client_action_id);

  update public.flashcards
    set next_review_at = p_next_review_at,
        interval_days  = p_interval_days,
        ease_factor    = p_ease_factor,
        review_count   = review_count + 1
    where id = p_flashcard_id and user_id = v_user
    returning * into v_card;

  return jsonb_build_object('ok', true, 'card', to_jsonb(v_card));
end;
$$;

revoke execute on function
  public.delete_collection_deep(text),
  public.save_roadmap(jsonb),
  public.replace_roadmap(jsonb, uuid),
  public.accept_study_plan(jsonb),
  public.record_flashcard_review(uuid, text, integer, numeric, numeric, timestamptz, text, uuid)
  from public, anon;

grant execute on function
  public.delete_collection_deep(text),
  public.save_roadmap(jsonb),
  public.replace_roadmap(jsonb, uuid),
  public.accept_study_plan(jsonb),
  public.record_flashcard_review(uuid, text, integer, numeric, numeric, timestamptz, text, uuid)
  to authenticated;


-- ============================================================================
-- 6. Assistant quota + usage accounting (server-only)
-- ============================================================================
-- Quota accounting is server-authoritative. These functions are executable
-- ONLY by service_role; the browser's `authenticated` role, `anon`, and
-- PUBLIC lose EXECUTE, so a direct client call fails with "permission denied".
-- Identity is passed explicitly as p_user_id by the Route Handler AFTER it
-- verified the caller's JWT (a service-role JWT has no auth.uid()).

-- Drop legacy client-callable signatures from the old migrations, if present.
drop function if exists public.reserve_ai_quota(integer, integer, integer);
drop function if exists public.release_ai_quota(integer);
drop function if exists public.record_ai_usage(integer, integer);

create or replace function public.ai_assert_service_caller(p_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_role   text  := coalesce(
    v_claims ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    -- New-style `sb_secret_...` keys are not JWTs. On some deployments the
    -- gateway maps the key to `service_role` without populating
    -- `request.jwt.claims`, leaving only the session role set by PostgREST's
    -- SET LOCAL ROLE. Accept that as a third source: anon/authenticated
    -- cannot SET ROLE service_role, and EXECUTE is revoked from them, so this
    -- does not widen who can call the function.
    nullif(current_setting('role', true), ''),
    ''
  );
begin
  if v_role <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;
  if p_user_id is null then
    raise exception 'VALIDATION_ERROR';
  end if;
  return p_user_id;
end;
$$;

-- reserve_ai_quota(p_user_id, units, user_daily_limit, global_daily_limit)
-- Serialized on the global counter row lock; the same user's concurrent calls
-- serialize on the (user_id, usage_date) unique key. Both limits are REQUIRED
-- and come from the server's own configuration, never from a client.
create or replace function public.reserve_ai_quota(
  p_user_id uuid,
  p_units integer,
  p_user_daily_limit integer,
  p_global_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := public.ai_assert_service_caller(p_user_id);
  v_today date := (now() at time zone 'utc')::date;
  v_global_count integer;
  v_user_count   integer;
begin
  if p_units is null or p_units < 1 or p_units > 100 then
    raise exception 'VALIDATION_ERROR';
  end if;
  -- Hardening: a missing limit must fail closed, never disable a check.
  if p_user_daily_limit is null or p_global_daily_limit is null
     or p_user_daily_limit < 1 or p_global_daily_limit < 1 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Lock the global counter row first: serializes all reservations.
  insert into public.ai_usage_global_daily (usage_date) values (v_today)
    on conflict (usage_date) do nothing;

  select request_count into v_global_count
  from public.ai_usage_global_daily
  where usage_date = v_today
  for update;

  if v_global_count + p_units > p_global_daily_limit then
    return jsonb_build_object(
      'ok', false,
      'code', 'AI_GLOBAL_QUOTA_EXCEEDED',
      'requests_used_today', v_global_count,
      'app_daily_limit', p_global_daily_limit
    );
  end if;

  insert into public.ai_usage_daily (user_id, usage_date, request_count)
  values (v_user, v_today, p_units)
  on conflict (user_id, usage_date) do update
    set request_count = public.ai_usage_daily.request_count
                        + excluded.request_count;

  -- Move the global counter in the same step as the user row so the two
  -- can never drift; the user-limit check below rolls both back together.
  update public.ai_usage_global_daily
  set request_count = request_count + p_units
  where usage_date = v_today;

  select request_count into v_user_count
  from public.ai_usage_daily
  where user_id = v_user and usage_date = v_today;

  if v_user_count > p_user_daily_limit then
    -- Roll back BOTH counters before refusing.
    update public.ai_usage_daily
    set request_count = request_count - p_units
    where user_id = v_user and usage_date = v_today;

    update public.ai_usage_global_daily
    set request_count = request_count - p_units
    where usage_date = v_today;

    return jsonb_build_object(
      'ok', false,
      'code', 'AI_USER_QUOTA_EXCEEDED',
      'requests_used_today', v_user_count - p_units,
      'app_daily_limit', p_user_daily_limit
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'requests_used_today', v_user_count,
    'app_daily_limit', p_user_daily_limit
  );
end;
$$;

-- release_ai_quota(p_user_id, units) — rollback a reservation made for a
-- request that failed before a usable result existed (AI-QUOTA-06). Floors
-- at 0 and never goes below what the user actually has today.
create or replace function public.release_ai_quota(
  p_user_id uuid,
  p_units integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := public.ai_assert_service_caller(p_user_id);
  v_today date := (now() at time zone 'utc')::date;
  v_user_count   integer;
  v_global_count integer;
begin
  if p_units is null or p_units < 1 or p_units > 100 then
    raise exception 'VALIDATION_ERROR';
  end if;

  -- Lock in the SAME order as reserve_ai_quota (global row, then user row).
  -- The opposite order here allowed a concurrent reserve + release to
  -- deadlock (40P01), which surfaced as a 503 on the assistant route.
  insert into public.ai_usage_global_daily (usage_date) values (v_today)
    on conflict (usage_date) do nothing;

  select request_count into v_global_count
  from public.ai_usage_global_daily
  where usage_date = v_today
  for update;

  update public.ai_usage_daily
  set request_count = greatest(request_count - p_units, 0)
  where user_id = v_user and usage_date = v_today
  returning request_count into v_user_count;

  update public.ai_usage_global_daily
  set request_count = greatest(request_count - p_units, 0)
  where usage_date = v_today;

  return jsonb_build_object(
    'ok', true,
    'requests_used_today', coalesce(v_user_count, 0)
  );
end;
$$;

-- record_ai_usage(p_user_id, input_tokens, output_tokens) — post-provider
-- token accounting (upsert: cost-0 actions have no reservation row yet).
create or replace function public.record_ai_usage(
  p_user_id uuid,
  p_input_tokens integer,
  p_output_tokens integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := public.ai_assert_service_caller(p_user_id);
  v_today date := (now() at time zone 'utc')::date;
begin
  -- Global row first, then the user row: the same lock order as
  -- reserve_ai_quota()/release_ai_quota(). Touching the user row first could
  -- deadlock with a concurrent reservation from another request.
  insert into public.ai_usage_global_daily (usage_date, input_tokens, output_tokens)
  values (v_today, greatest(coalesce(p_input_tokens, 0), 0),
          greatest(coalesce(p_output_tokens, 0), 0))
  on conflict (usage_date) do update
    set input_tokens  = public.ai_usage_global_daily.input_tokens
                        + excluded.input_tokens,
        output_tokens = public.ai_usage_global_daily.output_tokens
                        + excluded.output_tokens;

  insert into public.ai_usage_daily (user_id, usage_date, input_tokens, output_tokens)
  values (v_user, v_today, greatest(coalesce(p_input_tokens, 0), 0),
          greatest(coalesce(p_output_tokens, 0), 0))
  on conflict (user_id, usage_date) do update
    set input_tokens  = public.ai_usage_daily.input_tokens
                        + excluded.input_tokens,
        output_tokens = public.ai_usage_daily.output_tokens
                        + excluded.output_tokens;

  return jsonb_build_object('ok', true);
end;
$$;

-- read_ai_usage() - for the Settings UI. Reads ONLY the caller's own row;
-- no prompt content and no deployment-wide counters. Client-callable on
-- purpose: it only READS the caller's own aggregates.
create or replace function public.read_ai_usage()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'requests_used_today', coalesce((
      select request_count from public.ai_usage_daily
      where user_id = (select auth.uid())
        and usage_date = (now() at time zone 'utc')::date
    ), 0),
    'input_tokens_today', coalesce((
      select input_tokens from public.ai_usage_daily
      where user_id = (select auth.uid())
        and usage_date = (now() at time zone 'utc')::date
    ), 0),
    'output_tokens_today', coalesce((
      select output_tokens from public.ai_usage_daily
      where user_id = (select auth.uid())
        and usage_date = (now() at time zone 'utc')::date
    ), 0)
    -- Deployment-wide usage is intentionally NOT exposed: it is business /
    -- abuse telemetry, and the route documents that no global-quota internals
    -- reach the client.
  );
$$;

-- read_ai_usage_history(p_days) — per-day usage aggregates for the caller's
-- Assistant usage dashboard (today/7-day/monthly totals).
create or replace function public.read_ai_usage_history(p_days integer default 30)
returns table (
  usage_date    date,
  quota_units   integer,
  input_tokens  bigint,
  output_tokens bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.usage_date,
    t.request_count            as quota_units,
    t.input_tokens,
    t.output_tokens
  from public.ai_usage_daily t
  where t.user_id = (select auth.uid())
    and t.usage_date >= (current_date - least(greatest(coalesce(p_days, 30), 1), 365)::int)
  order by t.usage_date desc;
$$;

-- Quota-units semantics of the historical column (additive alias strategy).
-- NOTE: COMMENT ON ... IS requires a single string literal (no || concat).
comment on column public.ai_usage_daily.request_count is
  'Weighted quota units consumed that day (NOT tokens). Kept for historical compatibility; the application exposes this value as daily_units_used.';

-- Role guard for functions that have no end-user identity (the IP limiter).
create or replace function public.ai_assert_service_role()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_role   text  := coalesce(
    v_claims ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    -- New-style `sb_secret_...` keys are not JWTs. On some deployments the
    -- gateway maps the key to `service_role` without populating
    -- `request.jwt.claims`, leaving only the session role set by PostgREST's
    -- SET LOCAL ROLE. Accept that as a third source: anon/authenticated
    -- cannot SET ROLE service_role, and EXECUTE is revoked from them, so this
    -- does not widen who can call the function.
    nullif(current_setting('role', true), ''),
    ''
  );
begin
  if v_role <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;
end;
$$;

-- ai_rate_limit_hit(bucket, max, window_seconds)
-- Fixed-window counter shared across serverless instances. Returns
-- {ok:true, hits} while under the limit, or {ok:false, retry_after_seconds}
-- once exceeded.
create or replace function public.ai_rate_limit_hit(
  p_bucket text,
  p_max integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits  integer;
  v_retry integer;
begin
  perform public.ai_assert_service_role();

  if p_bucket is null or length(p_bucket) < 1 or length(p_bucket) > 200 then
    raise exception 'VALIDATION_ERROR';
  end if;
  if p_max is null or p_max < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'VALIDATION_ERROR';
  end if;

  insert into public.ai_rate_limits as r (bucket, window_start, hits)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set hits = case
                 when r.window_start <= now() - make_interval(secs => p_window_seconds)
                   then 1
                 else r.hits + 1
               end,
        window_start = case
                 when r.window_start <= now() - make_interval(secs => p_window_seconds)
                   then now()
                 else r.window_start
               end
  returning r.hits,
            greatest(
              1,
              ceil(extract(epoch from (
                r.window_start + make_interval(secs => p_window_seconds) - now()
              )))
            )::integer
  into v_hits, v_retry;

  if v_hits > p_max then
    return jsonb_build_object(
      'ok', false,
      'hits', v_hits,
      'retry_after_seconds', v_retry
    );
  end if;

  -- Bounded housekeeping: drop stale buckets a few at a time so the table
  -- cannot grow without limit. Indexed by window_start.
  delete from public.ai_rate_limits
  where bucket in (
    select bucket
    from public.ai_rate_limits
    where window_start < now() - interval '2 days'
    limit 200
  );

  return jsonb_build_object('ok', true, 'hits', v_hits);
end;
$$;

-- ai_global_budget_check(daily_token_cap) — deployment-wide token ceiling.
-- Soft cap: checked before each reservation, so the last in-flight request may
-- push the day slightly over — the next request is refused.
create or replace function public.ai_global_budget_check(p_daily_token_cap bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_in    bigint;
  v_out   bigint;
begin
  perform public.ai_assert_service_role();

  if p_daily_token_cap is null or p_daily_token_cap < 1 then
    raise exception 'VALIDATION_ERROR';
  end if;

  select coalesce(input_tokens, 0), coalesce(output_tokens, 0)
  into v_in, v_out
  from public.ai_usage_global_daily
  where usage_date = v_today;

  v_in  := coalesce(v_in, 0);
  v_out := coalesce(v_out, 0);

  return jsonb_build_object(
    'exhausted', (v_in + v_out) >= p_daily_token_cap,
    'input_tokens', v_in,
    'output_tokens', v_out,
    'cap', p_daily_token_cap
  );
end;
$$;

revoke execute on function public.ai_assert_service_caller(uuid) from public, anon, authenticated;
revoke execute on function public.ai_assert_service_role() from public, anon, authenticated;
revoke execute on function public.reserve_ai_quota(uuid, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.release_ai_quota(uuid, integer) from public, anon, authenticated;
revoke execute on function public.record_ai_usage(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.ai_rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.ai_global_budget_check(bigint) from public, anon, authenticated;
revoke execute on function public.read_ai_usage() from public, anon;
revoke execute on function public.read_ai_usage_history(integer) from public, anon;

grant execute on function
  public.ai_assert_service_caller(uuid),
  public.ai_assert_service_role(),
  public.reserve_ai_quota(uuid, integer, integer, integer),
  public.release_ai_quota(uuid, integer),
  public.record_ai_usage(uuid, integer, integer),
  public.ai_rate_limit_hit(text, integer, integer),
  public.ai_global_budget_check(bigint)
  to service_role;

grant execute on function
  public.read_ai_usage(),
  public.read_ai_usage_history(integer)
  to authenticated;


-- ============================================================================
-- 7. Quiz attempt projection (answer keys never reach the browser)
-- ============================================================================
-- Row-level security is row-level, not column-level: "own row" also means
-- "own answer key". This function is the one server-side projection the
-- runner may read. It mirrors `sanitizeQuizContent` in
-- src/server/ai/practiceSchema.js — keep the two in sync.

create or replace function public.get_quiz_for_attempt(p_quiz_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', q.id,
    'title', q.title,
    'created_at', q.created_at,
    'content', jsonb_build_object(
      'title', q.content -> 'title',
      'questions', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'index', item.q -> 'index',
            'prompt', item.q -> 'prompt',
            'type', item.q -> 'type',
            'difficulty', item.q -> 'difficulty'
          )
          || case
               when item.q ->> 'type' = 'mcq'
                 then jsonb_build_object('options', item.q -> 'options')
               else '{}'::jsonb
             end
          order by item.ord
        )
        from jsonb_array_elements(q.content -> 'questions')
          with ordinality as item(q, ord)
      ), '[]'::jsonb)
    )
  )
  from public.quizzes q
  where q.id = p_quiz_id
    and q.user_id = (select auth.uid());
$$;

revoke execute on function public.get_quiz_for_attempt(uuid) from public, anon;
grant execute on function public.get_quiz_for_attempt(uuid) to authenticated;


-- ============================================================================
-- 8. RLS — enabled + auth.uid()-scoped on every user-owned table
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'collections', 'tasks', 'skillmaps',
    'learning_profiles', 'learning_roadmaps', 'roadmap_stages',
    'roadmap_milestones', 'roadmap_steps', 'roadmap_step_prerequisites',
    'study_plans', 'study_plan_items',
    'ai_conversations', 'ai_messages',
    'quizzes', 'quiz_attempts',
    'flashcards', 'flashcard_review_logs',
    'ai_usage_daily', 'ai_requests'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "own_select" on public.%I', t);
    execute format('drop policy if exists "own_insert" on public.%I', t);
    execute format('drop policy if exists "own_update" on public.%I', t);
    execute format('drop policy if exists "own_delete" on public.%I', t);

    -- All four policies key on the row's user_id. Child rows also carry a
    -- denormalized user_id kept consistent by application logic + FKs.
    execute format(
      'create policy "own_select" on public.%I for select to authenticated
       using (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own_insert" on public.%I for insert to authenticated
       with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own_update" on public.%I for update to authenticated
       using (user_id = (select auth.uid()))
       with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own_delete" on public.%I for delete to authenticated
       using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Shared, non-user-owned tables: RLS on, NO policies. Only the table owner
-- (postgres / security-definer functions) and service_role may touch them.
alter table public.ai_usage_global_daily enable row level security;
alter table public.ai_rate_limits enable row level security;


-- ============================================================================
-- 9. Privileges — anon gets nothing; final quota hardening applied
-- ============================================================================

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;

-- Answer keys never reach the browser. RLS is row-level, not column-level, so
-- the blanket SELECT above exposes quizzes.content (expected_answer, rubric,
-- explanation) and the blanket UPDATE lets a user rewrite its own answer key
-- before submitting. Replace both with an explicit safe-column grant: the
-- keyed read and every write now go through the service-role client, and the
-- browser reads the sanitized projection from get_quiz_for_attempt().
revoke select, insert, update on table public.quizzes from authenticated;
grant select (id, user_id, title, source, collection_id, roadmap_step_id,
              task_id, schema_version, created_at, updated_at)
  on public.quizzes to authenticated;
grant delete on table public.quizzes to authenticated;   -- discard a draft

-- Scores are produced only by the assistant route (server-side grading of the
-- stored answer keys); a client-authored score would corrupt analytics.
revoke insert, update, delete on table public.quiz_attempts from authenticated;

-- Review history is written only by record_flashcard_review(), which checks
-- ownership, clamps the values and enforces the per-user idempotency key.
revoke insert, update, delete on table public.flashcard_review_logs from authenticated;

-- Quota hardening (former 0012): the browser must not write accounting rows.
-- The security-definer functions keep working (they run as the table owner),
-- and read_ai_usage()/read_ai_usage_history() still serve the caller's own
-- aggregates. `select` stays for transparency.
revoke insert, update, delete on table public.ai_usage_daily from authenticated;

-- Idempotency records must not be erasable for a free retry.
revoke delete on table public.ai_requests from authenticated;

-- Shared counters are server-only (no client grants at all).
revoke all on table public.ai_usage_global_daily from public, anon, authenticated;
revoke all on table public.ai_rate_limits from public, anon, authenticated;

-- Non-negative counters, enforced for every new insert/update.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_usage_daily_nonnegative'
      and conrelid = 'public.ai_usage_daily'::regclass
  ) then
    alter table public.ai_usage_daily
      add constraint ai_usage_daily_nonnegative
      check (
        request_count >= 0
        and input_tokens >= 0
        and output_tokens >= 0
      ) not valid;
  end if;
end $$;

-- The counter check above was added NOT VALID and never validated, so bad
-- legacy rows could remain. Repair them (a counter can never be negative) and
-- validate, so future direct writes are checked too.
update public.ai_usage_daily
  set request_count = greatest(request_count, 0),
      input_tokens  = greatest(input_tokens, 0),
      output_tokens = greatest(output_tokens, 0)
  where request_count < 0 or input_tokens < 0 or output_tokens < 0;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'ai_usage_daily_nonnegative'
      and conrelid = 'public.ai_usage_daily'::regclass
      and not convalidated
  ) then
    alter table public.ai_usage_daily validate constraint ai_usage_daily_nonnegative;
  end if;
end $$;


-- ============================================================================
-- 9b. Row integrity checks
-- ============================================================================
-- NOT VALID so an existing project converges without a full-table rewrite;
-- new and updated rows are enforced immediately. Rows written before this
-- block are left for the owner to audit (see diagnostics.sql).

-- Older rows can be `completed` with a NULL timestamp (backfilled from
-- created_at, the closest truthful approximation)
-- and unfinished rows can carry a timestamp (cleared — it has no meaning).
-- The completion trigger would overwrite the approximation with now(), so it
-- is briefly disabled for this one-time repair.
alter table public.tasks disable trigger trg_stamp_task_completion;

update public.tasks
  set completed_at = coalesce(completed_at, created_at, now())
  where completed and completed_at is null;

update public.tasks
  set completed_at = null
  where not completed and completed_at is not null;

alter table public.tasks enable trigger trg_stamp_task_completion;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quiz_attempts_score_bounds'
      and conrelid = 'public.quiz_attempts'::regclass
  ) then
    alter table public.quiz_attempts
      add constraint quiz_attempts_score_bounds
      check (
        score is null
        or (max_score is not null and max_score > 0
            and score >= 0 and score <= max_score)
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_completed_at_coherent'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_completed_at_coherent
      check (completed = (completed_at is not null)) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'flashcards_numbers_nonneg'
      and conrelid = 'public.flashcards'::regclass
  ) then
    alter table public.flashcards
      add constraint flashcards_numbers_nonneg
      check (
        (interval_days is null or interval_days >= 0)
        and (ease_factor is null or ease_factor > 0)
        and review_count >= 0
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'review_logs_numbers_nonneg'
      and conrelid = 'public.flashcard_review_logs'::regclass
  ) then
    alter table public.flashcard_review_logs
      add constraint review_logs_numbers_nonneg
      check (
        (interval_days is null or interval_days >= 0)
        and (elapsed_ms is null or elapsed_ms >= 0)
      ) not valid;
  end if;

  -- The table definitions above carry these range checks, but an existing
  -- database only received the columns (section 1b), not the constraints.
  -- Existing rows all hold the column defaults, so validating them is safe.
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_status_allowed'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_status_allowed
      check (status in ('pending', 'in_progress', 'completed', 'skipped')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_priority_allowed'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_priority_allowed
      check (priority in ('low', 'medium', 'high')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_estimated_minutes_nonneg'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_estimated_minutes_nonneg
      check (estimated_minutes is null or estimated_minutes >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'collections_status_allowed'
      and conrelid = 'public.collections'::regclass
  ) then
    alter table public.collections
      add constraint collections_status_allowed
      check (status in ('active', 'completed', 'archived')) not valid;
  end if;
end $$;

-- Trigger functions are invoked by the system; no client role needs EXECUTE.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.stamp_task_completion() from public, anon, authenticated;

-- Future objects must not inherit Supabase's permissive defaults. Without
-- this, every new table/function re-opens `anon` until someone remembers to
-- revoke it, and the per-table loop in section 8 only covers today's tables.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated;


-- ============================================================================
-- 10. Indexes
-- ============================================================================

create index if not exists idx_collections_user    on public.collections (user_id);
create index if not exists idx_tasks_user         on public.tasks (user_id);
create index if not exists idx_tasks_collection   on public.tasks (collection_id);
create index if not exists idx_tasks_user_created on public.tasks (user_id, created_at);
create index if not exists idx_tasks_completed_at on public.tasks (user_id, completed_at)
  where completed_at is not null;
create index if not exists idx_skillmaps_user     on public.skillmaps (user_id);
create index if not exists idx_roadmaps_user      on public.learning_roadmaps (user_id);
create index if not exists idx_roadmaps_collection on public.learning_roadmaps (collection_id);
create index if not exists idx_stages_roadmap     on public.roadmap_stages (roadmap_id);
create index if not exists idx_milestones_stage   on public.roadmap_milestones (roadmap_stage_id);
create index if not exists idx_steps_milestone    on public.roadmap_steps (milestone_id);
create index if not exists idx_steps_prereq_step  on public.roadmap_step_prerequisites (step_id);
create index if not exists idx_plans_user_date    on public.study_plans (user_id, plan_date);
create index if not exists idx_plan_items_plan    on public.study_plan_items (study_plan_id);
create index if not exists idx_conversations_user_created
  on public.ai_conversations (user_id, created_at);
create index if not exists idx_messages_conversation
  on public.ai_messages (conversation_id, created_at);
create index if not exists idx_quizzes_user       on public.quizzes (user_id);
create index if not exists idx_quiz_attempts_quiz on public.quiz_attempts (quiz_id);
create index if not exists idx_cards_user_next_review
  on public.flashcards (user_id, next_review_at)
  where status = 'active' and next_review_at is not null;
create index if not exists idx_review_logs_card   on public.flashcard_review_logs (flashcard_id);
create index if not exists idx_usage_user_date    on public.ai_usage_daily (user_id, usage_date);

-- Analytics / RLS-scoped reads (analytics.js, practice.js).
create index if not exists idx_quiz_attempts_user_completed
  on public.quiz_attempts (user_id, completed_at desc);
create index if not exists idx_review_logs_user_reviewed
  on public.flashcard_review_logs (user_id, reviewed_at desc);
create index if not exists idx_quizzes_user_created
  on public.quizzes (user_id, created_at desc);
create index if not exists idx_plan_items_user
  on public.study_plan_items (user_id);
-- Prerequisite cascades only indexed the parent side.
create index if not exists idx_steps_prereq_prereq
  on public.roadmap_step_prerequisites (prerequisite_step_id);

-- (The two unique roadmap_steps pair-indexes required by the prerequisite
-- composite FKs are created in section 2.2, before roadmap_step_prerequisites.)


-- ============================================================================
-- Done. Verify with:
--   select tablename, policyname from pg_policies
--   where schemaname = 'public' order by tablename;
--
--   -- quota functions should be service_role-only:
--   select p.proname, r.rolname
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   cross join lateral aclexplode(p.proacl) a
--   join pg_roles r on r.oid = a.grantee
--   where n.nspname = 'public'
--     and p.proname in ('reserve_ai_quota','release_ai_quota','record_ai_usage');
-- ============================================================================
