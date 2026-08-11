--
-- Standing guard: consuming an ACCEPTED child grant to read `public.resumes`
-- via a cross-household SELECT — database suite.
--
-- WHY IT EXISTS. Increment 1 (child_grant_singles_access.sql) pinned the FIRST
-- consuming RLS policy, increment 3 (child_grant_shidduchim_access.sql) pinned
-- the shidduchim one. This suite pins the FOURTH: the matching policy on
-- `public.resumes` ("Resumes readable via accepted grant", 05_policies.sql) —
-- a grantee household that has accepted a grant for a proposer's single may
-- SELECT that single's resumes, and rows seen through exactly that path, and
-- no other rows.
--
-- THE LEAK THIS INCREMENT EXISTS TO RULE OUT (assertion (c)): a widening that
-- matched on the proposer's `account_id` instead of the exact
-- `target_single_id` would leak EVERY OTHER single's resumes in the same
-- proposer household, not just the granted one. A second, SIBLING single in
-- the SAME proposer household, with its own resume that is NOT named in the
-- grant, exists purely to prove the join is pinned to the exact granted
-- single_id, not the account_id: the accepted grantee must see zero rows for
-- that sibling.
--
-- `resumes_owner_check` (01_tables.sql) guarantees exactly one of
-- `shidduchim_id`/`single_id` is set (XOR) — so the two branches of the OR in
-- the policy are mutually exclusive and each resume shape is asserted through
-- its own branch: single_a's suggestion-resume (shidduchim_id branch) and
-- single_a's own outbound resume (single_id branch).
--
-- (d) matters as a boundary too: the grant opens read for the grantee
-- HOUSEHOLD's owning members, not for that household's own single-persona
-- members. Without the `current_member_role() <> 'single'` conjunct, the
-- grantee household's own single would suddenly see a record that was never
-- theirs — the read-only-structural boundary this increment preserves (same
-- shape as every prior increment).
--
-- Status mutations are done as postgres (the connection's superuser) between
-- the caller-specific query blocks: `child_grants` withholds every write from
-- `authenticated` (06_grants.sql, SELECT-only by design), so the lifecycle
-- transitions belong in the arrange phase. The grant is driven pending ->
-- accepted so the pending-then-accepted proof is a real lifecycle, and
-- grantee_account_id stays POPULATED the whole time (the leak-prone shape the
-- status='accepted' conjunct is what closes — see increment 1's header).
--
-- The runner is child_grant_resumes_access.test.ts.
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
-- inside B (to pin the read-only-structural boundary in (d)). Household A
-- holds TWO singles: the granted single `single_a` and a SIBLING
-- `single_sibling` whose resume must stay invisible to the grantee (c).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('2a111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgr-proposer@test.local'),
  ('2bbbbbbb-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgr-grantee@test.local'),
  ('2ccccccc-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgr-stranger@test.local'),
  ('2ddddddd-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgr-grantee-single@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('CGR Proposer') returning id as acct_a \gset
insert into public.accounts (name) values ('CGR Grantee') returning id as acct_b \gset
insert into public.accounts (name) values ('CGR Stranger') returning id as acct_c \gset

insert into public.account_members (account_id, user_id, role) values
  (:acct_a, '2a111111-1111-1111-1111-111111111111', 'parent_admin'),
  (:acct_b, '2bbbbbbb-2222-2222-2222-222222222222', 'parent_admin'),
  (:acct_c, '2ccccccc-3333-3333-3333-333333333333', 'parent_admin'),
  (:acct_b, '2ddddddd-4444-4444-4444-444444444444', 'single');

insert into public.member_state (user_id, active_account_id) values
  ('2a111111-1111-1111-1111-111111111111', :acct_a),
  ('2bbbbbbb-2222-2222-2222-222222222222', :acct_b),
  ('2ccccccc-3333-3333-3333-333333333333', :acct_c),
  ('2ddddddd-4444-4444-4444-444444444444', :acct_b)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

-- The granted single and its SIBLING, both in the proposer household A.
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Granted', 'Single') returning id as single_a \gset
insert into ids values ('single_a', :single_a);

insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Sibling', 'Single') returning id as single_sibling \gset
insert into ids values ('single_sibling', :single_sibling);

-- The proposer's shidduch row for the granted single. The suggestion-resume
-- below hangs off this row via shidduchim_id.
insert into public.shidduchim
  (account_id, single_id, name_en, visibility, pipeline_state)
values
  (:acct_a, :single_a, 'Granted Shidduch', 'shared', 'look_into')
returning id as shidduch_a \gset

insert into ids values ('shidduch_a', :shidduch_a);

-- The three resume fixtures. `resumes_owner_check` enforces exactly one of
-- shidduchim_id/single_id on each row (XOR), so:
--   resume_suggestion -> single_a's resume on his shidduch (shidduchim_id branch)
--   resume_outbound   -> single_a's OWN outbound resume (single_id branch)
--   resume_sibling    -> single_sibling's resume (single_id branch) — the
--                        sibling-leak fixture, NOT named in the grant.
insert into public.resumes (account_id, shidduchim_id, single_id, sections)
values (:acct_a, :shidduch_a, null, '{"branch":"shidduchim"}')
returning id as resume_suggestion \gset
insert into ids values ('resume_suggestion', :resume_suggestion);

insert into public.resumes (account_id, shidduchim_id, single_id, sections)
values (:acct_a, null, :single_a, '{"branch":"single"}')
returning id as resume_outbound \gset
insert into ids values ('resume_outbound', :resume_outbound);

insert into public.resumes (account_id, shidduchim_id, single_id, sections)
values (:acct_a, null, :single_sibling, '{"branch":"sibling"}')
returning id as resume_sibling \gset
insert into ids values ('resume_sibling', :resume_sibling);

-- One grant, driven through its true lifecycle in this test, targeting ONLY
-- single_a (never the sibling). grantee_account_id stays POPULATED from the
-- first insert onward — the leak-prone shape the status='accepted' conjunct
-- exists to close.
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id)
values
  (:acct_a, :single_a, 'cgr-test-hash', 'pending', now() + interval '30 days', :acct_b)
returning id as grant_row \gset

insert into ids values ('grant_row', :grant_row);

-- ---------------------------------------------------------------------------
-- (a) NEGATIVE: an unrelated household (no grant at all) sees zero rows for
-- BOTH of single_a's resumes — the shidduchim_id-branch one and the
-- single_id-branch one.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"2ccccccc-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed, detail)
select 'stranger sees zero rows for the shidduchim_id-branch resume of the target single',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.resumes
where id = (select v from ids where k = 'resume_suggestion');

insert into results (name, passed, detail)
select 'stranger sees zero rows for the single_id-branch resume of the target single',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.resumes
where id = (select v from ids where k = 'resume_outbound');

reset role;

-- ---------------------------------------------------------------------------
-- (b) NEGATIVE: a grant that exists but is NOT yet 'accepted' grants nothing.
-- grantee_account_id is populated the whole time, so a pending status must
-- still return zero rows for both branches.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"2bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'grantee sees nothing for the shidduchim_id-branch resume while the grant is pending',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.resumes
where id = (select v from ids where k = 'resume_suggestion');

insert into results (name, passed, detail)
select 'grantee sees nothing for the single_id-branch resume while the grant is pending',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.resumes
where id = (select v from ids where k = 'resume_outbound');

reset role;

-- ---------------------------------------------------------------------------
-- Accept the grant (simulates accept_child_grant(): status='accepted', the
-- grantee_account_id already populated). Now (c), (d) and (e) can be
-- exercised against a LIVE accepted grant.
-- ---------------------------------------------------------------------------
update public.child_grants
set status = 'accepted', accepted_at = now()
where id = (select v from ids where k = 'grant_row');

-- ---------------------------------------------------------------------------
-- (c) POSITIVE: the accepted grantee (parent_admin, the owning role) sees BOTH
-- of single_a's resumes — both branches of the policy's OR.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"2bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'accepted grantee reads the shidduchim_id-branch resume by id',
       count(*) = 1,
       format('rows = %s (expected 1)', count(*))
from public.resumes
where id = (select v from ids where k = 'resume_suggestion');

insert into results (name, passed, detail)
select 'accepted grantee reads the single_id-branch resume by id',
       count(*) = 1,
       format('rows = %s (expected 1)', count(*))
from public.resumes
where id = (select v from ids where k = 'resume_outbound');

-- ---------------------------------------------------------------------------
-- (d) THE SIBLING-LEAK ASSERTION (the whole reason for this increment): the
-- SAME accepted grantee, whose grant names ONLY single_a, sees ZERO rows for
-- single_sibling's resume — even though single_sibling is in the SAME proposer
-- household A. Proves the join is pinned to the exact granted single_id, not
-- to account_id (a household-wide widening would leak this row).
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'accepted grantee still sees zero rows for the SIBLING single resume (pinned to single_id, not account_id)',
       count(*) = 0,
       format('rows = %s (expected 0 — the grant is for single_a only, not the household)', count(*))
from public.resumes
where id = (select v from ids where k = 'resume_sibling');

-- ---------------------------------------------------------------------------
-- (e) NEGATIVE: a single-role member of the ACCEPTED grantee's OWN household
-- still sees zero rows for single_a's resumes — the grant opens read for the
-- household, not for its own single-persona members.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"2ddddddd-4444-4444-4444-444444444444","role":"authenticated"}';

insert into results (name, passed, detail)
select 'a single-role member of the grantee household sees zero shidduchim_id-branch resumes',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.resumes
where id = (select v from ids where k = 'resume_suggestion');

insert into results (name, passed, detail)
select 'a single-role member of the grantee household sees zero single_id-branch resumes',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.resumes
where id = (select v from ids where k = 'resume_outbound');

reset role;

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail))
from results;