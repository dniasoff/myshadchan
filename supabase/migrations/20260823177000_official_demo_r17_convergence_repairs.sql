-- 20260823177000 R17 convergence repairs. Keep this migration after the final ingest-claim
-- fence so hosted stacks receive the same trigger/function definitions as the
-- declarative schema before the next demo lifecycle operation.

CREATE OR REPLACE FUNCTION "public"."register_demo_runtime_resource"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_row jsonb := to_jsonb(new);
  v_resource_type text;
  v_resource_id bigint;
  v_account_id bigint;
  v_connection_id bigint;
  v_run_id bigint;
  v_demo_endpoint_count integer;
  v_demo_run_count integer;
begin
  if coalesce((v_row->>'simulated')::boolean, false) is not true then return new; end if;
  v_resource_id := (v_row->>'id')::bigint;
  v_resource_type := case tg_table_name
    when 'share_access_log' then 'share_access_log'
    when 'message_notifications' then 'message_notification'
    when 'task_notifications' then 'task_notification'
    else null
  end;
  if v_resource_type is null or v_resource_id is null then return new; end if;

  if tg_table_name = 'share_access_log' then
    select sl.account_id into v_account_id from public.share_links sl
    where sl.id = (v_row->>'share_link_id')::bigint;
  elsif tg_table_name = 'task_notifications' then
    v_account_id := (v_row->>'account_id')::bigint;
  else
    v_account_id := nullif(v_row->>'account_id', '')::bigint;
    v_connection_id := nullif(v_row->>'connection_id', '')::bigint;
  end if;

  if v_connection_id is not null then
    select count(distinct dra.account_id), count(distinct dr.id)
      into v_demo_endpoint_count, v_demo_run_count
    from public.demo_run_accounts dra
    join public.demo_runs dr on dr.id = dra.run_id
    join public.connections c on c.id = v_connection_id
    where dr.status in ('seeding', 'active', 'clearing', 'failed')
      and dra.account_id in (c.household_account_id, c.shadchanus_account_id);
    if v_demo_endpoint_count = 1 then
      raise exception 'demo runtime notification cannot cross a production connection'
        using errcode = 'check_violation';
    end if;
    if v_demo_endpoint_count > 1 and v_demo_run_count <> 1 then
      raise exception 'demo runtime notification cannot cross different demo runs'
        using errcode = 'check_violation';
    end if;
    select dr.id into v_run_id
    from public.connections c
    join public.demo_run_accounts d1 on d1.account_id = c.household_account_id
    join public.demo_run_accounts d2 on d2.run_id = d1.run_id
                                      and d2.account_id = c.shadchanus_account_id
    join public.demo_runs dr on dr.id = d1.run_id
    where c.id = v_connection_id
      and dr.status in ('seeding', 'active', 'clearing', 'failed')
    limit 1;
    if v_demo_endpoint_count > 1 and v_run_id is null then
      raise exception 'demo runtime notification requires one exact demo run'
        using errcode = 'check_violation';
    end if;
  elsif v_account_id is not null then
    select dr.id into v_run_id
    from public.demo_run_accounts dra
    join public.demo_runs dr on dr.id = dra.run_id
    where dra.account_id = v_account_id
      and dr.status in ('seeding', 'active', 'clearing', 'failed')
    order by dr.id desc
    limit 1;
  end if;

  if v_run_id is not null then
    insert into public.demo_run_resources (run_id, resource_type, resource_id)
    values (v_run_id, v_resource_type, v_resource_id)
    on conflict (run_id, resource_type, resource_id) do nothing;
  elsif v_connection_id is not null and v_demo_endpoint_count > 0 then
    raise exception 'demo runtime notification was not registered to an exact run'
      using errcode = 'check_violation';
  end if;
  return new;
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
  v_resource record;
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
  if not p_require_active then
    if (
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
    ) then
      raise exception 'official demo run % is missing its exact baseline inventory', p_run_id
        using errcode = 'check_violation';
    end if;
  else
    if (
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
       or (select count(*) from public.demo_run_storage where run_id = p_run_id) < 50
       or (select count(*) from public.demo_run_storage where run_id = p_run_id and bucket = 'documents') < 47
       or (select count(*) from public.demo_run_storage where run_id = p_run_id and bucket = 'entity-files') < 3
       or exists (select 1 from public.demo_run_storage where run_id = p_run_id and bucket not in ('documents', 'entity-files'))
    ) then
      raise exception 'official demo run % is missing a baseline resource or storage receipt', p_run_id
        using errcode = 'check_violation';
    end if;
  end if;

  if (not p_require_active and (
       (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'message_notification') <> 2
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'task_notification') <> 1
       or (select count(*) from public.demo_run_resources where run_id = p_run_id and resource_type = 'share_access_log') <> 1
     ))
     or (not p_require_active and not exists (
    select 1 from public.singles s
    where s.account_id = v_root
  )) or (not p_require_active and (select count(*) from public.single_preferences where account_id = v_root) <> 2)
  or (not p_require_active and (select count(*) from public.single_notes where account_id = v_root) <> 2)
  or (not p_require_active and not exists (
    select 1 from public.single_preferences sp
    join public.demo_run_resources drr on drr.resource_type = 'single_preference'
      and drr.resource_id = sp.id and drr.run_id = p_run_id
    where sp.account_id = v_root
  )) or (not p_require_active and not exists (
    select 1 from public.single_notes sn
    join public.demo_run_resources drr on drr.resource_type = 'single_note'
      and drr.resource_id = sn.id and drr.run_id = p_run_id
    where sn.account_id = v_root
  )) or (not p_require_active and not exists (
    select 1 from public.shidduchim s
    where s.account_id = v_root
  )) or (not p_require_active and not exists (
    select 1 from public.message_notifications mn
    join public.demo_run_resources drr on drr.resource_type = 'message_notification' and drr.resource_id = mn.id and drr.run_id = p_run_id
    where mn.simulated and mn.status = 'sent'
  )) or (not p_require_active and not exists (
    select 1 from public.task_notifications tn
    join public.demo_run_resources drr on drr.resource_type = 'task_notification' and drr.resource_id = tn.id and drr.run_id = p_run_id
    where tn.simulated and tn.status = 'sent'
  )) or (not p_require_active and not exists (
    select 1 from public.share_access_log sal
    join public.demo_run_resources drr on drr.resource_type = 'share_access_log' and drr.resource_id = sal.id and drr.run_id = p_run_id
    where sal.simulated
  )) or (not p_require_active and (
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

  -- The receipt graph is also the containment boundary. During activation
  -- every registered row must still exist; during an active clear, customer
  -- deletion may have removed a live task/listing/single/dependent, but any
  -- surviving row must still belong only to this exact demo account graph.
  for v_resource in
    select resource_type, resource_id
    from public.demo_run_resources
    where run_id = p_run_id
  loop
    perform public.assert_demo_resource_ownership(
      p_run_id,
      v_resource.resource_type,
      v_resource.resource_id,
      not p_require_active
    );
  end loop;
end;
$$;

revoke all on function public.assert_official_demo_inventory(bigint, boolean) from public, anon, authenticated;
grant execute on function public.assert_official_demo_inventory(bigint, boolean) to service_role;
