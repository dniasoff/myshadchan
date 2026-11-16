-- Inbox Delete — database safety suite.
--
-- The checks are deliberately transaction-local. They exercise the
-- SECURITY DEFINER boundary, the row-lock/idempotency contract, fail-closed
-- attachment validation, the unbounded shared-path scan, and the durable
-- purge queue. The Storage API is covered by the provider suites; SQL cannot
-- safely delete Storage objects.
--
-- Run via: npm run test:unit:db (needs the local stack and this migration).

\set ON_ERROR_STOP on
begin;

create temp table results (name text, passed boolean, detail text) on commit drop;
create temp table ids (name text primary key, value text) on commit drop;
grant all on results to public;
grant all on ids to public;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('d3111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbox-delete-a@test.local'),
  ('d3222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbox-delete-b@test.local'),
  ('d3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbox-delete-single@test.local');

delete from public.account_members;

set local role service_role;
insert into public.accounts (name, kind)
values ('Inbox Delete A', 'household')
returning id as account_a \gset
insert into public.accounts (name, kind)
values ('Inbox Delete B', 'household')
returning id as account_b \gset

insert into public.account_members (account_id, user_id, role, status)
values (:account_a, 'd3111111-1111-1111-1111-111111111111', 'parent_admin', 'active')
returning id as member_a \gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_b, 'd3222222-2222-2222-2222-222222222222', 'parent_admin', 'active')
returning id as member_b \gset
insert into public.account_members (account_id, user_id, role, status)
values (:account_a, 'd3333333-3333-3333-3333-333333333333', 'single', 'active')
returning id as member_single \gset

insert into public.inbox_items (account_id, source, status, attachments)
values (
  :account_a, 'upload', 'unresolved',
  jsonb_build_array(jsonb_build_object('path', :account_a::text || '/inbox/1/private.pdf'))
)
returning id as item_private \gset
update public.inbox_items
set attachments = jsonb_build_array(jsonb_build_object('path', :account_a::text || '/inbox/' || :item_private::text || '/11111111-1111-4111-8111-111111111111.pdf'))
where id = :item_private;
insert into public.inbox_items (account_id, source, status, attachments)
values (
  :account_b, 'upload', 'unresolved',
  jsonb_build_array(jsonb_build_object('path', :account_b::text || '/inbox/2/other.pdf'))
)
returning id as item_other_account \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'resolving', null)
returning id as item_resolving \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'resolved', null)
returning id as item_resolved \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', '{}'::jsonb)
returning id as item_non_array \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', jsonb_build_array('not-an-object'::text))
returning id as item_non_object \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', jsonb_build_array(jsonb_build_object('title', 'missing path')))
returning id as item_missing_path \gset

insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', jsonb_build_array(jsonb_build_object('path', :account_b::text || '/inbox/9/wrong-account.pdf')))
returning id as item_wrong_account_path \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', jsonb_build_array(jsonb_build_object('path', :account_a::text || '/inbox/9/%2e%2e/private.pdf')))
returning id as item_encoded_dot \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', jsonb_build_array(jsonb_build_object('path', :account_a::text || '/inbox/10/%2Fother.pdf')))
returning id as item_encoded_separator \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', jsonb_build_array(jsonb_build_object('path', :account_a::text || '/inbox/11/%25other.pdf')))
returning id as item_double_encoded \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', jsonb_build_array(jsonb_build_object('path', :account_a::text || '/inbox/12/' || chr(10) || 'control.pdf')))
returning id as item_control \gset

insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', null)
returning id as item_shared_one \gset
update public.inbox_items
set attachments = jsonb_build_array(jsonb_build_object('path', :account_a::text || '/inbox/' || :item_shared_one::text || '/22222222-2222-4222-8222-222222222222.pdf'))
where id = :item_shared_one;
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', null)
returning id as item_shared_two \gset
update public.inbox_items
set attachments = jsonb_build_array(jsonb_build_object('path', :account_a::text || '/inbox/' || :item_shared_one::text || '/22222222-2222-4222-8222-222222222222.pdf'))
where id = :item_shared_two;

insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', null)
returning id as item_race \gset

create or replace function pg_temp.expect_delete_error(
  p_name text,
  p_item_id bigint,
  p_expected text
) returns void
language plpgsql
as $fn$
declare
  message text;
begin
  begin
    perform public.delete_inbox_item(p_item_id);
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics message = message_text;
    insert into results
    values (p_name, message = p_expected and exists (select 1 from public.inbox_items where id = p_item_id), message);
  end;
end
$fn$;

create or replace function pg_temp.delete_then_check_resolver_cas(
  p_name text,
  p_item_id bigint
) returns void
language plpgsql
as $fn$
declare
  deleted_count integer;
  cas_count integer;
begin
  deleted_count := public.delete_inbox_item(p_item_id);
  update public.inbox_items set status = 'resolving' where id = p_item_id;
  get diagnostics cas_count = row_count;
  insert into results
  values (p_name, deleted_count = 0 and cas_count = 0 and not exists (select 1 from public.inbox_items where id = p_item_id), null);
end
$fn$;

create or replace function pg_temp.expect_attach_source_missing(
  p_name text,
  p_item_id bigint
) returns void
language plpgsql
as $fn$
declare
  message text;
begin
  begin
    perform public.add_resume_file(
      public.current_context_id()::text || '/resumes/after-delete.pdf',
      'after-delete.pdf',
      'application/pdf',
      1,
      999,
      null,
      p_item_id,
      public.current_context_id()::text || '/inbox/' || p_item_id::text || '/race.pdf'
    );
    insert into results values (p_name, false, 'no exception');
  exception when others then
    get stacked diagnostics message = message_text;
    insert into results values (p_name, message = 'Inbox attachment not found', message);
  end;
end
$fn$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d3111111-1111-1111-1111-111111111111","role":"authenticated"}';

select public.delete_inbox_item(:item_other_account) as cross_account_result \gset
set local role service_role;
insert into results (name, passed, detail)
select 'cross-account delete is an idempotent no-op with no oracle',
       :'cross_account_result'::integer = 0
       and exists (select 1 from public.inbox_items where id = :item_other_account),
       null;
set local role authenticated;

select pg_temp.expect_delete_error('resolving item is refused', :item_resolving, 'Inbox item is no longer deletable');
select pg_temp.expect_delete_error('resolved item is refused', :item_resolved, 'Inbox item is no longer deletable');
select pg_temp.expect_delete_error('non-array attachment metadata is refused', :item_non_array, 'This item cannot be deleted automatically.');
select pg_temp.expect_delete_error('non-object attachment metadata is refused', :item_non_object, 'This item cannot be deleted automatically.');
select pg_temp.expect_delete_error('missing attachment path is refused', :item_missing_path, 'This item cannot be deleted automatically.');
select pg_temp.expect_delete_error('wrong-account attachment path is refused', :item_wrong_account_path, 'This item cannot be deleted automatically.');
select pg_temp.expect_delete_error('encoded dot path is refused', :item_encoded_dot, 'This item cannot be deleted automatically.');
select pg_temp.expect_delete_error('encoded separator path is refused', :item_encoded_separator, 'This item cannot be deleted automatically.');
select pg_temp.expect_delete_error('double-encoded path is refused', :item_double_encoded, 'This item cannot be deleted automatically.');
select pg_temp.expect_delete_error('control-character path is refused', :item_control, 'This item cannot be deleted automatically.');

-- G2 is the live email-ingest grammar: account + lowercase UUID v4 + the
-- worker's optional case-preserving ten-character extension.
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'email', 'unresolved', jsonb_build_array(jsonb_build_object(
  'path', :account_a::text || '/33333333-3333-4333-8333-333333333333.PDF'
))) returning id as item_ingest_private \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'email', 'unresolved', jsonb_build_array(jsonb_build_object(
  'path', :account_a::text || '/44444444-4444-4444-8444-444444444444.1234567890'
))) returning id as item_ingest_shared_one \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'email', 'unresolved', jsonb_build_array(jsonb_build_object(
  'path', :account_a::text || '/44444444-4444-4444-8444-444444444444.1234567890'
))) returning id as item_ingest_shared_two \gset

select public.delete_inbox_item(:item_ingest_private) as ingest_deleted_count \gset
set local role service_role;
insert into results
select 'email-ingest G2 object is deleted and queued',
       :'ingest_deleted_count'::integer = 1
       and not exists (select 1 from public.inbox_items where id = :item_ingest_private)
       and exists (
         select 1 from public.inbox_attachment_purge
         where account_id = :account_a
           and storage_path = :account_a::text || '/33333333-3333-4333-8333-333333333333.PDF'
       ),
       null;
set local role authenticated;
select public.ack_inbox_attachment_purge(array[
  :'account_a'::text || '/33333333-3333-4333-8333-333333333333.PDF'
]);

select public.delete_inbox_item(:item_ingest_shared_one) as ingest_shared_deleted_count \gset
set local role service_role;
insert into results
select 'shared email-ingest G2 object is preserved',
       :'ingest_shared_deleted_count'::integer = 0
       and not exists (select 1 from public.inbox_items where id = :item_ingest_shared_one)
       and exists (select 1 from public.inbox_items where id = :item_ingest_shared_two)
       and not exists (
         select 1 from public.inbox_attachment_purge
         where account_id = :account_a
           and storage_path = :account_a::text || '/44444444-4444-4444-8444-444444444444.1234567890'
       ),
       null;
set local role authenticated;

insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'email', 'unresolved', jsonb_build_array(jsonb_build_object(
  'path', :account_b::text || '/77777777-7777-4777-8777-777777777777.pdf'
))) returning id as item_ingest_wrong_account \gset
select pg_temp.expect_delete_error('G2 wrong-account prefix is refused', :item_ingest_wrong_account, 'This item cannot be deleted automatically.');

insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'email', 'unresolved', jsonb_build_array(jsonb_build_object(
  'path', :account_a::text || '/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.pdf'
))) returning id as item_ingest_upper_uuid \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'email', 'unresolved', jsonb_build_array(jsonb_build_object(
  'path', :account_a::text || '/55555555-5555-4555-8555-555555555555/extra.pdf'
))) returning id as item_ingest_extra_segment \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'email', 'unresolved', jsonb_build_array(jsonb_build_object(
  'path', :account_a::text || '/66666666-6666-4666-8666-666666666666.odd-extension-too-long'
))) returning id as item_ingest_weird_extension \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'email', 'unresolved', jsonb_build_array(jsonb_build_object(
  'path', :account_a::text || '/88888888-8888-4888-8888-888888888888%2ePDF'
))) returning id as item_ingest_encoded \gset
select pg_temp.expect_delete_error('G2 uppercase UUID is refused', :item_ingest_upper_uuid, 'This item cannot be deleted automatically.');
select pg_temp.expect_delete_error('G2 extra segment is refused', :item_ingest_extra_segment, 'This item cannot be deleted automatically.');
select pg_temp.expect_delete_error('G2 weird extension is refused', :item_ingest_weird_extension, 'This item cannot be deleted automatically.');
select pg_temp.expect_delete_error('G2 encoded path is refused', :item_ingest_encoded, 'This item cannot be deleted automatically.');

insert into results (name, passed, detail)
select 'add_resume_file holds the source Inbox row with FOR SHARE',
       pg_get_functiondef('public.add_resume_file(text,text,text,bigint,bigint,bigint,bigint,text)'::regprocedure) ~* 'for share',
       null;

-- Resolver-wins interleaving: the delete sees the resolving state and refuses.
update public.inbox_items
set status = 'resolving', resolution_attempt_id = 'race-winner'
where id = :item_race;
select pg_temp.expect_delete_error('resolver-wins interleaving refuses deletion', :item_race, 'Inbox item is no longer deletable');

-- Delete-wins interleaving: once the row is deleted, the resolver CAS has no
-- row to update. This is the observable end-state of the FOR UPDATE fence.
update public.inbox_items
set status = 'unresolved', resolution_attempt_id = null
where id = :item_race;
select pg_temp.delete_then_check_resolver_cas('delete-wins interleaving deletes exactly once and resolver CAS fails', :item_race);
select pg_temp.expect_attach_source_missing('attach-after-delete fails at the source fence before a destination row', :item_race);

-- Shared-path scan and purge claim recheck. The second row is inserted before
-- claim runs, so claim must drop the queue entry without returning it for
-- Storage deletion. App-minted paths always include their own Inbox item id,
-- so a cross-row shared path is unreachable through supported writers. A true
-- concurrent insert-after-claim fence is a follow-up trigger/interleaving
-- concern, deliberately outside this PR; the claim recheck still protects
-- every path referenced before the claim call.
select public.delete_inbox_item(:item_shared_one) as shared_deleted_count \gset
insert into results
select 'shared path is preserved when another Inbox row references it',
       :'shared_deleted_count'::integer = 0
       and not exists (select 1 from public.inbox_items where id = :item_shared_one)
       and exists (select 1 from public.inbox_items where id = :item_shared_two),
       null;

select public.delete_inbox_item(:item_private) as private_deleted_count \gset
insert into results
select 'private path is queued after the row delete',
       :'private_deleted_count'::integer = 1
       and exists (select 1 from public.inbox_attachment_purge where account_id = :account_a),
       null;

insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', jsonb_build_array(jsonb_build_object('path', :account_a::text || '/inbox/' || :item_private::text || '/11111111-1111-4111-8111-111111111111.pdf')))
returning id as item_shared_after_delete \gset
select count(*) as claim_count from public.claim_inbox_attachment_purge() \gset
insert into results
select 'claim drops a path that became shared after delete',
       :'claim_count'::bigint = 0
       and not exists (select 1 from public.inbox_attachment_purge where account_id = :account_a),
       null;

-- Null and empty attachment arrays are valid deletes with no queue work.
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', null)
returning id as item_null_attachments \gset
insert into public.inbox_items (account_id, source, status, attachments)
values (:account_a, 'upload', 'unresolved', '[]'::jsonb)
returning id as item_empty_attachments \gset
insert into results
select 'null and empty attachment arrays delete with no queue path',
       public.delete_inbox_item(:item_null_attachments) = 0
       and public.delete_inbox_item(:item_empty_attachments) = 0,
       null;

-- Queue acknowledgement is account-scoped: A may acknowledge only its own
-- path even when it supplies a path belonging to B in the same request.
set local role service_role;
insert into public.inbox_attachment_purge (account_id, storage_path)
values (:account_a, :account_a::text || '/inbox/ack/a.pdf'),
       (:account_b, :account_b::text || '/inbox/ack/b.pdf');
set local role authenticated;
select public.ack_inbox_attachment_purge(array[:account_a::text || '/inbox/ack/a.pdf', :account_b::text || '/inbox/ack/b.pdf']) as acked_count \gset
set local role service_role;
insert into results
select 'purge acknowledgement deletes only the caller account queue rows',
       :'acked_count'::integer = 1
       and not exists (select 1 from public.inbox_attachment_purge where account_id = :account_a and storage_path like '%/inbox/ack/a.pdf')
       and exists (select 1 from public.inbox_attachment_purge where account_id = :account_b and storage_path like '%/inbox/ack/b.pdf'),
       null;

select json_agg(row_to_json(results)) from results;
rollback;
