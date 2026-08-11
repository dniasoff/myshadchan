--
-- Standing guard: consuming an ACCEPTED child grant to read `public.listings`
-- via a cross-household SELECT — database suite.
--
-- WHY IT EXISTS. This is RLS increment 9 of the child_grants plan (Epic 14):
-- a grantee household that has accepted a grant for a proposer's single may
-- SELECT that single's listing row(s) through the policy "Listings readable
-- via accepted grant" (05_policies.sql). `listings` is unusual among the
-- grant-consuming increments in already being fully readable by `anon`
-- ("Listings readable by anon", AD-21) — but that policy is `to anon` only,
-- and Postgres RLS is role-scoped, so it does nothing for an `authenticated`
-- grantee. This suite pins the gap this increment closes: an authenticated,
-- accepted grantee reads exactly the granted single's listing row(s), and
-- nothing more, through no other grant status and no unrelated single.
--
-- listings.single_id is a DIRECT column (unlike shidduch_education/redts,
-- which only carry shidduchim_id and resolve it via shidduch_single_id()).
-- Assertion (e) is this increment's edge case: a `shadchan`-type listing
-- always carries single_id = NULL (listings_single_id_presence,
-- 01_tables.sql); the policy's `g.target_single_id = listings.single_id`
-- comparison must NOT error and must NOT falsely match such a row, even
-- when the grantee holds a live accepted grant against the same proposer
-- account that owns the shadchan listing.
--
-- The `status = 'accepted'` conjunct is LITERAL: sever_child_grant()
-- (02_functions.sql) sets status = 'severed' but never NULLs
-- grantee_account_id, so keying on the id column alone would leak. The
-- non-accepted fixtures below (pending, revoked) each carry a POPULATED
-- grantee_account_id — the exact leak-prone shape.
--
-- (f) pins the read-only-structural boundary mirrored on every prior
-- increment: the grant opens read for the grantee HOUSEHOLD's owning
-- members, not for that household's own single-persona members.
--
-- The runner is child_grant_listings_access.test.ts.
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
-- Arrange: a proposing household (A) that grants ONE of its two singles to a
-- receiving household (B), plus an unrelated household (C) and a
-- single-role member inside B (to pin the read-only-structural boundary in
-- (f)). A owns three listings: the granted single's, a SECOND, non-granted
-- single's (for the "different single" assertion (d)), and a shadchan-type
-- listing with single_id = NULL (for the null-single-id assertion (e)).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('1a111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgl-proposer@test.local'),
  ('1bbbbbbb-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgl-grantee@test.local'),
  ('1ccccc33-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgl-stranger@test.local'),
  ('1dddd444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgl-grantee-single@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('CGL Proposer') returning id as acct_a \gset
insert into public.accounts (name) values ('CGL Grantee') returning id as acct_b \gset
insert into public.accounts (name) values ('CGL Stranger') returning id as acct_c \gset

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

insert into ids values ('acct_a', :acct_a);

insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Granted', 'Single') returning id as single_a \gset

insert into ids values ('single_a', :single_a);

-- A second single under the SAME proposer account, deliberately NOT granted
-- — assertion (d) proves the grant scopes to its own target_single_id, not
-- to "any single belonging to an account the grantee has SOME accepted
-- grant with".
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Other', 'Single') returning id as single_other \gset

insert into ids values ('single_other', :single_other);

insert into public.listings (account_id, listing_type, single_id, single_first_name_en)
values (:acct_a, 'single', :single_a, 'Granted')
returning id as listing_granted \gset

insert into ids values ('listing_granted', :listing_granted);

insert into public.listings (account_id, listing_type, single_id, single_first_name_en)
values (:acct_a, 'single', :single_other, 'Other')
returning id as listing_other \gset

insert into ids values ('listing_other', :listing_other);

-- A shadchan-type listing: single_id is always NULL for this branch
-- (listings_single_id_presence, 01_tables.sql). Assertion (e) proves this
-- row is never matched by the grant policy, even for an account that has a
-- live accepted grant with the grantee.
insert into public.listings (account_id, listing_type, shadchan_name)
values (:acct_a, 'shadchan', 'CGL Test Shadchan')
returning id as listing_shadchan \gset

insert into ids values ('listing_shadchan', :listing_shadchan);

-- One grant, driven through its true lifecycle in this test. grantee_account_id
-- stays POPULATED from the first insert onward — the leak-prone shape the
-- status='accepted' conjunct exists to close — so no assertion ever depends on
-- the id column accidentally being null.
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id)
values
  (:acct_a, :single_a, 'cgl-test-hash', 'pending', now() + interval '30 days', :acct_b)
returning id as grant_row \gset

insert into ids values ('grant_row', :grant_row);

-- ---------------------------------------------------------------------------
-- (a) NEGATIVE: an unrelated household (no grant at all) cannot select the
-- granted single's listing — by id, or in a list scan.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1ccccc33-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed, detail)
select 'stranger cannot read the granted listing by id',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.listings
where id = (select v from ids where k = 'listing_granted');

insert into results (name, passed, detail)
select 'stranger sees zero listings in a list scan',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.listings;

reset role;

-- ---------------------------------------------------------------------------
-- (b) NEGATIVE: a grant that exists but is NOT yet 'accepted' (pending)
-- grants nothing. grantee_account_id is populated the whole time.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'grantee sees nothing for the granted listing while the grant is pending',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.listings
where id = (select v from ids where k = 'listing_granted');

reset role;

-- Pending -> revoked.
update public.child_grants set status = 'revoked' where id = (select v from ids where k = 'grant_row');

-- ---------------------------------------------------------------------------
-- (c) NEGATIVE: a revoked grant grants nothing either.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'grantee sees nothing for the granted listing while the grant is revoked',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.listings
where id = (select v from ids where k = 'listing_granted');

reset role;

-- ---------------------------------------------------------------------------
-- Accept the grant (simulates accept_child_grant(): status='accepted', the
-- grantee_account_id already populated). Now (d)/(e)/(f) can be exercised
-- against a LIVE accepted grant.
-- ---------------------------------------------------------------------------
update public.child_grants
set status = 'accepted', accepted_at = now()
where id = (select v from ids where k = 'grant_row');

-- ---------------------------------------------------------------------------
-- (d) POSITIVE: the accepted grantee (parent_admin, the owning role) reads
-- the granted single's listing by id, and sees exactly that one row (not the
-- proposer's other, non-granted single's listing, and not the proposer's
-- shadchan-type listing) in a list scan over the whole proposer account.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'accepted grantee reads the granted listing by id',
       count(*) = 1,
       format('rows = %s (expected 1)', count(*))
from public.listings
where id = (select v from ids where k = 'listing_granted');

insert into results (name, passed, detail)
select 'accepted grantee sees exactly the granted listing in a list scan of the proposer account',
       count(*) = 1 and bool_and(id = (select v from ids where k = 'listing_granted')),
       format('rows = %s (expected exactly the one granted listing, none other)', count(*))
from public.listings
where account_id = (select v from ids where k = 'acct_a');

-- ---------------------------------------------------------------------------
-- (e) NEGATIVE: the SAME accepted grantee cannot read the proposer's OTHER,
-- non-granted single's listing — the grant is scoped to its own
-- target_single_id, not to "any single belonging to this proposer account".
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'accepted grantee cannot read the proposer''s other, non-granted single''s listing',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.listings
where id = (select v from ids where k = 'listing_other');

-- ---------------------------------------------------------------------------
-- (f) NEGATIVE (this increment's edge case): the SAME accepted grantee
-- cannot read the proposer's shadchan-type listing, whose single_id is NULL
-- by construction. `g.target_single_id = listings.single_id` must evaluate
-- to NULL (not TRUE) when single_id is NULL, so `exists(...)` finds no row
-- — this pins that the comparison does not error and does not falsely match.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'accepted grantee cannot read the proposer''s shadchan-type listing (single_id is null)',
       count(*) = 0,
       format('rows = %s (expected 0 — a null single_id must never match)', count(*))
from public.listings
where id = (select v from ids where k = 'listing_shadchan');

reset role;

-- ---------------------------------------------------------------------------
-- (g) NEGATIVE: a single-role member of the ACCEPTED grantee's OWN household
-- still sees zero rows for the granted listing — the grant opens read for
-- the household, not for its own single-persona members. As an
-- `authenticated` caller this member is also not reached by the anon-only
-- "Listings readable by anon" policy.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1dddd444-4444-4444-4444-444444444444","role":"authenticated"}';

insert into results (name, passed, detail)
select 'a single-role member of the grantee household still sees zero by id',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.listings
where id = (select v from ids where k = 'listing_granted');

insert into results (name, passed, detail)
select 'a single-role member of the grantee household sees no granted listing in a list',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.listings;

reset role;

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail))
from results;
