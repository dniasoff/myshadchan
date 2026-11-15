-- Fill empty resume fields from the exact file requested by the client.
-- The ledger claim, file freshness fence, domain writes, resume sections and
-- charge are completed in one transaction through this service-role RPC.
CREATE OR REPLACE FUNCTION public.apply_ai_resume_read(
  p_account_id bigint,
  p_resume_id bigint,
  p_attempt_id bigint,
  p_generation bigint,
  p_file_identity text,
  p_fields jsonb,
  p_extracted jsonb,
  p_sections jsonb,
  p_schema_version smallint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
declare
  v_attempt public.ai_reread_attempts;
  v_resume public.resumes;
  v_sections jsonb;
  v_extracted jsonb;
  v_selected_uploaded_at timestamptz;
  v_latest_uploaded_at timestamptz;
  v_selected_position bigint;
  v_latest_position bigint;
begin
  if p_account_id is null or p_resume_id is null or p_attempt_id is null
     or p_generation is null or p_file_identity is null
     or btrim(p_file_identity) = '' or p_fields is null
     or jsonb_typeof(p_fields) <> 'object' or p_sections is null
     or jsonb_typeof(p_sections) <> 'object' or p_schema_version is null then
    raise exception 'resume read apply requires account, resume, attempt, generation, file, fields, sections and schema version'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_attempt
  from public.ai_reread_attempts
  where id = p_attempt_id and account_id = p_account_id and resume_id = p_resume_id
  for update;
  if not found then
    raise exception 'ai_reread_attempts % is not applicable to account % and resume %', p_attempt_id, p_account_id, p_resume_id;
  end if;
  if v_attempt.generation <> p_generation or v_attempt.status <> 'in_progress' then
    if v_attempt.generation = p_generation and v_attempt.status = 'completed' then
      return jsonb_build_object('outcome', 'applied');
    end if;
    return jsonb_build_object('outcome', 'superseded');
  end if;

  select * into v_resume from public.resumes
  where id = p_resume_id and account_id = p_account_id for update;
  if not found then
    raise exception 'resume % does not belong to account %', p_resume_id, p_account_id
      using errcode = 'foreign_key_violation';
  end if;

  -- The caller names the uploaded version it displayed. A later upload must
  -- not let this inference write into whichever file happens to be newest by
  -- the time the model returns. Array position breaks ties, so an append with
  -- the same timestamp is still detected as a newer version.
  select (entry.value ->> 'uploaded_at')::timestamptz, entry.ordinality
    into v_selected_uploaded_at, v_selected_position
  from jsonb_array_elements(
    case when jsonb_typeof(v_resume.files) = 'array' then v_resume.files else '[]'::jsonb end
  ) with ordinality as entry(value, ordinality)
  where entry.value ->> 'path' = p_file_identity limit 1;
  select (entry.value ->> 'uploaded_at')::timestamptz, entry.ordinality
    into v_latest_uploaded_at, v_latest_position
  from jsonb_array_elements(
    case when jsonb_typeof(v_resume.files) = 'array' then v_resume.files else '[]'::jsonb end
  ) with ordinality as entry(value, ordinality)
  order by (entry.value ->> 'uploaded_at')::timestamptz desc, entry.ordinality desc
  limit 1;
  if v_selected_uploaded_at is null or v_latest_uploaded_at is null
     or v_selected_position <> v_latest_position then
    return jsonb_build_object('outcome', 'stale_file');
  end if;

  v_sections := case when jsonb_typeof(v_resume.sections) = 'object'
    then v_resume.sections else '{}'::jsonb end;
  v_sections := v_sections || jsonb_build_object(
    'learningHistory', case
      when jsonb_typeof(v_sections -> 'learningHistory') = 'array'
           and jsonb_array_length(v_sections -> 'learningHistory') > 0
        then v_sections -> 'learningHistory'
      when jsonb_typeof(v_sections -> 'learningHistory') not in ('array', 'null')
        then v_sections -> 'learningHistory'
      when jsonb_typeof(p_sections -> 'learningHistory') = 'array'
        then p_sections -> 'learningHistory' else '[]'::jsonb end,
    'references', case
      when jsonb_typeof(v_sections -> 'references') = 'array'
           and jsonb_array_length(v_sections -> 'references') > 0
        then v_sections -> 'references'
      when jsonb_typeof(v_sections -> 'references') not in ('array', 'null')
        then v_sections -> 'references'
      when jsonb_typeof(p_sections -> 'references') = 'array'
        then p_sections -> 'references' else '[]'::jsonb end,
    'additionalSections', case
      when jsonb_typeof(v_sections -> 'additionalSections') = 'array'
           and jsonb_array_length(v_sections -> 'additionalSections') > 0
        then v_sections -> 'additionalSections'
      when jsonb_typeof(v_sections -> 'additionalSections') not in ('array', 'null')
        then v_sections -> 'additionalSections'
      when jsonb_typeof(p_sections -> 'additionalSections') = 'array'
        then p_sections -> 'additionalSections' else '[]'::jsonb end,
    'schemaVersion', p_schema_version
  );
  v_extracted := case
    when v_resume.extracted is null or jsonb_typeof(v_resume.extracted) = 'null'
         or v_resume.extracted = '{}'::jsonb then coalesce(p_extracted, '{}'::jsonb)
    else v_resume.extracted end;

  if v_resume.shidduchim_id is not null then
    update public.shidduchim set
      name_en = case when (name_en is null or btrim(name_en) = '') and jsonb_typeof(p_fields -> 'name_en') = 'string' then nullif(btrim(p_fields ->> 'name_en'), '') else name_en end,
      name_he = case when (name_he is null or btrim(name_he) = '') and jsonb_typeof(p_fields -> 'name_he') = 'string' then nullif(btrim(p_fields ->> 'name_he'), '') else name_he end,
      father_en = case when (father_en is null or btrim(father_en) = '') and jsonb_typeof(p_fields -> 'father_en') = 'string' then nullif(btrim(p_fields ->> 'father_en'), '') else father_en end,
      father_he = case when (father_he is null or btrim(father_he) = '') and jsonb_typeof(p_fields -> 'father_he') = 'string' then nullif(btrim(p_fields ->> 'father_he'), '') else father_he end,
      mother_en = case when (mother_en is null or btrim(mother_en) = '') and jsonb_typeof(p_fields -> 'mother_en') = 'string' then nullif(btrim(p_fields ->> 'mother_en'), '') else mother_en end,
      mother_he = case when (mother_he is null or btrim(mother_he) = '') and jsonb_typeof(p_fields -> 'mother_he') = 'string' then nullif(btrim(p_fields ->> 'mother_he'), '') else mother_he end,
      seminary_en = case when (seminary_en is null or btrim(seminary_en) = '') and jsonb_typeof(p_fields -> 'seminary_en') = 'string' then nullif(btrim(p_fields ->> 'seminary_en'), '') else seminary_en end,
      seminary_he = case when (seminary_he is null or btrim(seminary_he) = '') and jsonb_typeof(p_fields -> 'seminary_he') = 'string' then nullif(btrim(p_fields ->> 'seminary_he'), '') else seminary_he end,
      shul_en = case when (shul_en is null or btrim(shul_en) = '') and jsonb_typeof(p_fields -> 'shul_en') = 'string' then nullif(btrim(p_fields ->> 'shul_en'), '') else shul_en end,
      shul_he = case when (shul_he is null or btrim(shul_he) = '') and jsonb_typeof(p_fields -> 'shul_he') = 'string' then nullif(btrim(p_fields ->> 'shul_he'), '') else shul_he end,
      location_en = case when (location_en is null or btrim(location_en) = '') and jsonb_typeof(p_fields -> 'location_en') = 'string' then nullif(btrim(p_fields ->> 'location_en'), '') else location_en end,
      location_he = case when (location_he is null or btrim(location_he) = '') and jsonb_typeof(p_fields -> 'location_he') = 'string' then nullif(btrim(p_fields ->> 'location_he'), '') else location_he end,
      age = case when age is null and jsonb_typeof(p_fields -> 'age') = 'number' and p_fields ->> 'age' ~ '^-?[0-9]+$' then (p_fields ->> 'age')::integer else age end,
      height = case when (height is null or btrim(height) = '') and jsonb_typeof(p_fields -> 'height') = 'string' then nullif(btrim(p_fields ->> 'height'), '') else height end,
      person_gender = case when (person_gender is null or btrim(person_gender) = '') and jsonb_typeof(p_fields -> 'person_gender') = 'string' then nullif(btrim(p_fields ->> 'person_gender'), '') else person_gender end,
      kohen_status = case when (kohen_status is null or btrim(kohen_status) = '') and jsonb_typeof(p_fields -> 'kohen_status') = 'string' then nullif(btrim(p_fields ->> 'kohen_status'), '') else kohen_status end,
      marital_status = case when (marital_status is null or btrim(marital_status) = '') and jsonb_typeof(p_fields -> 'marital_status') = 'string' then nullif(btrim(p_fields ->> 'marital_status'), '') else marital_status end
    where id = v_resume.shidduchim_id and account_id = p_account_id;
    if not found then
      raise exception 'resume % has no owned shidduch %', p_resume_id, v_resume.shidduchim_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  update public.resumes set extracted = v_extracted, sections = v_sections
  where id = p_resume_id and account_id = p_account_id;
  if not found then raise exception 'resume % disappeared during apply', p_resume_id; end if;

  update public.ai_reread_attempts
  set status = 'completed', result_schema_version = p_schema_version,
      lease_expires_at = now(), updated_at = now()
  where id = p_attempt_id and account_id = p_account_id and resume_id = p_resume_id
    and status = 'in_progress' and generation = p_generation;
  if not found then raise exception 'resume read completion fence changed'; end if;
  return jsonb_build_object('outcome', 'applied');
end;
$$;

revoke all on function public.apply_ai_resume_read(bigint, bigint, bigint, bigint, text, jsonb, jsonb, jsonb, smallint) from public, anon, authenticated;
grant execute on function public.apply_ai_resume_read(bigint, bigint, bigint, bigint, text, jsonb, jsonb, jsonb, smallint) to service_role;
