set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.delete_demo_companion_contexts(p_run_id bigint, p_lease_token text, p_operation text DEFAULT 'seed'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run public.demo_runs;
  v_companion_account_id bigint;
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

  for v_companion_account_id in
    select dra.account_id from public.demo_run_accounts dra
    where dra.run_id = p_run_id and not dra.is_root
  loop
    if not public.account_storage_cleanup_fence(v_companion_account_id) then
      raise exception 'demo companion account % has pending Storage cleanup', v_companion_account_id
        using errcode = 'check_violation';
    end if;
  end loop;

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

CREATE OR REPLACE FUNCTION public.finalize_demo_clear(p_run_id bigint, p_lease_token text, p_release_demo boolean DEFAULT false, p_release_persona boolean DEFAULT false, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_run public.demo_runs;
  v_active_members integer;
  v_completed_at timestamp with time zone := now();
  v_archived_membership_id bigint;
  v_companion_account_id bigint;
begin
  select * into v_run from public.demo_runs where id = p_run_id for update;
  if not found or v_run.status <> 'clearing'
     or v_run.operation <> 'clear'
     or v_run.lease_token is distinct from p_lease_token
     or v_run.lease_expires_at is null
     or v_run.lease_expires_at <= now() then
    raise exception 'demo run % clear lease is stale or fenced', p_run_id
      using errcode = 'serialization_failure';
  end if;

  if p_release_persona and p_actor_user_id is not null then
    select count(*) into v_active_members
    from public.account_members
    where account_id = v_run.root_account_id and status = 'active';
    if v_active_members = 1 then
      update public.account_members
      set status = 'archived'
      where account_id = v_run.root_account_id
        and user_id = p_actor_user_id
        and role = 'parent_admin'
        and status = 'active'
      returning id into v_archived_membership_id;
    end if;
  end if;

  if exists (
    select 1
    from public.demo_run_users dru
    where dru.run_id = p_run_id
      and not exists (
        select 1 from public.demo_run_auth_cleanup dac
        where dac.run_id = dru.run_id
          and dac.actor_key = dru.actor_key
          and dac.resolved_user_id = dru.user_id
          and dac.state = 'deleted'
      )
  ) then
    raise exception 'demo clear cannot finalize before every exact Auth actor is deleted'
      using errcode = 'check_violation';
  end if;

  -- Companion accounts stay present until this transaction. That keeps a
  -- failed clear's manifest strictly valid after every external/Auth step and
  -- makes account removal atomic with finalization.
  for v_companion_account_id in
    select dra.account_id from public.demo_run_accounts dra
    where dra.run_id = p_run_id and not dra.is_root
  loop
    if not public.account_storage_cleanup_fence(v_companion_account_id) then
      raise exception 'demo companion account % has pending Storage cleanup', v_companion_account_id
        using errcode = 'check_violation';
    end if;
  end loop;

  delete from public.account_members am
  where am.account_id in (
    select dra.account_id
    from public.demo_run_accounts dra
    where dra.run_id = p_run_id and not dra.is_root
  );
  delete from public.accounts a
  where a.id in (
    select dra.account_id
    from public.demo_run_accounts dra
    where dra.run_id = p_run_id and not dra.is_root
  );

  -- Restore only a live membership. In particular, when release_persona
  -- archived the sole bootstrap membership above, active_account_id becomes
  -- NULL rather than pointing at that archived row.
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
         coalesce(s.original_updated_at, now())
  from public.demo_run_member_state s
  where s.run_id = p_run_id
  on conflict (user_id) do update
    set active_account_id = excluded.active_account_id,
        updated_at = excluded.updated_at;

  update public.accounts
  set name = coalesce(v_run.original_root_name, name),
      demo = case when p_release_demo then false else demo end
  where id = v_run.root_account_id;

  if (p_release_persona or p_release_demo) and p_actor_user_id is not null then
    delete from public.demo_onboarding_intents
    where user_id = p_actor_user_id
      and account_id = v_run.root_account_id;
  end if;

  if p_release_demo and p_actor_user_id is not null then
    insert into public.demo_clear_receipts
      (user_id, root_account_id, completed_at, release_demo)
    values (p_actor_user_id, v_run.root_account_id, v_completed_at, true)
    on conflict (user_id, root_account_id) do update
      set completed_at = excluded.completed_at,
          release_demo = excluded.release_demo;
  end if;

  delete from public.demo_runs where id = p_run_id;

  -- The demo is over: the root household must not survive it.
  --
  -- This function used to archive the caller's sole bootstrap membership,
  -- flip `demo = false` and KEEP the account. Because my_contexts() and
  -- current_context_id() both require an ACTIVE membership, that account was
  -- unreachable to everyone the instant this transaction committed -- and a
  -- fresh one was built on the next demo, so every clear -> demo cycle
  -- stranded one more empty household in the database forever. The hosted
  -- acceptance harness was quietly sweeping them, which is exactly why it
  -- stayed invisible.
  --
  -- Deliberately AFTER `delete from public.demo_runs`: the run row and its
  -- cascading manifest are themselves disposability blockers, so the account
  -- only becomes deletable once this clear has finished owning it.
  --
  -- Only on the release path. `admin_reseed_demo_accounts` clears with
  -- p_release_demo = false because it is about to seed the SAME root again.
  if p_release_demo and p_actor_user_id is not null then
    if not public.dispose_orphaned_account(v_run.root_account_id)
       and v_archived_membership_id is not null then
      -- Something the clear did not remove is still holding the account.
      -- Give it back to the caller rather than strand it: an account that
      -- cannot be deleted must stay reachable. Never both, never neither --
      -- assert_account_not_orphaned() enforces exactly that at commit.
      update public.account_members
      set status = 'active'
      where id = v_archived_membership_id;
    end if;
  end if;

  return jsonb_build_object(
    'outcome', 'finalized',
    'run_id', p_run_id,
    'completed_at', v_completed_at
  );
end;
$function$
;
