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
--   4. Login shape (review fix F2, epic3-api-contract.md §11 Ruling 1 point
--      4) — "one login with memberships in accounts A and B, active in A",
--      not disjoint one-membership-each users, "which passes without ever
--      exercising current_context_id()". The main ACs below use disjoint
--      logins (three logins, one membership each — needed to model three
--      genuinely distinct parties); a dedicated later block re-proves the
--      same denials against a single caller who holds an active membership
--      in household A AND a shadchan membership in shadchanus S1, with their
--      active context forced to S1 — the shape that actually exercises
--      current_context_id()'s ACTIVE-membership read, not merely "has no
--      membership row at all".
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
-- 05_policies.sql for the seven tables Task 3 names. Review fix (F4): the
-- original wording here overclaimed the shape — corrected against the real
-- catalog:
--   * All seven `for all` policies (not "alone") are
--     `account_id = current_context_id() AND current_member_role() <> 'single'`
--     — every one of the seven carries the role guard; none is the account
--     floor by itself. `interactions` additionally ANDs an intra-account
--     visibility walk via reference_links -> shidduchim for parent
--     visibility.
--   * Four of the seven — singles, shidduchim, resumes, interactions — each
--     ALSO carry a SECOND, SELECT-only policy for the 'single' role's own
--     visibility branch ("Singles visible to self", "Shidduchim visible to
--     single", "Resumes visible to single", "Single reads own input"). The
--     original audit did not mention these at all. None of the four
--     mentions `connection` either, so AC-7's guard still reports clean —
--     but they are a distinct policy shape, worth naming explicitly since
--     AD-3/FR93's dignity floor lives in exactly those policies. The
--     negative ACs above target each table's `for all` policy specifically
--     (the one every connected-shadchan caller actually hits, since
--     `current_member_role()` for a shadchan is never 'single').
-- No policy on any of the seven mentions `connection` anywhere — nothing to
-- report on AD-20 specifically, no deviation found on that axis.
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
-- below (rather than shared through a psql `:'variable'`) purely for
-- call-site readability — each `capture_and_widen_policy(...)` call reads as
-- a complete, self-contained statement. Review fix (F5): an earlier version
-- of this comment justified the repetition by citing this project's
-- dollar-quoted-block convention ("psql `:variables` don't interpolate
-- reliably inside dollar-quoted/quoted SQL text" — every sibling suite's own
-- comment, e.g. interactions_targets.sql:91, about `do $$ ... $$` blocks
-- specifically). That convention does not apply here: none of the five call
-- sites below are inside a dollar-quoted block, they are plain
-- `select pg_temp.capture_and_widen_policy(...)` statements, where a psql
-- `:'variable'` interpolates correctly (verified against the running
-- database). The repetition is a readability choice, not a workaround for a
-- limitation this file's call sites don't have.
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

-- Review fix (F1): AC-7's fixed list names shidduchim, resumes and redts,
-- but only shidduchim (shidduch_a above) had a fixture row — resumes and
-- redts had no runtime denial test behind them at all, only the pg_policies
-- text guard below. A resume tied to the same suggestion, and a redt-history
-- row on the same shidduch, each with real candid content.
insert into public.resumes (account_id, shidduchim_id, extracted)
values (:household_a, :shidduch_a, '{"summary": "Candid resume extraction: family background detail, off the record."}'::jsonb)
returning id as resume_a \gset

insert into public.redts (account_id, shidduchim_id, note)
values (:household_a, :shidduch_a, 'Candid redt-history note: a prior shadchan''s off-the-record commentary.')
returning id as redt_a \gset

insert into ids values
  ('single_a', :single_a), ('shidduch_a', :shidduch_a), ('note_id', :note_id),
  ('reference_a', :reference_a), ('reference_link_a', :reference_link_a), ('date_record_a', :date_record_a),
  ('resume_a', :resume_a), ('redt_a', :redt_a);

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
select 'existence control (F1 review fix, shidduchim): household A''s own shidduchim row exists',
       count(*) = 1
from public.shidduchim where id = :shidduch_a;

insert into results (name, passed)
select 'existence control (F1 review fix, resumes): household A''s own resumes row exists with real candid content',
       count(*) = 1 and bool_and(extracted->>'summary' like 'Candid resume extraction%')
from public.resumes where id = :resume_a;

insert into results (name, passed)
select 'existence control (F1 review fix, redts): household A''s own redts row exists with real candid content',
       count(*) = 1 and bool_and(note like 'Candid redt-history note%')
from public.redts where id = :redt_a;

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
-- F1 review fix: AC-7 names shidduchim, resumes and redts in its fixed
-- list, but until this fix none of the three had a runtime denial test
-- behind them — only the pg_policies text guard, which cannot see a
-- helper-function predicate that never spells "connection", or an
-- RLS-disabled table, or a table whose policies were dropped outright (see
-- the relrowsecurity/presence guards near AC-7 below). These are real
-- SELECTs against real fixture rows, exactly like AC-1/AC-3/AC-5 above.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'F1 review fix: connected shadchan S1 reads ZERO of household A''s shidduchim rows',
       count(*) = 0
from public.shidduchim where account_id = :household_a;

insert into results (name, passed)
select 'F1 review fix: connected shadchan S1 reads ZERO of household A''s resumes rows',
       count(*) = 0
from public.resumes where account_id = :household_a;

insert into results (name, passed)
select 'F1 review fix: connected shadchan S1 reads ZERO of household A''s redts rows',
       count(*) = 0
from public.redts where account_id = :household_a;

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
-- F2 review fix — the contract's own negative-test shape
-- (epic3-api-contract.md §11 Ruling 1 point 4): "one login with memberships
-- in accounts A and B, active in A" — not two disjoint users, which "passes
-- without ever exercising current_context_id()". Every denial above used
-- logins that each hold exactly ONE membership, so a caller with no working
-- session at all would have produced the same green result. This block
-- re-proves the same denials against a SINGLE login who genuinely holds
-- BOTH a parent_admin membership in household A and a shadchan membership
-- in shadchanus S1 — then forces their active context to S1 through the
-- real set_active_context() RPC (never a raw member_state write, which RLS
-- refuses to `authenticated` outright — context_resolution.sql's own AC-3).
-- If current_context_id() ever degraded from "the caller's ACTIVE context"
-- to "any membership the caller holds", this is the shape that would catch
-- it, and the disjoint-login shape above would not.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('59400000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'privacy-dual-member@test.local');

insert into public.account_members (account_id, user_id, role, status) values
  (:household_a, '59400000-0000-0000-0000-000000000004', 'parent_admin', 'active'),
  (:shadchanus_s1, '59400000-0000-0000-0000-000000000004', 'shadchan', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000004","role":"authenticated"}';

-- activate_first_context_trigger already made household A active (inserted
-- first); switch into the shadchan context through the real RPC, exactly as
-- a person using the context switcher would.
select public.set_active_context(:shadchanus_s1);

insert into results (name, passed)
select 'F2 review fix sanity: the dual-membership caller''s current_context_id() resolves to shadchanus S1 after set_active_context(), not household A, even though they hold an active membership in BOTH',
       public.current_context_id() = :shadchanus_s1;

insert into results (name, passed)
select 'F2 review fix (contract shape, AC-1): a caller who IS a real member of household A, but whose ACTIVE context is shadchanus S1, reads ZERO of household A''s private notes',
       count(*) = 0
from public.interactions where account_id = :household_a and kind = 'note';

insert into results (name, passed)
select 'F2 review fix (contract shape, AC-2): same caller reads ZERO rows selecting what_they_said/conversation_log from household A''s reference_links',
       count(*) = 0
from (select what_they_said, conversation_log from public.reference_links where account_id = :household_a) x;

insert into results (name, passed)
select 'F2 review fix (contract shape, AC-3): same caller reads ZERO of household A''s date_records rows',
       count(*) = 0
from public.date_records where account_id = :household_a;

insert into results (name, passed)
select 'F2 review fix (contract shape, AC-5): same caller reads ZERO rows of public.singles or public.singles_summary for household A''s single',
       (select count(*) from public.singles where id = :single_a) = 0
   and (select count(*) from public.singles_summary where id = :single_a) = 0;

insert into results (name, passed)
select 'F2 review fix (contract shape, AC-7 tables): same caller reads ZERO of household A''s shidduchim, resumes or redts rows',
       (select count(*) from public.shidduchim where account_id = :household_a) = 0
   and (select count(*) from public.resumes where account_id = :household_a) = 0
   and (select count(*) from public.redts where account_id = :household_a) = 0;

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
-- F1 review fix: the same mutation-proof technique applied to the three
-- tables in AC-7's fixed list that previously had no runtime denial test at
-- all — shidduchim, resumes, redts.
-- ---------------------------------------------------------------------------
select pg_temp.capture_and_widen_policy(
  'public.shidduchim', 'Shidduchim scoped to account', 'exists (select 1 from public.connections c where c.household_account_id = account_id and c.shadchanus_account_id = public.current_context_id() and c.status = ''accepted'')'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'F1 MUTATION-PROOF: widening the shidduchim SELECT policy with a connection-based disjunct exposes household A''s suggestion to S1 — the runtime denial above is a real, falsifiable fact about the current policy',
       count(*) = 1
from public.shidduchim where id = :shidduch_a;

reset role;
select pg_temp.restore_policy('public.shidduchim', 'Shidduchim scoped to account');
set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'F1 MUTATION-PROOF restore (shidduchim): after restoring the real policy verbatim, S1 is denied again',
       count(*) = 0
from public.shidduchim where account_id = :household_a;

reset role;

select pg_temp.capture_and_widen_policy(
  'public.resumes', 'Resumes scoped to account', 'exists (select 1 from public.connections c where c.household_account_id = account_id and c.shadchanus_account_id = public.current_context_id() and c.status = ''accepted'')'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'F1 MUTATION-PROOF: widening the resumes SELECT policy with a connection-based disjunct exposes household A''s resume to S1',
       count(*) = 1
from public.resumes where id = :resume_a;

reset role;
select pg_temp.restore_policy('public.resumes', 'Resumes scoped to account');
set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'F1 MUTATION-PROOF restore (resumes): after restoring the real policy verbatim, S1 is denied again',
       count(*) = 0
from public.resumes where account_id = :household_a;

reset role;

select pg_temp.capture_and_widen_policy(
  'public.redts', 'Redts scoped to account', 'exists (select 1 from public.connections c where c.household_account_id = account_id and c.shadchanus_account_id = public.current_context_id() and c.status = ''accepted'')'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'F1 MUTATION-PROOF: widening the redts SELECT policy with a connection-based disjunct exposes household A''s redt history to S1',
       count(*) = 1
from public.redts where id = :redt_a;

reset role;
select pg_temp.restore_policy('public.redts', 'Redts scoped to account');
set local role authenticated;
set local request.jwt.claims = '{"sub":"59400000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into results (name, passed)
select 'F1 MUTATION-PROOF restore (redts): after restoring the real policy verbatim, S1 is denied again',
       count(*) = 0
from public.redts where account_id = :household_a;

reset role;

-- ---------------------------------------------------------------------------
-- Mutation-proof, AC-4: the same technique applied to threads' own SELECT
-- policy, but with a DELIBERATELY narrower defect than a blanket bypass — the
-- realistic regression is "checks the caller holds SOME accepted connection"
-- rather than "checks the caller holds AN accepted connection to THIS
-- thread's own connection_id". Under that widened policy S2 (who has its own
-- real, unrelated accepted connection to household A) wrongly reads
-- connection 1's thread too. Review fix (F3): an earlier version of this
-- comment claimed Epic 7's own suite (threads_entity.sql) "already
-- mutation-tests thread_is_readable()'s internals exhaustively" — false:
-- that file contains no in-suite mutation harness for thread_is_readable();
-- it only records, in prose, two ad-hoc mutations performed by hand during
-- review (threads_entity.sql around lines 103 and 1463), already reverted
-- and not something CI re-runs. This block's own mutation-proof below is
-- therefore the only automated, CI-run evidence that AC-4's denial is a
-- real, falsifiable fact about the CURRENT policy — it proves the
-- integration AC-4 asserts, not thread_is_readable()'s internals (confirmed
-- separately, by hand, during this review pass: swapping
-- thread_is_readable() for `select true` turns 3 checks red, including both
-- AC-4 assertions; for `select false`, 2 red, including the AC-6 positive).
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

-- Mutation-proof of the guard itself: install an ADDITIONAL policy that DOES
-- mention "connection" on one of the seven tables (redts — its own real
-- policy is untouched by this probe: capture_and_widen_policy's earlier
-- calls above always restore it before moving on, so this ADD-then-DROP
-- cannot interact with them) and prove the guard flips.
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

-- ---------------------------------------------------------------------------
-- F1 review fix: the qual-text guard above cannot see two real bypasses
-- proven against a running database during review: (a) RLS disabled
-- entirely on one of the seven tables — the policy TEXT is untouched, so
-- `ilike '%connection%'` still finds nothing to flag even though every row
-- is now readable to anyone; (b) a table's policies dropped outright — the
-- guard's `bool_and` only examines whichever rows still exist in
-- `pg_policies`, so a table left with ZERO policy rows there contributes
-- nothing to the aggregate and the guard still reports "clean" over the
-- rows that remain. Two more CI-runnable catalog facts close both, the same
-- way `references_entity.sql`'s "RLS is enabled on every new table" check
-- does for its own tables.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select 'F1 review fix: RLS is enabled (relrowsecurity) on every one of the seven FR113-named tables',
       bool_and(c.relrowsecurity)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('interactions', 'reference_links', 'date_records', 'singles', 'shidduchim', 'resumes', 'redts');

alter table public.redts disable row level security;

insert into results (name, passed)
select 'F1 MUTATION-PROOF (relrowsecurity): disabling RLS on one of the seven tables flips the guard to NOT clean, even though no policy''s text changed',
       not bool_and(c.relrowsecurity)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('interactions', 'reference_links', 'date_records', 'singles', 'shidduchim', 'resumes', 'redts');

alter table public.redts enable row level security;

insert into results (name, passed)
select 'F1 MUTATION-PROOF (relrowsecurity) restore: re-enabling RLS restores the guard to clean',
       bool_and(c.relrowsecurity)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('interactions', 'reference_links', 'date_records', 'singles', 'shidduchim', 'resumes', 'redts');

insert into results (name, passed)
select 'F1 review fix: all seven FR113-named tables are present in pg_policies with at least one policy',
       count(distinct tablename) = 7
from pg_policies
where schemaname = 'public'
  and tablename in ('interactions', 'reference_links', 'date_records', 'singles', 'shidduchim', 'resumes', 'redts');

drop policy "Redts scoped to account" on public.redts;

insert into results (name, passed)
select 'F1 MUTATION-PROOF (policy presence): dropping the sole policy on one of the seven tables flips the guard to NOT clean, even though every remaining policy''s own text stays innocent',
       count(distinct tablename) < 7
from pg_policies
where schemaname = 'public'
  and tablename in ('interactions', 'reference_links', 'date_records', 'singles', 'shidduchim', 'resumes', 'redts');

-- Recreated verbatim from 05_policies.sql — the one policy this file drops
-- outright rather than capturing/restoring through pg_temp.restore_policy,
-- because the point of this probe is a table with genuinely ZERO policies,
-- not a widened one.
create policy "Redts scoped to account" on public.redts
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

insert into results (name, passed)
select 'F1 MUTATION-PROOF (policy presence) restore: recreating the policy verbatim restores the guard to clean — all seven tables present again',
       count(distinct tablename) = 7
from pg_policies
where schemaname = 'public'
  and tablename in ('interactions', 'reference_links', 'date_records', 'singles', 'shidduchim', 'resumes', 'redts');

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
