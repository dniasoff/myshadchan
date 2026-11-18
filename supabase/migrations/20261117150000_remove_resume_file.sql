-- Per-file Resume-tab deletion. The catalog mutation and durable Storage
-- purge enqueue are one transaction; the client owns only the Undo window.
set check_function_bodies = off;

alter table public.ai_reread_attempts
  add column if not exists file_identity text;

drop function if exists public.claim_ai_reread_attempt(bigint, bigint, uuid, smallint);

CREATE OR REPLACE FUNCTION "public"."claim_ai_reread_attempt"("p_account_id" bigint, "p_resume_id" bigint, "p_request_id" uuid, "p_current_schema_version" smallint, "p_file_identity" text DEFAULT NULL::text) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  c_lease constant interval := interval '5 minutes';
  v_period text := to_char(now(), 'YYYY-MM');
  v_attempt public.ai_reread_attempts;
  v_limit integer;
  v_new_count integer;
  v_reclaim_attempt_id bigint;
  v_shidduch_id bigint;
begin
  if p_account_id is null or p_resume_id is null or p_request_id is null then
    raise exception 're-read claim requires account, resume and request'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Global storage-writer lock order is account row -> advisory fence ->
  -- shidduch parent -> child rows/queue. Keep reread claims in that order so
  -- a claim/delete pair cannot deadlock.
  perform public.account_storage_lock(p_account_id);
  select s.id into v_shidduch_id
  from public.shidduchim s
  join public.resumes r on r.shidduchim_id = s.id
  where r.id = p_resume_id and r.account_id = p_account_id
  for share of s;

  -- The service-role RPC is an independent trust boundary from the Worker.
  -- Reject a forged account/resume pair before retention, quota reservation,
  -- or any ledger write can occur.
  if not exists (
    select 1
    from public.resumes
    where id = p_resume_id and account_id = p_account_id
  ) then
    raise exception 're-read resume does not belong to account'
      using errcode = 'foreign_key_violation';
  end if;

  with doomed as (
    select id
    from public.ai_reread_attempts
    where status in ('completed', 'failed')
      and updated_at < now() - interval '30 days'
    order by updated_at
    limit 100
  )
  delete from public.ai_reread_attempts a
  using doomed
  where a.id = doomed.id;

  perform pg_advisory_xact_lock(
    hashtextextended(format('ai-reread-resume:%s', p_resume_id), 0)
  );

  select * into v_attempt
  from public.ai_reread_attempts
  where account_id = p_account_id
    and resume_id = p_resume_id
    and request_id = p_request_id
  for update;

  if found then
    if v_attempt.status = 'completed' then
      return jsonb_build_object(
        'outcome', 'replayed', 'attempt_id', v_attempt.id,
        'generation', v_attempt.generation
      );
    end if;

    if v_attempt.status = 'in_progress' then
      if v_attempt.lease_expires_at > now() then
        return jsonb_build_object(
          'outcome', 'in_progress', 'attempt_id', v_attempt.id,
          'generation', v_attempt.generation
        );
      end if;
      update public.ai_reread_attempts
      set generation = generation + 1,
          file_identity = coalesce(p_file_identity, file_identity),
          lease_expires_at = now() + c_lease, updated_at = now()
      where id = v_attempt.id
      returning * into v_attempt;
      return jsonb_build_object(
        'outcome', 'reserved', 'attempt_id', v_attempt.id,
        'generation', v_attempt.generation
      );
    end if;

    -- A failed request may be retried with the same idempotency key.  It
    -- keeps its ledger row, but must reserve one new unit before becoming
    -- the next generation; the update below avoids a unique-key insert.
    if v_attempt.status = 'failed' then
      v_reclaim_attempt_id := v_attempt.id;
    end if;
  end if;

  select * into v_attempt
  from public.ai_reread_attempts
  where resume_id = p_resume_id and status = 'in_progress'
  for update;
  if found then
    if v_attempt.account_id = p_account_id
       and v_attempt.lease_expires_at <= now() then
      update public.ai_reread_attempts
      set request_id = p_request_id, generation = generation + 1,
          file_identity = coalesce(p_file_identity, file_identity),
          lease_expires_at = now() + c_lease, updated_at = now()
      where id = v_attempt.id and account_id = p_account_id
      returning * into v_attempt;
      return jsonb_build_object(
        'outcome', 'reserved', 'attempt_id', v_attempt.id,
        'generation', v_attempt.generation
      );
    end if;
    return jsonb_build_object(
      'outcome', 'busy', 'attempt_id', v_attempt.id,
      'generation', v_attempt.generation
    );
  end if;

  v_limit := public.ai_resume_limit_for_account(p_account_id);
  if v_limit <= 0 then
    if exists (
      select 1 from public.subscription
      where account_id = p_account_id and plan = 'ai' and status = 'active'
    ) then
      return jsonb_build_object('outcome', 'no_allowance');
    end if;
    return jsonb_build_object('outcome', 'not_entitled');
  end if;

  insert into public.ai_usage as u (account_id, period, resumes_parsed)
  values (p_account_id, v_period, 1)
  on conflict (account_id, period) do update
    set resumes_parsed = u.resumes_parsed + 1
    where u.resumes_parsed < v_limit
  returning u.resumes_parsed into v_new_count;
  if not found then
    return jsonb_build_object('outcome', 'no_allowance');
  end if;

  if v_reclaim_attempt_id is not null then
    update public.ai_reread_attempts
    set period = v_period, status = 'in_progress', generation = generation + 1,
        file_identity = coalesce(p_file_identity, file_identity),
        lease_expires_at = now() + c_lease, updated_at = now()
    where id = v_reclaim_attempt_id and account_id = p_account_id
      and status = 'failed'
    returning * into v_attempt;
  else
    insert into public.ai_reread_attempts
      (account_id, resume_id, file_identity, request_id, period, status, generation,
       lease_expires_at, updated_at)
    values
      (p_account_id, p_resume_id, p_file_identity, p_request_id, v_period, 'in_progress', 1,
       now() + c_lease, now())
    returning * into v_attempt;
  end if;

  return jsonb_build_object(
    'outcome', 'reserved', 'attempt_id', v_attempt.id,
    'generation', v_attempt.generation
  );
end;
$$;

revoke all on function public.claim_ai_reread_attempt(bigint, bigint, uuid, smallint, text) from public, anon, authenticated;
grant execute on function public.claim_ai_reread_attempt(bigint, bigint, uuid, smallint, text) to service_role;

CREATE OR REPLACE FUNCTION public.account_storage_lock(p_account_id bigint)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  if p_account_id is null then
    raise exception 'account storage lock requires an account'
      using errcode = 'invalid_parameter_value';
  end if;
  -- Global storage-writer order: account row -> advisory fence -> parent
  -- shidduch -> child rows/queue. The account key-share prevents an account
  -- deletion (which takes the account row before this fence) from waiting on
  -- a writer that is already waiting on the account FK.
  perform 1 from public.accounts where id = p_account_id for key share;
  perform pg_advisory_xact_lock(
    hashtextextended(format('myshadchan-account-storage:%s', p_account_id), 0)
  );
end;
$function$;

-- The deployed 20261117132107 repair accidentally put the parent lock before
-- the account fence in these two upload writers.  Re-define them here rather
-- than editing deployed history: every storage writer now follows account row
-- -> advisory fence -> shidduch parent -> child rows/queue.
CREATE OR REPLACE FUNCTION public.add_resume_file(p_path text, p_filename text, p_mime_type text, p_size bigint, p_shidduchim_id bigint DEFAULT NULL::bigint, p_single_id bigint DEFAULT NULL::bigint, p_source_inbox_item_id bigint DEFAULT NULL::bigint, p_source_inbox_attachment_path text DEFAULT NULL::text)
 RETURNS SETOF public.resumes
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

  -- Global storage-writer lock order is account row -> account advisory
  -- fence -> shidduch parent -> resume/source rows. Every writer uses the
  -- helper before a parent lock so account deletion cannot deadlock.
  if p_shidduchim_id is not null then
    perform public.account_storage_lock(v_account_id);
    select s.id into v_parent_id
    from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
    for share;
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

CREATE OR REPLACE FUNCTION public.add_resume_photo(p_path text, p_shidduchim_id bigint DEFAULT NULL::bigint, p_single_id bigint DEFAULT NULL::bigint, p_visibility text DEFAULT 'shared'::text)
 RETURNS SETOF public.resume_photos
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

  if (p_shidduchim_id is not null) = (p_single_id is not null) then
    raise exception 'exactly one of p_shidduchim_id/p_single_id must be provided';
  end if;

  if p_shidduchim_id is not null then
    perform public.account_storage_lock(v_account_id);
    select s.id into v_parent_id
    from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
    for share;
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

CREATE OR REPLACE FUNCTION public.account_storage_cleanup_fence(p_account_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Account deletion uses account row -> advisory fence -> parent rows.
  -- Keep this order with uploads and per-file removal.
  perform public.account_storage_lock(p_account_id);
  perform 1
  from public.shidduchim
  where account_id = p_account_id
  order by id
  for update;
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

CREATE OR REPLACE FUNCTION public.claim_shidduch_storage_purge()
RETURNS SETOF public.storage_purge_queue
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
begin
  if v_account_id is null or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'Storage purge is not available to this role'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.account_storage_lock(v_account_id);
  return query
  update public.storage_purge_queue q
  set claimed_at = now(), attempt = q.attempt + 1, updated_at = now()
  from (
    select id
    from public.storage_purge_queue
    where account_id = v_account_id
      and not_before <= now()
      and (claimed_at is null or claimed_at < now() - interval '5 minutes')
    order by id
    limit 100
    for update skip locked
  ) picked
  where q.id = picked.id
  returning q.*;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ack_shidduch_storage_purge(
  p_kind text,
  p_bucket text,
  p_path text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_row public.storage_purge_queue;
begin
  if v_account_id is null or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'Storage purge is not available to this role'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.account_storage_lock(v_account_id);
  select * into v_row
  from public.storage_purge_queue
  where account_id = v_account_id
    and kind = p_kind and bucket = p_bucket and storage_path = p_path
    and claimed_at is not null
  for update;
  if not found then
    return false;
  end if;
  if v_row.kind = 'prefix' and v_row.phase = 1 then
    update public.storage_purge_queue
    set phase = 2, not_before = now() + interval '24 hours',
        claimed_at = null, updated_at = now()
    where id = v_row.id;
  else
    delete from public.storage_purge_queue where id = v_row.id;
  end if;
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.archive_shidduch(p_id bigint)
RETURNS SETOF public.shidduchim
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_row public.shidduchim;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'archive_shidduch requires an owning manager'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.account_storage_lock(v_account_id);
  select s.* into v_row from public.shidduchim s
  where s.id = p_id and s.account_id = v_account_id
  for update;
  if not found then return; end if;
  update public.shidduchim set archived_at = coalesce(archived_at, now()) where id = p_id;
  return query select * from public.shidduch_row(p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_shidduch(p_id bigint)
RETURNS SETOF public.shidduchim
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_row public.shidduchim;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'restore_shidduch requires an owning manager'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.account_storage_lock(v_account_id);
  select s.* into v_row from public.shidduchim s
  where s.id = p_id and s.account_id = v_account_id
  for update;
  if not found then return; end if;
  update public.shidduchim set archived_at = null where id = p_id;
  return query select * from public.shidduch_row(p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.resume_read_in_progress(p_resume_id bigint, p_path text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_resume_id bigint;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager')
     or p_resume_id is null or p_path is null then
    return false;
  end if;
  select r.id into v_resume_id
  from public.resumes r
  where r.id = p_resume_id and r.account_id = v_account_id
  for share;
  if v_resume_id is null then
    return false;
  end if;
  return exists (
    select 1
    from public.ai_reread_attempts a
    where a.resume_id = v_resume_id
      and (a.file_identity is null or a.file_identity = p_path)
      and a.status = 'in_progress'
      and a.lease_expires_at > now()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_resume_file(
  p_resume_id bigint,
  p_path text,
  p_size bigint,
  p_uploaded_at timestamptz
) RETURNS SETOF public.resumes
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_parent_id bigint;
  v_resume public.resumes;
  v_file jsonb;
  v_files jsonb;
  v_remaining jsonb;
begin
  if v_account_id is null
     or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'remove_resume_file requires an owning manager'
      using errcode = 'insufficient_privilege';
  end if;

  if p_resume_id is null or p_path is null or p_path = ''
     or p_size is null or p_uploaded_at is null then
    raise exception 'resume file not found'
      using errcode = 'no_data';
  end if;

  -- Global storage-writer order is account row -> account advisory fence ->
  -- shidduch parent -> resume -> purge queue. The helper also protects the
  -- account FK queue insert from account deletion.
  perform public.account_storage_lock(v_account_id);
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
  if v_parent_id is null then
    raise exception 'resume not found'
      using errcode = 'no_data';
  end if;
  select r.* into v_resume
  from public.resumes r
  where r.id = p_resume_id
    and r.account_id = v_account_id
    and r.shidduchim_id = v_parent_id
  for update;
  if not found then
    raise exception 'resume not found'
      using errcode = 'no_data';
  end if;

  v_files := case
    when jsonb_typeof(v_resume.files) = 'array' then v_resume.files
    else '[]'::jsonb
  end;
  select f.value into v_file
  from jsonb_array_elements(v_files) f(value)
  where f.value->>'path' = p_path
  limit 1;

  if v_file is null then
    -- A retry after this function already won is safe and does not enqueue a
    -- second object. A genuinely unknown path remains a visible no-data error.
    if exists (
      select 1
      from public.storage_purge_queue q
      where q.account_id = v_account_id
        and q.kind = 'object'
        and q.bucket = 'documents'
        and q.storage_path = p_path
    ) then
      return next v_resume;
      return;
    end if;
    raise exception 'resume file not found'
      using errcode = 'no_data';
  end if;

  if p_path !~ ('^' || v_account_id::text || '/resumes/' || v_parent_id::text || '/[^/]+$')
     or p_path ~ '(^|/)(\.\.?)($|/)'
     or p_path ~ '[*?]' then
    raise exception 'resume file path is not removable'
      using errcode = 'check_violation';
  end if;

  if (v_file->>'size')::bigint is distinct from p_size
     or (v_file->>'uploaded_at')::timestamptz is distinct from p_uploaded_at then
    raise exception 'resume file changed'
      using errcode = 'serialization_failure';
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

  select coalesce(jsonb_agg(f.value order by f.ordinality), '[]'::jsonb)
    into v_remaining
  from jsonb_array_elements(v_files) with ordinality f(value, ordinality)
  where f.value->>'path' is distinct from p_path;

  update public.resumes
  set files = v_remaining
  where id = v_resume.id
  returning * into v_resume;

  perform public.storage_purge_queue_object(v_account_id, 'documents', p_path);
  if not exists (
    select 1
    from public.storage_purge_queue q
    where q.account_id = v_account_id
      and q.kind = 'object'
      and q.bucket = 'documents'
      and q.storage_path = p_path
  ) then
    raise exception 'resume file cleanup could not be queued'
      using errcode = 'check_violation';
  end if;

  return next v_resume;
  return;
end;
$function$;

-- Keep shidduch deletion in the same global order as upload and per-file
-- removal: account row (inside account_storage_lock) -> advisory fence ->
-- parent shidduch -> child rows/queue. Without this first helper call an
-- account delete can hold the account FK lock while this function holds the
-- parent and waits to enqueue its purge rows.
CREATE OR REPLACE FUNCTION public.delete_shidduch(p_id bigint)
 RETURNS SETOF public.shidduchim
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_shidduch public.shidduchim;
  v_resume public.resumes;
  v_file jsonb;
  v_path text;
  v_prefix text;
begin
  if v_account_id is null or auth.uid() is null
     or public.current_member_role() not in ('parent_admin', 'self_manager') then
    raise exception 'delete_shidduch requires an owning manager'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.account_storage_lock(v_account_id);
  select s.* into v_shidduch from public.shidduchim s
  where s.id = p_id and s.account_id = v_account_id
  for update;
  if not found then return; end if;

  if exists (
    select 1
    from public.ai_reread_attempts a
    join public.resumes r on r.id = a.resume_id
    where r.shidduchim_id = p_id
      and a.status = 'in_progress'
      and a.lease_expires_at > now()
  ) then
    raise exception 'Please wait: this resume is being made easy to read.'
      using errcode = '55P03';
  end if;

  for v_resume in
    select r.* from public.resumes r where r.shidduchim_id = p_id
  loop
    if jsonb_typeof(v_resume.files) = 'array' then
      for v_file in select value from jsonb_array_elements(v_resume.files) loop
        v_path := v_file->>'path';
        if v_path is null or v_path = v_file->>'source_inbox_attachment_path' then
          continue;
        elsif v_path ~ ('^' || v_account_id::text || '/resumes/' || p_id::text || '/[^/]+$')
              and not v_path ~ '(^|/)(\.\.?)(/|$)' and not v_path ~ '[*?]' then
          perform public.storage_purge_queue_object(v_account_id, 'documents', v_path);
        else
          perform public.storage_purge_queue_quarantine(v_account_id, 'documents', v_path, 'unsupported_path');
        end if;
      end loop;
    end if;
  end loop;

  for v_path in
    select rp.path
    from public.resume_photos rp
    join public.resumes r on r.id = rp.resume_id
    where r.shidduchim_id = p_id
  loop
    if v_path ~ ('^' || v_account_id::text || '/photos/(shared|private_parent)/' || p_id::text || '/[^/]+$')
       and not v_path ~ '(^|/)(\.\.?)(/|$)' and not v_path ~ '[*?]' then
      perform public.storage_purge_queue_object(v_account_id, 'documents', v_path);
    else
      perform public.storage_purge_queue_quarantine(v_account_id, 'documents', v_path, 'unsupported_path');
    end if;
  end loop;

  for v_path in
    select ef.storage_path
    from public.entity_files ef
    where ef.account_id = v_account_id
      and ef.target_type = 'shidduch' and ef.target_id = p_id
  loop
    if v_path ~ ('^' || v_account_id::text || '/shidduch/' || p_id::text || '/[^/]+$')
       and not v_path ~ '(^|/)(\.\.?)(/|$)' and not v_path ~ '[*?]' then
      perform public.storage_purge_queue_object(v_account_id, 'entity-files', v_path);
    else
      perform public.storage_purge_queue_quarantine(v_account_id, 'entity-files', v_path, 'unsupported_path');
    end if;
  end loop;

  foreach v_prefix in array array[
    v_account_id::text || '/resumes/' || p_id::text || '/',
    v_account_id::text || '/photos/shared/' || p_id::text || '/',
    v_account_id::text || '/photos/private_parent/' || p_id::text || '/',
    v_account_id::text || '/shidduch/' || p_id::text || '/'
  ] loop
    insert into public.storage_purge_queue (account_id, kind, bucket, storage_path)
    values (
      v_account_id, 'prefix',
      case when v_prefix like '%/shidduch/%' then 'entity-files' else 'documents' end,
      v_prefix
    ) on conflict (account_id, kind, bucket, storage_path) do nothing;
  end loop;

  delete from public.shidduchim where id = p_id and account_id = v_account_id;
  return;
end;
$function$;

revoke all on function public.remove_resume_file(bigint, text, bigint, timestamptz) from public, anon;
grant execute on function public.remove_resume_file(bigint, text, bigint, timestamptz) to authenticated;
grant execute on function public.remove_resume_file(bigint, text, bigint, timestamptz) to service_role;

revoke all on function public.resume_read_in_progress(bigint, text) from public, anon;
grant execute on function public.resume_read_in_progress(bigint, text) to authenticated;
grant execute on function public.resume_read_in_progress(bigint, text) to service_role;
