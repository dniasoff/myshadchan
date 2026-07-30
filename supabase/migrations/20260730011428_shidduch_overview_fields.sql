drop function if exists "public"."create_shidduch"(p_single_id bigint, p_shadchan_id bigint, p_name_en text, p_name_he text, p_parents_en text, p_parents_he text, p_seminary_en text, p_seminary_he text, p_shul_en text, p_shul_he text, p_location_en text, p_location_he text, p_age integer, p_height text, p_origin text, p_initial_state public.pipeline_state, p_visibility text, p_redt_date date);

drop view if exists "public"."reference_links_summary";

drop view if exists "public"."shadchan_stats";

drop view if exists "public"."shidduchim_summary";

drop view if exists "public"."singles_summary";

alter table "public"."shidduchim" drop column "parents_en";

alter table "public"."shidduchim" drop column "parents_he";

alter table "public"."shidduchim" add column "background" text;

alter table "public"."shidduchim" add column "dob" date;

alter table "public"."shidduchim" add column "existing_children_note" text;

alter table "public"."shidduchim" add column "father_en" text;

alter table "public"."shidduchim" add column "father_he" text;

alter table "public"."shidduchim" add column "marital_status" text;

alter table "public"."shidduchim" add column "mother_en" text;

alter table "public"."shidduchim" add column "mother_he" text;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_shidduch(p_single_id bigint, p_shadchan_id bigint DEFAULT NULL::bigint, p_name_en text DEFAULT NULL::text, p_name_he text DEFAULT NULL::text, p_father_en text DEFAULT NULL::text, p_father_he text DEFAULT NULL::text, p_mother_en text DEFAULT NULL::text, p_mother_he text DEFAULT NULL::text, p_dob date DEFAULT NULL::date, p_background text DEFAULT NULL::text, p_marital_status text DEFAULT NULL::text, p_existing_children_note text DEFAULT NULL::text, p_seminary_en text DEFAULT NULL::text, p_seminary_he text DEFAULT NULL::text, p_shul_en text DEFAULT NULL::text, p_shul_he text DEFAULT NULL::text, p_location_en text DEFAULT NULL::text, p_location_he text DEFAULT NULL::text, p_age integer DEFAULT NULL::integer, p_height text DEFAULT NULL::text, p_origin text DEFAULT 'manual'::text, p_initial_state public.pipeline_state DEFAULT 'new'::public.pipeline_state, p_visibility text DEFAULT 'shared'::text, p_redt_date date DEFAULT NULL::date)
 RETURNS SETOF public.shidduchim
 LANGUAGE plpgsql
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
    origin, owner_member_id, visibility
  ) values (
    v_account_id, p_single_id, p_shadchan_id,
    p_name_en, p_name_he,
    p_father_en, p_father_he, p_mother_en, p_mother_he,
    p_dob, p_background, p_marital_status, p_existing_children_note,
    p_seminary_en, p_seminary_he,
    p_shul_en, p_shul_he, p_location_en, p_location_he,
    p_age, p_height,
    p_initial_state, p_shadchan_id, v_redt_date, v_redt_date,
    p_origin, v_owner_member_id, p_visibility
  )
  returning id into v_id;

  -- The first redt event. The refresh trigger keeps shidduchim.redt_date etc.
  -- in sync as more redts are added.
  insert into public.redts (account_id, shidduchim_id, shadchan_id, redt_date)
  values (v_account_id, v_id, p_shadchan_id, v_redt_date);

  -- Record the headline seminary/yeshiva as the first school entry. The prospect
  -- is the opposite gender of the single (a match for a girl is a boy -> yeshiva;
  -- a match for a boy is a girl -> seminary). Additional schools via add_school().
  if p_seminary_en is not null or p_seminary_he is not null then
    select gender into v_gender from public.singles where id = p_single_id;
    insert into public.shidduch_schools (account_id, shidduchim_id, kind, name_en, name_he)
    values (
      v_account_id, v_id,
      case when v_gender = 'male' then 'seminary' else 'yeshiva' end,
      p_seminary_en, p_seminary_he
    );
  end if;

  return query select * from public.shidduchim where id = v_id;
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

  select * into v_s
  from public.shidduchim s
  where s.id = p_shidduchim_id and s.account_id = v_account_id;

  if not found then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
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

create or replace view "public"."reference_links_summary" as  SELECT rl.id,
    rl.account_id,
    rl.created_at,
    rl.reference_id,
    rl.shidduchim_id,
    rl.resume_id,
    rl.call_status,
    rl.what_they_said,
    rl.conversation_log,
    rl.relationship_override,
    COALESCE(rl.relationship_override, r.relationship) AS effective_relationship,
    COALESCE(jsonb_array_length(rl.conversation_log), 0) AS conversation_log_count,
    r.name_en AS reference_name_en,
    r.name_he AS reference_name_he,
    r.phone AS reference_phone,
    s.name_en AS shidduch_name_en,
    s.name_he AS shidduch_name_he,
    s.pipeline_state AS shidduch_pipeline_state,
    s.visibility AS shidduch_visibility,
    s.single_id,
    c.first_name_en AS single_first_name_en,
    c.first_name_he AS single_first_name_he
   FROM (((public.reference_links rl
     LEFT JOIN public."references" r ON ((r.id = rl.reference_id)))
     LEFT JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
     LEFT JOIN public.singles c ON ((c.id = s.single_id)));


create or replace view "public"."shadchan_stats" as  SELECT sh.id,
    sh.account_id,
    count(s.id) AS nb_suggestions,
    count(s.id) FILTER (WHERE (s.pipeline_state <> 'new'::public.pipeline_state)) AS nb_progressed,
    count(s.id) FILTER (WHERE (s.pipeline_state = 'yes'::public.pipeline_state)) AS nb_reached_yes
   FROM (public.shadchanim sh
     LEFT JOIN public.shidduchim s ON ((s.shadchan_id = sh.id)))
  GROUP BY sh.id;


create or replace view "public"."shidduchim_summary" as  SELECT s.id,
    s.account_id,
    s.created_at,
    s.single_id,
    s.shadchan_id,
    s.name_en,
    s.name_he,
    s.father_en,
    s.father_he,
    s.mother_en,
    s.mother_he,
    s.seminary_en,
    s.seminary_he,
    s.shul_en,
    s.shul_he,
    s.location_en,
    s.location_he,
    s.age,
    s.height,
    s.dob,
    s.background,
    s.marital_status,
    s.existing_children_note,
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
    c.first_name_en AS single_first_name_en,
    c.first_name_he AS single_first_name_he,
    c.last_name_en AS single_last_name_en,
    c.last_name_he AS single_last_name_he,
    count(DISTINCT rl.id) AS nb_references,
    count(DISTINCT r.id) AS nb_redts,
    COALESCE(max(cat.catch_count), (0)::bigint) AS catch_count
   FROM (((((public.shidduchim s
     LEFT JOIN public.shadchanim sh ON ((sh.id = s.shadchan_id)))
     LEFT JOIN public.singles c ON ((c.id = s.single_id)))
     LEFT JOIN public.reference_links rl ON ((rl.shidduchim_id = s.id)))
     LEFT JOIN public.redts r ON ((r.shidduchim_id = s.id)))
     LEFT JOIN public.shidduchim_catch_summary cat ON ((cat.shidduchim_id = s.id)))
  GROUP BY s.id, sh.name, sh.name_he, c.first_name_en, c.first_name_he, c.last_name_en, c.last_name_he;


create or replace view "public"."singles_summary" as  SELECT c.id,
    c.account_id,
    c.created_at,
    c.first_name_en,
    c.first_name_he,
    c.last_name_en,
    c.last_name_he,
    c.gender,
    c.dob,
    c.community,
    c.status,
    c.member_id,
    count(s.id) AS total_shidduchim,
    count(s.id) FILTER (WHERE (s.pipeline_state = ANY (ARRAY['new'::public.pipeline_state, 'look_into'::public.pipeline_state, 'not_sure'::public.pipeline_state]))) AS open_shidduchim
   FROM (public.singles c
     LEFT JOIN public.shidduchim s ON ((s.single_id = c.id)))
  GROUP BY c.id;


CREATE OR REPLACE FUNCTION public.sync_shidduch_identity_signals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.identity_signals (
    account_id, target_type, target_id,
    name_en_norm, name_he_norm, name_en_key, name_he_key,
    parents_norm, seminary_norm, shul_norm, location_norm
  ) values (
    new.account_id, 'shidduch', new.id,
    public.normalize_identity_text(new.name_en),
    public.normalize_identity_text(new.name_he),
    public.identity_name_key(new.name_en),
    public.identity_name_key(new.name_he),
    public.normalize_identity_text(nullif(trim(
      coalesce(new.father_en, new.father_he, '') || ' ' ||
      coalesce(new.mother_en, new.mother_he, '')
    ), '')),
    public.normalize_identity_text(coalesce(new.seminary_en, new.seminary_he)),
    public.normalize_identity_text(coalesce(new.shul_en, new.shul_he)),
    public.normalize_identity_text(coalesce(new.location_en, new.location_he))
  )
  on conflict (account_id, target_type, target_id) do update
  set name_en_norm = excluded.name_en_norm,
      name_he_norm = excluded.name_he_norm,
      name_en_key = excluded.name_en_key,
      name_he_key = excluded.name_he_key,
      parents_norm = excluded.parents_norm,
      seminary_norm = excluded.seminary_norm,
      shul_norm = excluded.shul_norm,
      location_norm = excluded.location_norm;

  return null;
end;
$function$
;

-- Review fix F3 (Story 5.2). `sync_shidduch_signals` only fires `after
-- insert or update` — a `DROP COLUMN`/`ADD COLUMN` on the table does not
-- fire row-level triggers at all, so every pre-existing row's
-- `identity_signals.parents_norm` is still whatever the OLD trigger body
-- computed from the now-dropped `parents_en`/`parents_he`, permanently
-- stale. `shidduchim_catch_summary` (03_views.sql) reads that stored value,
-- while `catch_shidduch()` derives its own copy live from father/mother — so
-- every legacy shidduch that used to corroborate on parents keeps a "prior
-- suggestion" badge whose evidence panel silently comes up empty. A no-op
-- UPDATE re-fires the trigger (it has no column list and no WHEN clause) for
-- every row with the function just redefined above, resyncing every signal
-- column, not only parents_norm.
update public.shidduchim set id = id;

-- MANUAL ADJUSTMENTS (see AGENTS.md). `supabase db diff` emits none of the
-- following, and none of it is cosmetic.
--
-- Removing `parents_en`/`parents_he` from the middle of `shidduchim`'s
-- column list is not append-only, so `shidduchim_summary` cannot be
-- CREATE OR REPLACE'd in place (Postgres requires the same column names in
-- the same order for that) — the diff above drops and recreates it. That
-- drop appears to have taken three sibling views down with it
-- (`reference_links_summary`, `shadchan_stats`, `singles_summary`), none of
-- which reference the changed columns; this is `db diff`'s dependency
-- tracking on `public.shidduchim`, not anything this story asked to change.
-- All four come back below exactly as they were, plus two things
-- `CREATE OR REPLACE VIEW`/a fresh `CREATE VIEW` never carries forward:
--
-- 1. It drops `WITH (security_invoker = on)` when it writes a view. Without
--    it these views execute as their owner and RLS never runs — a
--    cross-account read.
alter view "public"."reference_links_summary" set (security_invoker = on);
alter view "public"."shadchan_stats" set (security_invoker = on);
alter view "public"."shidduchim_summary" set (security_invoker = on);
alter view "public"."singles_summary" set (security_invoker = on);

-- 2. It does not diff view privileges at all, so a dropped-and-recreated
--    view keeps only the schema default privileges, not the grants
--    `06_grants.sql` declares. Re-issue them verbatim so `authenticated`
--    is not silently locked out of the board / roster / reference-diligence
--    reads these views back.
revoke all on table "public"."shidduchim_summary" from "anon";
grant all on table "public"."shidduchim_summary" to "authenticated";
grant all on table "public"."shidduchim_summary" to "service_role";

revoke all on table "public"."reference_links_summary" from "anon", "authenticated";
grant select on table "public"."reference_links_summary" to "authenticated";
grant all on table "public"."reference_links_summary" to "service_role";

revoke all on table "public"."singles_summary" from "anon", "authenticated";
grant select on table "public"."singles_summary" to "authenticated";
grant all on table "public"."singles_summary" to "service_role";

revoke all on table "public"."shadchan_stats" from "anon", "authenticated";
grant select on table "public"."shadchan_stats" to "authenticated";
grant all on table "public"."shadchan_stats" to "service_role";

-- 3. The same privilege gap applies to `create_shidduch()` itself: the
--    signature change forces the DROP FUNCTION / CREATE FUNCTION above, and
--    a fresh function starts with EXECUTE granted to PUBLIC by default
--    (Postgres's own default, not this schema's) — the opposite problem
--    from the two views (too permissive, not too locked-down): until this
--    runs, `anon` can call it. Re-issue `06_grants.sql`'s three lines
--    against the new 24-argument signature.
revoke all on function public.create_shidduch(bigint, bigint, text, text, text, text, text, text, date, text, text, text, text, text, text, text, text, text, integer, text, text, public.pipeline_state, text, date) from public, anon;
grant execute on function public.create_shidduch(bigint, bigint, text, text, text, text, text, text, date, text, text, text, text, text, text, text, text, text, integer, text, text, public.pipeline_state, text, date) to authenticated;
grant execute on function public.create_shidduch(bigint, bigint, text, text, text, text, text, text, date, text, text, text, text, text, text, text, text, text, integer, text, text, public.pipeline_state, text, date) to service_role;


