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
insert into public.accounts (name, kind) values ('Child Documents Shadchan', 'shadchanus') returning id as account_c \gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_a, '3f311111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:account_b, '3f311111-1111-1111-1111-111111111111', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:account_a, '3f322222-2222-2222-2222-222222222222', 'single', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:account_c, '3f311111-1111-1111-1111-111111111111', 'shadchan', 'active');
insert into public.singles (account_id, first_name_en, gender)
values (:account_a, 'Child Documents A', 'female')
returning id as single_a \gset
insert into public.singles (account_id, first_name_en, gender)
values (:account_b, 'Child Documents B', 'female')
returning id as single_b \gset

create or replace function pg_temp.expect_resume_error(
  p_name text, p_path text, p_filename text, p_mime_type text,
  p_size bigint, p_single_id bigint, p_expected_state text, p_expected text
) returns void
language plpgsql
as $fn$
declare
  message text;
  state text;
begin
  begin
    perform public.add_resume_file(
      p_path, p_filename, p_mime_type, p_size, null, p_single_id
    );
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics
      message = message_text,
      state = returned_sqlstate;
    insert into results values (
      p_name,
      state = p_expected_state and message = p_expected,
      format('SQLSTATE %s: %s', state, message)
    );
  end;
end
$fn$;

create or replace function pg_temp.expect_photo_error(
  p_name text, p_path text, p_single_id bigint, p_size bigint,
  p_expected_state text, p_expected text
) returns void
language plpgsql
as $fn$
declare
  message text;
  state text;
begin
  begin
    perform public.add_resume_photo(p_path, null, p_single_id, 'shared', p_size);
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics
      message = message_text,
      state = returned_sqlstate;
    insert into results values (
      p_name,
      state = p_expected_state and message = p_expected,
      format('SQLSTATE %s: %s', state, message)
    );
  end;
end
$fn$;

create or replace function pg_temp.expect_soft_delete_error(
  p_name text, p_entity_file_id bigint, p_expected_state text, p_expected text
) returns void
language plpgsql
as $fn$
declare
  message text;
  state text;
begin
  begin
    perform public.soft_delete_entity_file(p_entity_file_id);
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics
      message = message_text,
      state = returned_sqlstate;
    insert into results values (
      p_name,
      state = p_expected_state and message = p_expected,
      format('SQLSTATE %s: %s', state, message)
    );
  end;
end
$fn$;

create or replace function pg_temp.expect_direct_delete_error(
  p_name text, p_entity_file_id bigint
) returns void
language plpgsql
as $fn$
declare
  message text;
  affected bigint;
  state text;
begin
  begin
    delete from public.entity_files where id = p_entity_file_id;
    get diagnostics affected = row_count;
    insert into results values (
      p_name,
      affected = 0,
      format('SQLSTATE 00000: DELETE affected %s rows', affected)
    );
  exception when others then
    get stacked diagnostics
      message = message_text,
      state = returned_sqlstate;
    insert into results values (
      p_name,
      false,
      format('SQLSTATE %s: %s', state, message)
    );
  end;
end
$fn$;

create or replace function pg_temp.expect_paper_insert_error(
  p_name text, p_account_id bigint, p_single_id bigint, p_path text,
  p_filename text, p_mime_type text, p_size bigint, p_slot text,
  p_expected_state text, p_expected text
) returns void
language plpgsql
as $fn$
declare
  message text;
  state text;
begin
  begin
    insert into public.entity_files (
      account_id, target_type, target_id, storage_path, file_name, mime_type,
      size_bytes, visibility, slot
    ) values (
      p_account_id, 'single', p_single_id, p_path,
      p_filename, p_mime_type, p_size, 'private_parent', p_slot
    );
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics
      message = message_text,
      state = returned_sqlstate;
    insert into results values (
      p_name,
      state = p_expected_state and message = p_expected,
      format('SQLSTATE %s: %s', state, message)
    );
  end;
end
$fn$;

create or replace function pg_temp.expect_paper_update_error(
  p_name text, p_entity_file_id bigint, p_filename text, p_mime_type text,
  p_size bigint, p_expected_state text, p_expected text
) returns void
language plpgsql
as $fn$
declare
  message text;
  state text;
begin
  begin
    update public.entity_files
    set file_name = p_filename, mime_type = p_mime_type, size_bytes = p_size
    where id = p_entity_file_id;
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics
      message = message_text,
      state = returned_sqlstate;
    insert into results values (
      p_name,
      state = p_expected_state and message = p_expected,
      format('SQLSTATE %s: %s', state, message)
    );
  end;
end
$fn$;

create or replace function pg_temp.expect_storage_insert_error(
  p_name text, p_path text, p_expected_state text, p_expected text
) returns void
language plpgsql
as $fn$
declare
  message text;
  state text;
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('entity-files', p_path, '3f311111-1111-1111-1111-111111111111');
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics
      message = message_text,
      state = returned_sqlstate;
    insert into results values (
      p_name,
      state = p_expected_state and message = p_expected,
      format('SQLSTATE %s: %s', state, message)
    );
  end;
end
$fn$;

create or replace function pg_temp.expect_undo_error(
  p_name text, p_entity_file_id bigint, p_delete_token text,
  p_expected_state text, p_expected text
) returns void
language plpgsql
as $fn$
declare
  message text;
  state text;
begin
  begin
    perform public.undo_entity_file_delete(p_entity_file_id, p_delete_token);
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics
      message = message_text,
      state = returned_sqlstate;
    insert into results values (
      p_name,
      state = p_expected_state and message = p_expected,
      format('SQLSTATE %s: %s', state, message)
    );
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
  '23514', 'resume file must be a PDF, Word, JPEG, or PNG no larger than 8 MiB'
);
select pg_temp.expect_resume_error(
  'Resume rejects unsupported MIME and extension',
  :account_a::text || '/resumes/single-' || :single_a::text || '/bad.txt',
  'bad.txt', 'text/plain', 10, :single_a, '23514',
  'resume file must be a PDF, Word, JPEG, or PNG no larger than 8 MiB'
);
select pg_temp.expect_photo_error(
  'Picture rejects files over 8 MiB',
  :account_a::text || '/photos/shared/single-' || :single_a::text || '/too-large.png',
  :single_a, 8 * 1024 * 1024 + 1, '23514',
  'picture must be no larger than 8 MiB'
);
select pg_temp.expect_photo_error(
  'Picture rejects non-JPEG/PNG paths',
  :account_a::text || '/photos/shared/single-' || :single_a::text || '/bad.gif',
  :single_a, 10, '23514',
  'picture must be a JPEG or PNG in the current account'
);

select * from public.add_resume_photo(
  :'account_a'::text || '/photos/shared/single-' || :'single_a'::text || '/picture.png',
  null, :'single_a', 'shared', 10
);
insert into results
select 'Picture accepts PNG through the existing photo pipeline',
  exists (select 1 from public.resume_photos where resume_id = (select id from public.resumes where single_id = :'single_a') and path like '%/picture.png'),
  null;
select * from public.add_resume_photo(
  :'account_a'::text || '/photos/shared/single-' || :'single_a'::text || '/legacy-call.jpg',
  null, :'single_a', 'shared'
);
insert into results
select 'Picture accepts the legacy four-argument RPC shape',
  exists (select 1 from public.resume_photos where resume_id = (select id from public.resumes where single_id = :'single_a') and path like '%/legacy-call.jpg'),
  null;

-- Paper slots are the two entity_files rows. The CHECK, partial unique index,
-- and parent-row trigger together make the third slot race-safe and capped.
insert into public.entity_files (
  account_id, target_type, target_id, storage_path, file_name, mime_type,
  size_bytes, visibility, slot
) values (
  :'account_a', 'single', :'single_a',
  :'account_a'::text || '/single/' || :'single_a'::text || '/11111111-1111-4111-8111-111111111111.pdf',
  'paper-1.pdf', 'application/pdf', 10, 'private_parent', 'paper_1'
) returning id as paper_a_1 \gset
insert into public.entity_files (
  account_id, target_type, target_id, storage_path, file_name, mime_type,
  size_bytes, visibility, slot
) values (
  :'account_a', 'single', :'single_a',
  :'account_a'::text || '/single/' || :'single_a'::text || '/22222222-2222-4222-8222-222222222222.pdf',
  'paper-2.pdf', 'application/pdf', 10, 'private_parent', 'paper_2'
) returning id as paper_a_2 \gset
select public.set_active_context(:account_b);
set local role service_role;
insert into public.entity_files (
  account_id, target_type, target_id, storage_path, file_name, mime_type,
  size_bytes, visibility, slot
) values (
  :'account_b', 'single', :'single_b',
  :'account_b'::text || '/single/' || :'single_b'::text || '/33333333-3333-4333-8333-333333333333.pdf',
  'paper-b.pdf', 'application/pdf', 10, 'private_parent', 'paper_1'
) returning id as paper_b_1 \gset

set local role authenticated;
set local request.jwt.claims = '{"sub":"3f311111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.set_active_context(:account_a);
select pg_temp.expect_paper_insert_error(
  'Parent admin direct INSERT rejects an unsupported MIME', :account_a, :single_a,
  :account_a::text || '/single/' || :single_a::text || '/44444444-4444-4444-8444-444444444444.pdf',
  'invalid-mime.pdf', 'text/plain', 10, 'paper_1', '23514',
  'single document MIME type is not allowed'
);
select pg_temp.expect_paper_insert_error(
  'Parent admin direct INSERT rejects a mismatched extension', :account_a, :single_a,
  :account_a::text || '/single/' || :single_a::text || '/55555555-5555-4555-8555-555555555555.pdf',
  'invalid-extension.doc', 'application/pdf', 10, 'paper_1', '23514',
  'single document file extension does not match MIME type'
);
select pg_temp.expect_paper_insert_error(
  'Parent admin direct INSERT rejects an oversized file', :account_a, :single_a,
  :account_a::text || '/single/' || :single_a::text || '/66666666-6666-4666-8666-666666666666.pdf',
  'invalid-size.pdf', 'application/pdf', 8 * 1024 * 1024 + 1, 'paper_1', '23514',
  'single document size must be between 1 byte and 8 MiB'
);
-- The app never has a direct UPDATE grant for catalog metadata; the trigger
-- still must validate a privileged catalog write when the executor is the
-- service role. Keep the JWT/account context unchanged so this remains the
-- parent-admin role test rather than a grant test.
set local role service_role;
select pg_temp.expect_paper_update_error(
  'Parent admin direct UPDATE rejects an unsupported MIME', :paper_a_2,
  'invalid-update.exe', 'text/plain', 10, '23514',
  'single document MIME type is not allowed'
);
select pg_temp.expect_paper_update_error(
  'Parent admin direct UPDATE rejects a mismatched extension', :paper_a_2,
  'invalid-update.doc', 'application/pdf', 10, '23514',
  'single document file extension does not match MIME type'
);
select pg_temp.expect_paper_update_error(
  'Parent admin direct UPDATE rejects an oversized file', :paper_a_2,
  'invalid-update.pdf', 'application/pdf', 8 * 1024 * 1024 + 1, '23514',
  'single document size must be between 1 byte and 8 MiB'
);
set local role authenticated;
insert into storage.objects (bucket_id, name, owner)
values (
  'entity-files',
  :account_a::text || '/single/' || :single_a::text
    || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd.pdf',
  '3f311111-1111-1111-1111-111111111111'
);
insert into results values (
  'Parent admin storage INSERT accepts an opaque UUID key', true, null
);
select pg_temp.expect_storage_insert_error(
  'Storage INSERT rejects a named single key',
  :account_a::text || '/single/' || :single_a::text || '/ParentName.pdf',
  '42501', 'new row violates row-level security policy for table "objects"'
);
select pg_temp.expect_storage_insert_error(
  'Storage INSERT rejects a dot path segment',
  :account_a::text || '/single/' || :single_a::text || '/./paper.pdf',
  '42501', 'new row violates row-level security policy for table "objects"'
);
select pg_temp.expect_storage_insert_error(
  'Storage INSERT rejects a parent-dot path segment',
  :account_a::text || '/single/' || :single_a::text || '/../paper.pdf',
  '42501', 'new row violates row-level security policy for table "objects"'
);
select pg_temp.expect_storage_insert_error(
  'Storage INSERT rejects a wrong extension',
  :account_a::text || '/single/' || :single_a::text
    || '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.exe',
  '42501', 'new row violates row-level security policy for table "objects"'
);
set local role service_role;
update public.account_members
set role = 'helper'
where account_id = :account_a
  and user_id = '3f311111-1111-1111-1111-111111111111';
set local role authenticated;
select public.set_active_context(:account_a);
select pg_temp.expect_paper_insert_error(
  'Helper direct INSERT rejects an unsupported MIME', :account_a, :single_a,
  :account_a::text || '/single/' || :single_a::text || '/77777777-7777-4777-8777-777777777777.pdf',
  'helper-invalid.pdf', 'text/plain', 10, 'paper_1', '23514',
  'single document MIME type is not allowed'
);
set local role service_role;
select pg_temp.expect_paper_update_error(
  'Helper direct UPDATE rejects an unsupported MIME', :paper_a_2,
  'helper-invalid.pdf', 'text/plain', 10, '23514',
  'single document MIME type is not allowed'
);
set local role authenticated;
select public.set_active_context(:account_c);
select pg_temp.expect_paper_insert_error(
  'Shadchan direct INSERT cannot target a household single', :account_c, :single_a,
  :account_c::text || '/single/' || :single_a::text || '/88888888-8888-4888-8888-888888888888.pdf',
  'shadchan-invalid.pdf', 'application/pdf', 10, 'paper_1', '23503',
  'entity file single target is missing'
);
set local role service_role;
update public.account_members
set role = 'parent_admin'
where account_id = :account_a
  and user_id = '3f311111-1111-1111-1111-111111111111';
set local role authenticated;
select public.set_active_context(:account_a);
select pg_temp.expect_paper_insert_error(
  'A single cannot exceed two paper slots', :account_a, :single_a,
  :account_a::text || '/single/' || :single_a::text || '/99999999-9999-4999-8999-999999999999.pdf',
  'paper-3.pdf', 'application/pdf', 10, 'paper_1', '23514',
  'child document limit reached'
);
select pg_temp.expect_direct_delete_error(
  'Direct DELETE cannot bypass the child-document Undo window', :paper_a_2
);

select id as replacement_paper_id
from public.replace_entity_file(
  :paper_a_2,
  :'account_a'::text || '/single/' || :'single_a'::text || '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
  'paper-2-replaced.pdf', 'application/pdf', 10, 'paper_2', 'private_parent'
) \gset
insert into results
select 'Replace queues the old paper after the new row is installed',
  not exists (select 1 from public.entity_files where id = :'paper_a_2')
  and exists (
    select 1 from public.entity_files
    where id = :'replacement_paper_id' and slot = 'paper_2'
  )
  and exists (
    select 1 from public.storage_purge_queue
    where account_id = :'account_a'
      and bucket = 'entity-files'
      and storage_path = :'account_a'::text || '/single/' || :'single_a'::text || '/22222222-2222-4222-8222-222222222222.pdf'
  ),
  null;

select id as deleted_paper_id, delete_token as deleted_token
from public.soft_delete_entity_file(:paper_a_1) \gset
select pg_temp.expect_paper_insert_error(
  'A paper slot remains reserved during the Undo window', :account_a, :single_a,
  :account_a::text || '/single/' || :single_a::text || '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf',
  'pending-slot.pdf', 'application/pdf', 10, 'paper_1', '23505',
  'single paper slot is already in use'
);
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
select public.finalize_entity_file_delete(:finalized_paper_id, :'finalized_token');
insert into results
select 'Finalize removes the row only after the Undo window and queues storage cleanup',
  not exists (select 1 from public.entity_files where id = :'finalized_paper_id')
  and exists (
    select 1 from public.storage_purge_queue
    where account_id = :'account_a'
      and bucket = 'entity-files'
      and storage_path = :'account_a'::text || '/single/' || :'single_a'::text || '/11111111-1111-4111-8111-111111111111.pdf'
  ),
  null;
insert into public.entity_files (
  account_id, target_type, target_id, storage_path, file_name, mime_type,
  size_bytes, visibility, slot
) values (
  :'account_a', 'single', :'single_a',
  :'account_a'::text || '/single/' || :'single_a'::text || '/cccccccc-cccc-4ccc-8ccc-cccccccccccc.pdf',
  'expired-sweep.pdf', 'application/pdf', 10, 'private_parent', 'paper_1'
) returning id as swept_paper_id \gset
select id as swept_delete_id, delete_token as swept_delete_token
from public.soft_delete_entity_file(:swept_paper_id) \gset
set local role service_role;
update public.entity_files
set delete_undo_until = now() - interval '1 second'
where id = :'swept_paper_id';
set local role authenticated;
select public.set_active_context(:account_a);
select pg_temp.expect_undo_error(
  'Undo after the deadline is refused', :'swept_paper_id', :'swept_delete_token',
  'P0002', 'entity file delete can no longer be undone'
);
select public.finalize_expired_entity_file_deletes();
insert into results
select 'Expired papers are finalized by the durable sweep while active papers remain',
  not exists (select 1 from public.entity_files where id = :'swept_paper_id')
  and exists (select 1 from public.entity_files where id = :'replacement_paper_id' and deleted_at is null)
  and exists (
    select 1 from public.storage_purge_queue
    where account_id = :'account_a'
      and bucket = 'entity-files'
      and storage_path = :'account_a'::text || '/single/' || :'single_a'::text || '/cccccccc-cccc-4ccc-8ccc-cccccccccccc.pdf'
  ),
  null;

select pg_temp.expect_soft_delete_error(
  'Cross-account paper delete is refused', :paper_b_1, 'P0002', 'entity file not found'
);

set local request.jwt.claims = '{"sub":"3f322222-2222-2222-2222-222222222222","role":"authenticated"}';
select public.set_active_context(:account_a);
select pg_temp.expect_soft_delete_error(
  'Single role cannot delete a paper', :replacement_paper_id,
  '42501', 'entity file changes are not available to this role'
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
