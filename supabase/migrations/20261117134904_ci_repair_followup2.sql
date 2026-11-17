set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_shidduch(p_single_id bigint, p_shadchan_id bigint DEFAULT NULL::bigint, p_name_en text DEFAULT NULL::text, p_name_he text DEFAULT NULL::text, p_father_en text DEFAULT NULL::text, p_father_he text DEFAULT NULL::text, p_mother_en text DEFAULT NULL::text, p_mother_he text DEFAULT NULL::text, p_dob date DEFAULT NULL::date, p_background text DEFAULT NULL::text, p_marital_status text DEFAULT NULL::text, p_existing_children_note text DEFAULT NULL::text, p_seminary_en text DEFAULT NULL::text, p_seminary_he text DEFAULT NULL::text, p_shul_en text DEFAULT NULL::text, p_shul_he text DEFAULT NULL::text, p_location_en text DEFAULT NULL::text, p_location_he text DEFAULT NULL::text, p_age integer DEFAULT NULL::integer, p_height text DEFAULT NULL::text, p_origin text DEFAULT 'manual'::text, p_initial_state public.pipeline_state DEFAULT 'new'::public.pipeline_state, p_visibility text DEFAULT 'shared'::text, p_redt_date date DEFAULT NULL::date, p_person_gender text DEFAULT NULL::text, p_kohen_status text DEFAULT 'unknown'::text)
 RETURNS SETOF public.shidduchim
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_owner_member_id bigint;
  v_id bigint;
  v_redt_date date;
  v_gender text;
begin
  v_account_id := public.current_context_id();
  if public.current_member_role() = 'single' then
    raise exception 'new row violates row-level security policy for table "shidduchim"'
      using errcode = 'insufficient_privilege';
  end if;
  if v_account_id is null then
    raise exception 'no account context for create_shidduch (no account exists)';
  end if;

  if p_initial_state not in ('new', 'look_into', 'not_sure', 'for_sure_not') then
    raise exception 'invalid initial pipeline_state: % (decision states are reachable only from look_into)', p_initial_state
      using errcode = 'check_violation';
  end if;

  -- Never cross the account boundary (AD-1): the single/shadchan must
  -- belong to the caller's account.
  if not exists (
    select 1 from public.singles c
    where c.id = p_single_id and c.account_id = v_account_id
  ) then
    raise exception 'single % not found in current account', p_single_id;
  end if;

  if p_shadchan_id is not null and not exists (
    select 1 from public.shadchanim s
    where s.id = p_shadchan_id and s.account_id = v_account_id
  ) then
    raise exception 'shadchan % not found in current account', p_shadchan_id;
  end if;

  select am.id into v_owner_member_id
  from public.account_members am
  where am.user_id = auth.uid() and am.account_id = v_account_id
  order by am.id
  limit 1;

  v_redt_date := coalesce(p_redt_date, current_date);

  insert into public.shidduchim (
    account_id, single_id, shadchan_id,
    name_en, name_he,
    father_en, father_he, mother_en, mother_he,
    dob, background, marital_status, existing_children_note,
    seminary_en, seminary_he,
    shul_en, shul_he, location_en, location_he,
    age, height,
    pipeline_state, first_suggested_by, first_suggested_at, redt_date,
    origin, owner_member_id, visibility,
    person_gender, kohen_status
  ) values (
    v_account_id, p_single_id, p_shadchan_id,
    p_name_en, p_name_he,
    p_father_en, p_father_he, p_mother_en, p_mother_he,
    p_dob, p_background, p_marital_status, p_existing_children_note,
    p_seminary_en, p_seminary_he,
    p_shul_en, p_shul_he, p_location_en, p_location_he,
    p_age, p_height,
    p_initial_state, p_shadchan_id, v_redt_date, v_redt_date,
    p_origin, v_owner_member_id, p_visibility,
    p_person_gender, p_kohen_status
  )
  returning id into v_id;

  -- The first redt event. The refresh trigger keeps shidduchim.redt_date etc.
  -- in sync as more redts are added.
  insert into public.redts (account_id, shidduchim_id, shadchan_id, redt_date)
  values (v_account_id, v_id, p_shadchan_id, v_redt_date);

  -- Record the headline seminary/yeshiva as the first education entry. The
  -- prospect is the opposite gender of the single (a match for a girl is a
  -- boy -> yeshiva; a match for a boy is a girl -> seminary). Additional
  -- education entries via add_education().
  if p_seminary_en is not null or p_seminary_he is not null then
    select gender into v_gender from public.singles where id = p_single_id;
    insert into public.shidduch_education (account_id, shidduchim_id, kind, name_en, name_he)
    values (
      v_account_id, v_id,
      case when v_gender = 'male' then 'seminary' else 'yeshiva' end,
      p_seminary_en, p_seminary_he
    );
  end if;

  return query select * from public.shidduch_row(v_id);
end;
$function$
;
-- Rev2 follow-up: account deletion and shidduch-owned writers share one
-- parent-first lock order. The ordered parent locks are held before the
-- account advisory lock, so a writer cannot hold the advisory while waiting
-- for a parent row that an account FK cascade already owns.
CREATE OR REPLACE FUNCTION public.account_storage_cleanup_fence(p_account_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform 1
  from public.shidduchim
  where account_id = p_account_id
  order by id
  for share;
  perform public.account_storage_lock(p_account_id);
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
$function$
;

revoke all on function public.entity_files_target_guard() from public, anon, authenticated;
revoke all on function public.shidduch_delete_tombstone() from public, anon, authenticated;

-- Archived suggestions must never participate in repeat-hint matching. Keep
-- this body aligned with the declarative 02_functions.sql dump.
CREATE OR REPLACE FUNCTION public.match_identity(
  p_target_type text,
  p_name_en text DEFAULT NULL::text,
  p_name_he text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_parents text DEFAULT NULL::text,
  p_seminary text DEFAULT NULL::text,
  p_shul text DEFAULT NULL::text,
  p_location text DEFAULT NULL::text,
  p_exclude_target_id bigint DEFAULT NULL::bigint
)
RETURNS TABLE(target_id bigint, confidence numeric, deciding_facts jsonb)
LANGUAGE plpgsql STABLE
SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_name_en_norm text;
  v_name_he_norm text;
  v_name_en_key text;
  v_name_he_key text;
  v_phone_norm text;
  v_parents_norm text;
  v_seminary_norm text;
  v_shul_norm text;
  v_location_norm text;
begin
  if p_target_type not in ('reference', 'shidduch', 'date_record') then
    raise exception 'unknown identity target_type: %', p_target_type
      using errcode = 'check_violation';
  end if;

  v_account_id := public.current_context_id();
  if v_account_id is null then
    return;
  end if;

  v_name_en_norm := public.normalize_identity_text(p_name_en);
  v_name_he_norm := public.normalize_identity_text(p_name_he);
  v_name_en_key := public.identity_name_key(p_name_en);
  v_name_he_key := public.identity_name_key(p_name_he);
  v_phone_norm := public.normalize_phone(p_phone);
  v_parents_norm := public.normalize_identity_text(p_parents);
  v_seminary_norm := public.normalize_identity_text(p_seminary);
  v_shul_norm := public.normalize_identity_text(p_shul);
  v_location_norm := public.normalize_identity_text(p_location);

  if v_phone_norm is null and v_name_en_norm is null and v_name_he_norm is null then
    return;
  end if;

  return query
  with scored as (
    select
      s.target_id as sig_target_id,
      (v_phone_norm is not null and s.phone_norm = v_phone_norm) as phone_hit,
      (
        (v_name_en_norm is not null and s.name_en_norm = v_name_en_norm)
        or (v_name_he_norm is not null and s.name_he_norm = v_name_he_norm)
      ) as name_exact,
      (
        (v_name_en_key is not null and s.name_en_key = v_name_en_key)
        or (v_name_he_key is not null and s.name_he_key = v_name_he_key)
      ) as name_variant,
      (v_parents_norm is not null and s.parents_norm = v_parents_norm) as parents_hit,
      (v_seminary_norm is not null and s.seminary_norm = v_seminary_norm) as seminary_hit,
      (v_shul_norm is not null and s.shul_norm = v_shul_norm) as shul_hit,
      (v_location_norm is not null and s.location_norm = v_location_norm) as location_hit
    from public.identity_signals s
    left join public.shidduchim candidate
      on p_target_type = 'shidduch'
     and candidate.id = s.target_id
    where s.account_id = v_account_id
      and s.target_type = p_target_type
      and (p_exclude_target_id is null or s.target_id <> p_exclude_target_id)
      and (
        p_target_type <> 'shidduch'
        or (
          candidate.id is not null
          and candidate.archived_at is null
          and not coalesce(public.shidduch_has_known_halachic_conflict(
            candidate.single_id,
            candidate.person_gender,
            candidate.kohen_status,
            candidate.marital_status
          ), false)
        )
      )
  ),
  weighted as (
    select
      sc.*,
      (sc.parents_hit::int + sc.seminary_hit::int + sc.shul_hit::int + sc.location_hit::int) as corroborators
    from scored sc
  )
  select
    w.sig_target_id,
    case
      when w.phone_hit and (w.name_exact or w.name_variant) then 0.98
      when w.phone_hit then 0.90
      when w.name_exact and w.corroborators >= 2 then 0.85
      when w.name_exact and w.corroborators = 1 then 0.75
      when w.name_variant and w.corroborators >= 2 then 0.70
      when w.name_variant and w.corroborators = 1 then 0.60
    end::numeric,
    (
      select coalesce(jsonb_agg(f.fact), '[]'::jsonb)
      from (
        select jsonb_build_object('signal', 'phone', 'detail', 'phone number matches exactly') as fact
          where w.phone_hit
        union all
        select jsonb_build_object('signal', 'name', 'detail', 'name matches exactly')
          where w.name_exact
        union all
        select jsonb_build_object('signal', 'name', 'detail', 'name matches as a Hebrew/English spelling variant')
          where w.name_variant and not w.name_exact
        union all
        select jsonb_build_object('signal', 'parents', 'detail', 'same parents')
          where w.parents_hit
        union all
        select jsonb_build_object('signal', 'school', 'detail', 'same school or seminary')
          where w.seminary_hit
        union all
        select jsonb_build_object('signal', 'shul', 'detail', 'same shul')
          where w.shul_hit
        union all
        select jsonb_build_object('signal', 'location', 'detail', 'same location')
          where w.location_hit
      ) f
    )
  from weighted w
  where w.phone_hit
     or ((w.name_exact or w.name_variant) and w.corroborators >= 1)
  order by 2 desc, 1 asc
  limit 10;
end;
$function$
;
