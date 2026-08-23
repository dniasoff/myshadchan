\set ON_ERROR_STOP on
begin;

select gen_random_uuid() as demo_root_user_id \gset
select gen_random_uuid() as demo_other_user_id \gset
select gen_random_uuid() as demo_leah_user_id \gset
select gen_random_uuid() as demo_miriam_user_id \gset
insert into auth.users (id, instance_id, aud, role, email)
values
  (:'demo_root_user_id', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'official-demo-root@test.local'),
  (:'demo_other_user_id', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'official-demo-other@test.local'),
  (:'demo_leah_user_id', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'official-demo-leah@test.local'),
  (:'demo_miriam_user_id', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'official-demo-miriam@test.local');

insert into public.accounts (name, kind)
values ('Official Demo Test Root', 'household')
returning id as demo_root_account_id \gset
insert into public.accounts (name, kind)
values ('Official Demo Test Shadchanus', 'shadchanus')
returning id as demo_shadchan_account_id \gset
insert into public.accounts (name, kind)
values ('Official Demo Test Other', 'household')
returning id as demo_other_account_id \gset
insert into public.accounts (name, kind)
values ('Official Demo Test Gross', 'household')
returning id as demo_gross_account_id \gset

insert into public.account_members (account_id, user_id, role, status)
values
  (:'demo_root_account_id', :'demo_root_user_id', 'parent_admin', 'active'),
  (:'demo_other_account_id', :'demo_other_user_id', 'parent_admin', 'active'),
  (:'demo_gross_account_id', :'demo_miriam_user_id', 'parent_admin', 'active');
insert into public.account_members (account_id, user_id, role, status)
values (:'demo_shadchan_account_id', :'demo_leah_user_id', 'shadchan', 'active')
returning id as demo_shadchan_member_id \gset
select id as demo_gross_member_id
from public.account_members
where account_id = :'demo_gross_account_id'
  and user_id = :'demo_miriam_user_id'
limit 1 \gset

update public.member_state
set active_account_id = :'demo_root_account_id'
where user_id = :'demo_root_user_id';
update public.member_state
set active_account_id = :'demo_other_account_id'
where user_id = :'demo_other_user_id';
update public.member_state
set active_account_id = :'demo_gross_account_id'
where user_id = :'demo_miriam_user_id';

insert into public.demo_runs (root_account_id, status)
values (:'demo_root_account_id', 'active')
returning id as demo_run_id \gset
insert into public.demo_runs (root_account_id, status)
values (:'demo_other_account_id', 'active')
returning id as demo_other_run_id \gset

insert into public.demo_run_accounts (run_id, account_id, context_key, context_kind, is_root)
values
  (:'demo_run_id', :'demo_root_account_id', 'primary-household', 'household', true),
  (:'demo_run_id', :'demo_shadchan_account_id', 'feldman-shadchanus', 'shadchanus', false),
  (:'demo_run_id', :'demo_gross_account_id', 'gross-household', 'household', false),
  (:'demo_other_run_id', :'demo_other_account_id', 'primary-household', 'household', true);
insert into public.demo_run_users (run_id, user_id, actor_key)
values
  (:'demo_run_id', :'demo_root_user_id', 'dovid-klein'),
  (:'demo_run_id', :'demo_leah_user_id', 'leah-feldman'),
  (:'demo_run_id', :'demo_miriam_user_id', 'miriam-gross');

insert into public.connections (
  household_account_id, shadchanus_account_id, status, proposed_by_account_id,
  accepted_at, household_account_name
)
values (
  :'demo_root_account_id', :'demo_shadchan_account_id', 'accepted',
  :'demo_root_account_id', now(), 'Official Demo Test Root'
)
returning id as demo_connection_id \gset

insert into public.listings (
  account_id, listing_type, shadchan_name, shadchan_area, shadchan_contact_info
)
values (
  :'demo_shadchan_account_id', 'shadchan', 'Synthetic Demo Office', 'Test City', 'Synthetic only'
)
returning id as demo_listing_id \gset

insert into public.singles (
  account_id, first_name_en, last_name_en, gender, dob, community
)
values (
  :'demo_root_account_id', 'Rivky', 'Test', 'female', '2002-04-18', 'Test City'
)
returning id as demo_single_id \gset
insert into public.singles (
  account_id, first_name_en, last_name_en, gender, dob, community
)
values (
  :'demo_root_account_id', 'Yaakov', 'Test', 'male', '1998-09-02', 'Test City'
)
returning id as demo_boy_id \gset
insert into public.single_preferences (account_id, single_id, body, visible_to_manager)
values
  (:'demo_root_account_id', :'demo_single_id', 'Warm, growth-oriented ben Torah with strong middos.', true),
  (:'demo_root_account_id', :'demo_boy_id', 'Kind, grounded, and family-oriented.', false);
insert into public.single_notes (account_id, single_id, body, visible_to_manager)
values
  (:'demo_root_account_id', :'demo_single_id', 'Prefers a calm, collaborative process.', false),
  (:'demo_root_account_id', :'demo_boy_id', 'Comfortable with an introduction through the office.', true);
select id as demo_root_member_id
from public.account_members
where account_id = :'demo_root_account_id'
  and user_id = :'demo_root_user_id'
limit 1 \gset
insert into public.listings (
  account_id, listing_type, single_id, published_by_member_id,
  single_first_name_en, single_age, single_location, single_summary
)
values (
  :'demo_root_account_id', 'single', :'demo_single_id', :'demo_root_member_id',
  'Rivky', 24, 'Test City', 'Synthetic withdrawn listing'
)
returning id as demo_withdrawn_listing_id \gset
delete from public.listings where id = :'demo_withdrawn_listing_id';
insert into public.listing_withdrawal_locks (single_id, account_id)
values (:'demo_single_id', :'demo_root_account_id')
on conflict (single_id) do nothing;

insert into public.share_links (
  account_id, single_id, created_by_member_id, token, expires_at,
  recipient_name, watermark
)
values (
  :'demo_root_account_id', :'demo_single_id', :'demo_root_member_id',
  'official-demo-share-token', now() + interval '21 days', 'Synthetic recipient', true
)
returning id as demo_share_id \gset
insert into public.share_access_log (
  share_link_id, resource, duration_ms, recipient_name, simulated
)
values (:'demo_share_id', 'profile', 420, null, true);

insert into public.accounts (name, kind)
values ('Official Demo Public Account', 'household')
returning id as demo_public_account_id \gset
insert into public.accounts (name, kind)
values ('Official Demo Ordinary Shadchanus', 'shadchanus')
returning id as demo_public_shadchan_account_id \gset
insert into public.account_members (account_id, user_id, role, status)
values (:'demo_public_account_id', :'demo_other_user_id', 'parent_admin', 'active');
insert into public.listings (
  account_id, listing_type, shadchan_name, shadchan_area, shadchan_contact_info
)
values (
  :'demo_public_account_id', 'shadchan', 'Ordinary Office', 'Test City', 'Public test row'
)
returning id as public_listing_id \gset
insert into public.connections (
  household_account_id, shadchanus_account_id, status, proposed_by_account_id,
  accepted_at, household_account_name
)
values (
  :'demo_root_account_id', :'demo_public_shadchan_account_id', 'accepted',
  :'demo_root_account_id', now(), 'Official Demo Test Root'
)
returning id as mixed_connection_id \gset

create temporary table official_demo_checks (
  name text not null,
  passed boolean not null,
  detail text
) on commit drop;
grant all on official_demo_checks to anon, authenticated;
grant all on official_demo_checks to service_role;

insert into official_demo_checks
select 'seeded relationship registration hook exists',
       exists (
         select 1 from pg_proc
         where proname = 'demo_register_seed_resource'
       ),
       null;
insert into official_demo_checks
select 'official graph has exactly three contexts and three actors',
       (select count(*) = 3 from public.demo_run_accounts where run_id = :'demo_run_id')
       and (select count(*) = 3 from public.demo_run_users where run_id = :'demo_run_id')
       and (select count(*) = 1 from public.demo_run_accounts where run_id = :'demo_run_id' and is_root),
       null;
insert into official_demo_checks
select 'private single fixtures preserve exact manager visibility',
       (select count(*) = 2 from public.single_preferences where account_id = :'demo_root_account_id')
       and (select count(*) = 2 from public.single_notes where account_id = :'demo_root_account_id')
       and (select count(*) = 1 from public.single_preferences where account_id = :'demo_root_account_id' and visible_to_manager)
       and (select count(*) = 1 from public.single_notes where account_id = :'demo_root_account_id' and visible_to_manager),
       null;
set local role postgres;
update public.demo_runs set status = 'seeding' where id = :'demo_run_id';
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'demo_root_user_id', 'role', 'authenticated')::text,
  true
);
select public.demo_register_seed_resource(
  'connection', :'demo_connection_id'::bigint, :'demo_root_account_id'::bigint
);
insert into official_demo_checks
select 'seeding RPC auto-registers its resource',
       exists (
         select 1
         from public.demo_run_resources
         where run_id = :'demo_run_id'
           and resource_type = 'connection'
           and resource_id = :'demo_connection_id'::bigint
       ),
       null;

-- Registration must keep nullable relationship endpoints optional while still
-- enforcing the required proposer/inviter and target-single axes.  Exercise
-- each lifecycle state plus a foreign relationship in the same seeded run.
insert into public.connection_invites (
  inviter_account_id, inviter_kind, token_hash, status, expires_at
)
values (
  :'demo_root_account_id', 'household',
  encode(extensions.digest('official-demo-pending-connection', 'sha256'), 'hex'),
  'pending', now() + interval '7 days'
)
returning id as demo_pending_connection_invite_id \gset
insert into public.connection_invites (
  inviter_account_id, inviter_kind, token_hash, status,
  expires_at, accepted_by_account_id, accepted_at
)
values (
  :'demo_root_account_id', 'household',
  encode(extensions.digest('official-demo-accepted-connection', 'sha256'), 'hex'),
  'accepted', now() + interval '7 days', :'demo_shadchan_account_id', now()
)
returning id as demo_accepted_connection_invite_id \gset
insert into public.connection_invites (
  inviter_account_id, inviter_kind, token_hash, status, expires_at, revoked_at
)
values (
  :'demo_root_account_id', 'household',
  encode(extensions.digest('official-demo-revoked-connection', 'sha256'), 'hex'),
  'revoked', now() + interval '7 days', now()
)
returning id as demo_revoked_connection_invite_id \gset
select public.demo_register_seed_resource(
  'connection_invite', :'demo_pending_connection_invite_id'::bigint, :'demo_root_account_id'::bigint
);
select public.demo_register_seed_resource(
  'connection_invite', :'demo_accepted_connection_invite_id'::bigint, :'demo_root_account_id'::bigint
);
select public.demo_register_seed_resource(
  'connection_invite', :'demo_revoked_connection_invite_id'::bigint, :'demo_root_account_id'::bigint
);

insert into public.child_grants (
  proposer_account_id, target_single_id, token_hash, status, expires_at
)
values (
  :'demo_root_account_id', :'demo_single_id',
  encode(extensions.digest('official-demo-pending-grant', 'sha256'), 'hex'),
  'pending', now() + interval '7 days'
)
returning id as demo_pending_child_grant_id \gset
insert into public.child_grants (
  proposer_account_id, target_single_id, token_hash, status,
  expires_at, grantee_account_id, accepted_at
)
values (
  :'demo_root_account_id', :'demo_single_id',
  encode(extensions.digest('official-demo-accepted-grant', 'sha256'), 'hex'),
  'accepted', now() + interval '7 days', :'demo_gross_account_id', now()
)
returning id as demo_accepted_child_grant_id \gset
insert into public.child_grants (
  proposer_account_id, target_single_id, token_hash, status, expires_at, revoked_at
)
values (
  :'demo_root_account_id', :'demo_single_id',
  encode(extensions.digest('official-demo-revoked-grant', 'sha256'), 'hex'),
  'revoked', now() + interval '7 days', now()
)
returning id as demo_revoked_child_grant_id \gset
select public.demo_register_seed_resource(
  'child_grant', :'demo_pending_child_grant_id'::bigint, :'demo_root_account_id'::bigint
);
select public.demo_register_seed_resource(
  'child_grant', :'demo_accepted_child_grant_id'::bigint, :'demo_root_account_id'::bigint
);
select public.demo_register_seed_resource(
  'child_grant', :'demo_revoked_child_grant_id'::bigint, :'demo_root_account_id'::bigint
);
insert into official_demo_checks
select 'pending accepted revoked relationship ownership is registered',
       (select count(*) = 3 from public.demo_run_resources
        where run_id = :'demo_run_id' and resource_type = 'connection_invite'
          and resource_id in (:'demo_pending_connection_invite_id'::bigint, :'demo_accepted_connection_invite_id'::bigint, :'demo_revoked_connection_invite_id'::bigint))
       and (select count(*) = 3 from public.demo_run_resources
            where run_id = :'demo_run_id' and resource_type = 'child_grant'
              and resource_id in (:'demo_pending_child_grant_id'::bigint, :'demo_accepted_child_grant_id'::bigint, :'demo_revoked_child_grant_id'::bigint)),
       null;
select set_config('official_demo.root_account_id', :'demo_root_account_id', true);
select set_config('official_demo.other_account_id', :'demo_other_account_id', true);
select set_config('official_demo.single_id', :'demo_single_id', true);
do $$
declare
  v_foreign_id bigint;
begin
  begin
    insert into public.connection_invites (
      inviter_account_id, inviter_kind, token_hash, status, expires_at
    ) values (
      current_setting('official_demo.other_account_id')::bigint, 'household',
      encode(extensions.digest('official-demo-foreign-connection', 'sha256'), 'hex'),
      'pending', now() + interval '7 days'
    ) returning id into strict v_foreign_id;
    perform public.demo_register_seed_resource('connection_invite', v_foreign_id, current_setting('official_demo.root_account_id')::bigint);
    insert into official_demo_checks values ('foreign relationship invite registration fails closed', false, null);
  exception when others then
    insert into official_demo_checks values ('foreign relationship invite registration fails closed', true, sqlerrm);
  end;
  begin
    insert into public.child_grants (
      proposer_account_id, target_single_id, token_hash, status, expires_at
    ) values (
      current_setting('official_demo.other_account_id')::bigint,
      current_setting('official_demo.single_id')::bigint,
      encode(extensions.digest('official-demo-foreign-grant', 'sha256'), 'hex'),
      'pending', now() + interval '7 days'
    ) returning id into strict v_foreign_id;
    perform public.demo_register_seed_resource('child_grant', v_foreign_id, current_setting('official_demo.root_account_id')::bigint);
    insert into official_demo_checks values ('foreign child grant registration fails closed', false, null);
  exception when others then
    insert into official_demo_checks values ('foreign child grant registration fails closed', true, sqlerrm);
  end;
end;
$$;
select set_config('official_demo.root_account_id', :'demo_root_account_id', true);
do $$
begin
  begin
    perform public.demo_register_seed_resource(
      'thread', 987654321, current_setting('official_demo.root_account_id')::bigint
    );
    insert into official_demo_checks values ('foreign resource registration fails closed', false, null);
  exception when others then
    insert into official_demo_checks values ('foreign resource registration fails closed', true, sqlerrm);
  end;
end;
$$;
update public.demo_runs set status = 'active' where id = :'demo_run_id';

-- Demo queue rows settle locally and are never eligible for a worker claim.
insert into public.tasks (
  account_id, member_id, text, due_date, delivery_channels, target_type, target_id
)
values (
  :'demo_root_account_id', null, 'Synthetic reminder', now() - interval '1 day',
  array['email']::text[], 'single', :'demo_single_id'
)
returning id as demo_queue_task_id \gset
select public.enqueue_due_task_notifications(now()) as demo_enqueued \gset
insert into official_demo_checks
select 'demo reminder settles locally as sent',
       exists (
         select 1
         from public.task_notifications
         where task_id = :'demo_queue_task_id'
           and status = 'sent'
           and simulated
           and sent_at is not null
       ),
       coalesce((
         select format('status=%s simulated=%s sent_at=%s', status, simulated, sent_at)
         from public.task_notifications
         where task_id = :'demo_queue_task_id'
         limit 1
       ), 'missing task notification');
insert into official_demo_checks
select 'demo reminder cannot be claimed',
       not exists (
         select 1 from public.claim_due_task_notifications(10)
         where task_id = :'demo_queue_task_id'
       ),
       null;

insert into public.threads (connection_id, subject_type, visibility)
values (:'demo_connection_id', 'relationship', 'open')
returning id as demo_message_thread_id \gset
insert into public.thread_participants (connection_id, thread_id, member_id)
values (:'demo_connection_id', :'demo_message_thread_id', :'demo_root_member_id');
insert into public.thread_participants (connection_id, thread_id, member_id)
values (:'demo_connection_id', :'demo_message_thread_id', :'demo_shadchan_member_id');
insert into public.messages (connection_id, thread_id, body)
values (:'demo_connection_id', :'demo_message_thread_id', 'Synthetic demo message')
returning id as demo_message_id \gset
insert into official_demo_checks
select 'demo message settles locally as sent',
       exists (
         select 1
         from public.message_notifications
         where message_id = :'demo_message_id'
           and status = 'sent'
           and simulated
           and sent_at is not null
       ),
       coalesce((
         select format('status=%s simulated=%s sent_at=%s', status, simulated, sent_at)
         from public.message_notifications
         where message_id = :'demo_message_id'
         limit 1
       ), 'missing message notification');
insert into official_demo_checks
select 'demo message cannot be claimed',
       not exists (
         select 1 from public.claim_message_notifications(10)
         where id in (
           select id from public.message_notifications
           where message_id = :'demo_message_id'
         )
       ),
       null;

-- An ordinary account still follows the real pending/claim path.
select set_config('request.jwt.claims', '{}', true);
insert into public.accounts (name, kind)
values ('Official Demo Queue Control', 'household')
returning id as demo_control_account_id \gset
insert into public.members (first_name, last_name, email, administrator, user_id)
values ('Queue', 'Control', 'queue-control@test.local', false, :'demo_other_user_id')
on conflict (user_id) do nothing;
select id as demo_control_owner_member_id
from public.members
where user_id = :'demo_other_user_id' \gset
insert into public.account_members (account_id, user_id, role, status)
values (:'demo_control_account_id', :'demo_other_user_id', 'parent_admin', 'active')
returning id as demo_control_member_id \gset
insert into public.tasks (
  account_id, member_id, text, due_date, delivery_channels, target_type, target_id
)
values (
  :'demo_control_account_id', :'demo_control_owner_member_id', 'Control reminder',
  now() - interval '1 day', array['email']::text[], 'single', :'demo_single_id'
)
returning id as demo_control_task_id \gset
select public.enqueue_due_task_notifications(now()) as demo_control_enqueued \gset
insert into official_demo_checks
select 'non-demo reminder remains claimable',
       exists (
         select 1 from public.claim_due_task_notifications(10)
         where task_id = :'demo_control_task_id'
       ),
       null;
insert into public.threads (account_id, subject_type, visibility)
values (:'demo_control_account_id', 'relationship', 'open')
returning id as demo_control_thread_id \gset
insert into public.thread_participants (account_id, thread_id, member_id)
values (:'demo_control_account_id', :'demo_control_thread_id', :'demo_control_member_id');
insert into public.messages (account_id, thread_id, sender_member_id, body)
values (:'demo_control_account_id', :'demo_control_thread_id', null, 'Control message')
returning id as demo_control_message_id \gset
insert into official_demo_checks
select 'non-demo message remains claimable',
       exists (
         select 1 from public.claim_message_notifications(10)
         where message_body = 'Control message'
       ),
       null;

-- Anonymous search excludes every listing in an active bundle but preserves
-- an ordinary public listing.
set local role anon;
select set_config('request.jwt.claims', '{}', true);
insert into official_demo_checks
select 'anon excludes active demo listing', not exists (
         select shadchan_name, shadchan_contact_info
         from public.listings
         where shadchan_name = 'Synthetic Demo Office'
           and shadchan_contact_info = 'Synthetic only'
       ),
       'matching public demo listings=' || (
         select count(*)::text
         from public.listings
         where shadchan_name = 'Synthetic Demo Office'
           and shadchan_contact_info = 'Synthetic only'
       );
insert into official_demo_checks
select 'anon still sees ordinary listing', count(*) = 1,
       'count=' || count(*)::text
from public.listings where id = :'public_listing_id';
set local role postgres;

-- The root user can preview its own bundle, not another active run.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'demo_root_user_id', 'role', 'authenticated')::text,
  true
);
insert into official_demo_checks
select 'authenticated caller can preview own bundle',
       public.demo_account_is_previewable(:'demo_root_account_id'),
       null;
insert into official_demo_checks
select 'authenticated caller can preview same-bundle companion',
       public.demo_account_is_previewable(:'demo_shadchan_account_id'),
       null;
insert into official_demo_checks
select 'caller-scoped active preview gate is true',
       public.current_account_demo_previewable(),
       null;
insert into official_demo_checks
select 'authenticated caller cannot preview another bundle',
       not public.demo_account_is_previewable(:'demo_other_account_id'),
       null;
insert into official_demo_checks
select 'authenticated demo preview projection',
       (select count(*) = 3
        from public.current_demo_preview_accounts()),
       null;

insert into official_demo_checks
select 'simulation scope is not browser callable',
       not has_function_privilege('authenticated', 'public.demo_scope_is_simulated(bigint,bigint)', 'execute'),
       null;

set local role postgres;
insert into official_demo_checks
select 'cross-bundle simulation scope is contained locally',
       public.demo_scope_is_simulated(:'demo_other_account_id', :'demo_connection_id'),
       null;
insert into official_demo_checks
select 'same-bundle simulation scope is allowed',
       public.demo_scope_is_simulated(:'demo_root_account_id', :'demo_connection_id'),
       null;
insert into official_demo_checks
select 'mixed production/demo connection is simulated locally',
       public.demo_scope_is_simulated(:'demo_root_account_id', :'mixed_connection_id'),
       null;
insert into official_demo_checks
select 'contextless simulation scope fails closed',
       not public.demo_scope_is_simulated(null, null),
       null;

-- Synthetic actors may complete the final relationship/membership steps while
-- their run is still seeding. An unregistered customer cannot use that same
-- window to join or mutate the bundle.
select set_config('official_demo.root_account_id', :'demo_root_account_id', true);
set local role postgres;
update public.demo_runs set status = 'seeding' where id = :'demo_run_id';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'demo_root_user_id', 'role', 'authenticated')::text,
  true
);
set local role service_role;
do $$
begin
  perform public.demo_assert_same_active_run(
    array[current_setting('official_demo.root_account_id')::bigint],
    'test seeding actor'
  );
  insert into official_demo_checks values ('registered synthetic actor may mutate while seeding', true, null);
exception when others then
  insert into official_demo_checks values ('registered synthetic actor may mutate while seeding', false, sqlerrm);
end;
$$;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'demo_other_user_id', 'role', 'authenticated')::text,
  true
);
set local role service_role;
do $$
begin
  perform public.demo_assert_same_active_run(
    array[current_setting('official_demo.root_account_id')::bigint],
    'test customer seeding actor'
  );
  insert into official_demo_checks values ('unregistered customer cannot mutate while seeding', false, null);
exception when others then
  insert into official_demo_checks values ('unregistered customer cannot mutate while seeding', true, sqlerrm);
end;
$$;
set local role postgres;
update public.demo_runs set status = 'active' where id = :'demo_run_id';

update public.member_state
set active_account_id = :'demo_public_account_id'
where user_id = :'demo_other_user_id';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'demo_other_user_id', 'role', 'authenticated')::text,
  true
);
insert into official_demo_checks
select 'authenticated ordinary owner listing access',
       exists (
         select 1 from public.listings where id = :'public_listing_id'
       ),
       null;
insert into official_demo_checks
select 'ordinary owner has no demo preview projection',
       not exists (select 1 from public.current_demo_preview_accounts()),
       null;
set local role postgres;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'demo_root_user_id', 'role', 'authenticated')::text,
  true
);
insert into official_demo_checks
select 'active same-run delivery history is visible',
       exists (
         select 1
         from public.demo_delivery_history()
         where event_type = 'share'
           and status = 'accessed'
           and simulated
           and resource = 'profile'
       ),
       null;
set local role postgres;

-- Active regrant is a real customer interaction: the new grant must be
-- registered atomically, and the clear-owned manifest must address it.
insert into public.child_grants (
  proposer_account_id, target_single_id, token_hash, status, expires_at, access_level
)
values (
  :'demo_root_account_id', :'demo_single_id',
  encode(extensions.digest('official-demo-old-grant', 'sha256'), 'hex'),
  'severed', now() + interval '7 days', 'edit'
)
returning id as demo_regrant_old_id \gset
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'demo_root_user_id', 'role', 'authenticated')::text,
  true
);
select public.regrant_child_grant(:'demo_regrant_old_id'::bigint) as demo_regrant_token \gset
set local role postgres;
insert into official_demo_checks
select 'active regrant is manifest-registered',
       (select count(*) = 1 from public.child_grants
        where id = (select max(id) from public.child_grants
                    where proposer_account_id = :'demo_root_account_id')
          and status = 'pending')
       and (select count(*) = 1 from public.demo_run_resources
        where run_id = :'demo_run_id' and resource_type = 'child_grant'
          and resource_id = (select max(id) from public.child_grants
                             where proposer_account_id = :'demo_root_account_id')),
       format('pending=%s manifest=%s',
         (select count(*) from public.child_grants
          where proposer_account_id = :'demo_root_account_id' and status = 'pending'),
         (select count(*) from public.demo_run_resources
          where run_id = :'demo_run_id' and resource_type = 'child_grant'));

-- Exercise the clear claim and the exact manifest-addressed grant deletion.
select public.claim_demo_clear(:'demo_root_account_id'::bigint) as demo_clear_claim \gset
select set_config('request.jwt.claims', '{}', true);
delete from public.child_grants cg
using public.demo_run_resources drr
where drr.run_id = :'demo_run_id'
  and drr.resource_type = 'child_grant'
  and drr.resource_id = cg.id;
insert into official_demo_checks
select 'active regrant clear leaves zero manifest grants',
       not exists (
         select 1 from public.child_grants cg
         join public.demo_run_resources drr on drr.resource_id = cg.id
         where drr.run_id = :'demo_run_id' and drr.resource_type = 'child_grant'
       ),
       null;
update public.demo_runs
set status = 'active', operation = null, lease_token = null, lease_expires_at = null
where id = :'demo_run_id';

-- A retained failed run is still a live containment/cleanup handle. It must
-- remain hidden from anonymous listing search and simulated to server-side
-- notification/ingest paths until clear_demo removes the manifest.
update public.demo_runs
set status = 'failed'
where id = :'demo_run_id';
insert into official_demo_checks
select 'failed run remains simulated',
       public.demo_scope_is_simulated(:'demo_root_account_id', :'demo_connection_id'),
       null;
set local role anon;
insert into official_demo_checks
select 'anon excludes failed demo listing', not exists (
         select shadchan_name, shadchan_contact_info
         from public.listings
         where shadchan_name = 'Synthetic Demo Office'
           and shadchan_contact_info = 'Synthetic only'
       ),
       'matching public demo listings=' || (
         select count(*)::text
         from public.listings
         where shadchan_name = 'Synthetic Demo Office'
           and shadchan_contact_info = 'Synthetic only'
       );
insert into official_demo_checks
select 'anon containment helper includes failed run',
       public.demo_account_in_active_run(:'demo_root_account_id'),
       null;
set local role postgres;
insert into official_demo_checks
select 'failed run resolver retains the run handle',
       public.demo_run_for_account(:'demo_root_account_id') = :'demo_run_id'::bigint,
       null;
insert into official_demo_checks
select 'failed run bundle membership remains contained',
       public.demo_bundle_contains_account(:'demo_run_id'::bigint, :'demo_shadchan_account_id'::bigint),
       null;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'demo_root_user_id', 'role', 'authenticated')::text,
  true
);
insert into official_demo_checks
select 'failed run remains visible to caller recovery surfaces',
       public.current_account_demo(),
       null;
insert into official_demo_checks
select 'failed run preview gate is denied',
       not public.current_account_demo_previewable(),
       null;
insert into official_demo_checks
select 'failed run preview is denied',
       not public.demo_account_is_previewable(:'demo_root_account_id'),
       null;
insert into official_demo_checks
select 'low-level run resolver is not browser callable',
       not has_function_privilege('authenticated', 'public.demo_run_for_account(bigint)', 'execute'),
       null;
insert into official_demo_checks
select 'low-level root resolver is not browser callable',
       not has_function_privilege('authenticated', 'public.demo_root_account_for(bigint)', 'execute'),
       null;
insert into official_demo_checks
select 'low-level bundle predicate is not browser callable',
       not has_function_privilege('authenticated', 'public.demo_bundle_contains_account(bigint,bigint)', 'execute'),
       null;
set local role postgres;
insert into official_demo_checks
select 'manifest graph has one root and two companions',
       (select count(*) = 3 from public.demo_run_accounts where run_id = :'demo_run_id')
       and (select count(*) = 1 from public.demo_run_accounts where run_id = :'demo_run_id' and is_root),
       null;
set local role authenticated;
insert into official_demo_checks
select 'failed run has no delivery history',
       not exists (select 1 from public.demo_delivery_history()),
       null;
insert into official_demo_checks
select 'sanitized delivery history returns no secrets',
       not exists (
         select 1 from public.demo_delivery_history()
         where resource like '%@%' or resource like '%token%' or resource like '%/%'
       ),
       null;
set local role postgres;
update public.demo_runs set status = 'seeding' where id = :'demo_run_id';
set local role authenticated;
insert into official_demo_checks
select 'seeding run has no delivery history',
       not exists (select 1 from public.demo_delivery_history()),
       null;
set local role postgres;
update public.demo_runs set status = 'clearing' where id = :'demo_run_id';
set local role authenticated;
insert into official_demo_checks
select 'clearing run has no delivery history',
       not exists (select 1 from public.demo_delivery_history()),
       null;

-- The active-root uniqueness guard makes a repeated seed fail closed rather
-- than creating a second run for the same tenant. This is a structural
-- repeat-seed/clear invariant, exercised without mutating the local stack.
set local role postgres;
create temporary table official_demo_repeat_target (root_account_id bigint) on commit drop;
insert into official_demo_repeat_target values (:'demo_root_account_id');
create temporary table official_demo_repeat_result (passed boolean) on commit drop;
do $$
declare
  v_root_account_id bigint;
begin
  select root_account_id into v_root_account_id
  from official_demo_repeat_target;
  begin
    insert into public.demo_runs (root_account_id, status)
    values (v_root_account_id, 'active');
    insert into official_demo_repeat_result values (false);
  exception when unique_violation then
    insert into official_demo_repeat_result values (true);
  end;
end;
$$;
insert into official_demo_checks
select 'repeated active-root seed is rejected',
       coalesce((select passed from official_demo_repeat_result limit 1), false),
       null;

select json_agg(json_build_object('name', name, 'passed', passed, 'detail', detail) order by name)
from official_demo_checks;
rollback;
