set check_function_bodies = off;

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
  v_account_id := public.current_account_id();
  if v_account_id is null then
    return jsonb_build_object('has_catch', false, 'suggestions', '[]'::jsonb, 'dates', '[]'::jsonb);
  end if;

  select * into v_s
  from public.shidduchim s
  where s.id = p_shidduchim_id and s.account_id = v_account_id;

  if not found then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;

  -- Prior suggestions: the shared matcher, excluding this very row. Each
  -- candidate is joined back to its child/shadchan so the panel renders the
  -- prior context ("suggested for {child}, via {shadchan}, {state}") in one hop.
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
      ps.child_id,
      c.first_name_en as child_first_name_en,
      c.first_name_he as child_first_name_he,
      sh.name as shadchan_name
    from public.match_identity(
      'shidduch',
      v_s.name_en,
      v_s.name_he,
      null,
      coalesce(v_s.parents_en, v_s.parents_he),
      coalesce(v_s.seminary_en, v_s.seminary_he),
      coalesce(v_s.shul_en, v_s.shul_he),
      coalesce(v_s.location_en, v_s.location_he),
      p_shidduchim_id
    ) m
      join public.shidduchim ps on ps.id = m.target_id
      left join public.children c on c.id = ps.child_id
      left join public.shadchanim sh on sh.id = ps.shadchan_id
  ) cand;

  -- Prior dating (honest, corroborated, never fabricated). date_records is not in
  -- identity_signals, so it is compared directly with the shared normalizers.
  v_name_en_norm := public.normalize_identity_text(v_s.name_en);
  v_name_he_norm := public.normalize_identity_text(v_s.name_he);
  v_name_en_key := public.identity_name_key(v_s.name_en);
  v_name_he_key := public.identity_name_key(v_s.name_he);
  v_parents_norm := public.normalize_identity_text(coalesce(v_s.parents_en, v_s.parents_he));
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
      dr.child_id,
      c.first_name_en as child_first_name_en
    from public.date_records dr
      left join public.children c on c.id = dr.child_id
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

create or replace view "public"."shidduchim_catch_summary" with (security_invoker = on) as  SELECT a.target_id AS shidduchim_id,
    a.account_id,
    count(DISTINCT b.target_id) AS catch_count
   FROM (public.identity_signals a
     JOIN public.identity_signals b ON (((b.account_id = a.account_id) AND (b.target_type = 'shidduch'::text) AND (b.target_id <> a.target_id) AND (((a.name_en_norm IS NOT NULL) AND (b.name_en_norm = a.name_en_norm)) OR ((a.name_he_norm IS NOT NULL) AND (b.name_he_norm = a.name_he_norm)) OR ((a.name_en_key IS NOT NULL) AND (b.name_en_key = a.name_en_key)) OR ((a.name_he_key IS NOT NULL) AND (b.name_he_key = a.name_he_key))) AND (((a.parents_norm IS NOT NULL) AND (b.parents_norm = a.parents_norm)) OR ((a.seminary_norm IS NOT NULL) AND (b.seminary_norm = a.seminary_norm)) OR ((a.shul_norm IS NOT NULL) AND (b.shul_norm = a.shul_norm)) OR ((a.location_norm IS NOT NULL) AND (b.location_norm = a.location_norm))))))
  WHERE (a.target_type = 'shidduch'::text)
  GROUP BY a.target_id, a.account_id;


create or replace view "public"."shidduchim_summary" with (security_invoker = on) as  SELECT s.id,
    s.account_id,
    s.created_at,
    s.child_id,
    s.shadchan_id,
    s.name_en,
    s.name_he,
    s.parents_en,
    s.parents_he,
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
    s.close_reason,
    s.origin,
    s.owner_member_id,
    s.visibility,
    s.index,
    sh.name AS shadchan_name,
    sh.name_he AS shadchan_name_he,
    c.first_name_en AS child_first_name_en,
    c.first_name_he AS child_first_name_he,
    c.last_name_en AS child_last_name_en,
    c.last_name_he AS child_last_name_he,
    count(DISTINCT rl.id) AS nb_references,
    count(DISTINCT r.id) AS nb_redts,
    COALESCE(max(cat.catch_count), (0)::bigint) AS catch_count
   FROM (((((public.shidduchim s
     LEFT JOIN public.shadchanim sh ON ((sh.id = s.shadchan_id)))
     LEFT JOIN public.children c ON ((c.id = s.child_id)))
     LEFT JOIN public.reference_links rl ON ((rl.shidduchim_id = s.id)))
     LEFT JOIN public.redts r ON ((r.shidduchim_id = s.id)))
     LEFT JOIN public.shidduchim_catch_summary cat ON ((cat.shidduchim_id = s.id)))
  GROUP BY s.id, sh.name, sh.name_he, c.first_name_en, c.first_name_he, c.last_name_en, c.last_name_he;

-- Grants for the new objects. `db diff` does not emit these, and the schema's
-- default privileges auto-grant EXECUTE on new functions to anon, so
-- catch_shidduch must be explicitly revoked from anon. The catch summary view is
-- an aggregate read path: SELECT-only for authenticated, never anon.
revoke all on table "public"."shidduchim_catch_summary" from anon, authenticated;
grant select on table "public"."shidduchim_catch_summary" to authenticated;
grant all on table "public"."shidduchim_catch_summary" to service_role;

revoke all on function "public"."catch_shidduch"(bigint) from public, anon;
grant execute on function "public"."catch_shidduch"(bigint) to authenticated;
grant execute on function "public"."catch_shidduch"(bigint) to service_role;



