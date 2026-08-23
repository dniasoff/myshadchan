-- 20260823180000 repairs lazy PL/pgSQL compilation failures in the official
-- demo lifecycle guards. The declarative schema remains the source of truth.

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.delete_demo_companion_contexts(p_run_id bigint, p_lease_token text, p_operation text DEFAULT 'seed'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run public.demo_runs;
begin
  select * into v_run from public.demo_runs where id = p_run_id for update;
  if not found or p_operation not in ('seed', 'clear')
     or v_run.lease_token is distinct from p_lease_token
     or v_run.operation is distinct from p_operation
     or (p_operation = 'seed' and v_run.status <> 'seeding')
     or (p_operation = 'clear' and v_run.status <> 'clearing')
     or v_run.lease_expires_at is null or v_run.lease_expires_at <= now() then
    raise exception 'demo run % lease is stale or fenced', p_run_id
      using errcode = 'serialization_failure';
  end if;

  delete from public.account_members am
  where am.account_id in (
    select dra.account_id from public.demo_run_accounts dra
    where dra.run_id = p_run_id and not dra.is_root
  );
  delete from public.accounts a
  where a.id in (
    select dra.account_id from public.demo_run_accounts dra
    where dra.run_id = p_run_id and not dra.is_root
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.register_demo_auth_cleanup(p_run_id bigint, p_lease_token text, p_actor_key text, p_resolved_user_id uuid, p_expected_email text, p_operation text DEFAULT 'clear'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run public.demo_runs;
  v_expected_email extensions.citext;
begin
  select * into v_run from public.demo_runs where id = p_run_id for update;
  if not found
     or p_operation not in ('seed', 'clear')
     or v_run.lease_token is distinct from p_lease_token
     or v_run.operation is distinct from p_operation
     or (p_operation = 'seed' and v_run.status <> 'seeding')
     or (p_operation = 'clear' and v_run.status <> 'clearing')
     or v_run.lease_expires_at is null or v_run.lease_expires_at <= now() then
    raise exception 'demo run % lease is stale or fenced', p_run_id
      using errcode = 'serialization_failure';
  end if;

  select expected_email into v_expected_email
  from public.demo_run_actor_intents
  where run_id = p_run_id and actor_key = p_actor_key;
  if not found or lower(v_expected_email::text) <> lower(p_expected_email)
     or not exists (
       select 1 from public.demo_run_users
       where run_id = p_run_id and actor_key = p_actor_key
         and user_id = p_resolved_user_id
     ) and not exists (
       select 1 from public.demo_run_actor_intents
       where run_id = p_run_id and actor_key = p_actor_key
         and auth_user_id = p_resolved_user_id
     ) then
    raise exception 'demo auth cleanup identity is not exactly registered'
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.demo_run_auth_cleanup (
    run_id, actor_key, resolved_user_id, expected_email, state
  ) values (
    p_run_id, p_actor_key, p_resolved_user_id, p_expected_email, 'deleting'
  )
  on conflict (run_id, actor_key) do update
    set resolved_user_id = excluded.resolved_user_id,
        expected_email = excluded.expected_email,
        state = case when public.demo_run_auth_cleanup.state = 'deleted'
          then 'deleted' else 'deleting' end,
        updated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_demo_member_state(p_run_id bigint, p_lease_token text, p_operation text DEFAULT 'clear'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run public.demo_runs;
begin
  select * into v_run
  from public.demo_runs
  where id = p_run_id
  for update;

  if not found
     or p_operation not in ('seed', 'clear')
     or v_run.lease_token is distinct from p_lease_token
     or v_run.operation is distinct from p_operation
     or (p_operation = 'seed' and v_run.status <> 'seeding')
     or (p_operation = 'clear' and v_run.status <> 'clearing')
     or v_run.lease_expires_at is null
     or v_run.lease_expires_at <= now() then
    raise exception 'demo run % lease is stale or fenced', p_run_id
      using errcode = 'serialization_failure';
  end if;

  insert into public.member_state (user_id, active_account_id, updated_at)
  select s.user_id,
         case
           when s.original_active_account_id is null then null
           when exists (
             select 1 from public.account_members am
             where am.user_id = s.user_id
               and am.account_id = s.original_active_account_id
               and am.status = 'active'
           ) then s.original_active_account_id
           else null
         end,
         coalesce(original_updated_at, now())
  from public.demo_run_member_state s
  where s.run_id = p_run_id
  on conflict (user_id) do update
    set active_account_id = excluded.active_account_id,
        updated_at = excluded.updated_at;
end;
$function$
;
