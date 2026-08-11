--
-- Standing guard: consuming an ACCEPTED child grant to read `public.shidduchim`
-- via a cross-household SELECT — database suite.
--
-- WHY IT EXISTS. Increment 1 (child_grant_singles_access.sql) pinned the FIRST
-- consuming RLS policy, on `public.singles`. This suite pins the SECOND: the
-- matching policy on `public.shidduchim` ("Shidduchim readable via accepted
-- grant", 05_policies.sql) — a grantee household that has accepted a grant for
-- a proposer's single may SELECT that single's shidduchim rows, and rows seen
-- through exactly that path, through no other status.
--
-- The security-critical statuses are each asserted separately. The
-- `status = 'accepted'` conjunct must be LITERAL and cannot be inferred from
-- `grantee_account_id` being non-null: sever_child_grant() (02_functions.sql)
-- flips status to 'severed' but never NULLs grantee_account_id, so a policy
-- keyed on the id column alone would keep a severed grant leak-open. Every
-- non-accepted fixture below therefore carries a POPULATED grantee_account_id
-- — the exact leak-prone shape — yet must still yield zero rows.
--
-- (d) matters as a boundary too: the grant opens read for the grantee
-- HOUSEHOLD's owning members, not for that household's own single-persona
-- members. Without the `current_member_role() <> 'single'` conjunct, the
-- grantee household's own single would suddenly see a record that was never
-- theirs. The suite pins that read-only-structural boundary.
--
-- (e) pins fail-closed column behavior this increment DELIBERATELY preserves:
-- `close_reason` is omitted from public.shidduchim's column-by-column SELECT
-- grant (06_grants.sql), so the only reader is the SECURITY DEFINER
-- shidduch_close_reason(), whose guard is `s.account_id =
-- current_context_id()` — the PROPOSER's account. An ACCEPTED GRANTEE's
-- current_context_id() is the GRANTEE's account, distinct from the shidduch's
-- account_id, so that function returns NULL to them today and must keep doing
-- so. The create-close_reason value is set in the arrange phase so a leak would
-- be detectable; asserting NULL here documents the intentional fail-closed
-- default, not something to fix.
--
-- Status mutations are done as postgres (the connection's superuser) between
-- the caller-specific query blocks: `child_grants` withholds every write from
-- `authenticated` (06_grants.sql, SELECT-only by design), so the lifecycle
-- transitions belong in the arrange phase, exactly as child_grant_singles
-- _access.sql seeds its grants as postgres. The grant is driven pending ->
-- accepted so the pending-then-accepted proof is a real lifecycle, not two
-- hand-authored rows.
--
-- The runner is child_grant_shidduchim_access.test.ts.
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
  ('1a111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgsd-proposer@test.local'),
  ('1bbbbbbb-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgsd-grantee@test.local'),
  ('1ccccc33-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgsd-stranger@test.local'),
  ('1dddd444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgsd-grantee-single@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('CGSD Proposer') returning id as acct_a \gset
insert into public.accounts (name) values ('CGSD Grantee') returning id as acct_b \gset
insert into public.accounts (name) values ('CGSD Stranger') returning id as acct_c \gset

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

-- The proposer's shidduch row for the granted single, set up with a NON-NULL
-- close_reason so (e) can prove an accepted grantee still reads NULL even
-- though the underlying value is present (NULL close_reason here would make
-- that assertion pass vacuously either way).
insert into public.shidduchim
  (account_id, single_id, name_en, visibility, pipeline_state, close_reason)
values
  (:acct_a, :single_a, 'Granted Shidduch', 'shared', 'look_into', 'CANDID PROPOSER DECISION')
returning id as shidduch_a \gset

insert into ids values ('shidduch_a', :shidduch_a);

-- One grant, driven through its true lifecycle in this test. grantee_account_id
-- stays POPULATED from the first insert onward — the leak-prone shape the
-- status='accepted' conjunct exists to close — so no assertion ever depends on
-- the id column accidentally being null.
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id)
values
  (:acct_a, :single_a, 'cgsd-test-hash', 'pending', now() + interval '30 days', :acct_b)
returning id as grant_row \gset

insert into ids values ('grant_row', :grant_row);

-- ---------------------------------------------------------------------------
-- (a) NEGATIVE: an unrelated household (no grant at all) cannot select the
-- target single's shidduch row — by id, or in a list scan.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1ccccc33-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed, detail)
select 'stranger cannot read the target shidduch by id',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.shidduchim
where id = (select v from ids where k = 'shidduch_a');

insert into results (name, passed, detail)
select 'stranger sees zero shidduchim rows for the target single in a list scan',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.shidduchim
where single_id = (select v from ids where k = 'single_a');

reset role;

-- ---------------------------------------------------------------------------
-- (b) NEGATIVE: a grant that exists but is NOT yet 'accepted' grants nothing.
-- grantee_account_id is populated the whole time, so a pending status must
-- still return zero.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'grantee sees nothing for the target single while the grant is pending (status not accepted)',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.shidduchim
where single_id = (select v from ids where k = 'single_a');

reset role;

-- ---------------------------------------------------------------------------
-- Accept the grant (simulates accept_child_grant(): status='accepted', the
-- grantee_account_id already populated). Now (c) the positive case and (d)
-- the single-role boundary can be exercised against a LIVE accepted grant.
-- ---------------------------------------------------------------------------
update public.child_grants
set status = 'accepted', accepted_at = now()
where id = (select v from ids where k = 'grant_row');

-- ---------------------------------------------------------------------------
-- (c) POSITIVE: the accepted grantee (parent_admin, the owning role) sees the
-- target shidduch by id and in a list scan over the granted single.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'accepted grantee reads the target shidduch by id',
       count(*) = 1,
       format('rows = %s (expected 1)', count(*))
from public.shidduchim
where id = (select v from ids where k = 'shidduch_a');

insert into results (name, passed, detail)
select 'accepted grantee sees the target shidduch for the granted single in a list scan',
       count(*) = 1,
       format('rows = %s (expected exactly the one granted single)', count(*))
from public.shidduchim
where single_id = (select v from ids where k = 'single_a');

-- ---------------------------------------------------------------------------
-- (d) NEGATIVE: a single-role member of the ACCEPTED grantee's OWN household
-- still sees zero shidduchim rows for the granted single — the grant opens
-- read for the household, not for its own single-persona members.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1dddd444-4444-4444-4444-444444444444","role":"authenticated"}';

insert into results (name, passed, detail)
select 'a single-role member of the grantee household still sees zero by id',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.shidduchim
where id = (select v from ids where k = 'shidduch_a');

insert into results (name, passed, detail)
select 'a single-role member of the grantee household sees no granted shidduch in a list',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.shidduchim
where single_id = (select v from ids where k = 'single_a');

reset role;

-- ---------------------------------------------------------------------------
-- (e) CLOSE_REASON documentation assertion — must run LAST, after (c) proved
-- the row is visible to this grantee. The SAME accepted grantee asks the SECURITY
-- DEFINER shidduch_close_reason() for the shidduch's close_reason and must get
-- NULL, not the 'CANDID PROPOSER DECISION' value set in the arrange phase:
-- that function's guard is proposer-account-scoped, and an accepted grantee is
-- a different account. This is INTENTIONAL fail-closed behavior to preserve,
-- not a bug to fix — see the header comment.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'shidduch_close_reason() stays NULL for the accepted grantee (fail-closed, proposer-scoped)',
       count(*) = 1,
       format('rows = %s (expected exactly one row returning NULL)', count(*))
from (
    select public.shidduch_close_reason((select v from ids where k = 'shidduch_a')) as reason
) r
where r.reason is null;

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail))
from results;