-- Proof for the account data export repair. Before this, every one of these
-- calls raised insufficient_privilege for every caller, so check 1 is the
-- regression test for the guard and checks 2-3 for the three table references
-- that would have thrown 42P01 the moment the guard was fixed.
\set ON_ERROR_STOP on
begin;

create temporary table export_checks (
  name text not null,
  passed boolean not null,
  detail text
) on commit drop;
grant all on export_checks to public;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('e3e30000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'export-owner@test.invalid'),
  ('e3e30000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'export-stranger@test.invalid');

insert into public.accounts (name, kind) values ('export owner hh', 'household')
returning id as own_acct \gset
insert into public.accounts (name, kind) values ('export stranger hh', 'household')
returning id as other_acct \gset

insert into public.account_members (account_id, user_id, role, status)
values (:'own_acct', 'e3e30000-0000-0000-0000-000000000001', 'parent_admin', 'active'),
       (:'other_acct', 'e3e30000-0000-0000-0000-000000000002', 'parent_admin', 'active');
insert into public.member_state (user_id, active_account_id)
values ('e3e30000-0000-0000-0000-000000000001', :'own_acct'),
       ('e3e30000-0000-0000-0000-000000000002', :'other_acct')
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

-- One row on each side of the tenant boundary, in a table the export emits.
insert into public.singles (account_id, first_name_en, gender, status)
values (:'own_acct', 'Mine', 'female', 'active'),
       (:'other_acct', 'Theirs', 'female', 'active');
-- ...and one row in each of the three tables whose references were broken.
insert into public.single_notes (account_id, single_id, body)
select :'own_acct', id, 'own note' from public.singles where account_id = :'own_acct';
insert into public.account_deletion_requests
  (account_id, expires_at, requested_by_auth_uid)
values (:'own_acct', now() + interval '30 days', 'e3e30000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e3e30000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.export_full_account_bundle() as bundle \gset
reset role;

insert into export_checks
select 'an authenticated member can export the account bundle',
  (:'bundle'::jsonb ? 'data') and (:'bundle'::jsonb ? 'files')
  and (:'bundle'::jsonb ->> 'account_id') = :'own_acct',
  left(:'bundle', 120);

insert into export_checks
select 'the export emits the three repaired keys',
  (:'bundle'::jsonb -> 'data') ? 'single_notes'
  and (:'bundle'::jsonb -> 'data') ? 'date_records'
  and (:'bundle'::jsonb -> 'data') ? 'account_deletion_requests';

insert into export_checks
select 'the keys naming tables that never existed are gone',
  not ((:'bundle'::jsonb -> 'data') ? 'notes')
  and not ((:'bundle'::jsonb -> 'data') ? 'events')
  and not ((:'bundle'::jsonb -> 'data') ? 'deletion_requests');

insert into export_checks
select 'the repaired tables carry the caller''s own rows',
  jsonb_array_length(:'bundle'::jsonb -> 'data' -> 'single_notes') = 1
  and jsonb_array_length(:'bundle'::jsonb -> 'data' -> 'account_deletion_requests') = 1;

insert into export_checks
select 'the export is scoped to the caller''s own account',
  jsonb_array_length(:'bundle'::jsonb -> 'data' -> 'singles') = 1
  and ((:'bundle'::jsonb -> 'data' -> 'singles' -> 0) ->> 'first_name_en') = 'Mine';

-- The guard still has to say no. auth.uid() is null with no JWT set, which is
-- exactly what a service_role call looks like.
select set_config('request.jwt.claims', '', true);
do $$
begin
  perform public.export_account_data();
  insert into export_checks values
    ('a caller with no JWT is refused', false, 'export unexpectedly succeeded');
exception when insufficient_privilege then
  insert into export_checks values ('a caller with no JWT is refused', true, sqlerrm);
when others then
  insert into export_checks values
    ('a caller with no JWT is refused', false, sqlstate || ' ' || sqlerrm);
end $$;

do $$
begin
  perform public.export_account_files();
  insert into export_checks values
    ('the files export is refused the same way', false, 'export unexpectedly succeeded');
exception when insufficient_privilege then
  insert into export_checks values ('the files export is refused the same way', true, sqlerrm);
when others then
  insert into export_checks values
    ('the files export is refused the same way', false, sqlstate || ' ' || sqlerrm);
end $$;

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from export_checks;

rollback;
