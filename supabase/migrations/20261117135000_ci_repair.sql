-- CI repair for the shidduch archive/delete lifecycle.
-- Keep this additive: deployed history already contains 20261117120441.

set check_function_bodies = off;

-- Tombstones are permanent fences and must survive account-row cleanup. A
-- direct or cascading delete can write one while the account is disappearing;
-- an account FK would reject that write or erase the fence afterwards.
alter table public.deleted_shidduch_tombstones
  drop constraint if exists deleted_shidduch_tombstones_account_id_fkey;
alter table public.deleted_shidduch_tombstones force row level security;
alter table public.storage_purge_queue force row level security;

-- Forward migrations created these views with CREATE OR REPLACE, which does
-- not preserve the reloption. Restore the invoker boundary explicitly.
alter view public.reference_links_summary set (security_invoker = on);
alter view public.references_summary set (security_invoker = on);
alter view public.shadchan_stats set (security_invoker = on);
alter view public.shidduchim_catch_summary set (security_invoker = on);
alter view public.shidduchim_summary set (security_invoker = on);
alter view public.singles_summary set (security_invoker = on);

-- These two RPCs inspect the shidduch parent before writing a resume catalog
-- row. They must retain their empty search_path and run with the definer's
-- catalog privileges because authenticated no longer has base-table SELECT.
alter function public.add_resume_file(text, text, text, bigint, bigint, bigint, bigint, text)
  security definer;
alter function public.add_resume_file(text, text, text, bigint, bigint, bigint, bigint, text)
  set search_path = '';
alter function public.add_resume_photo(text, bigint, bigint, text)
  security definer;
alter function public.add_resume_photo(text, bigint, bigint, text)
  set search_path = '';

-- Public shidduch writes are RPC-only. Keep the column-level read contract in
-- the forward history, including the physical archived_at tail column.
revoke insert, delete, update on table public.shidduchim from authenticated;
grant update (index) on table public.shidduchim to authenticated;
grant select (
  id, account_id, created_at, single_id, shadchan_id, name_en, name_he,
  seminary_en, seminary_he, shul_en, shul_he, location_en, location_he,
  age, height, pipeline_state, first_suggested_by, first_suggested_at,
  redt_date, origin, owner_member_id, visibility, index, background, dob,
  existing_children_note, father_en, father_he, marital_status, mother_en,
  mother_he, kohen_status, person_gender, archived_at
) on table public.shidduchim to authenticated;
revoke all on sequence public.shidduchim_id_seq from authenticated;

create or replace function public.shidduch_read_in_progress(p_id bigint)
returns boolean
language plpgsql stable security definer
set search_path to ''
as $function$
declare
  v_account_id bigint := public.current_context_id();
  v_parent_id bigint;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager') then
    return false;
  end if;
  select s.id into v_parent_id
  from public.shidduchim s
  where s.id = p_id and s.account_id = v_account_id
  for share;
  if v_parent_id is null then
    return false;
  end if;
  return exists (
    select 1
    from public.ai_reread_attempts a
    join public.resumes r on r.id = a.resume_id
    where r.shidduchim_id = p_id
      and r.account_id = v_account_id
      and a.status = 'in_progress'
      and a.lease_expires_at > now()
  );
end;
$function$;

revoke all on function public.shidduch_read_in_progress(bigint) from public, anon;
grant execute on function public.shidduch_read_in_progress(bigint) to authenticated, service_role;

-- Match the declarative ACL snapshot for every lifecycle helper. `PUBLIC` is
-- explicit here so a future default-privilege change cannot make an internal
-- definer callable by an untrusted role.
revoke all on function public.archive_shidduch(bigint) from public, anon;
grant execute on function public.archive_shidduch(bigint) to authenticated, service_role;
revoke all on function public.restore_shidduch(bigint) from public, anon;
grant execute on function public.restore_shidduch(bigint) to authenticated, service_role;
revoke all on function public.delete_shidduch(bigint) from public, anon;
grant execute on function public.delete_shidduch(bigint) to authenticated, service_role;
revoke all on function public.claim_shidduch_storage_purge() from public, anon;
grant execute on function public.claim_shidduch_storage_purge() to authenticated, service_role;
revoke all on function public.authorize_shidduch_storage_removal(text, text, text, text) from public, anon;
grant execute on function public.authorize_shidduch_storage_removal(text, text, text, text) to authenticated, service_role;
revoke all on function public.ack_shidduch_storage_purge(text, text, text) from public, anon;
grant execute on function public.ack_shidduch_storage_purge(text, text, text) to authenticated, service_role;
revoke all on function public.storage_account_write_allowed(bigint) from public, anon;
grant execute on function public.storage_account_write_allowed(bigint) to authenticated, service_role;
revoke all on function public.shidduch_storage_path_allowed(text, text) from public, anon;
grant execute on function public.shidduch_storage_path_allowed(text, text) to authenticated, service_role;
revoke all on function public.storage_purge_path_referenced(text, text) from public, anon, authenticated;
revoke all on function public.storage_purge_queue_object(bigint, text, text) from public, anon, authenticated;
revoke all on function public.storage_purge_queue_quarantine(bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.account_storage_cleanup_fence(bigint) from public, anon, authenticated;
