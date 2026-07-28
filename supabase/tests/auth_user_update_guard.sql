--
-- on_auth_user_updated WHEN guard (Epic 2 verification finding F2) —
-- database test suite.
--
-- handle_update_user() used to run on EVERY auth.users UPDATE, with no WHEN
-- guard on the trigger. Since a plain email-OTP sign-in only bumps
-- last_sign_in_at (and related session bookkeeping columns) and never
-- touches raw_user_meta_data, that unconditional fire still ran the
-- function's coalesce chain against the SAME (name-less) metadata every
-- time, falling through to the 'Pending' default and wiping out any real
-- name a member had set — reproduced live against the e2e stack (see the
-- Epic 2 verification report). The fix scopes the trigger with a WHEN clause
-- (04_triggers.sql) so it only fires when raw_user_meta_data or email
-- actually changes.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (auth_user_update_guard.test.ts) turns each row into a named assertion.
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

-- ---------------------------------------------------------------------------
-- Arrange: a fresh auth user with no name in its metadata, so
-- handle_new_user() seeds the 'Pending' default exactly like a real
-- email-OTP invite-acceptance signup does.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, last_sign_in_at)
values (
  'aa11aa11-aa11-aa11-aa11-aa11aa11aa11',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'auth-guard@test.local',
  '{"email_verified": true}'::jsonb,
  now()
);

insert into results (name, passed)
select 'handle_new_user() seeds the Pending default when metadata carries no name',
       exists (
         select 1 from public.members
         where user_id = 'aa11aa11-aa11-aa11-aa11-aa11aa11aa11'
           and first_name = 'Pending' and last_name = 'Pending'
       );

-- The member sets their own name afterwards (mirrors a Settings edit, or the
-- e2e fixture's createMember() admin-side update — a write to public.members
-- directly, never to auth.users).
update public.members
set first_name = 'Rivka', last_name = 'Shadchan'
where user_id = 'aa11aa11-aa11-aa11-aa11-aa11aa11aa11';

-- ---------------------------------------------------------------------------
-- Act 1: a login-shaped UPDATE — only last_sign_in_at changes, exactly what
-- GoTrue does on every successful email-OTP verification. Before the WHEN
-- guard, this alone reset the name back to 'Pending'.
-- ---------------------------------------------------------------------------
update auth.users
set last_sign_in_at = now()
where id = 'aa11aa11-aa11-aa11-aa11-aa11aa11aa11';

insert into results (name, passed)
select 'a login-shaped auth.users UPDATE (last_sign_in_at only) does not touch the member''s name',
       (select first_name from public.members where user_id = 'aa11aa11-aa11-aa11-aa11-aa11aa11aa11') = 'Rivka'
   and (select last_name from public.members where user_id = 'aa11aa11-aa11-aa11-aa11-aa11aa11aa11') = 'Shadchan';

-- ---------------------------------------------------------------------------
-- Act 2: an UPDATE that changes raw_user_meta_data (e.g. an OAuth link, or
-- an admin metadata patch) must still run handle_update_user() and apply the
-- new name — the guard must not disable the sync entirely.
-- ---------------------------------------------------------------------------
update auth.users
set raw_user_meta_data = '{"first_name": "Chana", "last_name": "Levi"}'::jsonb
where id = 'aa11aa11-aa11-aa11-aa11-aa11aa11aa11';

insert into results (name, passed)
select 'an auth.users UPDATE that changes raw_user_meta_data still re-syncs the member''s name',
       (select first_name from public.members where user_id = 'aa11aa11-aa11-aa11-aa11-aa11aa11aa11') = 'Chana'
   and (select last_name from public.members where user_id = 'aa11aa11-aa11-aa11-aa11-aa11aa11aa11') = 'Levi';

-- ---------------------------------------------------------------------------
-- Act 3: an UPDATE that changes only the email column must still sync
-- members.email, without disturbing the name just set above.
-- ---------------------------------------------------------------------------
update auth.users
set email = 'auth-guard-new@test.local'
where id = 'aa11aa11-aa11-aa11-aa11-aa11aa11aa11';

insert into results (name, passed)
select 'an auth.users UPDATE that changes only email syncs members.email and leaves the name alone',
       (select email from public.members where user_id = 'aa11aa11-aa11-aa11-aa11-aa11aa11aa11') = 'auth-guard-new@test.local'
   and (select first_name from public.members where user_id = 'aa11aa11-aa11-aa11-aa11-aa11aa11aa11') = 'Chana';

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
