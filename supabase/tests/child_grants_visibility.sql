--
-- Standing guard: who can SELECT a row of `child_grants` — database suite.
--
-- WHY IT EXISTS. Both of this table's SELECT policies (05_policies.sql) were
-- DEAD from Story 13.1 until 2026-08-11: `authenticated` held no SELECT grant
-- (06_grants.sql never mentioned the table) and privileges are checked before
-- RLS, so every read failed with "permission denied for table child_grants" —
-- including SingleGrantManagement.tsx:281's getList("child_grants"). The write
-- lifecycle kept working throughout, because every write goes through a
-- SECURITY DEFINER RPC, which is exactly why nobody noticed: creating and
-- accepting a grant worked; only listing them did not.
--
-- Adding the grant ACTIVATES the policies, so this suite pins what they let
-- through. The `current_member_role() <> 'single'` conjunct in particular was
-- added in the same change: both policies are ACCOUNT-scoped, so without it a
-- single-role member would read every grant their household had made,
-- including ones about their siblings.
--
-- The positive checks are not padding. "The unrelated household sees zero
-- rows" is also what a table nobody can read returns, and a table nobody could
-- read is the defect this suite was written for — so a run where the positives
-- fail and the negatives pass is the original bug, not a pass.
--
-- The runner is child_grants_visibility.test.ts.
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
-- Arrange: a proposing household (A) that grants one of its singles to a
-- receiving household (B), plus an unrelated household (C) and a single-role
-- member inside A.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cg-proposer@test.local'),
  ('bbbbbbbb-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cg-grantee@test.local'),
  ('cccccccc-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cg-stranger@test.local'),
  ('dddddddd-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cg-single@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('CG Proposer') returning id as acct_a \gset
insert into public.accounts (name) values ('CG Grantee') returning id as acct_b \gset
insert into public.accounts (name) values ('CG Stranger') returning id as acct_c \gset

insert into public.account_members (account_id, user_id, role) values
  (:acct_a, 'aaaaaaaa-1111-1111-1111-111111111111', 'parent_admin'),
  (:acct_b, 'bbbbbbbb-2222-2222-2222-222222222222', 'parent_admin'),
  (:acct_c, 'cccccccc-3333-3333-3333-333333333333', 'parent_admin'),
  (:acct_a, 'dddddddd-4444-4444-4444-444444444444', 'single');

insert into public.member_state (user_id, active_account_id) values
  ('aaaaaaaa-1111-1111-1111-111111111111', :acct_a),
  ('bbbbbbbb-2222-2222-2222-222222222222', :acct_b),
  ('cccccccc-3333-3333-3333-333333333333', :acct_c),
  ('dddddddd-4444-4444-4444-444444444444', :acct_a)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Granted', 'Single') returning id as single_a \gset

-- One ACCEPTED grant (A -> B) and one PENDING grant (A -> C), so the
-- status='accepted' conjunct on the grantee policy is actually exercised
-- rather than assumed.
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id, accepted_at)
values
  (:acct_a, :single_a, 'cg-test-hash-accepted', 'accepted', now() + interval '30 days', :acct_b, now())
returning id as grant_accepted \gset

insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id)
values
  (:acct_a, :single_a, 'cg-test-hash-pending', 'pending', now() + interval '30 days', :acct_c)
returning id as grant_pending \gset

insert into ids values ('grant_accepted', :grant_accepted), ('grant_pending', :grant_pending);

-- ---------------------------------------------------------------------------
-- POSITIVE: the proposer lists its own grants. This is the exact read that
-- SingleGrantManagement.tsx:281 performs, and the one that was failing.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed, detail)
select 'proposer can read its own grants at all (the grant that was missing)',
       count(*) = 2,
       format('grants visible to proposer = %s (expected 2: one accepted, one pending)', count(*))
from public.child_grants;

reset role;

-- ---------------------------------------------------------------------------
-- POSITIVE + NEGATIVE: the grantee sees the ACCEPTED grant and nothing else.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'grantee reads the accepted grant naming it',
       count(*) = 1,
       format('rows = %s (expected exactly the one accepted grant)', count(*))
from public.child_grants
where id = (select v from ids where k = 'grant_accepted');

insert into results (name, passed, detail)
select 'grantee sees ONLY that grant — not the pending one naming a third household',
       count(*) = 1,
       format('total rows visible to grantee = %s (expected 1)', count(*))
from public.child_grants;

reset role;

-- ---------------------------------------------------------------------------
-- NEGATIVE: a household named by a PENDING grant must not see it. The
-- acceptor's only path to a pending grant is preview_child_grant()'s token.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed, detail)
select 'a household named by a PENDING grant cannot read it (token path only)',
       count(*) = 0,
       format('rows visible = %s (expected 0)', count(*))
from public.child_grants;

reset role;

-- ---------------------------------------------------------------------------
-- NEGATIVE: the role guard. A single-role member of the PROPOSING household
-- must not read its grants — they are account-scoped, so without the
-- `<> 'single'` conjunct this member would see grants about their siblings.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-4444-4444-4444-444444444444","role":"authenticated"}';

insert into results (name, passed, detail)
select 'a single-role member of the proposing household reads no grant rows',
       count(*) = 0,
       format('rows visible to the single = %s (expected 0)', count(*))
from public.child_grants;

reset role;

-- ---------------------------------------------------------------------------
-- NEGATIVE: anon.
-- ---------------------------------------------------------------------------
set local role anon;

do $$
declare v_visible int;
begin
  select count(*) into v_visible from public.child_grants;
  insert into results (name, passed, detail)
  values ('anon reads no grant rows', v_visible = 0,
          format('rows visible to anon = %s (expected 0, or a permission error)', v_visible));
exception when insufficient_privilege then
  insert into results (name, passed, detail)
  values ('anon reads no grant rows', true, 'permission denied - fails closed');
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- The write side must stay shut: SELECT is the only grant, every write goes
-- through a SECURITY DEFINER RPC. A future `grant all` would silently undo it.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'authenticated holds SELECT and no DML on child_grants',
       has_table_privilege('authenticated', 'public.child_grants', 'SELECT')
         and not has_table_privilege('authenticated', 'public.child_grants', 'INSERT')
         and not has_table_privilege('authenticated', 'public.child_grants', 'UPDATE')
         and not has_table_privilege('authenticated', 'public.child_grants', 'DELETE'),
       format('select=%s insert=%s update=%s delete=%s',
              has_table_privilege('authenticated', 'public.child_grants', 'SELECT'),
              has_table_privilege('authenticated', 'public.child_grants', 'INSERT'),
              has_table_privilege('authenticated', 'public.child_grants', 'UPDATE'),
              has_table_privilege('authenticated', 'public.child_grants', 'DELETE'));

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail))
from results;
