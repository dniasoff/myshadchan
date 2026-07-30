--
-- Context scope lift — `tasks` and `interactions` (Story 3.14) — database
-- test suite.
--
-- Story 3.14 drops `validate_interactions_household_scope` and
-- `validate_tasks_household_scope` (04_triggers.sql) so a shadchanus-kind
-- account can insert a task and log an interaction — previously impossible,
-- because `set_account_id_default()` filled `account_id` with the caller's
-- active (shadchanus) context and `enforce_household_scope()` then rejected
-- that exact value. This suite proves the four required outcomes (AC 4) and
-- that cross-context isolation still holds afterwards, coming from the RLS
-- predicate rather than the (now absent, for these two tables) trigger
-- (AC 5).
--
-- One login `U` holds a `parent_admin` membership of household account `A`
-- and a `shadchan` membership of shadchanus account `B` — that role pairing
-- is mandatory (`enforce_membership_role_matches_context()` rejects any
-- other). Every cross-context check below is this ONE login switching its
-- active context, never two disjoint users — two disjoint users would pass
-- without ever exercising `current_context_id()`'s active-context
-- resolution, which is the thing that would actually regress (AD-19).
--
-- Every raise-expecting check — and, deliberately, the two SUCCESS-expecting
-- checks (AC 4(a)/4(b)) too — wraps its statement in `begin … exception when
-- others` and records the outcome in `results` rather than letting it
-- propagate. `\set ON_ERROR_STOP on` is on, so an unwrapped failing INSERT
-- would abort the whole script and emit no JSON report — exactly what AC 7's
-- pre-migration ("red") rehearsal must not do. Pre-migration, AC 4(a)/4(b)'s
-- inserts fail (as expected — that failure IS the red result); wrapping is
-- what turns that failure into a reported `passed = false` row instead of an
-- aborted script.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so any id
-- a DO block below needs is shared through the `ids` temp table rather than
-- \gset (established by context_resolution.sql / context_rls_hardening.sql).
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (household_scope_lift.test.ts) turns each row into a named assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- AC 4(d): the catalog fact. Position-independent — checked before any
-- fixture is built, so nothing above can accidentally influence it.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC 4(d): enforce_household_scope is attached to exactly 12 tables, neither tasks nor interactions among them',
       (select count(*) from pg_trigger where tgfoid = 'public.enforce_household_scope'::regproc and not tgisinternal) = 12
   and not exists (
     select 1 from pg_trigger
     where tgfoid = 'public.enforce_household_scope'::regproc
       and not tgisinternal
       and tgrelid in ('public.tasks'::regclass, 'public.interactions'::regclass)
   );

-- ---------------------------------------------------------------------------
-- Arrange: ONE login U — parent_admin of household A, shadchan of
-- shadchanus B. activate_first_context_trigger activates A (U's first live
-- membership); adding B afterward leaves A active (AC-5, context_resolution.sql).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('a5111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hsl-u@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('HSL Household A', 'household') returning id as acct_a \gset
insert into public.accounts (kind) values ('shadchanus') returning id as acct_b \gset
insert into ids values ('acct_a', :'acct_a'), ('acct_b', :'acct_b');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'a5111111-1111-1111-1111-111111111111', 'parent_admin', 'active');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'a5111111-1111-1111-1111-111111111111', 'shadchan', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a5111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: U''s active context is household A right after both memberships exist',
       public.current_context_id() = :acct_a;

-- Fixture rows in household A — always legal, before and after this story
-- (A is household-kind), so a plain insert (not wrapped) is fine: if this
-- ever failed it should abort the script, not be swallowed. Used by AC 5(b)
-- as "A's rows", proven invisible once B is active.
insert into public.tasks (target_type, target_id, text)
values ('reference', 1, 'HSL Task A') returning id as task_a_id \gset
insert into public.interactions (target_type, target_id)
values ('reference', 1) returning id as interaction_a_id \gset

-- ---------------------------------------------------------------------------
-- AC 4(a)/4(b): with B active, tasks/interactions inserts now succeed.
-- ---------------------------------------------------------------------------
select public.set_active_context(:acct_b);

insert into results (name, passed)
select 'Arrange: U''s active context is shadchanus B after switching',
       public.current_context_id() = :acct_b;

do $$
declare
  v_id bigint;
  v_account_id bigint;
begin
  insert into public.tasks (target_type, target_id, text)
    values ('reference', 1, 'HSL Task B')
    returning id, account_id into v_id, v_account_id;
  insert into ids values ('task_b_id', v_id::text);
  insert into results values (
    'AC 4(a): insert into public.tasks succeeds with a shadchanus context active, and lands with account_id = B',
    v_account_id = (select value::bigint from ids where name = 'acct_b'),
    format('account_id=%s', v_account_id)
  );
exception when others then
  insert into results values (
    'AC 4(a): insert into public.tasks succeeds with a shadchanus context active, and lands with account_id = B',
    false, sqlerrm
  );
end $$;

-- target_type = 'reference', scope = 'account', reference_link_id = null —
-- the one interactions_scope_link_check shape that needs no household row to
-- exist (the other two need a real reference_links/shidduchim row, neither
-- of which a shadchanus account can hold). A shadchan- or single-targeted
-- interaction is Story 3.5's widening, not this story's.
do $$
declare
  v_id bigint;
  v_account_id bigint;
begin
  insert into public.interactions (target_type, target_id, scope)
    values ('reference', 1, 'account')
    returning id, account_id into v_id, v_account_id;
  insert into ids values ('interaction_b_id', v_id::text);
  insert into results values (
    'AC 4(b): insert into public.interactions succeeds with a shadchanus context active, and lands with account_id = B',
    v_account_id = (select value::bigint from ids where name = 'acct_b'),
    format('account_id=%s', v_account_id)
  );
exception when others then
  insert into results values (
    'AC 4(b): insert into public.interactions succeeds with a shadchanus context active, and lands with account_id = B',
    false, sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC 4(c): singles is untouched by this story — still raises, matching the
-- exact enforce_household_scope() message (not merely "something raised":
-- singles has other constraints that could raise just as happily).
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.singles (first_name_en) values ('HSL Single (should never land)');
  insert into results values ('AC 4(c): insert into public.singles still raises with a shadchanus context active', false, 'insert succeeded');
exception when others then
  insert into results values (
    'AC 4(c): insert into public.singles still raises with a shadchanus context active',
    sqlerrm like '%is not a household-kind account%', sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC 5(a): switch back to A. B's rows (if they exist — pre-migration they
-- don't, which is exactly what makes this arm pass vacuously in the red run,
-- per AC 7) are invisible.
-- ---------------------------------------------------------------------------
select public.set_active_context(:acct_a);

insert into results (name, passed)
select 'AC 5(a): tasks — the row created while B was active is invisible now that A is active',
       (select count(*) from public.tasks where id = (select value::bigint from ids where name = 'task_b_id')) = 0;

insert into results (name, passed)
select 'AC 5(a): interactions — the row created while B was active is invisible now that A is active',
       (select count(*) from public.interactions where id = (select value::bigint from ids where name = 'interaction_b_id')) = 0;

-- ---------------------------------------------------------------------------
-- AC 5(c): the load-bearing arm. With A active, an INSERT that explicitly
-- supplies account_id = B is rejected — pre-migration by
-- enforce_household_scope() (B is shadchanus, its BEFORE trigger fires
-- before RLS's WITH CHECK is ever consulted); post-migration by the RLS
-- `with check` alone, since set_account_id_default() only ever fills a NULL
-- and never overrides a client-supplied value. Either way the insert must
-- fail — proven green in both the red and the green rehearsal (AC 7).
--
-- The message is asserted, not merely "something raised" (the AC 4(c) trap,
-- context_resolution.sql:577-584): pre-migration it is
-- enforce_household_scope()'s "% is not a household-kind account"
-- [Source: supabase/schemas/02_functions.sql:396-397]; post-migration, with
-- that trigger gone, it is Postgres's own "new row violates row-level
-- security policy for table ...". Both are legitimate — this suite's own
-- red rehearsal (AC 7) requires 5(c) green *before* the migration too, when
-- only the trigger message can occur — so the check accepts either named
-- message and rejects anything else (e.g. a future constraint match that
-- would mask a regressed policy).
-- ---------------------------------------------------------------------------
do $$
declare
  v_acct_b bigint;
begin
  select value::bigint into v_acct_b from ids where name = 'acct_b';
  insert into public.tasks (target_type, target_id, text, account_id)
    values ('reference', 1, 'HSL evil task (should never land)', v_acct_b);
  insert into results values (
    'AC 5(c): tasks — an explicit foreign account_id (B) is rejected while A is active',
    false, 'insert unexpectedly succeeded'
  );
exception when others then
  insert into results values (
    'AC 5(c): tasks — an explicit foreign account_id (B) is rejected while A is active',
    sqlerrm like '%is not a household-kind account%'
      or sqlerrm like '%row-level security policy%',
    sqlerrm
  );
end $$;

do $$
declare
  v_acct_b bigint;
begin
  select value::bigint into v_acct_b from ids where name = 'acct_b';
  insert into public.interactions (target_type, target_id, scope, account_id)
    values ('reference', 1, 'account', v_acct_b);
  insert into results values (
    'AC 5(c): interactions — an explicit foreign account_id (B) is rejected while A is active',
    false, 'insert unexpectedly succeeded'
  );
exception when others then
  insert into results values (
    'AC 5(c): interactions — an explicit foreign account_id (B) is rejected while A is active',
    sqlerrm like '%is not a household-kind account%'
      or sqlerrm like '%row-level security policy%',
    sqlerrm
  );
end $$;

-- ---------------------------------------------------------------------------
-- AC 5(b): switch back to B. B's rows are visible again (when they exist —
-- pre-migration they don't, which is exactly what makes this arm fail in the
-- red run, per AC 7), and now A's rows are the ones invisible.
-- ---------------------------------------------------------------------------
select public.set_active_context(:acct_b);

insert into results (name, passed)
select 'AC 5(b): tasks — the row created while B was active is visible again now that B is active',
       (select count(*) from public.tasks where id = (select value::bigint from ids where name = 'task_b_id')) = 1;

insert into results (name, passed)
select 'AC 5(b): interactions — the row created while B was active is visible again now that B is active',
       (select count(*) from public.interactions where id = (select value::bigint from ids where name = 'interaction_b_id')) = 1;

insert into results (name, passed)
select 'AC 5(b): tasks — A''s row is invisible now that B is active',
       (select count(*) from public.tasks where id = :task_a_id) = 0;

insert into results (name, passed)
select 'AC 5(b): interactions — A''s row is invisible now that B is active',
       (select count(*) from public.interactions where id = :interaction_a_id) = 0;

reset role;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
