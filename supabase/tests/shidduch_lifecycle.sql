-- Delete/archive lifecycle: tombstone, grants, lock order, and durable purge.
-- The suite is intentionally SQL-first: every security boundary is exercised
-- through authenticated/service_role sessions rather than a TypeScript mock.

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;

insert into auth.users (id, instance_id, aud, role, email)
values ('5a111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '5xr@test.local')
on conflict (id) do nothing;

delete from public.account_members;

insert into public.accounts (name, kind) values ('5xr A', 'household') returning id as acct_a \gset
insert into public.accounts (name, kind) values ('5xr B', 'household') returning id as acct_b \gset
insert into ids values ('acct_a', :'acct_a'), ('acct_b', :'acct_b');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, '5a111111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, '5a111111-1111-1111-1111-111111111111', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"5a111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.set_active_context((select value::bigint from ids where name = 'acct_a'));

insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, '5xr', 'Single') returning id as single_id \gset
insert into ids values ('single_id', :'single_id');

select id as shidduch_id
from public.create_shidduch(
  p_single_id => :single_id,
  p_name_en => '5xr Suggestion',
  p_person_gender => 'male'
)
\gset
insert into ids values ('shidduch_id', :'shidduch_id');

insert into results
select 'normal create_shidduch succeeds while base INSERT is revoked',
  exists (select 1 from public.shidduchim where id = (select value::bigint from ids where name = 'shidduch_id'));

do $$
begin
  insert into public.shidduchim (id, account_id, single_id, name_en)
  values (999999999, (select value::bigint from ids where name = 'acct_a'), (select value::bigint from ids where name = 'single_id'), 'old id');
  insert into results values ('authenticated base INSERT and explicit old id are denied', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values ('authenticated base INSERT and explicit old id are denied', true, sqlerrm);
end $$;

insert into results
select 'authenticated base DELETE is denied',
  not has_table_privilege('authenticated', 'public.shidduchim', 'DELETE'), null;

do $$
begin
  update public.shidduchim
  set id = 999999998
  where id = (select value::bigint from ids where name = 'shidduch_id');
  insert into results values ('authenticated id UPDATE is denied', false, 'id update unexpectedly succeeded');
exception when others then
  insert into results values ('authenticated id UPDATE is denied', true, sqlerrm);
end $$;

select pipeline_state as before_state
from public.shidduchim
where id = (select value::bigint from ids where name = 'shidduch_id')
\gset
select archived_at is not null as archive_marked, pipeline_state::text as archive_pipeline
from public.archive_shidduch((select value::bigint from ids where name = 'shidduch_id'))
\gset
insert into results values ('archive changes only archived_at',
  :'archive_marked'::boolean and :'archive_pipeline' = :'before_state', null);
select archived_at is null as restored, pipeline_state::text as restore_pipeline
from public.restore_shidduch((select value::bigint from ids where name = 'shidduch_id'))
\gset
insert into results values ('restore preserves pipeline_state',
  :'restored'::boolean and :'restore_pipeline' = :'before_state', null);

-- An unexpired read attempt blocks deletion; an expired lease does not.
set local role postgres;
insert into public.resumes (account_id, shidduchim_id, files)
values (:acct_a, (select value::bigint from ids where name = 'shidduch_id'),
  jsonb_build_array(jsonb_build_object('path', :'acct_a' || '/resumes/' || (select value from ids where name = 'shidduch_id') || '/resume.pdf')))
returning id as resume_id \gset
insert into public.ai_reread_attempts (account_id, resume_id, request_id, period, status, lease_expires_at)
values (:acct_a, :resume_id, '5a222222-2222-2222-2222-222222222222', to_char(now(), 'YYYY-MM'), 'in_progress', now() + interval '5 minutes');
set local role authenticated;
do $$
begin
  perform public.delete_shidduch((select value::bigint from ids where name = 'shidduch_id'));
  insert into results values ('unexpired AI read refuses delete', false, 'delete unexpectedly succeeded');
exception when others then
  insert into results values ('unexpired AI read refuses delete', sqlerrm like '%read%' or sqlerrm like '%progress%', sqlerrm);
end $$;
set local role postgres;
update public.ai_reread_attempts set lease_expires_at = now() - interval '1 second';
set local role authenticated;

select public.delete_shidduch((select value::bigint from ids where name = 'shidduch_id'));
set local role postgres;
insert into results
select 'delete writes permanent tombstone',
  exists (select 1 from public.deleted_shidduch_tombstones
          where account_id = (select value::bigint from ids where name = 'acct_a')
            and shidduch_id = (select value::bigint from ids where name = 'shidduch_id'));
insert into results
select 'delete queues all four owned prefixes',
  (select count(*) from public.storage_purge_queue
   where account_id = (select value::bigint from ids where name = 'acct_a')
     and kind = 'prefix') >= 4;

set local role authenticated;
select id as direct_delete_id
from public.create_shidduch(
  p_single_id => (select value::bigint from ids where name = 'single_id'),
  p_name_en => 'Direct delete trigger probe',
  p_person_gender => 'male'
)
\gset
set local role postgres;
delete from public.shidduchim where id = :'direct_delete_id';
insert into results
select 'direct base DELETE writes a tombstone',
  exists (select 1 from public.deleted_shidduch_tombstones
          where account_id = (select value::bigint from ids where name = 'acct_a')
            and shidduch_id = :'direct_delete_id');

set local role authenticated;
select kind as prefix_kind, bucket as prefix_bucket, storage_path as prefix_path
from public.claim_shidduch_storage_purge()
where kind = 'prefix'
order by id
limit 1
\gset
select public.ack_shidduch_storage_purge(:'prefix_kind', :'prefix_bucket', :'prefix_path') as prefix_first_ack
\gset
set local role postgres;
insert into results
select 'first prefix sweep advances to phase 2 without deleting its queue row',
  :'prefix_first_ack'::boolean
  and exists (
    select 1 from public.storage_purge_queue
    where kind = 'prefix' and bucket = :'prefix_bucket' and storage_path = :'prefix_path'
      and phase = 2 and not_before > now()
  );
update public.storage_purge_queue
set not_before = now()
where kind = 'prefix' and bucket = :'prefix_bucket' and storage_path = :'prefix_path';
set local role authenticated;
select kind as prefix_kind2, bucket as prefix_bucket2, storage_path as prefix_path2
from public.claim_shidduch_storage_purge()
where kind = 'prefix' and bucket = :'prefix_bucket' and storage_path = :'prefix_path'
\gset
select public.ack_shidduch_storage_purge(:'prefix_kind2', :'prefix_bucket2', :'prefix_path2') as prefix_second_ack
\gset
set local role postgres;
insert into results
select 'second prefix sweep acknowledges the exact queue row',
  :'prefix_second_ack'::boolean
  and not exists (
    select 1 from public.storage_purge_queue
    where kind = 'prefix' and bucket = :'prefix_bucket' and storage_path = :'prefix_path'
  );
do $$
begin
  insert into public.storage_purge_queue (account_id, kind, bucket, storage_path)
  values ((select value::bigint from ids where name = 'acct_a'), 'prefix', 'documents',
          (select value from ids where name = 'acct_a') || '/resumes/77');
  insert into results values ('prefix grammar rejects a missing trailing separator', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values ('prefix grammar rejects a missing trailing separator', true, sqlerrm);
end $$;

set local role authenticated;
do $$
begin
  insert into storage.objects (bucket_id, name, owner)
  values (
    'documents',
    (select value from ids where name = 'acct_a') || '/resumes/'
      || (select value from ids where name = 'shidduch_id') || '/late.pdf',
    '5a111111-1111-1111-1111-111111111111'
  );
  insert into results values ('Storage PUT after delete is rejected by tombstone', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values ('Storage PUT after delete is rejected by tombstone', true, sqlerrm);
end $$;

do $$
begin
  insert into public.entity_files (target_type, target_id, storage_path, file_name, mime_type, size_bytes)
  values ('shidduch', (select value::bigint from ids where name = 'shidduch_id'),
          (select value from ids where name = 'acct_a') || '/shadchan/' || (select value from ids where name = 'shidduch_id') || '/wrong.pdf',
          'wrong.pdf', 'application/pdf', 1);
  insert into results values ('entity_files rejects target/path mismatch after delete', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values ('entity_files rejects target/path mismatch after delete', true, sqlerrm);
end $$;

do $$
begin
  insert into public.entity_files (target_type, target_id, storage_path, file_name, mime_type, size_bytes)
  values ('shidduch', (select value::bigint from ids where name = 'shidduch_id'),
          (select value from ids where name = 'acct_a') || '/shidduch/'
            || (select value from ids where name = 'shidduch_id') || '/late.pdf',
          'late.pdf', 'application/pdf', 1);
  insert into results values ('entity_files insert after delete is rejected', false, 'insert unexpectedly succeeded');
exception when others then
  insert into results values ('entity_files insert after delete is rejected', true, sqlerrm);
end $$;

set local role postgres;
insert into results
select 'tombstone client INSERT is denied',
  not has_table_privilege('authenticated', 'public.deleted_shidduch_tombstones', 'INSERT');
insert into results
select 'lifecycle queue tables use FORCE RLS',
  (select c.relforcerowsecurity from pg_class c
   where c.oid = 'public.deleted_shidduch_tombstones'::regclass)
  and (select c.relforcerowsecurity from pg_class c
       where c.oid = 'public.storage_purge_queue'::regclass);
insert into results
select 'authenticated can read archived_at but not sequence writes',
  has_column_privilege('authenticated', 'public.shidduchim', 'archived_at', 'SELECT')
  and not has_sequence_privilege('authenticated', 'public.shidduchim_id_seq', 'USAGE')
  and not has_sequence_privilege('authenticated', 'public.shidduchim_id_seq', 'SELECT');
insert into results
select 'lifecycle RPCs are not public or anonymous',
  not has_function_privilege('public', 'public.archive_shidduch(bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.archive_shidduch(bigint)', 'EXECUTE')
  and not has_function_privilege('public', 'public.delete_shidduch(bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.delete_shidduch(bigint)', 'EXECUTE')
  and not has_function_privilege('public', 'public.ack_shidduch_storage_purge(text,text,text,bigint,bigint,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.ack_shidduch_storage_purge(text,text,text,bigint,bigint,timestamptz)', 'EXECUTE');
insert into results
select 'queue is a live account cleanup obligation',
  public.account_has_domain_data((select value::bigint from ids where name = 'acct_a'));

select json_agg(row_to_json(results) order by name) from results;
rollback;
