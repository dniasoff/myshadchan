-- Child Documents database contract: slot limits, allow-lists, soft delete and
-- the Files-tab role/account boundary. Everything is rolled back by the runner.

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
grant all on results to public;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('3f311111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'child-documents-parent@test.local'),
  ('3f322222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'child-documents-single@test.local')
on conflict (id) do nothing;

delete from public.account_members;

set local role service_role;
insert into public.accounts (name, kind) values ('Child Documents A', 'household') returning id as account_a \gset
insert into public.accounts (name, kind) values ('Child Documents B', 'household') returning id as account_b \gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_a, '3f311111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:account_b, '3f311111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:account_a, '3f322222-2222-2222-2222-222222222222', 'single', 'active');
insert into public.singles (account_id, first_name_en, gender)
values (:account_a, 'Child Documents A', 'female')
returning id as single_a \gset
insert into public.singles (account_id, first_name_en, gender)
values (:account_b, 'Child Documents B', 'female')
returning id as single_b \gset

create or replace function pg_temp.expect_resume_error(
  p_name text, p_path text, p_filename text, p_mime_type text,
  p_size bigint, p_single_id bigint, p_expected text
) returns void
language plpgsql
as $fn$
declare message text;
begin
  begin
    perform public.add_resume_file(
      p_path, p_filename, p_mime_type, p_size, null, p_single_id
    );
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics message = message_text;
    insert into results values (p_name, message like '%' || p_expected || '%', message);
  end;
end
$fn$;

create or replace function pg_temp.expect_photo_error(
  p_name text, p_path text, p_single_id bigint, p_size bigint, p_expected text
) returns void
language plpgsql
as $fn$
declare message text;
begin
  begin
    perform public.add_resume_photo(p_path, null, p_single_id, 'shared', p_size);
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics message = message_text;
    insert into results values (p_name, message like '%' || p_expected || '%', message);
  end;
end
$fn$;

create or replace function pg_temp.expect_soft_delete_error(
  p_name text, p_entity_file_id bigint, p_expected text
) returns void
language plpgsql
as $fn$
declare message text;
begin
  begin
    perform public.soft_delete_entity_file(p_entity_file_id);
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics message = message_text;
    insert into results values (p_name, message like '%' || p_expected || '%', message);
  end;
end
$fn$;

create or replace function pg_temp.expect_direct_delete_error(
  p_name text, p_entity_file_id bigint
) returns void
language plpgsql
as $fn$
declare message text;
begin
  begin
    delete from public.entity_files where id = p_entity_file_id;
    insert into results values (
      p_name,
      exists (select 1 from public.entity_files where id = p_entity_file_id),
      'row remains protected by the single-document delete policy'
    );
  exception when others then
    get stacked diagnostics message = message_text;
    insert into results values (p_name, true, message);
  end;
end
$fn$;

create or replace function pg_temp.expect_paper_insert_error(
  p_name text, p_account_id bigint, p_single_id bigint, p_path text, p_expected text
) returns void
language plpgsql
as $fn$
declare message text;
begin
  begin
    insert into public.entity_files (
      account_id, target_type, target_id, storage_path, file_name, mime_type,
      size_bytes, visibility, slot
    ) values (
      p_account_id, 'single', p_single_id, p_path,
      'paper-3.pdf', 'application/pdf', 10, 'private_parent', 'paper_1'
    );
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics message = message_text;
    insert into results values (p_name, message like '%' || p_expected || '%', message);
  end;
end
$fn$;

-- The existing resume/photo pipeline remains the source of truth for these
-- two slots. The new overloads enforce the same file policy at the RPC edge.
set local role authenticated;
set local request.jwt.claims = '{"sub":"3f311111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.set_active_context(:account_a);
select * from public.add_resume_file(
  :account_a::text || '/resumes/single-' || :single_a::text || '/resume.docx',
  'resume.docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  10,
  null,
  :single_a
);
insert into results
select 'Resume accepts Word through the existing versioned pipeline',
  exists (
    select 1 from public.resumes r, jsonb_array_elements(r.files) f
    where r.single_id = :single_a and f->>'filename' = 'resume.docx'
  ),
  null;

select pg_temp.expect_resume_error(
  'Resume rejects files over 8 MiB',
  :account_a::text || '/resumes/single-' || :single_a::text || '/too-large.pdf',
  'too-large.pdf', 'application/pdf', 8 * 1024 * 1024 + 1, :single_a,
  '8 MiB'
);
select pg_temp.expect_resume_error(
  'Resume rejects unsupported MIME and extension',
  :account_a::text || '/resumes/single-' || :single_a::text || '/bad.txt',
  'bad.txt', 'text/plain', 10, :single_a, 'PDF, Word, JPEG, or PNG'
);
select pg_temp.expect_photo_error(
  'Picture rejects files over 8 MiB',
  :account_a::text || '/photos/shared/single-' || :single_a::text || '/too-large.png',
  :single_a, 8 * 1024 * 1024 + 1, '8 MiB'
);
select pg_temp.expect_photo_error(
  'Picture rejects non-JPEG/PNG paths',
  :account_a::text || '/photos/shared/single-' || :single_a::text || '/bad.gif',
  :single_a, 10, 'JPEG or PNG'
);

select * from public.add_resume_photo(
  :'account_a'::text || '/photos/shared/single-' || :'single_a'::text || '/picture.png',
  null, :'single_a', 'shared', 10
);
insert into results
select 'Picture accepts PNG through the existing photo pipeline',
  exists (select 1 from public.resume_photos where resume_id = (select id from public.resumes where single_id = :'single_a') and path like '%/picture.png'),
  null;

-- Paper slots are the two entity_files rows. The CHECK, partial unique index,
-- and parent-row trigger together make the third slot race-safe and capped.
insert into public.entity_files (
  account_id, target_type, target_id, storage_path, file_name, mime_type,
  size_bytes, visibility, slot
) values (
  :'account_a', 'single', :'single_a',
  :'account_a'::text || '/single/' || :'single_a'::text || '/paper-1-uuid.pdf',
  'paper-1.pdf', 'application/pdf', 10, 'private_parent', 'paper_1'
) returning id as paper_a_1 \gset
insert into public.entity_files (
  account_id, target_type, target_id, storage_path, file_name, mime_type,
  size_bytes, visibility, slot
) values (
  :'account_a', 'single', :'single_a',
  :'account_a'::text || '/single/' || :'single_a'::text || '/paper-2-uuid.pdf',
  'paper-2.pdf', 'application/pdf', 10, 'private_parent', 'paper_2'
) returning id as paper_a_2 \gset
select public.set_active_context(:account_b);
set local role service_role;
insert into public.entity_files (
  account_id, target_type, target_id, storage_path, file_name, mime_type,
  size_bytes, visibility, slot
) values (
  :'account_b', 'single', :'single_b',
  :'account_b'::text || '/single/' || :'single_b'::text || '/paper-b-uuid.pdf',
  'paper-b.pdf', 'application/pdf', 10, 'private_parent', 'paper_1'
) returning id as paper_b_1 \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"3f311111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.set_active_context(:account_a);
select pg_temp.expect_paper_insert_error(
  'A single cannot exceed two paper slots', :account_a, :single_a,
  :account_a::text || '/single/' || :single_a::text || '/paper-3-uuid.pdf',
  'child document limit reached'
);
select pg_temp.expect_direct_delete_error(
  'Direct DELETE cannot bypass the child-document Undo window', :paper_a_2
);

select id as deleted_paper_id, delete_token as deleted_token
from public.soft_delete_entity_file(:paper_a_1) \gset
insert into results
select 'Delete soft-hides the paper and leaves its row before Undo expires',
  exists (select 1 from public.entity_files where id = :'deleted_paper_id' and deleted_at is not null)
  and not exists (select 1 from public.entity_files_summary where id = :'deleted_paper_id'),
  null;

select public.undo_entity_file_delete(:paper_a_1, :'deleted_token');
insert into results
select 'Undo restores the same paper row',
  exists (select 1 from public.entity_files where id = :'paper_a_1' and deleted_at is null)
  and exists (select 1 from public.entity_files_summary where id = :'paper_a_1'),
  null;

select id as finalized_paper_id, delete_token as finalized_token
from public.soft_delete_entity_file(:paper_a_1) \gset
set local role service_role;
update public.entity_files
set delete_undo_until = now() - interval '1 second'
where id = :'finalized_paper_id';
set local role authenticated;
set local request.jwt.claims = '{"sub":"3f311111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.set_active_context(:account_a);
select public.finalize_entity_file_delete(:finalized_paper_id, :'finalized_token');
insert into results
select 'Finalize removes the row only after the Undo window and queues storage cleanup',
  not exists (select 1 from public.entity_files where id = :'finalized_paper_id')
  and exists (
    select 1 from public.storage_purge_queue
    where account_id = :'account_a'
      and bucket = 'entity-files'
      and storage_path = :'account_a'::text || '/single/' || :'single_a'::text || '/paper-1-uuid.pdf'
  ),
  null;

select pg_temp.expect_soft_delete_error(
  'Cross-account paper delete is refused', :paper_b_1, 'entity file not found'
);

set local request.jwt.claims = '{"sub":"3f322222-2222-2222-2222-222222222222","role":"authenticated"}';
select public.set_active_context(:account_a);
select pg_temp.expect_soft_delete_error(
  'Single role cannot delete a paper', :paper_a_2,
  'entity file changes are not available to this role'
);

set local role postgres;
insert into results
select 'Changed RPCs keep public and anon execution denied',
  not has_function_privilege('public', 'public.soft_delete_entity_file(bigint)', 'execute')
  and not has_function_privilege('anon', 'public.soft_delete_entity_file(bigint)', 'execute')
  and not has_function_privilege('public', 'public.add_resume_photo(text,bigint,bigint,text,bigint)', 'execute')
  and not has_function_privilege('anon', 'public.add_resume_photo(text,bigint,bigint,text,bigint)', 'execute'),
  null;

select json_agg(row_to_json(results) order by name) from results;
rollback;
