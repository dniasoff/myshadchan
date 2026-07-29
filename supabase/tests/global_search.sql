--
-- Global search (Story 4.5) — cross-account isolation of the search surface
-- itself (see the story's Dev Notes, "The negative test this story owns").
--
-- This story adds NO new RLS policy: the fan-out (`misc/useGlobalSearch.ts`)
-- reads through `getList` against `singles`, `shidduchim` (redirected to
-- `shidduchim_summary`, security_invoker — `getDataProviderWithCustomMethods`)
-- and `shadchanim` — three tables/view that already carry
-- `FORCE ROW LEVEL SECURITY` (AD-1) and already have their own isolation
-- coverage (context_rls_hardening.sql covers `shadchanim`; this is the first
-- suite to cover `singles` and `shidduchim_summary` under a search-shaped
-- query). What this suite proves is that the NEW aggregate code path — three
-- parallel reads keyed to one shared search term — cannot, through a mundane
-- implementation mistake (a resource name that bypasses the intended search
-- hook, or a service-role client standing in for the caller's own session),
-- leak a same-named row across an account boundary. It does not re-prove RLS
-- other stories already cover.
--
-- Two disjoint household tenants (context_rls_hardening.sql's own pattern —
-- two logins, not one login switching context, since there is no context
-- SWITCH under test here, only an account BOUNDARY), each seeded with a
-- singles row, a shidduchim row and a shadchanim row sharing one distinctive
-- term ("Zzyx") nobody would type by accident — deliberately across BOTH
-- accounts, so a leak surfaces as an EXTRA row, not merely a missing one.
--
-- Every check's WHERE clause mirrors `applyFullTextSearch`'s own
-- OR-across-columns shape (dataProvider.ts's `lifeCycleCallbacks`) for that
-- exact resource, run directly against the table/view the fan-out actually
-- reads.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (global_search.test.ts) turns each row into a named assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up; prefix every
-- `npx supabase` call with DBUS_SESSION_BUS_ADDRESS=/dev/null).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- Arrange: two disjoint household tenants.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('9a111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gs-a@test.local');

insert into auth.users (id, instance_id, aud, role, email)
values ('9b222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gs-b@test.local');

delete from public.account_members;

insert into public.accounts (name) values ('GS Tenant A') returning id as acct_a \gset
insert into public.accounts (name) values ('GS Tenant B') returning id as acct_b \gset
insert into ids values ('acct_a', :'acct_a'), ('acct_b', :'acct_b');

insert into public.account_members (account_id, user_id, role)
values (:acct_a, '9a111111-1111-1111-1111-111111111111', 'parent_admin'),
       (:acct_b, '9b222222-2222-2222-2222-222222222222', 'parent_admin');

-- ---------------------------------------------------------------------------
-- Tenant A's fixture rows: one single, one shidduch (pointing at that
-- single), one shadchan, all three carrying the shared term.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"9a111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: tenant A''s active context is its own account',
       public.current_context_id() = :acct_a;

insert into public.singles (first_name_en, last_name_en) values ('Zzyx', 'Adler')
returning id as single_a \gset

insert into public.shadchanim (name) values ('Zzyx Shadchan A')
returning id as shadchan_a \gset

insert into public.shidduchim (single_id, shadchan_id, name_en)
values (:single_a, :shadchan_a, 'Zzyx Shidduch A')
returning id as shidduch_a \gset

insert into ids values
  ('single_a', :'single_a'),
  ('shadchan_a', :'shadchan_a'),
  ('shidduch_a', :'shidduch_a');

reset role;

-- ---------------------------------------------------------------------------
-- Tenant B's fixture rows — the SAME term, a DIFFERENT account.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"9b222222-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: tenant B''s active context is its own account',
       public.current_context_id() = :acct_b;

insert into public.singles (first_name_en, last_name_en) values ('Zzyx', 'Berg')
returning id as single_b \gset

insert into public.shadchanim (name) values ('Zzyx Shadchan B')
returning id as shadchan_b \gset

insert into public.shidduchim (single_id, shadchan_id, name_en)
values (:single_b, :shadchan_b, 'Zzyx Shidduch B')
returning id as shidduch_b \gset

insert into ids values
  ('single_b', :'single_b'),
  ('shadchan_b', :'shadchan_b'),
  ('shidduch_b', :'shidduch_b');

reset role;

-- ---------------------------------------------------------------------------
-- Act + Assert, as tenant A: each of the three per-resource searches the
-- fan-out issues returns ONLY tenant A's row — never tenant B's, even though
-- tenant B's row matches the exact same term.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"9a111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed, detail)
select 'singles: the "Zzyx" search returns exactly tenant A''s row, never tenant B''s',
       coalesce(array_agg(id order by id), array[]::bigint[])
         = array[(select value::bigint from ids where name = 'single_a')],
       format('ids=%s', coalesce(array_agg(id order by id), array[]::bigint[]))
from public.singles
where first_name_en ilike '%Zzyx%' or last_name_en ilike '%Zzyx%'
   or first_name_he ilike '%Zzyx%' or last_name_he ilike '%Zzyx%';

insert into results (name, passed, detail)
select 'shidduchim_summary: the "Zzyx" search returns exactly tenant A''s row, never tenant B''s',
       coalesce(array_agg(id order by id), array[]::bigint[])
         = array[(select value::bigint from ids where name = 'shidduch_a')],
       format('ids=%s', coalesce(array_agg(id order by id), array[]::bigint[]))
from public.shidduchim_summary
where name_en ilike '%Zzyx%' or name_he ilike '%Zzyx%'
   or shadchan_name ilike '%Zzyx%' or shadchan_name_he ilike '%Zzyx%'
   or parents_en ilike '%Zzyx%' or parents_he ilike '%Zzyx%'
   or location_en ilike '%Zzyx%' or location_he ilike '%Zzyx%';

insert into results (name, passed, detail)
select 'shadchanim: the "Zzyx" search returns exactly tenant A''s row, never tenant B''s',
       coalesce(array_agg(id order by id), array[]::bigint[])
         = array[(select value::bigint from ids where name = 'shadchan_a')],
       format('ids=%s', coalesce(array_agg(id order by id), array[]::bigint[]))
from public.shadchanim
where name ilike '%Zzyx%' or name_he ilike '%Zzyx%' or location ilike '%Zzyx%';

-- ---------------------------------------------------------------------------
-- Sanity control: as tenant B, the SAME search returns exactly tenant B's
-- row — proving the isolation above is a genuine account boundary, not an
-- accident of tenant A happening to run first.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"9b222222-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed, detail)
select 'singles: sanity control — as tenant B, the same search returns exactly tenant B''s row',
       coalesce(array_agg(id order by id), array[]::bigint[])
         = array[(select value::bigint from ids where name = 'single_b')],
       format('ids=%s', coalesce(array_agg(id order by id), array[]::bigint[]))
from public.singles
where first_name_en ilike '%Zzyx%' or last_name_en ilike '%Zzyx%'
   or first_name_he ilike '%Zzyx%' or last_name_he ilike '%Zzyx%';

insert into results (name, passed, detail)
select 'shidduchim_summary: sanity control — as tenant B, the same search returns exactly tenant B''s row',
       coalesce(array_agg(id order by id), array[]::bigint[])
         = array[(select value::bigint from ids where name = 'shidduch_b')],
       format('ids=%s', coalesce(array_agg(id order by id), array[]::bigint[]))
from public.shidduchim_summary
where name_en ilike '%Zzyx%' or name_he ilike '%Zzyx%'
   or shadchan_name ilike '%Zzyx%' or shadchan_name_he ilike '%Zzyx%'
   or parents_en ilike '%Zzyx%' or parents_he ilike '%Zzyx%'
   or location_en ilike '%Zzyx%' or location_he ilike '%Zzyx%';

insert into results (name, passed, detail)
select 'shadchanim: sanity control — as tenant B, the same search returns exactly tenant B''s row',
       coalesce(array_agg(id order by id), array[]::bigint[])
         = array[(select value::bigint from ids where name = 'shadchan_b')],
       format('ids=%s', coalesce(array_agg(id order by id), array[]::bigint[]))
from public.shadchanim
where name ilike '%Zzyx%' or name_he ilike '%Zzyx%' or location ilike '%Zzyx%';

reset role;

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
