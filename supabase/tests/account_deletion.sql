-- Proof for the authenticated account deletion RPC.
\set ON_ERROR_STOP on
begin;

create temporary table deletion_checks (
  name text not null,
  passed boolean not null,
  detail text
) on commit drop;
grant all on deletion_checks to public;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('d3d30000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delete-owner@test.invalid'),
  ('d3d30000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delete-other@test.invalid');

insert into public.accounts (name, kind) values ('delete owner hh', 'household') returning id as own_acct \gset
insert into public.accounts (name, kind) values ('delete other hh', 'household') returning id as other_acct \gset
insert into public.account_members (account_id, user_id, role, status)
values (:'own_acct', 'd3d30000-0000-0000-0000-000000000001', 'parent_admin', 'active'),
       (:'other_acct', 'd3d30000-0000-0000-0000-000000000002', 'parent_admin', 'active');
insert into public.member_state (user_id, active_account_id)
values ('d3d30000-0000-0000-0000-000000000001', :'own_acct'),
       ('d3d30000-0000-0000-0000-000000000002', :'other_acct')
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

insert into public.inbox_items (account_id, source, raw_text)
values (:'own_acct', 'upload', 'owner inbox'),
       (:'other_acct', 'upload', 'other inbox');
insert into public.singles (account_id, first_name_en, status)
values (:'own_acct', 'Owner Single', 'active'),
       (:'other_acct', 'Other Single', 'active');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d3d30000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.delete_account_data(:'own_acct', 'd3d30000-0000-0000-0000-000000000001', false) as result \gset
reset role;

insert into deletion_checks
select 'the owner can delete the current account',
  (:'result'::jsonb ->> 'status') = 'completed'
  and (:'result'::jsonb ->> 'deleted_account_id') = :'own_acct',
  :'result';

insert into deletion_checks
select 'account deletion removes owned rows including inbox_items',
  not exists (select 1 from public.accounts where id = :'own_acct')
  and not exists (select 1 from public.inbox_items where account_id = :'own_acct')
  and not exists (select 1 from public.singles where account_id = :'own_acct');

insert into deletion_checks
select 'account deletion leaves another account untouched',
  exists (select 1 from public.accounts where id = :'other_acct')
  and exists (select 1 from public.inbox_items where account_id = :'other_acct')
  and exists (select 1 from public.singles where account_id = :'other_acct');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"d3d30000-0000-0000-0000-000000000002","role":"authenticated"}', true);
create function pg_temp.assert_delete_account_rejects_mismatch(p_account_id bigint)
returns void
language plpgsql
as $$
begin
  perform public.delete_account_data(
    p_account_id,
    'd3d30000-0000-0000-0000-000000000001',
    false
  );
  insert into deletion_checks values ('a mismatched caller cannot delete an account', false, 'call unexpectedly succeeded');
exception when insufficient_privilege then
  insert into deletion_checks values ('a mismatched caller cannot delete an account', true, sqlerrm);
when others then
  insert into deletion_checks values ('a mismatched caller cannot delete an account', false, sqlstate || ' ' || sqlerrm);
end $$;
select pg_temp.assert_delete_account_rejects_mismatch(:'other_acct'::bigint);
reset role;

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from deletion_checks;

rollback;
