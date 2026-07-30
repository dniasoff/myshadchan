--
-- Photo tab (Story 5.4) — database test suite.
--
-- AC 3's own falsifiable, at the table: seed one household account with a
-- `parent_admin` member and a `single` member, one `private_parent` photo
-- and one `shared` photo — the `single` member's client must see only the
-- `shared` row, and the `parent_admin` must see both. AC 4's own
-- falsifiable, at storage: the `single` member cannot download or list the
-- `private_parent` object but can download the `shared` one, and a second
-- account can reach neither object at all.
--
-- Two more groups round out Task 1/Task 2: (e) the two check constraints
-- (`resume_photos_visibility_check`, `resume_photos_storage_path_scope_check`)
-- and (f) `add_resume_photo()` / `hide_resume_photo()` themselves — the
-- upsert-the-parent-resume-row behaviour, the account-ownership guard both
-- share with `add_resume_file`/`add_redt`/`add_school`, and the soft-hide
-- contract (AC 2: `hidden_at` is set, the row is never deleted).
--
-- Three users: `u1` holds a `parent_admin` membership of household account A
-- and a SECOND `parent_admin` membership of household account B (active in
-- A) — the same "one login, two households" shape entity_files.sql /
-- documents_storage.sql use, for the same reason: two disjoint users would
-- pass without ever exercising current_context_id()'s active-context
-- resolution (AD-19). `u2` holds a `single` membership of account A ONLY —
-- 'single' is a real, invitable role at HEAD (account_members_role_check,
-- 01_tables.sql), so this is not gated on any later epic. `u3` holds a
-- `parent_admin` membership of a THIRD, fully unrelated household account C
-- — AC 4's "a second account can reach neither" check.
--
-- The storage half reuses the technique context_rls_hardening.sql /
-- entity_files.sql / documents_storage.sql already established: insert into
-- storage.objects directly (as postgres, bypassing storage RLS, the way a
-- real signed PUT would land the object) under the AC-4 key grammar, then
-- read it back as each role.
--
-- Every check appends one row to `results`; the script emits them as JSON at
-- the end and rolls back, so it leaves nothing behind. The runner
-- (resume_photos.test.ts) turns each row into a named assertion.
--
-- psql does not interpolate :variables inside dollar-quoted blocks, so any id
-- a DO block below needs is shared through the `ids` temp table rather than
-- \gset (established by context_resolution.sql / context_rls_hardening.sql).
--
-- Run via: npm run test:unit:db  (needs the local stack up).
--

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;

-- ---------------------------------------------------------------------------
-- Arrange: three logins, three household accounts.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values
  ('e5111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rp-admin@test.local'),
  ('e5222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rp-single@test.local'),
  ('e5333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rp-foreign@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('RP Household A', 'household') returning id as acct_a \gset
insert into public.accounts (name, kind) values ('RP Household B', 'household') returning id as acct_b \gset
insert into public.accounts (name, kind) values ('RP Household C (foreign)', 'household') returning id as acct_c \gset
insert into ids values ('acct_a', :'acct_a'), ('acct_b', :'acct_b'), ('acct_c', :'acct_c');

-- activate_first_context_trigger activates A (u1's first live membership);
-- adding B afterward leaves A active (AC-5, context_resolution.sql).
insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'e5111111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'e5111111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'e5222222-2222-2222-2222-222222222222', 'single', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_c, 'e5333333-3333-3333-3333-333333333333', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e5111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select 'Arrange: u1''s active context is household A right after both memberships exist',
       public.current_context_id() = (select value::bigint from ids where name = 'acct_a');

-- A single + shidduch in A, created by u1 (admin) while A is active.
insert into public.singles (first_name_en) values ('RP Single Person')
returning id as single_id \gset

insert into public.shidduchim (single_id, name_en) values (:single_id, 'RP Shidduch')
returning id as shidduch_id \gset

insert into ids values ('single_id', :'single_id'), ('shidduch_id', :'shidduch_id');

-- ---------------------------------------------------------------------------
-- (f) add_resume_photo(): the sole write path. Two calls for the same
-- shidduch — one 'shared', one 'private_parent' — each a fresh row, the
-- parent `resumes` row upserted (not duplicated) on the second call.
-- ---------------------------------------------------------------------------
select public.add_resume_photo(
  :shidduch_id,
  :'acct_a' || '/photos/shared/' || :'shidduch_id' || '/p-shared.jpg',
  'shared'
);

insert into results (name, passed)
select '(f) add_resume_photo: the first call creates exactly one resumes row for the shidduch',
       (select count(*) from public.resumes where shidduchim_id = :shidduch_id) = 1;

select public.add_resume_photo(
  :shidduch_id,
  :'acct_a' || '/photos/private_parent/' || :'shidduch_id' || '/p-private.jpg',
  'private_parent'
);

insert into results (name, passed)
select '(f) add_resume_photo: the second call upserts — still exactly one resumes row, not two',
       (select count(*) from public.resumes where shidduchim_id = :shidduch_id) = 1;

insert into results (name, passed)
select '(f) add_resume_photo: two calls produce two distinct resume_photos rows',
       (select count(*) from public.resume_photos rp
          join public.resumes r on r.id = rp.resume_id
        where r.shidduchim_id = :shidduch_id) = 2;

select rp.id as shared_photo_id
from public.resume_photos rp
  join public.resumes r on r.id = rp.resume_id
where r.shidduchim_id = :shidduch_id and rp.visibility = 'shared'
\gset

select rp.id as private_photo_id
from public.resume_photos rp
  join public.resumes r on r.id = rp.resume_id
where r.shidduchim_id = :shidduch_id and rp.visibility = 'private_parent'
\gset

insert into ids values ('shared_photo_id', :'shared_photo_id'), ('private_photo_id', :'private_photo_id');

-- The matching storage objects, inserted as postgres (bypassing storage
-- RLS, the way a real signed PUT lands the bytes) under the AC-4 key
-- grammar: {account_id}/photos/{visibility}/{shidduchim_id}/{uuid}-{name}.
reset role;

insert into storage.objects (bucket_id, name, owner)
select 'documents', value || '/photos/shared/' || (select value from ids where name = 'shidduch_id') || '/p-shared.jpg', 'e5111111-1111-1111-1111-111111111111'
from ids where name = 'acct_a'
returning id as obj_shared \gset

insert into storage.objects (bucket_id, name, owner)
select 'documents', value || '/photos/private_parent/' || (select value from ids where name = 'shidduch_id') || '/p-private.jpg', 'e5111111-1111-1111-1111-111111111111'
from ids where name = 'acct_a'
returning id as obj_private \gset

insert into ids values ('obj_shared', :'obj_shared'), ('obj_private', :'obj_private');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e5111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- (f) continued — the account-ownership guard, same shape add_resume_file /
-- add_redt / add_school already carry. Switch active to B; A's shidduch
-- must not be reachable.
-- ---------------------------------------------------------------------------
select public.set_active_context((select value::bigint from ids where name = 'acct_b'));

do $$
declare v_shidduch_id bigint;
begin
  select value::bigint into v_shidduch_id from ids where name = 'shidduch_id';
  perform public.add_resume_photo(v_shidduch_id, 'evil/photos/shared/evil/evil.jpg', 'shared');
  insert into results values ('(f) add_resume_photo: cannot attach a photo to a foreign account''s shidduch', false, 'call unexpectedly succeeded');
exception when others then
  insert into results values (
    '(f) add_resume_photo: cannot attach a photo to a foreign account''s shidduch',
    sqlerrm like '%not found in current account%', sqlerrm
  );
end $$;

do $$
declare v_photo_id bigint;
begin
  select value::bigint into v_photo_id from ids where name = 'shared_photo_id';
  perform public.hide_resume_photo(v_photo_id);
  insert into results values ('(f) hide_resume_photo: cannot hide a foreign account''s photo', false, 'call unexpectedly succeeded');
exception when others then
  insert into results values (
    '(f) hide_resume_photo: cannot hide a foreign account''s photo',
    sqlerrm like '%not found in current account%', sqlerrm
  );
end $$;

select public.set_active_context((select value::bigint from ids where name = 'acct_a'));

-- ---------------------------------------------------------------------------
-- (f) continued — hide_resume_photo(): soft-hide, never a DELETE (AC 2).
-- ---------------------------------------------------------------------------
select public.hide_resume_photo((select value::bigint from ids where name = 'private_photo_id'));

insert into results (name, passed)
select '(f) hide_resume_photo: sets hidden_at on the target row',
       (select hidden_at is not null from public.resume_photos where id = (select value::bigint from ids where name = 'private_photo_id'));

insert into results (name, passed)
select '(f) hide_resume_photo: the row still exists — never deleted',
       (select count(*) from public.resume_photos where id = (select value::bigint from ids where name = 'private_photo_id')) = 1;

-- Un-hide for the rest of the suite by re-clearing hidden_at directly (test
-- fixture bookkeeping only — there is no "unhide" RPC by design), so the
-- AC-3/AC-4 checks below exercise a genuinely-visible private_parent row.
update public.resume_photos set hidden_at = null where id = (select value::bigint from ids where name = 'private_photo_id');

-- ---------------------------------------------------------------------------
-- (a) Table RLS, AC 3: parent_admin (u1, active in A) sees both rows.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select '(a) table: parent_admin sees both the shared and the private_parent row',
       (select count(*) from public.resume_photos
          where id in (
            (select value::bigint from ids where name = 'shared_photo_id'),
            (select value::bigint from ids where name = 'private_photo_id')
          )) = 2;

-- ---------------------------------------------------------------------------
-- (b) Table RLS, AC 3: single (u2, active in A — its only membership) sees
-- ONLY the shared row. This is the story's own negative test, verbatim.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"e5222222-2222-2222-2222-222222222222","role":"authenticated"}';

insert into results (name, passed)
select '(b) table: single reads exactly one resume_photos row for this shidduch (not two)',
       (select count(*) from public.resume_photos rp
          join public.resumes r on r.id = rp.resume_id
        where r.shidduchim_id = (select value::bigint from ids where name = 'shidduch_id')) = 1;

insert into results (name, passed)
select '(b) table: single CAN read the shared photo row',
       (select count(*) from public.resume_photos where id = (select value::bigint from ids where name = 'shared_photo_id')) = 1;

insert into results (name, passed)
select '(b) table: single CANNOT read the private_parent photo row (AC 3''s own falsifiable: select * returns 2 rows)',
       (select count(*) from public.resume_photos where id = (select value::bigint from ids where name = 'private_photo_id')) = 0;

-- ---------------------------------------------------------------------------
-- (c) Storage RLS, AC 4: single can download the shared object but not the
-- private_parent one; a foreign account's member can reach neither. Still
-- single (u2), active in A, from (b) above.
-- ---------------------------------------------------------------------------
insert into results (name, passed)
select '(c) storage: single CAN read the shared photo object (1 row)',
       (select count(*) from storage.objects where id = (select value::uuid from ids where name = 'obj_shared')) = 1;

insert into results (name, passed)
select '(c) storage: single CANNOT read the private_parent photo object (AC 4''s own falsifiable: 0 rows required)',
       (select count(*) from storage.objects where id = (select value::uuid from ids where name = 'obj_private')) = 0;

-- Positive control: the admin (whose role is NOT 'single') CAN reach the
-- private_parent object — proves the denial above is the role check, not a
-- broken bucket.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e5111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into results (name, passed)
select '(c) storage: parent_admin (not single) CAN read the private_parent photo object (positive control)',
       (select count(*) from storage.objects where id = (select value::uuid from ids where name = 'obj_private')) = 1;

-- A THIRD, fully unrelated account: reaches neither object at all.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e5333333-3333-3333-3333-333333333333","role":"authenticated"}';

insert into results (name, passed)
select '(c) storage: a foreign account''s member reads zero rows for the shared object',
       (select count(*) from storage.objects where id = (select value::uuid from ids where name = 'obj_shared')) = 0;

insert into results (name, passed)
select '(c) storage: a foreign account''s member reads zero rows for the private_parent object',
       (select count(*) from storage.objects where id = (select value::uuid from ids where name = 'obj_private')) = 0;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e5111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- (d) AC 6: exactly three "Documents photos …" policies exist (select,
-- insert, delete — no update). Policy-shape, independent of the
-- behavioural checks above, mirroring documents_storage.sql's own (f) group.
-- ---------------------------------------------------------------------------
insert into results (name, passed, detail)
select
  '(d) storage: exactly 3 "Documents photos …" policies exist on storage.objects (select/insert/delete)',
  count(*) = 3,
  string_agg(policyname || ':' || cmd, ', ')
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'Documents photos %';

-- ---------------------------------------------------------------------------
-- (e) Constraints. resume_photos_visibility_check rejects 'private_single'
-- (it means nothing here — the uploader IS the process manager);
-- resume_photos_storage_path_scope_check rejects a mismatched account
-- prefix, exactly like entity_files_storage_path_scope_check.
-- ---------------------------------------------------------------------------
do $$
declare v_resume_id bigint;
begin
  select r.id into v_resume_id from public.resumes r where r.shidduchim_id = (select value::bigint from ids where name = 'shidduch_id');
  begin
    insert into public.resume_photos (account_id, resume_id, path, visibility)
    values ((select value::bigint from ids where name = 'acct_a'), v_resume_id, (select value from ids where name = 'acct_a') || '/photos/private_single/x/y.jpg', 'private_single');
    insert into results values ('(e) constraint: a resume_photos row with visibility=private_single is rejected', false, 'insert unexpectedly succeeded');
  exception when others then
    insert into results values (
      '(e) constraint: a resume_photos row with visibility=private_single is rejected',
      sqlerrm like '%resume_photos_visibility_check%', sqlerrm
    );
  end;
end $$;

do $$
declare
  v_resume_id bigint;
  v_acct_b text;
begin
  select r.id into v_resume_id from public.resumes r where r.shidduchim_id = (select value::bigint from ids where name = 'shidduch_id');
  select value into v_acct_b from ids where name = 'acct_b';
  begin
    insert into public.resume_photos (account_id, resume_id, path, visibility)
    values ((select value::bigint from ids where name = 'acct_a'), v_resume_id, v_acct_b || '/photos/shared/x/mismatched.jpg', 'shared');
    insert into results values ('(e) constraint: a path not prefixed with the row''s own account_id is rejected', false, 'insert unexpectedly succeeded');
  exception when others then
    insert into results values (
      '(e) constraint: a path not prefixed with the row''s own account_id is rejected',
      sqlerrm like '%resume_photos_storage_path_scope_check%', sqlerrm
    );
  end;
end $$;

-- ---------------------------------------------------------------------------
-- (g) anon: zero rows, zero privileges — same posture as entity_files.
-- ---------------------------------------------------------------------------
reset role;
set local role anon;

do $$
begin
  perform count(*) from public.resume_photos;
  insert into results values ('(g) anon: reads zero resume_photos rows (SELECT itself is denied)', false, 'SELECT unexpectedly succeeded');
exception when others then
  insert into results values ('(g) anon: reads zero resume_photos rows (SELECT itself is denied)', true, sqlerrm);
end $$;

reset role;

insert into results (name, passed)
select '(g) anon: holds no privilege on public.resume_photos',
       not exists (
         select 1 from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'resume_photos' and grantee = 'anon'
       );

-- ---------------------------------------------------------------------------
-- Emit the report as a single JSON array line, then undo everything.
-- ---------------------------------------------------------------------------
\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
