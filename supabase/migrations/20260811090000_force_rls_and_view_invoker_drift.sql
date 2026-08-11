-- Align four tables and one view with what supabase/schemas/ has claimed all
-- along. Every statement here is privilege-REDUCING or privilege-neutral; none
-- touches a row.
--
-- WHY THIS IS HAND-WRITTEN: `supabase db diff` cannot see either property.
-- Measured on this tree — with `analytics_events` missing FORCE and
-- `analytics_events_summary` missing `security_invoker` in the database while
-- 05_policies.sql / 03_views.sql declared both, a full declarative diff
-- (scratch workdir, per AGENTS.md) reported `No schema changes found`. migra
-- compares neither `pg_class.relforcerowsecurity` nor view `reloptions`, so
-- this drift class is invisible to the repo's main convergence check and can
-- only be closed by writing the statements out and asserting them in a test
-- (see supabase/tests/rls_force_and_invoker.sql, added with this migration).
--
-- HOW THE DRIFT HAPPENED, for the two that were declared but never deployed:
-- 20260809053943_analytics_events.sql created the table with bare `enable row
-- level security` and the view with a bare `create or replace view`, while the
-- declarative schema declared FORCE and `security_invoker = on`. The
-- 20260809144200 FORCE-RLS retrofit enumerated tables by hand and predates
-- neither — `analytics_events` and `child_grants` are simply absent from its
-- list.

-- 1. FORCE ROW LEVEL SECURITY --------------------------------------------
--
-- account_deletion_requests / purge_requests were never declared with FORCE
-- (scripts/check-force-rls.mjs was red on main from 2026-08-10T19:23 onward
-- naming exactly these two); analytics_events / child_grants were declared
-- with FORCE but never got it in the database.
--
-- Safe for every caller that exists today: both tables are owned by `postgres`
-- and `postgres` has rolbypassrls = true, so FORCE does not subject the two
-- SECURITY DEFINER functions over these tables (export_account_data,
-- verify_purge_request) to RLS. BYPASSRLS beats FORCE, and service_role also
-- carries it. FORCE is defence in depth here, not a behaviour change.
alter table public.account_deletion_requests force row level security;
alter table public.purge_requests force row level security;
alter table public.analytics_events force row level security;
alter table public.child_grants force row level security;

-- 2. security_invoker on the analytics summary view -----------------------
--
-- Without it the view runs as its owner and BYPASSES the
-- `account_id = current_context_id()` policy on analytics_events entirely.
-- It is not a live leak today only because the view has no SELECT grant to
-- `authenticated` at all, so every read fails closed with "permission denied"
-- — which also means the frontend read path
-- (src/components/atomic-crm/providers/supabase/analytics.ts:9) is dead.
--
-- That combination is the hazard: granting the missing SELECT — the obvious
-- one-line "fix" for the dead feature — would turn a broken read into a
-- cross-tenant leak. Measured in a rolled-back transaction on a stack seeded
-- with two accounts: after `grant select` alone, ONE authenticated user
-- belonging to neither account saw BOTH accounts' aggregate rows.
--
-- This statement disarms that trap, which is what makes section 3 below safe
-- to write at all. The grant is not optional — view_grants.sql:137 requires
-- every public view to be SELECTable by `authenticated` — so the resolution is
-- not "withhold the grant" but "make the grant safe first, in this order".
alter view public.analytics_events_summary set (security_invoker = on);

-- 3. the grants that were never transcribed (Story 15.2) ------------------
--
-- With security_invoker on (2 above) these are safe AND required: the repo's
-- standing rule, asserted by supabase/tests/view_grants.sql:137, is that every
-- public view must be SELECTable by `authenticated`, and that suite has been
-- red on this view since it shipped. The base-table grants matter just as
-- much — without them the feature is dead in both directions, which it has
-- been: `service_role` INSERT and `authenticated` SELECT both failed with
-- "permission denied for table analytics_events" when measured on a stack.
--
-- ORDER IS LOAD-BEARING. Section 2 must precede this section. Applying these
-- grants to a view WITHOUT security_invoker is a cross-tenant leak, measured.
revoke all on table public.analytics_events from anon;
grant select, insert on table public.analytics_events to authenticated;
grant usage, select on sequence public.analytics_events_id_seq to authenticated;
grant all on table public.analytics_events to service_role;
grant all on sequence public.analytics_events_id_seq to service_role;

revoke all on table public.analytics_events_summary from anon, authenticated;
grant select on table public.analytics_events_summary to authenticated;
grant all on table public.analytics_events_summary to service_role;
