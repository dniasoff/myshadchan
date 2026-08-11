--
-- Standing guard: `analytics_events_summary` shows a household its OWN
-- aggregates and nobody else's — database test suite.
--
-- WHY A FUNCTIONAL SUITE WHEN TWO STRUCTURAL ONES ALREADY EXIST.
-- security_invoker_views.sql asserts the view carries `security_invoker = on`;
-- view_grants.sql asserts `authenticated` can SELECT it. Both can be green
-- while the view still leaks — the invoker flag only routes the read through
-- RLS, it does not check that a policy exists, is correct, or survives the
-- next edit to analytics_events. This suite checks the property the other two
-- only imply, by reading the view as two different tenants.
--
-- THE INCIDENT IT ENCODES (2026-08-11). 20260809053943_analytics_events.sql
-- created the view with a bare `create or replace view` while 03_views.sql
-- declared `with (security_invoker = on)`, and never transcribed any grant
-- into 06_grants.sql. `supabase db diff` compares neither view `reloptions`
-- nor `pg_class.relforcerowsecurity`, so a full declarative diff reported
-- `No schema changes found` against a database that had neither. The result
-- was a view that bypassed RLS entirely, kept harmless only by having no
-- grant at all — so the whole analytics feature was dead in both directions
-- (`service_role` INSERT and `authenticated` SELECT each failed with
-- "permission denied for table analytics_events"), and the obvious one-line
-- fix for that deadness — granting SELECT — would have armed a cross-tenant
-- leak. Measured before the fix, in a rolled-back transaction with two seeded
-- accounts: after `grant select` alone, ONE authenticated user belonging to
-- NEITHER account read BOTH accounts' aggregate rows.
--
-- Both halves below are load-bearing, and the negative one is not enough on
-- its own: "tenant B sees 0 of tenant A's rows" is also what a completely
-- broken view returns, which is exactly how the original defect hid. The
-- positive check is what makes the negative one mean something.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back. The runner is analytics_tenant_isolation.test.ts.
--

create temporary table results (
  name text,
  passed boolean,
  detail text
) on commit drop;
grant all on results to public;

-- ---------------------------------------------------------------------------
-- Arrange: two household tenants, one analytics event each.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('aaaaaaaa-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'analytics-a@test.local');

insert into auth.users (id, instance_id, aud, role, email)
values ('bbbbbbbb-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'analytics-b@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('Analytics Tenant A') returning id as acct_a \gset
insert into public.accounts (name) values ('Analytics Tenant B') returning id as acct_b \gset

insert into public.account_members (account_id, user_id, role)
values (:acct_a, 'aaaaaaaa-1111-1111-1111-111111111111', 'parent_admin'),
       (:acct_b, 'bbbbbbbb-2222-2222-2222-222222222222', 'parent_admin');

-- current_context_id() reads member_state.active_account_id and requires a
-- matching active account_members row, so both must be pointed at this
-- suite's accounts.
insert into public.member_state (user_id, active_account_id)
values ('aaaaaaaa-1111-1111-1111-111111111111', :acct_a),
       ('bbbbbbbb-2222-2222-2222-222222222222', :acct_b)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

insert into public.analytics_events (account_id, event_type)
values (:acct_a, 'item_filed'),
       (:acct_a, 'item_filed'),
       (:acct_b, 'item_filed');

-- ---------------------------------------------------------------------------
-- Assert, as tenant A.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}';

-- POSITIVE: without this, the negative checks below pass vacuously on a view
-- that returns nothing to anyone — the exact shape of the original defect.
insert into results (name, passed, detail)
select 'tenant A reads its OWN aggregate row through the view',
       count(*) = 1,
       format('rows for own account = %s (expected 1)', count(*))
from public.analytics_events_summary
where account_id = :acct_a;

insert into results (name, passed, detail)
select 'tenant A''s own row carries the right count (the view still aggregates)',
       coalesce(max(items_filed), -1) = 2,
       format('items_filed = %s (expected 2)', coalesce(max(items_filed), -1))
from public.analytics_events_summary
where account_id = :acct_a;

-- NEGATIVE: the leak class.
insert into results (name, passed, detail)
select 'tenant A cannot see tenant B''s aggregate row',
       count(*) = 0,
       format('rows for the other account = %s (expected 0)', count(*))
from public.analytics_events_summary
where account_id = :acct_b;

insert into results (name, passed, detail)
select 'tenant A sees exactly one account through the view, its own',
       count(distinct account_id) = 1,
       format('distinct accounts visible = %s (expected 1)', count(distinct account_id))
from public.analytics_events_summary;

-- The base table underneath must be confined too: with security_invoker = on
-- the view is only as safe as the policy on analytics_events.
insert into results (name, passed, detail)
select 'tenant A cannot read tenant B''s rows from the base table',
       count(*) = 0,
       format('other-account event rows visible = %s (expected 0)', count(*))
from public.analytics_events
where account_id = :acct_b;

reset role;

-- ---------------------------------------------------------------------------
-- Assert, as tenant B — the mirror, so a policy accidentally hard-coded to one
-- account cannot pass this suite.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'tenant B reads its OWN aggregate row through the view',
       count(*) = 1,
       format('rows for own account = %s (expected 1)', count(*))
from public.analytics_events_summary
where account_id = :acct_b;

insert into results (name, passed, detail)
select 'tenant B cannot see tenant A''s aggregate row',
       count(*) = 0,
       format('rows for the other account = %s (expected 0)', count(*))
from public.analytics_events_summary
where account_id = :acct_a;

reset role;

-- ---------------------------------------------------------------------------
-- Assert, as anon — nothing at all.
-- ---------------------------------------------------------------------------
set local role anon;

do $$
declare v_visible int;
begin
  select count(*) into v_visible from public.analytics_events_summary;
  insert into results (name, passed, detail)
  values ('anon reads nothing through the view',
          v_visible = 0,
          format('rows visible to anon = %s (expected 0, or a permission error)', v_visible));
exception when insufficient_privilege then
  insert into results (name, passed, detail)
  values ('anon reads nothing through the view', true, 'permission denied - fails closed');
end $$;

reset role;

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail))
from results;
