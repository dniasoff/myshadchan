set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.add_resume_file(p_path text, p_filename text, p_mime_type text, p_size bigint, p_shidduchim_id bigint DEFAULT NULL::bigint, p_single_id bigint DEFAULT NULL::bigint, p_source_inbox_item_id bigint DEFAULT NULL::bigint, p_source_inbox_attachment_path text DEFAULT NULL::text)
 RETURNS SETOF public.resumes
 LANGUAGE plpgsql
 SECURITY DEFINER
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

  -- Upload/catalog lock order is shidduch parent -> account -> Inbox source.
  -- The parent FOR SHARE is taken before any resume row write so delete's
  -- parent FOR UPDATE cannot race a late catalog insert.
  if p_shidduchim_id is not null then
    select s.id into v_parent_id
    from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
    for share;
    if v_parent_id is null then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;
    perform public.account_storage_lock(v_account_id);
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
$function$
;
CREATE OR REPLACE FUNCTION public.add_resume_photo(p_path text, p_shidduchim_id bigint DEFAULT NULL::bigint, p_single_id bigint DEFAULT NULL::bigint, p_visibility text DEFAULT 'shared'::text)
 RETURNS SETOF public.resume_photos
 LANGUAGE plpgsql
 SECURITY DEFINER
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
    select s.id into v_parent_id
    from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
    for share;
    if v_parent_id is null then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;
    perform public.account_storage_lock(v_account_id);
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
$function$
;

CREATE OR REPLACE FUNCTION public.catch_shidduch(p_shidduchim_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_s public.shidduchim;
  v_suggestions jsonb;
  v_dates jsonb;
  v_name_en_norm text;
  v_name_he_norm text;
  v_name_en_key text;
  v_name_he_key text;
  v_parents_norm text;
  v_seminary_norm text;
  v_location_norm text;
begin
  v_account_id := public.current_context_id();
  if v_account_id is null then
    return jsonb_build_object('has_catch', false, 'suggestions', '[]'::jsonb, 'dates', '[]'::jsonb);
  end if;

  -- shidduch_row() rather than `select * from public.shidduchim`: the same
  -- RLS-filtered row (that function is SECURITY INVOKER), reached without the
  -- SELECT-on-every-column that `select *` demands and `authenticated` no
  -- longer has for close_reason. Nothing below reads v_s.close_reason.
  select * into v_s
  from public.shidduch_row(p_shidduchim_id) s
  where s.account_id = v_account_id;

  if not found then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;
  if v_s.archived_at is not null then
    return jsonb_build_object('has_catch', false, 'suggestions', '[]'::jsonb, 'dates', '[]'::jsonb);
  end if;

  -- Prior suggestions: the shared matcher, excluding this very row. Each
  -- candidate is joined back to its single/shadchan so the panel renders the
  -- prior context ("suggested for {single}, via {shadchan}, {state}") in one hop.
  select coalesce(
    jsonb_agg(to_jsonb(cand) order by cand.confidence desc, cand.prior_shidduchim_id asc),
    '[]'::jsonb
  )
  into v_suggestions
  from (
    select
      m.target_id as prior_shidduchim_id,
      m.confidence,
      m.deciding_facts,
      ps.name_en,
      ps.name_he,
      ps.age,
      ps.pipeline_state,
      ps.first_suggested_at,
      ps.redt_date,
      ps.single_id,
      c.first_name_en as single_first_name_en,
      c.first_name_he as single_first_name_he,
      sh.name as shadchan_name
    from public.match_identity(
      'shidduch',
      v_s.name_en,
      v_s.name_he,
      null,
      nullif(trim(
        coalesce(v_s.father_en, v_s.father_he, '') || ' ' ||
        coalesce(v_s.mother_en, v_s.mother_he, '')
      ), ''),
      coalesce(v_s.seminary_en, v_s.seminary_he),
      coalesce(v_s.shul_en, v_s.shul_he),
      coalesce(v_s.location_en, v_s.location_he),
      p_shidduchim_id
    ) m
      join public.shidduchim ps on ps.id = m.target_id
      left join public.singles c on c.id = ps.single_id
      left join public.shadchanim sh on sh.id = ps.shadchan_id
    where ps.archived_at is null
      and not coalesce(public.shidduch_has_known_halachic_conflict(
      ps.single_id,
      ps.person_gender,
      ps.kohen_status,
      ps.marital_status
    ), false)
  ) cand;

  -- Prior dating (honest, corroborated, never fabricated). date_records is not in
  -- identity_signals, so it is compared directly with the shared normalizers.
  v_name_en_norm := public.normalize_identity_text(v_s.name_en);
  v_name_he_norm := public.normalize_identity_text(v_s.name_he);
  v_name_en_key := public.identity_name_key(v_s.name_en);
  v_name_he_key := public.identity_name_key(v_s.name_he);
  v_parents_norm := public.normalize_identity_text(nullif(trim(
    coalesce(v_s.father_en, v_s.father_he, '') || ' ' ||
    coalesce(v_s.mother_en, v_s.mother_he, '')
  ), ''));
  v_seminary_norm := public.normalize_identity_text(coalesce(v_s.seminary_en, v_s.seminary_he));
  v_location_norm := public.normalize_identity_text(coalesce(v_s.location_en, v_s.location_he));

  select coalesce(
    jsonb_agg(to_jsonb(d) order by d.date_on desc nulls last, d.date_record_id desc),
    '[]'::jsonb
  )
  into v_dates
  from (
    select
      dr.id as date_record_id,
      dr.person_name_en,
      dr.person_name_he,
      dr.date_on,
      dr.outcome,
      dr.single_id,
      c.first_name_en as single_first_name_en
    from public.date_records dr
      left join public.singles c on c.id = dr.single_id
    where dr.account_id = v_account_id
      and (
        (v_name_en_norm is not null and public.normalize_identity_text(dr.person_name_en) = v_name_en_norm)
        or (v_name_he_norm is not null and public.normalize_identity_text(dr.person_name_he) = v_name_he_norm)
        or (v_name_en_key is not null and public.identity_name_key(dr.person_name_en) = v_name_en_key)
        or (v_name_he_key is not null and public.identity_name_key(dr.person_name_he) = v_name_he_key)
      )
      and (
        (v_parents_norm is not null and public.normalize_identity_text(dr.person_parents) = v_parents_norm)
        or (v_seminary_norm is not null and public.normalize_identity_text(dr.person_seminary) = v_seminary_norm)
        or (v_location_norm is not null and public.normalize_identity_text(dr.person_location) = v_location_norm)
      )
  ) d;

  return jsonb_build_object(
    'has_catch', (jsonb_array_length(v_suggestions) > 0 or jsonb_array_length(v_dates) > 0),
    'suggestions', v_suggestions,
    'dates', v_dates
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.entity_files_target_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context_id bigint := public.current_context_id();
  v_account_id bigint := coalesce(v_context_id, new.account_id);
  v_parent_id bigint;
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

  if new.target_type = 'shidduch' then
    select s.id into v_parent_id
    from public.shidduchim s
    where s.id = new.target_id and s.account_id = v_account_id
    for share;
    if v_parent_id is null then
      raise exception 'entity file shidduch target is missing'
        using errcode = 'foreign_key_violation';
    end if;
    perform public.account_storage_lock(v_account_id);
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
$function$
;

CREATE OR REPLACE FUNCTION public.shidduch_row(p_shidduchim_id bigint)
 RETURNS SETOF public.shidduchim
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    s.id,
    s.account_id,
    s.created_at,
    s.single_id,
    s.shadchan_id,
    s.name_en,
    s.name_he,
    s.seminary_en,
    s.seminary_he,
    s.shul_en,
    s.shul_he,
    s.location_en,
    s.location_he,
    s.age,
    s.height,
    s.pipeline_state,
    s.first_suggested_by,
    s.first_suggested_at,
    s.redt_date,
    public.shidduch_close_reason(s.id),
    s.origin,
    s.owner_member_id,
    s.visibility,
    s.index,
    s.background,
    s.dob,
    s.existing_children_note,
    s.father_en,
    s.father_he,
    s.marital_status,
    s.mother_en,
    s.mother_he,
    s.kohen_status,
    s.person_gender,
    s.archived_at
  from public.shidduchim s
  where s.id = p_shidduchim_id;
$function$
;

CREATE OR REPLACE FUNCTION public.thread_visibility_permits(p_thread_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_thread public.threads;
begin
  select * into v_thread from public.threads where id = p_thread_id;
  if not found then
    return false;
  end if;

  -- Story 7.3 (AC-2, AC-3, AC-6): private beats scope AND beats the
  -- dignity-floor branch below — this IS the whole answer for a private
  -- thread, nothing else narrows or widens it.
  if v_thread.visibility = 'private' then
    return exists (
      select 1
      from public.thread_participants tp
      where tp.thread_id = p_thread_id
        and tp.member_id = public.current_member_id()
    );
  end if;

  if v_thread.subject_type = 'shidduch' and public.current_member_role() = 'single' then
    return exists (
      select 1
      from public.shidduchim s
      where s.id = v_thread.subject_id
        and s.archived_at is null
        and s.visibility = 'shared'
        and public.is_single_visible_state(s.pipeline_state)
        and exists (
          select 1 from public.singles c
          where c.id = s.single_id and c.member_id = public.current_member_id()
        )
    );
  end if;

  return true;
end;
$function$
;
