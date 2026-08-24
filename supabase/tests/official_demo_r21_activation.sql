-- r21 end-to-end lifecycle proof. The fixture mirrors the official inventory,
-- resolves both listings through the service path, withdraws the root single,
-- and calls activation with a durable withdrawal tombstone.
\set ON_ERROR_STOP on
begin;

create temporary table r21_checks (
  name text not null,
  passed boolean not null,
  detail text
) on commit drop;
grant all on r21_checks to public;

select '92100000-0000-0000-0000-000000000001' as root_user \gset
select '92100000-0000-0000-0000-000000000002' as leah_user \gset
select '92100000-0000-0000-0000-000000000003' as miriam_user \gset
insert into auth.users (id, instance_id, aud, role, email)
values
  (:'root_user', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r21-dovid@test.invalid'),
  (:'leah_user', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r21-leah@test.invalid'),
  (:'miriam_user', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'r21-miriam@test.invalid');

insert into public.accounts (name, kind)
values ('r21 root household', 'household')
returning id as root_account_id \gset
insert into public.accounts (name, kind)
values ('r21 Feldman office', 'shadchanus')
returning id as shadchan_account_id \gset
insert into public.accounts (name, kind)
values ('r21 Gross household', 'household')
returning id as gross_account_id \gset

insert into public.account_members (account_id, user_id, role, status)
values (:'root_account_id', :'root_user', 'parent_admin', 'active')
returning id as root_member_id \gset
insert into public.account_members (account_id, user_id, role, status)
values (:'shadchan_account_id', :'leah_user', 'shadchan', 'active')
returning id as leah_member_id \gset
insert into public.account_members (account_id, user_id, role, status)
values (:'gross_account_id', :'miriam_user', 'parent_admin', 'active')
returning id as miriam_member_id \gset
select id as root_person_id
from public.members
where user_id = :'root_user'
limit 1 \gset

insert into public.singles (account_id, first_name_en, last_name_en, gender)
values (:'root_account_id', 'Rivky', 'R21', 'female')
returning id as withdrawn_single_id \gset
insert into public.singles (account_id, first_name_en, last_name_en, gender)
values (:'root_account_id', 'Yaakov', 'R21', 'male')
returning id as second_single_id \gset

insert into public.demo_runs (
  root_account_id, status, lease_expires_at, lease_token, operation, original_root_name
)
values (
  :'root_account_id', 'seeding', clock_timestamp() + interval '10 minutes',
  'r21-activation-lease', 'seed', 'Original r21 root'
)
returning id as run_id \gset
insert into public.demo_run_accounts (run_id, account_id, context_key, context_kind, is_root)
values
  (:'run_id', :'root_account_id', 'primary-household', 'household', true);
-- Two synthetic actors, both parents of the ONE household. `leah_user` and
-- `miriam_user` remain as ordinary non-demo logins so the ownership fences
-- below still have a genuine outsider to be fenced against.
insert into public.demo_run_users (run_id, user_id, actor_key, email_domain)
values
  (:'run_id', :'root_user', 'dovid-klein', 'invalid'),
  (:'run_id', :'leah_user', 'sarah-klein', 'invalid');
insert into public.demo_run_actor_intents
  (run_id, actor_key, expected_email, auth_user_id, state)
values
  (:'run_id', 'dovid-klein', 'r21-dovid@test.invalid', :'root_user', 'reconciled'),
  (:'run_id', 'sarah-klein', 'r21-sarah@test.invalid', :'leah_user', 'reconciled');
insert into public.demo_onboarding_intents (user_id, account_id, state)
values (:'root_user', :'root_account_id', 'pending');

-- All subsequent fixture writes are marked with this exact service lease,
-- matching the edge function's service client.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select set_config(
  'request.headers',
  json_build_object(
    'x-demo-run-id', :'run_id',
    'x-demo-lease-token', 'r21-activation-lease'
  )::text,
  true
);

-- No connection, connection invites, child grants, thread or messages: every
-- one of them needs a SECOND account, and this run is one family. The demo
-- write barrier now refuses such a write outright, which is the point.

insert into public.invites (
  email, account_id, role, invited_by, status, expires_at, accepted_at, target_single_id
)
values
  ('r21-a@test.invalid', :'root_account_id', 'single', :'root_member_id', 'pending', now() + interval '14 days', null, :'withdrawn_single_id'),
  ('r21-b@test.invalid', :'root_account_id', 'single', :'root_member_id', 'pending', now() + interval '14 days', null, :'second_single_id'),
  ('r21-c@test.invalid', :'root_account_id', 'single', :'root_member_id', 'pending', now() + interval '14 days', null, :'withdrawn_single_id');
select array_agg(id order by id) as invite_ids
from public.invites where account_id = :'root_account_id' \gset

insert into public.single_preferences (account_id, single_id, body, visible_to_manager)
values
  (:'root_account_id', :'withdrawn_single_id', 'Warm and grounded.', true),
  (:'root_account_id', :'second_single_id', 'Kind and family-oriented.', false);
insert into public.single_notes (account_id, single_id, body, visible_to_manager)
values
  (:'root_account_id', :'withdrawn_single_id', 'Prefers a thoughtful process.', false),
  (:'root_account_id', :'second_single_id', 'Synthetic lifecycle note.', true);

insert into public.shidduchim (account_id, single_id, name_en, owner_member_id)
values (:'root_account_id', :'withdrawn_single_id', 'Rivky R21', :'root_member_id')
returning id as shidduch_id \gset

-- Both listings belong to THIS family, using the exact publisher membership
-- resolver ownership requires. The live one used to be a shadchanus office's,
-- which is the only reason this fixture ever needed a second account.
insert into public.listings (
  account_id, listing_type, single_id, published_by_member_id,
  single_first_name_en, single_age, single_location
)
values (
  :'root_account_id', 'single', :'second_single_id', :'root_member_id',
  'Yaakov', 27, 'Stack 2'
)
returning id as live_listing_id \gset
insert into public.listings (
  account_id, listing_type, single_id, published_by_member_id,
  single_first_name_en, single_age, single_location
)
values (
  :'root_account_id', 'single', :'withdrawn_single_id', :'root_member_id',
  'Rivky', 24, 'Stack 2'
);

select public.resolve_demo_listing_id(
  :'run_id', 'r21-activation-lease', :'root_account_id',
  'single', :'second_single_id', :'root_member_id'
) as resolved_live_listing_id \gset
select public.resolve_demo_listing_id(
  :'run_id', 'r21-activation-lease', :'root_account_id',
  'single', :'withdrawn_single_id', :'root_member_id'
) as resolved_withdrawn_listing_id \gset
select public.withdraw_demo_listing(
  :'run_id', 'r21-activation-lease', :'root_account_id',
  :'withdrawn_single_id', :'root_member_id'
) as withdrawal_result \gset
select public.withdraw_demo_listing(
  :'run_id', 'r21-activation-lease', :'root_account_id',
  :'withdrawn_single_id', :'root_member_id'
) as withdrawal_retry_result \gset

insert into public.share_links (
  account_id, single_id, created_by_member_id, token, expires_at,
  recipient_name, watermark
)
values (
  :'root_account_id', :'withdrawn_single_id', :'root_member_id',
  'r21-share-token', now() + interval '21 days', 'R21 recipient', true
)
returning id as share_id \gset
insert into public.share_access_log (
  share_link_id, resource, duration_ms, recipient_name, simulated
)
values (:'share_id', 'profile', 420, 'R21 recipient', true)
returning id as share_access_id \gset

insert into public.tasks (
  account_id, member_id, text, due_date, delivery_channels, target_type, target_id
)
values (
  :'root_account_id', :'root_person_id', 'R21 reminder', now() - interval '1 day',
  array['email']::text[], 'shidduch', :'shidduch_id'
)
returning id as task_id \gset
insert into public.task_notifications (
  account_id, task_id, channel, due_date, status, sent_at, simulated
)
values (
  :'root_account_id', :'task_id', 'email', now() - interval '1 day',
  'sent', now(), true
)
returning id as task_notification_id \gset

insert into public.inbox_items (account_id, source, raw_text, subject, status)
values (:'root_account_id', 'email', 'R21 demo intake', 'R21 intake', 'resolved')
returning id as inbox_id \gset
insert into public.analytics_events (account_id, event_type, properties)
select :'root_account_id', event_type, '{}'::jsonb
from unnest(array['item_filed', 'channel_capture', 'time_to_file']) event_type;
insert into public.trusted_senders (account_id, created_by_member_id, email)
values
  (:'root_account_id', :'root_member_id', 'r21-dovid@test.invalid'),
  (:'root_account_id', :'root_member_id', 'r21-leah@test.invalid');

-- Reset the receipt manifest to the exact baseline after trigger-side
-- idempotent registrations. The activation assertion remains authoritative.
delete from public.demo_run_resources where run_id = :run_id;
insert into public.demo_run_resources (run_id, resource_type, resource_id)
select :run_id, resource_type, resource_id
from (
  select 'invite'::text as resource_type, id as resource_id
  from public.invites where account_id = :'root_account_id'
) invites_rows
union all select :run_id, 'listing', :live_listing_id
union all select :run_id, 'listing_withdrawal', :withdrawn_single_id
union all select :run_id, 'share_link', :share_id
union all select :run_id, 'task', :task_id
union all select :run_id, 'share_access_log', :share_access_id
union all select :run_id, 'inbox_item', :inbox_id
union all select :run_id, 'analytics_event', id from public.analytics_events where account_id = :root_account_id
union all select :run_id, 'task_notification', :task_notification_id
union all select :run_id, 'trusted_sender', id from public.trusted_senders where account_id = :root_account_id
union all select :run_id, 'single_preference', id from public.single_preferences where account_id = :root_account_id
union all select :run_id, 'single_note', id from public.single_notes where account_id = :root_account_id;

insert into public.demo_run_storage (run_id, bucket, storage_path, resource_key)
select :run_id, 'documents', format('r21/doc-%s.bin', n), format('document-%s', n)
from generate_series(1, 47) n;
insert into public.demo_run_storage (run_id, bucket, storage_path, resource_key)
select :run_id, 'entity-files', format('r21/entity-%s.bin', n), format('entity-file-%s', n)
from generate_series(1, 3) n;

insert into r21_checks
select 'withdrawal has exact lifecycle outcome',
  :'withdrawal_result'::jsonb ->> 'outcome' = 'withdrawn'
  and :'withdrawal_retry_result'::jsonb ->> 'outcome' = 'already_withdrawn'
  and not exists (select 1 from public.listings where id = :resolved_withdrawn_listing_id)
  and not exists (
    select 1 from public.listings
    where account_id = :'root_account_id'::bigint
      and listing_type = 'single'
      and single_id = :'withdrawn_single_id'::bigint
  )
  and not exists (select 1 from public.demo_run_resources where run_id = :run_id and resource_type = 'listing' and resource_id = :resolved_withdrawn_listing_id)
  and exists (select 1 from public.demo_run_resources where run_id = :run_id and resource_type = 'listing_withdrawal' and resource_id = :withdrawn_single_id),
  :'withdrawal_result' || ' retry=' || :'withdrawal_retry_result';

insert into r21_checks
select 'exact official baseline inventory is registered',
  (
    with expected(resource_type, expected_count) as (
      values
        ('invite', 3), ('listing', 1),
        ('listing_withdrawal', 1), ('share_link', 1), ('task', 1),
        ('share_access_log', 1), ('inbox_item', 1), ('analytics_event', 3),
        ('task_notification', 1),
        ('trusted_sender', 2), ('single_preference', 2), ('single_note', 2)
    ), actual as (
      select resource_type, count(*)::bigint
      from public.demo_run_resources
      where run_id = :run_id
      group by resource_type
    )
    select not exists (
      select 1
      from expected e
      left join actual a using (resource_type)
      where coalesce(a.count, 0) <> e.expected_count
    )
  )
  and (select count(*) = 19 from public.demo_run_resources where run_id = :run_id)
  and (select count(*) = 50 from public.demo_run_storage where run_id = :run_id)
  and (select count(*) = 47 from public.demo_run_storage where run_id = :run_id and bucket = 'documents')
  and (select count(*) = 3 from public.demo_run_storage where run_id = :run_id and bucket = 'entity-files'),
  format(
    'resources=%s storage=%s documents=%s entity-files=%s',
    (select count(*) from public.demo_run_resources where run_id = :run_id),
    (select count(*) from public.demo_run_storage where run_id = :run_id),
    (select count(*) from public.demo_run_storage where run_id = :run_id and bucket = 'documents'),
    (select count(*) from public.demo_run_storage where run_id = :run_id and bucket = 'entity-files')
  );

select public.assert_official_demo_inventory(:run_id, false);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'root_user', 'role', 'authenticated')::text,
  true
);
insert into r21_checks
select 'seeding demo listing preview remains hidden',
  not public.demo_account_is_previewable(:'root_account_id'::bigint)
  and (select count(*) = 0 from public.listings),
  'previewable=' || public.demo_account_is_previewable(:'root_account_id'::bigint)
  || ' listings=' || (select count(*) from public.listings);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select set_config(
  'request.headers',
  json_build_object(
    'x-demo-run-id', :'run_id',
    'x-demo-lease-token', 'r21-activation-lease'
  )::text,
  true
);
select public.activate_demo_run(:run_id, 'r21-activation-lease', 'R21 Official Demo') as activation_result \gset
insert into r21_checks
select 'activation succeeds after withdrawal tombstone',
  :'activation_result'::jsonb ->> 'status' = 'active'
  and (select status = 'active' and operation is null and lease_token is null from public.demo_runs where id = :run_id)
  and (select demo from public.accounts where id = :'root_account_id'::bigint),
  :'activation_result';

select public.assert_official_demo_inventory(:run_id, true);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'root_user', 'role', 'authenticated')::text,
  true
);
insert into r21_checks
select 'authenticated active bundle preview contains only the live listing',
  public.demo_account_is_previewable(:'root_account_id'::bigint)
  -- One previewable account, because the bundle is one family.
  and (select count(*) = 1 from public.current_demo_preview_accounts())
  and (select count(*) = 1 from public.listings where id = :'live_listing_id'::bigint)
  and not exists (
    select 1 from public.listings
    where account_id = :'root_account_id'::bigint
      and listing_type = 'single'
      and single_id = :'withdrawn_single_id'::bigint
  ),
  'preview_accounts=' || (select count(*) from public.current_demo_preview_accounts())
  || ' listings=' || (select count(*) from public.listings);

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
insert into r21_checks
select 'anonymous public listings contain no activated demo listing',
  not exists (
    select shadchan_name, shadchan_contact_info
    from public.listings
    where shadchan_name = 'Leah Feldman'
      and shadchan_contact_info = 'Contact through the Feldman office'
  ),
  'matching public demo listings=' || (
    select count(*)
    from public.listings
    where shadchan_name = 'Leah Feldman'
      and shadchan_contact_info = 'Contact through the Feldman office'
  );
reset role;

-- Final seed compensation is independently exercised against an isolated
-- account so its denied paths cannot interfere with activation above.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into public.accounts (name, kind)
values ('r21 finalizer fixture', 'household')
returning id as finalizer_account_id \gset
insert into public.demo_runs (
  root_account_id, status, lease_expires_at, lease_token, operation,
  original_root_name
)
values (
  :'finalizer_account_id', 'seeding', clock_timestamp() + interval '10 minutes',
  'r21-finalizer-lease', 'seed', 'Finalizer fixture'
)
returning id as finalizer_run_id \gset
insert into public.demo_run_accounts (
  run_id, account_id, context_key, context_kind, is_root
)
values (
  :'finalizer_run_id', :'finalizer_account_id',
  'primary-household', 'household', true
);
insert into public.demo_run_storage (run_id, bucket, storage_path, resource_key)
values (
  :'finalizer_run_id', 'documents', 'r21-finalizer/manifest.bin', 'manifest'
);
create temporary table r21_finalizer_fixture (
  run_id bigint not null,
  lease_token text not null
) on commit drop;
insert into r21_finalizer_fixture (run_id, lease_token)
values (:'finalizer_run_id', 'r21-finalizer-lease');
grant select on r21_finalizer_fixture to public;

do $$
begin
  perform public.finalize_demo_seed_cleanup(
    (select run_id from r21_finalizer_fixture), 'wrong-lease'
  );
  raise exception 'wrong lease finalization unexpectedly succeeded';
exception when others then
  if sqlerrm not like 'demo run % lease is stale or fenced' then raise; end if;
end
$$;
insert into r21_checks
select 'finalizer rejects a wrong lease and retains its manifest',
  exists (select 1 from public.demo_runs where id = :'finalizer_run_id')
  and exists (select 1 from public.demo_run_storage where run_id = :'finalizer_run_id'),
  'run=' || exists (select 1 from public.demo_runs where id = :'finalizer_run_id')
  || ' storage=' || exists (select 1 from public.demo_run_storage where run_id = :'finalizer_run_id');

update public.demo_runs
set operation = 'clear'
where id = :'finalizer_run_id';
do $$
begin
  perform public.finalize_demo_seed_cleanup(
    (select run_id from r21_finalizer_fixture), 'r21-finalizer-lease'
  );
  raise exception 'wrong operation finalization unexpectedly succeeded';
exception when others then
  if sqlerrm not like 'demo run % lease is stale or fenced' then raise; end if;
end
$$;
insert into r21_checks
select 'finalizer rejects a wrong operation and retains its manifest',
  exists (select 1 from public.demo_runs where id = :'finalizer_run_id')
  and exists (select 1 from public.demo_run_storage where run_id = :'finalizer_run_id');

update public.demo_runs
set operation = 'seed', status = 'active'
where id = :'finalizer_run_id';
do $$
begin
  perform public.finalize_demo_seed_cleanup(
    (select run_id from r21_finalizer_fixture), 'r21-finalizer-lease'
  );
  raise exception 'wrong status finalization unexpectedly succeeded';
exception when others then
  if sqlerrm not like 'demo run % lease is stale or fenced' then raise; end if;
end
$$;
insert into r21_checks
select 'finalizer rejects a wrong status and retains its manifest',
  exists (select 1 from public.demo_runs where id = :'finalizer_run_id')
  and exists (select 1 from public.demo_run_storage where run_id = :'finalizer_run_id');

update public.demo_runs
set status = 'seeding', lease_expires_at = clock_timestamp() - interval '1 second'
where id = :'finalizer_run_id';
do $$
begin
  perform public.finalize_demo_seed_cleanup(
    (select run_id from r21_finalizer_fixture), 'r21-finalizer-lease'
  );
  raise exception 'expired lease finalization unexpectedly succeeded';
exception when others then
  if sqlerrm not like 'demo run % lease is stale or fenced' then raise; end if;
end
$$;
insert into r21_checks
select 'finalizer rejects an expired lease and retains its manifest',
  exists (select 1 from public.demo_runs where id = :'finalizer_run_id')
  and exists (select 1 from public.demo_run_storage where run_id = :'finalizer_run_id');

update public.demo_runs
set lease_expires_at = clock_timestamp() + interval '10 minutes'
where id = :'finalizer_run_id';
do $$
begin
  perform public.finalize_demo_seed_cleanup(9223372036854775807, 'r21-finalizer-lease');
  raise exception 'missing run finalization unexpectedly succeeded';
exception when others then
  if sqlerrm not like 'demo run % lease is stale or fenced' then raise; end if;
end
$$;
insert into r21_checks
select 'finalizer rejects a missing run',
  exists (select 1 from public.demo_runs where id = :'finalizer_run_id')
  and exists (select 1 from public.demo_run_storage where run_id = :'finalizer_run_id');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  perform public.finalize_demo_seed_cleanup(
    (select run_id from r21_finalizer_fixture), 'r21-finalizer-lease'
  );
  raise exception 'anon finalization unexpectedly succeeded';
exception when others then
  if sqlerrm = 'anon finalization unexpectedly succeeded' then raise; end if;
  if sqlstate <> '42501' or sqlerrm not like '%finalize_demo_seed_cleanup%' then raise; end if;
end
$$;
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into r21_checks
select 'anonymous finalization is denied and retains its manifest',
  exists (select 1 from public.demo_runs where id = :'finalizer_run_id')
  and exists (select 1 from public.demo_run_storage where run_id = :'finalizer_run_id');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
do $$
begin
  perform public.finalize_demo_seed_cleanup(
    (select run_id from r21_finalizer_fixture), 'r21-finalizer-lease'
  );
  raise exception 'authenticated finalization unexpectedly succeeded';
exception when others then
  if sqlerrm = 'authenticated finalization unexpectedly succeeded' then raise; end if;
  if sqlstate <> '42501' or sqlerrm not like '%finalize_demo_seed_cleanup%' then raise; end if;
end
$$;
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into r21_checks
select 'authenticated finalization is denied and retains its manifest',
  exists (select 1 from public.demo_runs where id = :'finalizer_run_id')
  and exists (select 1 from public.demo_run_storage where run_id = :'finalizer_run_id');

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select set_config(
  'request.headers',
  json_build_object(
    'x-demo-run-id', :'finalizer_run_id',
    'x-demo-lease-token', 'r21-finalizer-lease'
  )::text,
  true
);
select public.finalize_demo_seed_cleanup(
  :'finalizer_run_id', 'r21-finalizer-lease'
) as finalizer_result \gset
insert into r21_checks
select 'finalizer accepts the current lease and removes the manifest atomically',
  :'finalizer_result'::boolean
  and not exists (select 1 from public.demo_runs where id = :'finalizer_run_id')
  and not exists (select 1 from public.demo_run_storage where run_id = :'finalizer_run_id');

\t on
\a
select coalesce(json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name), '[]'::json)
from r21_checks;

rollback;
