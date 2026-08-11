--
-- Standing guard: `public.singles_summary.is_shared_with_me` — the computed
-- boolean column a grantee household uses to SEE which of the rows it can read
-- arrived via an accepted child grant. Database suite.
--
-- WHY IT EXISTS. Increment 1 (child_grant_singles_access.sql) pinned the FIRST
-- consuming RLS policy: an accepted grantee may SELECT the grantor's single.
-- This view adds no independent visibility — `security_invoker = on` means the
-- base table's RLS (including increment 1's policy) still decides the row set,
-- and the view only adds a scalar correlated flag on top. So the flag must be
-- right on EVERY row the caller can already see:
--   it is true exactly on rows reachable via an accepted grant (and never on
--   the caller's own rows), and it never causes a row to appear that RLS would
--   otherwise hide.
--
-- The trailing `proposer_account_id <> current_context_id()` guard is load-
-- bearing, not cosmetic: it makes `is_shared_with_me` false BY CONSTRUCTION on
-- a proposer's own single even if that same household happens to be named as
-- both the grantee and the proposer of the very grant.
--
-- Status/lifecycle runs as postgres (the connection's superuser) between the
-- caller-specific query blocks, exactly as child_grant_singles_access.sql
-- drives its grant through its real lifecycle. The runner is
-- child_grant_singles_summary_flag.test.ts.
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
-- Arrange: household A (proposer) grants its single to household B (grantee);
-- household C is an unrelated stranger. A and B each also hold a second,
-- ungranted single, so the flag can be asserted both true and false within the
-- same caller's result set.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('1a111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgss-proposer@test.local'),
  ('1bbbbbbb-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgss-grantee@test.local'),
  ('1ccccc33-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cgss-stranger@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('CGSS Proposer') returning id as acct_a \gset
insert into public.accounts (name) values ('CGSS Grantee') returning id as acct_b \gset
insert into public.accounts (name) values ('CGSS Stranger') returning id as acct_c \gset

insert into public.account_members (account_id, user_id, role) values
  (:acct_a, '1a111111-1111-1111-1111-111111111111', 'parent_admin'),
  (:acct_b, '1bbbbbbb-2222-2222-2222-222222222222', 'parent_admin'),
  (:acct_c, '1ccccc33-3333-3333-3333-333333333333', 'parent_admin');

insert into public.member_state (user_id, active_account_id) values
  ('1a111111-1111-1111-1111-111111111111', :acct_a),
  ('1bbbbbbb-2222-2222-2222-222222222222', :acct_b),
  ('1ccccc33-3333-3333-3333-333333333333', :acct_c)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

-- Proposer's granted single (single_a) and an extra, ungranted single (a2).
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Granted', 'Single') returning id as single_a \gset
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Proposer', 'Own') returning id as single_a2 \gset

insert into ids values ('single_a', :single_a), ('single_a2', :single_a2);

-- Grantee's own (native) single, plus the stranger's single (single_c).
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_b, 'Grantee', 'Own') returning id as single_b \gset
insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_c, 'Stranger', 'Single') returning id as single_c \gset

insert into ids values ('single_b', :single_b), ('single_c', :single_c);

-- One accepted grant: A grants single_a to B.
insert into public.child_grants
  (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id)
values
  (:acct_a, :single_a, 'cgss-test-hash', 'accepted', now() + interval '30 days', :acct_b)
returning id as grant_row \gset

insert into ids values ('grant_row', :grant_row);

-- ---------------------------------------------------------------------------
-- (a) NEGATIVE: an unrelated household (C) has no accepted grant on any single
-- it can see, so every visible row must read is_shared_with_me = false. C's
-- OWN single is the only row RLS shows it, and it can never be shared-with-C.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1ccccc33-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed, detail)
select 'stranger never sees is_shared_with_me = true on any visible single',
       count(*) = 0,
       format('rows with flag true = %s (expected 0)', count(*))
from public.singles_summary
where is_shared_with_me;

insert into results (name, passed, detail)
select 'stranger sees its own single with is_shared_with_me = false',
       count(*) = 1,
       format('rows = %s (expected exactly its own single)', count(*))
from public.singles_summary
where id = (select v from ids where k = 'single_c')
  and not is_shared_with_me;

reset role;

-- ---------------------------------------------------------------------------
-- (b) NEGATIVE: another household's (A's) granted single does NOT appear in
-- C's singles_summary result set at all. The view adds no independent
-- visibility beyond what the base table's RLS already grants — a single C has
-- no accepted grant on, and which is not C's own, is invisible.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1ccccc33-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed, detail)
select 'stranger cannot see the granted single row at all (base-table RLS still applies)',
       count(*) = 0,
       format('rows = %s (expected 0)', count(*))
from public.singles_summary
where id = (select v from ids where k = 'single_a');

reset role;

-- ---------------------------------------------------------------------------
-- (c) POSITIVE: the accepted grantee (B) sees the granted single's row in the
-- view AND reads is_shared_with_me = true for it — the whole point of the
-- flag. B's OWN single is also visible (base-table RLS) but must read false:
-- the flag is ABOUT grants, not about being able to read.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1bbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'accepted grantee sees the granted single with is_shared_with_me = true',
       count(*) = 1,
       format('rows = %s (expected 1, the granted single)', count(*))
from public.singles_summary
where id = (select v from ids where k = 'single_a')
  and is_shared_with_me;

insert into results (name, passed, detail)
select 'accepted grantee sees its own single with is_shared_with_me = false',
       count(*) = 1,
       format('rows = %s (expected 1, its own single)', count(*))
from public.singles_summary
where id = (select v from ids where k = 'single_b')
  and not is_shared_with_me;

reset role;

-- ---------------------------------------------------------------------------
-- (d) POSITIVE-for-the-guard: the PROPOSER (A) reading its OWN granted-out
-- single must see is_shared_with_me = false — A is the grantee's counterpart
-- on the very grant, and the flag must not light up on A's own record. This is
-- the assertion that proves `proposer_account_id <> current_context_id()` is
-- enforced, not merely present. (Reachable only if a household grants to
-- itself, which the guard makes unambiguous by construction.)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"1a111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed, detail)
select 'proposer reads its own granted-out single with is_shared_with_me = false',
       count(*) = 1,
       format('rows = %s (expected 1)', count(*))
from public.singles_summary
where id = (select v from ids where k = 'single_a')
  and not is_shared_with_me;

insert into results (name, passed, detail)
select 'proposer sees none of its own singles as shared (flag false on all native rows)',
       count(*) = 0,
       format('rows with flag true = %s (expected 0)', count(*))
from public.singles_summary
where is_shared_with_me;

reset role;

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail))
from results;