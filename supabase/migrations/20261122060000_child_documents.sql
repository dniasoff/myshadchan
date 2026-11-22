-- Child Documents: named paper slots, soft-delete/Undo metadata, and
-- account-scoped RPCs. This is additive: legacy entity_files remain NULL-slot
-- rows and stay visible through the Files tab's Older files section.

set check_function_bodies = off;

alter table public.entity_files
  add column if not exists slot text,
  add column if not exists deleted_at timestamptz,
  add column if not exists delete_token text,
  add column if not exists delete_undo_until timestamptz;

drop policy if exists "Entity files scoped to account" on public.entity_files;
drop policy if exists "Entity files readable within account" on public.entity_files;
drop policy if exists "Entity files insertable within account" on public.entity_files;
drop policy if exists "Entity files visibility updates within account" on public.entity_files;
drop policy if exists "Legacy entity files deletable within account" on public.entity_files;
create policy "Entity files readable within account" on public.entity_files
  for select to authenticated
  using (
    account_id = public.current_context_id()
    and public.current_member_role() <> 'single'
  );
create policy "Entity files insertable within account" on public.entity_files
  for insert to authenticated
  with check (
    account_id = public.current_context_id()
    and public.current_member_role() <> 'single'
  );
create policy "Entity files visibility updates within account" on public.entity_files
  for update to authenticated
  using (
    account_id = public.current_context_id()
    and public.current_member_role() <> 'single'
  )
  with check (
    account_id = public.current_context_id()
    and public.current_member_role() <> 'single'
  );
create policy "Legacy entity files deletable within account" on public.entity_files
  for delete to authenticated
  using (
    account_id = public.current_context_id()
    and public.current_member_role() <> 'single'
    and target_type <> 'single'
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'entity_files_slot_check'
      and conrelid = 'public.entity_files'::regclass
  ) then
    alter table public.entity_files
      add constraint entity_files_slot_check
      check (slot is null or slot in ('paper_1', 'paper_2')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'entity_files_slot_target_check'
      and conrelid = 'public.entity_files'::regclass
  ) then
    alter table public.entity_files
      add constraint entity_files_slot_target_check
      check (slot is null or target_type = 'single') not valid;
  end if;
end;
$$;

alter table public.entity_files validate constraint entity_files_slot_check;
alter table public.entity_files validate constraint entity_files_slot_target_check;

CREATE OR REPLACE FUNCTION public.shidduch_storage_path_allowed(
  p_bucket text,
  p_name text
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_shidduch_id bigint;
begin
  if v_account_id is null or p_bucket is null or p_name is null then
    return false;
  end if;

  if p_bucket = 'documents'
     and p_name ~ ('^' || v_account_id::text || '/resumes/single-[0-9]+/[^/]+$') then
    return true;
  end if;
  if p_bucket = 'documents'
     and p_name ~ ('^' || v_account_id::text || '/photos/(shared|private_parent)/single-[0-9]+/[^/]+$') then
    return true;
  end if;
  if p_bucket = 'entity-files'
     and p_name ~ '(^|/)(\.\.?)(/|$)' then
    return false;
  end if;
  if p_bucket = 'entity-files'
     and p_name ~ ('^' || v_account_id::text
       || '/single/[0-9]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|doc|docx|jpe?g|png)$') then
    return true;
  end if;
  if p_bucket = 'entity-files'
     and p_name ~ ('^' || v_account_id::text || '/single/[0-9]+/[^/]+$') then
    return exists (
      select 1
      from public.entity_files ef
      where ef.account_id = v_account_id
        and ef.target_type = 'single'
        and ef.target_id = split_part(p_name, '/', 3)::bigint
        and ef.storage_path = p_name
        and ef.slot is null
    );
  end if;
  if p_bucket = 'entity-files'
     and p_name ~ ('^' || v_account_id::text || '/(reference|shadchan|connection)/[0-9]+/[^/]+$') then
    return true;
  end if;

  if p_bucket = 'documents'
     and p_name ~ ('^' || v_account_id::text || '/resumes/[0-9]+/[^/]+$') then
    v_shidduch_id := split_part(p_name, '/', 3)::bigint;
  elsif p_bucket = 'documents'
     and p_name ~ ('^' || v_account_id::text || '/photos/(shared|private_parent)/[0-9]+/[^/]+$') then
    v_shidduch_id := split_part(p_name, '/', 4)::bigint;
  elsif p_bucket = 'entity-files'
     and p_name ~ ('^' || v_account_id::text || '/shidduch/[0-9]+/[^/]+$') then
    v_shidduch_id := split_part(p_name, '/', 3)::bigint;
  else
    return false;
  end if;

  return not exists (
    select 1
    from public.deleted_shidduch_tombstones t
    where t.account_id = v_account_id and t.shidduch_id = v_shidduch_id
  );
end;
$function$;

create unique index if not exists entity_files_single_slot_active_key
  on public.entity_files (account_id, target_type, target_id, slot)
  where target_type = 'single' and slot is not null and deleted_at is null;

create or replace view public.entity_files_summary
with (security_invoker = on)
as
select ef.id,
       ef.account_id,
       ef.created_at,
       ef.target_type,
       ef.target_id,
       ef.storage_path,
       ef.file_name,
       ef.mime_type,
       ef.size_bytes,
       ef.visibility,
       ef.uploaded_by_member_id,
       nullif(btrim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')), '') as uploaded_by_name,
       ef.slot,
       ef.deleted_at
from public.entity_files ef
left join public.account_members am on am.id = ef.uploaded_by_member_id
left join public.members m on m.user_id = am.user_id
where ef.deleted_at is null;

drop trigger if exists validate_entity_files_shidduch_target on public.entity_files;
create trigger validate_entity_files_shidduch_target
before insert or update of account_id, target_type, target_id, storage_path,
  file_name, mime_type, size_bytes, slot
on public.entity_files
for each row execute function public.entity_files_target_guard();

CREATE OR REPLACE FUNCTION public.max_child_documents()
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO ''
AS $function$
  select 4;
$function$;

CREATE OR REPLACE FUNCTION public.entity_files_target_guard()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_context_id bigint := public.current_context_id();
  v_account_id bigint := coalesce(v_context_id, new.account_id);
  v_parent_id bigint;
  v_mime_type text := lower(coalesce(new.mime_type, ''));
  v_legacy_update boolean := false;
begin
  if v_account_id is null or new.account_id is distinct from v_account_id then
    raise exception 'entity file account context mismatch'
      using errcode = 'insufficient_privilege';
  end if;
  if new.storage_path is null
     or new.storage_path !~ ('^' || v_account_id::text || '/' || new.target_type || '/' || new.target_id::text || '/[^/]+$')
     or new.storage_path ~ '(^|/)(\.\.?)(/|$)'
     or new.storage_path ~ '[*?]' then
    raise exception 'entity file storage path does not match its target'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    v_legacy_update := old.target_type = 'single'
      and old.slot is null
      and new.target_type = 'single'
      and new.slot is null
      and new.account_id = old.account_id
      and new.target_id = old.target_id
      and new.storage_path = old.storage_path;
  end if;
  if new.target_type = 'single' and not v_legacy_update then
    if new.slot is null then
      raise exception 'single document uploads require a paper slot'
        using errcode = 'check_violation';
    end if;
    if new.size_bytes < 1 or new.size_bytes > 8 * 1024 * 1024 then
      raise exception 'single document size must be between 1 byte and 8 MiB'
        using errcode = 'check_violation';
    end if;
    if v_mime_type not in (
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png'
    ) then
      raise exception 'single document MIME type is not allowed'
        using errcode = 'check_violation';
    end if;
    if not (
      (v_mime_type = 'application/pdf' and lower(new.file_name) ~ '\.pdf$')
      or (v_mime_type = 'application/msword' and lower(new.file_name) ~ '\.doc$')
      or (v_mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          and lower(new.file_name) ~ '\.docx$')
      or (v_mime_type = 'image/jpeg' and lower(new.file_name) ~ '\.jpe?g$')
      or (v_mime_type = 'image/png' and lower(new.file_name) ~ '\.png$')
    ) then
      raise exception 'single document file extension does not match MIME type'
        using errcode = 'check_violation';
    end if;
    if new.storage_path !~ ('^' || v_account_id::text || '/single/'
       || new.target_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|doc|docx|jpe?g|png)$') then
      raise exception 'single document storage path must use an opaque UUID key'
        using errcode = 'check_violation';
    end if;
    if not (
      (v_mime_type = 'application/pdf' and new.storage_path ~ '\.pdf$')
      or (v_mime_type = 'application/msword' and new.storage_path ~ '\.doc$')
      or (v_mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          and new.storage_path ~ '\.docx$')
      or (v_mime_type = 'image/jpeg' and new.storage_path ~ '\.jpe?g$')
      or (v_mime_type = 'image/png' and new.storage_path ~ '\.png$')
    ) then
      raise exception 'single document storage extension does not match MIME type'
        using errcode = 'check_violation';
    end if;
    select s.id into v_parent_id
    from public.singles s
    where s.id = new.target_id and s.account_id = v_account_id
    for update;
    perform public.account_storage_lock(v_account_id);
    if v_parent_id is null then
      raise exception 'entity file single target is missing'
        using errcode = 'foreign_key_violation';
    end if;
    if exists (
      select 1
      from public.entity_files ef
      where ef.account_id = v_account_id
        and ef.target_type = 'single'
        and ef.target_id = new.target_id
        and ef.slot is not null
        and (
          ef.deleted_at is null
          or ef.delete_undo_until is not null and ef.delete_undo_until >= now()
        )
        and ef.slot = new.slot
        and (tg_op <> 'UPDATE' or ef.id <> new.id)
    ) then
      raise exception 'single paper slot is already in use'
        using errcode = 'unique_violation';
    end if;
    if (
      select count(*)
      from public.entity_files ef
      where ef.account_id = v_account_id
        and ef.target_type = 'single'
        and ef.target_id = new.target_id
        and ef.slot is not null
        and (
          ef.deleted_at is null
          or ef.delete_undo_until is not null and ef.delete_undo_until >= now()
        )
        and (tg_op = 'UPDATE' and ef.id <> new.id or tg_op <> 'UPDATE')
    ) >= public.max_child_documents() - 2 then
      raise exception 'child document limit reached'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.target_type = 'shidduch' then
    select s.id into v_parent_id
    from public.shidduchim s
    where s.id = new.target_id and s.account_id = v_account_id
    for update;
    perform public.account_storage_lock(v_account_id);
    if v_parent_id is null then
      raise exception 'entity file shidduch target is missing'
        using errcode = 'foreign_key_violation';
    end if;
    if exists (
      select 1 from public.deleted_shidduch_tombstones t
      where t.account_id = v_account_id and t.shidduch_id = new.target_id
    ) then
      raise exception 'entity file shidduch target is deleted'
        using errcode = 'foreign_key_violation';
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.soft_delete_entity_file(p_entity_file_id bigint)
RETURNS TABLE(id bigint, delete_token text, undo_until timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_target_id bigint;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager', 'helper', 'shadchan') then
    raise exception 'entity file changes are not available to this role'
      using errcode = 'insufficient_privilege';
  end if;
  select ef.target_id into v_target_id
  from public.entity_files ef
  where ef.id = p_entity_file_id and ef.account_id = v_account_id
    and ef.target_type = 'single';
  if v_target_id is null then
    raise exception 'entity file not found' using errcode = 'P0002';
  end if;
  perform 1 from public.singles s where s.id = v_target_id and s.account_id = v_account_id for update;
  if not found then
    raise exception 'entity file single target is missing' using errcode = 'P0002';
  end if;
  perform public.account_storage_lock(v_account_id);
  perform 1 from public.entity_files ef where ef.id = p_entity_file_id and ef.account_id = v_account_id for update;
  return query
  update public.entity_files ef
  set deleted_at = now(), delete_token = v_token,
      delete_undo_until = now() + interval '10 seconds'
  where ef.id = p_entity_file_id and ef.account_id = v_account_id
    and ef.deleted_at is null
  returning ef.id, ef.delete_token, ef.delete_undo_until;
end;
$function$;

CREATE OR REPLACE FUNCTION public.undo_entity_file_delete(
  p_entity_file_id bigint,
  p_delete_token text
) RETURNS SETOF public.entity_files
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_target_id bigint;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager', 'helper', 'shadchan') then
    raise exception 'entity file changes are not available to this role'
      using errcode = 'insufficient_privilege';
  end if;
  select ef.target_id into v_target_id
  from public.entity_files ef
  where ef.id = p_entity_file_id and ef.account_id = v_account_id
    and ef.target_type = 'single';
  perform 1 from public.singles s where s.id = v_target_id and s.account_id = v_account_id for update;
  if not found then
    raise exception 'entity file single target is missing' using errcode = 'P0002';
  end if;
  perform public.account_storage_lock(v_account_id);
  return query
  update public.entity_files ef
  set deleted_at = null, delete_token = null, delete_undo_until = null
  where ef.id = p_entity_file_id and ef.account_id = v_account_id
    and ef.delete_token = p_delete_token
    and ef.delete_undo_until >= now()
  returning ef.*;
  if not found then
    raise exception 'entity file delete can no longer be undone' using errcode = 'P0002';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_entity_file_delete(
  p_entity_file_id bigint,
  p_delete_token text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_target_id bigint;
  v_path text;
  v_deleted public.entity_files;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager', 'helper', 'shadchan') then
    raise exception 'entity file changes are not available to this role'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (
    select 1
    from public.storage_purge_queue q
    where q.account_id = v_account_id
      and q.kind = 'object'
      and q.bucket = 'entity-files'
      and q.delete_token = p_delete_token
  ) then
    return;
  end if;
  select ef.target_id, ef.storage_path into v_target_id, v_path
  from public.entity_files ef
  where ef.id = p_entity_file_id and ef.account_id = v_account_id
    and ef.target_type = 'single';
  perform 1 from public.singles s where s.id = v_target_id and s.account_id = v_account_id for update;
  if not found then
    raise exception 'entity file single target is missing' using errcode = 'P0002';
  end if;
  perform public.account_storage_lock(v_account_id);
  perform 1 from public.entity_files ef where ef.id = p_entity_file_id and ef.account_id = v_account_id for update;
  if v_path is null then
    raise exception 'entity file not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.entity_files ef
    where ef.id = p_entity_file_id and ef.account_id = v_account_id
      and ef.delete_token = p_delete_token and ef.delete_undo_until < now()
  ) then
    raise exception 'entity file delete is still undoable or has changed' using errcode = 'P0002';
  end if;
  delete from public.entity_files
  where id = p_entity_file_id and account_id = v_account_id
  returning * into v_deleted;
  insert into public.storage_purge_queue (
    account_id, kind, bucket, storage_path, delete_token
  ) values (
    v_account_id, 'object', 'entity-files', v_deleted.storage_path, p_delete_token
  )
  on conflict (account_id, kind, bucket, storage_path) where resume_id is null
  do update set delete_token = coalesce(public.storage_purge_queue.delete_token, excluded.delete_token),
                updated_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_expired_entity_file_deletes()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_candidate record;
  v_deleted public.entity_files;
  v_count integer := 0;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager', 'helper', 'shadchan') then
    raise exception 'entity file changes are not available to this role'
      using errcode = 'insufficient_privilege';
  end if;
  for v_candidate in
    select ef.id, ef.target_id, ef.delete_token
    from public.entity_files ef
    where ef.account_id = v_account_id
      and ef.target_type = 'single'
      and ef.deleted_at is not null
      and ef.delete_token is not null
      and ef.delete_undo_until < now()
    order by ef.target_id, ef.id
  loop
    perform 1
    from public.singles s
    where s.id = v_candidate.target_id and s.account_id = v_account_id
    for update;
    if not found then
      continue;
    end if;
    perform public.account_storage_lock(v_account_id);
    delete from public.entity_files ef
    where ef.id = v_candidate.id
      and ef.account_id = v_account_id
      and ef.delete_token = v_candidate.delete_token
      and ef.delete_undo_until < now()
    returning ef.* into v_deleted;
    if not found then
      continue;
    end if;
    insert into public.storage_purge_queue (
      account_id, kind, bucket, storage_path, delete_token
    ) values (
      v_account_id, 'object', 'entity-files', v_deleted.storage_path,
      v_deleted.delete_token
    )
    on conflict (account_id, kind, bucket, storage_path) where resume_id is null
    do update set delete_token = coalesce(public.storage_purge_queue.delete_token, excluded.delete_token),
                  updated_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.replace_entity_file(
  p_old_id bigint,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_slot text,
  p_visibility text
) RETURNS SETOF public.entity_files
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_target_id bigint;
  v_target_type text;
  v_old public.entity_files;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager', 'helper', 'shadchan') then
    raise exception 'entity file changes are not available to this role'
      using errcode = 'insufficient_privilege';
  end if;
  select ef.target_type, ef.target_id into v_target_type, v_target_id
  from public.entity_files ef
  where ef.id = p_old_id and ef.account_id = v_account_id
  ;
  if v_target_type is null or v_target_type <> 'single' then
    raise exception 'single paper not found' using errcode = 'P0002';
  end if;
  perform 1 from public.singles s where s.id = v_target_id and s.account_id = v_account_id for update;
  if not found then
    raise exception 'entity file single target is missing' using errcode = 'P0002';
  end if;
  perform public.account_storage_lock(v_account_id);
  select ef.* into v_old from public.entity_files ef
  where ef.id = p_old_id and ef.account_id = v_account_id for update;
  if not found then
    raise exception 'single paper not found' using errcode = 'P0002';
  end if;
  if v_old.deleted_at is not null then
    raise exception 'The file is already being deleted.'
      using errcode = 'check_violation';
  end if;
  if p_slot not in ('paper_1', 'paper_2') or p_size_bytes < 1 or p_size_bytes > 8 * 1024 * 1024
     or lower(coalesce(p_mime_type, '')) not in ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png')
     or not (
       (lower(p_mime_type) = 'application/pdf' and lower(p_file_name) ~ '\.pdf$')
       or (lower(p_mime_type) = 'application/msword' and lower(p_file_name) ~ '\.doc$')
       or (lower(p_mime_type) = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
           and lower(p_file_name) ~ '\.docx$')
       or (lower(p_mime_type) = 'image/jpeg' and lower(p_file_name) ~ '\.jpe?g$')
       or (lower(p_mime_type) = 'image/png' and lower(p_file_name) ~ '\.png$')
     ) then
    raise exception 'file must be a PDF, Word, JPEG, or PNG no larger than 8 MiB' using errcode = 'check_violation';
  end if;
  delete from public.entity_files where id = v_old.id;
  return query
  insert into public.entity_files (
    account_id, target_type, target_id, storage_path, file_name, mime_type,
    size_bytes, visibility, slot
  ) values (
    v_account_id, 'single', v_target_id, p_storage_path, p_file_name,
    p_mime_type, p_size_bytes, coalesce(p_visibility, 'shared'), p_slot
  ) returning *;
  perform public.storage_purge_queue_object(v_account_id, 'entity-files', v_old.storage_path);
end;
$function$;

-- Direct child uploads use the named-document allow-list. Inbox attachment
-- provenance keeps its established image handling and is deliberately not
-- tightened here.
CREATE OR REPLACE FUNCTION public.add_resume_file(
  p_path text,
  p_filename text,
  p_mime_type text,
  p_size bigint,
  p_shidduchim_id bigint DEFAULT NULL,
  p_single_id bigint DEFAULT NULL,
  p_source_inbox_item_id bigint DEFAULT NULL,
  p_source_inbox_attachment_path text DEFAULT NULL
) RETURNS SETOF public.resumes
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_parent_id bigint;
  v_entry jsonb;
  v_source_attachment jsonb;
begin
  v_account_id := public.current_context_id();
  if public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'new row violates row-level security policy for table "resumes"'
      using errcode = 'insufficient_privilege';
  end if;

  -- Global storage-writer order is parent shidduch -> advisory fence ->
  -- resume/source rows. Parent rows are locked before the shared fence.
  if p_shidduchim_id is not null then
    select s.id into v_parent_id
    from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
    for update;
    perform public.account_storage_lock(v_account_id);
    if v_parent_id is null then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;
    if exists (
      select 1 from public.deleted_shidduch_tombstones t
      where t.account_id = v_account_id and t.shidduch_id = p_shidduchim_id
    ) then
      raise exception 'shidduch % is deleted', p_shidduchim_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  if (p_shidduchim_id is not null) = (p_single_id is not null) then
    raise exception 'exactly one of p_shidduchim_id/p_single_id must be provided';
  end if;

  if p_size < 0 then
    raise exception 'resume file size must not be negative';
  end if;
  if p_source_inbox_item_id is null and (
       p_size > 8 * 1024 * 1024
       or lower(coalesce(p_mime_type, '')) not in (
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'image/jpeg',
         'image/png'
       )
       or lower(coalesce(p_filename, '')) !~ '\.(pdf|doc|docx|jpe?g|png)$'
     ) then
    raise exception 'resume file must be a PDF, Word, JPEG, or PNG no larger than 8 MiB'
      using errcode = 'check_violation';
  end if;

  if (p_source_inbox_item_id is null) <> (p_source_inbox_attachment_path is null) then
    raise exception 'source Inbox provenance must be provided together';
  end if;

  if p_source_inbox_item_id is not null then
    if public.current_member_role() is null or public.current_member_role() = 'single' then
      raise exception 'resume attachment is not available to this role';
    end if;

    select attachment
      into v_source_attachment
      from public.inbox_items i,
           jsonb_array_elements(coalesce(i.attachments, '[]'::jsonb)) attachment
     where i.id = p_source_inbox_item_id
       and i.account_id = v_account_id
       and i.status = 'unresolved'
       and attachment->>'path' = p_source_inbox_attachment_path
     limit 1
     for share;

    if v_source_attachment is null then
      raise exception 'Inbox attachment not found';
    end if;

    if p_source_inbox_attachment_path is null
       or p_source_inbox_attachment_path not like v_account_id::text || '/%' then
      raise exception 'Inbox attachment is outside the current account';
    end if;

    if nullif(trim(coalesce(v_source_attachment->>'type', '')), '') is not null
       and lower(v_source_attachment->>'type') not in (
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       )
       and lower(v_source_attachment->>'type') not like 'image/%' then
      raise exception 'Inbox attachment type is not eligible for a resume';
    end if;

    if nullif(trim(coalesce(v_source_attachment->>'type', '')), '') is null
       and lower(coalesce(v_source_attachment->>'title', '')) !~ '\.(pdf|doc|docx|gif|heic|heif|jpe?g|png|webp)$' then
      raise exception 'Inbox attachment type is not eligible for a resume';
    end if;

    if p_path is null or p_path not like v_account_id::text || '/resumes/%' then
      raise exception 'resume destination is outside the current account';
    end if;
  end if;

  if p_shidduchim_id is not null then
    if not exists (
      select 1 from public.shidduchim s
      where s.id = p_shidduchim_id and s.account_id = v_account_id
    ) then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;
  else
    if not exists (
      select 1 from public.singles s
      where s.id = p_single_id and s.account_id = v_account_id
    ) then
      raise exception 'single % not found in current account', p_single_id;
    end if;
  end if;

  v_entry := jsonb_build_object(
    'path', p_path,
    'filename', coalesce(v_source_attachment->>'title', p_filename),
    'uploaded_at', now(),
    'uploaded_by', public.current_member_id(),
    'mime_type', coalesce(v_source_attachment->>'type', p_mime_type),
    'size', p_size
  );

  if p_source_inbox_item_id is not null then
    v_entry := v_entry || jsonb_build_object(
      'source_inbox_item_id', p_source_inbox_item_id,
      'source_inbox_attachment_path', p_source_inbox_attachment_path
    );
  end if;

  if p_shidduchim_id is not null then
    return query
    insert into public.resumes (account_id, shidduchim_id, files)
    values (v_account_id, p_shidduchim_id, jsonb_build_array(v_entry))
    on conflict (shidduchim_id) where shidduchim_id is not null do update
      set files = case
        when p_source_inbox_item_id is not null and exists (
          select 1
            from jsonb_array_elements(coalesce(public.resumes.files, '[]'::jsonb)) existing_file
           where existing_file->>'source_inbox_item_id' = p_source_inbox_item_id::text
             and existing_file->>'source_inbox_attachment_path' = p_source_inbox_attachment_path
        ) then public.resumes.files
        else coalesce(public.resumes.files, '[]'::jsonb) || jsonb_build_array(v_entry)
      end
    returning *;
  else
    return query
    insert into public.resumes (account_id, single_id, files)
    values (v_account_id, p_single_id, jsonb_build_array(v_entry))
    on conflict (single_id) where single_id is not null do update
      set files = case
        when p_source_inbox_item_id is not null and exists (
          select 1
            from jsonb_array_elements(coalesce(public.resumes.files, '[]'::jsonb)) existing_file
           where existing_file->>'source_inbox_item_id' = p_source_inbox_item_id::text
             and existing_file->>'source_inbox_attachment_path' = p_source_inbox_attachment_path
        ) then public.resumes.files
        else coalesce(public.resumes.files, '[]'::jsonb) || jsonb_build_array(v_entry)
      end
    returning *;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.hide_resume_photo(p_photo_id bigint)
RETURNS SETOF public.resume_photos
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
begin
  v_account_id := public.current_context_id();

  if not exists (
    select 1 from public.resume_photos p
    where p.id = p_photo_id and p.account_id = v_account_id
  ) then
    raise exception 'photo % not found in current account', p_photo_id;
  end if;

  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager', 'helper', 'shadchan') then
    raise exception 'photo changes are not available to this role'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  update public.resume_photos
  set hidden_at = now()
  where id = p_photo_id and account_id = v_account_id
  returning *;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_resume_photo(p_photo_id bigint)
RETURNS SETOF public.resume_photos
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
begin
  if not exists (
    select 1 from public.resume_photos p
    where p.id = p_photo_id and p.account_id = v_account_id
  ) then
    raise exception 'photo % not found in current account', p_photo_id
      using errcode = 'P0002';
  end if;

  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager', 'helper', 'shadchan') then
    raise exception 'photo changes are not available to this role'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  update public.resume_photos
  set hidden_at = null
  where id = p_photo_id and account_id = v_account_id
  returning *;
end;
$function$;

drop function if exists public.add_resume_photo(text, bigint, bigint, text);

CREATE OR REPLACE FUNCTION public.add_resume_photo(
  p_path text,
  p_shidduchim_id bigint DEFAULT NULL,
  p_single_id bigint DEFAULT NULL,
  p_visibility text DEFAULT 'shared',
  p_size bigint DEFAULT NULL
) RETURNS SETOF public.resume_photos
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_resume_id bigint;
  v_parent_id bigint;
begin
  v_account_id := public.current_context_id();
  if public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'new row violates row-level security policy for table "resumes"'
      using errcode = 'insufficient_privilege';
  end if;

  if p_size is not null then
    if p_size < 0 or p_size > 8 * 1024 * 1024 then
      raise exception 'picture must be no larger than 8 MiB'
        using errcode = 'check_violation';
    end if;
    if p_path is null
       or p_path !~ ('^' || v_account_id::text
         || '/photos/(shared|private_parent)/(single-)?[0-9]+/[^/]+\.(jpe?g|png)$') then
      raise exception 'picture must be a JPEG or PNG in the current account'
        using errcode = 'check_violation';
    end if;
  end if;

  if (p_shidduchim_id is not null) = (p_single_id is not null) then
    raise exception 'exactly one of p_shidduchim_id/p_single_id must be provided';
  end if;

  if p_shidduchim_id is not null then
    select s.id into v_parent_id
    from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
    for update;
    perform public.account_storage_lock(v_account_id);
    if v_parent_id is null then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;
    if exists (
      select 1 from public.deleted_shidduch_tombstones t
      where t.account_id = v_account_id and t.shidduch_id = p_shidduchim_id
    ) then
      raise exception 'shidduch % is deleted', p_shidduchim_id
        using errcode = 'foreign_key_violation';
    end if;
    if not exists (
      select 1 from public.shidduchim s
      where s.id = p_shidduchim_id and s.account_id = v_account_id
    ) then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;

    insert into public.resumes (account_id, shidduchim_id)
    values (v_account_id, p_shidduchim_id)
    on conflict (shidduchim_id) where shidduchim_id is not null
      do update set shidduchim_id = excluded.shidduchim_id
    returning id into v_resume_id;
  else
    if not exists (
      select 1 from public.singles s
      where s.id = p_single_id and s.account_id = v_account_id
    ) then
      raise exception 'single % not found in current account', p_single_id;
    end if;

    insert into public.resumes (account_id, single_id)
    values (v_account_id, p_single_id)
    on conflict (single_id) where single_id is not null
      do update set single_id = excluded.single_id
    returning id into v_resume_id;
  end if;

  return query
  insert into public.resume_photos (account_id, resume_id, path, visibility)
  values (v_account_id, v_resume_id, p_path, coalesce(p_visibility, 'shared'))
  returning *;
end;
$function$;

drop function if exists public.remove_resume_file(bigint, text);

CREATE OR REPLACE FUNCTION public.remove_resume_file(
  p_resume_id bigint,
  p_path text,
  p_size bigint,
  p_uploaded_at timestamptz,
  p_delete_token text
) RETURNS SETOF public.resumes
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_parent_id bigint;
  v_single_id bigint;
  v_resume public.resumes;
  v_file jsonb;
  v_files jsonb;
  v_remaining jsonb;
  v_queue public.storage_purge_queue;
  v_target_ordinality bigint;
  v_has_different_identity boolean;
begin
  if v_account_id is null
     or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'remove_resume_file requires an owning manager'
      using errcode = 'insufficient_privilege';
  end if;

  if p_resume_id is null or p_path is null or p_path = ''
     or p_size is null or p_uploaded_at is null
     or p_delete_token is null
     or p_delete_token !~ '^[0-9a-f]{64}$' then
    raise exception 'resume file not found'
      using errcode = 'P0002';
  end if;

  -- Global storage-writer order is parent row -> advisory fence ->
  -- resume -> purge queue. The queue's opaque token is the server-side claim;
  -- a retry with the same token and exact identity is harmless. A duplicate
  -- path with a different identity removes one entry and leaves a partial
  -- queue claim until the last reference is removed.
  select r.shidduchim_id, r.single_id into v_parent_id, v_single_id
  from public.resumes r
  where r.id = p_resume_id and r.account_id = v_account_id;
  if v_single_id is null then
    -- Keep the shidduchim branch's lock and account checks unchanged.
    select s.id into v_parent_id
    from public.shidduchim s
    where s.account_id = v_account_id
      and exists (
        select 1
        from public.resumes r
        where r.id = p_resume_id
          and r.account_id = v_account_id
          and r.shidduchim_id = s.id
      )
    for update;
    perform public.account_storage_lock(v_account_id);
    if v_parent_id is null then
      raise exception 'resume not found'
        using errcode = 'P0002';
    end if;
  else
    select s.id into v_single_id
    from public.singles s
    where s.id = v_single_id and s.account_id = v_account_id
    for update;
    perform public.account_storage_lock(v_account_id);
    if v_single_id is null then
      raise exception 'resume not found'
        using errcode = 'P0002';
    end if;
  end if;
  select r.* into v_resume
  from public.resumes r
  where r.id = p_resume_id
    and r.account_id = v_account_id
    and ((v_single_id is null and r.shidduchim_id = v_parent_id)
      or (v_single_id is not null and r.single_id = v_single_id))
  for update;
  if not found then
    raise exception 'resume not found'
      using errcode = 'P0002';
  end if;

  v_files := case
    when jsonb_typeof(v_resume.files) = 'array' then v_resume.files
    else '[]'::jsonb
  end;
  select q.* into v_queue
  from public.storage_purge_queue q
  where q.account_id = v_account_id
    and q.kind = 'object'
    and q.bucket = 'documents'
    and q.storage_path = p_path
    and q.resume_id = v_resume.id
  for update;

  -- A token retry is idempotent only for the exact resume/file identity. This
  -- is the final arbiter for tabs whose local claim lease expires in flight.
  if found and v_queue.delete_token = p_delete_token then
    if v_queue.file_size is distinct from p_size
       or v_queue.file_uploaded_at is distinct from p_uploaded_at then
      raise exception 'resume delete token identity mismatch'
        using errcode = 'serialization_failure';
    end if;
    return next v_resume;
    return;
  end if;

  select f.value, f.ordinality into v_file, v_target_ordinality
  from jsonb_array_elements(v_files) with ordinality f(value, ordinality)
  where f.value->>'path' = p_path
    and (f.value->>'size')::bigint is not distinct from p_size
    and (f.value->>'uploaded_at')::timestamptz is not distinct from p_uploaded_at
  order by f.ordinality
  limit 1;

  if v_queue.id is not null and not v_queue.resume_file_partial
     and v_file is not null then
    raise exception 'resume file changed'
      using errcode = 'serialization_failure';
  end if;

  if v_file is null then
    if exists (
      select 1
      from jsonb_array_elements(v_files) f(value)
      where f.value->>'path' = p_path
    ) then
      raise exception 'resume file changed'
        using errcode = 'serialization_failure';
    end if;
    if v_queue.id is not null and v_queue.file_size = p_size
       and v_queue.file_uploaded_at = p_uploaded_at
       and not v_queue.resume_file_partial then
      return next v_resume;
      return;
    end if;
    raise exception 'resume file not found'
      using errcode = 'P0002';
  end if;

  if v_queue.id is not null and (
       v_queue.file_size is distinct from p_size
       or v_queue.file_uploaded_at is distinct from p_uploaded_at
     ) and not v_queue.resume_file_partial then
    raise exception 'resume file changed'
      using errcode = 'serialization_failure';
  end if;

  if p_path !~ ('^' || v_account_id::text || '/resumes/' ||
      case when v_single_id is null then v_parent_id::text else 'single-' || v_single_id::text end || '/[^/]+$')
     or p_path ~ '(^|/)(\.\.?)($|/)'
     or p_path ~ '[*?]' then
    raise exception 'resume file path is not removable'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.ai_reread_attempts a
    where a.account_id = v_account_id
      and a.resume_id = v_resume.id
      and (a.file_identity is null or a.file_identity = p_path)
      and a.status = 'in_progress'
      and a.lease_expires_at > now()
  ) then
    raise exception 'Please wait: this resume is being made easy to read.'
      using errcode = '55P03';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(v_files) with ordinality f(value, ordinality)
    where f.value->>'path' = p_path
      and (
        (f.value->>'size')::bigint is distinct from p_size
        or (f.value->>'uploaded_at')::timestamptz is distinct from p_uploaded_at
      )
  ) into v_has_different_identity;

  select coalesce(jsonb_agg(f.value order by f.ordinality), '[]'::jsonb)
    into v_remaining
  from jsonb_array_elements(v_files) with ordinality f(value, ordinality)
  where case
    when v_has_different_identity then f.ordinality <> v_target_ordinality
    else f.value->>'path' is distinct from p_path
  end;

  update public.resumes
  set files = v_remaining
  where id = v_resume.id
  returning * into v_resume;

  if v_has_different_identity then
    if v_queue.id is not null then
      update public.storage_purge_queue
      set file_size = p_size,
          file_uploaded_at = p_uploaded_at,
          delete_token = p_delete_token,
          resume_file_partial = true,
          updated_at = now()
      where id = v_queue.id;
    else
      insert into public.storage_purge_queue (
        account_id, kind, bucket, storage_path, resume_id, file_size,
        file_uploaded_at, delete_token, resume_file_partial
      ) values (
        v_account_id, 'object', 'documents', p_path, v_resume.id, p_size,
        p_uploaded_at, p_delete_token, true
      );
    end if;
    return next v_resume;
    return;
  end if;

  if v_queue.id is not null then
    update public.storage_purge_queue
    set file_size = p_size,
        file_uploaded_at = p_uploaded_at,
        delete_token = p_delete_token,
        resume_file_partial = false,
        updated_at = now()
    where id = v_queue.id;
  else
    insert into public.storage_purge_queue (
      account_id, kind, bucket, storage_path, resume_id, file_size,
      file_uploaded_at, delete_token, resume_file_partial
    ) values (
      v_account_id, 'object', 'documents', p_path, v_resume.id, p_size,
      p_uploaded_at, p_delete_token, false
    );
  end if;
  if not exists (
    select 1
    from public.storage_purge_queue q
    where q.account_id = v_account_id
      and q.kind = 'object'
      and q.bucket = 'documents'
      and q.storage_path = p_path
      and q.resume_id = v_resume.id
      and q.file_size = p_size
      and q.file_uploaded_at = p_uploaded_at
      and q.delete_token = p_delete_token
      and not q.resume_file_partial
  ) then
    raise exception 'resume file cleanup could not be queued'
      using errcode = 'check_violation';
  end if;

  return next v_resume;
  return;
end;
$function$;

-- Keep client access explicit: no anonymous or public RPC entry points, and
-- no direct authenticated DELETE that could bypass the ten-second window.
revoke all on function public.add_resume_file(text, text, text, bigint, bigint, bigint, bigint, text) from public, anon;
grant execute on function public.add_resume_file(text, text, text, bigint, bigint, bigint, bigint, text) to authenticated, service_role;
revoke all on function public.remove_resume_file(bigint, text, bigint, timestamptz, text) from public, anon;
grant execute on function public.remove_resume_file(bigint, text, bigint, timestamptz, text) to authenticated, service_role;
revoke all on function public.add_resume_photo(text, bigint, bigint, text, bigint) from public, anon;
grant execute on function public.add_resume_photo(text, bigint, bigint, text, bigint) to authenticated, service_role;
revoke all on function public.hide_resume_photo(bigint) from public, anon;
grant execute on function public.hide_resume_photo(bigint) to authenticated, service_role;
revoke all on function public.restore_resume_photo(bigint) from public, anon;
grant execute on function public.restore_resume_photo(bigint) to authenticated, service_role;
revoke all on function public.soft_delete_entity_file(bigint) from public, anon;
grant execute on function public.soft_delete_entity_file(bigint) to authenticated, service_role;
revoke all on function public.undo_entity_file_delete(bigint, text) from public, anon;
grant execute on function public.undo_entity_file_delete(bigint, text) to authenticated, service_role;
revoke all on function public.finalize_entity_file_delete(bigint, text) from public, anon;
grant execute on function public.finalize_entity_file_delete(bigint, text) to authenticated, service_role;
revoke all on function public.finalize_expired_entity_file_deletes() from public, anon;
grant execute on function public.finalize_expired_entity_file_deletes() to authenticated, service_role;
revoke all on function public.replace_entity_file(bigint, text, text, text, bigint, text, text) from public, anon;
grant execute on function public.replace_entity_file(bigint, text, text, text, bigint, text, text) to authenticated, service_role;

revoke all on table public.entity_files from anon, authenticated;
grant select, insert, delete on table public.entity_files to authenticated;
grant all on table public.entity_files to service_role;
grant update (visibility) on table public.entity_files to authenticated;
revoke all on table public.entity_files_summary from anon, authenticated;
grant select on table public.entity_files_summary to authenticated;
grant all on table public.entity_files_summary to service_role;
