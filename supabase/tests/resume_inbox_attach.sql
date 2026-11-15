-- Resume Inbox picker: provenance validation and idempotent append checks.
-- The browser and provider tests cover presentation and byte-copy behavior;
-- this suite proves the SECURITY DEFINER/RPC boundary in Postgres.

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;

insert into auth.users (id, instance_id, aud, role, email)
values ('df222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'df-resume-inbox@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('Resume Inbox A', 'household') returning id as acct_a \gset
insert into public.accounts (name, kind) values ('Resume Inbox B', 'household') returning id as acct_b \gset
insert into ids values ('acct_a', :'acct_a'), ('acct_b', :'acct_b');

insert into public.account_members (account_id, user_id, role, status)
values (:acct_a, 'df222222-2222-2222-2222-222222222222', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:acct_b, 'df222222-2222-2222-2222-222222222222', 'parent_admin', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"df222222-2222-2222-2222-222222222222","role":"authenticated"}';

insert into public.singles (account_id, first_name_en, last_name_en)
values (:acct_a, 'David', 'Levi') returning id as single_id \gset
insert into public.shidduchim (account_id, single_id, name_en)
values (:acct_a, :single_id, 'David Levi') returning id as shidduch_id \gset
insert into ids values ('single_id', :'single_id'), ('shidduch_id', :'shidduch_id');

insert into public.inbox_items (
  account_id, source, sender, attachments, status
) values (
  :acct_a,
  'upload',
  null,
  jsonb_build_array(jsonb_build_object(
    'title', 'David Levi.pdf',
    'type', 'application/pdf',
    'path', :'acct_a' || '/inbox/44/David-Levi.pdf',
    'size', 3210
  )),
  'unresolved'
) returning id as inbox_item_id \gset
insert into ids values ('inbox_item_id', :'inbox_item_id');

select public.set_active_context((select value::bigint from ids where name = 'acct_a'));

select public.add_resume_file(
  p_path => :'acct_a' || '/resumes/' || :'shidduch_id' || '/inbox-copy.pdf',
  p_filename => 'David Levi.pdf',
  p_mime_type => 'application/pdf',
  p_size => 3210,
  p_shidduchim_id => :shidduch_id,
  p_source_inbox_item_id => :inbox_item_id,
  p_source_inbox_attachment_path => :'acct_a' || '/inbox/44/David-Levi.pdf'
);

insert into results (name, passed)
select 'valid unresolved attachment appends one provenance-bearing file',
  (select jsonb_array_length(files) from public.resumes where shidduchim_id = :shidduch_id) = 1;

insert into results (name, passed)
select 'server stores Inbox provenance and source byte size',
  (select files->0->>'source_inbox_item_id' from public.resumes where shidduchim_id = :shidduch_id) = :'inbox_item_id'
  and (select (files->0->>'size')::bigint from public.resumes where shidduchim_id = :shidduch_id) = 3210;

select public.add_resume_file(
  p_path => :'acct_a' || '/resumes/' || :'shidduch_id' || '/inbox-copy.pdf',
  p_filename => 'David Levi.pdf',
  p_mime_type => 'application/pdf',
  p_size => 3210,
  p_shidduchim_id => :shidduch_id,
  p_source_inbox_item_id => :inbox_item_id,
  p_source_inbox_attachment_path => :'acct_a' || '/inbox/44/David-Levi.pdf'
);

insert into results (name, passed)
select 'retrying the same provenance key is a no-op',
  (select jsonb_array_length(files) from public.resumes where shidduchim_id = :shidduch_id) = 1;

select public.set_active_context((select value::bigint from ids where name = 'acct_b'));

do $$
begin
  perform public.add_resume_file(
    p_path => '999/resumes/foreign/inbox-copy.pdf',
    p_filename => 'David Levi.pdf',
    p_mime_type => 'application/pdf',
    p_size => 3210,
    p_shidduchim_id => (select value::bigint from ids where name = 'shidduch_id'),
    p_source_inbox_item_id => (select value::bigint from ids where name = 'inbox_item_id'),
    p_source_inbox_attachment_path => (select value || '/inbox/44/David-Levi.pdf' from ids where name = 'acct_a')
  );
  insert into results values ('cross-account source and target are rejected', false, 'call unexpectedly succeeded');
exception when others then
  insert into results values ('cross-account source and target are rejected', sqlerrm like '%not found%' or sqlerrm like '%current account%', sqlerrm);
end $$;

select public.set_active_context((select value::bigint from ids where name = 'acct_a'));

update public.inbox_items
set status = 'held'
where id = (select value::bigint from ids where name = 'inbox_item_id');

do $$
declare
  v_account bigint;
  v_shidduch bigint;
  v_item bigint;
begin
  select value::bigint into v_account from ids where name = 'acct_a';
  select value::bigint into v_shidduch from ids where name = 'shidduch_id';
  select value::bigint into v_item from ids where name = 'inbox_item_id';
  perform public.add_resume_file(
    p_path => v_account::text || '/resumes/' || v_shidduch::text || '/held-copy.pdf',
    p_filename => 'David Levi.pdf',
    p_mime_type => 'application/pdf',
    p_size => 3210,
    p_shidduchim_id => v_shidduch,
    p_source_inbox_item_id => v_item,
    p_source_inbox_attachment_path => v_account::text || '/inbox/44/David-Levi.pdf'
  );
  insert into results values ('held Inbox items are rejected', false, 'call unexpectedly succeeded');
exception when others then
  insert into results values ('held Inbox items are rejected', sqlerrm like '%Inbox attachment not found%', sqlerrm);
end $$;

update public.inbox_items
set status = 'unresolved',
    attachments = jsonb_build_array(jsonb_build_object(
      'title', 'notes.txt',
      'type', 'text/plain',
      'path', :'acct_a' || '/inbox/44/notes.txt'
    ))
where id = (select value::bigint from ids where name = 'inbox_item_id');

do $$
declare
  v_account bigint;
  v_shidduch bigint;
  v_item bigint;
begin
  select value::bigint into v_account from ids where name = 'acct_a';
  select value::bigint into v_shidduch from ids where name = 'shidduch_id';
  select value::bigint into v_item from ids where name = 'inbox_item_id';
  perform public.add_resume_file(
    p_path => v_account::text || '/resumes/' || v_shidduch::text || '/notes.txt',
    p_filename => 'notes.txt',
    p_mime_type => 'text/plain',
    p_size => 12,
    p_shidduchim_id => v_shidduch,
    p_source_inbox_item_id => v_item,
    p_source_inbox_attachment_path => v_account::text || '/inbox/44/notes.txt'
  );
  insert into results values ('ineligible MIME types are rejected', false, 'call unexpectedly succeeded');
exception when others then
  insert into results values ('ineligible MIME types are rejected', sqlerrm like '%not eligible%', sqlerrm);
end $$;

insert into results (name, passed)
select 'rejected attempts leave the Inbox row unresolved with one attachment',
  status = 'unresolved' and jsonb_array_length(attachments) = 1
from public.inbox_items
where id = (select value::bigint from ids where name = 'inbox_item_id');

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from results;

rollback;
