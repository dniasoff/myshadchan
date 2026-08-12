--
-- Standing guard: consuming an ACCEPTED child grant to read `public.shidduch_education`
-- via a cross-household SELECT — database suite.
--
-- WHY IT EXISTS. This is RLS increment 6 of the child_grants plan (Epic 14):
-- a grantee household that has accepted a grant for a proposer's single may read
-- that single's shidduch_education rows through the policy "Shidduch education
-- readable via accepted grant" (05_policies.sql).
--
-- DELIBERATELY BROADER (E13-D6) — this increment exists specifically to prove a
-- GRANTEE is NOT treated like a SINGLE. The table already has a "visible to
-- single" SELECT policy that gates on `visibility = 'shared'` AND
-- `is_single_visible_state(pipeline_state)` (a single should only see education
-- entries for suggestions that have progressed to a shareable state). A grantee is a
-- second parent-figure the proposer household has vouched for, not the single,
-- so the new grant policy MUST NOT copy either gate. Assertion (c) below is the
-- whole point of this increment: it proves an education entry attached to a suggestion
-- that a single would NOT see (private_parent / non-single-visible state) IS
-- visible to the accepted grantee. A wrong (narrower, gate-copying) policy makes
-- exactly assertion (c) fail.
--
-- The `status = 'accepted'` conjunct is LITERAL: sever_child_grant()
-- (02_functions.sql) sets status = 'severed' but never NULLs grantee_account_id,
-- so keying on the id column alone would leak. The grant is driven
-- pending -> accepted so the proof is a real lifecycle, not two hand-authored
-- rows. Every non-accepted fixture carries a POPULATED grantee_account_id.
--
-- (d) pins the read-only-structural boundary mirrored on every prior increment:
-- the grant opens read for the grantee HOUSEHOLD's owning members, not for that
-- household's own single-persona members — without the
-- `current_member_role() <> 'single'` conjunct, the grantee household's own
-- single would suddenly see a record that was never theirs.
--
-- Story 13.x (access tiers) adds (e)-(i): UPDATE permission via the new
-- "Shidduch education updatable via accepted edit grant" policy.
--   (e) a READ-tier accepted grantee (the same grant driven above, default
--       access_level = 'read') cannot UPDATE — 0 rows, silent USING filter.
--   (f) a COMMENT-tier accepted grantee cannot UPDATE either — edit is a
--       strict superset of comment, not the other way around.
--   (g) an EDIT-tier accepted grantee (parent_admin) CAN UPDATE, and the
--       written value persists.
--   (h) a HELPER-role member of the SAME edit-tier grantee account cannot —
--       the edit tier's role gate is tighter than every other grant-consuming
--       policy in this file (parent_admin/self_manager only, not merely
--       `<> 'single'`).
--   (i) the account_id-repointing attack: the edit-tier grantee's own OLD row
--       passes `using`, but `UPDATE ... SET account_id = <their own account>`
--       must be denied by `with check`'s second conjunct — Postgres raises
--       rather than silently filtering when `with check` (as opposed to
--       `using`) is what fails a row that was already targeted, so this
--       assertion is wrapped in its own exception handler. The row's real
--       account_id is independently confirmed unchanged afterward.
--
-- The runner is child_grant_shidduch_education_access.test.ts.
--

create temporary table results (
  name text,
  passed boolean,
  detail text
) on commit drop;
grant all on results to public;

create temporary table ids (k text primary key, v bigint) on commit drop;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- Arrange: a proposing household (A) that grants its single to a receiving
-- household (B), plus an unrelated household (C) and a single-role member
-- inside B (to pin the read-only-structural boundary in (d)).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('1a111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgss-proposer@test.local'),
  ('1bbbbbbb-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgss-grantee@test.local'),
  ('1ccccc33-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgss-stranger@test.local'),
  ('1dddd444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgss-grantee-single@test.local'),
  ('1eeee555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgss-grantee-comment@test.local'),
  ('1fffff66-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgss-grantee-edit@test.local'),
  ('1a777777-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgss-grantee-edit-helper@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('CGSS Proposer') returning id as acct_a \gset
insert into public.accounts (name) values ('CGSS Grantee') returning id as acct_b \gset
insert into public.accounts (name) values ('CGSS Stranger') returning id as acct_c \gset
-- (e)-(i): dedicated households for the two OTHER access tiers, so (e)'s
-- read-tier negative reuses acct_b's existing grant and (f)/(g)/(h)/(i) each
-- get their own tier-pure household rather than layering multiple grants
-- onto one account (which would make "which grant governed this outcome"
-- ambiguous).
insert into public.accounts (name) values ('CGSS Grantee Comment') returning id as acct_d \gset
insert into public.accounts (name) values ('CGSS Grantee Edit') returning id as acct_e \gset

insert into public.account_members (account_id, user_id, role) values
  (:acct_a, '1a111111-1111-1111-1111-111111111111', 'parent_admin'),
  (:acct_b, '1bbbbbbb-2222-2222-2222-222222222222', 'parent_admin'),
  (:acct_c, '1ccccc33-3333-3333-3333-333333333333', 'parent_admin'),
  (:acct_b, '1dddd444-4444-4444-4444-444444444444', 'single'),
  (:acct_d, '1eeee555-5555-5555-5555-555555555555', 'parent_admin'),
  (:acct_e, '1fffff66-6666-6666-6666-666666666666', 'parent_admin'),
  (:acct_e, '1a777777-7777-7777-7777-777777777777', 'helper');

insert into public.member_state (user_id, active_account_id) values
  ('1a111111-1111-1111-1111-111111111111', :acct_a),
  ('1bbbbbbb-2222-2222-2222-222222222222', :acct_b),
  ('1ccccc33-3333-3333-3333-333333333333', :acct_c),
  ('1dddd444-4444-4444-4444-444444444444', :acct_b),
  ('1eeee555-5555-5555-5555-555555555555', :acct_d),
  ('1fffff66-6666-6666-6666-666666666666', :acct_e),
  ('1a777777-7777-7777-7777-777777777777', :acct_e)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

insert into ids values ('acct_a', :acct_a);
insert into ids values ('acct_d', :acct_d);
insert into ids values ('acct_e', :acct_e);

insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Granted', 'Single') returning id as single_a \gset

insert into ids values ('single_a', :single_a);

-- Shidduch B: the ORDINARY, single-VISIBLE case — visibility 'shared' and a
-- pipeline_state that is_single_visible_state() returns TRUE for ('look_into'
-- is explicitly single-visible in 02_functions.sql). An education entry on this
-- shidduch is seen by the single AND by the grantee.
insert into public.shidduchim
  (account_id, single_id, name_en, visibility, pipeline_state)
values
  (:acct_a, :single_a, 'Granted Shared Shidduch', 'shared', 'look_into')
returning id as shidduch_b \gset

insert into ids values ('shidduch_b', :shidduch_b);

-- Shidduch C: the CRITICAL case — visibility 'private_parent' (NOT 'shared'),
-- so this suggestion is INVISIBLE to a single looking at their own suggestion
-- ("Shidduch education visible to single" gates on visibility='shared'). An
-- education entry on this shidduch must still be VISIBLE to the accepted
-- grantee. This kills the 'private_parent'-gate-copying variant of a wrong
-- policy.
insert into public.shidduchim
  (account_id, single_id, name_en, visibility, pipeline_state)
values
  (:acct_a, :single_a, 'Granted Private Shidduch', 'private_parent', 'new')
returning id as shidduch_c \gset

insert into ids values ('shidduch_c', :shidduch_c);

-- An education entry each, so (b) and (c) can be asserted independently by id.
insert into public.shidduch_education (account_id, shidduchim_id, kind, name_en)
values
  (:acct_a, :shidduch_b, 'seminary', 'Shared Semantic School')
returning id as education_b \gset

insert into ids values ('education_b', :education_b);

insert into public.shidduch_education (account_id, shidduchim_id, kind, name_en)
values
  (:acct_a, :shidduch_c, 'seminary', 'Private Semantic School')
returning id as education_c \gset

insert into ids values ('education_c', :education_c);

-- One grant, driven through its true lifecycle in this test. grantee_account_id
-- stays POPULATED from the first insert onward — the leak-prone shape the
-- status='accepted' conjunct exists to close — so no assertion ever depends on
-- the id column accidentally being null.
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id)
values
  (:acct_a, :single_a, 'cgss-test-hash', 'pending', now() + interval '30 days', :acct_b)
returning id as grant_row \gset

insert into ids values ('grant_row', :grant_row);

-- Two more grants for the SAME target single, already 'accepted' from
-- insert (no need to re-drive the pending->accepted lifecycle a third time —
-- (a)-(d) above already prove that): one comment-tier (acct_d), one
-- edit-tier (acct_e). Used by (e)-(i) below.
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id, accepted_at, access_level)
values
  (:acct_a, :single_a, 'cgss-test-hash-comment', 'accepted', now() + interval '30 days', :acct_d, now(), 'comment')
returning id as grant_row_comment \gset

insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id, accepted_at, access_level)
values
  (:acct_a, :single_a, 'cgss-test-hash-edit', 'accepted', now() + interval '30 days', :acct_e, now(), 'edit')
returning id as grant_row_edit \gset

-- ---------------------------------------------------------------------------
-- (a) NEGATIVE: an unrelated household (no grant at all) cannot select any of
-- the target single's shidduch_education rows — by id, or in a list scan.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1ccccc33-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed, detail)
select 'stranger cannot read the shared-visible education entry by id',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.shidduch_education
where id = (select v from ids where k = 'education_b');

insert into results (name, passed, detail)
select 'stranger cannot read the private_parent education entry by id',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.shidduch_education
where id = (select v from ids where k = 'education_c');

insert into results (name, passed, detail)
select 'stranger sees zero shidduch_education rows for the target single in a list scan',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.shidduch_education
where shidduchim_id in ((select v from ids where k = 'shidduch_b'), (select v from ids where k = 'shidduch_c'));

reset role;

-- ---------------------------------------------------------------------------
-- (b) NEGATIVE: a grant that exists but is NOT yet 'accepted' grants nothing.
-- grantee_account_id is populated the whole time, so a pending status must
-- still return zero.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'grantee sees nothing while the grant is pending (status not accepted)',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.shidduch_education
where shidduchim_id in ((select v from ids where k = 'shidduch_b'), (select v from ids where k = 'shidduch_c'));

reset role;

-- ---------------------------------------------------------------------------
-- Accept the grant (simulates accept_child_grant(): status='accepted', the
-- grantee_account_id already populated). Now (b) positive, (c) the critical
-- broader assertion, and (d) the single-role boundary can be exercised against
-- a LIVE accepted grant.
-- ---------------------------------------------------------------------------
update public.child_grants
set status = 'accepted', accepted_at = now()
where id = (select v from ids where k = 'grant_row');

-- ---------------------------------------------------------------------------
-- (b) POSITIVE (ordinary case): the accepted grantee reads the education entry
-- attached to the shidduch whose visibility IS 'shared' and whose pipeline_state
-- IS single-visible — the same row a single would be allowed to see, opened
-- here through the grant path.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'accepted grantee reads the shared-visible education entry by id',
       count(*) = 1,
       format('rows = %s (expected 1)', count(*))
from public.shidduch_education
where id = (select v from ids where k = 'education_b');

insert into results (name, passed, detail)
select 'accepted grantee sees both education entries for the granted single in a list scan',
       count(*) = 2,
       format('rows = %s (expected both education entries: shared-visible AND private_parent)', count(*))
from public.shidduch_education
where shidduchim_id in ((select v from ids where k = 'shidduch_b'), (select v from ids where k = 'shidduch_c'));

-- ---------------------------------------------------------------------------
-- (c) THE SPECIFIC, MOST IMPORTANT ASSERTION: the accepted grantee ALSO reads
-- the education entry attached to the shidduch whose visibility is
-- 'private_parent' (NOT 'shared') — a suggestion a single would be INVISIBLE
-- to. If the policy had accidentally copied the `visibility = 'shared'` /
-- `is_single_visible_state()` gates from "Shidduch education visible to
-- single", this row would disappear for the grantee and THIS assertion
-- fails. Passing it is the whole point of this increment.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'accepted grantee reads the private_parent (single-invisible) education entry by id',
       count(*) = 1,
       format('rows = %s (expected 1 — must stay visible to the grantee, proving the single-only gates were NOT copied)', count(*))
from public.shidduch_education
where id = (select v from ids where k = 'education_c');

insert into results (name, passed, detail)
select 'accepted grantee sees the private_parent education entry in a list scan over the granted single',
       count(*) = 1,
       format('rows = %s (expected the single-invisible private_parent education row)', count(*))
from public.shidduch_education
where shidduchim_id = (select v from ids where k = 'shidduch_c');

-- ---------------------------------------------------------------------------
-- (d) NEGATIVE: a single-role member of the ACCEPTED grantee's OWN household
-- still sees zero shidduch_education rows for the granted single — the grant
-- opens read for the household, not for its own single-persona members.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1dddd444-4444-4444-4444-444444444444","role":"authenticated"}';

insert into results (name, passed, detail)
select 'a single-role member of the grantee household still sees zero education entries by id',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.shidduch_education
where id = (select v from ids where k = 'education_b');

insert into results (name, passed, detail)
select 'a single-role member of the grantee household sees no granted education entries in a list',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.shidduch_education
where shidduchim_id in ((select v from ids where k = 'shidduch_b'), (select v from ids where k = 'shidduch_c'));

reset role;

-- ---------------------------------------------------------------------------
-- (e) NEGATIVE: the READ-tier accepted grantee (grant_row, default
-- access_level = 'read') cannot UPDATE — "Shidduch education updatable via
-- accepted edit grant" requires access_level = 'edit'; the OLD row fails
-- `using` and is silently filtered (0 rows, no error).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  update public.shidduch_education
  set name_en = 'read-tier grantee attempted edit'
  where id = (select v from ids where k = 'education_b');
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values (
    '(e) a READ-tier accepted grantee cannot UPDATE shidduch_education -> 0 rows',
    v_rows = 0,
    format('rows = %s (expected 0)', v_rows)
  );
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- (f) NEGATIVE: the COMMENT-tier accepted grantee cannot UPDATE either — edit
-- is a superset of comment, never the reverse.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1eeee555-5555-5555-5555-555555555555","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  update public.shidduch_education
  set name_en = 'comment-tier grantee attempted edit'
  where id = (select v from ids where k = 'education_b');
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values (
    '(f) a COMMENT-tier accepted grantee cannot UPDATE shidduch_education -> 0 rows',
    v_rows = 0,
    format('rows = %s (expected 0)', v_rows)
  );
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- (g) POSITIVE: the EDIT-tier accepted grantee (parent_admin) CAN UPDATE, and
-- the written value persists. Deliberately does NOT touch account_id in the
-- SET list — enforce_household_scope()'s BEFORE trigger on this table fires
-- only `before insert or update OF account_id` (column-specific), so an
-- ordinary field-level edit never reaches it at all. See this test's own
-- runner-file header / the stage's final report for the full reasoning:
-- enforce_household_scope() itself runs under the CALLER's RLS on `accounts`
-- and would wrongly deny a grantee who explicitly re-sent their own
-- unchanged account_id, which is a real, confirmed, and DELIBERATELY UNFIXED
-- gap in that trigger (out of this stage's declared scope) — this assertion
-- is scoped to prove the RLS policy alone, not that trigger.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1fffff66-6666-6666-6666-666666666666","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  update public.shidduch_education
  set name_en = 'edit-tier grantee edit'
  where id = (select v from ids where k = 'education_b');
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values (
    '(g) an EDIT-tier accepted grantee CAN UPDATE shidduch_education -> 1 row',
    v_rows = 1,
    format('rows = %s (expected 1)', v_rows)
  );
end $$;

insert into results (name, passed, detail)
select '(g) the written value persists and is readable back by the same edit-tier grantee',
       count(*) = 1,
       format('rows = %s (expected 1 row with the new name_en)', count(*))
from public.shidduch_education
where id = (select v from ids where k = 'education_b')
  and name_en = 'edit-tier grantee edit';

reset role;

insert into results (name, passed, detail)
select '(g) the row''s account_id is still the PROPOSER''s account after a legitimate field-only edit',
       account_id = (select v from ids where k = 'acct_a'),
       format('account_id = %s (expected acct_a = %s)', account_id, (select v from ids where k = 'acct_a'))
from public.shidduch_education
where id = (select v from ids where k = 'education_b');

-- ---------------------------------------------------------------------------
-- (h) NEGATIVE: a HELPER-role member of the SAME edit-tier grantee account
-- cannot UPDATE — the edit tier's own role gate
-- (`current_member_role() in ('parent_admin', 'self_manager')`) is tighter
-- than every other grant-consuming policy in this file (`<> 'single'`), by
-- explicit owner decision: a helper may view and comment, never edit.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1a777777-7777-7777-7777-777777777777","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  update public.shidduch_education
  set name_en = 'helper attempted edit'
  where id = (select v from ids where k = 'education_b');
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values (
    '(h) a HELPER member of an edit-tier grantee account cannot UPDATE shidduch_education -> 0 rows',
    v_rows = 0,
    format('rows = %s (expected 0)', v_rows)
  );
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- (i) ATTACK: the edit-tier grantee's OLD row passes `using` (they DO hold a
-- valid edit-tier grant on this exact row), so `UPDATE ... SET account_id =
-- <their own account>` reaches `with check` — and its second conjunct denies
-- it. Unlike (e)/(f)/(h) above (`using` failures, silently 0 rows), a `with
-- check` failure on a row that already passed `using` makes Postgres RAISE
-- (the "Single listings update" F1 precedent's own distinction,
-- 05_policies.sql) — so this assertion is wrapped in its own exception
-- handler, and passes on EITHER outcome (a raised error, or defensively 0
-- rows) as long as the row's account_id is verified unchanged afterward.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1fffff66-6666-6666-6666-666666666666","role":"authenticated"}';

do $$
declare
  v_rows int;
begin
  update public.shidduch_education
  set account_id = (select v from ids where k = 'acct_e')
  where id = (select v from ids where k = 'education_b');
  get diagnostics v_rows = row_count;

  insert into results (name, passed, detail)
  values (
    '(i) the account_id-repointing attack does not silently succeed (0 rows, no error)',
    v_rows = 0,
    format('rows = %s (expected 0)', v_rows)
  );
exception when others then
  insert into results (name, passed, detail)
  values (
    '(i) the account_id-repointing attack does not silently succeed (0 rows, no error)',
    true,
    format('UPDATE raised as expected (with check denied the NEW row): %s', sqlerrm)
  );
end $$;

reset role;

insert into results (name, passed, detail)
select '(i) the row''s account_id is still the PROPOSER''s account after the attack attempt',
       account_id = (select v from ids where k = 'acct_a'),
       format('account_id = %s (expected acct_a = %s, NOT the attacker''s acct_e = %s)',
              account_id, (select v from ids where k = 'acct_a'), (select v from ids where k = 'acct_e'))
from public.shidduch_education
where id = (select v from ids where k = 'education_b');

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail))
from results;
