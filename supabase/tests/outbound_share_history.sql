-- Story 0n5 policy proof: the disclosure ledger is a manager-only,
-- append-only, account-scoped handoff record.
\set ON_ERROR_STOP on
begin;

create temporary table outbound_checks (
  name text not null,
  passed boolean not null,
  detail text
) on commit drop;
grant all on outbound_checks to public;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('0a500000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outbound-parent@test.invalid'),
  ('0a500000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outbound-manager@test.invalid'),
  ('0a500000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outbound-helper@test.invalid'),
  ('0a500000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outbound-single@test.invalid'),
  ('0a500000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outbound-shadchan@test.invalid'),
  ('0a500000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outbound-other@test.invalid');

insert into public.accounts (name, kind) values ('outbound household', 'household') returning id as acct_a \gset
insert into public.accounts (name, kind) values ('outbound other household', 'household') returning id as acct_b \gset
insert into public.accounts (name, kind) values ('outbound shadchanus', 'shadchanus') returning id as acct_c \gset

insert into public.account_members (account_id, user_id, role, status)
values
  (:'acct_a', '0a500000-0000-0000-0000-000000000001', 'parent_admin', 'active'),
  (:'acct_a', '0a500000-0000-0000-0000-000000000002', 'self_manager', 'active'),
  (:'acct_a', '0a500000-0000-0000-0000-000000000003', 'helper', 'active'),
  (:'acct_a', '0a500000-0000-0000-0000-000000000004', 'single', 'active'),
  (:'acct_b', '0a500000-0000-0000-0000-000000000006', 'parent_admin', 'active'),
  (:'acct_c', '0a500000-0000-0000-0000-000000000005', 'shadchan', 'active');
select id as parent_member from public.account_members where account_id = :'acct_a' and user_id = '0a500000-0000-0000-0000-000000000001' \gset
select id as manager_member from public.account_members where account_id = :'acct_a' and user_id = '0a500000-0000-0000-0000-000000000002' \gset
select id as helper_member from public.account_members where account_id = :'acct_a' and user_id = '0a500000-0000-0000-0000-000000000003' \gset
select id as single_member from public.account_members where account_id = :'acct_a' and user_id = '0a500000-0000-0000-0000-000000000004' \gset

insert into public.member_state (user_id, active_account_id)
values
  ('0a500000-0000-0000-0000-000000000001', :'acct_a'),
  ('0a500000-0000-0000-0000-000000000002', :'acct_a'),
  ('0a500000-0000-0000-0000-000000000003', :'acct_a'),
  ('0a500000-0000-0000-0000-000000000004', :'acct_a'),
  ('0a500000-0000-0000-0000-000000000005', :'acct_c'),
  ('0a500000-0000-0000-0000-000000000006', :'acct_b')
on conflict (user_id) do update set active_account_id = excluded.active_account_id;

insert into public.singles (account_id, first_name_en, member_id)
values (:'acct_a', 'Manager Single', :'manager_member') returning id as manager_single \gset
insert into public.singles (account_id, first_name_en, member_id)
values (:'acct_a', 'Other Member Single', :'single_member') returning id as other_single \gset
insert into public.singles (account_id, first_name_en)
values (:'acct_b', 'Other Account Single') returning id as other_account_single \gset
insert into public.shadchanim (account_id, name)
values (:'acct_a', 'Aunty Ronit') returning id as ronit \gset
insert into public.shadchanim (account_id, name)
values (:'acct_b', 'Other Aunty') returning id as other_shadchan \gset

insert into public.outbound_share_history
  (account_id, single_id, shadchan_id, actor_member_id, channel, file_kinds, outcome)
values
  (:'acct_a', :'manager_single', :'ronit', :'parent_member', 'whatsapp', array['resume'], 'download_prepared'),
  (:'acct_b', :'other_account_single', :'other_shadchan', null, 'email', array['resume'], 'cancelled');

create function pg_temp.assert_insert_denied(
  p_label text,
  p_account_id bigint,
  p_single_id bigint,
  p_shadchan_id bigint,
  p_actor_member_id bigint
)
returns void language plpgsql as $$
begin
  insert into public.outbound_share_history
    (account_id, single_id, shadchan_id, actor_member_id, channel, file_kinds, outcome)
  values (p_account_id, p_single_id, p_shadchan_id, p_actor_member_id, 'sms', array['resume'], 'failed');
  insert into outbound_checks values (p_label, false, 'insert unexpectedly succeeded');
exception when others then
  insert into outbound_checks values (p_label, true, sqlstate || ' ' || sqlerrm);
end;
$$;

create function pg_temp.assert_mutation_denied(p_label text, p_operation text, p_id bigint)
returns void language plpgsql as $$
begin
  if p_operation = 'update' then
    update public.outbound_share_history set outcome = 'failed' where id = p_id;
  else
    delete from public.outbound_share_history where id = p_id;
  end if;
  insert into outbound_checks values (p_label, false, p_operation || ' unexpectedly succeeded');
exception when others then
  insert into outbound_checks values (p_label, true, sqlstate || ' ' || sqlerrm);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a500000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.current_member_role() = 'parent_admin' as parent_role \gset
insert into outbound_checks values ('parent admin resolves as a manager', :'parent_role', public.current_member_role());
insert into public.outbound_share_history
  (account_id, single_id, shadchan_id, actor_member_id, channel, file_kinds, outcome)
values (:'acct_a', :'manager_single', :'ronit', :'helper_member', 'whatsapp', array['resume','photo'], 'share_sheet_opened')
returning id as inserted_id \gset
insert into outbound_checks
select 'manager can insert in the active account', count(*) = 1, count(*)::text
from public.outbound_share_history where id = :'inserted_id' and account_id = :'acct_a';
insert into outbound_checks
select 'actor_member_id cannot be spoofed', actor_member_id = :'parent_member', actor_member_id::text
from public.outbound_share_history where id = :'inserted_id';
insert into outbound_checks
select 'manager can select own account rows', count(*) >= 2, count(*)::text
from public.outbound_share_history where account_id = :'acct_a';
insert into outbound_checks
select 'manager cannot select another account', count(*) = 0, count(*)::text
from public.outbound_share_history where account_id = :'acct_b';
select pg_temp.assert_insert_denied('another account cannot be inserted by this manager', :'acct_b', :'other_account_single', :'other_shadchan', :'parent_member');
select pg_temp.assert_mutation_denied('authenticated manager cannot update history', 'update', :'inserted_id');
select pg_temp.assert_mutation_denied('authenticated manager cannot delete history', 'delete', :'inserted_id');

select set_config('request.jwt.claims', '{"sub":"0a500000-0000-0000-0000-000000000003","role":"authenticated"}', true);
insert into outbound_checks values ('helper role resolves correctly', public.current_member_role() = 'helper', public.current_member_role());
insert into outbound_checks select 'helper cannot select history', count(*) = 0, count(*)::text from public.outbound_share_history;
select pg_temp.assert_insert_denied('helper cannot insert history', :'acct_a', :'manager_single', :'ronit', :'helper_member');

select set_config('request.jwt.claims', '{"sub":"0a500000-0000-0000-0000-000000000004","role":"authenticated"}', true);
insert into outbound_checks values ('single role resolves correctly', public.current_member_role() = 'single', public.current_member_role());
insert into outbound_checks select 'single cannot select history', count(*) = 0, count(*)::text from public.outbound_share_history;
select pg_temp.assert_insert_denied('single cannot insert history', :'acct_a', :'manager_single', :'ronit', :'single_member');

select set_config('request.jwt.claims', '{"sub":"0a500000-0000-0000-0000-000000000005","role":"authenticated"}', true);
insert into outbound_checks values ('shadchan role resolves correctly', public.current_member_role() = 'shadchan', public.current_member_role());
insert into outbound_checks select 'shadchan context cannot select history', count(*) = 0, count(*)::text from public.outbound_share_history;
select pg_temp.assert_insert_denied('shadchan context cannot insert history', :'acct_a', :'manager_single', :'ronit', null);

select set_config('request.jwt.claims', '{"sub":"0a500000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select pg_temp.assert_insert_denied('self_manager cannot insert for a different member single', :'acct_a', :'other_single', :'ronit', :'manager_member');

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from outbound_checks;

rollback;
