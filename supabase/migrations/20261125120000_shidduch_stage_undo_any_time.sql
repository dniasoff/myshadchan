-- 9ys follow-up: stage history can be reversed one step at a time at any
-- time. The forward history remains append-only; every reverse is linked to
-- the forward row it consumed through undo_of_id.

CREATE OR REPLACE FUNCTION "public"."undo_shidduch"("p_id" bigint) RETURNS SETOF "public"."shidduchim"
    SECURITY DEFINER
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_role text;
  v_member_id bigint;
  v_service_role boolean;
  v_shidduch_account_id bigint;
  v_shidduch_single_id bigint;
  v_lock_account_id bigint;
  v_lock_accounts bigint[];
  v_row public.shidduchim;
  v_transition public.shidduch_stage_transitions;
  v_latest public.shidduch_stage_transitions;
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
  -- grant endpoints for its target single) in ascending id order. The
  -- advisory fences and account rows are acquired in separate ordered passes,
  -- matching account_storage_cleanup_fence() and preventing an
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

  select array_agg(lock_account_id order by lock_account_id)
  into v_lock_accounts
  from (
    select distinct lock_account_id
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
  ) ordered_accounts;

  for v_lock_account_id in
    select unnest(coalesce(v_lock_accounts, array[]::bigint[]))
    order by 1
  loop
    perform public.account_storage_lock(v_lock_account_id);
  end loop;
  perform public.demo_lock_account_axes(v_lock_accounts, 'update');

  -- demo_storage_write_fence() takes the caller account row FOR KEY SHARE. It
  -- runs after the parent-first locks, advisory fences, and account rows, so
  -- it cannot invert the deterministic account order.
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

  -- Reverse the newest forward transition that has not already been undone.
  -- The actor is intentionally not part of this selection: every person who
  -- can move this suggestion today can correct its latest step.  Undo rows
  -- are linked by undo_of_id and are excluded, so repeated calls walk one
  -- step at a time through the preserved forward history.
  select h.* into v_latest
  from public.shidduch_stage_transitions h
  where h.shidduch_id = p_id
    and h.undone_at is null
    and h.undo_of_id is null
  order by h.id desc
  limit 1
  for update;

  if not found then
    return query select * from public.shidduch_row(p_id);
    return;
  end if;

  v_transition := v_latest;

  if v_row.pipeline_state is distinct from v_transition.to_state
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
$$;

-- Read-only companion for the Overview action. It repeats the same
-- owner/accepted-edit-grant/halachic gate as transition_shidduch(), while
-- keeping the account-owned history table private from accepted child
-- accounts. An empty result means there is no step left to reverse.
CREATE OR REPLACE FUNCTION "public"."latest_reversible_shidduch_stage"("p_id" bigint)
RETURNS TABLE("from_state" "public"."pipeline_state", "to_state" "public"."pipeline_state")
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET "search_path" TO ''
AS $$
declare
  v_account_id bigint := public.current_context_id();
  v_role text := public.current_member_role();
  v_service_role boolean := coalesce(auth.role(), '') = 'service_role';
  v_row public.shidduchim;
begin
  select s.* into v_row
  from public.shidduchim s
  where s.id = p_id;

  if not found then
    return;
  end if;

  if not v_service_role then
    if auth.uid() is null or v_account_id is null or v_role is null
       or v_role = 'single'
       or (
         v_row.account_id is distinct from v_account_id
         and (
           not exists (
             select 1 from public.child_grants g
             where g.status = 'accepted'
               and g.access_level = 'edit'
               and g.grantee_account_id = v_account_id
               and g.target_single_id = v_row.single_id
           )
           or v_row.account_id is distinct from (
             select g.proposer_account_id
             from public.child_grants g
             where g.status = 'accepted'
               and g.access_level = 'edit'
               and g.grantee_account_id = v_account_id
               and g.target_single_id = v_row.single_id
             limit 1
           )
         )
       )
       or coalesce(public.shidduch_has_known_halachic_conflict(
         v_row.single_id,
         v_row.person_gender,
         v_row.kohen_status,
         v_row.marital_status
       ), false) then
      return;
    end if;
  end if;

  return query
  select h.from_state, h.to_state
  from public.shidduch_stage_transitions h
  where h.shidduch_id = p_id
    and h.undone_at is null
    and h.undo_of_id is null
    and v_row.pipeline_state = h.to_state
    and v_row.close_reason is not distinct from h.produced_close_reason
  order by h.id desc
  limit 1;
end;
$$;

revoke all on function public.latest_reversible_shidduch_stage(bigint) from public, anon;
grant execute on function public.latest_reversible_shidduch_stage(bigint) to authenticated;
grant execute on function public.latest_reversible_shidduch_stage(bigint) to service_role;
