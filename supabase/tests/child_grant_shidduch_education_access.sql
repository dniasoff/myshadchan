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
  ('1dddd444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgss-grantee-single@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('CGSS Proposer') returning id as acct_a \gset
insert into public.accounts (name) values ('CGSS Grantee') returning id as acct_b \gset
insert into public.accounts (name) values ('CGSS Stranger') returning id as acct_c \gset

insert into public.account_members (account_id, user_id, role) values
  (:acct_a, '1a111111-1111-1111-1111-111111111111', 'parent_admin'),
  (:acct_b, '1bbbbbbb-2222-2222-2222-222222222222', 'parent_admin'),
  (:acct_c, '1ccccc33-3333-3333-3333-333333333333', 'parent_admin'),
  (:acct_b, '1dddd444-4444-4444-4444-444444444444', 'single');

insert into public.member_state (user_id, active_account_id) values
  ('1a111111-1111-1111-1111-111111111111', :acct_a),
  ('1bbbbbbb-2222-2222-2222-222222222222', :acct_b),
  ('1ccccc33-3333-3333-3333-333333333333', :acct_c),
  ('1dddd444-4444-4444-4444-444444444444', :acct_b)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

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

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail))
from results;
