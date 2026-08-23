-- Official demo review repairs; generated from declarative schemas against stack 2.
-- 20260823160000
alter table "public"."demo_run_actor_intents" drop constraint "demo_run_actor_intents_state_check";

drop function if exists "public"."reconcile_demo_actor"(p_run_id bigint, p_lease_token text, p_actor_key text, p_user_id uuid);

alter table "public"."demo_run_actor_intents" add constraint "demo_run_actor_intents_state_check" CHECK ((state = ANY (ARRAY['pending'::text, 'reconciled'::text, 'confirmed_absent'::text]))) not valid;

alter table "public"."demo_run_actor_intents" validate constraint "demo_run_actor_intents_state_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.assert_official_demo_inventory(p_run_id bigint, p_require_active boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       (select count(*) from public.demo_run_resources where run_id = p_run_id) <> 25
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
       or (select count(*) from public.demo_run_storage where run_id = p_run_id) <> 50
       or (select count(*) from public.demo_run_storage where run_id = p_run_id and bucket = 'documents') <> 47
       or (select count(*) from public.demo_run_storage where run_id = p_run_id and bucket = 'entity-files') <> 3
       or exists (select 1 from public.demo_run_storage where run_id = p_run_id and bucket not in ('documents', 'entity-files'))
     ))
     or (p_require_active and (
       (select count(*) from public.demo_run_resources where run_id = p_run_id) < 25
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
$function$
;

CREATE OR REPLACE FUNCTION public.block_demo_persona_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
begin
  v_account_id := case when tg_op = 'DELETE' then old.account_id else new.account_id end;
  if auth.uid() is null and public.demo_seed_request_marked() then
    if exists (
      select 1
      from public.demo_run_accounts dra
      join public.demo_runs dr on dr.id = dra.run_id
      where dra.account_id = v_account_id
        and dr.status in ('seeding', 'active', 'clearing', 'failed')
        and not public.demo_seed_service_authorized(v_account_id)
    ) then
      raise exception 'demo persona write is stale or fenced'
        using errcode = 'serialization_failure';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if auth.uid() is not null and exists (
    select 1
    from public.account_members am
    join public.demo_run_accounts dra on dra.account_id = am.account_id
    join public.demo_runs dr on dr.id = dra.run_id
    where am.user_id = auth.uid()
      and am.status = 'active'
      and dr.status in ('seeding', 'active', 'clearing', 'failed')
  ) then
    raise exception 'persona changes are unavailable while the official demo is active'
      using errcode = 'lock_not_available';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_demo_actor_absent(p_run_id bigint, p_lease_token text, p_actor_key text, p_operation text DEFAULT 'clear'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_operation not in ('seed', 'clear')
     or not public.demo_run_lease_is_current(p_run_id, p_lease_token, p_operation) then
    raise exception 'demo run % lease is stale or fenced', p_run_id
      using errcode = 'serialization_failure';
  end if;

  update public.demo_run_actor_intents
  set state = 'confirmed_absent', auth_user_id = null, updated_at = now()
  where run_id = p_run_id
    and actor_key = p_actor_key
    and state = 'pending'
    and auth_user_id is null;
  if not found then
    -- A prior retry may already have durably confirmed absence.  Any other
    -- state is not silently rewritten because it could identify a real actor.
    if not exists (
      select 1 from public.demo_run_actor_intents
      where run_id = p_run_id and actor_key = p_actor_key and state = 'confirmed_absent'
    ) then
      raise exception 'demo actor intent % is not pending', p_actor_key
        using errcode = 'unique_violation';
    end if;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.demo_seed_request_marked()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_headers jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return false;
  end if;
  v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  return (
    nullif(coalesce(v_headers->>'x-demo-run-id', v_headers->>'X-Demo-Run-Id'), '') is not null
    and nullif(coalesce(v_headers->>'x-demo-lease-token', v_headers->>'X-Demo-Lease-Token'), '') is not null
  );
exception when others then
  return false;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.demo_seed_service_authorized(p_account_id bigint DEFAULT NULL::bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_headers jsonb;
  v_run_id bigint;
  v_lease_token text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    return false;
  end if;

  v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_run_id := nullif(coalesce(v_headers->>'x-demo-run-id', v_headers->>'X-Demo-Run-Id'), '')::bigint;
  v_lease_token := nullif(coalesce(v_headers->>'x-demo-lease-token', v_headers->>'X-Demo-Lease-Token'), '');
  if v_run_id is null or v_lease_token is null then
    return false;
  end if;

  return exists (
    select 1
    from public.demo_runs dr
    where dr.id = v_run_id
      and dr.lease_token = v_lease_token
      and dr.operation = 'seed'
      and dr.status = 'seeding'
      and dr.lease_expires_at > now()
      and (
        p_account_id is null
        or dr.root_account_id = p_account_id
        or exists (
          select 1 from public.demo_run_accounts dra
          where dra.run_id = dr.id and dra.account_id = p_account_id
        )
      )
  );
exception when others then
  -- Header parsing must fail closed, never turn a malformed service request
  -- into a seed authorization.
  return false;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.demo_storage_write_allowed(p_account_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.demo_seed_service_authorized(p_account_id)
    or not exists (
      select 1 from public.demo_run_accounts dra
      join public.demo_runs dr on dr.id = dra.run_id
      where dra.account_id = p_account_id
        and dr.status in ('seeding', 'active', 'clearing', 'failed')
    )
    or exists (
      select 1 from public.demo_run_accounts dra
      join public.demo_runs dr on dr.id = dra.run_id
      where dra.account_id = p_account_id and dr.status = 'active'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_demo_member_state_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.demo_seed_request_marked() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if exists (
    select 1
    from unnest(array_remove(array[
      case when tg_op <> 'INSERT' then old.active_account_id else null end,
      case when tg_op <> 'DELETE' then new.active_account_id else null end
    ], null::bigint)) requested(account_id)
    join public.demo_run_accounts dra on dra.account_id = requested.account_id
    join public.demo_runs dr on dr.id = dra.run_id
    where dr.status in ('seeding', 'active', 'clearing', 'failed')
      and not public.demo_seed_service_authorized(requested.account_id)
  ) then
    raise exception 'demo member state write is stale or fenced'
      using errcode = 'serialization_failure';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reconcile_demo_actor(p_run_id bigint, p_lease_token text, p_actor_key text, p_user_id uuid, p_operation text DEFAULT 'seed'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_intent public.demo_run_actor_intents;
begin
  if p_operation not in ('seed', 'clear')
     or not public.demo_run_lease_is_current(p_run_id, p_lease_token, p_operation) then
    raise exception 'demo run % lease is stale or fenced', p_run_id
      using errcode = 'serialization_failure';
  end if;

  select * into v_intent
  from public.demo_run_actor_intents
  where run_id = p_run_id and actor_key = p_actor_key
  for update;
  if not found then
    raise exception 'demo actor intent % not found', p_actor_key
      using errcode = 'foreign_key_violation';
  end if;

  if v_intent.auth_user_id is not null
     and v_intent.auth_user_id is distinct from p_user_id then
    raise exception 'demo actor intent % already reconciled', p_actor_key
      using errcode = 'unique_violation';
  end if;

  update public.demo_run_actor_intents
  set auth_user_id = p_user_id, state = 'reconciled', updated_at = now()
  where id = v_intent.id;

  insert into public.demo_run_users (run_id, user_id, actor_key)
  values (p_run_id, p_user_id, p_actor_key)
  on conflict (run_id, actor_key) do update set user_id = excluded.user_id;

  return jsonb_build_object(
    'run_id', p_run_id,
    'actor_key', p_actor_key,
    'user_id', p_user_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.release_demo_orphan_for_onboarding()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_intent public.demo_onboarding_intents;
  v_account_id bigint;
  v_member_id bigint;
  v_member_count integer;
begin
  if v_user_id is null then
    raise exception 'release_demo_orphan_for_onboarding requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_intent
  from public.demo_onboarding_intents
  where user_id = v_user_id and state in ('pending', 'failed')
  for update;
  if not found or v_intent.account_id is null then
    return false;
  end if;
  v_account_id := v_intent.account_id;

  if exists (
    select 1 from public.demo_runs
    where root_account_id = v_account_id
      and status in ('seeding', 'active', 'clearing', 'failed')
  ) then
    return false;
  end if;
  if not exists (
    select 1 from public.accounts
    where id = v_account_id and kind = 'household' and demo is true
  ) then
    return false;
  end if;
  select count(*)::integer, min(am.id) into v_member_count, v_member_id
  from public.account_members am
  where am.account_id = v_account_id and am.status = 'active';
  if v_member_id is null or v_member_count <> 1
     or not exists (
       select 1 from public.account_members
       where id = v_member_id and user_id = v_user_id and role in ('parent_admin', 'self_manager')
     ) then
    return false;
  end if;

  perform public.demo_assert_empty_account(v_account_id);
  update public.account_members set status = 'archived' where id = v_member_id;
  update public.accounts set demo = false where id = v_account_id;
  update public.member_state
  set active_account_id = null, updated_at = now()
  where user_id = v_user_id and active_account_id = v_account_id;
  delete from public.demo_clear_receipts
  where user_id = v_user_id and root_account_id = v_account_id;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.activate_demo_run(p_run_id bigint, p_lease_token text, p_active_root_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run public.demo_runs;
begin
  select * into v_run from public.demo_runs where id = p_run_id for update;
  if not found or v_run.lease_token is distinct from p_lease_token
     or v_run.operation <> 'seed' or v_run.status <> 'seeding'
     or v_run.lease_expires_at <= now() then
     raise exception 'demo run % lease is stale or fenced', p_run_id
      using errcode = 'serialization_failure';
  end if;

  perform public.assert_official_demo_inventory(p_run_id, false);

  update public.accounts
  set name = p_active_root_name, demo = true
  where id = v_run.root_account_id;

  update public.demo_runs
  set status = 'active', operation = null, lease_token = null,
      lease_expires_at = null, updated_at = now()
  where id = p_run_id;

  update public.demo_onboarding_intents
  set state = 'completed', demo_run_id = p_run_id, last_error = null,
      updated_at = now()
  where account_id = v_run.root_account_id;

  return jsonb_build_object('run_id', p_run_id, 'status', 'active');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_persona(p_persona text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_first_name text;
  v_account_id bigint;
  v_membership_id bigint;
  v_created_household boolean := false;
begin
  -- Review finding #2: fail closed on an unauthenticated caller. Without
  -- this, service_role (which holds EXECUTE for legitimate server-side
  -- callers, e.g. a future edge function) calling add_persona() with no
  -- user JWT would silently insert an accounts/account_members row with
  -- user_id NULL — an orphan tenant nothing can ever reach, not a
  -- cross-tenant leak, but a violation of the fail-closed convention
  -- current_context_id()/set_active_context() already establish.
  if v_user_id is null then
    raise exception 'add_persona requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if p_persona not in ('single', 'parent', 'shadchan') then
    raise exception 'unknown persona: %', p_persona
      using errcode = 'invalid_parameter_value';
  end if;

  if exists (
    select 1
    from public.account_members am
    join public.demo_run_accounts dra on dra.account_id = am.account_id
    join public.demo_runs dr on dr.id = dra.run_id
    where am.user_id = v_user_id
      and am.status = 'active'
      and dr.status in ('seeding', 'active', 'clearing', 'failed')
  ) then
    raise exception 'persona changes are unavailable while the official demo is active'
      using errcode = 'lock_not_available';
  end if;

  select m.first_name into v_first_name
  from public.members m
  where m.user_id = v_user_id;

  if p_persona = 'parent' then
    -- No-op: an active parent_admin membership already exists.
    if exists (
      select 1 from public.account_members
      where user_id = v_user_id and status = 'active' and role = 'parent_admin'
    ) then
      select account_id into v_account_id
      from public.account_members
      where user_id = v_user_id and status = 'active' and role = 'parent_admin'
      order by id limit 1;
      perform public.link_demo_onboarding_intent(v_user_id, v_account_id, false);
      return;
    end if;

    -- Promote an existing self_manager membership in place (never rewrite
    -- account_id — that would trip enforce_household_scope() for no reason,
    -- the household is already valid).
    update public.account_members
      set role = 'parent_admin'
    where id = (
      select id from public.account_members
      where user_id = v_user_id and status = 'active' and role = 'self_manager'
      order by id
      limit 1
    );

    if found then
      select account_id into v_account_id
      from public.account_members
      where user_id = v_user_id and status = 'active' and role = 'parent_admin'
      order by id limit 1;
      perform public.link_demo_onboarding_intent(v_user_id, v_account_id, false);
      return;
    end if;

    -- Otherwise (no memberships at all, or only non-owning ones elsewhere —
    -- e.g. a helper in someone else's household): a fresh household. A
    -- non-owning membership is never promoted — that would hand the caller
    -- admin of a household that is not theirs.
    --
    -- Review finding #4: nullif(v_first_name, 'Pending') closes a dead
    -- fallback. public.members.first_name is NOT NULL DEFAULT 'Pending' and
    -- handle_new_user() always creates the row (01_tables.sql, 02_functions.sql),
    -- so plain `coalesce(v_first_name || '''s Family', 'My Account')` could
    -- never reach its own 'My Account' arm — a signup with no first/given
    -- name in their OAuth metadata got a household literally named
    -- "Pending's Family" instead of the intended placeholder.
    insert into public.accounts (name, kind)
    values (coalesce(nullif(v_first_name, 'Pending') || '''s Family', 'My Account'), 'household')
    returning id into v_account_id;
    v_created_household := true;

    insert into public.account_members (account_id, user_id, role, status)
    values (v_account_id, v_user_id, 'parent_admin', 'active');

    perform public.link_demo_onboarding_intent(v_user_id, v_account_id, v_created_household);

    return;
  end if;

  if p_persona = 'single' then
    -- No-op: a singles row already points at one of the caller's own active
    -- memberships (the invited single, or re-ticking a box already held).
    -- This predicate must match my_personas()'s single-detection exactly.
    -- Story 2.5: `s.status = 'active'` is load-bearing, not decorative —
    -- without it, re-ticking `single` after remove_persona() archived the
    -- caller's own singles row would silently no-op forever (the archived
    -- row still satisfies `s.member_id = am.id`), the exact "add a persona
    -- back" round trip the epic's own example requires.
    if exists (
      select 1
      from public.singles s
      join public.account_members am on am.id = s.member_id
      where am.user_id = v_user_id
        and am.status = 'active'
        and s.status = 'active'
        and (am.role = 'single' or public.is_owning_membership_role(am.role))
    ) then
      return;
    end if;

    -- Attach to an existing OWNING membership if the caller has one (never a
    -- helper's household — see the Dev Notes on why `single` never attaches
    -- to a helper's household).
    select am.id, am.account_id into v_membership_id, v_account_id
    from public.account_members am
    where am.user_id = v_user_id
      and am.status = 'active'
      and public.is_owning_membership_role(am.role)
    order by am.id
    limit 1;

    -- A 2-parent household can never also have a self-managed shidduch
    -- profile: `self_manager` exists specifically for a SINGLE-parent
    -- household where that one parent IS the shidduch candidate. Without
    -- this check, a parent_admin in an existing 2-parent household (reached
    -- via create_invite('parent_admin')/accept_invite() — a real path, not a
    -- hypothetical) could attach their own self-managed singles row here.
    -- Only checked when attaching to an EXISTING owning membership — the
    -- fresh-household branch below is guaranteed exactly one parent by
    -- construction and can never trip this.
    if v_membership_id is not null and (
      select count(*) from public.account_members am2
      where am2.account_id = v_account_id
        and am2.status = 'active'
        and public.is_owning_membership_role(am2.role)
    ) >= 2 then
      raise exception 'a 2-parent household cannot also have a self-managed shidduch profile'
        using errcode = 'check_violation';
    end if;

    if v_membership_id is null then
      insert into public.accounts (name, kind)
      values (coalesce(nullif(v_first_name, 'Pending') || '''s Family', 'My Account'), 'household')
      returning id into v_account_id;

      insert into public.account_members (account_id, user_id, role, status)
      values (v_account_id, v_user_id, 'self_manager', 'active')
      returning id into v_membership_id;
    end if;

    insert into public.singles (account_id, member_id)
    values (v_account_id, v_membership_id);

    return;
  end if;

  if p_persona = 'shadchan' then
    -- No-op: an active shadchan-role membership already exists.
    if exists (
      select 1 from public.account_members
      where user_id = v_user_id and status = 'active' and role = 'shadchan'
    ) then
      return;
    end if;

    insert into public.accounts (kind)
    values ('shadchanus')
    returning id into v_account_id;

    insert into public.account_members (account_id, user_id, role, status)
    values (v_account_id, v_user_id, 'shadchan', 'active');

    return;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_demo_onboarding()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_intent public.demo_onboarding_intents;
  v_demo_account boolean;
  v_released boolean;
begin
  if auth.uid() is null then
    raise exception 'cancel_demo_onboarding requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_intent
  from public.demo_onboarding_intents
  where user_id = auth.uid() and state in ('pending', 'failed')
  for update;
  if not found then
    return;
  end if;

  -- A linked demo account is not disposable merely because the browser has
  -- chosen the ordinary onboarding path. Release it only through the exact
  -- orphan proof; if any run, membership, or data remains, retain the intent
  -- so refresh/retry still has a cleanup handle.
  if v_intent.account_id is not null then
    select exists (
      select 1 from public.accounts
      where id = v_intent.account_id and demo is true
    ) into v_demo_account;
    if v_demo_account then
      v_released := public.release_demo_orphan_for_onboarding();
      if not v_released then
        return;
      end if;
    end if;
  end if;

  delete from public.demo_onboarding_intents
  where user_id = auth.uid() and state in ('pending', 'failed');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_invite(p_email text, p_role text, p_target_single_id bigint DEFAULT NULL::bigint)
 RETURNS public.invites
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_membership_id bigint;
  v_caller_role text;
  v_account_kind text;
  v_invite public.invites;
begin
  v_account_id := public.current_context_id();
  perform public.demo_assert_registered_actor(v_account_id, auth.uid(), 'membership invite creation');

  if public.demo_seed_service_authorized(v_account_id) then
    -- The first official invite is created by the service-owned seed lease
    -- before the synthetic root actor has accepted membership.  Resolve the
    -- already-existing real owner, never a browser-supplied identity.
    select am.id, am.role into v_membership_id, v_caller_role
    from public.account_members am
    where am.account_id = v_account_id
      and am.status = 'active'
    order by am.id
    limit 1;
  else
    select am.id, am.role into v_membership_id, v_caller_role
    from public.account_members am
    where am.account_id = v_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
    order by am.id
    limit 1;
  end if;

  if v_membership_id is null then
    raise exception 'no active membership of the current context'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.is_invite_capable_role(v_caller_role) then
    raise exception 'role % may not send invites', v_caller_role
      using errcode = 'insufficient_privilege';
  end if;

  if public.role_authority(p_role) > public.role_authority(v_caller_role) then
    raise exception 'cannot invite role % above your own authority', p_role
      using errcode = 'insufficient_privilege';
  end if;

  select kind into v_account_kind from public.accounts where id = v_account_id;

  if v_account_kind = 'household' and p_role not in ('parent_admin', 'helper', 'single') then
    raise exception 'role % is not invitable into a household-kind account', p_role
      using errcode = 'check_violation';
  end if;

  if v_account_kind = 'shadchanus' and p_role <> 'shadchan' then
    raise exception 'role % is not invitable into a shadchanus-kind account', p_role
      using errcode = 'check_violation';
  end if;

  -- Story 6.1 (AC-2, AC-4): a single-role invite always names a target — the
  -- check constraint would catch a null one too, but this is a clearer
  -- client message than a bare constraint violation.
  if p_role = 'single' and p_target_single_id is null then
    raise exception 'a single-role invite requires a target single'
      using errcode = 'check_violation';
  end if;

  -- Story 6.1 (AC-4): refuses an already-linked target at creation time
  -- (UX only — accept_invite() fails closed independently if the target
  -- becomes linked in the window between invite and acceptance).
  if p_target_single_id is not null and not exists (
    select 1 from public.singles s
    where s.id = p_target_single_id
      and s.account_id = v_account_id
      and s.member_id is null
  ) then
    raise exception 'single % not found in current account', p_target_single_id
      using errcode = 'check_violation';
  end if;

  insert into public.invites (email, account_id, role, invited_by, target_single_id)
  values (p_email, v_account_id, p_role, v_membership_id, p_target_single_id)
  returning * into v_invite;

  perform public.demo_register_seed_resource(
    'invite', v_invite.id, v_account_id
  );

  return v_invite;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.current_context_id()
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
begin
  select ms.active_account_id into v_account_id
  from public.member_state ms
  where ms.user_id = auth.uid()
    and exists (
      select 1
      from public.account_members am
      where am.user_id = ms.user_id
        and am.account_id = ms.active_account_id
      and am.status = 'active'
    );

  if v_account_id is null and public.demo_seed_service_authorized() then
    select dr.root_account_id into v_account_id
    from public.demo_runs dr
    where dr.id = nullif(coalesce(
      (current_setting('request.headers', true)::jsonb)->>'x-demo-run-id',
      (current_setting('request.headers', true)::jsonb)->>'X-Demo-Run-Id'
    ), '')::bigint
      and dr.status = 'seeding'
      and dr.operation = 'seed';
  end if;

  return v_account_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.current_member_id()
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member_id bigint;
begin
  select am.id into v_member_id
  from public.account_members am
  where am.user_id = auth.uid()
    and am.account_id = public.current_context_id()
    and am.status = 'active'
  order by am.id
  limit 1;

  if v_member_id is null and public.demo_seed_service_authorized() then
    select am.id into v_member_id
    from public.account_members am
    where am.account_id = public.current_context_id()
      and am.status = 'active'
    order by am.id
    limit 1;
  end if;

  return v_member_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.demo_assert_registered_actor(p_account_id bigint, p_user_id uuid, p_action text DEFAULT 'operation'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run_id bigint;
  v_status text;
begin
  select dr.id, dr.status
  into v_run_id, v_status
  from public.demo_run_accounts dra
  join public.demo_runs dr on dr.id = dra.run_id
  where dra.account_id = p_account_id
    and dr.status in ('seeding', 'active', 'clearing', 'failed')
  order by dr.id desc
  limit 1;

  if not found then
    return;
  end if;

  if v_status = 'seeding' and public.demo_seed_service_authorized(p_account_id) then
    return;
  end if;

  if v_status not in ('seeding', 'active')
     or p_user_id is null
     or not exists (
       select 1
       from public.demo_run_users dru
       where dru.run_id = v_run_id and dru.user_id = p_user_id
     ) then
    raise exception 'demo boundary violation: % requires a registered synthetic actor',
      coalesce(p_action, 'operation')
      using errcode = 'check_violation';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.demo_assert_same_active_run(p_account_ids bigint[], p_action text DEFAULT 'operation'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_requested_count integer;
  v_mapped_count integer;
  v_run_count integer;
  v_all_active boolean;
  v_has_unfinished boolean;
begin
  with requested as (
    select distinct account_id
    from unnest(coalesce(p_account_ids, array[]::bigint[])) as ids(account_id)
    where account_id is not null
  )
  select count(*) into v_requested_count from requested;

  if v_requested_count = 0 then
    return;
  end if;

  select exists (
    select 1
    from public.demo_run_accounts dra
    join public.demo_runs dr on dr.id = dra.run_id
    where dra.account_id = any(p_account_ids)
      and dr.status in ('seeding', 'active', 'clearing', 'failed')
  ) into v_has_unfinished;

  -- A production-only operation is not on the demo boundary at all.
  if not v_has_unfinished then
    return;
  end if;

  with requested as (
    select distinct account_id
    from unnest(coalesce(p_account_ids, array[]::bigint[])) as ids(account_id)
    where account_id is not null
  ), mapped as (
    select r.account_id, latest.run_id, latest.status
    from requested r
    left join lateral (
      select dr.id as run_id, dr.status
      from public.demo_run_accounts dra
      join public.demo_runs dr on dr.id = dra.run_id
      where dra.account_id = r.account_id
        and dr.status in ('seeding', 'active', 'clearing', 'failed')
      order by dr.id desc
      limit 1
    ) latest on true
  )
  select
    count(*) filter (where run_id is not null),
    count(distinct run_id),
    coalesce(bool_and(
      status = 'active'
      or (
        status = 'seeding'
        and (
          public.demo_seed_service_authorized(mapped.account_id)
          or exists (
          select 1
          from public.demo_run_users dru
          where dru.run_id = mapped.run_id
            and dru.user_id = auth.uid()
          )
        )
      )
    ), false)
  into v_mapped_count, v_run_count, v_all_active
  from mapped;

  if v_mapped_count <> v_requested_count
     or v_run_count <> 1
     or not v_all_active then
    raise exception 'demo boundary violation: % requires one active run for every endpoint',
      coalesce(p_action, 'operation')
      using errcode = 'check_violation';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.demo_register_seed_resource(p_resource_type text, p_resource_id bigint, p_account_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  insert into public.demo_run_resources (run_id, resource_type, resource_id)
  values (v_run_id, p_resource_type, p_resource_id)
  on conflict (run_id, resource_type, resource_id) do nothing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_demo_write_barrier()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if v_row ? 'account_id' and nullif(v_row->>'account_id', '') is not null then
    v_accounts := array_append(v_accounts, (v_row->>'account_id')::bigint);
  end if;
  if tg_table_name = 'connections' then
    v_accounts := array_append(v_accounts, (v_row->>'household_account_id')::bigint);
    v_accounts := array_append(v_accounts, (v_row->>'shadchanus_account_id')::bigint);
  elsif tg_table_name = 'connection_invites' then
    if nullif(v_row->>'inviter_account_id', '') is null then
      raise exception 'demo connection invite has no inviter owner'
        using errcode = 'foreign_key_violation';
    end if;
    v_accounts := array_append(v_accounts, (v_row->>'inviter_account_id')::bigint);
    if nullif(v_row->>'accepted_by_account_id', '') is not null then
      v_accounts := array_append(v_accounts, (v_row->>'accepted_by_account_id')::bigint);
    elsif v_row->>'status' = 'accepted' then
      raise exception 'demo accepted connection invite has no accepting endpoint'
        using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'child_grants' then
    if nullif(v_row->>'proposer_account_id', '') is null then
      raise exception 'demo child grant has no proposer owner'
        using errcode = 'foreign_key_violation';
    end if;
    v_accounts := array_append(v_accounts, (v_row->>'proposer_account_id')::bigint);
    if nullif(v_row->>'grantee_account_id', '') is not null then
      v_accounts := array_append(v_accounts, (v_row->>'grantee_account_id')::bigint);
    elsif v_row->>'status' = 'accepted' then
      raise exception 'demo accepted child grant has no grantee endpoint'
        using errcode = 'check_violation';
    end if;
    v_target_single_id := nullif(v_row->>'target_single_id', '')::bigint;
    if v_target_single_id is null or not exists (
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
        select c.household_account_id as account_id from public.connections c where c.id = (v_row->>'connection_id')::bigint
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
  v_accounts := array_remove(v_accounts, null);

  select dr.id, dr.status into v_run_id, v_status
  from public.demo_runs dr
  join public.demo_run_accounts dra on dra.run_id = dr.id
  where dr.status in ('seeding', 'active', 'clearing', 'failed')
    and dra.account_id = any(v_accounts)
  order by dr.id desc
  limit 1;
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_demo_release_receipt(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'root_account_id', root_account_id,
    'completed_at', completed_at,
    'release_demo', release_demo
  )
  from public.demo_clear_receipts
  where user_id = p_user_id and release_demo is true
    and not exists (
      select 1 from public.demo_runs dr
      where dr.root_account_id = demo_clear_receipts.root_account_id
        and dr.status in ('seeding', 'active', 'clearing', 'failed')
    )
    and exists (
      select 1 from public.accounts a
      where a.id = demo_clear_receipts.root_account_id and a.demo is false
    )
    and not exists (
      select 1 from public.account_members am
      where am.account_id = demo_clear_receipts.root_account_id
        and am.user_id = p_user_id and am.status = 'active'
    )
  order by completed_at desc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.prepare_demo_onboarding()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_intent public.demo_onboarding_intents;
begin
  if v_user_id is null then
    raise exception 'prepare_demo_onboarding requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- A release completion receipt is a one-shot retry proof, not a new
  -- onboarding identity. Starting onboarding again retires it atomically.
  delete from public.demo_clear_receipts where user_id = v_user_id;

  select * into v_intent
  from public.demo_onboarding_intents
  where user_id = v_user_id
  for update;
  if found then
    if v_intent.state in ('pending', 'failed') and v_intent.account_id is not null then
      -- Never clear an active/successful run here.  This proof-bound helper
      -- only releases an empty orphan whose ownership is already recorded by
      -- this exact onboarding intent.
      perform public.release_demo_orphan_for_onboarding();
      select * into v_intent
      from public.demo_onboarding_intents
      where user_id = v_user_id;
    end if;
    if v_intent.state = 'completed' and not exists (
      select 1 from public.account_members
      where user_id = v_user_id and status = 'active'
    ) then
      update public.demo_onboarding_intents
      set state = 'pending', account_id = null, demo_run_id = null,
          last_error = null, attempts = attempts + 1, updated_at = now()
      where user_id = v_user_id
      returning * into v_intent;
    end if;
    return jsonb_build_object(
      'state', v_intent.state,
      'account_id', v_intent.account_id,
      'attempts', v_intent.attempts
    );
  end if;

  -- A caller with any live context/persona is an established customer unless
  -- this exact durable intent already exists. Never manufacture a seed intent
  -- for an established account merely because its tables happen to be empty.
  if exists (
    select 1 from public.account_members
    where user_id = v_user_id and status = 'active'
  ) or exists (
    select 1
    from public.singles s
    join public.account_members am on am.id = s.member_id
    where am.user_id = v_user_id and am.status = 'active' and s.status = 'active'
  ) then
    raise exception 'demo onboarding is only available to a first-run login'
      using errcode = 'check_violation';
  end if;

  insert into public.demo_onboarding_intents (user_id, state, attempts)
  values (v_user_id, 'pending', 1)
  returning * into v_intent;

  return jsonb_build_object(
    'state', v_intent.state,
    'account_id', v_intent.account_id,
    'attempts', v_intent.attempts
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_persona(p_persona text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_membership_id bigint;
  v_account_id bigint;
  v_role text;
  v_single_id bigint;
  v_persona_count int;
  v_holds_single boolean;
  v_other_singles_count int;
  v_other_admins_count int;
  v_archived_account_id bigint;
  v_was_active boolean;
  v_new_active_account_id bigint;
begin
  if v_user_id is null then
    raise exception 'remove_persona requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if p_persona not in ('single', 'parent', 'shadchan') then
    raise exception 'unknown persona: %', p_persona
      using errcode = 'invalid_parameter_value';
  end if;

  if exists (
    select 1
    from public.account_members am
    join public.demo_run_accounts dra on dra.account_id = am.account_id
    join public.demo_runs dr on dr.id = dra.run_id
    where am.user_id = v_user_id
      and am.status = 'active'
      and dr.status in ('seeding', 'active', 'clearing', 'failed')
  ) then
    raise exception 'persona changes are unavailable while the official demo is active'
      using errcode = 'lock_not_available';
  end if;

  -- shadchan: archive the caller's shadchan-role membership outright. No-op
  -- if none is active (mirrors add_persona()'s idempotent-no-op idiom).
  if p_persona = 'shadchan' then
    select id, account_id into v_membership_id, v_account_id
    from public.account_members
    where user_id = v_user_id and status = 'active' and role = 'shadchan'
    order by id
    limit 1;

    if v_membership_id is not null then
      -- Review finding #1: refuse if this is the account's last active
      -- member and it still holds domain data (see guard_persona_removal()).
      perform public.guard_persona_removal(v_membership_id, v_account_id);
      update public.account_members set status = 'archived' where id = v_membership_id;
      v_archived_account_id := v_account_id;
    end if;
  end if;

  -- single: archive the caller's own singles row, but only if it hangs off
  -- an OWNING membership (parent_admin/self_manager — an invited single-role
  -- member's record is managed by the household's parent_admin, never by
  -- this function) and the caller holds at least one other active persona.
  -- No-op if the caller holds no active single persona at all.
  if p_persona = 'single' then
    -- Review finding #3: owning-role candidates (self-managed) must always
    -- be picked over a non-owning invited-single candidate, or a caller who
    -- both self-manages their own single AND is invited as a `single`
    -- elsewhere would be told "ask your household admin" for the record
    -- they DO own, whenever `order by s.id` happened to surface the
    -- non-owning row first. Ordering owning-role first means the
    -- "ask your household admin" branch below is only ever reached when no
    -- owning candidate exists at all.
    select s.id, am.role into v_single_id, v_role
    from public.singles s
    join public.account_members am on am.id = s.member_id
    where am.user_id = v_user_id
      and am.status = 'active'
      and s.status = 'active'
      and (am.role = 'single' or public.is_owning_membership_role(am.role))
    order by public.is_owning_membership_role(am.role) desc, s.id
    limit 1;

    if v_single_id is not null then
      if not public.is_owning_membership_role(v_role) then
        raise exception 'ask your household admin'
          using errcode = 'insufficient_privilege';
      end if;

      -- "at least one other active persona": my_personas() already reports
      -- this exact single persona, so a total count of 1 means it is the
      -- caller's only one.
      select count(*) into v_persona_count from public.my_personas();
      if v_persona_count <= 1 then
        raise exception 'cannot remove your only persona'
          using errcode = 'check_violation';
      end if;

      update public.singles set status = 'archived' where id = v_single_id;
    end if;
  end if;

  -- parent: refuse when the household has other active singles and no other
  -- active parent_admin would remain to manage them; otherwise demote to
  -- self_manager (role only, never account_id — enforce_household_scope()
  -- only fires on account_id changes) if the caller still holds the single
  -- persona in this same household, else archive the membership outright.
  if p_persona = 'parent' then
    select id, account_id into v_membership_id, v_account_id
    from public.account_members
    where user_id = v_user_id and status = 'active' and role = 'parent_admin'
    order by id
    limit 1;

    if v_membership_id is not null then
      select exists (
        select 1 from public.singles
        where member_id = v_membership_id and status = 'active'
      ) into v_holds_single;

      select count(*) into v_other_singles_count
      from public.singles
      where account_id = v_account_id
        and status = 'active'
        and member_id is distinct from v_membership_id;

      select count(*) into v_other_admins_count
      from public.account_members
      where account_id = v_account_id
        and status = 'active'
        and role = 'parent_admin'
        and id <> v_membership_id;

      if v_other_singles_count > 0 and v_other_admins_count = 0 then
        raise exception 'cannot remove parent — no other admin manages this household''s other singles'
          using errcode = 'check_violation';
      end if;

      if v_holds_single then
        update public.account_members set role = 'self_manager' where id = v_membership_id;
      else
        -- Review finding #1: refuse if this is the account's last active
        -- member and it still holds domain data (see guard_persona_removal()).
        -- Covers the case the dependents check above cannot: a household
        -- with only paused singles, or only references/shadchanim/tasks and
        -- no singles at all, still gets orphaned by an outright archive.
        perform public.guard_persona_removal(v_membership_id, v_account_id);
        update public.account_members set status = 'archived' where id = v_membership_id;
        v_archived_account_id := v_account_id;
      end if;
    end if;
  end if;

  -- AC-7: if a membership was just archived above and it was the caller's
  -- active context, re-activate any other remaining active membership, or
  -- clear to NULL if none remain (the fail-closed representation AD-19
  -- specifies). Always activate_context_for() — 2.1's single private
  -- writer — never a second writer of member_state, and never
  -- set_active_context() (it raises rather than writing NULL and would
  -- re-validate a membership this function has just proven).
  if v_archived_account_id is not null then
    select (ms.active_account_id = v_archived_account_id) into v_was_active
    from public.member_state ms
    where ms.user_id = v_user_id;

    if coalesce(v_was_active, false) then
      select am.account_id into v_new_active_account_id
      from public.account_members am
      where am.user_id = v_user_id and am.status = 'active'
      order by am.id
      limit 1;

      perform public.activate_context_for(v_user_id, v_new_active_account_id);
    end if;
  end if;
end;
$function$
;

CREATE TRIGGER z_block_demo_persona_mutation BEFORE INSERT OR DELETE OR UPDATE ON public.account_members FOR EACH ROW EXECUTE FUNCTION public.block_demo_persona_mutation();

CREATE TRIGGER z_enforce_demo_member_state_write BEFORE INSERT OR DELETE OR UPDATE ON public.member_state FOR EACH ROW EXECUTE FUNCTION public.enforce_demo_member_state_write();

drop policy "Attachments writable within account" on "storage"."objects";

drop policy "Documents photos writable within account" on "storage"."objects";

drop policy "Documents resumes writable within account" on "storage"."objects";

drop policy "Entity files writable within account" on "storage"."objects";


  create policy "Attachments writable within account"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'attachments'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND public.demo_storage_write_allowed(((storage.foldername(name))[1])::bigint)));



  create policy "Documents photos writable within account"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND ((storage.foldername(name))[2] = 'photos'::text) AND ((storage.foldername(name))[3] = ANY (ARRAY['shared'::text, 'private_parent'::text])) AND public.demo_storage_write_allowed(((storage.foldername(name))[1])::bigint)));



  create policy "Documents resumes writable within account"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND ((storage.foldername(name))[2] = 'resumes'::text) AND (public.current_member_role() <> 'single'::text) AND public.demo_storage_write_allowed(((storage.foldername(name))[1])::bigint)));



  create policy "Entity files writable within account"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'entity-files'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text) AND (public.current_member_role() <> 'single'::text) AND public.demo_storage_write_allowed(((storage.foldername(name))[1])::bigint)));



