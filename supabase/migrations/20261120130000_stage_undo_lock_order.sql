-- 9ys follow-up: serialize undo and account purge across every related account.
-- Parent rows come first, then all advisory and account-row locks in ascending
-- account-id order. This also covers child-grant trigger endpoints.

CREATE OR REPLACE FUNCTION "public"."undo_shidduch"("p_id" bigint) RETURNS SETOF "public"."shidduchim"
    SECURITY DEFINER
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $function$
declare
  v_account_id bigint;
  v_role text;
  v_member_id bigint;
  v_service_role boolean;
  v_shidduch_account_id bigint;
  v_shidduch_single_id bigint;
  v_lock_account_id bigint;
  v_row public.shidduchim;
  v_transition public.shidduch_stage_transitions;
  v_latest public.shidduch_stage_transitions;
  v_original_id bigint;
begin
  v_service_role := coalesce(auth.role(), '') = 'service_role';
  v_account_id := public.current_context_id();
  v_role := public.current_member_role();
  v_member_id := public.current_member_id();

  -- A missing active context includes anonymous and pending memberships.  The
  -- demo fence below is shared with other customer writes: a clearing/expired
  -- demo must not accept a stale browser undo.
  if v_account_id is null
     or (not v_service_role and (auth.uid() is null or v_role is null or v_role = 'single')) then
    raise exception 'undo is not available for shidduch %', p_id
      using errcode = 'insufficient_privilege';
  end if;

  select s.account_id, s.single_id
  into v_shidduch_account_id, v_shidduch_single_id
  from public.shidduchim s
  where s.id = p_id;

  if not found then
    raise exception 'shidduch % not found', p_id;
  end if;

  -- Match account_storage_cleanup_fence(): all target-account parent rows
  -- (singles, then shidduchim in id order) come before any account lock. This
  -- preserves the purge/undo order. Once those parents are held, take every
  -- account involved by this shidduch (the caller, owner, and all accepted
  -- grant endpoints for its target single) in ascending id order. The FOR
  -- UPDATE account lock is the strongest mode needed by either side, so the
  -- later demo fence's FOR KEY SHARE is re-entrant and cannot create an
  -- owner/caller/grant-endpoint lock cycle.
  perform 1
  from public.singles
  where account_id = v_shidduch_account_id
  order by id
  for update;
  perform 1
  from public.shidduchim
  where account_id = v_shidduch_account_id
  order by id
  for update;

  for v_lock_account_id in
    select lock_account_id
    from (
      select v_shidduch_account_id as lock_account_id
      union all
      select v_account_id
      union all
      select g.proposer_account_id
      from public.child_grants g
      where g.target_single_id = v_shidduch_single_id
        and g.status = 'accepted'
      union all
      select g.grantee_account_id
      from public.child_grants g
      where g.target_single_id = v_shidduch_single_id
        and g.status = 'accepted'
      union all
      select g.severed_by_account_id
      from public.child_grants g
      where g.target_single_id = v_shidduch_single_id
        and g.status = 'accepted'
    ) as lock_accounts(lock_account_id)
    where lock_account_id is not null
    group by lock_account_id
    order by lock_account_id
  loop
    perform public.account_storage_lock(v_lock_account_id);
    perform 1
    from public.accounts a
    where a.id = v_lock_account_id
    for update;
  end loop;

  -- demo_storage_write_fence() takes the caller account row FOR KEY SHARE. It
  -- runs after the parent-first locks and after both account rows are already
  -- held FOR UPDATE, so it cannot invert the deterministic account order.
  if not public.demo_storage_write_fence(v_account_id) then
    raise exception 'undo is not available for shidduch %', p_id
      using errcode = 'insufficient_privilege';
  end if;

  select s.* into v_row
  from public.shidduchim s
  where s.id = p_id
  for update;

  if not found then
    raise exception 'shidduch % not found', p_id;
  end if;

  -- Re-read the caller and authorization while holding both locks.  This is
  -- intentionally the same owner/accepted-edit-grant/halachic gate as
  -- transition_shidduch(), not a broader "can see the row" check.
  if not v_service_role then
    v_account_id := public.current_context_id();
    v_role := public.current_member_role();
    v_member_id := public.current_member_id();

    if auth.uid() is null or v_account_id is null or v_role is null
       or v_role = 'single'
       or not public.demo_storage_write_fence(v_account_id) then
      raise exception 'undo is not available for shidduch %', p_id
        using errcode = 'insufficient_privilege';
    end if;

    if v_row.account_id is distinct from v_account_id then
      if not exists (
        select 1 from public.child_grants g
        where g.status = 'accepted'
          and g.access_level = 'edit'
          and g.grantee_account_id = v_account_id
          and g.target_single_id = v_row.single_id
      ) or v_row.account_id is distinct from (
        select g.proposer_account_id
        from public.child_grants g
        where g.status = 'accepted'
          and g.access_level = 'edit'
          and g.grantee_account_id = v_account_id
          and g.target_single_id = v_row.single_id
        limit 1
      ) then
        raise exception 'undo is not available for shidduch %', p_id
          using errcode = 'insufficient_privilege';
      end if;
    end if;

    if coalesce(public.shidduch_has_known_halachic_conflict(
      v_row.single_id,
      v_row.person_gender,
      v_row.kohen_status,
      v_row.marital_status
    ), false) then
      raise exception 'undo is not available for shidduch %', p_id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- The latest history row must be this actor's still-live move.  Looking at
  -- the global latest row, rather than merely this actor's latest row, makes a
  -- move by another device or actor stale-safe as well.
  select h.* into v_latest
  from public.shidduch_stage_transitions h
  where h.shidduch_id = p_id
  order by h.id desc
  limit 1
  for update;

  if not found then
    raise exception 'undo is not available for shidduch %', p_id;
  end if;

  -- A repeated request after a completed undo is harmless and returns the
  -- already-restored row.  It never opens a second reverse transition.
  if v_latest.undo_of_id is not null then
    if v_latest.actor_member_id is not distinct from v_member_id then
      return query select * from public.shidduch_row(p_id);
      return;
    end if;
    raise exception 'undo is not available for shidduch %', p_id;
  end if;

  v_transition := v_latest;

  if v_transition.actor_member_id is distinct from v_member_id
     or v_transition.undone_at is not null
     or v_transition.created_at < clock_timestamp() - interval '15 seconds'
     or v_row.pipeline_state is distinct from v_transition.to_state
     or v_row.close_reason is distinct from v_transition.produced_close_reason then
    raise exception 'undo is not available for shidduch %', p_id;
  end if;

  insert into public.shidduch_stage_undo_context (
    transaction_id,
    shidduch_id,
    transition_id,
    actor_member_id,
    from_state,
    to_state
  ) values (
    txid_current(),
    p_id,
    v_transition.id,
    v_member_id,
    v_transition.to_state,
    v_transition.from_state
  );

  update public.shidduchim
  set pipeline_state = v_transition.from_state,
      close_reason = v_transition.previous_close_reason
  where id = p_id
    and pipeline_state = v_transition.to_state
    and close_reason is not distinct from v_transition.produced_close_reason;

  if not found then
    raise exception 'undo is not available for shidduch %', p_id;
  end if;

  update public.shidduch_stage_transitions
  set undone_at = clock_timestamp()
  where id = v_transition.id
    and undone_at is null;

  if not found then
    raise exception 'undo is not available for shidduch %', p_id;
  end if;

  delete from public.shidduch_stage_undo_context
  where transaction_id = txid_current()
    and shidduch_id = p_id;

  return query select * from public.shidduch_row(p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.account_storage_cleanup_fence(p_account_id bigint)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_lock_account_id bigint;
  v_lock_accounts bigint[];
begin
  -- Account deletion uses parent rows (singles, then shidduchim, ascending
  -- id) -> every related account's advisory fence in ascending account-id
  -- order -> every related account row in that same order. In particular,
  -- collect child-grant endpoints before taking any account row: the delete
  -- trigger takes KEY SHARE on those endpoints, so taking only the caller's
  -- row first can deadlock with an accepted-edit undo.
  select array_agg(lock_account_id order by lock_account_id)
  into v_lock_accounts
  from (
    select distinct lock_account_id
    from (
      select p_account_id as lock_account_id
      union all
      select g.proposer_account_id
      from public.child_grants g
      where g.proposer_account_id = p_account_id
         or g.grantee_account_id = p_account_id
         or g.severed_by_account_id = p_account_id
         or exists (
           select 1
           from public.singles s
           where s.id = g.target_single_id
             and s.account_id = p_account_id
         )
      union all
      select g.grantee_account_id
      from public.child_grants g
      where g.proposer_account_id = p_account_id
         or g.grantee_account_id = p_account_id
         or g.severed_by_account_id = p_account_id
         or exists (
           select 1
           from public.singles s
           where s.id = g.target_single_id
             and s.account_id = p_account_id
         )
      union all
      select g.severed_by_account_id
      from public.child_grants g
      where g.proposer_account_id = p_account_id
         or g.grantee_account_id = p_account_id
         or g.severed_by_account_id = p_account_id
         or exists (
           select 1
           from public.singles s
           where s.id = g.target_single_id
             and s.account_id = p_account_id
         )
      union all
      select s.account_id
      from public.child_grants g
      join public.singles s on s.id = g.target_single_id
      where g.proposer_account_id = p_account_id
         or g.grantee_account_id = p_account_id
         or g.severed_by_account_id = p_account_id
         or s.account_id = p_account_id
    ) endpoint_accounts
    where lock_account_id is not null
  ) ordered_accounts;

  perform 1
  from public.singles
  where account_id = p_account_id
  order by id
  for update;
  perform 1
  from public.shidduchim
  where account_id = p_account_id
  order by id
  for update;
  for v_lock_account_id in
    select unnest(coalesce(v_lock_accounts, array[]::bigint[]))
    order by 1
  loop
    perform public.account_storage_lock(v_lock_account_id);
  end loop;
  perform public.demo_lock_account_axes(v_lock_accounts, 'update');
  if not exists (select 1 from public.accounts where id = p_account_id) then
    return true;
  end if;
  return not exists (
    select 1 from public.storage_purge_queue where account_id = p_account_id
  ) and not exists (
    select 1
    from storage.objects
    where bucket_id in ('documents', 'entity-files', 'attachments')
      and (name = p_account_id::text or name like p_account_id::text || '/%')
  );
end;
$function$;

CREATE OR REPLACE FUNCTION "public"."accept_child_grant"("p_token" "text") RETURNS "public"."child_grants"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_grant public.child_grants;
  v_grantee_account_id bigint := public.current_context_id();
  v_target_account_id bigint;
  v_lock_account_id bigint;
  v_lock_accounts bigint[];
  v_grantee_kind text;
  v_member_role text;
begin
  select * into v_grant
  from public.child_grants
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');

  if not found or v_grant.status <> 'pending' or v_grant.expires_at <= now() then
    raise exception 'This child grant is invalid, expired, or has already been used.'
      using errcode = 'check_violation';
  end if;

  if v_grantee_account_id is null or not exists (
    select 1 from public.account_members am
    where am.account_id = v_grantee_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
  ) then
    raise exception 'accept_child_grant requires an active membership of the current context'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.demo_assert_registered_actor(v_grantee_account_id, auth.uid(), 'child grant acceptance');

  select kind into v_grantee_kind from public.accounts where id = v_grantee_account_id;
  if v_grantee_kind not in ('household', 'shadchanus') then
    raise exception 'a child grant can only be accepted by a household or shadchanus context'
      using errcode = 'check_violation';
  end if;

  select account_id into v_target_account_id
  from public.singles
  where id = v_grant.target_single_id
  for share;

  v_lock_accounts := array[
    v_grant.proposer_account_id,
    v_target_account_id,
    v_grantee_account_id
  ];
  for v_lock_account_id in
    select distinct account_id
    from unnest(v_lock_accounts) requested(account_id)
    where account_id is not null
    order by account_id
  loop
    perform public.account_storage_lock(v_lock_account_id);
  end loop;
  perform public.demo_lock_account_axes(v_lock_accounts, 'update');

  -- The plain read above only identifies the parent and endpoint accounts.
  -- Re-read the child row after the ordered account locks so a concurrent
  -- revoke, acceptance, or endpoint change cannot be overwritten.
  select * into v_grant
  from public.child_grants
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if not found or v_grant.status <> 'pending' or v_grant.expires_at <= now() then
    raise exception 'This child grant is invalid, expired, or has already been used.'
      using errcode = 'check_violation';
  end if;

  select account_id into v_target_account_id
  from public.singles
  where id = v_grant.target_single_id
  for share;

  if v_grantee_account_id is null or not exists (
    select 1 from public.account_members am
    where am.account_id = v_grantee_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
  ) then
    raise exception 'accept_child_grant requires an active membership of the current context'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.demo_assert_registered_actor(v_grantee_account_id, auth.uid(), 'child grant acceptance');

  select kind into v_grantee_kind from public.accounts where id = v_grantee_account_id;
  if v_grantee_kind not in ('household', 'shadchanus') then
    raise exception 'a child grant can only be accepted by a household or shadchanus context'
      using errcode = 'check_violation';
  end if;

  perform public.demo_assert_same_active_run(
    array[v_grant.proposer_account_id, v_target_account_id, v_grantee_account_id],
    'child grant acceptance'
  );

  -- The recipient may be a household owner, helper, or standalone shadchan.
  -- The grant remains scoped to the one target child in every read/write
  -- policy after acceptance.
  select role into v_member_role
  from public.account_members
  where account_id = v_grantee_account_id and user_id = auth.uid() and status = 'active';

  if v_member_role not in ('parent_admin', 'self_manager', 'helper', 'shadchan') then
    raise exception 'only an authorized household member or shadchan may accept a child grant'
      using errcode = 'insufficient_privilege';
  end if;

  update public.child_grants
  set status = 'accepted', grantee_account_id = v_grantee_account_id, accepted_at = now()
  where id = v_grant.id
  returning * into v_grant;

  return v_grant;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."create_child_grant"("p_target_single_id" bigint, "p_grantee_email" "text", "p_access_level" "text" DEFAULT 'read'::"text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_proposer_account_id bigint := public.current_context_id();
  v_proposer_kind text;
  v_token text;
  v_single public.singles;
  v_lock_account_id bigint;
  v_lock_accounts bigint[];
  v_member_role text;
begin
  -- Validated early, ahead of the authorization checks below: a malformed
  -- access_level is a caller bug, not an authorization question, and the
  -- CHECK constraint on child_grants would otherwise report it as an opaque
  -- constraint-violation instead of this clear message.
  if p_access_level not in ('read', 'comment', 'edit') then
    raise exception 'access_level must be one of read, comment, edit (got %)', p_access_level
      using errcode = 'check_violation';
  end if;

  -- Caller must be an active member of the current context with owning role
  if v_proposer_account_id is null or not exists (
    select 1 from public.account_members am
    where am.account_id = v_proposer_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'create_child_grant requires an active parent_admin or self_manager membership of the current context'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.demo_assert_registered_actor(v_proposer_account_id, auth.uid(), 'child grant creation');

  -- Current context must be a household (grants are household-to-household)
  select kind into v_proposer_kind from public.accounts where id = v_proposer_account_id;
  if v_proposer_kind <> 'household' then
    raise exception 'grants can only be proposed from a household context'
      using errcode = 'check_violation';
  end if;

  -- Target single must exist and belong to the proposer's account
  select * into v_single
  from public.singles
  where id = p_target_single_id
    and account_id = v_proposer_account_id
  for share;

  if not found then
    raise exception 'single % not found in this household', p_target_single_id
      using errcode = 'check_violation';
  end if;

  v_lock_accounts := array[v_proposer_account_id, v_single.account_id];
  for v_lock_account_id in
    select distinct account_id
    from unnest(v_lock_accounts) requested(account_id)
    where account_id is not null
    order by account_id
  loop
    perform public.account_storage_lock(v_lock_account_id);
  end loop;
  perform public.demo_lock_account_axes(v_lock_accounts, 'update');

  -- Re-read the target parent after the ordered endpoint locks.  The child
  -- grant trigger will take KEY SHARE on these same accounts during INSERT.
  select * into v_single
  from public.singles
  where id = p_target_single_id
    and account_id = v_proposer_account_id
  for share;

  if not found then
    raise exception 'single % not found in this household', p_target_single_id
      using errcode = 'check_violation';
  end if;

  -- Generate token and store hash
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.child_grants (
    proposer_account_id, target_single_id, token_hash, expires_at, access_level
  ) values (
    v_proposer_account_id, p_target_single_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '7 days',
    p_access_level
  );

  perform public.demo_register_seed_resource(
    'child_grant',
    (select id from public.child_grants
     where token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')),
    v_proposer_account_id
  );

  return v_token;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."revoke_child_grant"("p_grant_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_grant public.child_grants;
  v_actor_account_id bigint := public.current_context_id();
  v_target_account_id bigint;
  v_lock_account_id bigint;
  v_lock_accounts bigint[];
begin
  select * into v_grant from public.child_grants where id = p_grant_id;

  if not found
     or v_actor_account_id is null
     or v_actor_account_id <> v_grant.proposer_account_id
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'child grant % not found', p_grant_id;
  end if;

  select account_id into v_target_account_id
  from public.singles
  where id = v_grant.target_single_id
  for share;
  v_lock_accounts := array[
    v_grant.proposer_account_id,
    v_grant.grantee_account_id,
    v_grant.severed_by_account_id,
    v_target_account_id,
    v_actor_account_id
  ];
  for v_lock_account_id in
    select distinct account_id
    from unnest(v_lock_accounts) requested(account_id)
    where account_id is not null
    order by account_id
  loop
    perform public.account_storage_lock(v_lock_account_id);
  end loop;
  perform public.demo_lock_account_axes(v_lock_accounts, 'update');

  select * into v_grant from public.child_grants where id = p_grant_id for update;
  if not found
     or v_actor_account_id is null
     or v_actor_account_id <> v_grant.proposer_account_id
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'child grant % not found', p_grant_id;
  end if;

  if v_grant.status <> 'pending' then
    raise exception 'child grant % is not pending (status %)', p_grant_id, v_grant.status
      using errcode = 'check_violation';
  end if;

  update public.child_grants
  set status = 'revoked', revoked_at = now()
  where id = p_grant_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."sever_child_grant"("p_grant_id" bigint) RETURNS "public"."child_grants"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_grant public.child_grants;
  v_actor_account_id bigint := public.current_context_id();
  v_target_account_id bigint;
  v_lock_account_id bigint;
  v_lock_accounts bigint[];
  v_member_role text;
begin
  select * into v_grant from public.child_grants where id = p_grant_id;

  if not found
     or v_actor_account_id is null
     or v_actor_account_id not in (v_grant.proposer_account_id, v_grant.grantee_account_id)
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'child grant % not found', p_grant_id;
  end if;

  select account_id into v_target_account_id
  from public.singles
  where id = v_grant.target_single_id
  for share;
  v_lock_accounts := array[
    v_grant.proposer_account_id,
    v_grant.grantee_account_id,
    v_grant.severed_by_account_id,
    v_target_account_id,
    v_actor_account_id
  ];
  for v_lock_account_id in
    select distinct account_id
    from unnest(v_lock_accounts) requested(account_id)
    where account_id is not null
    order by account_id
  loop
    perform public.account_storage_lock(v_lock_account_id);
  end loop;
  perform public.demo_lock_account_axes(v_lock_accounts, 'update');

  select * into v_grant from public.child_grants where id = p_grant_id for update;
  if not found
     or v_actor_account_id is null
     or v_actor_account_id not in (v_grant.proposer_account_id, v_grant.grantee_account_id)
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'child grant % not found', p_grant_id;
  end if;

  if v_grant.status <> 'accepted' then
    raise exception 'child grant % is not accepted (status %)', p_grant_id, v_grant.status
      using errcode = 'check_violation';
  end if;

  update public.child_grants
  set status = 'severed', severed_at = now(), severed_by_account_id = v_actor_account_id
  where id = p_grant_id
  returning * into v_grant;

  return v_grant;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."update_child_grant_access"("p_grant_id" bigint, "p_access_level" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_grant public.child_grants;
  v_actor_account_id bigint := public.current_context_id();
  v_target_account_id bigint;
  v_lock_account_id bigint;
  v_lock_accounts bigint[];
begin
  if p_access_level not in ('read', 'comment', 'edit') then
    raise exception 'access_level must be one of read, comment, edit (got %)', p_access_level
      using errcode = 'check_violation';
  end if;

  select * into v_grant from public.child_grants where id = p_grant_id;

  if not found
     or v_actor_account_id is null
     or v_actor_account_id <> v_grant.proposer_account_id
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'child grant % not found', p_grant_id;
  end if;

  select account_id into v_target_account_id
  from public.singles
  where id = v_grant.target_single_id
  for share;
  v_lock_accounts := array[
    v_grant.proposer_account_id,
    v_grant.grantee_account_id,
    v_grant.severed_by_account_id,
    v_target_account_id,
    v_actor_account_id
  ];
  for v_lock_account_id in
    select distinct account_id
    from unnest(v_lock_accounts) requested(account_id)
    where account_id is not null
    order by account_id
  loop
    perform public.account_storage_lock(v_lock_account_id);
  end loop;
  perform public.demo_lock_account_axes(v_lock_accounts, 'update');

  select * into v_grant from public.child_grants where id = p_grant_id for update;
  if not found
     or v_actor_account_id is null
     or v_actor_account_id <> v_grant.proposer_account_id
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'child grant % not found', p_grant_id;
  end if;

  if v_grant.status <> 'accepted' then
    raise exception 'child grant % is not accepted (status %)', p_grant_id, v_grant.status
      using errcode = 'check_violation';
  end if;

  update public.child_grants
  set access_level = p_access_level
  where id = p_grant_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."regrant_child_grant"("p_grant_id" bigint) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_old_grant public.child_grants;
  v_new_grant public.child_grants;
  v_actor_account_id bigint := public.current_context_id();
  v_target_account_id bigint;
  v_lock_account_id bigint;
  v_lock_accounts bigint[];
  v_run_id bigint;
  v_token text;
begin
  select * into v_old_grant from public.child_grants where id = p_grant_id;
  select account_id into v_target_account_id
  from public.singles where id = v_old_grant.target_single_id for share;
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

  v_lock_accounts := array[
    v_old_grant.proposer_account_id,
    v_old_grant.grantee_account_id,
    v_old_grant.severed_by_account_id,
    v_target_account_id,
    v_actor_account_id
  ];
  for v_lock_account_id in
    select distinct account_id
    from unnest(v_lock_accounts) requested(account_id)
    where account_id is not null
    order by account_id
  loop
    perform public.account_storage_lock(v_lock_account_id);
  end loop;
  perform public.demo_lock_account_axes(v_lock_accounts, 'update');

  select * into v_old_grant from public.child_grants where id = p_grant_id for update;
  select account_id into v_target_account_id
  from public.singles where id = v_old_grant.target_single_id for share;
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
$$;

revoke all on function public.undo_shidduch(bigint) from public, anon;
grant execute on function public.undo_shidduch(bigint) to authenticated;
grant execute on function public.undo_shidduch(bigint) to service_role;
