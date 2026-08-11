--
-- Standing guard: consuming an ACCEPTED child grant to read `public.singles`
-- via a cross-household SELECT — database suite.
--
-- WHY IT EXISTS. For every prior increment of recorded history, NO RLS policy
-- anywhere consulted a `child_grants` row to open read access — accepting a
-- grant granted nothing. This suite pins the FIRST consuming policy
-- ("Singles readable via accepted grant", 05_policies.sql): a grantee
-- household that has accepted a grant for a proposer's single may SELECT
-- exactly that single's row, and nothing less, through no other status.
--
-- The security-critical statuses are each asserted separately. The
-- `status = 'accepted'` conjunct must be LITERAL and cannot be inferred from
-- `grantee_account_id` being non-null: sever_child_grant() (02_functions.sql)
-- flips status to 'severed' but never NULLs grantee_account_id, so a policy
-- keyed on the id column alone would keep a severed grant leak-open. Every
-- non-accepted fixture below therefore carries a POPULATED grantee_account_id
-- — the exact leak-prone shape — yet must still yield zero rows.
--
-- (c) matters as a boundary too: the grant opens read for the grantee
-- HOUSEHOLD's owning members, not for that household's own single-persona
-- members. Without the `current_member_role() <> 'single'` conjunct, the
-- grantee household's own single would suddenly see a record that was never
-- theirs. The suite pins that read-only-structural boundary.
--
-- Status mutations are done as postgres (the connection's superuser) between
-- the caller-specific query blocks: `child_grants` withholds every write from
-- `authenticated` (06_grants.sql, SELECT-only by design), so the lifecycle
-- transitions belong in the arrange phase, exactly as child_grants_visibility
-- .sql seeds its grants as postgres. The grant is driven through its true
-- lifecycle (pending -> revoked -> expired -> accepted -> severed) so the
-- severed case is proven by accepting-then-severing, never by seeding a grant
-- that starts as 'severed'.
--
-- The runner is child_grant_singles_access.test.ts.
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
-- inside B (to pin the read-only-structural boundary in (c)).
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('1a111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgs-proposer@test.local'),
  ('1bbbbbbb-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgs-grantee@test.local'),
  ('1ccccc33-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgs-stranger@test.local'),
  ('1dddd444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgs-grantee-single@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('CGS Proposer') returning id as acct_a \gset
insert into public.accounts (name) values ('CGS Grantee') returning id as acct_b \gset
insert into public.accounts (name) values ('CGS Stranger') returning id as acct_c \gset

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

-- One grant, driven through its true lifecycle in this test. grantee_account_id
-- stays POPULATED from the first insert onward — the leak-prone shape the
-- status='accepted' conjunct exists to close — so no assertion ever depends on
-- the id column accidentally being null.
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id)
values
  (:acct_a, :single_a, 'cgs-test-hash', 'pending', now() + interval '30 days', :acct_b)
returning id as grant_row \gset

insert into ids values ('grant_row', :grant_row);

-- ---------------------------------------------------------------------------
-- (a) NEGATIVE: an unrelated household (no grant at all) cannot select the
-- target single's row — by id, or in a list scan.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1ccccc33-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed, detail)
select 'stranger cannot read the target single by id',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.singles
where id = (select v from ids where k = 'single_a');

insert into results (name, passed, detail)
select 'stranger sees zero singles in a list scan',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.singles;

reset role;

-- ---------------------------------------------------------------------------
-- (b) NEGATIVE: a grant that exists but is NOT 'accepted' grants nothing.
-- grantee_account_id is populated the whole time, so any status except
-- 'accepted' must still return zero. Each status is a separate assertion,
-- with the status transition performed as postgres in the arrange phase
-- between query blocks.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'grantee sees nothing while the grant is pending (status not accepted)',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.singles
where id = (select v from ids where k = 'single_a');

reset role;

-- Pending -> revoked.
update public.child_grants set status = 'revoked' where id = (select v from ids where k = 'grant_row');

set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'grantee sees nothing while the grant is revoked',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.singles
where id = (select v from ids where k = 'single_a');

reset role;

-- Revoked -> expired.
update public.child_grants set status = 'expired' where id = (select v from ids where k = 'grant_row');

set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'grantee sees nothing while the grant is expired',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.singles
where id = (select v from ids where k = 'single_a');

reset role;

-- ---------------------------------------------------------------------------
-- Accept the grant (simulates accept_child_grant(): status='accepted', the
-- grantee_account_id already populated). Now (d) the positive case and (c)
-- the single-role boundary can be exercised against a LIVE accepted grant.
-- ---------------------------------------------------------------------------
update public.child_grants
set status = 'accepted', accepted_at = now()
where id = (select v from ids where k = 'grant_row');

-- ---------------------------------------------------------------------------
-- (d) POSITIVE: the accepted grantee (parent_admin, the owning role) sees the
-- target single by id and in a list scan.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'accepted grantee reads the target single by id',
       count(*) = 1,
       format('rows = %s (expected 1)', count(*))
from public.singles
where id = (select v from ids where k = 'single_a');

insert into results (name, passed, detail)
select 'accepted grantee sees the target single in a list scan',
       count(*) = 1,
       format('rows = %s (expected exactly the one granted single)', count(*))
from public.singles;

reset role;

-- ---------------------------------------------------------------------------
-- (c) NEGATIVE: a single-role member of the ACCEPTED grantee's OWN household
-- still sees zero rows for the target single — the grant opens read for the
-- household, not for its own single-persona members.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1dddd444-4444-4444-4444-444444444444","role":"authenticated"}';

insert into results (name, passed, detail)
select 'a single-role member of the grantee household still sees zero by id',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.singles
where id = (select v from ids where k = 'single_a');

insert into results (name, passed, detail)
select 'a single-role member of the grantee household sees no granted single in a list',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.singles;

reset role;

-- ---------------------------------------------------------------------------
-- (b, severed) The sever path: take the very grant accepted above and sever it
-- with the real state change sever_child_grant() makes — status='severed',
-- grantee_account_id STILL populated. Re-querying as the grantee must now
-- return zero rows. This is the exact leak a policy keyed on grantee_account_id
-- alone would leave open.
-- ---------------------------------------------------------------------------
update public.child_grants
set status = 'severed', severed_at = now()
where id = (select v from ids where k = 'grant_row');

set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'severed grant (accepted then severed, grantee_account_id still set) grants nothing',
       count(*) = 0,
       format('rows = %s (expected 0 — severed must not leak)', count(*))
from public.singles
where id = (select v from ids where k = 'single_a');

reset role;

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail))
from results;