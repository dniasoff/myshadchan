--
-- Regression guard: refresh_shidduch_redt_summary() (02_functions.sql), the
-- AFTER INSERT/UPDATE/DELETE trigger on public.redts that keeps
-- shidduchim.redt_date / shadchan_id / first_suggested_by / first_suggested_at
-- in sync, must run SECURITY DEFINER.
--
-- WHY THIS MATTERS (independent of the child_grants feature -- a real latent
-- bug regardless of it). Before this trigger function was made SECURITY
-- DEFINER, its own internal
--   `update public.shidduchim s set redt_date = ... where s.id = v_shidduch_id`
-- ran under the CALLER's RLS, not the trigger owner's. Every caller able to
-- write redts today is also a full member of the account that owns the
-- linked shidduchim row, so this always happened to work -- but a caller who
-- can write redts WITHOUT full RLS control over the linked shidduchim row
-- (e.g. a future grant-scoped redts writer) would cause this UPDATE to match
-- ZERO rows, silently: no error, no exception, just a stale summary from
-- that point on, with nobody told.
--
-- No such caller exists in the schema yet (child_grants only grants SELECT
-- on redts/shidduchim today -- 05_policies.sql), so this suite SIMULATES the
-- future shape with a THROWAWAY policy, created and torn down entirely
-- inside this script's own `begin; ... rollback;` (never committed, never
-- persisted -- unlike child_grant_redts_access.sql, which relies on its
-- caller wrapping it in an external transaction, this file is self-contained
-- exactly like shadchan_redting.sql, so a bare `psql -f` run is also safe).
--
-- THE SENTINEL DESIGN. shidduchim.redt_date/first_suggested_at both carry
-- column DEFAULTs (current_date / now()) -- seeding the fixture WITHOUT
-- explicit values would make "the trigger updated it" indistinguishable from
-- "it was never touched and is still showing its own insert-time default".
-- The fixture instead seeds shidduchim with an explicit, unrelated sentinel
-- (2000-01-01, a first shadchan "before") and the grantee's new redt carries
-- a different, unrelated date (2030-05-15, a different shadchan "new") --
-- so a stale trigger (values stuck at the sentinel) and a working one
-- (values matching the new redt) are unambiguous, distinct outcomes.
--
-- ANOTHER PRE-EXISTING GATE, WORKED AROUND HERE, NOT FIXED: getting a
-- grantee's redts INSERT to fire at all first requires clearing
-- validate_redts_household_scope (enforce_household_scope(),
-- 02_functions.sql) -- which has the EXACT SAME defect (plain plpgsql, not
-- SECURITY DEFINER: its own internal accounts lookup runs under the
-- caller's RLS, so a grantee with no accounts-level SELECT on the
-- proposer's account gets a false "not a household-kind account"). That
-- function is NOT touched by this fix and is out of this suite's scope --
-- worked around below by giving the grantee user a SECOND, non-active-context
-- membership in the proposer's account, solely so enforce_household_scope()
-- can see the account row. current_context_id() still resolves to the
-- grantee's OWN account throughout (member_state.active_account_id is never
-- changed), so the mechanism actually under test -- the shidduchim UPDATE's
-- RLS -- is unaffected by this workaround. Flagged here as a standing
-- caution: whoever builds the real grant-write redts policy will hit this
-- same false rejection and needs to also address enforce_household_scope().
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

-- ---------------------------------------------------------------------------
-- Structural guard: the fix itself. A future edit that drops SECURITY
-- DEFINER (or drops the empty search_path alongside it -- a privilege
-- surface change of its own) fails here immediately, before any functional
-- assertion even runs.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'refresh_shidduch_redt_summary() is SECURITY DEFINER',
       p.prosecdef,
       format('prosecdef = %s', p.prosecdef)
from pg_proc p
where p.proname = 'refresh_shidduch_redt_summary'
  and p.pronamespace = 'public'::regnamespace;

insert into results (name, passed, detail)
select 'refresh_shidduch_redt_summary() still pins search_path to empty (no privilege-escalation surface via an unqualified name)',
       p.proconfig @> array['search_path=""']::text[],
       format('proconfig = %s', p.proconfig)
from pg_proc p
where p.proname = 'refresh_shidduch_redt_summary'
  and p.pronamespace = 'public'::regnamespace;

-- ---------------------------------------------------------------------------
-- Arrange: proposer household A owns a shidduch, seeded with sentinel summary
-- values (see header). Grantee household B has an accepted child_grant for
-- the target single -- the shape the future grant-write policy will use.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('7ee00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'redt-trigger-sec-proposer@test.local'),
  ('7ee00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'redt-trigger-sec-grantee@test.local');

insert into public.accounts (name, kind) values ('Redt Trigger Sec Proposer', 'household') returning id as acct_a \gset
insert into public.accounts (name, kind) values ('Redt Trigger Sec Grantee', 'household') returning id as acct_b \gset

insert into public.account_members (account_id, user_id, role, status) values
  (:acct_a, '7ee00000-0000-0000-0000-000000000001', 'parent_admin', 'active'),
  (:acct_b, '7ee00000-0000-0000-0000-000000000002', 'parent_admin', 'active');

-- The enforce_household_scope() workaround -- see header. A SECOND, inactive
-- membership for the grantee inside the proposer's account, added ONLY so
-- that function's own accounts lookup succeeds; current_context_id() below
-- still resolves to acct_b (member_state.active_account_id), never acct_a.
insert into public.account_members (account_id, user_id, role, status) values
  (:acct_a, '7ee00000-0000-0000-0000-000000000002', 'parent_admin', 'active');

insert into public.member_state (user_id, active_account_id) values
  ('7ee00000-0000-0000-0000-000000000001', :acct_a),
  ('7ee00000-0000-0000-0000-000000000002', :acct_b)
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'Redt Trigger Sec', 'Single') returning id as single_a \gset

insert into public.shadchanim (account_id, name) values (:acct_a, 'Sentinel Before Shadchan') returning id as shadchan_before \gset
insert into public.shadchanim (account_id, name) values (:acct_a, 'New Redt Shadchan') returning id as shadchan_new \gset

-- Explicit sentinel summary values, far from both "today" (the columns' own
-- defaults) and the new redt's date below.
insert into public.shidduchim
  (account_id, single_id, name_en, visibility, pipeline_state,
   shadchan_id, first_suggested_by, first_suggested_at, redt_date)
values
  (:acct_a, :single_a, 'Redt Trigger Sec Shidduch', 'shared', 'look_into',
   :shadchan_before, :shadchan_before, '2000-01-01T00:00:00Z', '2000-01-01')
returning id as shidduch_a \gset

insert into public.child_grants (proposer_account_id, target_single_id, token_hash, status, expires_at, grantee_account_id)
values (:acct_a, :single_a, 'redt-trigger-sec-test-hash', 'accepted', now() + interval '30 days', :acct_b)
returning id as grant_row \gset

-- THROWAWAY policy simulating the FUTURE grant-based write policy on redts --
-- not a real schema change, created and rolled back with everything else in
-- this script's own transaction.
create policy "TEMP redt_summary_trigger_security grant write" on public.redts
    for insert to authenticated
    with check (
        exists (
            select 1 from public.child_grants g
            where g.status = 'accepted'
              and g.grantee_account_id = public.current_context_id()
              and g.target_single_id = public.shidduch_single_id(redts.shidduchim_id)
        )
        and public.current_member_role() <> 'single'
    );

-- ---------------------------------------------------------------------------
-- Act: the grantee (active context = acct_b), who has only SELECT-via-grant
-- visibility on shidduchim (no UPDATE policy at all), writes a NEW redt
-- attributed to the proposer's account.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"7ee00000-0000-0000-0000-000000000002","role":"authenticated"}';

insert into public.redts (account_id, shidduchim_id, shadchan_id, redt_date, note)
values (:acct_a, :shidduch_a, :shadchan_new, '2030-05-15', 'Grantee-authored redt')
returning id as redt_id \gset

reset role;

-- Named separately from the functional assertions below (migration-guard-
-- integrity.md: a setup failure must read differently from a real finding).
-- If this fails, the fixture itself is broken -- e.g. the
-- enforce_household_scope() workaround above stopped working -- and the
-- assertions below are not meaningful.
insert into results (name, passed, detail)
select 'setup: the grantee''s redt row was actually inserted',
       count(*) = 1,
       format('rows = %s (expected 1)', count(*))
from public.redts where id = :redt_id;

-- ---------------------------------------------------------------------------
-- Assert (as superuser, bypassing RLS to see ground truth): the trigger's
-- internal UPDATE must have landed, matching the NEW redt -- not the
-- sentinel. Before the SECURITY DEFINER fix, all four columns stayed stuck
-- at the sentinel (2000-01-01 / shadchan_before) -- proven by hand against
-- the pre-fix function; see this task's report for the reproduction.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select 'shidduchim.redt_date reflects the grantee-authored redt, not the sentinel',
       s.redt_date = '2030-05-15'::date,
       format('redt_date = %s (expected 2030-05-15)', s.redt_date)
from public.shidduchim s where s.id = :shidduch_a;

insert into results (name, passed, detail)
select 'shidduchim.shadchan_id reflects the grantee-authored redt''s shadchan, not the sentinel',
       s.shadchan_id = :shadchan_new,
       format('shadchan_id = %s (expected %s, sentinel was %s)', s.shadchan_id, :shadchan_new, :shadchan_before)
from public.shidduchim s where s.id = :shidduch_a;

insert into results (name, passed, detail)
select 'shidduchim.first_suggested_by reflects the grantee-authored redt (the only redt on this shidduch, so first = last)',
       s.first_suggested_by = :shadchan_new,
       format('first_suggested_by = %s (expected %s, sentinel was %s)', s.first_suggested_by, :shadchan_new, :shadchan_before)
from public.shidduchim s where s.id = :shidduch_a;

insert into results (name, passed, detail)
select 'shidduchim.first_suggested_at reflects the grantee-authored redt''s date, not the sentinel',
       s.first_suggested_at = '2030-05-15T00:00:00Z'::timestamptz,
       format('first_suggested_at = %s (expected 2030-05-15)', s.first_suggested_at)
from public.shidduchim s where s.id = :shidduch_a;

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
