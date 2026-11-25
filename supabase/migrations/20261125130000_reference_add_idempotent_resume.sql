set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.add_resume_reference_to_shidduch(p_shidduchim_id bigint, p_name_en text DEFAULT NULL::text, p_name_he text DEFAULT NULL::text, p_relationship text DEFAULT NULL::text, p_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint := public.current_context_id();
  v_reference_id bigint;
  v_link_id bigint;
  v_name_norm text;
  v_phone_norm text;
  v_name_matches bigint[];
  v_phone_matches bigint[];
  v_combined_matches bigint[];
  v_ambiguous_ids bigint[];
  v_created boolean := false;
begin
  if v_account_id is null then raise exception 'no account context for add_resume_reference_to_shidduch'; end if;
  if public.current_member_role() = 'single' then
    raise exception 'a single cannot create references' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.shidduchim s where s.id = p_shidduchim_id and s.account_id = v_account_id) then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;
  perform public.account_storage_lock(v_account_id);
  v_name_norm := public.normalize_identity_text(coalesce(p_name_en, p_name_he));
  v_phone_norm := public.normalize_phone(p_phone);
  if v_name_norm is null and v_phone_norm is null then
    raise exception 'a reference needs a name or phone number' using errcode = 'invalid_parameter_value';
  end if;
  select array_agg(r.id order by r.id) into v_name_matches from public."references" r
    where r.account_id = v_account_id and v_name_norm is not null
      and (r.name_norm_en = v_name_norm or r.name_norm_he = v_name_norm);
  select array_agg(r.id order by r.id) into v_phone_matches from public."references" r
    where r.account_id = v_account_id and v_phone_norm is not null and r.phone_norm = v_phone_norm;
  select array_agg(r.id order by r.id) into v_combined_matches from public."references" r
    where r.account_id = v_account_id and v_phone_norm is not null and v_name_norm is not null
      and r.phone_norm = v_phone_norm and (r.name_norm_en = v_name_norm or r.name_norm_he = v_name_norm);
  if v_phone_norm is not null then
    if coalesce(cardinality(v_combined_matches), 0) = 1 then v_reference_id := v_combined_matches[1];
    elsif coalesce(cardinality(v_combined_matches), 0) > 1 then v_ambiguous_ids := v_combined_matches;
    elsif coalesce(cardinality(v_phone_matches), 0) = 1 then
      if exists (select 1 from public."references" r where r.id = v_phone_matches[1] and r.account_id = v_account_id
        and ((r.name_norm_en is null and r.name_norm_he is null) or r.name_norm_en = v_name_norm or r.name_norm_he = v_name_norm))
      then v_reference_id := v_phone_matches[1];
      else
        v_ambiguous_ids := v_phone_matches;
        if coalesce(cardinality(v_name_matches), 0) > 0 then
          v_ambiguous_ids := v_ambiguous_ids || v_name_matches;
        end if;
      end if;
    elsif coalesce(cardinality(v_phone_matches), 0) > 1 then v_ambiguous_ids := v_phone_matches;
    elsif coalesce(cardinality(v_name_matches), 0) > 0 then v_ambiguous_ids := v_name_matches;
    end if;
  elsif coalesce(cardinality(v_name_matches), 0) = 1 then v_reference_id := v_name_matches[1];
  elsif coalesce(cardinality(v_name_matches), 0) > 1 then v_ambiguous_ids := v_name_matches;
  end if;
  if v_ambiguous_ids is not null then
    return jsonb_build_object('status', 'ambiguous', 'reference_id', null, 'link_id', null, 'candidates', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name_en', r.name_en, 'name_he', r.name_he, 'phone', r.phone, 'relationship', r.relationship) order by r.id)
      from public."references" r where r.account_id = v_account_id and r.id = any(v_ambiguous_ids)), '[]'::jsonb));
  end if;
  if v_reference_id is null then
    insert into public."references" (account_id, name_en, name_he, relationship, phone)
      values (v_account_id, p_name_en, p_name_he, p_relationship, p_phone) returning id into v_reference_id;
    v_created := true;
  end if;
  select rl.id into v_link_id from public.reference_links rl
    where rl.account_id = v_account_id and rl.reference_id = v_reference_id and rl.shidduchim_id = p_shidduchim_id limit 1;
  if v_link_id is null then
    insert into public.reference_links (account_id, reference_id, shidduchim_id, call_status, relationship_override)
      values (v_account_id, v_reference_id, p_shidduchim_id, 'not_started', p_relationship) returning id into v_link_id;
    insert into public.interactions (account_id, target_type, target_id, scope, reference_link_id, kind, body, metadata)
      values (v_account_id, 'reference', v_reference_id, 'shidduch', v_link_id, 'link_created', null,
        jsonb_build_object('shidduchim_id', p_shidduchim_id, 'source', 'resume_reference_add'));
  end if;
  return jsonb_build_object('status', case when v_created then 'created' else 'linked' end,
    'reference_id', v_reference_id, 'link_id', v_link_id, 'candidates', '[]'::jsonb);
end;
$function$
;

revoke all on function public.add_resume_reference_to_shidduch(bigint, text, text, text, text) from public, anon;
grant execute on function public.add_resume_reference_to_shidduch(bigint, text, text, text, text) to authenticated;
grant execute on function public.add_resume_reference_to_shidduch(bigint, text, text, text, text) to service_role;


