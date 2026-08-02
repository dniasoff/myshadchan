--
-- A shadchan's own task/interaction against a connection (Epic 8 Story 8.5,
-- Task 8, AC-9) — database test suite.
--
-- Task 8 widens ENTITY_TARGET_TYPES with 'connection' and adds the matching
-- `interactions` policy branch (05_policies.sql); this file proves the four
-- cases the story names explicitly:
--   (a) shadchan S1 can create and read a task/interaction with
--       target_type = 'connection', target_id = connection A<->S1.
--   (b) shadchan S2 — party to a DIFFERENT connection into the SAME
--       household — reads 0 rows for connection A<->S1's tasks/interactions.
--   (c) a member of household A cannot read S1's connection-1-targeted
--       interaction/task (account-scoped to S1's shadchanus account, not
--       A's — the same AD-20 guarantee shadchan_privacy_boundary.sql proves
--       for threads, now extended to this axis).
--   (d) inserting a target_type = 'connection' interaction/task whose
--       target_id is a connection the caller is NOT a party to is rejected
--       by the new exists(...) branch — no row created.
--
-- `tasks` needs no policy change (Task 8's own ruling — "Tasks scoped to
-- account" has no per-target-type exists() check today, so 'connection' is
-- already covered by the plain account_id floor); this suite still proves
-- the resulting behaviour end to end for tasks, not only for interactions,
-- since AC-9 names both.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (shadchan_connection_notes.test.ts) turns each row into a named assertion.
--
-- Falsifiability: (b)/(c) are pure RLS-filtered SELECTs (rows silently
-- disappear rather than raise), each preceded by an existence/positive
-- control proving the targeted row is real and readable by ITS OWN account
-- first — the same discipline shadchan_privacy_boundary.sql documents in its
-- own header ("a privacy suite that passes against a broken policy is worse
-- than none"). (d) is a real INSERT attempt that must raise the specific
-- RLS sqlstate/message (interactions_targets.sql's own convention) — never
-- a generic `exception when others`.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value bigint) on commit drop;
grant all on results to public;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- denied()/unexpected_raise() — interactions_targets.sql / shadchan_redting.sql's
-- own convention: name the exact sqlstate/message a denial must raise, so a
-- caught-but-wrong exception still fails the assertion.
-- ---------------------------------------------------------------------------
create function pg_temp.denied(
  p_name text,
  p_expected_sqlstate text,
  p_expected_message_like text,
  p_actual_sqlstate text,
  p_actual_message text
) returns void language plpgsql as $$
begin
  insert into results values (
    p_name,
    p_actual_sqlstate = p_expected_sqlstate
      and p_actual_message like p_expected_message_like,
    format('sqlstate %s %L (expected %s matching %L)',
           p_actual_sqlstate, p_actual_message,
           p_expected_sqlstate, p_expected_message_like)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Arrange: household A, two shadchanus contexts S1/S2 — three disjoint
-- logins — each of S1/S2 with its OWN accepted connection to household A
-- (mirrors shadchan_privacy_boundary.sql's own fixture shape exactly: AC-b
-- needs S2 genuinely connected to A via a DIFFERENT connection, not merely a
-- stranger).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('59500000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'connote-household-a@test.local'),
  ('59500000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'connote-shadchan-s1@test.local'),
  ('59500000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'connote-shadchan-s2@test.local');

insert into public.accounts (name, kind) values ('Connection Notes Household A', 'household')
returning id as household_a \gset
insert into public.accounts (name, kind) values ('Connection Notes Shadchanus S1', 'shadchanus')
returning id as shadchanus_s1 \gset
insert into public.accounts (name, kind) values ('Connection Notes Shadchanus S2', 'shadchanus')
returning id as shadchanus_s2 \gset

insert into ids values
  ('household_a', :household_a), ('shadchanus_s1', :shadchanus_s1), ('shadchanus_s2', :shadchanus_s2);

insert into public.account_members (account_id, user_id, role, status) values
  (:household_a, '59500000-0000-0000-0000-000000000001', 'parent_admin', 'active'),
  (:shadchanus_s1, '59500000-0000-0000-0000-000000000002', 'shadchan', 'active'),
  (:shadchanus_s2, '59500000-0000-0000-0000-000000000003', 'shadchan', 'active');

insert into public.connections (household_account_id, shadchanus_account_id, status, proposed_by_account_id, accepted_at, household_account_name)
values (:household_a, :shadchanus_s1, 'accepted', :household_a, now(), 'Connection Notes Household A')
returning id as connection_a_s1 \gset
insert into public.connections (household_account_id, shadchanus_account_id, status, proposed_by_account_id, accepted_at, household_account_name)
values (:household_a, :shadchanus_s2, 'accepted', :household_a, now(), 'Connection Notes Household A')
returning id as connection_a_s2 \gset

insert into ids values ('connection_a_s1', :connection_a_s1), ('connection_a_s2', :connection_a_s2);

-- ---------------------------------------------------------------------------
-- (a) S1 creates a task and an interaction (note) targeting its OWN
-- connection to household A, and reads both back.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59500000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'sanity: shadchan S1''s own session resolves current_context_id() to shadchanus S1', public.current_context_id() = :shadchanus_s1;

do $$
declare
  v_id bigint;
begin
  insert into public.tasks (account_id, target_type, target_id, text, due_date)
    values ((select value from ids where name = 'shadchanus_s1'), 'connection', (select value from ids where name = 'connection_a_s1'), 'Follow up after the redt', now() + interval '3 days')
    returning id into v_id;
  insert into ids values ('s1_task_id', v_id);
  insert into results values ('(a) S1 can create a task targeting its own connection to household A', true, null);
exception when others then
  insert into results values ('(a) S1 can create a task targeting its own connection to household A', false, sqlerrm);
end $$;

do $$
declare
  v_id bigint;
begin
  insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
    values ((select value from ids where name = 'shadchanus_s1'), 'connection', (select value from ids where name = 'connection_a_s1'), 'account', 'note', 'S1''s private note about this connection')
    returning id into v_id;
  insert into ids values ('s1_interaction_id', v_id);
  insert into results values ('(a) S1 can create an interaction (note) targeting its own connection to household A', true, null);
exception when others then
  insert into results values ('(a) S1 can create an interaction (note) targeting its own connection to household A', false, sqlerrm);
end $$;

insert into results (name, passed)
select '(a) S1 reads back its own task, with its real text',
       count(*) = 1 and bool_and(text = 'Follow up after the redt')
from public.tasks where id = (select value from ids where name = 's1_task_id');

insert into results (name, passed)
select '(a) S1 reads back its own interaction, with its real body',
       count(*) = 1 and bool_and(body = 'S1''s private note about this connection')
from public.interactions where id = (select value from ids where name = 's1_interaction_id');

reset role;

-- ---------------------------------------------------------------------------
-- (b) S2 — a shadchan connected to the SAME household via a DIFFERENT
-- connection — reads ZERO rows of S1's connection-1-targeted task/interaction.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59500000-0000-0000-0000-000000000003","role":"authenticated"}';

insert into results (name, passed)
select 'sanity: shadchan S2''s own session resolves current_context_id() to shadchanus S2, not S1', public.current_context_id() = :shadchanus_s2;

insert into results (name, passed)
select '(b) S2 (connected via a DIFFERENT connection) reads ZERO of S1''s connection-1-targeted tasks',
       count(*) = 0
from public.tasks where target_type = 'connection' and target_id = (select value from ids where name = 'connection_a_s1');

insert into results (name, passed)
select '(b) S2 (connected via a DIFFERENT connection) reads ZERO of S1''s connection-1-targeted interactions',
       count(*) = 0
from public.interactions where target_type = 'connection' and target_id = (select value from ids where name = 'connection_a_s1');

reset role;

-- ---------------------------------------------------------------------------
-- (c) A member of household A cannot read S1's connection-1-targeted task or
-- interaction — the row is account-scoped to S1's shadchanus account, never
-- household A's, regardless of which connection it names.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59500000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'sanity: household A''s own session resolves current_context_id() to household A', public.current_context_id() = :household_a;

insert into results (name, passed)
select '(c) household A reads ZERO rows of S1''s connection-1-targeted task, by id',
       count(*) = 0
from public.tasks where id = (select value from ids where name = 's1_task_id');

insert into results (name, passed)
select '(c) household A reads ZERO rows of S1''s connection-1-targeted interaction, by id',
       count(*) = 0
from public.interactions where id = (select value from ids where name = 's1_interaction_id');

reset role;

-- ---------------------------------------------------------------------------
-- (d) S2 attempts to insert an interaction targeting connection A<->S1 — a
-- connection S2 is NOT a party to. Rejected by the new exists(...) branch;
-- no row created. Mirrors interactions_targets.sql / threads_entity.sql's
-- own denied() convention: the specific RLS sqlstate/message, never a
-- generic catch.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59500000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
begin
  insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
  values ((select value from ids where name = 'shadchanus_s2'), 'connection', (select value from ids where name = 'connection_a_s1'), 'account', 'note', 'S2 attempting to note a connection it is not party to');

  -- Reached only if the insert unexpectedly SUCCEEDED — a real failure, not
  -- vacuously "no exception to check", so it is registered directly rather
  -- than falling through to the exception handler below.
  insert into results values (
    '(d) S2 inserting an interaction targeting a connection it is NOT a party to is rejected, no row created',
    false,
    'expected the insert to be rejected by RLS, but it succeeded'
  );
exception when others then
  perform pg_temp.denied(
    '(d) S2 inserting an interaction targeting a connection it is NOT a party to is rejected, no row created',
    '42501', 'new row violates row-level security policy for table "interactions"',
    sqlstate, sqlerrm
  );
end $$;

insert into results (name, passed)
select '(d) no interaction row was created by S2''s rejected attempt',
       count(*) = 0
from public.interactions
where target_type = 'connection'
  and target_id = (select value from ids where name = 'connection_a_s1')
  and body = 'S2 attempting to note a connection it is not party to';

reset role;

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
