-- Official demo completeness overrides after the lock/resource migration.

-- 20260823171000

set check_function_bodies = off;

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

CREATE OR REPLACE FUNCTION "public"."regrant_child_grant"("p_grant_id" bigint) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    where am.account_id = v_actor_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'child grant % not found or not authorized to re-grant', p_grant_id;
  end if;

  if v_old_grant.status not in ('severed', 'revoked', 'expired') then
    raise exception 'child grant % cannot be re-granted (status %)', p_grant_id, v_old_grant.status
      using errcode = 'check_violation';
  end if;

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
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '7 days',
    v_old_grant.access_level
  ) returning * into v_new_grant;
  if v_run_id is not null then
    insert into public.demo_run_resources (run_id, resource_type, resource_id)
    values (v_run_id, 'child_grant', v_new_grant.id);
  end if;

  return v_token;
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

set check_function_bodies = on;

