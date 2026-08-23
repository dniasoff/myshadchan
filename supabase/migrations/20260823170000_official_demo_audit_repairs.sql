-- Official onboarding demo audit repairs.
-- 20260823170000
--
-- Lifecycle protocol: writers lock every resolved account axis in ascending
-- order with FOR KEY SHARE; begin/clear lock the same rows in ascending order
-- with FOR UPDATE.  Only after the account locks are held do they inspect or
-- change the run row.  Therefore a writer that arrives first commits before a
-- lifecycle operation can snapshot, while a lifecycle operation that arrives
-- first makes the writer wait and then observe seeding/clearing.

set check_function_bodies = off;

alter table public.demo_run_resources
  drop constraint if exists demo_run_resources_type_check;
alter table public.demo_run_resources
  add constraint demo_run_resources_type_check check (
    resource_type in (
      'invite', 'connection_invite', 'child_grant', 'connection',
      'thread', 'message', 'listing', 'share_link', 'task',
      'share_access_log', 'inbox_item', 'analytics_event',
      'message_notification', 'task_notification', 'trusted_sender',
      'single_preference', 'single_note'
    )
  );

create or replace function public.demo_lock_account_axes(
  p_accounts bigint[],
  p_lock_mode text
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_id bigint;
begin
  if p_lock_mode not in ('key share', 'update') then
    raise exception 'invalid demo account lock mode %', p_lock_mode
      using errcode = 'invalid_parameter_value';
  end if;

  -- Every caller uses this same ordered lock acquisition.  Never replace
  -- this with a single unordered ANY() lock: two multi-account rows could
  -- otherwise deadlock while a seed/clear operation is in flight.
  for v_account_id in
    select distinct account_id
    from unnest(coalesce(p_accounts, array[]::bigint[])) as requested(account_id)
    where account_id is not null
    order by account_id
  loop
    execute format(
      'select id from public.accounts where id = $1 for %s',
      p_lock_mode
    ) using v_account_id;
  end loop;
end;
$function$;

create or replace function public.assert_demo_resource_ownership(
  p_run_id bigint,
  p_resource_type text,
  p_resource_id bigint,
  p_require_present boolean default true
) returns void
language plpgsql
security definer
set search_path = ''
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
  if v_table_name is null then
    raise exception 'invalid demo resource type %', p_resource_type
      using errcode = 'check_violation';
  end if;

  execute format(
    'select to_jsonb(row) from (select * from public.%I where id = $1) row',
    v_table_name
  ) into v_row using p_resource_id;
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
      v_accounts := array_append(
        v_accounts, (v_row->>'accepted_by_account_id')::bigint
      );
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
      v_accounts := array_append(
        v_accounts, (v_row->>'grantee_account_id')::bigint
      );
    elsif v_row->>'status' = 'accepted' then
      raise exception 'demo accepted child grant % has no grantee endpoint', p_resource_id
        using errcode = 'check_violation';
    end if;
    if nullif(v_row->>'severed_by_account_id', '') is not null then
      v_accounts := array_append(
        v_accounts, (v_row->>'severed_by_account_id')::bigint
      );
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
            and (tp.connection_id is distinct from v_connection_id)
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
    select account_id into v_account_id from public.tasks
    where id = (v_row->>'task_id')::bigint;
    v_accounts := array[v_account_id];
  elsif p_resource_type = 'share_access_log' then
    select account_id into v_account_id from public.share_links
    where id = (v_row->>'share_link_id')::bigint;
    v_accounts := array[v_account_id];
  elsif p_resource_type in ('invite', 'listing', 'share_link', 'task',
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

create or replace function public.enforce_demo_write_barrier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row jsonb;
  v_accounts bigint[] := array[]::bigint[];
  v_run_id bigint;
  v_status text;
  v_target_single_id bigint;
begin
  if auth.uid() is null and not public.demo_seed_request_marked() then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- UPDATE contributes both axes.  Locking only NEW lets a move from one
  -- account/connection to another evade the lifecycle fence.
  if tg_op <> 'INSERT' then
    v_row := to_jsonb(old);
    if v_row ? 'account_id' then
      v_accounts := array_append(v_accounts, nullif(v_row->>'account_id', '')::bigint);
    end if;
    if tg_table_name = 'connections' then
      v_accounts := v_accounts || array[
        (v_row->>'household_account_id')::bigint,
        (v_row->>'shadchanus_account_id')::bigint
      ];
    elsif tg_table_name = 'connection_invites' then
      v_accounts := array_append(
        v_accounts, nullif(v_row->>'inviter_account_id', '')::bigint
      );
      if v_row->>'status' = 'accepted'
         and nullif(v_row->>'accepted_by_account_id', '') is null then
        raise exception 'demo accepted connection invite has no accepting endpoint'
          using errcode = 'check_violation';
      end if;
      if nullif(v_row->>'accepted_by_account_id', '') is not null then
        v_accounts := array_append(
          v_accounts, (v_row->>'accepted_by_account_id')::bigint
        );
      end if;
    elsif tg_table_name = 'child_grants' then
      v_accounts := array_append(
        v_accounts, nullif(v_row->>'proposer_account_id', '')::bigint
      );
      if v_row->>'status' = 'accepted'
         and nullif(v_row->>'grantee_account_id', '') is null then
        raise exception 'demo accepted child grant has no grantee endpoint'
          using errcode = 'check_violation';
      end if;
      if nullif(v_row->>'grantee_account_id', '') is not null then
        v_accounts := array_append(
          v_accounts, (v_row->>'grantee_account_id')::bigint
        );
      end if;
      v_target_single_id := nullif(v_row->>'target_single_id', '')::bigint;
      if v_target_single_id is null
         or not exists (
           select 1 from public.singles s
           where s.id = v_target_single_id and s.account_id is not null
         ) then
        raise exception 'demo child grant has no owned target single'
          using errcode = 'foreign_key_violation';
      end if;
      v_accounts := array_append(
        v_accounts,
        (select s.account_id from public.singles s where s.id = v_target_single_id)
      );
      if nullif(v_row->>'severed_by_account_id', '') is not null then
        v_accounts := array_append(
          v_accounts, (v_row->>'severed_by_account_id')::bigint
        );
      end if;
    elsif tg_table_name in ('threads', 'thread_participants', 'messages', 'message_notifications')
          and nullif(v_row->>'connection_id', '') is not null then
      v_accounts := v_accounts || array(
        select x.account_id from (
          select c.household_account_id account_id from public.connections c where c.id = (v_row->>'connection_id')::bigint
          union all
          select c.shadchanus_account_id from public.connections c where c.id = (v_row->>'connection_id')::bigint
        ) x where x.account_id is not null
      );
    elsif tg_table_name = 'share_access_log' then
      v_accounts := v_accounts || array(
        select sl.account_id from public.share_links sl
        where sl.id = nullif(v_row->>'share_link_id', '')::bigint
      );
    end if;
  end if;
  if tg_op <> 'DELETE' then
    v_row := to_jsonb(new);
    if v_row ? 'account_id' then
      v_accounts := array_append(v_accounts, nullif(v_row->>'account_id', '')::bigint);
    end if;
    if tg_table_name = 'connections' then
      v_accounts := v_accounts || array[
        (v_row->>'household_account_id')::bigint,
        (v_row->>'shadchanus_account_id')::bigint
      ];
    elsif tg_table_name = 'connection_invites' then
      v_accounts := array_append(
        v_accounts, nullif(v_row->>'inviter_account_id', '')::bigint
      );
      if v_row->>'status' = 'accepted'
         and nullif(v_row->>'accepted_by_account_id', '') is null then
        raise exception 'demo accepted connection invite has no accepting endpoint'
          using errcode = 'check_violation';
      end if;
      if nullif(v_row->>'accepted_by_account_id', '') is not null then
        v_accounts := array_append(
          v_accounts, (v_row->>'accepted_by_account_id')::bigint
        );
      end if;
    elsif tg_table_name = 'child_grants' then
      v_accounts := array_append(
        v_accounts, nullif(v_row->>'proposer_account_id', '')::bigint
      );
      if v_row->>'status' = 'accepted'
         and nullif(v_row->>'grantee_account_id', '') is null then
        raise exception 'demo accepted child grant has no grantee endpoint'
          using errcode = 'check_violation';
      end if;
      if nullif(v_row->>'grantee_account_id', '') is not null then
        v_accounts := array_append(
          v_accounts, (v_row->>'grantee_account_id')::bigint
        );
      end if;
      v_target_single_id := nullif(v_row->>'target_single_id', '')::bigint;
      if v_target_single_id is null
         or not exists (
           select 1 from public.singles s
           where s.id = v_target_single_id and s.account_id is not null
         ) then
        raise exception 'demo child grant has no owned target single'
          using errcode = 'foreign_key_violation';
      end if;
      v_accounts := array_append(v_accounts, (select s.account_id from public.singles s where s.id = v_target_single_id));
    elsif tg_table_name in ('threads', 'thread_participants', 'messages', 'message_notifications')
          and nullif(v_row->>'connection_id', '') is not null then
      v_accounts := v_accounts || array(
        select x.account_id from (
          select c.household_account_id account_id from public.connections c where c.id = (v_row->>'connection_id')::bigint
          union all
          select c.shadchanus_account_id from public.connections c where c.id = (v_row->>'connection_id')::bigint
        ) x where x.account_id is not null
      );
    elsif tg_table_name = 'share_access_log' then
      v_accounts := v_accounts || array(
        select sl.account_id from public.share_links sl
        where sl.id = nullif(v_row->>'share_link_id', '')::bigint
      );
    end if;
  end if;

  -- Nullable relationship endpoints are optional history axes, not NULL
  -- account owners. Required axes and accepted-state endpoints are checked
  -- above; removing NULLs keeps pending/revoked rows seedable while every
  -- present endpoint still participates in the same-run check below.
  if tg_table_name = 'connection_invites' then
    if nullif(v_row->>'inviter_account_id', '') is null then
      raise exception 'demo connection invite has no inviter owner'
        using errcode = 'foreign_key_violation';
    end if;
    if v_row->>'status' = 'accepted'
       and nullif(v_row->>'accepted_by_account_id', '') is null then
      raise exception 'demo accepted connection invite has no accepting endpoint'
        using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'child_grants' then
    if nullif(v_row->>'proposer_account_id', '') is null
       or nullif(v_row->>'target_single_id', '') is null
       or not exists (
         select 1 from public.singles s
         where s.id = nullif(v_row->>'target_single_id', '')::bigint
           and s.account_id is not null
       ) then
      raise exception 'demo child grant has no owned target single'
        using errcode = 'foreign_key_violation';
    end if;
    if v_row->>'status' = 'accepted'
       and nullif(v_row->>'grantee_account_id', '') is null then
      raise exception 'demo accepted child grant has no grantee endpoint'
        using errcode = 'check_violation';
    end if;
  end if;
  v_accounts := array_remove(v_accounts, null);

  -- The lifecycle path takes FOR UPDATE; customer writes take FOR KEY SHARE.
  -- This is the single ordering boundary for seed-start and active-clear.
  perform public.demo_lock_account_axes(v_accounts, 'key share');

  select dr.id, dr.status into v_run_id, v_status
  from public.demo_runs dr
  join public.demo_run_accounts dra on dra.run_id = dr.id
  where dr.status in ('seeding', 'active', 'clearing', 'failed')
    and dra.account_id = any(v_accounts)
  order by dr.id desc
  limit 1
  for share of dr;
  if v_run_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if exists (
    select 1 from unnest(v_accounts) requested(account_id)
    where requested.account_id is not null
      and not exists (
        select 1 from public.demo_run_accounts dra
        where dra.run_id = v_run_id and dra.account_id = requested.account_id
      )
  ) then
    raise exception 'demo boundary violation: customer write crosses the demo bundle'
      using errcode = 'check_violation';
  end if;
  if v_status = 'seeding' and auth.uid() is null and coalesce((
    select bool_and(public.demo_seed_service_authorized(requested.account_id))
    from unnest(v_accounts) requested(account_id)
    where requested.account_id is not null
  ), false) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if v_status = 'seeding' and exists (
    select 1 from public.demo_run_users dru
    where dru.run_id = v_run_id and dru.user_id = auth.uid()
  ) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if v_status = 'active' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  raise exception 'demo lifecycle is busy; customer writes are temporarily blocked'
    using errcode = 'lock_not_available';
end;
$function$;

create or replace function public.begin_demo_seed(
  p_root_account_id bigint,
  p_lease_token text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account public.accounts;
  v_run public.demo_runs;
  v_token text;
begin
  perform public.demo_lock_account_axes(array[p_root_account_id], 'update');
  select * into v_account from public.accounts where id = p_root_account_id;
  if not found then
    raise exception 'demo root account % not found', p_root_account_id
      using errcode = 'foreign_key_violation';
  end if;
  perform public.demo_assert_empty_account(p_root_account_id);
  if exists (
    select 1 from public.demo_runs
    where root_account_id = p_root_account_id
      and status in ('seeding', 'active', 'clearing', 'failed')
  ) then
    raise exception 'demo run already exists for root account %', p_root_account_id
      using errcode = 'unique_violation';
  end if;
  v_token := coalesce(nullif(p_lease_token, ''), gen_random_uuid()::text);
  insert into public.demo_runs (
    root_account_id, status, lease_token, lease_epoch, operation,
    lease_expires_at, original_root_name
  ) values (
    p_root_account_id, 'seeding', v_token, 1, 'seed',
    now() + interval '15 minutes', v_account.name
  ) returning * into v_run;
  insert into public.demo_run_accounts (
    run_id, account_id, context_key, context_kind, is_root
  ) values (
    v_run.id, p_root_account_id, 'primary-household', 'household', true
  );
  insert into public.demo_run_member_state (
    run_id, user_id, original_active_account_id, original_updated_at
  )
  select distinct on (am.user_id)
    v_run.id, am.user_id, ms.active_account_id, ms.updated_at
  from public.account_members am
  left join public.member_state ms on ms.user_id = am.user_id
  where am.account_id = p_root_account_id
    and am.status = 'active'
    and am.user_id is not null
  order by am.user_id, am.id;
  return jsonb_build_object(
    'run_id', v_run.id, 'lease_token', v_token,
    'lease_epoch', v_run.lease_epoch, 'original_root_name', v_account.name
  );
end;
$function$;

create or replace function public.claim_demo_clear(
  p_root_account_id bigint,
  p_lease_token text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_run public.demo_runs;
  v_run_id bigint;
  v_accounts bigint[];
  v_token text;
begin
  -- Resolve first, then lock every account axis before locking the run.  This
  -- is the same order used by begin_demo_seed and the write barrier.
  select id into v_run_id
  from public.demo_runs
  where root_account_id = p_root_account_id
    and status in ('seeding', 'active', 'clearing', 'failed')
  order by id desc limit 1;
  if v_run_id is null then
    return jsonb_build_object('outcome', 'no_run');
  end if;
  select array_agg(account_id order by account_id) into v_accounts
  from public.demo_run_accounts where run_id = v_run_id;
  perform public.demo_lock_account_axes(v_accounts, 'update');
  select * into v_run from public.demo_runs where id = v_run_id for update;
  if not found or v_run.root_account_id <> p_root_account_id
     or v_run.status not in ('seeding', 'active', 'clearing', 'failed') then
    return jsonb_build_object('outcome', 'no_run');
  end if;
  if v_run.status in ('seeding', 'clearing')
     and v_run.lease_expires_at > now() then
    raise exception 'demo run % is busy', v_run.id
      using errcode = 'lock_not_available';
  end if;
  v_token := coalesce(nullif(p_lease_token, ''), gen_random_uuid()::text);
  update public.demo_runs
  set status = 'clearing', operation = 'clear', lease_token = v_token,
      lease_epoch = lease_epoch + 1,
      lease_expires_at = now() + interval '15 minutes',
      cleanup_started_at = coalesce(cleanup_started_at, now()), updated_at = now()
  where id = v_run.id returning * into v_run;
  return jsonb_build_object(
    'outcome', 'claimed', 'run_id', v_run.id, 'lease_token', v_token,
    'lease_epoch', v_run.lease_epoch, 'root_account_id', v_run.root_account_id,
    'original_root_name', v_run.original_root_name, 'status', v_run.status
  );
end;
$function$;

create or replace function public.register_demo_resource(
  p_run_id bigint,
  p_lease_token text,
  p_resource_type text,
  p_resource_id bigint
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.demo_run_lease_is_current(p_run_id, p_lease_token, 'seed') then
    raise exception 'demo run % lease is stale or fenced', p_run_id
      using errcode = 'serialization_failure';
  end if;
  perform public.assert_demo_resource_ownership(p_run_id, p_resource_type, p_resource_id, true);
  insert into public.demo_run_resources (run_id, resource_type, resource_id)
  values (p_run_id, p_resource_type, p_resource_id)
  on conflict (run_id, resource_type, resource_id) do nothing;
end;
$function$;

create or replace function public.seed_demo_single_private_content(
  p_run_id bigint,
  p_lease_token text,
  p_account_id bigint,
  p_single_id bigint,
  p_preference_body text,
  p_preference_visible_to_manager boolean,
  p_note_body text,
  p_note_visible_to_manager boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_preference_id bigint;
  v_note_id bigint;
begin
  if not public.demo_run_lease_is_current(p_run_id, p_lease_token, 'seed')
     or not exists (
       select 1 from public.demo_run_accounts dra
       join public.demo_runs dr on dr.id = dra.run_id
       where dra.run_id = p_run_id and dra.account_id = p_account_id
         and dra.is_root and dr.status = 'seeding'
     ) then
    raise exception 'demo private content seed is stale or outside the root run'
      using errcode = 'serialization_failure';
  end if;
  if not exists (
    select 1 from public.singles s
    where s.id = p_single_id and s.account_id = p_account_id
  ) then
    raise exception 'demo private content single % is not owned by account %', p_single_id, p_account_id
      using errcode = 'foreign_key_violation';
  end if;
  insert into public.single_preferences (account_id, single_id, body, visible_to_manager)
  values (p_account_id, p_single_id, p_preference_body, p_preference_visible_to_manager)
  returning id into v_preference_id;
  insert into public.single_notes (account_id, single_id, body, visible_to_manager)
  values (p_account_id, p_single_id, p_note_body, p_note_visible_to_manager)
  returning id into v_note_id;
  perform public.assert_demo_resource_ownership(p_run_id, 'single_preference', v_preference_id, true);
  perform public.assert_demo_resource_ownership(p_run_id, 'single_note', v_note_id, true);
  insert into public.demo_run_resources (run_id, resource_type, resource_id)
  values (p_run_id, 'single_preference', v_preference_id),
         (p_run_id, 'single_note', v_note_id);
  return jsonb_build_object('preference_id', v_preference_id, 'note_id', v_note_id);
end;
$function$;

create or replace function public.regrant_child_grant(p_grant_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_grant public.child_grants;
  v_new_grant public.child_grants;
  v_actor_account_id bigint := public.current_context_id();
  v_target_account_id bigint;
  v_run_id bigint;
  v_token text;
begin
  select * into v_old_grant from public.child_grants where id = p_grant_id for update;
  select account_id into v_target_account_id
  from public.singles where id = v_old_grant.target_single_id;
  if not found
     or v_actor_account_id is null
     or v_actor_account_id <> v_old_grant.proposer_account_id
     or v_target_account_id is null
     or not exists (
       select 1 from public.account_members am
       where am.account_id = v_actor_account_id and am.user_id = auth.uid()
         and am.status = 'active' and am.role in ('parent_admin', 'self_manager')
     ) then
    raise exception 'child grant % not found or not authorized to re-grant', p_grant_id;
  end if;
  if v_old_grant.status not in ('severed', 'revoked', 'expired') then
    raise exception 'child grant % cannot be re-granted (status %)', p_grant_id, v_old_grant.status
      using errcode = 'check_violation';
  end if;

  -- An active demo regrant is an interaction on a manifest-owned graph.  The
  -- actor and both endpoints must resolve to the same run before the new row
  -- is inserted; the row and manifest receipt then commit together.
  select dr.id into v_run_id
  from public.demo_runs dr
  join public.demo_run_accounts dra on dra.run_id = dr.id
  where dr.status = 'active' and dra.account_id = v_actor_account_id
  order by dr.id desc limit 1;
  if v_run_id is not null then
    perform public.demo_assert_same_active_run(
      array[v_actor_account_id, v_old_grant.proposer_account_id, v_target_account_id],
      'child grant re-grant'
    );
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.child_grants (
    proposer_account_id, target_single_id, token_hash, expires_at, access_level
  ) values (
    v_old_grant.proposer_account_id, v_old_grant.target_single_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '7 days',
    v_old_grant.access_level
  ) returning * into v_new_grant;
  if v_run_id is not null then
    insert into public.demo_run_resources (run_id, resource_type, resource_id)
    values (v_run_id, 'child_grant', v_new_grant.id);
  end if;
  return v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION "public"."demo_assert_empty_account"("p_account_id" bigint) RETURNS void
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1 from public.accounts
    where id = p_account_id and kind = 'household'
  ) then
    raise exception 'demo root account % must be a household context', p_account_id
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.singles where account_id = p_account_id)
     or exists (select 1 from public.single_preferences where account_id = p_account_id)
     or exists (select 1 from public.single_notes where account_id = p_account_id)
     or exists (select 1 from public.shadchanim where account_id = p_account_id)
     or exists (select 1 from public.references where account_id = p_account_id)
     or exists (select 1 from public.shidduchim where account_id = p_account_id)
     or exists (select 1 from public.inbox_items where account_id = p_account_id)
     or exists (select 1 from public.message_notifications where account_id = p_account_id)
     or exists (select 1 from public.task_notifications where account_id = p_account_id)
     or exists (select 1 from public.messages where account_id = p_account_id)
     or exists (select 1 from public.threads where account_id = p_account_id)
     or exists (select 1 from public.thread_participants where account_id = p_account_id)
     or exists (select 1 from public.tasks where account_id = p_account_id)
     or exists (select 1 from public.reference_links where account_id = p_account_id)
     or exists (select 1 from public.redts where account_id = p_account_id)
     or exists (select 1 from public.shidduch_education where account_id = p_account_id)
     or exists (select 1 from public.resume_photos where account_id = p_account_id)
     or exists (select 1 from public.resumes where account_id = p_account_id)
     or exists (select 1 from public.entity_files where account_id = p_account_id)
     or exists (select 1 from public.medical_notes where account_id = p_account_id)
     or exists (select 1 from public.shidduchim_external_links where account_id = p_account_id)
     or exists (select 1 from public.date_records where account_id = p_account_id)
     or exists (select 1 from public.listing_withdrawal_locks where account_id = p_account_id)
     or exists (select 1 from public.listings where account_id = p_account_id)
     or exists (select 1 from public.invites where account_id = p_account_id)
     or exists (select 1 from public.analytics_events where account_id = p_account_id)
     or exists (select 1 from public.trusted_senders where account_id = p_account_id)
     or exists (select 1 from public.share_links where account_id = p_account_id)
     or exists (
       select 1 from public.connections
       where household_account_id = p_account_id
          or shadchanus_account_id = p_account_id
     )
     or exists (
       select 1 from public.connection_invites
       where inviter_account_id = p_account_id
          or accepted_by_account_id = p_account_id
     )
     or exists (
       select 1 from public.child_grants
       where proposer_account_id = p_account_id
          or grantee_account_id = p_account_id
     )
     or exists (
       select 1
       from public.messages m
       join public.connections c on c.id = m.connection_id
       where c.household_account_id = p_account_id
          or c.shadchanus_account_id = p_account_id
     )
     or exists (
       select 1
       from public.threads t
       join public.connections c on c.id = t.connection_id
       where c.household_account_id = p_account_id
          or c.shadchanus_account_id = p_account_id
     )
     or exists (
       select 1
       from public.thread_participants tp
       join public.connections c on c.id = tp.connection_id
       where c.household_account_id = p_account_id
          or c.shadchanus_account_id = p_account_id
     )
     or exists (
       select 1
       from public.message_notifications mn
       join public.connections c on c.id = mn.connection_id
       where c.household_account_id = p_account_id
          or c.shadchanus_account_id = p_account_id
     )
     or exists (
       select 1
       from storage.objects
       where bucket_id in ('documents', 'entity-files', 'attachments')
         and (name = p_account_id::text or name like p_account_id::text || '/%')
     ) then
    raise exception 'demo root account % is not empty', p_account_id
      using errcode = 'check_violation';
  end if;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."assert_official_demo_inventory"(
  "p_run_id" bigint,
  "p_require_active" boolean DEFAULT false
) RETURNS void
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_status text;
  v_operation text;
  v_cleanup_started_at timestamptz;
  v_root bigint;
begin
  select status, operation, cleanup_started_at, root_account_id
    into v_status, v_operation, v_cleanup_started_at, v_root
  from public.demo_runs
  where id = p_run_id;
  if not found or (p_require_active and (
       v_status not in ('active', 'clearing')
       or (v_status = 'clearing' and (v_operation <> 'clear' or v_cleanup_started_at is null))
     ))
     or (not p_require_active and v_status <> 'seeding') then
    raise exception 'official demo run % is not in the expected inventory phase', p_run_id
      using errcode = 'check_violation';
  end if;

  if (select count(*) from public.demo_run_accounts where run_id = p_run_id) <> 3
     or not exists (select 1 from public.demo_run_accounts where run_id = p_run_id and context_key = 'primary-household' and context_kind = 'household' and is_root)
     or not exists (select 1 from public.demo_run_accounts where run_id = p_run_id and context_key = 'feldman-shadchanus' and context_kind = 'shadchanus' and not is_root)
     or not exists (select 1 from public.demo_run_accounts where run_id = p_run_id and context_key = 'gross-household' and context_kind = 'household' and not is_root)
     or (select count(*) from public.demo_run_accounts where run_id = p_run_id and is_root) <> 1
     or not exists (select 1 from public.demo_run_accounts where run_id = p_run_id and account_id = v_root and is_root) then
    raise exception 'official demo run % has an incomplete context graph', p_run_id
      using errcode = 'check_violation';
  end if;

  if (select count(*) from public.demo_run_actor_intents where run_id = p_run_id) <> 3
     or exists (select 1 from public.demo_run_actor_intents where run_id = p_run_id and state <> 'reconciled')
     or exists (select 1 from public.demo_run_actor_intents where run_id = p_run_id and actor_key not in ('dovid-klein', 'leah-feldman', 'miriam-gross'))
     or (select count(*) from public.demo_run_users where run_id = p_run_id) <> 3
     or exists (select 1 from public.demo_run_users where run_id = p_run_id and actor_key not in ('dovid-klein', 'leah-feldman', 'miriam-gross'))
     or not exists (select 1 from public.demo_run_users where run_id = p_run_id and actor_key = 'dovid-klein')
     or not exists (select 1 from public.demo_run_users where run_id = p_run_id and actor_key = 'leah-feldman')
     or not exists (select 1 from public.demo_run_users where run_id = p_run_id and actor_key = 'miriam-gross')
     or exists (
       select 1
       from public.demo_run_actor_intents dai
       where dai.run_id = p_run_id
         and not exists (
           select 1
           from public.demo_run_users dru
           where dru.run_id = dai.run_id
             and dru.actor_key = dai.actor_key
             and dru.user_id = dai.auth_user_id
         )
     ) then
    raise exception 'official demo run % has an incomplete synthetic actor graph', p_run_id
      using errcode = 'check_violation';
  end if;

  -- Before activation there is no customer/runtime writer.  Treat the
  -- official receipt graph as an exact baseline so an accidental extra or
  -- missing row cannot be mistaken for a complete showcase.  Once active,
  -- customer interactions are themselves registered in this manifest, so
  -- destructive clear only requires the same baseline as lower bounds.
  if (not p_require_active and (
       (select count(*) from public.demo_run_resources where run_id = p_run_id) <> 29
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'invite') <> 3
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'connection_invite') <> 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'child_grant') <> 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'connection') <> 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'thread') <> 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'message') <> 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'listing') <> 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'share_link') <> 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'task') <> 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'share_access_log') <> 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'inbox_item') <> 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'analytics_event') <> 3
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'message_notification') <> 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'task_notification') <> 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'trusted_sender') <> 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'single_preference') <> 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'single_note') <> 2
       or (select count(*) from public.demo_run_storage where run_id = p_run_id) <> 50
       or (select count(*) from public.demo_run_storage where run_id = p_run_id and bucket = 'documents') <> 47
       or (select count(*) from public.demo_run_storage where run_id = p_run_id and bucket = 'entity-files') <> 3
       or exists (select 1 from public.demo_run_storage where run_id = p_run_id and bucket not in ('documents', 'entity-files'))
     ))
     or (p_require_active and (
       (select count(*) from public.demo_run_resources where run_id = p_run_id) < 29
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'invite') < 3
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'connection_invite') < 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'child_grant') < 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'connection') < 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'thread') < 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'message') < 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'listing') < 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'share_link') < 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'task') < 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'share_access_log') < 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'inbox_item') < 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'analytics_event') < 3
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'message_notification') < 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'task_notification') < 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'trusted_sender') < 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'single_preference') < 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'single_note') < 2
       or (select count(*) from public.demo_run_storage where run_id = p_run_id and bucket = 'documents') < 47
       or (select count(*) from public.demo_run_storage where run_id = p_run_id and bucket = 'entity-files') < 3
     ))) then
    raise exception 'official demo run % is missing a baseline resource or storage receipt', p_run_id
      using errcode = 'check_violation';
  end if;

  if (not p_require_active and (
       (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'message_notification') <> 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'task_notification') <> 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'share_access_log') <> 1
     ))
     or not exists (
    select 1 from public.singles s
    where s.account_id = v_root
  ) or (select count(*) from public.single_preferences where account_id = v_root) <> 2
  or (select count(*) from public.single_notes where account_id = v_root) <> 2
  or not exists (
    select 1 from public.single_preferences sp
    join public.demo_run_resources drr on drr.resource_type = 'single_preference'
      and drr.resource_id = sp.id and drr.run_id = p_run_id
    where sp.account_id = v_root
  ) or not exists (
    select 1 from public.single_notes sn
    join public.demo_run_resources drr on drr.resource_type = 'single_note'
      and drr.resource_id = sn.id and drr.run_id = p_run_id
    where sn.account_id = v_root
  ) or not exists (
    select 1 from public.shidduchim s
    where s.account_id = v_root
  ) or not exists (
    select 1 from public.message_notifications mn
    join public.demo_run_resources drr on drr.resource_type = 'message_notification' and drr.resource_id = mn.id and drr.run_id = p_run_id
    where mn.simulated and mn.status = 'sent'
  ) or not exists (
    select 1 from public.task_notifications tn
    join public.demo_run_resources drr on drr.resource_type = 'task_notification' and drr.resource_id = tn.id and drr.run_id = p_run_id
    where tn.simulated and tn.status = 'sent'
  ) or not exists (
    select 1 from public.share_access_log sal
    join public.demo_run_resources drr on drr.resource_type = 'share_access_log' and drr.resource_id = sal.id and drr.run_id = p_run_id
    where sal.simulated
  ) or (not p_require_active and (
       exists (
         select 1
         from public.demo_run_resources drr
         join public.message_notifications mn on mn.id = drr.resource_id
         where drr.run_id = p_run_id
           and drr.resource_type = 'message_notification'
           and (mn.simulated is not true or mn.status <> 'sent')
       )
       or exists (
         select 1
         from public.demo_run_resources drr
         join public.task_notifications tn on tn.id = drr.resource_id
         where drr.run_id = p_run_id
           and drr.resource_type = 'task_notification'
           and (tn.simulated is not true or tn.status <> 'sent')
       )
     )) then
    raise exception 'official demo run % is missing a simulated outcome', p_run_id
      using errcode = 'check_violation';
  end if;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."demo_register_seed_resource"("p_resource_type" text, "p_resource_id" bigint, "p_account_id" bigint) RETURNS void
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_run_id bigint;
begin
  select dr.id into v_run_id
  from public.demo_runs dr
  join public.demo_run_accounts dra on dra.run_id = dr.id
  join public.demo_run_users dru on dru.run_id = dr.id
  where dr.status = 'seeding'
    and dra.account_id = p_account_id
    and (
      (auth.uid() is not null and dru.user_id = auth.uid())
      or (auth.uid() is null and public.demo_seed_service_authorized(p_account_id))
    )
  order by dr.id desc
  limit 1;

  if v_run_id is null then
    return;
  end if;

  perform public.assert_demo_resource_ownership(
    v_run_id, p_resource_type, p_resource_id, true
  );
  insert into public.demo_run_resources (run_id, resource_type, resource_id)
  values (v_run_id, p_resource_type, p_resource_id)
  on conflict (run_id, resource_type, resource_id) do nothing;
end;
$$;

-- A marked service request is a seed write only when the database can still
-- prove the exact run lease. Header presence alone is not authorization; it
-- merely tells the write barrier to evaluate the lease-fenced branch below.

set check_function_bodies = on;

create or replace trigger z_enforce_demo_write_barrier_single_preferences
  before insert or update or delete on public.single_preferences
  for each row execute function public.enforce_demo_write_barrier();
create or replace trigger z_enforce_demo_write_barrier_single_notes
  before insert or update or delete on public.single_notes
  for each row execute function public.enforce_demo_write_barrier();

revoke all on function public.demo_lock_account_axes(bigint[], text) from public, anon, authenticated;
grant execute on function public.demo_lock_account_axes(bigint[], text) to service_role;
revoke all on function public.assert_demo_resource_ownership(bigint, text, bigint, boolean) from public, anon, authenticated;
grant execute on function public.assert_demo_resource_ownership(bigint, text, bigint, boolean) to service_role;
revoke all on function public.seed_demo_single_private_content(bigint, text, bigint, bigint, text, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.seed_demo_single_private_content(bigint, text, bigint, bigint, text, boolean, text, boolean) to service_role;
