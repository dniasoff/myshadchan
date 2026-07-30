--
-- Standing guard: every `public` schema view's grants match the ones
-- 06_grants.sql declares — database test suite.
--
-- The grants-side twin of security_invoker_views.sql (Story 5.2's F1/F2 fix).
-- That suite guards half the problem: when `supabase db diff` drops and
-- recreates a view, the generated `CREATE VIEW` carries forward neither
-- `WITH (security_invoker = on)` NOR the view's grants. Only the first half
-- had a guard. This is the second.
--
-- Losing grants fails in both directions, and both are silent:
--
--   * TOO LOCKED DOWN — the view comes back with only whatever schema default
--     privileges apply, so a read path the app depends on (the board, the
--     roster, reference diligence) 401s for `authenticated` in production
--     while every local test that runs as `postgres` stays green.
--   * TOO PERMISSIVE — this schema's default privileges are
--     `grant all on tables to authenticated` (06_grants.sql), so a view that
--     06_grants.sql deliberately narrows to `SELECT` silently comes back with
--     INSERT/UPDATE/DELETE. Views over multi-tenant tables are not meant to be
--     writable.
--
-- HOW IT CHECKS, without duplicating 06_grants.sql into an expected-value
-- table that would rot: snapshot every public view's ACL, replay the real
-- 06_grants.sql on top, snapshot again, and require the two to be identical.
-- If the live grants already are what the declarative schema says, replaying
-- it is a no-op. If a view drifted, the replay moves it and the snapshots
-- disagree — naming that view. The whole thing runs inside a transaction that
-- always rolls back, so the replay never actually changes the database.
--
-- ACLs are compared as a sorted grantee/privilege set, not as the raw
-- `aclitem[]`, because `revoke` + `grant` re-appends entries in a different
-- array order while granting exactly the same privileges — comparing raw
-- arrays would fail on every run.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back. The runner (view_grants.test.ts) turns each row into
-- a named assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

-- One row per (view, grantee, privilege). A view with a NULL relacl (the
-- "recreated and never re-granted" case) contributes no rows at all, which is
-- exactly the state we want to be able to see.
create temp view public_view_acl as
select
  c.relname as view_name,
  case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
  a.privilege_type
from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join lateral aclexplode(c.relacl) a on true
where n.nspname = 'public'
  and c.relkind = 'v';

-- MATERIALISED, not a view: everything below the replay must still see the
-- grants as they were BEFORE 06_grants.sql was re-applied. `public_view_acl`
-- is a view over pg_class, so it silently reports the repaired state once the
-- replay has run — which would make the posture checks at the bottom grade the
-- declarative file instead of the live database.
create temp table acl_rows_before on commit drop as
select view_name, grantee, privilege_type from public_view_acl;

-- Normalised, order-independent fingerprint of one view's grants.
create temp table acl_before on commit drop as
select
  view_name,
  coalesce(
    string_agg(grantee || '=' || privilege_type, ' ' order by grantee, privilege_type),
    '(no grants)'
  ) as acl
from acl_rows_before
group by view_name;

-- ---------------------------------------------------------------------------
-- Replay the declarative grants. `\ir` resolves relative to THIS file, so the
-- suite reads the real 06_grants.sql wherever the repo is checked out, and
-- picks up new views the moment someone grants on them — there is no second
-- copy of the grant matrix to keep in sync.
-- ---------------------------------------------------------------------------
\ir ../schemas/06_grants.sql

create temp table acl_after on commit drop as
select
  view_name,
  coalesce(
    string_agg(grantee || '=' || privilege_type, ' ' order by grantee, privilege_type),
    '(no grants)'
  ) as acl
from public_view_acl
group by view_name;

-- One row per view rather than a single bool_and(), so a regression names the
-- view that drifted instead of hiding inside an aggregate.
insert into results (name, passed, detail)
select
  format('grants match 06_grants.sql: public.%I', b.view_name),
  b.acl = a.acl,
  case
    when b.acl = a.acl then format('%s', b.acl)
    else format('live: %s | declared: %s', b.acl, a.acl)
  end
from acl_before b
  join acl_after a on a.view_name = b.view_name;

-- A view that 06_grants.sql never mentions drifts nowhere on replay, so the
-- check above passes it vacuously. This is the posture floor that catches it:
-- no public view may be readable by `anon` or by `PUBLIC`. Both are
-- unauthenticated — RLS on the underlying tables keys off `auth.uid()`, and an
-- anonymous session has none, so exposing a summary view to either is a
-- cross-account read waiting to happen (AD-1).
insert into results (name, passed, detail)
select
  format('no anon/PUBLIC grant: public.%I', c.relname),
  not exists (
    select 1 from acl_rows_before v
    where v.view_name = c.relname and v.grantee in ('anon', 'PUBLIC')
  ),
  coalesce(
    (select string_agg(distinct v.grantee, ',') from acl_rows_before v
     where v.view_name = c.relname and v.grantee in ('anon', 'PUBLIC')),
    'none'
  )
from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v';

-- The other half of the same gap: a view nobody granted at all is invisible to
-- the app. Every public view must be SELECTable by `authenticated`.
insert into results (name, passed, detail)
select
  format('authenticated can select: public.%I', c.relname),
  exists (
    select 1 from acl_rows_before v
    where v.view_name = c.relname
      and v.grantee = 'authenticated'
      and v.privilege_type = 'SELECT'
  ),
  coalesce(
    (select string_agg(v.privilege_type, ',' order by v.privilege_type)
     from acl_rows_before v
     where v.view_name = c.relname and v.grantee = 'authenticated'),
    '(no grants to authenticated)'
  )
from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v';

-- Catalog fact, so a view silently dropping out of `public` — or the queries
-- above returning zero rows for any reason — cannot make this suite report
-- "all clear" by having nothing left to check. Mirrors the sibling suite's
-- floor; Epic 5 ships eight public views.
insert into results (name, passed, detail)
select 'at least the eight views this repo ships as of Epic 5 were checked',
       count(*) >= 8,
       format('checked %s view(s)', count(*))
from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v';

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo the replay.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
