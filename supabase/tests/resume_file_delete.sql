-- Resume-tab per-file Delete — authorization, exact-path, lock and purge
-- atomicity. All fixtures live in one transaction and are rolled back.

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('2a811111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'resume-delete-a@test.local'),
  ('2a822222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'resume-delete-b@test.local'),
  ('2a833333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'resume-delete-single@test.local')
on conflict (id) do nothing;

delete from public.account_members;

set local role service_role;
insert into public.accounts (name, kind) values ('Resume delete A', 'household') returning id as account_a \gset
insert into public.accounts (name, kind) values ('Resume delete B', 'household') returning id as account_b \gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_a, '2a811111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:account_b, '2a822222-2222-2222-2222-222222222222', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:account_a, '2a833333-3333-3333-3333-333333333333', 'single', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"2a811111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.set_active_context(:account_a);
insert into public.singles (account_id, first_name_en)
values (:account_a, 'Resume delete A') returning id as single_a \gset
select id as shidduch_a
from public.create_shidduch(
  p_single_id => :single_a,
  p_name_en => 'Resume delete A suggestion',
  p_person_gender => 'male'
) \gset

set local request.jwt.claims = '{"sub":"2a822222-2222-2222-2222-222222222222","role":"authenticated"}';
select public.set_active_context(:account_b);
insert into public.singles (account_id, first_name_en)
values (:account_b, 'Resume delete B') returning id as single_b \gset
select id as shidduch_b
from public.create_shidduch(
  p_single_id => :single_b,
  p_name_en => 'Resume delete B suggestion',
  p_person_gender => 'male'
) \gset

set local role postgres;
insert into public.resumes (account_id, shidduchim_id, files, sections, extracted)
values (
  :account_a,
  :shidduch_a,
  jsonb_build_array(
    jsonb_build_object('path', :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf', 'filename', 'old.pdf', 'uploaded_at', '2026-01-01T00:00:00Z', 'mime_type', 'application/pdf', 'size', 8),
    jsonb_build_object('path', :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf', 'filename', 'old-alias.pdf', 'uploaded_at', '2026-01-02T00:00:00Z', 'mime_type', 'application/pdf', 'size', 88),
    jsonb_build_object('path', :account_a::text || '/resumes/' || :shidduch_a::text || '/new.pdf', 'filename', 'new.pdf', 'uploaded_at', '2026-02-01T00:00:00Z', 'mime_type', 'application/pdf', 'size', 9)
  ),
  '{"keep":"sections"}'::jsonb,
  '{"keep":"extracted"}'::jsonb
) returning id as resume_a \gset
insert into public.resumes (account_id, shidduchim_id, files)
values (
  :account_b,
  :shidduch_b,
  jsonb_build_array(jsonb_build_object('path', :account_b::text || '/resumes/' || :shidduch_b::text || '/other.pdf', 'filename', 'other.pdf', 'uploaded_at', '2026-01-01T00:00:00Z', 'mime_type', 'application/pdf', 'size', 7))
) returning id as resume_b \gset
insert into public.ai_reread_attempts (account_id, resume_id, file_identity, request_id, period, status, lease_expires_at)
values (:account_a, :resume_a, :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf', '2a844444-4444-4444-4444-444444444444', to_char(now(), 'YYYY-MM'), 'in_progress', now() + interval '5 minutes');

create or replace function pg_temp.expect_remove_error(
  p_name text,
  p_resume_id bigint,
  p_path text,
  p_size bigint,
  p_uploaded_at timestamptz,
  p_expected text,
  p_delete_token text default repeat('a', 64)
) returns void
language plpgsql
security definer
set search_path = pg_temp, public
as $fn$
declare
  message text;
begin
  begin
  perform public.remove_resume_file(p_resume_id, p_path, p_size, p_uploaded_at, p_delete_token);
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics message = message_text;
    insert into results values (p_name, message = p_expected, message);
  end;
end
$fn$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"2a811111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.set_active_context(:account_a);
select pg_temp.expect_remove_error(
  'cross-account resume is refused',
  :resume_b,
  :account_b::text || '/resumes/' || :shidduch_b::text || '/other.pdf',
  7,
  '2026-01-01T00:00:00Z',
  'resume not found'
);
select pg_temp.expect_remove_error(
  'unknown path is refused',
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/missing.pdf',
  0,
  '2026-01-01T00:00:00Z',
  'resume file not found'
);
select pg_temp.expect_remove_error(
  'traversal path is refused',
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/../escape.pdf',
  0,
  '2026-01-01T00:00:00Z',
  'resume file not found'
);
select pg_temp.expect_remove_error(
  'other resume prefix is refused',
  :resume_a,
  :account_a::text || '/resumes/999999/other.pdf',
  0,
  '2026-01-01T00:00:00Z',
  'resume file not found'
);
select pg_temp.expect_remove_error(
  'empty path is refused',
  :resume_a,
  '',
  0,
  '2026-01-01T00:00:00Z',
  'resume file not found'
);
select pg_temp.expect_remove_error(
  'null path is refused',
  :resume_a,
  NULL,
  0,
  '2026-01-01T00:00:00Z',
  'resume file not found'
);
select pg_temp.expect_remove_error(
  'unicode path is refused',
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/résumé.pdf',
  0,
  '2026-01-01T00:00:00Z',
  'resume file not found'
);
select pg_temp.expect_remove_error(
  'huge path is refused',
  :resume_a,
  repeat('x', 10000),
  0,
  '2026-01-01T00:00:00Z',
  'resume file not found'
);
select pg_temp.expect_remove_error(
  'in-flight read is refused',
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf',
  8,
  '2026-01-01T00:00:00Z',
  'Please wait: this resume is being made easy to read.'
);
set local role postgres;
update public.ai_reread_attempts
set lease_expires_at = now() - interval '1 second'
where resume_id = :resume_a;
set local role authenticated;
set local request.jwt.claims = '{"sub":"2a811111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.set_active_context(:account_a);
select pg_temp.expect_remove_error(
  'identity mismatch is refused without changing the row',
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf',
  999,
  '2026-01-01T00:00:00Z',
  'resume file changed'
);

set local request.jwt.claims = '{"sub":"2a833333-3333-3333-3333-333333333333","role":"authenticated"}';
select public.set_active_context(:account_a);
select pg_temp.expect_remove_error(
  'single role is refused',
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf',
  8,
  '2026-01-01T00:00:00Z',
  'remove_resume_file requires an owning manager'
);

set local role postgres;
update public.ai_reread_attempts
set lease_expires_at = now() - interval '1 second'
where resume_id = :resume_a;
update public.resumes
set files = files || jsonb_build_array(jsonb_build_object(
  'path', :account_a::text || '/resumes/' || :shidduch_a::text || '/rollback.pdf',
  'filename', 'rollback.pdf', 'uploaded_at', '2026-03-01T00:00:00Z',
  'mime_type', 'application/pdf', 'size', 10
))
where id = :resume_a;
create or replace function pg_temp.fail_resume_delete_queue()
returns trigger
language plpgsql
as $fn$
begin
  if new.storage_path like '%/rollback.pdf' then
    raise exception 'queue failure sentinel';
  end if;
  return new;
end
$fn$;
create trigger resume_delete_queue_failure
before insert on public.storage_purge_queue
for each row execute function pg_temp.fail_resume_delete_queue();
set local role authenticated;
set local request.jwt.claims = '{"sub":"2a811111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.set_active_context(:account_a);
select pg_temp.expect_remove_error(
  'queue failure rolls back the JSONB change',
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/rollback.pdf',
  10,
  '2026-03-01T00:00:00Z',
  'queue failure sentinel'
);
set local role postgres;
insert into results
select 'queue failure left the file and no queue row',
  exists (
    select 1 from public.resumes r, jsonb_array_elements(r.files) f
    where r.id = :resume_a and f->>'path' = :account_a::text || '/resumes/' || :shidduch_a::text || '/rollback.pdf'
  )
  and not exists (
    select 1 from public.storage_purge_queue
    where storage_path = :account_a::text || '/resumes/' || :shidduch_a::text || '/rollback.pdf'
  ),
  null;
drop trigger resume_delete_queue_failure on public.storage_purge_queue;
drop function pg_temp.fail_resume_delete_queue();
update public.resumes
set files = (
  select coalesce(jsonb_agg(f.value order by f.ordinality), '[]'::jsonb)
  from jsonb_array_elements(files) with ordinality f(value, ordinality)
  where f.value->>'path' <> :account_a::text || '/resumes/' || :shidduch_a::text || '/rollback.pdf'
)
where id = :resume_a;

select * from public.remove_resume_file(
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf'
  ,8,
  '2026-01-01T00:00:00Z',
  repeat('a', 64)
);
set local role postgres;
insert into results
select 'first call removes only the exact duplicate identity and keeps the resume row',
  ((select files from public.resumes where id = :resume_a) @> jsonb_build_array(
    jsonb_build_object('path', :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf', 'size', 88),
    jsonb_build_object('path', :account_a::text || '/resumes/' || :shidduch_a::text || '/new.pdf')
  ))
  and jsonb_array_length((select files from public.resumes where id = :resume_a)) = 2
  and exists (select 1 from public.resumes where id = :resume_a)
  and (select sections from public.resumes where id = :resume_a) = '{"keep":"sections"}'::jsonb
  and (select extracted from public.resumes where id = :resume_a) = '{"keep":"extracted"}'::jsonb,
  null;
insert into results
select 'first call queues exactly the removed object',
  (select count(*) from public.storage_purge_queue where account_id = :account_a and kind = 'object' and bucket = 'documents') = 1
  and exists (select 1 from public.storage_purge_queue where account_id = :account_a and storage_path = :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf')
  and not exists (select 1 from public.storage_purge_queue where account_id = :account_a and storage_path = :account_a::text || '/resumes/' || :shidduch_a::text || '/new.pdf'),
  null;
insert into results
select 'extended remove_resume_file preserves the shidduch branch',
  exists (select 1 from public.resumes where id = :resume_a and shidduchim_id = :shidduch_a and single_id is null)
  and jsonb_array_length((select files from public.resumes where id = :resume_a)) = 2
  and exists (select 1 from public.storage_purge_queue where resume_id = :resume_a and storage_path = :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf'),
  null;

set local role postgres;
insert into public.storage_purge_queue (
  account_id, kind, bucket, storage_path, resume_id, file_size, file_uploaded_at
) values (
  :account_a, 'object', 'documents',
  :account_a::text || '/resumes/' || :shidduch_a::text || '/wrong-identity.pdf',
  :resume_b, 7, '2026-01-01T00:00:00Z'
);
set local role authenticated;
select public.set_active_context(:account_a);
select pg_temp.expect_remove_error(
  'queue identity mismatch is not an idempotent success',
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/wrong-identity.pdf',
  7,
  '2026-01-01T00:00:00Z',
  'resume file not found'
);
set local role postgres;
delete from public.storage_purge_queue
where account_id = :account_a
  and storage_path = :account_a::text || '/resumes/' || :shidduch_a::text || '/wrong-identity.pdf';

set local role authenticated;
select * from public.remove_resume_file(
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf'
  ,8,
  '2026-01-01T00:00:00Z',
  repeat('a', 64)
);
set local role postgres;
insert into results
select 'same-token retry is idempotent',
  jsonb_array_length((select files from public.resumes where id = :resume_a)) = 2
  and (select count(*) from public.storage_purge_queue where account_id = :account_a and kind = 'object' and bucket = 'documents') = 1,
  null;

set local role authenticated;
select * from public.remove_resume_file(
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf'
  ,88,
  '2026-01-02T00:00:00Z',
  repeat('b', 64)
);
select * from public.remove_resume_file(
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/new.pdf'
  ,9,
  '2026-02-01T00:00:00Z',
  repeat('c', 64)
);
set local role postgres;
update public.resumes
set files = jsonb_build_array(jsonb_build_object(
  'path', :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf',
  'filename', 'reused.pdf', 'uploaded_at', '2026-04-01T00:00:00Z',
  'mime_type', 'application/pdf', 'size', 777
))
where id = :resume_a;
set local role authenticated;
select public.set_active_context(:account_a);
select pg_temp.expect_remove_error(
  'metadata reuse is refused by the existing path queue key',
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf',
  777,
  '2026-04-01T00:00:00Z',
  'resume file changed',
  repeat('d', 64)
);
set local role postgres;
insert into results
select 'metadata reuse leaves the replacement file and old queue identity intact',
  (select count(*) from public.resumes r, jsonb_array_elements(r.files) f
   where r.id = :resume_a
     and f->>'path' = :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf'
     and (f->>'size')::bigint = 777
     and f->>'uploaded_at' = '2026-04-01T00:00:00Z') = 1
  and (select file_size from public.storage_purge_queue
       where account_id = :account_a
         and resume_id = :resume_a
         and storage_path = :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf') = 88
  and (select file_uploaded_at from public.storage_purge_queue
       where account_id = :account_a
         and resume_id = :resume_a
         and storage_path = :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf') = '2026-01-02T00:00:00Z'::timestamptz,
  null;

delete from public.storage_purge_queue
where account_id = :account_a
  and resume_id = :resume_a
  and storage_path = :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf';
set local role authenticated;
select * from public.remove_resume_file(
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf',
  777,
  '2026-04-01T00:00:00Z',
  repeat('d', 64)
);

set local role service_role;
insert into public.storage_purge_queue (
  account_id, kind, bucket, storage_path, resume_id, file_size,
  file_uploaded_at, claimed_at, attempt
) values (
  :account_a, 'object', 'documents',
  :account_a::text || '/resumes/' || :shidduch_a::text || '/ack-test.pdf',
  :resume_a, 123, '2026-05-01T00:00:00Z', now(), 1
);
set local role authenticated;
select public.set_active_context(:account_a);
insert into results
select 'purge acknowledgement rejects the wrong identity',
  not public.ack_shidduch_storage_purge(
    'object', 'documents',
    :account_a::text || '/resumes/' || :shidduch_a::text || '/ack-test.pdf',
    :resume_a, 124, '2026-05-01T00:00:00Z'
  ),
  null;
insert into results
select 'purge acknowledgement accepts the exact identity',
  public.ack_shidduch_storage_purge(
    'object', 'documents',
    :account_a::text || '/resumes/' || :shidduch_a::text || '/ack-test.pdf',
    :resume_a, 123, '2026-05-01T00:00:00Z'
  ),
  null;
insert into results
select 'purge acknowledgement removes the exact queue row',
  not exists (
    select 1 from public.storage_purge_queue
    where account_id = :account_a
      and resume_id = :resume_a
      and storage_path = :account_a::text || '/resumes/' || :shidduch_a::text || '/ack-test.pdf'
  ),
  null;

set local role postgres;
insert into results
select 'last file leaves empty files and preserves the resume row',
  (select files from public.resumes where id = :resume_a) = '[]'::jsonb
  and exists (select 1 from public.resumes where id = :resume_a),
  null;
insert into results
select 'queue contains both removed objects and no foreign object',
  (select count(*) from public.storage_purge_queue where account_id = :account_a and kind = 'object' and bucket = 'documents') = 2
  and not exists (select 1 from public.storage_purge_queue where account_id = :account_b),
  null;
insert into results
select 'RPC is manager-only and queue remains FORCE RLS',
  not has_function_privilege('public', 'public.remove_resume_file(bigint,text,bigint,timestamptz,text)', 'execute')
  and not has_function_privilege('anon', 'public.remove_resume_file(bigint,text,bigint,timestamptz,text)', 'execute')
  and (select relforcerowsecurity from pg_class where oid = 'public.storage_purge_queue'::regclass),
  null;
insert into results
select 'legacy two-argument RPC is gone',
  case
    when to_regprocedure('public.remove_resume_file(bigint,text)') is null then true
    else not has_function_privilege(
      'public', to_regprocedure('public.remove_resume_file(bigint,text)'), 'execute'
    )
  end,
  null;

select json_agg(row_to_json(results) order by name) from results;
rollback;
