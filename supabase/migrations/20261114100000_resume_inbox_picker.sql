-- WR7 Part 2: append a still-unresolved Inbox attachment to the target resume
-- with durable provenance. The old six-argument overload is removed so every
-- client call resolves to the validated, idempotent contract below.

drop function if exists public.add_resume_file(text, text, text, bigint, bigint, bigint);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.add_resume_file(
  p_path text,
  p_filename text,
  p_mime_type text,
  p_size bigint,
  p_shidduchim_id bigint DEFAULT NULL::bigint,
  p_single_id bigint DEFAULT NULL::bigint,
  p_source_inbox_item_id bigint DEFAULT NULL::bigint,
  p_source_inbox_attachment_path text DEFAULT NULL::text
)
 RETURNS SETOF public.resumes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_entry jsonb;
  v_source_attachment jsonb;
begin
  v_account_id := public.current_context_id();

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
     limit 1;

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

revoke all on function public.add_resume_file(text, text, text, bigint, bigint, bigint, bigint, text) from public, anon;
grant execute on function public.add_resume_file(text, text, text, bigint, bigint, bigint, bigint, text) to authenticated;
grant execute on function public.add_resume_file(text, text, text, bigint, bigint, bigint, bigint, text) to service_role;
