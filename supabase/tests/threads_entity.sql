--
-- Threads (Epic 7 Story 7.1) — database test suite.
--
-- Covers AC-1, AC-2, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11:
-- create_thread()'s validation and its "always add the creator" guarantee,
-- the dual-axis XOR check by SQLSTATE, the participant-gated INSERT on
-- messages/thread_participants (including the AC-8 self-join gate), the
-- single's three-clause dignity floor composed with Epic 6 (AC-9), the
-- polymorphic delete cascade across BOTH scope axes (AC-10), connections'
-- read-only posture (AC-6), and tenant isolation with the one-login-two-
-- accounts negative (AC-11, contract §13 rule 3).
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (threads_entity.test.ts) turns each row into a named assertion.
--
-- Uses the shared "two siblings, one household" fixture (dbSuiteHelpers.ts,
-- siblingHouseholdFixtureSql()) — spliced in by threads_entity.test.ts BEFORE
-- this file — for AC-9's dignity-floor test, exactly as single_row_scoping.sql
-- does. This file adds only what is specific to threads: tenant B, a
-- shadchanus account + connection, three AC-9 shidduchim, and every thread/
-- message/participant row the checks below need.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so any id
-- a DO block needs is shared through the `ids` temp table rather than \gset.
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
-- Denial assertions name the error they expect (single_row_scoping.sql's own
-- convention — see its header comment for the "exception when others then …
-- PASS" failure mode this closes).
--
--   denied()           — the call MUST raise, with THIS sqlstate and THIS
--                        message. A different failure fails the assertion.
--   unexpected_raise() — the call must NOT raise at all. Any exception fails.
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

create function pg_temp.unexpected_raise(
  p_name text,
  p_actual_sqlstate text,
  p_actual_message text
) returns void language plpgsql as $$
begin
  insert into results values (
    p_name,
    false,
    format('expected the call to return an empty result, not raise; got sqlstate %s %L',
           p_actual_sqlstate, p_actual_message)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Arrange (as postgres/superuser). The sibling fixture (spliced in before
-- this file) already gave us: sibling_fixture_account_id (household),
-- sibling_fixture_parent_member_id, sibling_fixture_leah_member_id,
-- sibling_fixture_rivka_member_id, sibling_fixture_leah_single_id,
-- sibling_fixture_rivka_single_id.
-- ---------------------------------------------------------------------------
insert into ids values
  ('sibling_fixture_account_id', :sibling_fixture_account_id),
  ('sibling_fixture_parent_member_id', :sibling_fixture_parent_member_id),
  ('sibling_fixture_leah_member_id', :sibling_fixture_leah_member_id),
  ('sibling_fixture_rivka_member_id', :sibling_fixture_rivka_member_id);

-- A fourth member of the SAME household, role 'helper' — used for the AC-8
-- tests below instead of Rivka. Rivka is 'single' and does not hold the
-- suggestion `thread1` sits on, so thread_is_readable() ALREADY denies her
-- (AC-9's dignity floor) before AC-8's own participant gate is ever reached:
-- set_thread_participant_defaults()'s parent-copy SELECT runs under HER own
-- RLS, finds no row, and leaves account_id null regardless of the INSERT
-- policy's exists() clause — a self-join attempt would misleadingly "pass"
-- for the wrong reason. A 'helper' has no dignity-floor narrowing at all
-- (05_policies.sql), so she CAN read thread1, isolating AC-8's own gate as
-- the only mechanism under test — proven by the mutation check in this
-- story's own review pass (temporarily dropping the exists() clause turns
-- this suite's two AC-8 assertions red, and only those two).
insert into auth.users (id, instance_id, aud, role, email)
values ('51810000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'threads-helper@test.local');

insert into public.account_members (account_id, user_id, role, status)
values (:sibling_fixture_account_id, '51810000-0000-0000-0000-000000000012', 'helper', 'active')
returning id as helper_member_id \gset
insert into ids values ('helper_member_id', :helper_member_id);

-- Tenant B: a second, wholly separate household — cross-account negatives
-- (create_thread()'s own account-boundary checks) need a real "elsewhere".
insert into auth.users (id, instance_id, aud, role, email)
values ('51810000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'threads-tenant-b@test.local');

insert into public.accounts (name, kind) values ('Threads Tenant B', 'household')
returning id as tenant_b_account_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:tenant_b_account_id, '51810000-0000-0000-0000-000000000010', 'parent_admin', 'active')
returning id as tenant_b_member_id \gset

insert into public.singles (account_id, first_name_en, gender)
values (:tenant_b_account_id, 'Devora', 'female')
returning id as tenant_b_single_id \gset

insert into public.shidduchim (account_id, single_id, name_en, pipeline_state)
values (:tenant_b_account_id, :tenant_b_single_id, 'Tenant B Suggestion', 'look_into')
returning id as tenant_b_shidduch_id \gset

-- A shadchanus account, and an accepted connection to the sibling household
-- (AC-10's service-role-seeded connection-scoped thread needs a real
-- connection to walk back through).
insert into public.accounts (name, kind) values ('Threads Test Shadchanus', 'shadchanus')
returning id as shadchanus_account_id \gset

insert into public.connections (household_account_id, shadchanus_account_id, status)
values (:sibling_fixture_account_id, :shadchanus_account_id, 'accepted')
returning id as test_connection_id \gset

insert into ids values
  ('tenant_b_account_id', :tenant_b_account_id),
  ('tenant_b_member_id', :tenant_b_member_id),
  ('tenant_b_shidduch_id', :tenant_b_shidduch_id),
  ('test_connection_id', :test_connection_id);

-- AC-9's three shidduchim: Leah's own (shared, single-visible state), Rivka's
-- ("the sibling's", same shape), and a SECOND one of Leah's own with
-- visibility='private_parent' — both single-visible states, so the pipeline
-- state alone cannot be what passes either negative.
insert into public.shidduchim (account_id, single_id, name_en, pipeline_state, visibility)
values (:sibling_fixture_account_id, :sibling_fixture_leah_single_id, 'Leah Visible Suggestion', 'look_into', 'shared')
returning id as leah_shidduch_id \gset

insert into public.shidduchim (account_id, single_id, name_en, pipeline_state, visibility)
values (:sibling_fixture_account_id, :sibling_fixture_rivka_single_id, 'Rivka Visible Suggestion', 'look_into', 'shared')
returning id as rivka_shidduch_id \gset

insert into public.shidduchim (account_id, single_id, name_en, pipeline_state, visibility)
values (:sibling_fixture_account_id, :sibling_fixture_leah_single_id, 'Leah Private Suggestion', 'look_into', 'private_parent')
returning id as leah_private_shidduch_id \gset

insert into ids values
  ('leah_shidduch_id', :leah_shidduch_id),
  ('rivka_shidduch_id', :rivka_shidduch_id),
  ('leah_private_shidduch_id', :leah_private_shidduch_id);

-- ---------------------------------------------------------------------------
-- AC-5: the XOR check, by SQLSTATE. Run as postgres (bypasses RLS) so the
-- check constraint itself is isolated from the INSERT policy, which would
-- otherwise refuse a connection-scoped attempt before the constraint is
-- ever reached.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'threads_scope_check: an INSERT with BOTH account_id and connection_id set raises 23514';
  v_account bigint; v_connection bigint;
begin
  select value into v_account from ids where name = 'sibling_fixture_account_id';
  select value into v_connection from ids where name = 'test_connection_id';
  insert into public.threads (account_id, connection_id, subject_type, subject_id, visibility)
  values (v_account, v_connection, 'relationship', null, 'open');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%', sqlstate, sqlerrm);
end $$;

do $$
declare v_name constant text := 'threads_scope_check: an INSERT with NEITHER account_id nor connection_id set raises 23514';
begin
  insert into public.threads (account_id, connection_id, subject_type, subject_id, visibility)
  values (null, null, 'relationship', null, 'open');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'thread_participants_scope_check: an INSERT with BOTH scope columns set raises 23514';
  v_account bigint; v_connection bigint; v_member bigint;
begin
  select value into v_account from ids where name = 'sibling_fixture_account_id';
  select value into v_connection from ids where name = 'test_connection_id';
  select value into v_member from ids where name = 'sibling_fixture_parent_member_id';
  insert into public.thread_participants (account_id, connection_id, thread_id, member_id)
  values (v_account, v_connection, 0, v_member);
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%', sqlstate, sqlerrm);
end $$;

do $$
declare v_name constant text := 'messages_scope_check: an INSERT with NEITHER scope column set raises 23514';
begin
  insert into public.messages (account_id, connection_id, thread_id, body)
  values (null, null, 0, 'orphan message');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Act as the parent (sibling household). create_thread() happy path (AC-1,
-- AC-2, AC-7) plus its own validation (fail-fast on a cross-account subject
-- or participant).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

select (public.create_thread('shidduch', :leah_shidduch_id, array[]::bigint[], null)).id as thread1 \gset
insert into ids values ('thread1', :thread1);

insert into results (name, passed)
select 'create_thread(): the thread is scoped to the caller''s account, open by default, and named to the given subject',
       t.account_id = :sibling_fixture_account_id and t.connection_id is null
       and t.subject_type = 'shidduch' and t.subject_id = :leah_shidduch_id
       and t.visibility = 'open' and t.created_by_member_id = :sibling_fixture_parent_member_id
from public.threads t where t.id = :thread1;

insert into results (name, passed)
select 'create_thread(): the creator is a participant from the moment the thread exists (AC-2)',
       count(*) = 1
from public.thread_participants tp
where tp.thread_id = :thread1 and tp.member_id = :sibling_fixture_parent_member_id;

select (public.create_thread('shidduch', :leah_shidduch_id, array[:sibling_fixture_leah_member_id]::bigint[], null)).id as thread_with_participant \gset
insert into ids values ('thread_with_participant', :thread_with_participant);

insert into results (name, passed)
select 'create_thread(): one thread_participants row per DISTINCT supplied id, plus the creator (AC-7)',
       count(*) = 2
from public.thread_participants tp where tp.thread_id = :thread_with_participant;

do $$
declare
  v_name constant text := 'create_thread() raises when a supplied participant id is not an active member of the caller''s own account (AC-7)';
  v_leah_shidduch bigint; v_other_member bigint;
begin
  select value into v_leah_shidduch from ids where name = 'leah_shidduch_id';
  select value into v_other_member from ids where name = 'tenant_b_member_id';
  perform public.create_thread('shidduch', v_leah_shidduch, array[v_other_member]::bigint[], null);
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, 'P0001', 'member % not found in current account', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'create_thread() rejects a shidduch subject_id belonging to another account (AC-1)';
  v_other_shidduch bigint;
begin
  select value into v_other_shidduch from ids where name = 'tenant_b_shidduch_id';
  perform public.create_thread('shidduch', v_other_shidduch, array[]::bigint[], null);
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, 'P0001', 'shidduch % not found in current account', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Review fix F2/F4: threads has NO INSERT grant for `authenticated` at all
-- (06_grants.sql) — create_thread() is the sole creation path. A direct
-- dataProvider.create("threads", …) must be denied at the ACL layer
-- (42501, "permission denied for table threads"), not merely by RLS —
-- which is what closes AC-1's subject-reachability gap (the old `with
-- check` validated only the scope axis, never that subject_id actually
-- named a reachable row) and F4's INSERT…RETURNING trap in the same stroke.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'F2: a direct threads INSERT naming ANOTHER account''s shidduch as subject is denied at the grant layer, not merely RLS';
  v_account bigint; v_other_shidduch bigint;
begin
  select value into v_account from ids where name = 'sibling_fixture_account_id';
  select value into v_other_shidduch from ids where name = 'tenant_b_shidduch_id';
  insert into public.threads (account_id, subject_type, subject_id, visibility)
  values (v_account, 'shidduch', v_other_shidduch, 'open');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'permission denied for table threads', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'F2: a direct threads INSERT naming a NONEXISTENT subject_id is denied at the grant layer';
  v_account bigint;
begin
  select value into v_account from ids where name = 'sibling_fixture_account_id';
  insert into public.threads (account_id, subject_type, subject_id, visibility)
  values (v_account, 'shidduch', 999999999, 'open');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'permission denied for table threads', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Review fix F3: the thread_participants INSERT policy validates the
-- CALLER's own participation and account_id, but originally never checked
-- whose account the ADDED member_id belongs to. The parent (already a
-- participant of thread1) attempts to add tenant B's member — must be
-- denied by RLS, distinct from AC-8's self-join denial above.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'F3: an existing participant cannot add a member of a DIFFERENT account to their own thread';
  v_thread bigint; v_other_member bigint;
begin
  select value into v_thread from ids where name = 'thread1';
  select value into v_other_member from ids where name = 'tenant_b_member_id';
  insert into public.thread_participants (thread_id, member_id) values (v_thread, v_other_member);
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'new row violates row-level security policy for table "thread_participants"', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Act as the helper — a same-account member, NOT single-role-restricted (so
-- she can read thread1 and its parent shidduch without tripping AC-9's
-- dignity floor), who is a participant of NEITHER thread above. AC-8:
-- participant-gating on messages and thread_participants, even for a
-- same-account member who can see the conversation exists.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000012","role":"authenticated"}';

insert into results (name, passed)
select 'AC-8 control: the helper CAN read thread1 (not blocked by AC-9''s dignity floor — she is not single-role) — isolates the AC-8 denials below to the participant gate specifically',
       count(*) = 1 from public.threads where id = :thread1;

do $$
declare
  v_name constant text := 'AC-8: a non-participant same-account member cannot INSERT into messages';
  v_thread bigint;
begin
  select value into v_thread from ids where name = 'thread1';
  insert into public.messages (thread_id, body) values (v_thread, 'the helper trying to post');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'new row violates row-level security policy for table "messages"', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'AC-8: a non-participant cannot self-join a thread by inserting their own thread_participants row';
  v_thread bigint; v_helper bigint;
begin
  select value into v_thread from ids where name = 'thread1';
  select value into v_helper from ids where name = 'helper_member_id';
  insert into public.thread_participants (thread_id, member_id) values (v_thread, v_helper);
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'new row violates row-level security policy for table "thread_participants"', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Act as Leah — a listed participant of thread_with_participant. Control:
-- proves the two AC-8 denials above are about participation, not a broken
-- table or a mis-scoped policy.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into public.messages (thread_id, body) values (:thread_with_participant, 'Hi from Leah')
returning id as leah_message_id \gset
insert into ids values ('leah_message_id', :leah_message_id);

insert into results (name, passed)
select 'control: an existing participant CAN post — sender_member_id/account_id are server-stamped from the caller and the parent thread',
       m.sender_member_id = :sibling_fixture_leah_member_id
       and m.account_id = :sibling_fixture_account_id
       and m.connection_id is null
       and m.body = 'Hi from Leah'
from public.messages m where m.id = :leah_message_id;

-- ---------------------------------------------------------------------------
-- Review fix F1: sender_member_id is UNCONDITIONALLY server-stamped, not
-- merely defaulted when omitted. Leah supplies a forged sender_member_id on
-- both probes; the trigger must overwrite it with HER OWN resolved member
-- id regardless of what the client sent — proving a client-supplied value
-- is never accepted, not just that an omitted one is filled in.
-- ---------------------------------------------------------------------------
insert into public.messages (thread_id, sender_member_id, body)
values (:thread_with_participant, :sibling_fixture_parent_member_id, 'forged same-account sender')
returning id as leah_forged_same_account_message \gset
insert into ids values ('leah_forged_same_account_message', :leah_forged_same_account_message);

insert into results (name, passed)
select 'F1: a client-supplied sender_member_id naming ANOTHER member of the SAME account is overwritten with the caller''s own id',
       sender_member_id = :sibling_fixture_leah_member_id
from public.messages where id = :leah_forged_same_account_message;

insert into public.messages (thread_id, sender_member_id, body)
values (:thread_with_participant, :tenant_b_member_id, 'forged cross-account sender')
returning id as leah_forged_cross_account_message \gset
insert into ids values ('leah_forged_cross_account_message', :leah_forged_cross_account_message);

insert into results (name, passed)
select 'F1: a client-supplied sender_member_id naming a member of a COMPLETELY DIFFERENT account is overwritten with the caller''s own id',
       sender_member_id = :sibling_fixture_leah_member_id
from public.messages where id = :leah_forged_cross_account_message;

do $$
declare
  v_name constant text := 'messages_body_not_blank_check: a whitespace-only body is rejected even for an authorised participant';
  v_thread bigint;
begin
  select value into v_thread from ids where name = 'thread_with_participant';
  insert into public.messages (thread_id, body) values (v_thread, '   ');
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', '%', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AC-9: the single's dignity floor composes with Epic 6 — all three clauses,
-- not one. Leah is made an EXPLICIT PARTICIPANT of every thread below
-- (including the two she must NOT read), so the negatives prove the
-- shidduch-visibility gate, not merely "you are not in this conversation".
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

select (public.create_thread('shidduch', :leah_shidduch_id, array[:sibling_fixture_leah_member_id]::bigint[], null)).id as thread_leah_open \gset
select (public.create_thread('shidduch', :rivka_shidduch_id, array[:sibling_fixture_leah_member_id]::bigint[], null)).id as thread_rivka_open \gset
select (public.create_thread('shidduch', :leah_private_shidduch_id, array[:sibling_fixture_leah_member_id]::bigint[], null)).id as thread_leah_private \gset
insert into ids values
  ('thread_leah_open', :thread_leah_open),
  ('thread_rivka_open', :thread_rivka_open),
  ('thread_leah_private', :thread_leah_private);

insert into public.messages (thread_id, body) values (:thread_leah_open, 'A message on Leah''s own visible thread')
returning id as leah_open_message_id \gset
insert into public.messages (thread_id, body) values (:thread_rivka_open, 'A message on the sibling''s thread')
returning id as rivka_open_message_id \gset
insert into public.messages (thread_id, body) values (:thread_leah_private, 'A message on the private_parent thread')
returning id as leah_private_message_id \gset
insert into ids values
  ('leah_open_message_id', :leah_open_message_id),
  ('rivka_open_message_id', :rivka_open_message_id),
  ('leah_private_message_id', :leah_private_message_id);

insert into results (name, passed)
select 'AC-9 control: the parent can read all three dignity-floor threads before Leah''s restricted view is tested',
       (select count(*) from public.threads where id in (:thread_leah_open, :thread_rivka_open, :thread_leah_private)) = 3;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'AC-9(own): a single participant reads an open thread on her OWN shidduch with visibility=shared and a single-visible pipeline state',
       count(*) = 1 from public.threads where id = :thread_leah_open;

insert into results (name, passed)
select 'AC-9(own): the single also reads the message on her own visible thread',
       count(*) = 1 from public.messages where id = :leah_open_message_id;

insert into results (name, passed)
select 'AC-9(sibling): a single participant reads ZERO rows for an open thread on a SIBLING''s shidduch, despite the SAME single-visible pipeline state — the pipeline-state clause alone would pass this',
       count(*) = 0 from public.threads where id = :thread_rivka_open;

insert into results (name, passed)
select 'AC-9(sibling): the single reads ZERO rows for a message on the sibling''s thread, despite being a listed participant',
       count(*) = 0 from public.messages where id = :rivka_open_message_id;

insert into results (name, passed)
select 'AC-9(private_parent): a single participant reads ZERO rows for an open thread on her OWN shidduch when its visibility is private_parent — the SAME single-visible pipeline state, so the state clause alone would pass this too',
       count(*) = 0 from public.threads where id = :thread_leah_private;

insert into results (name, passed)
select 'AC-9(private_parent): the single reads ZERO rows for a message on her own private_parent-visibility thread',
       count(*) = 0 from public.messages where id = :leah_private_message_id;

-- ---------------------------------------------------------------------------
-- AC-10: a deleted shidduch takes its threads with it, on BOTH scope axes.
-- ---------------------------------------------------------------------------
reset role;

insert into public.shidduchim (account_id, single_id, name_en, pipeline_state, visibility)
values (:sibling_fixture_account_id, :sibling_fixture_leah_single_id, 'Deletion Test Suggestion', 'look_into', 'shared')
returning id as deletion_shidduch \gset
insert into ids values ('deletion_shidduch', :deletion_shidduch);

set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

select (public.create_thread('shidduch', :deletion_shidduch, array[]::bigint[], null)).id as deletion_account_thread \gset
insert into public.messages (thread_id, body) values (:deletion_account_thread, 'about to be deleted')
returning id as deletion_account_message \gset
insert into ids values
  ('deletion_account_thread', :deletion_account_thread),
  ('deletion_account_message', :deletion_account_message);

reset role;

-- A service-role-seeded connection-scoped thread about the SAME subject —
-- what create_thread() cannot produce until Story 7.4, but a raw insert
-- (bypassing RLS exactly like service_role would) can, for exactly this
-- test. Proves the exists() arm of purge_polymorphic_dependents()'s new
-- delete: an account_id = old.account_id predicate alone would miss this row
-- entirely (its account_id is NULL).
insert into public.threads (connection_id, subject_type, subject_id, visibility)
values (:test_connection_id, 'shidduch', :deletion_shidduch, 'open')
returning id as deletion_connection_thread \gset
insert into public.thread_participants (connection_id, thread_id, member_id)
values (:test_connection_id, :deletion_connection_thread, :sibling_fixture_parent_member_id)
returning id as deletion_connection_participant \gset
insert into public.messages (connection_id, thread_id, body)
values (:test_connection_id, :deletion_connection_thread, 'a shadchan''s note about the same subject')
returning id as deletion_connection_message \gset
insert into ids values
  ('deletion_connection_thread', :deletion_connection_thread),
  ('deletion_connection_participant', :deletion_connection_participant),
  ('deletion_connection_message', :deletion_connection_message);

insert into results (name, passed)
select 'AC-10 control: both the account-scoped and connection-scoped threads on the subject exist before it is deleted',
       (select count(*) from public.threads where id in (:deletion_account_thread, :deletion_connection_thread)) = 2;

delete from public.shidduchim where id = :deletion_shidduch;

insert into results (name, passed)
select 'AC-10: deleting the subject shidduchim row deletes its account-scoped thread',
       not exists (select 1 from public.threads where id = :deletion_account_thread);

insert into results (name, passed)
select 'AC-10: deleting the subject shidduchim row ALSO deletes a connection-scoped thread about the same subject',
       not exists (select 1 from public.threads where id = :deletion_connection_thread);

insert into results (name, passed)
select 'AC-10: the account-scoped thread''s message cascades away with it',
       not exists (select 1 from public.messages where id = :deletion_account_message);

insert into results (name, passed)
select 'AC-10: the connection-scoped thread''s message and participant cascade away with it too',
       not exists (select 1 from public.messages where id = :deletion_connection_message)
       and not exists (select 1 from public.thread_participants where id = :deletion_connection_participant);

-- ---------------------------------------------------------------------------
-- AC-6: connections has no client write path at all — not merely RLS-empty,
-- but ungrantable (06_grants.sql issues authenticated no INSERT grant).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-6: an authenticated client cannot INSERT into public.connections at all (no grant, not just no policy)';
  v_household bigint;
begin
  select value into v_household from ids where name = 'sibling_fixture_account_id';
  insert into public.connections (household_account_id, shadchanus_account_id) values (v_household, 999999999);
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'permission denied for table connections', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AC-11: one login, memberships in accounts A (the sibling household) and B,
-- active in A — never two disjoint users (contract §13 rule 3): only a
-- SECOND membership on the SAME login can distinguish "filtered by the
-- active context" from "filtered by any membership the caller holds".
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id, instance_id, aud, role, email)
values ('51810000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'threads-dual-tenant@test.local');

insert into public.account_members (account_id, user_id, role, status)
values (:sibling_fixture_account_id, '51810000-0000-0000-0000-000000000011', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:tenant_b_account_id, '51810000-0000-0000-0000-000000000011', 'parent_admin', 'active');

-- Tenant B's own thread/participant/message, seeded directly (postgres
-- bypasses RLS, standing in for a real Tenant-B login's create_thread()
-- call — what actually wrote it is irrelevant to this isolation check).
insert into public.threads (account_id, subject_type, subject_id, visibility, created_by_member_id)
values (:tenant_b_account_id, 'shidduch', :tenant_b_shidduch_id, 'open', :tenant_b_member_id)
returning id as tenant_b_thread \gset
insert into public.thread_participants (account_id, thread_id, member_id)
values (:tenant_b_account_id, :tenant_b_thread, :tenant_b_member_id)
returning id as tenant_b_participant \gset
insert into public.messages (account_id, thread_id, sender_member_id, body)
values (:tenant_b_account_id, :tenant_b_thread, :tenant_b_member_id, 'Tenant B private note')
returning id as tenant_b_message \gset
insert into ids values
  ('tenant_b_thread', :tenant_b_thread),
  ('tenant_b_participant', :tenant_b_participant),
  ('tenant_b_message', :tenant_b_message);

set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000011","role":"authenticated"}';
select public.set_active_context(:sibling_fixture_account_id);

insert into results (name, passed)
select 'AC-11: one login active in A reads ZERO rows of tenant B''s threads',
       count(*) = 0 from public.threads where id = :tenant_b_thread;

insert into results (name, passed)
select 'AC-11: one login active in A reads ZERO rows of tenant B''s thread_participants',
       count(*) = 0 from public.thread_participants where id = :tenant_b_participant;

insert into results (name, passed)
select 'AC-11: one login active in A reads ZERO rows of tenant B''s messages',
       count(*) = 0 from public.messages where id = :tenant_b_message;

select public.set_active_context(:tenant_b_account_id);

insert into results (name, passed)
select 'AC-11 control: the SAME login, after switching active context to B, DOES read tenant B''s thread — proves filtering by the ACTIVE context, not by "is this user a member of the row''s account"',
       count(*) = 1 from public.threads where id = :tenant_b_thread;

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
