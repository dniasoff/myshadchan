-- Official onboarding demo r21 convergence repairs.
--
-- The withdrawn single listing is represented by a durable manifest tombstone
-- instead of leaving a deleted listing row in the manifest. Cleanup mutations
-- are lease-fenced inside SQL transactions so a stale seed cannot delete rows
-- after clear/reseed has taken ownership.

set check_function_bodies = off;

alter table public.demo_run_resources
  drop constraint if exists demo_run_resources_type_check;

alter table public.demo_run_resources
  add constraint demo_run_resources_type_check check (
    resource_type in (
      'invite', 'connection_invite', 'child_grant', 'connection',
      'thread', 'message', 'listing', 'listing_withdrawal', 'share_link',
      'task', 'share_access_log', 'inbox_item', 'analytics_event',
      'message_notification', 'task_notification', 'trusted_sender',
      'single_preference', 'single_note'
    )
  );

-- Keep one canonical ownership validator.  The withdrawal tombstone uses the
-- same relationship-axis checks as every other registered resource.
create or replace function public.assert_demo_resource_ownership(
  p_run_id bigint,
  p_resource_type text,
  p_resource_id bigint,
  p_require_present boolean default true
)
returns void
language plpgsql security definer
set search_path to ''
as $function$
declare
  v_row jsonb;
  v_parent jsonb;
  v_single_account bigint;
  v_account_id bigint;
  v_connection_id bigint;
  v_parent_account_id bigint;
  v_parent_connection_id bigint;
  v_accounts bigint[] := array[]::bigint[];
  v_table_name text;
begin
  if p_resource_id is null or p_resource_id <= 0 then
    raise exception 'demo resource id must be positive'
      using errcode = 'check_violation';
  end if;

  v_table_name := case p_resource_type
    when 'invite' then 'invites'
    when 'connection_invite' then 'connection_invites'
    when 'child_grant' then 'child_grants'
    when 'connection' then 'connections'
    when 'thread' then 'threads'
    when 'message' then 'messages'
    when 'listing' then 'listings'
    when 'share_link' then 'share_links'
    when 'task' then 'tasks'
    when 'share_access_log' then 'share_access_log'
    when 'inbox_item' then 'inbox_items'
    when 'analytics_event' then 'analytics_events'
    when 'message_notification' then 'message_notifications'
    when 'task_notification' then 'task_notifications'
    when 'trusted_sender' then 'trusted_senders'
    when 'single_preference' then 'single_preferences'
    when 'single_note' then 'single_notes'
    else null
  end;
  if p_resource_type = 'listing_withdrawal' then
    select to_jsonb(row) into v_row
    from (
      select * from public.listing_withdrawal_locks
      where single_id = p_resource_id
    ) row;
  elsif v_table_name is null then
    raise exception 'invalid demo resource type %', p_resource_type
      using errcode = 'check_violation';
  else
    execute format(
      'select to_jsonb(row) from (select * from public.%I where id = $1) row',
      v_table_name
    ) into v_row using p_resource_id;
  end if;
  if v_row is null then
    if p_require_present then
      raise exception 'demo resource %/% does not exist', p_resource_type, p_resource_id
        using errcode = 'foreign_key_violation';
    end if;
    return;
  end if;

  if p_resource_type = 'connection' then
    v_accounts := array[
      nullif(v_row->>'household_account_id', '')::bigint,
      nullif(v_row->>'shadchanus_account_id', '')::bigint
    ];
  elsif p_resource_type = 'connection_invite' then
    v_account_id := nullif(v_row->>'inviter_account_id', '')::bigint;
    if v_account_id is null then
      raise exception 'demo connection invite % has no inviter owner', p_resource_id
        using errcode = 'foreign_key_violation';
    end if;
    v_accounts := array[v_account_id];
    if nullif(v_row->>'accepted_by_account_id', '') is not null then
      v_accounts := array_append(v_accounts, (v_row->>'accepted_by_account_id')::bigint);
    elsif v_row->>'status' = 'accepted' then
      raise exception 'demo accepted connection invite % has no accepting endpoint', p_resource_id
        using errcode = 'check_violation';
    end if;
  elsif p_resource_type = 'child_grant' then
    v_account_id := nullif(v_row->>'proposer_account_id', '')::bigint;
    if v_account_id is null then
      raise exception 'demo child grant % has no proposer owner', p_resource_id
        using errcode = 'foreign_key_violation';
    end if;
    v_accounts := array[v_account_id];
    select account_id into v_single_account
    from public.singles
    where id = (v_row->>'target_single_id')::bigint;
    if v_single_account is null then
      raise exception 'demo child grant % has no owned target single', p_resource_id
        using errcode = 'foreign_key_violation';
    end if;
    v_accounts := array_append(v_accounts, v_single_account);
    if nullif(v_row->>'grantee_account_id', '') is not null then
      v_accounts := array_append(v_accounts, (v_row->>'grantee_account_id')::bigint);
    elsif v_row->>'status' = 'accepted' then
      raise exception 'demo accepted child grant % has no grantee endpoint', p_resource_id
        using errcode = 'check_violation';
    end if;
    if nullif(v_row->>'severed_by_account_id', '') is not null then
      v_accounts := array_append(v_accounts, (v_row->>'severed_by_account_id')::bigint);
    end if;
  elsif p_resource_type in ('thread', 'message') then
    v_account_id := nullif(v_row->>'account_id', '')::bigint;
    v_connection_id := nullif(v_row->>'connection_id', '')::bigint;
    if p_resource_type = 'thread' then
      if (v_account_id is null) = (v_connection_id is null) then
        raise exception 'demo thread % must have exactly one ownership axis', p_resource_id
          using errcode = 'check_violation';
      end if;
      if v_connection_id is not null then
        select household_account_id, shadchanus_account_id
          into v_parent_account_id, v_single_account
        from public.connections where id = v_connection_id;
        if v_parent_account_id is null or v_single_account is null then
          raise exception 'demo thread % has a missing connection owner', p_resource_id
            using errcode = 'foreign_key_violation';
        end if;
        v_accounts := array[v_parent_account_id, v_single_account];
        if exists (
          select 1 from public.thread_participants tp
          where tp.thread_id = p_resource_id
            and tp.connection_id is distinct from v_connection_id
        ) then
          raise exception 'demo thread % has an inconsistent participant axis', p_resource_id
            using errcode = 'check_violation';
        end if;
      else
        v_accounts := array[v_account_id];
        if exists (
          select 1 from public.thread_participants tp
          where tp.thread_id = p_resource_id
            and (tp.connection_id is not null or tp.account_id is distinct from v_account_id)
        ) then
          raise exception 'demo thread % has an inconsistent account owner', p_resource_id
            using errcode = 'check_violation';
        end if;
      end if;
    else
      select to_jsonb(row) into v_parent
      from (select * from public.threads where id = (v_row->>'thread_id')::bigint) row;
      if v_parent is null then
        raise exception 'demo message % has no owned parent thread', p_resource_id
          using errcode = 'foreign_key_violation';
      end if;
      v_parent_account_id := nullif(v_parent->>'account_id', '')::bigint;
      v_parent_connection_id := nullif(v_parent->>'connection_id', '')::bigint;
      if v_account_id is distinct from v_parent_account_id
         or v_connection_id is distinct from v_parent_connection_id then
        raise exception 'demo message % crosses its parent thread axis', p_resource_id
          using errcode = 'check_violation';
      end if;
      if v_connection_id is not null then
        select household_account_id, shadchanus_account_id
          into v_parent_account_id, v_single_account
        from public.connections where id = v_connection_id;
        v_accounts := array[v_parent_account_id, v_single_account];
      else
        v_accounts := array[v_account_id];
      end if;
    end if;
  elsif p_resource_type = 'message_notification' then
    v_accounts := array[nullif(v_row->>'account_id', '')::bigint];
    v_connection_id := nullif(v_row->>'connection_id', '')::bigint;
    if v_connection_id is not null then
      select household_account_id, shadchanus_account_id
        into v_parent_account_id, v_single_account
      from public.connections where id = v_connection_id;
      v_accounts := array[v_parent_account_id, v_single_account];
    end if;
    select to_jsonb(row) into v_parent
    from (select * from public.messages where id = (v_row->>'message_id')::bigint) row;
    if v_parent is null
       or v_connection_id is distinct from nullif(v_parent->>'connection_id', '')::bigint then
      raise exception 'demo message notification % has an inconsistent message owner', p_resource_id
        using errcode = 'check_violation';
    end if;
  elsif p_resource_type = 'task_notification' then
    select account_id into v_account_id from public.tasks where id = (v_row->>'task_id')::bigint;
    v_accounts := array[v_account_id];
  elsif p_resource_type = 'share_access_log' then
    select account_id into v_account_id from public.share_links where id = (v_row->>'share_link_id')::bigint;
    v_accounts := array[v_account_id];
  elsif p_resource_type in ('invite', 'listing', 'listing_withdrawal', 'share_link', 'task',
                            'inbox_item', 'analytics_event', 'trusted_sender',
                            'single_preference', 'single_note') then
    v_account_id := nullif(v_row->>'account_id', '')::bigint;
    v_accounts := array[v_account_id];
    if p_resource_type in ('single_preference', 'single_note') then
      select account_id into v_single_account from public.singles
      where id = (v_row->>'single_id')::bigint;
      if v_single_account is distinct from v_account_id then
        raise exception 'demo private single content %/% crosses its single owner', p_resource_type, p_resource_id
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  v_accounts := array_remove(v_accounts, null);
  if exists (
    select 1 from unnest(v_accounts) requested(account_id)
    where requested.account_id is null
       or not exists (
         select 1 from public.demo_run_accounts dra
         where dra.run_id = p_run_id and dra.account_id = requested.account_id
       )
  ) then
    raise exception 'demo resource %/% is not owned by run %', p_resource_type, p_resource_id, p_run_id
      using errcode = 'foreign_key_violation';
  end if;
end;
$function$;

create or replace function public.resolve_demo_listing_id(
  p_run_id bigint,
  p_lease_token text,
  p_account_id bigint,
  p_listing_type text,
  p_single_id bigint,
  p_published_by_member_id bigint
)
returns bigint
language plpgsql security definer set search_path to ''
as $function$
declare
  v_headers jsonb;
  v_run public.demo_runs%rowtype;
  v_listing_count integer;
  v_listing_id bigint;
begin
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  exception when others then
    raise exception 'demo listing resolution requires valid seed request headers'
      using errcode = 'insufficient_privilege';
  end;
  if coalesce(auth.role(), '') <> 'service_role'
     or p_run_id is null or p_run_id <= 0
     or p_lease_token is null or p_lease_token = ''
     or p_account_id is null or p_account_id <= 0
     or p_published_by_member_id is null or p_published_by_member_id <= 0
     or p_listing_type not in ('shadchan', 'single')
     or (p_listing_type = 'single' and (p_single_id is null or p_single_id <= 0))
     or (p_listing_type = 'shadchan' and p_single_id is not null)
     or coalesce(v_headers->>'x-demo-run-id', '') <> p_run_id::text
     or coalesce(v_headers->>'x-demo-lease-token', '') <> p_lease_token then
    raise exception 'demo listing resolution requires the exact seed service lease'
      using errcode = 'insufficient_privilege';
  end if;

  -- Hold the exact run lock through the final manifest insert.
  select dr.* into strict v_run from public.demo_runs dr
  where dr.id = p_run_id for update;
  if v_run.lease_token is distinct from p_lease_token
     or v_run.operation is distinct from 'seed'
     or v_run.status is distinct from 'seeding'
     or v_run.lease_expires_at is null
     or v_run.lease_expires_at <= clock_timestamp()
     or not exists (select 1 from public.demo_run_accounts dra where dra.run_id = p_run_id and dra.account_id = p_account_id) then
    raise exception 'demo seed lease or account ownership was not found' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1
    from public.account_members am
    join public.demo_run_users dru on dru.run_id = p_run_id and dru.user_id = am.user_id
    join public.demo_run_actor_intents dai on dai.run_id = dru.run_id and dai.actor_key = dru.actor_key and dai.auth_user_id = dru.user_id and dai.state = 'reconciled'
    where am.id = p_published_by_member_id and am.account_id = p_account_id and am.status = 'active'
      and ((p_listing_type = 'shadchan' and am.role = 'shadchan') or (p_listing_type = 'single' and am.role in ('parent_admin', 'self_manager')))
  ) then
    raise exception 'demo listing publisher is not registered in this run' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.accounts a
    where a.id = p_account_id
      and ((p_listing_type = 'shadchan' and a.kind = 'shadchanus') or (p_listing_type = 'single' and a.kind = 'household'))
  ) or (p_listing_type = 'single' and not exists (select 1 from public.singles s where s.id = p_single_id and s.account_id = p_account_id)) then
    raise exception 'demo listing context does not match the registered account' using errcode = 'check_violation';
  end if;

  -- Recheck the lease, exact headers, account manifest and publisher at the
  -- point immediately before resolution/registration.
  select dr.* into strict v_run from public.demo_runs dr
  where dr.id = p_run_id and dr.lease_token = p_lease_token and dr.operation = 'seed'
    and dr.status = 'seeding' and dr.lease_expires_at > clock_timestamp() for update;
  if coalesce(v_headers->>'x-demo-run-id', '') <> p_run_id::text
     or coalesce(v_headers->>'x-demo-lease-token', '') <> p_lease_token
     or not exists (select 1 from public.demo_run_accounts dra where dra.run_id = p_run_id and dra.account_id = p_account_id) then
    raise exception 'demo seed lease or account ownership was not found' using errcode = 'insufficient_privilege';
  end if;
  select count(*), min(l.id) into v_listing_count, v_listing_id
  from public.listings l
  where l.account_id = p_account_id and l.listing_type = p_listing_type
    and l.single_id is not distinct from p_single_id
    and l.published_by_member_id = p_published_by_member_id;
  if v_listing_count = 0 then
    raise exception 'demo listing was not found for the exact seed context' using errcode = 'check_violation';
  elsif v_listing_count > 1 then
    raise exception 'demo listing resolution was ambiguous' using errcode = 'cardinality_violation';
  end if;
  perform public.assert_demo_resource_ownership(p_run_id, 'listing', v_listing_id, true);
  insert into public.demo_run_resources (run_id, resource_type, resource_id)
  values (p_run_id, 'listing', v_listing_id)
  on conflict (run_id, resource_type, resource_id) do nothing;
  return v_listing_id;
exception when no_data_found then
  raise exception 'demo seed lease or account ownership was not found' using errcode = 'insufficient_privilege';
end;
$function$;

create or replace function public.withdraw_demo_listing(
  p_run_id bigint, p_lease_token text, p_account_id bigint,
  p_single_id bigint, p_published_by_member_id bigint
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_headers jsonb;
  v_run public.demo_runs%rowtype;
  v_listing_count integer;
  v_listing_id bigint;
  v_deleted_id bigint;
begin
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  exception when others then
    raise exception 'demo listing withdrawal requires valid seed request headers' using errcode = 'insufficient_privilege';
  end;
  if coalesce(auth.role(), '') <> 'service_role'
     or p_run_id is null or p_run_id <= 0 or p_lease_token is null or p_lease_token = ''
     or p_account_id is null or p_account_id <= 0 or p_single_id is null or p_single_id <= 0
     or p_published_by_member_id is null or p_published_by_member_id <= 0
     or coalesce(v_headers->>'x-demo-run-id', '') <> p_run_id::text
     or coalesce(v_headers->>'x-demo-lease-token', '') <> p_lease_token then
    raise exception 'demo listing withdrawal requires the exact seed service lease' using errcode = 'insufficient_privilege';
  end if;

  -- Account UPDATE serializes against the write barrier's FOR KEY SHARE. The
  -- run lock and subject lock remain held until delete + tombstone commit.
  perform public.demo_lock_account_axes(array[p_account_id], 'update');
  select dr.* into strict v_run from public.demo_runs dr where dr.id = p_run_id for update;
  if v_run.lease_token is distinct from p_lease_token or v_run.operation is distinct from 'seed'
     or v_run.status is distinct from 'seeding' or v_run.lease_expires_at is null
     or v_run.lease_expires_at <= clock_timestamp()
     or not exists (select 1 from public.demo_run_accounts dra where dra.run_id = p_run_id and dra.account_id = p_account_id) then
    raise exception 'demo seed lease or account ownership was not found' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1
    from public.account_members am
    join public.demo_run_users dru on dru.run_id = p_run_id and dru.user_id = am.user_id
    join public.demo_run_actor_intents dai on dai.run_id = dru.run_id and dai.actor_key = dru.actor_key and dai.auth_user_id = dru.user_id and dai.state = 'reconciled'
    where am.id = p_published_by_member_id and am.account_id = p_account_id and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'demo listing publisher is not registered in this run' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.singles where id = p_single_id and account_id = p_account_id for update;
  if not found then
    raise exception 'demo withdrawal single is not owned by the registered account' using errcode = 'foreign_key_violation';
  end if;
  select count(*), min(l.id) into v_listing_count, v_listing_id
  from public.listings l
  where l.account_id = p_account_id and l.listing_type = 'single'
    and l.single_id = p_single_id and l.published_by_member_id = p_published_by_member_id;
  if v_listing_count = 0 then
    if exists (select 1 from public.listing_withdrawal_locks ll where ll.account_id = p_account_id and ll.single_id = p_single_id) then
      return jsonb_build_object('outcome', 'already_withdrawn', 'single_id', p_single_id);
    end if;
    raise exception 'demo listing withdrawal deleted zero rows' using errcode = 'check_violation';
  elsif v_listing_count > 1 then
    raise exception 'demo listing withdrawal was ambiguous' using errcode = 'cardinality_violation';
  end if;
  if not exists (select 1 from public.demo_run_resources where run_id = p_run_id and resource_type = 'listing' and resource_id = v_listing_id) then
    raise exception 'demo listing withdrawal is missing its registered listing resource' using errcode = 'check_violation';
  end if;
  delete from public.listings where id = v_listing_id and account_id = p_account_id and listing_type = 'single' and single_id = p_single_id returning id into v_deleted_id;
  if v_deleted_id is null then raise exception 'demo listing withdrawal deleted zero rows' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.listings where account_id = p_account_id and listing_type = 'single' and single_id = p_single_id) then
    raise exception 'demo listing withdrawal left a same-subject listing' using errcode = 'check_violation';
  end if;
  insert into public.listing_withdrawal_locks (account_id, single_id) values (p_account_id, p_single_id) on conflict (single_id) do nothing;
  if not exists (select 1 from public.listing_withdrawal_locks where account_id = p_account_id and single_id = p_single_id) then
    raise exception 'demo listing withdrawal lock was not created' using errcode = 'check_violation';
  end if;
  delete from public.demo_run_resources where run_id = p_run_id and resource_type = 'listing' and resource_id = v_listing_id;
  insert into public.demo_run_resources (run_id, resource_type, resource_id) values (p_run_id, 'listing_withdrawal', p_single_id) on conflict (run_id, resource_type, resource_id) do nothing;
  return jsonb_build_object('outcome', 'withdrawn', 'listing_id', v_deleted_id, 'single_id', p_single_id);
exception when no_data_found then
  raise exception 'demo seed lease or account ownership was not found' using errcode = 'insufficient_privilege';
end;
$function$;

create or replace function public.fence_demo_cleanup(p_run_id bigint, p_lease_token text, p_operation text default 'seed')
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare v_run public.demo_runs%rowtype; v_accounts bigint[];
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_operation <> 'seed' then raise exception 'demo cleanup requires the seed service role' using errcode = 'insufficient_privilege'; end if;
  select array_agg(account_id order by account_id) into v_accounts from public.demo_run_accounts where run_id = p_run_id;
  perform public.demo_lock_account_axes(v_accounts, 'update');
  select dr.* into strict v_run from public.demo_runs dr where dr.id = p_run_id for update;
  if v_run.lease_token is distinct from p_lease_token or v_run.operation is distinct from p_operation or v_run.status is distinct from 'seeding' or v_run.lease_expires_at is null or v_run.lease_expires_at <= clock_timestamp() then raise exception 'demo run % lease is stale or fenced', p_run_id using errcode = 'serialization_failure'; end if;
  return true;
exception when no_data_found then raise exception 'demo run % lease is stale or fenced', p_run_id using errcode = 'serialization_failure';
end;
$function$;

create or replace function public.delete_demo_cleanup_rows(p_run_id bigint, p_lease_token text, p_table_name text, p_operation text default 'seed')
returns bigint
language plpgsql security definer set search_path to ''
as $function$
declare v_run public.demo_runs%rowtype; v_accounts bigint[]; v_deleted bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_operation <> 'seed' or p_table_name not in ('inbox_items','message_notifications','task_notifications','tasks','reference_links','redts','shidduch_education','resume_photos','resumes','entity_files','medical_notes','shidduchim_external_links','date_records','listing_withdrawal_locks','shidduchim','references','shadchanim','single_preferences','single_notes','singles','invites','listings','share_links','analytics_events','trusted_senders') then
    raise exception 'invalid or unauthorized demo cleanup table' using errcode = 'insufficient_privilege';
  end if;
  select array_agg(account_id order by account_id) into v_accounts from public.demo_run_accounts where run_id = p_run_id;
  perform public.demo_lock_account_axes(v_accounts, 'update');
  select dr.* into strict v_run from public.demo_runs dr where dr.id = p_run_id for update;
  if v_run.lease_token is distinct from p_lease_token or v_run.operation is distinct from p_operation or v_run.status is distinct from 'seeding' or v_run.lease_expires_at is null or v_run.lease_expires_at <= clock_timestamp() then raise exception 'demo run % lease is stale or fenced', p_run_id using errcode = 'serialization_failure'; end if;
  execute format('delete from public.%I where account_id = any($1)', p_table_name) using v_accounts;
  get diagnostics v_deleted = row_count;
  return v_deleted;
exception when no_data_found then raise exception 'demo run % lease is stale or fenced', p_run_id using errcode = 'serialization_failure';
end;
$function$;

create or replace function public.delete_demo_actor_rows(p_run_id bigint, p_lease_token text, p_actor_key text, p_user_id uuid, p_operation text default 'seed')
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_run public.demo_runs%rowtype; v_accounts bigint[];
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_operation <> 'seed' then raise exception 'demo actor cleanup requires the seed service role' using errcode = 'insufficient_privilege'; end if;
  select array_agg(account_id order by account_id) into v_accounts from public.demo_run_accounts where run_id = p_run_id;
  perform public.demo_lock_account_axes(v_accounts, 'update');
  select dr.* into strict v_run from public.demo_runs dr where dr.id = p_run_id for update;
  if v_run.lease_token is distinct from p_lease_token or v_run.operation is distinct from p_operation or v_run.status is distinct from 'seeding' or v_run.lease_expires_at is null or v_run.lease_expires_at <= clock_timestamp() or not exists (select 1 from public.demo_run_users where run_id = p_run_id and actor_key = p_actor_key and user_id = p_user_id) or not exists (select 1 from public.demo_run_actor_intents where run_id = p_run_id and actor_key = p_actor_key and auth_user_id = p_user_id and state = 'reconciled') then
    raise exception 'demo actor cleanup identity is stale or fenced' using errcode = 'serialization_failure';
  end if;
  delete from public.account_members where user_id = p_user_id and account_id = any(v_accounts);
  delete from public.member_state where user_id = p_user_id;
  delete from public.members where user_id = p_user_id;
end;
$function$;

create or replace function public.delete_demo_resource(p_run_id bigint, p_lease_token text, p_resource_type text, p_resource_id bigint, p_operation text default 'seed')
returns bigint
language plpgsql security definer set search_path to ''
as $function$
declare v_run public.demo_runs%rowtype; v_accounts bigint[]; v_table_name text; v_deleted bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_operation <> 'seed' then raise exception 'demo resource cleanup requires the seed service role' using errcode = 'insufficient_privilege'; end if;
  select array_agg(account_id order by account_id) into v_accounts from public.demo_run_accounts where run_id = p_run_id;
  perform public.demo_lock_account_axes(v_accounts, 'update');
  select dr.* into strict v_run from public.demo_runs dr where dr.id = p_run_id for update;
  if v_run.lease_token is distinct from p_lease_token or v_run.operation is distinct from p_operation or v_run.status is distinct from 'seeding' or v_run.lease_expires_at is null or v_run.lease_expires_at <= clock_timestamp() then raise exception 'demo run % lease is stale or fenced', p_run_id using errcode = 'serialization_failure'; end if;
  perform public.assert_demo_resource_ownership(p_run_id, p_resource_type, p_resource_id, false);
  v_table_name := case p_resource_type when 'connection' then 'connections' when 'connection_invite' then 'connection_invites' when 'child_grant' then 'child_grants' when 'invite' then 'invites' when 'single_preference' then 'single_preferences' when 'single_note' then 'single_notes' else null end;
  if v_table_name is null then return 0; end if;
  execute format('delete from public.%I where id = $1', v_table_name) using p_resource_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
exception when no_data_found then raise exception 'demo run % lease is stale or fenced', p_run_id using errcode = 'serialization_failure';
end;
$function$;

-- The final seed compensation delete must remain lease-fenced in SQL.  The
-- preceding cleanup RPC commits before this one, so a direct client delete
-- would let a clear/reseed claim the run between those two transactions.
create or replace function public.finalize_demo_seed_cleanup(p_run_id bigint, p_lease_token text)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_run public.demo_runs;
  v_accounts bigint[];
  v_deleted boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'demo seed finalization requires the seed service role'
      using errcode = 'insufficient_privilege';
  end if;
  select array_agg(account_id order by account_id) into v_accounts
  from public.demo_run_accounts where run_id = p_run_id;
  perform public.demo_lock_account_axes(v_accounts, 'update');
  select * into strict v_run from public.demo_runs where id = p_run_id for update;
  if v_run.lease_token is distinct from p_lease_token
     or v_run.operation is distinct from 'seed'
     or v_run.status is distinct from 'seeding'
     or v_run.lease_expires_at is null
     or v_run.lease_expires_at <= clock_timestamp() then
    raise exception 'demo run % lease is stale or fenced', p_run_id
      using errcode = 'serialization_failure';
  end if;
  delete from public.demo_runs
  where id = p_run_id and lease_token = p_lease_token
    and operation = 'seed' and status = 'seeding'
  returning true into v_deleted;
  if not found then
    raise exception 'demo run % lease is stale or fenced', p_run_id
      using errcode = 'serialization_failure';
  end if;
  return true;
exception when no_data_found then
  raise exception 'demo run % lease is stale or fenced', p_run_id
    using errcode = 'serialization_failure';
end;
$function$;

-- Keep the exact baseline at 29 receipts: one live listing and one durable
-- withdrawal tombstone represent the two listing lifecycle events.
create or replace function public.assert_official_demo_inventory(p_run_id bigint, p_require_active boolean default false)
returns void language plpgsql security definer set search_path to ''
as $function$
declare v_status text; v_operation text; v_cleanup_started_at timestamptz; v_root bigint; v_resource record;
begin
  select status, operation, cleanup_started_at, root_account_id into v_status, v_operation, v_cleanup_started_at, v_root from public.demo_runs where id = p_run_id;
  if not found or (p_require_active and (v_status not in ('active','clearing') or (v_status = 'clearing' and (v_operation <> 'clear' or v_cleanup_started_at is null)))) or (not p_require_active and v_status <> 'seeding') then raise exception 'official demo run % is not in the expected inventory phase', p_run_id using errcode = 'check_violation'; end if;
  if (select count(*) from public.demo_run_accounts where run_id = p_run_id) <> 3 or not exists (select 1 from public.demo_run_accounts where run_id = p_run_id and context_key = 'primary-household' and context_kind = 'household' and is_root) or not exists (select 1 from public.demo_run_accounts where run_id = p_run_id and context_key = 'feldman-shadchanus' and context_kind = 'shadchanus' and not is_root) or not exists (select 1 from public.demo_run_accounts where run_id = p_run_id and context_key = 'gross-household' and context_kind = 'household' and not is_root) or (select count(*) from public.demo_run_accounts where run_id = p_run_id and is_root) <> 1 or not exists (select 1 from public.demo_run_accounts where run_id = p_run_id and account_id = v_root and is_root) then raise exception 'official demo run % has an incomplete context graph', p_run_id using errcode = 'check_violation'; end if;
  if (select count(*) from public.demo_run_actor_intents where run_id = p_run_id) <> 3 or exists (select 1 from public.demo_run_actor_intents where run_id = p_run_id and state <> 'reconciled') or (select count(*) from public.demo_run_users where run_id = p_run_id) <> 3 or not exists (select 1 from public.demo_run_users where run_id = p_run_id and actor_key = 'dovid-klein') or not exists (select 1 from public.demo_run_users where run_id = p_run_id and actor_key = 'leah-feldman') or not exists (select 1 from public.demo_run_users where run_id = p_run_id and actor_key = 'miriam-gross') or exists (select 1 from public.demo_run_actor_intents dai where dai.run_id = p_run_id and not exists (select 1 from public.demo_run_users dru where dru.run_id = dai.run_id and dru.actor_key = dai.actor_key and dru.user_id = dai.auth_user_id)) then raise exception 'official demo run % has an incomplete synthetic actor graph', p_run_id using errcode = 'check_violation'; end if;
  if not p_require_active then
    if (select count(*) from public.demo_run_resources where run_id = p_run_id) <> 29 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'invite') <> 3 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'connection_invite') <> 2 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'child_grant') <> 2 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'connection') <> 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'thread') <> 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'message') <> 2 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'listing') <> 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'listing_withdrawal') <> 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'share_link') <> 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'task') <> 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'share_access_log') <> 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'inbox_item') <> 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'analytics_event') <> 3 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'message_notification') <> 2 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'task_notification') <> 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'trusted_sender') <> 2 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'single_preference') <> 2 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'single_note') <> 2 or (select count(*) from public.demo_run_storage where run_id = p_run_id) <> 50 or (select count(*) from public.demo_run_storage where run_id = p_run_id and bucket = 'documents') <> 47 or (select count(*) from public.demo_run_storage where run_id = p_run_id and bucket = 'entity-files') <> 3 or exists (select 1 from public.demo_run_storage where run_id = p_run_id and bucket not in ('documents','entity-files')) then raise exception 'official demo run % is missing its exact baseline inventory', p_run_id using errcode = 'check_violation'; end if;
  else
    if (select count(*) from public.demo_run_resources where run_id = p_run_id) < 29 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'invite') < 3 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'connection_invite') < 2 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'child_grant') < 2 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'connection') < 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'thread') < 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'message') < 2 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'listing') < 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'listing_withdrawal') < 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'share_link') < 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'task') < 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'share_access_log') < 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'inbox_item') < 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'analytics_event') < 3 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'message_notification') < 2 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'task_notification') < 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'trusted_sender') < 2 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'single_preference') < 2 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'single_note') < 2 or (select count(*) from public.demo_run_storage where run_id = p_run_id) < 50 or (select count(*) from public.demo_run_storage where run_id = p_run_id and bucket = 'documents') < 47 or (select count(*) from public.demo_run_storage where run_id = p_run_id and bucket = 'entity-files') < 3 or exists (select 1 from public.demo_run_storage where run_id = p_run_id and bucket not in ('documents','entity-files')) then raise exception 'official demo run % is missing a baseline resource or storage receipt', p_run_id using errcode = 'check_violation'; end if;
  end if;
  if not p_require_active and ((select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'message_notification') <> 2 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'task_notification') <> 1 or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'share_access_log') <> 1 or not exists (select 1 from public.singles where account_id = v_root) or (select count(*) from public.single_preferences where account_id = v_root) <> 2 or (select count(*) from public.single_notes where account_id = v_root) <> 2 or not exists (select 1 from public.shidduchim where account_id = v_root) or not exists (select 1 from public.message_notifications mn join public.demo_run_resources drr on drr.resource_type = 'message_notification' and drr.resource_id = mn.id and drr.run_id = p_run_id where mn.simulated and mn.status = 'sent') or not exists (select 1 from public.task_notifications tn join public.demo_run_resources drr on drr.resource_type = 'task_notification' and drr.resource_id = tn.id and drr.run_id = p_run_id where tn.simulated and tn.status = 'sent') or not exists (select 1 from public.share_access_log sal join public.demo_run_resources drr on drr.resource_type = 'share_access_log' and drr.resource_id = sal.id and drr.run_id = p_run_id where sal.simulated) or exists (select 1 from public.demo_run_resources drr join public.message_notifications mn on mn.id = drr.resource_id where drr.run_id = p_run_id and drr.resource_type = 'message_notification' and (mn.simulated is not true or mn.status <> 'sent')) or exists (select 1 from public.demo_run_resources drr join public.task_notifications tn on tn.id = drr.resource_id where drr.run_id = p_run_id and drr.resource_type = 'task_notification' and (tn.simulated is not true or tn.status <> 'sent')) ) then raise exception 'official demo run % is missing a simulated outcome', p_run_id using errcode = 'check_violation'; end if;
  for v_resource in select resource_type, resource_id from public.demo_run_resources where run_id = p_run_id loop perform public.assert_demo_resource_ownership(p_run_id, v_resource.resource_type, v_resource.resource_id, not p_require_active); end loop;
end;
$function$;

create or replace function public.activate_demo_run(p_run_id bigint, p_lease_token text, p_active_root_name text)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_run public.demo_runs;
begin
  select * into v_run from public.demo_runs where id = p_run_id for update;
  if not found or v_run.lease_token is distinct from p_lease_token or v_run.operation <> 'seed' or v_run.status <> 'seeding' or v_run.lease_expires_at is null or v_run.lease_expires_at <= clock_timestamp() then raise exception 'demo run % lease is stale or fenced', p_run_id using errcode = 'serialization_failure'; end if;
  perform public.assert_official_demo_inventory(p_run_id, false);
  update public.accounts set name = p_active_root_name, demo = true where id = v_run.root_account_id;
  update public.demo_runs set status = 'active', operation = null, lease_token = null, lease_expires_at = null, updated_at = now() where id = p_run_id;
  update public.demo_onboarding_intents set state = 'completed', demo_run_id = p_run_id, last_error = null, updated_at = now() where account_id = v_run.root_account_id;
  return jsonb_build_object('run_id', p_run_id, 'status', 'active');
end;
$function$;

revoke all on function public.resolve_demo_listing_id(bigint, text, bigint, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.resolve_demo_listing_id(bigint, text, bigint, text, bigint, bigint) to service_role;
revoke all on function public.withdraw_demo_listing(bigint, text, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.withdraw_demo_listing(bigint, text, bigint, bigint, bigint) to service_role;
revoke all on function public.fence_demo_cleanup(bigint, text, text) from public, anon, authenticated;
grant execute on function public.fence_demo_cleanup(bigint, text, text) to service_role;
revoke all on function public.delete_demo_cleanup_rows(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.delete_demo_cleanup_rows(bigint, text, text, text) to service_role;
revoke all on function public.delete_demo_actor_rows(bigint, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.delete_demo_actor_rows(bigint, text, text, uuid, text) to service_role;
revoke all on function public.delete_demo_resource(bigint, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.delete_demo_resource(bigint, text, text, bigint, text) to service_role;
revoke all on function public.finalize_demo_seed_cleanup(bigint, text) from public, anon, authenticated;
grant execute on function public.finalize_demo_seed_cleanup(bigint, text) to service_role;
revoke all on function public.assert_demo_resource_ownership(bigint, text, bigint, boolean)
  from public, anon, authenticated;
grant execute on function public.assert_demo_resource_ownership(bigint, text, bigint, boolean)
  to service_role;
revoke all on function public.assert_official_demo_inventory(bigint, boolean) from public, anon, authenticated;
grant execute on function public.assert_official_demo_inventory(bigint, boolean) to service_role;
revoke all on function public.activate_demo_run(bigint, text, text) from public, anon, authenticated;
grant execute on function public.activate_demo_run(bigint, text, text) to service_role;
