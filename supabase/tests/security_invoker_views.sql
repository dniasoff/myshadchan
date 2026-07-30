--
-- Standing guard: every `public` schema view is `security_invoker = on` —
-- database test suite.
--
-- Review fix F1/F2 (Story 5.2). `supabase db diff` drops and recreates every
-- view that depends on a table it considers changed, and neither `CREATE OR
-- REPLACE VIEW` nor a fresh `CREATE VIEW` ever carries `WITH
-- (security_invoker = on)` or its grants forward. That is a standing landmine
-- for every migration that touches a table with dependent views: a per-story
-- hand-restore only helps if someone notices the diff did it.
--
-- CORRECTION (Epic 5 close). 20260730011428_shidduch_overview_fields.sql's
-- MANUAL ADJUSTMENTS comment — echoed by 20260730094101 and by an earlier
-- version of this header — blamed the four view drops on "`db diff`'s own
-- dependency-tracking artifact on this repo's view graph", as if the cascade
-- were unavoidable noise. It was not. Story 5.2 left `public.shidduchim`'s
-- physical column order out of step with 01_tables.sql, `migra` therefore
-- classified the table as changed on a tree with no pending edit, and the
-- four drops repeated on every diff forever. Reordering the declarative
-- `create table` block fixed it with no migration; the Epic-4 baseline
-- (a8c5e3d) diffs clean on the same view graph. See COLUMN-ORDER TRAP at the
-- top of supabase/schemas/01_tables.sql. Migrations are append-only history,
-- so the wrong comments stand where they are — this is the correction.
--
-- The guard below is worth keeping regardless: the cascade is real whenever a
-- table genuinely changes, and it strips `security_invoker` when it fires.
-- supabase/tests/view_grants.sql is its grants-side twin.
--
-- Without `security_invoker = on` a view runs as its OWNER, so `FORCE ROW
-- LEVEL SECURITY` on the underlying tables never applies through it and
-- cross-account rows leak straight through (AD-1). This suite is the
-- catalog-level backstop: it fails loudly the moment ANY public view loses
-- the setting, for any reason — a `db diff` cascade, a hand-edited schema
-- file, or a future story that adds a ninth view and forgets it — rather
-- than depending on a per-view functional RLS check existing for that one
-- view.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind (nothing here writes
-- data in the first place). The runner (security_invoker_views.test.ts)
-- turns each row into a named assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

-- One row per public view, rather than one bool_and(), so a regression on a
-- single view names that view in the failing test instead of hiding inside
-- an aggregate.
insert into results (name, passed, detail)
select
  format('security_invoker = on: public.%I', c.relname),
  coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=on'],
  format('reloptions=%s', array_to_string(coalesce(c.reloptions, array[]::text[]), ','))
from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v';

-- Catalog fact, so a view silently dropping out of `public` (e.g. renamed,
-- or the query above somehow returning zero rows) cannot make this suite
-- report "all clear" by having nothing left to check.
insert into results (name, passed, detail)
select 'at least the eight views this repo ships as of Story 5.2 were checked',
       count(*) >= 8,
       format('checked %s view(s)', count(*))
from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v';

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
