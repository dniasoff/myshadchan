-- Restore the authenticated account-deletion RPC used by the privacy UI.
-- Keep this body in sync with supabase/schemas/02_functions.sql.
CREATE OR REPLACE FUNCTION public.delete_account_data(
  p_account_id bigint,
  p_requested_by_auth_uid uuid,
  p_include_export boolean DEFAULT false
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_context_id bigint;
  v_demo boolean;
  v_export jsonb;
  v_deleted_account_id bigint;
begin
  if v_user_id is null then
    raise exception 'delete_account_data requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if p_requested_by_auth_uid is distinct from v_user_id then
    raise exception 'delete_account_data caller mismatch'
      using errcode = 'insufficient_privilege';
  end if;

  v_context_id := public.current_context_id();
  if v_context_id is distinct from p_account_id then
    raise exception 'delete_account_data account mismatch'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1
    from public.account_members am
    where am.account_id = p_account_id
      and am.user_id = v_user_id
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'only an active account owner may delete account data'
      using errcode = 'insufficient_privilege';
  end if;

  select a.demo into v_demo
  from public.accounts a
  where a.id = p_account_id
  for update;
  if not found then
    raise exception 'account not found for deletion: %', p_account_id
      using errcode = 'no_data';
  end if;
  if v_demo then
    raise exception 'demo accounts must be cleared through the demo lifecycle'
      using errcode = 'check_violation';
  end if;

  if p_include_export then
    v_export := public.export_full_account_bundle();
  end if;

  if exists (
    select 1
    from storage.objects
    where bucket_id in ('documents', 'entity-files', 'attachments')
      and (name = p_account_id::text or name like p_account_id::text || '/%')
  ) then
    raise exception 'account has storage objects; remove them through the Storage API before deletion'
      using errcode = 'check_violation';
  end if;

  delete from public.child_grants
  where proposer_account_id = p_account_id
     or grantee_account_id = p_account_id;

  delete from public.connection_invites
  where inviter_account_id = p_account_id
     or accepted_by_account_id = p_account_id;

  delete from public.connections
  where household_account_id = p_account_id
     or shadchanus_account_id = p_account_id;

  delete from public.stripe_events
  where account_id = p_account_id;

  delete from public.accounts
  where id = p_account_id
  returning id into v_deleted_account_id;

  if not found then
    raise exception 'account disappeared during deletion: %', p_account_id
      using errcode = 'serialization_failure';
  end if;

  return jsonb_build_object(
    'status', 'completed',
    'deleted_account_id', v_deleted_account_id,
    'export', v_export
  );
end;
$$;

revoke all on function public.delete_account_data(bigint, uuid, boolean) from public, anon;
grant execute on function public.delete_account_data(bigint, uuid, boolean) to authenticated;
grant execute on function public.delete_account_data(bigint, uuid, boolean) to service_role;
