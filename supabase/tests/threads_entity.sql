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

-- Story 8.2 ALTERs connections to add `proposed_by_account_id bigint not
-- null` — this fixture predates that story, so its inserts here are updated
-- in place (that story's own text: "if any of its fixture inserts omit the
-- new proposed_by_account_id, updating those inserts is in-scope for this
-- story — fix them in place, do not fork the suite"). The household side is
-- an arbitrary-but-valid choice: this suite never exercises who proposed
-- the connection, only that one exists.
insert into public.connections (household_account_id, shadchanus_account_id, status, proposed_by_account_id)
values (:sibling_fixture_account_id, :shadchanus_account_id, 'accepted', :sibling_fixture_account_id)
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

-- ---------------------------------------------------------------------------
-- Story 7.2 (AC-1 through AC-6): accounts.default_thread_visibility — the
-- household's own default posture for create_thread()'s resolution when
-- p_visibility is omitted. A dedicated account + two members (a
-- parent_admin and a single), independent of the sibling-household fixture
-- above, so flipping THIS account's default and mutating its grant-covered
-- column cannot interact with any assertion already run against
-- sibling_fixture_account_id.
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id, instance_id, aud, role, email) values
  ('51810000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'story72-parent@test.local'),
  ('51810000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'story72-single@test.local');

insert into public.accounts (name, kind) values ('Story 7.2 Household', 'household')
returning id as story72_account_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:story72_account_id, '51810000-0000-0000-0000-000000000020', 'parent_admin', 'active')
returning id as story72_parent_member_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:story72_account_id, '51810000-0000-0000-0000-000000000021', 'single', 'active')
returning id as story72_single_member_id \gset

insert into public.singles (account_id, first_name_en, gender, member_id)
values (:story72_account_id, 'Story72 Single', 'female', :story72_single_member_id)
returning id as story72_single_id \gset

insert into public.shidduchim (account_id, single_id, name_en, pipeline_state)
values (:story72_account_id, :story72_single_id, 'Story 7.2 Suggestion', 'look_into')
returning id as story72_shidduch_id \gset

insert into ids values
  ('story72_account_id', :story72_account_id),
  ('story72_parent_member_id', :story72_parent_member_id),
  ('story72_single_member_id', :story72_single_member_id),
  ('story72_shidduch_id', :story72_shidduch_id);

-- AC-1/AC-2: a fresh account defaults to 'open' — the column default itself,
-- not something create_thread() backfills.
insert into results (name, passed)
select 'Story 7.2 AC-1/AC-2: a freshly created account defaults to default_thread_visibility = ''open''',
       default_thread_visibility = 'open'
from public.accounts where id = :story72_account_id;

-- Review finding F3: AC-2 names its OWN falsifiable check — "immediately
-- after `migration up` against the production-shaped fixture, `select
-- count(*) from public.accounts where default_thread_visibility is
-- distinct from 'open'` is 0" — which the row above does NOT exercise (a
-- freshly-inserted row only proves the column DEFAULT, never the backfill
-- of a row that predates the column). `make check-migration-safety`'s
-- shared fixture/assert.sql pair cannot stand in for it either:
-- assert.sql only compares SURVIVING columns against their pre-migration
-- snapshot, so it is structurally blind to a column the migration ADDS —
-- there is nothing in the snapshot to diff a new column against. This
-- block rehearses the migration's own two statements, verbatim, on a
-- scratch table seeded with rows that predate the column — not on the
-- live `public.accounts` (dropping and re-adding ITS column mid-suite
-- would also drop the column-level grant the migration hand-adds, which
-- every AC-6(d) assertion below depends on).
create temp table story72_pre_migration_accounts (id bigint primary key)
  on commit drop;

insert into story72_pre_migration_accounts (id) values (9001), (9002), (9003);

alter table story72_pre_migration_accounts
  add column "default_thread_visibility" text not null default 'open'::text;

alter table story72_pre_migration_accounts
  add constraint "story72_pre_migration_accounts_visibility_check"
  check ((default_thread_visibility = any (array['open'::text, 'private'::text])));

insert into results (name, passed)
select 'Story 7.2 AC-2: ADD COLUMN … NOT NULL DEFAULT ''open'' backfills every pre-existing row (migration''s own statements rehearsed verbatim against 3 rows seeded BEFORE the column exists)',
       count(*) filter (where default_thread_visibility is distinct from 'open') = 0
from story72_pre_migration_accounts;

set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000020","role":"authenticated"}';

select (public.create_thread('shidduch', :story72_shidduch_id, array[]::bigint[], null)).id as story72_thread_default_open \gset
insert into ids values ('story72_thread_default_open', :story72_thread_default_open);

insert into results (name, passed)
select 'Story 7.2 AC-3 (a): create_thread() with p_visibility omitted resolves to the account''s ''open'' default',
       visibility = 'open'
from public.threads where id = :story72_thread_default_open;

-- Flip the account's default to 'private' — a SETTING, not a migration: must
-- not rewrite the thread just created above under the OLD default.
reset role;
update public.accounts set default_thread_visibility = 'private' where id = :story72_account_id;

insert into results (name, passed)
select 'Story 7.2: flipping the account''s default does NOT retroactively rewrite a thread created under the OLD default',
       visibility = 'open'
from public.threads where id = :story72_thread_default_open;

set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000020","role":"authenticated"}';

select (public.create_thread('shidduch', :story72_shidduch_id, array[]::bigint[], null)).id as story72_thread_default_private \gset
insert into ids values ('story72_thread_default_private', :story72_thread_default_private);

insert into results (name, passed)
select 'Story 7.2 AC-3 (b): after flipping the account to ''private'', create_thread() with p_visibility omitted now resolves to ''private''',
       visibility = 'private'
from public.threads where id = :story72_thread_default_private;

-- AC-4: an explicit p_visibility always wins — asserted on BOTH settings.
select (public.create_thread('shidduch', :story72_shidduch_id, array[]::bigint[], 'open')).id as story72_thread_explicit_open \gset
insert into ids values ('story72_thread_explicit_open', :story72_thread_explicit_open);

insert into results (name, passed)
select 'Story 7.2 AC-4 (c, setting 1): an explicit p_visibility=>''open'' wins over a ''private'' account default',
       visibility = 'open'
from public.threads where id = :story72_thread_explicit_open;

reset role;
update public.accounts set default_thread_visibility = 'open' where id = :story72_account_id;
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000020","role":"authenticated"}';

select (public.create_thread('shidduch', :story72_shidduch_id, array[]::bigint[], 'private')).id as story72_thread_explicit_private \gset
insert into ids values ('story72_thread_explicit_private', :story72_thread_explicit_private);

insert into results (name, passed)
select 'Story 7.2 AC-4 (c, setting 2): an explicit p_visibility=>''private'' wins over an ''open'' account default',
       visibility = 'private'
from public.threads where id = :story72_thread_explicit_private;

do $$
declare
  v_name constant text := 'Story 7.2: create_thread() still raises 23514 for an invalid EXPLICIT p_visibility rather than silently falling back to the account default';
  v_shidduch bigint;
begin
  select value into v_shidduch from ids where name = 'story72_shidduch_id';
  perform public.create_thread('shidduch', v_shidduch, array[]::bigint[], 'not-a-real-visibility');
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '23514', 'invalid thread visibility: %', sqlstate, sqlerrm);
end $$;

-- AC-6(d): the grant/RLS boundary on the SETTING itself (accounts.
-- default_thread_visibility), not on create_thread(). A single-role
-- member's UPDATE affects ZERO rows; the positive control (same statement,
-- same row, parent_admin) affects exactly ONE. Without the control this
-- assertion would be satisfied just as well by "nobody can write" — the
-- exact state a missing column-level grant produced before this story's
-- migration was hand-repaired (see the migration file's own header
-- comment) — which is why the control is not optional.
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000021","role":"authenticated"}';

with attempt as (
  update public.accounts set default_thread_visibility = 'private'
  where id = :story72_account_id
  returning 1
)
insert into results (name, passed)
select 'Story 7.2 AC-6(d): a single-role member''s UPDATE of default_thread_visibility affects ZERO rows',
       count(*) = 0
from attempt;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000020","role":"authenticated"}';

with attempt as (
  update public.accounts set default_thread_visibility = 'private'
  where id = :story72_account_id
  returning 1
)
insert into results (name, passed)
select 'Story 7.2 AC-6(d) control: a parent_admin''s UPDATE of the SAME column, on the SAME row, affects exactly ONE row',
       count(*) = 1
from attempt;

-- ---------------------------------------------------------------------------
-- Story 7.3: per-discussion privacy. thread_is_readable()'s new `private`
-- branch (AC-2, AC-3, AC-6, AC-7) and set_thread_visibility() (AC-1, AC-4,
-- AC-5, AC-8). A SECOND parent_admin (B) joins the sibling household —
-- AC-5's fixture needs "A = parent_admin, B = parent_admin, C = helper";
-- the helper seeded above (AC-8's `helper_member_id`) plays C, so this adds
-- only B.
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id, instance_id, aud, role, email)
values ('51810000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'threads-second-parent@test.local');

insert into public.account_members (account_id, user_id, role, status)
values (:sibling_fixture_account_id, '51810000-0000-0000-0000-000000000013', 'parent_admin', 'active')
returning id as second_parent_member_id \gset
insert into ids values ('second_parent_member_id', :second_parent_member_id);

-- AC-6's own fixture data: resumes/interactions/entity_files for Rivka's
-- shidduch, so "the single reads zero rows for that subject" denies a REAL
-- row, not an already-empty table.
insert into public.resumes (account_id, shidduchim_id)
values (:sibling_fixture_account_id, :rivka_shidduch_id)
returning id as rivka_resume_id \gset
insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
values (:sibling_fixture_account_id, 'shidduch', :rivka_shidduch_id, 'shidduch', 'note', 'Rivka candid note (Story 7.3 AC-6 fixture)')
returning id as rivka_interaction_id \gset
insert into public.entity_files (account_id, target_type, target_id, storage_path, file_name, mime_type, size_bytes)
values (
  :sibling_fixture_account_id, 'shidduch', :rivka_shidduch_id,
  :'sibling_fixture_account_id' || '/shidduch/' || :'rivka_shidduch_id' || '/ac6.pdf',
  'ac6.pdf', 'application/pdf', 512
)
returning id as rivka_entity_file_id \gset
insert into ids values
  ('rivka_resume_id', :rivka_resume_id),
  ('rivka_interaction_id', :rivka_interaction_id),
  ('rivka_entity_file_id', :rivka_entity_file_id);

-- ---------------------------------------------------------------------------
-- AC-5 (the mandatory negative test): A creates a PRIVATE thread naming ONLY
-- B as a co-participant. C (the same-account helper) must read ZERO rows
-- from threads/messages/thread_participants for it, and cannot break in.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

select (public.create_thread('relationship', null, array[:second_parent_member_id]::bigint[], 'private')).id as private_ab_thread \gset
insert into ids values ('private_ab_thread', :private_ab_thread);

insert into public.messages (thread_id, body) values (:private_ab_thread, 'Private note between A and B')
returning id as private_ab_message \gset
insert into ids values ('private_ab_message', :private_ab_message);

insert into results (name, passed)
select 'AC-5 control: A (the creator/participant) reads exactly the one private thread and its message',
       (select count(*) from public.threads where id = :private_ab_thread) = 1
       and (select count(*) from public.messages where id = :private_ab_message) = 1;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000013","role":"authenticated"}';

insert into results (name, passed)
select 'AC-5 control: B (added as a participant, never the creator) reads exactly the one private thread and its message',
       (select count(*) from public.threads where id = :private_ab_thread) = 1
       and (select count(*) from public.messages where id = :private_ab_message) = 1;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000012","role":"authenticated"}';

insert into results (name, passed)
select 'AC-3/AC-5: C (same-account helper, NOT a participant) reads ZERO rows from threads for the private A/B thread — row-filtered, not a 403',
       count(*) = 0 from public.threads where id = :private_ab_thread;

insert into results (name, passed)
select 'AC-3/AC-5: C reads ZERO rows from messages for the private A/B thread',
       count(*) = 0 from public.messages where id = :private_ab_message;

insert into results (name, passed)
select 'AC-3/AC-5: C reads ZERO rows from thread_participants for the private A/B thread — not even that it exists',
       count(*) = 0 from public.thread_participants where thread_id = :private_ab_thread;

do $$
declare
  v_name constant text := 'AC-5: C cannot break in — C''s own INSERT of a thread_participants row on the private A/B thread is rejected (7.1''s participant-gated INSERT policy, re-proven here)';
  v_thread bigint; v_helper bigint;
begin
  select value into v_thread from ids where name = 'private_ab_thread';
  select value into v_helper from ids where name = 'helper_member_id';
  insert into public.thread_participants (thread_id, member_id) values (v_thread, v_helper);
  insert into results values (v_name, false, 'insert unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'new row violates row-level security policy for table "thread_participants"', sqlstate, sqlerrm);
end $$;

do $$
declare
  v_name constant text := 'AC-5: C''s set_thread_visibility() call on the private A/B thread RAISES, matched by SQLSTATE 42501 (insufficient_privilege) not message text';
  v_thread bigint;
begin
  select value into v_thread from ids where name = 'private_ab_thread';
  perform public.set_thread_visibility(v_thread, 'open');
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', '%', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AC-4: privacy is a round trip, not a one-way latch. The SAME
-- non-participant session (C, the helper) reads 1 -> 0 -> 1 across two
-- set_thread_visibility() calls — an implementation that hard-denies
-- everything on a private thread would only ever show 0 here.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

select (public.create_thread('relationship', null, array[]::bigint[], 'open')).id as round_trip_thread \gset
insert into ids values ('round_trip_thread', :round_trip_thread);

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000012","role":"authenticated"}';

insert into results (name, passed)
select 'AC-4 (1 of 3): the non-participant session reads the OPEN thread — 1 row',
       count(*) = 1 from public.threads where id = :round_trip_thread;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.set_thread_visibility(:round_trip_thread, 'private');

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000012","role":"authenticated"}';

insert into results (name, passed)
select 'AC-4 (2 of 3): the SAME non-participant session, SAME thread, now flipped to private — 0 rows, immediately, same session, no cache step',
       count(*) = 0 from public.threads where id = :round_trip_thread;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.set_thread_visibility(:round_trip_thread, 'open');

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000012","role":"authenticated"}';

insert into results (name, passed)
select 'AC-4 (3 of 3): flipped back to open — 1 row again, proving this is a round trip, not a one-way latch',
       count(*) = 1 from public.threads where id = :round_trip_thread;

-- ---------------------------------------------------------------------------
-- AC-6: the single's carve-out is scoped to the thread, not a back door.
-- Leah (single) is deliberately added to a PRIVATE thread on Rivka's
-- shidduch — a subject AC-9 already proved she cannot otherwise see. She
-- DOES read the private thread and its message (private beats the
-- dignity-floor branch on purpose — Dev Notes, "Why private does not
-- re-apply the single gate"); she still reads ZERO rows of
-- shidduchim/resumes/interactions/entity_files for that SAME subject — the
-- falsifiable clause that keeps this from being a general bypass.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

select (public.create_thread('shidduch', :rivka_shidduch_id, array[:sibling_fixture_leah_member_id]::bigint[], 'private')).id as thread_rivka_private \gset
insert into ids values ('thread_rivka_private', :thread_rivka_private);

insert into public.messages (thread_id, body) values (:thread_rivka_private, 'A private message about the sibling''s (Rivka''s) shidduch')
returning id as rivka_private_message_id \gset
insert into ids values ('rivka_private_message_id', :rivka_private_message_id);

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'AC-6: a single deliberately added to a PRIVATE thread on a subject she could not otherwise see DOES read the thread — the participant list is the consent, not re-derived from the dignity floor',
       count(*) = 1 from public.threads where id = :thread_rivka_private;

insert into results (name, passed)
select 'AC-6: the single also reads the message on that private thread',
       count(*) = 1 from public.messages where id = :rivka_private_message_id;

insert into results (name, passed)
select 'AC-6 (falsifiable): the SAME single still reads ZERO rows from public.shidduchim for that subject — the carve-out is the thread, nothing else',
       count(*) = 0 from public.shidduchim where id = :rivka_shidduch_id;

insert into results (name, passed)
select 'AC-6 (falsifiable): ZERO rows from public.resumes for that subject',
       count(*) = 0 from public.resumes where shidduchim_id = :rivka_shidduch_id;

insert into results (name, passed)
select 'AC-6 (falsifiable): ZERO rows from public.interactions for that subject',
       count(*) = 0
from public.interactions
where target_type = 'shidduch' and target_id = :rivka_shidduch_id;

insert into results (name, passed)
select 'AC-6 (falsifiable): ZERO rows from public.entity_files for that subject',
       count(*) = 0
from public.entity_files
where target_type = 'shidduch' and target_id = :rivka_shidduch_id;

-- ---------------------------------------------------------------------------
-- Story 7.3 shipped this as "the connection axis stays closed until 7.4" —
-- thread_is_readable()'s unconditional connection-axis denial (7.1) meant
-- set_thread_visibility() refused this thread even for A, a REAL
-- thread_participants row on it. Story 7.4 replaces that denial with a real
-- scope gate (Task 2), and this thread's connection (test_connection_id) IS
-- accepted with A on its household side — so this is now a POSITIVE
-- assertion, not a refusal. This is the pure-widening case AC-4 names: the
-- thread and its participant row are UNCHANGED from Story 7.3's own seed,
-- only the axis around them opened. See Story 7.4's own threads_entity.sql
-- section further down for the matching NEGATIVE (the same call, on a
-- connection whose status is 'ended', still refuses).
-- ---------------------------------------------------------------------------
reset role;

insert into public.threads (connection_id, subject_type, subject_id, visibility)
values (:test_connection_id, 'relationship', null, 'private')
returning id as connection_visibility_thread \gset
insert into public.thread_participants (connection_id, thread_id, member_id)
values (:test_connection_id, :connection_visibility_thread, :sibling_fixture_parent_member_id)
returning id as connection_visibility_participant \gset
insert into ids values
  ('connection_visibility_thread', :connection_visibility_thread),
  ('connection_visibility_participant', :connection_visibility_participant);

set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

select (public.set_thread_visibility(:connection_visibility_thread, 'open')).visibility as connection_visibility_after_flip \gset

insert into results (name, passed)
select 'Story 7.4 (AC-4, pure widening): set_thread_visibility() now SUCCEEDS on a connection-scoped thread for a caller holding a REAL thread_participants row on an ACCEPTED connection — the exact call Story 7.3 proved denied before this story opened the axis',
       :'connection_visibility_after_flip' = 'open';

-- ---------------------------------------------------------------------------
-- AC-1: "by agreement" means any current participant, not only the
-- creator — proven with a NON-creator (Leah, added by A). The symmetric
-- negative on the SAME open thread's non-participant case reuses `thread1`
-- and the helper already established as "can read, is not a participant"
-- (AC-8 control, above).
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

select (public.create_thread('relationship', null, array[:sibling_fixture_leah_member_id]::bigint[], 'open')).id as ac1_thread \gset
insert into ids values ('ac1_thread', :ac1_thread);

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

select (public.set_thread_visibility(:ac1_thread, 'private')).visibility as ac1_visibility_after_leah \gset

insert into results (name, passed)
select 'AC-1: a non-creator participant (Leah, added by A, never the creator) can flip an open thread to private — "by agreement" is not creator-only',
       :'ac1_visibility_after_leah' = 'private';

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000012","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-1/AC-8: a same-account member who is NOT a participant of an OPEN thread cannot flip its visibility, even though she can read it';
  v_thread bigint;
begin
  select value into v_thread from ids where name = 'thread1';
  perform public.set_thread_visibility(v_thread, 'private');
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'only a listed participant of this thread may change its visibility', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Review fix F1 (Story 7.3): the 22023 refusal (Task 2's OTHER documented
-- SQLSTATE, alongside the 42501 pair already proven above) had no dedicated
-- guard — deleting that whole branch from the live function left this suite
-- green. Matched by SQLSTATE, not message, same convention as every other
-- `denied()` call in this file. Run under C (the same-account
-- non-participant already active in this session, from the AC-1/AC-8 block
-- above) ON PURPOSE: p_visibility validation is Task 2's FIRST check, before
-- readability or participation, so even a non-participant must hit 22023
-- here rather than 42501 — proving the checked order, not merely that SOME
-- error comes back.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'F1 (7.3): set_thread_visibility() with an invalid p_visibility RAISES 22023 (invalid_parameter_value), matched by SQLSTATE — checked FIRST, before readability/participation, so even a non-participant hits this refusal rather than 42501';
  v_thread bigint;
begin
  select value into v_thread from ids where name = 'thread1';
  perform public.set_thread_visibility(v_thread, 'not-a-real-visibility');
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '22023', 'invalid thread visibility: %', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Review fix F2 (Story 7.3): "no table-level UPDATE grant on `threads` for
-- `authenticated`" (06_grants.sql, and set_thread_visibility()'s own header
-- comment in 02_functions.sql) is load-bearing — it is what keeps
-- set_thread_visibility() the SOLE write path for `visibility` — but was
-- previously asserted only in prose, never in a test. Story 7.1 set the
-- precedent for exactly this shape (the "F2/F4" INSERT-grant checks above,
-- `threads_entity.sql:283-317`); this closes the same gap for UPDATE. Run by
-- A, an ACTUAL participant of a REAL thread (thread1) — proving the denial
-- is the missing GRANT, not merely RLS or "this thread isn't yours": a
-- future `grant update on table public.threads to authenticated` would
-- sail through every other gate in this repo without this check.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_name constant text := 'F2 (7.3): a direct UPDATE of threads.visibility, even by a real participant of a real thread, is denied at the grant layer (42501, "permission denied for table threads") — authenticated holds no table-level UPDATE grant on threads at all';
  v_thread bigint;
begin
  select value into v_thread from ids where name = 'thread1';
  update public.threads set visibility = 'private' where id = v_thread;
  insert into results values (v_name, false, 'update unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'permission denied for table threads', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- Story 7.4: any pairing may hold a private thread — the connection axis,
-- opened. New fixture, on top of the sibling household / shadchanus_
-- account_id / test_connection_id (accepted) already established above:
--
--   * shadchan_member_id — a REAL shadchan-role member on the
--     ALREADY-connected shadchanus_account_id. 7.1/7.3 only ever seeded
--     connection-scoped rows directly, as a service-role stand-in, because
--     the axis was unreachable to a real session before this story; this is
--     the first real "shadchan" caller in this file.
--   * other_shadchanus_account_id / other_shadchan_member_id — a SECOND,
--     wholly UNCONNECTED shadchanus. AC-9's "holds the shadchan role
--     generally" negative needs a real shadchan provably NOT a party to
--     test_connection_id — a household negative alone cannot prove that.
--   * ended_connection_shadchanus_account_id / ended_connection_id — a
--     THIRD shadchanus, paired to the sibling household through a
--     connection seeded directly with status = 'ended'. AC-9's "ending a
--     connection ends the reads" negative.
--   * leah_new_state_shidduch_id — shared visibility, Leah's own single_id,
--     but pipeline_state = 'new' (NOT single-visible). The three existing
--     AC-9 shidduchim (leah/rivka/leah_private) each fail exactly one OTHER
--     clause of Epic 6's three-part test; none fails the pipeline-state
--     clause alone, which AC-5 requires as its OWN separate negative.
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id, instance_id, aud, role, email)
values ('51810000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'threads-shadchan@test.local');

insert into public.account_members (account_id, user_id, role, status)
values (:shadchanus_account_id, '51810000-0000-0000-0000-000000000014', 'shadchan', 'active')
returning id as shadchan_member_id \gset

insert into public.accounts (name, kind) values ('Threads Unconnected Shadchanus', 'shadchanus')
returning id as other_shadchanus_account_id \gset

insert into auth.users (id, instance_id, aud, role, email)
values ('51810000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'threads-other-shadchan@test.local');

insert into public.account_members (account_id, user_id, role, status)
values (:other_shadchanus_account_id, '51810000-0000-0000-0000-000000000015', 'shadchan', 'active')
returning id as other_shadchan_member_id \gset

insert into public.accounts (name, kind) values ('Threads Ended Connection Shadchanus', 'shadchanus')
returning id as ended_connection_shadchanus_account_id \gset

-- Story 8.2: same proposed_by_account_id backfill note as this file's other
-- connections insert above.
insert into public.connections (household_account_id, shadchanus_account_id, status, ended_at, proposed_by_account_id)
values (:sibling_fixture_account_id, :ended_connection_shadchanus_account_id, 'ended', now(), :sibling_fixture_account_id)
returning id as ended_connection_id \gset

insert into public.shidduchim (account_id, single_id, name_en, pipeline_state, visibility)
values (:sibling_fixture_account_id, :sibling_fixture_leah_single_id, 'Leah New-State Suggestion', 'new', 'shared')
returning id as leah_new_state_shidduch_id \gset

insert into ids values
  ('shadchanus_account_id', :shadchanus_account_id),
  ('shadchan_member_id', :shadchan_member_id),
  ('other_shadchanus_account_id', :other_shadchanus_account_id),
  ('other_shadchan_member_id', :other_shadchan_member_id),
  ('ended_connection_shadchanus_account_id', :ended_connection_shadchanus_account_id),
  ('ended_connection_id', :ended_connection_id),
  ('leah_new_state_shidduch_id', :leah_new_state_shidduch_id);

-- ---------------------------------------------------------------------------
-- AC-1: the two falsifiable refusals, by SQLSTATE.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000015","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-1: a caller whose active context is neither side of the connection raises 42501';
  v_connection bigint;
begin
  select value into v_connection from ids where name = 'test_connection_id';
  perform public.create_thread('relationship', null, array[]::bigint[], null, v_connection);
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'connection % is not active for the current context', sqlstate, sqlerrm);
end $$;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_name constant text := 'AC-1: a caller who IS the right household, but whose connection has status=''ended'', raises 42501';
  v_connection bigint;
begin
  select value into v_connection from ids where name = 'ended_connection_id';
  perform public.create_thread('relationship', null, array[]::bigint[], null, v_connection);
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'connection % is not active for the current context', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AC-3: cross-side participants are legal, and ONLY cross-side — a member of
-- an UNRELATED third account raises, even on a connection-scoped thread the
-- caller is otherwise entitled to create.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name constant text := 'AC-3: adding a member of an UNRELATED third account as a participant on a connection-scoped thread raises — cross-side is legal, third-party is not';
  v_connection bigint; v_unrelated_member bigint;
begin
  select value into v_connection from ids where name = 'test_connection_id';
  select value into v_unrelated_member from ids where name = 'tenant_b_member_id';
  perform public.create_thread('relationship', null, array[v_unrelated_member]::bigint[], null, v_connection);
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, 'P0001', 'member % not found in either side of this connection', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AC-8: the four-pairing proof, in one place. The household parent (already
-- active, above) opens two PRIVATE connection-scoped threads over
-- test_connection_id: one naming Leah (the household's single) and the
-- shadchan as participants (single<->shadchan), one naming only the shadchan
-- (parent<->shadchan). The account-scoped half (parent<->parent,
-- parent<->single) is reused from Story 7.3's OWN fixtures below, not
-- re-derived.
-- ---------------------------------------------------------------------------
select (public.create_thread('relationship', null, array[:sibling_fixture_leah_member_id, :shadchan_member_id]::bigint[], 'private', :test_connection_id)).id as ac8_single_shadchan_thread \gset
insert into ids values ('ac8_single_shadchan_thread', :ac8_single_shadchan_thread);

insert into public.messages (thread_id, body) values (:ac8_single_shadchan_thread, 'Connection thread: single<->shadchan, opened by the parent')
returning id as ac8_single_shadchan_message \gset
insert into ids values ('ac8_single_shadchan_message', :ac8_single_shadchan_message);

select (public.create_thread('relationship', null, array[:shadchan_member_id]::bigint[], 'private', :test_connection_id)).id as ac8_parent_shadchan_thread \gset
insert into ids values ('ac8_parent_shadchan_thread', :ac8_parent_shadchan_thread);

insert into results (name, passed)
select 'AC-8 control: the creator (household parent) reads both new connection-scoped private threads',
       (select count(*) from public.threads where id in (:ac8_single_shadchan_thread, :ac8_parent_shadchan_thread)) = 2;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'AC-8 (single<->shadchan pairing): Leah (the household''s single, added as participant) reads the connection-scoped private thread',
       count(*) = 1 from public.threads where id = :ac8_single_shadchan_thread;

insert into results (name, passed)
select 'AC-8 (single<->shadchan pairing): Leah also reads its message',
       count(*) = 1 from public.messages where id = :ac8_single_shadchan_message;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000014","role":"authenticated"}';

insert into results (name, passed)
select 'AC-8 (single<->shadchan pairing): the CONNECTED shadchan (active in the shadchanus account) reads the SAME connection-scoped private thread from the other side',
       count(*) = 1 from public.threads where id = :ac8_single_shadchan_thread;

insert into results (name, passed)
select 'AC-8 (single<->shadchan pairing): the shadchan also reads its message',
       count(*) = 1 from public.messages where id = :ac8_single_shadchan_message;

insert into results (name, passed)
select 'AC-8 (parent<->shadchan pairing): the shadchan reads the second connection-scoped private thread (with the household''s parent, not its single)',
       count(*) = 1 from public.threads where id = :ac8_parent_shadchan_thread;

-- AC-6: the shadchan side posts a message through a REAL client INSERT (this
-- authenticated session, not service_role) — the exact falsifying test a
-- half-migrated messages INSERT policy would still pass a service-role smoke
-- test on, then break on the first real user action.
insert into public.messages (thread_id, body) values (:ac8_single_shadchan_thread, 'A real client INSERT from the shadchan side (AC-6)')
returning id as ac6_shadchan_client_message \gset
insert into ids values ('ac6_shadchan_client_message', :ac6_shadchan_client_message);

insert into results (name, passed)
select 'AC-6: the shadchan''s real client-side INSERT into messages succeeds, and is server-stamped to their OWN membership + the thread''s connection scope',
       sender_member_id = :shadchan_member_id
       and account_id is null
       and connection_id = :test_connection_id
from public.messages where id = :ac6_shadchan_client_message;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'AC-8 (parent<->shadchan pairing): the household parent (creator) reads the second connection-scoped private thread',
       count(*) = 1 from public.threads where id = :ac8_parent_shadchan_thread;

-- ---------------------------------------------------------------------------
-- F2 (review fix, Story 7.4): AC-6 widens the thread_participants INSERT
-- policy to the same two-disjunct scope check as messages (05_policies.sql),
-- but every prior assertion exercised it only through create_thread(), which
-- is SECURITY DEFINER and bypasses RLS entirely — reverting the policy back
-- to 7.1's single-axis form left the suite 98/98 green. This is a REAL
-- client-side direct INSERT into thread_participants on the connection axis
-- (still authenticated, still this session, not service_role), mirroring
-- AC-6's own messages proof above so the same half-migrated-policy failure
-- mode is covered on this table too. The household parent (already a
-- participant of ac8_parent_shadchan_thread) adds Leah, a member of his OWN
-- household — satisfying the unchanged 7.1 "F3" clause that the added member
-- belongs to the caller's own account (Deviation #2: this policy does not
-- admit a CROSS-side add, only same-account, so Leah rather than the
-- shadchan is the correct fixture here).
-- ---------------------------------------------------------------------------
insert into public.thread_participants (thread_id, member_id)
values (:ac8_parent_shadchan_thread, :sibling_fixture_leah_member_id)
returning id as f2_participant_direct_insert \gset
insert into ids values ('f2_participant_direct_insert', :f2_participant_direct_insert);

insert into results (name, passed)
select 'AC-6 (F2 review fix): a REAL client-side direct INSERT into thread_participants on the connection axis succeeds and is server-stamped to the thread''s connection scope, not create_thread() (SECURITY DEFINER, which would still succeed even with this INSERT policy reverted to 7.1''s account-only form)',
       account_id is null and connection_id = :test_connection_id
from public.thread_participants where id = :f2_participant_direct_insert;

-- AC-8: the account-scoped half, reusing Story 7.3's OWN fixtures — proven
-- there already (AC-5's control, AC-6's carve-out); re-asserted here, under
-- an AC-8 name, so the epic's four-pairing AC is discharged in one file
-- without re-deriving the account axis a second time.
insert into results (name, passed)
select 'AC-8 (parent<->parent pairing, account-scoped): reusing Story 7.3''s AC-5 private_ab_thread — A (the creator) still reads it',
       count(*) = 1 from public.threads where id = :private_ab_thread;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000013","role":"authenticated"}';

insert into results (name, passed)
select 'AC-8 (parent<->parent pairing, account-scoped): B (never the creator) also reads the SAME private_ab_thread',
       count(*) = 1 from public.threads where id = :private_ab_thread;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'AC-8 (parent<->single pairing, account-scoped): reusing Story 7.3''s AC-6 thread_rivka_private — the single participant reads it',
       count(*) = 1 from public.threads where id = :thread_rivka_private;

-- ---------------------------------------------------------------------------
-- AC-2: a shadchan creates a connection-scoped thread on the CONNECTED
-- household's real shidduch (succeeds); the same shadchan naming a shidduch
-- belonging to an UNRELATED household raises.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000014","role":"authenticated"}';

select (public.create_thread('shidduch', :leah_shidduch_id, array[]::bigint[], null, :test_connection_id)).id as ac2_shadchan_thread \gset
insert into ids values ('ac2_shadchan_thread', :ac2_shadchan_thread);

insert into results (name, passed)
select 'AC-2: a shadchan creates a connection-scoped thread naming the CONNECTED household''s real shidduch — subject resolves against household_account_id, never current_context_id() (the shadchan''s OWN shadchanus account, which holds no shidduchim at all)',
       t.connection_id = :test_connection_id and t.account_id is null and t.subject_id = :leah_shidduch_id
from public.threads t where t.id = :ac2_shadchan_thread;

do $$
declare
  v_name constant text := 'AC-2: the SAME shadchan naming a shidduch belonging to a DIFFERENT (unconnected) household raises — subject resolution is scoped to the CONNECTION''s own household';
  v_connection bigint; v_other_shidduch bigint;
begin
  select value into v_connection from ids where name = 'test_connection_id';
  select value into v_other_shidduch from ids where name = 'tenant_b_shidduch_id';
  perform public.create_thread('shidduch', v_other_shidduch, array[]::bigint[], null, v_connection);
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, 'P0001', 'shidduch % not found in current account', sqlstate, sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- AC-5: the dignity floor does not stop applying because a shadchan is in
-- the room. Four connection-scoped OPEN threads, each about a shidduch that
-- satisfies all three of Epic 6's clauses except (at most) one; Leah is a
-- participant of all four, exactly like AC-9's account-axis block.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

select (public.create_thread('shidduch', :leah_shidduch_id, array[:sibling_fixture_leah_member_id]::bigint[], 'open', :test_connection_id)).id as ac5_conn_thread_leah_open \gset
select (public.create_thread('shidduch', :rivka_shidduch_id, array[:sibling_fixture_leah_member_id]::bigint[], 'open', :test_connection_id)).id as ac5_conn_thread_rivka_open \gset
select (public.create_thread('shidduch', :leah_private_shidduch_id, array[:sibling_fixture_leah_member_id]::bigint[], 'open', :test_connection_id)).id as ac5_conn_thread_leah_private_parent \gset
select (public.create_thread('shidduch', :leah_new_state_shidduch_id, array[:sibling_fixture_leah_member_id]::bigint[], 'open', :test_connection_id)).id as ac5_conn_thread_leah_new_state \gset
insert into ids values
  ('ac5_conn_thread_leah_open', :ac5_conn_thread_leah_open),
  ('ac5_conn_thread_rivka_open', :ac5_conn_thread_rivka_open),
  ('ac5_conn_thread_leah_private_parent', :ac5_conn_thread_leah_private_parent),
  ('ac5_conn_thread_leah_new_state', :ac5_conn_thread_leah_new_state);

insert into results (name, passed)
select 'AC-5 control: the parent (creator) reads all four connection-scoped OPEN shidduch threads before Leah''s restricted view is tested',
       (select count(*) from public.threads where id in (
         :ac5_conn_thread_leah_open, :ac5_conn_thread_rivka_open,
         :ac5_conn_thread_leah_private_parent, :ac5_conn_thread_leah_new_state
       )) = 4;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'AC-5 (positive): Leah reads the OPEN connection-scoped thread about her OWN shidduch — visibility=shared, single-visible state, her own single_id, all three clauses satisfied across the connection axis exactly as AC-9 proved for the account axis',
       count(*) = 1 from public.threads where id = :ac5_conn_thread_leah_open;

insert into results (name, passed)
select 'AC-5 (fails clause: single_id): Leah reads ZERO rows for the connection-scoped thread about the SIBLING''s shidduch, despite the SAME shared visibility and single-visible state',
       count(*) = 0 from public.threads where id = :ac5_conn_thread_rivka_open;

insert into results (name, passed)
select 'AC-5 (fails clause: visibility): Leah reads ZERO rows for the connection-scoped thread about her OWN shidduch when its visibility is private_parent, despite the SAME single-visible state and the SAME single_id',
       count(*) = 0 from public.threads where id = :ac5_conn_thread_leah_private_parent;

insert into results (name, passed)
select 'AC-5 (fails clause: pipeline state): Leah reads ZERO rows for the connection-scoped thread about her OWN shidduch when its pipeline_state (''new'') is not single-visible, despite shared visibility and her own single_id',
       count(*) = 0 from public.threads where id = :ac5_conn_thread_leah_new_state;

-- ---------------------------------------------------------------------------
-- AC-7: connection-scoped threads resolve their default posture from the
-- connection's HOUSEHOLD side — never the shadchanus side, either way.
-- ---------------------------------------------------------------------------
reset role;
update public.accounts set default_thread_visibility = 'private' where id = :sibling_fixture_account_id;

set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

select (public.create_thread('relationship', null, array[]::bigint[], null, :test_connection_id)).id as ac7_thread_household_private \gset
insert into ids values ('ac7_thread_household_private', :ac7_thread_household_private);

insert into results (name, passed)
select 'AC-7: household default ''private'' + a connection-scoped create_thread() with no p_visibility resolves from the connection''s HOUSEHOLD side',
       visibility = 'private' from public.threads where id = :ac7_thread_household_private;

reset role;
update public.accounts set default_thread_visibility = 'open' where id = :shadchanus_account_id;

set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

select (public.create_thread('relationship', null, array[]::bigint[], null, :test_connection_id)).id as ac7_thread_shadchanus_flip_has_no_effect \gset
insert into ids values ('ac7_thread_shadchanus_flip_has_no_effect', :ac7_thread_shadchanus_flip_has_no_effect);

insert into results (name, passed)
select 'AC-7: flipping the SHADCHANUS account''s OWN default_thread_visibility to ''open'' has NO effect on a new connection-scoped thread on the same connection — it still resolves ''private'' from the household side',
       visibility = 'private' from public.threads where id = :ac7_thread_shadchanus_flip_has_no_effect;

reset role;
update public.accounts set default_thread_visibility = 'open' where id = :sibling_fixture_account_id;
update public.accounts set default_thread_visibility = 'open' where id = :shadchanus_account_id;

-- ---------------------------------------------------------------------------
-- F1 (review fix, Story 7.4): the negatives below originally targeted ONLY
-- ac8_single_shadchan_thread, which is PRIVATE — thread_visibility_permits()'s
-- participant-list check denies a non-participant caller regardless of
-- whether connection_is_active_for_caller()'s own party-identity disjunct
-- (`household_account_id = current_context_id() or shadchanus_account_id =
-- current_context_id()`) ever runs correctly. Proved by mutation: dropping
-- ONLY that disjunct (keeping `status = 'accepted'`) left every negative
-- below green — the single red check was AC-1's create_thread() refusal, a
-- WRITE path, leaving the READ-side identity check unproven. This OPEN,
-- relationship-type connection-scoped thread has no private participant gate
-- to hide behind: thread_visibility_permits() returns true unconditionally
-- once the scope gate passes (not a shidduch subject, so the single dignity
-- floor never engages either) — so a negative re-run against it below can
-- ONLY pass because connection_is_active_for_caller() denies on the caller's
-- own identity, not on privacy.
-- ---------------------------------------------------------------------------
insert into public.threads (connection_id, subject_type, subject_id, visibility)
values (:test_connection_id, 'relationship', null, 'open')
returning id as ac9_open_scope_gate_thread \gset
insert into public.thread_participants (connection_id, thread_id, member_id)
values (:test_connection_id, :ac9_open_scope_gate_thread, :sibling_fixture_parent_member_id)
returning id as ac9_open_scope_gate_participant \gset
insert into public.messages (connection_id, thread_id, body)
values (:test_connection_id, :ac9_open_scope_gate_thread, 'F1: open connection thread with no private gate, to isolate the scope gate''s own identity check')
returning id as ac9_open_scope_gate_message \gset
insert into ids values
  ('ac9_open_scope_gate_thread', :ac9_open_scope_gate_thread),
  ('ac9_open_scope_gate_participant', :ac9_open_scope_gate_participant),
  ('ac9_open_scope_gate_message', :ac9_open_scope_gate_message);

-- ---------------------------------------------------------------------------
-- AC-9: the three negatives. A shadchan whose OWN shadchanus is not party to
-- this connection; a household member of a DIFFERENT household; a member of
-- the RIGHT household once the connection has ended.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'AC-9 (F1) control: the household parent (a real participant) reads the OPEN scope-gate thread before the identity-check negatives below are tested',
       count(*) = 1 from public.threads where id = :ac9_open_scope_gate_thread;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000015","role":"authenticated"}';

insert into results (name, passed)
select 'AC-9: a shadchan whose OWN shadchanus is NOT party to this connection reads ZERO rows from its threads, even though they hold the shadchan role generally',
       count(*) = 0 from public.threads where id = :ac8_single_shadchan_thread;

insert into results (name, passed)
select 'AC-9: ...ZERO rows from its messages',
       count(*) = 0 from public.messages where id = :ac8_single_shadchan_message;

insert into results (name, passed)
select 'AC-9: ...ZERO rows from its thread_participants',
       count(*) = 0 from public.thread_participants where thread_id = :ac8_single_shadchan_thread;

insert into results (name, passed)
select 'AC-9 (F1 review fix): the SAME unconnected shadchan reads ZERO rows from an OPEN connection-scoped thread that has no private participant gate — this can only be connection_is_active_for_caller()''s own party-identity check, not thread_visibility_permits()''s private branch',
       count(*) = 0 from public.threads where id = :ac9_open_scope_gate_thread;

insert into results (name, passed)
select 'AC-9 (F1 review fix): ...ZERO rows from the OPEN thread''s messages',
       count(*) = 0 from public.messages where id = :ac9_open_scope_gate_message;

insert into results (name, passed)
select 'AC-9 (F1 review fix): ...ZERO rows from the OPEN thread''s thread_participants',
       count(*) = 0 from public.thread_participants where thread_id = :ac9_open_scope_gate_thread;

set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000010","role":"authenticated"}';

insert into results (name, passed)
select 'AC-9: a household member of a DIFFERENT household reads ZERO rows from that connection''s threads likewise',
       count(*) = 0 from public.threads where id = :ac8_single_shadchan_thread;

insert into results (name, passed)
select 'AC-9 (F1 review fix): the SAME different-household member reads ZERO rows from the SAME OPEN connection-scoped thread likewise — the identity check, not the private participant gate',
       count(*) = 0 from public.threads where id = :ac9_open_scope_gate_thread;

reset role;

insert into public.threads (connection_id, subject_type, subject_id, visibility)
values (:ended_connection_id, 'relationship', null, 'open')
returning id as ac9_ended_connection_thread \gset
insert into public.thread_participants (connection_id, thread_id, member_id)
values (:ended_connection_id, :ac9_ended_connection_thread, :sibling_fixture_parent_member_id)
returning id as ac9_ended_connection_participant \gset
insert into public.messages (connection_id, thread_id, body)
values (:ended_connection_id, :ac9_ended_connection_thread, 'a note from before the connection ended')
returning id as ac9_ended_connection_message \gset
insert into ids values
  ('ac9_ended_connection_thread', :ac9_ended_connection_thread),
  ('ac9_ended_connection_participant', :ac9_ended_connection_participant),
  ('ac9_ended_connection_message', :ac9_ended_connection_message);

set local role authenticated;
set local request.jwt.claims = '{"sub":"51810000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'AC-9: a member of the RIGHT household, with a REAL thread_participants row on it, reads ZERO rows once the connection''s status is ''ended'' — ending a connection ends the reads, no other assertion in this file covers it',
       count(*) = 0 from public.threads where id = :ac9_ended_connection_thread;

insert into results (name, passed)
select 'AC-9: ...ZERO rows from its messages too',
       count(*) = 0 from public.messages where id = :ac9_ended_connection_message;

-- The negative half of the "pure widening" assertion earlier in this file
-- (Story 7.3's former "connection axis stays closed" test, now positive for
-- an ACCEPTED connection): the identical call, on the SAME kind of real
-- participant row, still refuses once the connection is 'ended' —
-- set_thread_visibility() requires thread_is_readable() first, and the
-- ended connection's scope gate denies before the participant check is
-- ever reached.
do $$
declare
  v_name constant text := 'AC-9: set_thread_visibility() still refuses a connection-scoped thread once its connection has ended, even for a REAL thread_participants row on it';
  v_thread bigint;
begin
  select value into v_thread from ids where name = 'ac9_ended_connection_thread';
  perform public.set_thread_visibility(v_thread, 'private');
  insert into results values (v_name, false, 'call unexpectedly succeeded');
exception when others then
  perform pg_temp.denied(v_name, '42501', 'thread % not found or not readable in current context', sqlstate, sqlerrm);
end $$;

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
