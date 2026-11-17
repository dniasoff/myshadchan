-- Resume-tab per-file Delete — authorization, exact-path, lock and purge
-- atomicity. All fixtures live in one transaction and are rolled back.

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;

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
insert into public.ai_reread_attempts (account_id, resume_id, request_id, period, status, lease_expires_at)
values (:account_a, :resume_a, '2a844444-4444-4444-4444-444444444444', to_char(now(), 'YYYY-MM'), 'in_progress', now() + interval '5 minutes');

create or replace function pg_temp.expect_remove_error(
  p_name text,
  p_resume_id bigint,
  p_path text,
  p_expected text
) returns void
language plpgsql
as $fn$
declare
  message text;
begin
  begin
    perform public.remove_resume_file(p_resume_id, p_path);
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
  'resume not found'
);
select pg_temp.expect_remove_error(
  'unknown path is refused',
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/missing.pdf',
  'resume file not found'
);
select pg_temp.expect_remove_error(
  'in-flight read is refused',
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf',
  'Please wait: this resume is being made easy to read.'
);

set local request.jwt.claims = '{"sub":"2a833333-3333-3333-3333-333333333333","role":"authenticated"}';
select public.set_active_context(:account_a);
select pg_temp.expect_remove_error(
  'single role is refused',
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf',
  'remove_resume_file requires an owning manager'
);

set local role postgres;
update public.ai_reread_attempts
set lease_expires_at = now() - interval '1 second'
where resume_id = :resume_a;
set local role authenticated;
set local request.jwt.claims = '{"sub":"2a811111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.set_active_context(:account_a);

select * from public.remove_resume_file(
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf'
) \gset removed_
set local role postgres;
insert into results
select 'first call removes only the exact entry and keeps the resume row',
  (removed_files::jsonb @> jsonb_build_array(jsonb_build_object('path', :account_a::text || '/resumes/' || :shidduch_a::text || '/new.pdf')))
  and jsonb_array_length(removed_files::jsonb) = 1
  and exists (select 1 from public.resumes where id = :resume_a)
  and (select sections from public.resumes where id = :resume_a) = '{"keep":"sections"}'::jsonb
  and (select extracted from public.resumes where id = :resume_a) = '{"keep":"extracted"}'::jsonb,
  removed_files;
insert into results
select 'first call queues exactly the removed object',
  (select count(*) from public.storage_purge_queue where account_id = :account_a and kind = 'object' and bucket = 'documents') = 1
  and exists (select 1 from public.storage_purge_queue where account_id = :account_a and storage_path = :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf')
  and not exists (select 1 from public.storage_purge_queue where account_id = :account_a and storage_path = :account_a::text || '/resumes/' || :shidduch_a::text || '/new.pdf'),
  null;

set local role authenticated;
select * from public.remove_resume_file(
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/old.pdf'
) \gset retry_
set local role postgres;
insert into results
select 'second call is idempotent',
  jsonb_array_length(retry_files::jsonb) = 1
  and (select count(*) from public.storage_purge_queue where account_id = :account_a and kind = 'object' and bucket = 'documents') = 1,
  retry_files;

set local role authenticated;
select * from public.remove_resume_file(
  :resume_a,
  :account_a::text || '/resumes/' || :shidduch_a::text || '/new.pdf'
);
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
  not has_function_privilege('public', 'public.remove_resume_file(bigint,text)', 'execute')
  and not has_function_privilege('anon', 'public.remove_resume_file(bigint,text)', 'execute')
  and (select relforcerowsecurity from pg_class where oid = 'public.storage_purge_queue'::regclass),
  null;

select json_agg(row_to_json(results) order by name) from results;
rollback;
