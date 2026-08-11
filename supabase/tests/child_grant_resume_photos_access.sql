--
-- Standing guard: consuming an ACCEPTED child grant to read
-- `public.resume_photos` via a cross-household SELECT — database suite.
--
-- WHY IT EXISTS. Increment 4 (child_grant_resumes_access.sql) pinned the
-- matching policy on `public.resumes`. This suite pins the FIFTH: the
-- matching policy on `public.resume_photos` ("Resume photos readable via
-- accepted grant", 05_policies.sql) — a grantee household that has accepted
-- a grant for a proposer's single may SELECT that single's shared photos,
-- and rows seen through exactly that path, and no other rows.
--
-- THE TARGETED HISTORY. This specific table already leaked a sibling's
-- photo ONCE (real incident): an earlier, looser version of the household
-- policy "Resume photos scoped to account, single sees only own shared"
-- checked visibility ACCOUNT-WIDE, so a `single`-role caller could read any
-- shared photo in the household, including a SIBLING's. It was fixed by
-- re-deriving the exact "is this resume mine" join `resumes`' own policy
-- uses. THIS suite proves the grant-consuming policy does not reintroduce
-- that same bug, mirrored onto the GRANTEE axis: assertion (c) proves the
-- grant join is pinned to the exact RESOLVED single_id, never to the
-- proposer's `account_id`. Without that pinning — if the join matched on
-- `r.account_id = <proposer>` instead of the two `single_id` branches — an
-- accepted grantee would suddenly read every OTHER single's shared photo in
-- the same proposer household, not just the granted one's.
--
-- Assertions:
--   (a) an unrelated household (no grant at all) sees zero resume_photos
--       rows for the granted single's photo.
--   (b) the ACCEPTED grantee reads the granted single's SHARED photo.
--   (c) THE SIBLING-LEAK ASSERTION: the SAME accepted grantee — whose grant
--       names ONLY the granted single — sees ZERO resume_photos rows for a
--       second, SIBLING single's photo, even though both singles share the
--       SAME proposer account_id. This reproduces, on the grantee axis, the
--       exact shape of the table's real historical leak.
--   (d) a single-role member of the ACCEPTED GRANTEE's OWN household still
--       sees zero resume_photos rows for the granted single — the grant
--       opens read for the household's owning members, not its own
--       single-persona members (the read-only-structural boundary every
--       prior increment preserves).
--   (e) a `private_parent` photo on the granted single's resume is NOT
--       visible to the accepted grantee even though the grant would
--       otherwise apply: `visibility` is constrained to 'shared' or
--       'private_parent' (resume_photos_visibility_check, 01_tables.sql), so
--       a non-shared value is representable and must stay outside the grant
--       — a grantee must not see MORE than the household's own single would.
--
-- Status mutations are done as postgres (the connection's superuser)
-- between the caller-specific query blocks: `child_grants` withholds every
-- write from `authenticated` (06_grants.sql, SELECT-only by design), so the
-- lifecycle transitions belong in the arrange phase. The grant is driven
-- pending -> accepted as a real lifecycle, and grantee_account_id stays
-- POPULATED the whole time (the leak-prone shape the status='accepted'
-- conjunct is what closes — see increment 1's header).
--
-- The runner is child_grant_resume_photos_access.test.ts.
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
-- `single_sibling` whose photo must stay invisible to the grantee (c).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('2a111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgprp-proposer@test.local'),
  ('2bbbbbbb-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgprp-grantee@test.local'),
  ('2ccccccc-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgprp-stranger@test.local'),
  ('2ddddddd-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgprp-grantee-single@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('CGPRP Proposer') returning id as acct_a \gset
insert into public.accounts (name) values ('CGPRP Grantee') returning id as acct_b \gset
insert into public.accounts (name) values ('CGPRP Stranger') returning id as acct_c \gset

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

-- A shidduch for the granted single, so the shidduchim_id branch of the
-- policy can be exercised on a suggestion-resume/fl... photo too. The
-- sibling stays on its plain single_id-branch resume — the shape that is
-- the historical leak: same proposer account_id, different single_id.
insert into public.shidduchim
  (account_id, single_id, name_en, visibility, pipeline_state)
values
  (:acct_a, :single_a, 'Granted Shidduch', 'shared', 'look_into')
returning id as shidduch_a \gset

insert into ids values ('shidduch_a', :shidduch_a);

-- Two resumes: single_a's on-his-own outbound resume (single_id branch) and
-- single_sibling's own outbound resume (single_id branch). `resumes_owner_check`
-- enforces exactly one of shidduchim_id/single_id per row (XOR).
insert into public.resumes (account_id, shidduchim_id, single_id, sections)
values (:acct_a, null, :single_a, '{"branch":"single"}')
returning id as resume_a \gset
insert into ids values ('resume_a', :resume_a);

insert into public.resumes (account_id, shidduchim_id, single_id, sections)
values (:acct_a, null, :single_sibling, '{"branch":"sibling"}')
returning id as resume_sibling \gset
insert into ids values ('resume_sibling', :resume_sibling);

-- The resume_photos fixtures. `visibility` is constrained to 'shared' or
-- 'private_parent' (resume_photos_visibility_check), and the path must be
-- prefixed by the row's own account_id (resume_photos_storage_path_scope_check).
--   photo_a       -> single_a's outbound resume, visibility 'shared'
--                    (the positive case for the accepted grantee).
--   photo_sibling -> single_sibling's outbound resume, visibility 'shared',
--                    NOT named in the grant — the sibling-leak fixture (c).
--   photo_a_priv  -> single_a's outbound resume, visibility 'private_parent'
--                    — assertion (e): the grant cannot outrank visibility.
insert into public.resume_photos (account_id, resume_id, path, visibility)
values (:acct_a, :resume_a, :'acct_a' || '/photos/shared/resume_a/photo.jpg', 'shared')
returning id as photo_a \gset
insert into ids values ('photo_a', :photo_a);

insert into public.resume_photos (account_id, resume_id, path, visibility)
values (:acct_a, :resume_sibling, :'acct_a' || '/photos/shared/resume_sibling/photo.jpg', 'shared')
returning id as photo_sibling \gset
insert into ids values ('photo_sibling', :photo_sibling);

insert into public.resume_photos (account_id, resume_id, path, visibility)
values (:acct_a, :resume_a, :'acct_a' || '/photos/private_parent/resume_a/photo.jpg', 'private_parent')
returning id as photo_a_priv \gset
insert into ids values ('photo_a_priv', :photo_a_priv);

-- One grant, driven through its true lifecycle in this test, targeting ONLY
-- single_a (never the sibling, and never single_sibling's photo). 
-- grantee_account_id stays POPULATED from the first insert onward — the
-- leak-prone shape the status='accepted' conjunct exists to close.
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id)
values
  (:acct_a, :single_a, 'cgprp-test-hash', 'pending', now() + interval '30 days', :acct_b)
returning id as grant_row \gset

insert into ids values ('grant_row', :grant_row);

-- ---------------------------------------------------------------------------
-- (a) NEGATIVE: an unrelated household (no grant at all) sees zero rows for
-- BOTH of single_a's photos — the shared one and the private_parent one.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"2ccccccc-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed, detail)
select 'stranger sees zero rows for the granted single''s shared photo',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.resume_photos
where id = (select v from ids where k = 'photo_a');

insert into results (name, passed, detail)
select 'stranger sees zero rows for the granted single''s private_parent photo',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.resume_photos
where id = (select v from ids where k = 'photo_a_priv');

reset role;

-- ---------------------------------------------------------------------------
-- (b) NEGATIVE: a grant that exists but is NOT yet 'accepted' grants nothing.
-- grantee_account_id is populated the whole time, so a pending status must
-- still return zero rows for the granted single's photo.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"2bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'grantee sees nothing for the granted single''s shared photo while the grant is pending',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.resume_photos
where id = (select v from ids where k = 'photo_a');

reset role;

-- ---------------------------------------------------------------------------
-- Accept the grant (simulates accept_child_grant(): status='accepted', the
-- grantee_account_id already populated). Now (b)-positive, (c), (d) and (e)
-- can be exercised against a LIVE accepted grant.
-- ---------------------------------------------------------------------------
update public.child_grants
set status = 'accepted', accepted_at = now()
where id = (select v from ids where k = 'grant_row');

-- ---------------------------------------------------------------------------
-- (b) POSITIVE: the accepted grantee (parent_admin, the owning role) reads
-- the granted single's SHARED photo.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"2bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'accepted grantee reads the granted single''s shared resume_photos row',
       count(*) = 1,
       format('rows = %s (expected 1)', count(*))
from public.resume_photos
where id = (select v from ids where k = 'photo_a');

-- ---------------------------------------------------------------------------
-- (c) THE SIBLING-LEAK ASSERTION (the whole reason for this increment): the
-- SAME accepted grantee, whose grant names ONLY single_a, sees ZERO rows for
-- single_sibling's photo — even though single_sibling is in the SAME proposer
-- household A, sharing the SAME account_id. Proves the join is pinned to the
-- exact granted single_id, not to account_id: the exact bug this table
-- already leaked once on the single axis, now proven closed on the grantee
-- axis. A household-wide (account_id) join would leak this row.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'accepted grantee still sees zero rows for the SIBLING single''s photo (pinned to single_id, not account_id)',
       count(*) = 0,
       format('rows = %s (expected 0 — the grant is for single_a only, not the household)', count(*))
from public.resume_photos
where id = (select v from ids where k = 'photo_sibling');

-- ---------------------------------------------------------------------------
-- (e) NEGATIVE: a `private_parent` photo on the granted single's resume is
-- NOT visible to the accepted grantee, even though the grant itself names
-- single_a (whose outbound resume owns this photo). The `visibility =
-- 'shared'` conjunct mirrors what the household policy already requires of a
-- `single` caller: a grantee must not see MORE than the household's own
-- single would. `resume_photos_visibility_check` allows 'private_parent', so
-- this assertion is real and expressible.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'accepted grantee sees zero rows for the granted single''s private_parent photo',
       count(*) = 0,
       format('rows = %s (expected 0 — visibility must stay shared even under a grant)', count(*))
from public.resume_photos
where id = (select v from ids where k = 'photo_a_priv');

-- ---------------------------------------------------------------------------
-- (d) NEGATIVE: a single-role member of the ACCEPTED grantee's OWN household
-- still sees zero rows for the granted single's photo — the grant opens read
-- for the household, not for its own single-persona members.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"2ddddddd-4444-4444-4444-444444444444","role":"authenticated"}';

insert into results (name, passed, detail)
select 'a single-role member of the grantee household sees zero of the granted single''s photos',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.resume_photos
where id = (select v from ids where k = 'photo_a');

reset role;

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail))
from results;