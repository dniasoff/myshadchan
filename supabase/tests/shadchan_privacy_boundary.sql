--
-- The shadchan's privacy boundary (Epic 8 Story 8.4) — database test suite.
--
-- This story adds NO schema and NO policy. FR113's exclusion already holds
-- structurally (AD-20: a connection carries connection_id, never account_id,
-- and a shadchan holds no account_members row in any household — Dev Notes,
-- "Why this story is mostly verification, not construction"). This file's
-- entire job is to prove that in a running database, and to add a CI-runnable
-- guard that keeps it true.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (shadchan_privacy_boundary.test.ts) turns each row into a named assertion.
--
-- Falsifiability discipline this file follows throughout (per the story's own
-- framing: "a privacy suite that passes against a broken policy is worse than
-- none"):
--
--   1. Context-resolution sanity — before any denial is asserted, prove the
--      denied caller's OWN active context resolves to what the fixture put
--      there. Otherwise a denial could pass merely because the caller has NO
--      working session at all, which would deny everything unconditionally
--      and prove nothing about the connection axis specifically ("prove an
--      unrelated failure still fails").
--   2. Existence controls — before any denial, prove the target row/column
--      actually exists with real content, read by the household that owns
--      it. A denial test is also green when the fixture row was never
--      created; every AC below is preceded by exactly this control.
--   3. Mutation-proof — for every negative AC, the REAL policy is captured
--      verbatim from `pg_policy` (never re-typed — see interactions_targets.sql
--      for this project's precedent), swapped for a version that ALSO admits
--      a connection-based read (the exact regression AD-20 forbids and Task
--      3's guard exists to catch), the denial is shown to flip to a leak,
--      and the real policy is restored before the next check runs. This is
--      done inside the SAME transaction the suite runs in (which rolls back
--      at the end regardless), but the restore is not optional: without it,
--      every assertion AFTER the swap would run against the mutated policy
--      for the rest of this script.
--
-- No assertion in this file uses `exception when others` — every AC here is a
-- pure RLS-filtered SELECT (rows silently disappear, nothing raises), so the
-- "a denial handler that swallows an unrelated failure" hazard this project
-- has been bitten by (see AGENTS.md / the security-triggers rule) does not
-- apply to this file's shape. Where a raised error IS the right shape
-- (Task 3's mutation probe), it is a `create policy` / `drop policy` pair,
-- never a caught exception.
--
-- Task 4 (audit, not implementation) was performed by hand against
-- 05_policies.sql for the seven tables Task 3 names: every one of
-- interactions/reference_links/date_records/redts/singles/shidduchim/resumes
-- is scoped by `account_id = current_context_id()` alone, or (interactions
-- only) that same floor ANDed with an intra-account visibility walk via
-- reference_links -> shidduchim that never leaves the account. No policy on
-- any of the seven mentions `connection` anywhere — nothing to report, no
-- deviation found.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value bigint) on commit drop;
create temp table text_ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;
grant all on text_ids to public;

-- ---------------------------------------------------------------------------
-- Mutation-proof machinery. `capture_and_widen_policy` captures a named
-- policy's real USING/WITH CHECK verbatim (pg_get_expr on pg_policy, exactly
-- interactions_targets.sql's own technique), then replaces it with a version
-- that ALSO admits a connection-based read/write — the specific shape AD-20
-- forbids and every one of Task 3's seven tables must never gain.
-- `restore_policy` puts the captured original back, byte for byte. Handles
-- both shapes this file needs: a SELECT-only policy (WITH CHECK is null) and
-- a `for all` policy (WITH CHECK mirrors USING) — every policy this story
-- touches is one of those two, so no other shape is handled.
-- ---------------------------------------------------------------------------
create function pg_temp.capture_and_widen_policy(
  p_table text,
  p_policy text,
  p_extra_clause text
) returns void language plpgsql as $$
declare
  v_using text;
  v_check text;
begin
  select pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
  into v_using, v_check
  from pg_policy
  where polrelid = p_table::regclass and polname = p_policy;

  if v_using is null then
    raise exception 'policy % not found on % (nothing to capture)', p_policy, p_table;
  end if;

  insert into text_ids values (p_table || '||' || p_policy || '||using', v_using);
  insert into text_ids values (p_table || '||' || p_policy || '||check', coalesce(v_check, ''));
  insert into text_ids values (p_table || '||' || p_policy || '||check_is_null', (v_check is null)::text);

  execute format('drop policy %I on %s', p_policy, p_table);

  if v_check is null then
    execute format(
      'create policy %I on %s for select to authenticated using ((%s) or (%s))',
      p_policy, p_table, v_using, p_extra_clause
    );
  else
    execute format(
      'create policy %I on %s for all to authenticated using ((%s) or (%s)) with check ((%s) or (%s))',
      p_policy, p_table, v_using, p_extra_clause, v_check, p_extra_clause
    );
  end if;
end;
$$;

create function pg_temp.restore_policy(
  p_table text,
  p_policy text
) returns void language plpgsql as $$
declare
  v_using text;
  v_check text;
  v_check_is_null text;
begin
  select value into v_using from text_ids where name = p_table || '||' || p_policy || '||using';
  select value into v_check from text_ids where name = p_table || '||' || p_policy || '||check';
  select value into v_check_is_null from text_ids where name = p_table || '||' || p_policy || '||check_is_null';

  if v_using is null then
    raise exception 'no capture found for %/% — restore_policy called without a prior capture', p_table, p_policy;
  end if;

  execute format('drop policy %I on %s', p_policy, p_table);

  if v_check_is_null = 'true' then
    execute format('create policy %I on %s for select to authenticated using (%s)', p_policy, p_table, v_using);
  else
    execute format('create policy %I on %s for all to authenticated using (%s) with check (%s)', p_policy, p_table, v_using, v_check);
  end if;
end;
$$;

-- The "helpfully" widened predicate every mutation-proof below installs: any
-- account with an ACCEPTED connection to the caller's own active (shadchanus)
-- context can read/write the row — exactly the connection-based grant AD-20
-- forbids on these tables. The literal text is repeated at each call site
-- below (rather than shared through a psql variable) because this project's
-- own convention is explicit about psql `:variables` not interpolating
-- reliably inside dollar-quoted/quoted SQL text (see this file's header and
-- every sibling suite's own comment on the `ids` temp-table convention) — a
-- literal, repeated string is the safe choice here, not cleverness lost.
--
--   exists (
--     select 1 from public.connections c
--     where c.household_account_id = account_id
--       and c.shadchanus_account_id = public.current_context_id()
--       and c.status = 'accepted'
--   )

-- ---------------------------------------------------------------------------
-- Arrange (as postgres/superuser): household A (the data owner), two
-- shadchanus contexts S1/S2 — three disjoint logins, none carrying any
-- membership yet. Both S1 and S2 get their OWN accepted connection to
-- household A (mirrors shadchan_redting.sql's own AC-6(c) shape): AC-4 needs
-- S2 to be genuinely connected to A via a DIFFERENT connection, not merely a
-- stranger.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('59400000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'privacy-household-a@test.local'),
  ('59400000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'privacy-shadchan-s1@test.local'),
  ('59400000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'privacy-shadchan-s2@test.local');

insert into public.accounts (name, kind) values ('Privacy Boundary Household A', 'household')
returning id as household_a \gset
insert into public.accounts (name, kind) values ('Privacy Boundary Shadchanus S1', 'shadchanus')
returning id as shadchanus_s1 \gset
insert into public.accounts (name, kind) values ('Privacy Boundary Shadchanus S2', 'shadchanus')
returning id as shadchanus_s2 \gset

insert into ids values
  ('household_a', :household_a), ('shadchanus_s1', :shadchanus_s1), ('shadchanus_s2', :shadchanus_s2);

insert into public.account_members (account_id, user_id, role, status) values
  (:household_a, '59400000-0000-0000-0000-000000000001', 'parent_admin', 'active'),
  (:shadchanus_s1, '59400000-0000-0000-0000-000000000002', 'shadchan', 'active'),
  (:shadchanus_s2, '59400000-0000-0000-0000-000000000003', 'shadchan', 'active');

insert into public.connections (household_account_id, shadchanus_account_id, status, proposed_by_account_id, accepted_at)
values (:household_a, :shadchanus_s1, 'accepted', :household_a, now())
returning id as connection_a_s1 \gset
insert into public.connections (household_account_id, shadchanus_account_id, status, proposed_by_account_id, accepted_at)
values (:household_a, :shadchanus_s2, 'accepted', :household_a, now())
returning id as connection_a_s2 \gset

insert into ids values ('connection_a_s1', :connection_a_s1), ('connection_a_s2', :connection_a_s2);

-- Household A's own private data: a single, a suggestion (shidduch) on that
-- single, a private parent note on the suggestion (AC-1), a reference linked
-- to the same suggestion with candid call content filled in (AC-2), and a
-- dating-history row on the single (AC-3).
insert into public.singles (account_id, first_name_en, gender)
values (:household_a, 'Rivky', 'female')
returning id as single_a \gset

insert into public.shidduchim (account_id, single_id, name_en, pipeline_state, visibility)
values (:household_a, :single_a, 'A Suggestion for Rivky', 'look_into', 'shared')
returning id as shidduch_a \gset

insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
values (:household_a, 'shidduch', :shidduch_a, 'shidduch', 'note', 'Candid parent note: hesitant about the family''s reputation.')
returning id as note_id \gset

insert into public."references" (account_id, name_en)
values (:household_a, 'Rabbi Reference for Rivky''s Suggestion')
returning id as reference_a \gset

insert into public.reference_links (account_id, reference_id, shidduchim_id, call_status, what_they_said, conversation_log)
values (
  :household_a, :reference_a, :shidduch_a, 'answered',
  'Candid: some concerns about temperament, spoke frankly off the record.',
  '[{"source":"manual","text":"Candid: some concerns about temperament, spoke frankly off the record.","at":"2026-01-01T00:00:00Z"}]'::jsonb
)
returning id as reference_link_a \gset

insert into public.date_records (account_id, single_id, person_name_en, outcome, notes)
values (:household_a, :single_a, 'A Prior Date', 'ended', 'Candid dating-history note: did not go well, personality mismatch.')
returning id as date_record_a \gset

insert into ids values
  ('single_a', :single_a), ('shidduch_a', :shidduch_a), ('note_id', :note_id),
  ('reference_a', :reference_a), ('reference_link_a', :reference_link_a), ('date_record_a', :date_record_a);

-- ---------------------------------------------------------------------------
-- S1 sends a redt through the accepted A<->S1 connection (Story 8.3's
-- redt_via_connection()) — the ONE real "other shadchan's suggestion" thread
-- AC-4/AC-6 test. Producing it through the real function (not a hand-inserted
-- thread row) also re-validates Story 8.3's wiring end to end, per this
-- story's own Dependencies note.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

select (public.redt_via_connection(
  :connection_a_s1, 'A suggestion for Rivky', 'Suggesting a match for the single named Rivky.'
)).id as redt_item_id \gset

reset role;

select id as redt_thread_id from public.threads
where connection_id = :connection_a_s1 and subject_type = 'relationship' \gset
insert into ids values ('redt_item_id', :redt_item_id), ('redt_thread_id', :redt_thread_id);

-- ---------------------------------------------------------------------------
-- Context-resolution sanity ("prove an unrelated failure still fails"): each
-- denial below must be because of the connection-scoped RLS predicate
-- specifically, never because the caller has no working session at all — a
-- broken current_context_id() would deny everything unconditionally and
-- prove nothing about AD-20.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'sanity: household A''s own session resolves current_context_id() to household A', public.current_context_id() = :household_a;

set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'sanity: connected shadchan S1''s own session resolves current_context_id() to shadchanus S1, not household A', public.current_context_id() = :shadchanus_s1;

set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000003","role":"authenticated"}';

insert into results (name, passed)
select 'sanity: connected shadchan S2''s own session resolves current_context_id() to shadchanus S2', public.current_context_id() = :shadchanus_s2;

-- ---------------------------------------------------------------------------
-- Existence + positive controls (as household A): every row a denial test
-- below targets actually exists, with real candid content, and household A
-- itself CAN read it. Rules out "0 rows because nothing was ever created" —
-- the exact trap this project's rules call out by name.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into results (name, passed)
select 'existence control (AC-1): household A''s own private note exists and reads back with its real candid body',
       count(*) = 1 and bool_and(body like 'Candid parent note%')
from public.interactions where id = :note_id;

insert into results (name, passed)
select 'existence control (AC-2): household A''s own reference_link exists with real what_they_said/conversation_log content',
       count(*) = 1
       and bool_and(what_they_said like 'Candid: some concerns%')
       and bool_and(jsonb_array_length(conversation_log) = 1)
from public.reference_links where id = :reference_link_a;

insert into results (name, passed)
select 'existence control (AC-3): household A''s own date_records row exists with real candid notes',
       count(*) = 1 and bool_and(notes like 'Candid dating-history note%')
from public.date_records where id = :date_record_a;

insert into results (name, passed)
select 'existence control (AC-5): household A''s own single exists, from both singles and singles_summary',
       (select count(*) from public.singles where id = :single_a) = 1
   and (select count(*) from public.singles_summary where id = :single_a) = 1;

insert into results (name, passed)
select 'existence control (AC-4/AC-6): the redt thread on connection 1 exists, carries the redt''s own message body, and household A (a real party of the connection) can read it',
       count(*) = 1
from public.threads t
     join public.messages m on m.thread_id = t.id
where t.id = :redt_thread_id
  and t.connection_id = :connection_a_s1
  and m.body = 'Suggesting a match for the single named Rivky.';

reset role;

-- ---------------------------------------------------------------------------
-- AC-1: private notes are unreachable to the connected shadchan.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'AC-1: connected shadchan S1 reads ZERO of household A''s interactions rows of kind=note (private parent notes), regardless of which suggestion they concern',
       count(*) = 0
from public.interactions where account_id = :household_a and kind = 'note';

-- ---------------------------------------------------------------------------
-- AC-2: candid reference words are unreachable.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC-2: connected shadchan S1 reads ZERO rows selecting what_they_said/conversation_log from household A''s reference_links',
       count(*) = 0
from (
  select what_they_said, conversation_log from public.reference_links where account_id = :household_a
) x;

-- ---------------------------------------------------------------------------
-- AC-3: dating history is unreachable.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC-3: connected shadchan S1 reads ZERO of household A''s date_records rows',
       count(*) = 0
from public.date_records where account_id = :household_a;

-- ---------------------------------------------------------------------------
-- AC-5: the single's own data is unreachable — not even the single named in
-- the redt S1 itself just sent.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC-5: connected shadchan S1 reads ZERO rows of public.singles for the single named in its own redt',
       count(*) = 0
from public.singles where id = :single_a;

insert into results (name, passed)
select 'AC-5: connected shadchan S1 reads ZERO rows of public.singles_summary for the same single',
       count(*) = 0
from public.singles_summary where id = :single_a;

-- ---------------------------------------------------------------------------
-- AC-6 (positive): S1 CAN read exactly the thread it created via
-- redt_via_connection().
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'AC-6 (positive): shadchan S1 CAN read the connection-scoped thread it created via redt_via_connection()',
       count(*) = 1
from public.threads where id = :redt_thread_id and connection_id = :connection_a_s1;

reset role;

-- ---------------------------------------------------------------------------
-- AC-4: other shadchanim's suggestions are unreachable. S2 is genuinely
-- connected to household A (via connection_a_s2, its OWN accepted
-- connection) — but cannot read connection 1's thread even so, and cannot
-- enumerate that it exists. This also completes AC-6's "by no other
-- shadchan" half.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000003","role":"authenticated"}';

insert into results (name, passed)
select 'AC-4: shadchan S2 (connected via a DIFFERENT connection) reads ZERO rows of connection 1''s suggestion thread',
       count(*) = 0
from public.threads where connection_id = :connection_a_s1;

insert into results (name, passed)
select 'AC-4/AC-6 (by no other shadchan): S2''s own unfiltered thread listing does not contain connection 1''s thread id — cannot enumerate that it exists',
       not (:redt_thread_id = any (array(select id from public.threads)));

reset role;

-- ---------------------------------------------------------------------------
-- Mutation-proof, AC-1 through AC-5: for each policy an AC above relies on,
-- capture it verbatim, widen it with the connection-based leak clause, prove
-- the denial FLIPS to a leak, restore the real policy verbatim, and prove the
-- denial is back. See this file's header for why the restore is required
-- (not merely tidy) inside a single long-running transaction.
-- ---------------------------------------------------------------------------
select pg_temp.capture_and_widen_policy(
  'public.interactions', 'Interactions readable within account and parent visibility', 'exists (select 1 from public.connections c where c.household_account_id = account_id and c.shadchanus_account_id = public.current_context_id() and c.status = ''accepted'')'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'MUTATION-PROOF (AC-1): widening the interactions SELECT policy with a connection-based disjunct makes household A''s private note readable to connected shadchan S1 — AC-1''s "0 rows" result is a real, falsifiable fact about the current policy',
       count(*) = 1
from public.interactions where id = :note_id;

reset role;
select pg_temp.restore_policy('public.interactions', 'Interactions readable within account and parent visibility');
set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'MUTATION-PROOF (AC-1) restore: after restoring the real policy verbatim, S1 is denied again — 0 rows, exactly like AC-1''s original result',
       count(*) = 0
from public.interactions where account_id = :household_a and kind = 'note';

reset role;

select pg_temp.capture_and_widen_policy(
  'public.reference_links', 'Reference links scoped to account', 'exists (select 1 from public.connections c where c.household_account_id = account_id and c.shadchanus_account_id = public.current_context_id() and c.status = ''accepted'')'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'MUTATION-PROOF (AC-2): widening the reference_links policy with a connection-based disjunct exposes the candid what_they_said/conversation_log to S1',
       count(*) = 1 and bool_and(what_they_said like 'Candid: some concerns%')
from public.reference_links where id = :reference_link_a;

reset role;
select pg_temp.restore_policy('public.reference_links', 'Reference links scoped to account');
set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'MUTATION-PROOF (AC-2) restore: after restoring the real policy, S1 is denied again',
       count(*) = 0
from (select what_they_said, conversation_log from public.reference_links where account_id = :household_a) x;

reset role;

select pg_temp.capture_and_widen_policy(
  'public.date_records', 'Date records scoped to account', 'exists (select 1 from public.connections c where c.household_account_id = account_id and c.shadchanus_account_id = public.current_context_id() and c.status = ''accepted'')'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'MUTATION-PROOF (AC-3): widening the date_records policy with a connection-based disjunct exposes household A''s dating history to S1',
       count(*) = 1
from public.date_records where id = :date_record_a;

reset role;
select pg_temp.restore_policy('public.date_records', 'Date records scoped to account');
set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'MUTATION-PROOF (AC-3) restore: after restoring the real policy, S1 is denied again',
       count(*) = 0
from public.date_records where account_id = :household_a;

reset role;

select pg_temp.capture_and_widen_policy(
  'public.singles', 'Singles scoped to account', 'exists (select 1 from public.connections c where c.household_account_id = account_id and c.shadchanus_account_id = public.current_context_id() and c.status = ''accepted'')'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'MUTATION-PROOF (AC-5): widening the singles policy with a connection-based disjunct exposes the single itself to S1',
       count(*) = 1
from public.singles where id = :single_a;

reset role;
select pg_temp.restore_policy('public.singles', 'Singles scoped to account');
set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'MUTATION-PROOF (AC-5) restore: after restoring the real policy, S1 is denied again, from both singles and singles_summary',
       (select count(*) from public.singles where id = :single_a) = 0
   and (select count(*) from public.singles_summary where id = :single_a) = 0;

reset role;

-- ---------------------------------------------------------------------------
-- Mutation-proof, AC-4: the same technique applied to threads' own SELECT
-- policy, but with a DELIBERATELY narrower defect than a blanket bypass — the
-- realistic regression is "checks the caller holds SOME accepted connection"
-- rather than "checks the caller holds AN accepted connection to THIS
-- thread's own connection_id". Under that widened policy S2 (who has its own
-- real, unrelated accepted connection to household A) wrongly reads
-- connection 1's thread too. Epic 7's own suite (threads_entity.sql) already
-- mutation-tests thread_is_readable()'s internals exhaustively — this proves
-- only the integration AC-4 itself asserts.
-- ---------------------------------------------------------------------------
select pg_temp.capture_and_widen_policy(
  'public.threads', 'Threads readable per thread_is_readable',
  'connection_id is not null and exists (select 1 from public.connections c where c.shadchanus_account_id = public.current_context_id() and c.status = ''accepted'')'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000003","role":"authenticated"}';

insert into results (name, passed)
select 'MUTATION-PROOF (AC-4): widening the threads policy to admit ANY accepted connection (rather than THIS thread''s own connection_id) wrongly exposes connection 1''s thread to S2',
       count(*) = 1
from public.threads where id = :redt_thread_id;

reset role;
select pg_temp.restore_policy('public.threads', 'Threads readable per thread_is_readable');
set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000003","role":"authenticated"}';

insert into results (name, passed)
select 'MUTATION-PROOF (AC-4) restore: after restoring the real policy, S2 is denied again',
       count(*) = 0
from public.threads where connection_id = :connection_a_s1;

reset role;

-- ---------------------------------------------------------------------------
-- Task 3 (AC-7): the pg_policies structural regression guard. A CI-runnable
-- fact about the catalog, not inferred from one test run: no USING/WITH CHECK
-- expression on any of the seven named tables mentions "connection" anywhere.
-- `threads` is deliberately absent — it legitimately carries the
-- connection_id axis (AD-22).
-- ---------------------------------------------------------------------------
create function pg_temp.privacy_boundary_clean() returns boolean
    language sql as $$
  select coalesce(
    bool_and(
      (qual is null or qual not ilike '%connection%')
      and (with_check is null or with_check not ilike '%connection%')
    ),
    false
  )
  from pg_policies
  where schemaname = 'public'
    and tablename in ('interactions', 'reference_links', 'date_records', 'singles', 'shidduchim', 'resumes', 'redts');
$$;

insert into results (name, passed)
select 'AC-7: no USING/WITH CHECK clause on interactions, reference_links, date_records, singles, shidduchim, resumes or redts mentions "connection" anywhere — the structural regression guard AD-20 requires',
       pg_temp.privacy_boundary_clean();

-- Mutation-proof of the guard itself: install a policy that DOES mention
-- "connection" on one of the seven tables (redts — untouched by every check
-- above, so this cannot interact with them) and prove the guard flips.
create policy "MUTATION PROBE: temp connection read (dropped below)" on public.redts
    for select to authenticated
    using (exists (select 1 from public.connections));

insert into results (name, passed)
select 'AC-7 MUTATION-PROOF: a policy naming "connection" on one of the seven tables flips the guard to NOT clean — the ''clean'' result above is a real, falsifiable structural fact, not a vacuous pass',
       not pg_temp.privacy_boundary_clean();

drop policy "MUTATION PROBE: temp connection read (dropped below)" on public.redts;

insert into results (name, passed)
select 'AC-7 MUTATION-PROOF restore: dropping the probe policy returns the guard to clean',
       pg_temp.privacy_boundary_clean();

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
