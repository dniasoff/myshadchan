-- ---------------------------------------------------------------------------
-- MANUAL REWRITE (see AGENTS.md / story 1-3-rename-children-to-singles).
-- `supabase db diff` emitted a destructive DROP TABLE public.children +
-- CREATE TABLE public.singles (plus DROP COLUMN/ADD COLUMN for every renamed
-- FK column), which would delete every single and every FK to them. This
-- migration replaces that output with ALTER ... RENAME statements that
-- preserve data, OIDs and (for the table itself) existing grants.
--
-- Views whose ALIASED output columns change name (child_id -> single_id,
-- child_first_name_en -> single_first_name_en, etc.) genuinely cannot be
-- patched via CREATE OR REPLACE VIEW (Postgres forbids renaming an existing
-- output column that way), so those three views are dropped and recreated,
-- with `security_invoker = on` and the anon-revoke/authenticated-grant
-- triplet re-added by hand, exactly as `db diff` does not diff either.
-- ---------------------------------------------------------------------------

-- Drop the views/functions whose column or parameter names change, before
-- renaming what they depend on.
drop view if exists "public"."children_summary";

drop view if exists "public"."reference_links_summary";

drop view if exists "public"."shidduchim_summary";

drop function if exists "public"."is_child_visible_state"(s public.pipeline_state);

drop function if exists "public"."create_shidduch"(p_child_id bigint, p_shadchan_id bigint, p_name_en text, p_name_he text, p_parents_en text, p_parents_he text, p_seminary_en text, p_seminary_he text, p_shul_en text, p_shul_he text, p_location_en text, p_location_he text, p_age integer, p_height text, p_origin text, p_initial_state public.pipeline_state, p_visibility text, p_redt_date date);

-- The table itself. A plain rename preserves data, RLS enablement and every
-- existing table grant (grants are keyed by relation OID, not by name).
alter table public.children rename to singles;

-- A table rename does NOT rename its owned identity sequence.
alter sequence public.children_id_seq rename to singles_id_seq;

-- Renaming a constraint that owns an index (PK / UNIQUE) also renames the
-- backing index, so children_pkey/children_account_id_id_key need no
-- separate ALTER INDEX.
alter table public.singles rename constraint children_pkey to singles_pkey;
alter table public.singles rename constraint children_account_id_id_key to singles_account_id_id_key;
alter table public.singles rename constraint children_account_id_fkey to singles_account_id_fkey;
alter table public.singles rename constraint children_member_id_fkey to singles_member_id_fkey;

alter index public.children_account_id_idx rename to singles_account_id_idx;

alter policy "Children scoped to account" on public.singles rename to "Singles scoped to account";

alter trigger set_children_account_id on public.singles rename to set_singles_account_id;

-- shidduchim.child_id -> single_id
alter table public.shidduchim rename column child_id to single_id;
alter table public.shidduchim rename constraint shidduchim_child_id_fkey to shidduchim_single_id_fkey;
alter index public.shidduchim_child_id_idx rename to shidduchim_single_id_idx;

-- date_records.child_id -> single_id
alter table public.date_records rename column child_id to single_id;
alter table public.date_records rename constraint date_records_child_id_fkey to date_records_single_id_fkey;
alter index public.date_records_child_id_idx rename to date_records_single_id_idx;

-- inbox_items.child_id -> single_id (no FK, no index on this column)
alter table public.inbox_items rename column child_id to single_id;

-- private_child -> private_single: migrate the data BEFORE re-adding the
-- narrowed constraint, so no existing row is left violating it.
alter table public.shidduchim drop constraint shidduchim_visibility_check;

update public.shidduchim set visibility = 'private_single' where visibility = 'private_child';

alter table public.shidduchim
    add constraint shidduchim_visibility_check check (
        visibility in ('shared', 'private_parent', 'private_single')
    );

-- Recreate the two dropped functions under their new name/parameter, then
-- re-issue their grants — grants die with a dropped function.
CREATE OR REPLACE FUNCTION public.is_single_visible_state(s public.pipeline_state)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  case s
    when 'look_into' then return true;
    when 'yes' then return true;
    when 'unsure' then return true;
    when 'new' then return false;
    when 'not_sure' then return false;
    when 'for_sure_not' then return false;
    when 'no' then return false;
    else
      raise exception 'unclassified pipeline_state in single-visibility policy: %', s;
  end case;
end;
$function$
;

revoke all on function public.is_single_visible_state(public.pipeline_state) from public, anon;
grant execute on function public.is_single_visible_state(public.pipeline_state) to authenticated;
grant execute on function public.is_single_visible_state(public.pipeline_state) to service_role;

CREATE OR REPLACE FUNCTION public.create_shidduch(p_single_id bigint, p_shadchan_id bigint DEFAULT NULL::bigint, p_name_en text DEFAULT NULL::text, p_name_he text DEFAULT NULL::text, p_parents_en text DEFAULT NULL::text, p_parents_he text DEFAULT NULL::text, p_seminary_en text DEFAULT NULL::text, p_seminary_he text DEFAULT NULL::text, p_shul_en text DEFAULT NULL::text, p_shul_he text DEFAULT NULL::text, p_location_en text DEFAULT NULL::text, p_location_he text DEFAULT NULL::text, p_age integer DEFAULT NULL::integer, p_height text DEFAULT NULL::text, p_origin text DEFAULT 'manual'::text, p_initial_state public.pipeline_state DEFAULT 'new'::public.pipeline_state, p_visibility text DEFAULT 'shared'::text, p_redt_date date DEFAULT NULL::date)
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
  v_account_id := public.current_account_id();
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
    parents_en, parents_he, seminary_en, seminary_he,
    shul_en, shul_he, location_en, location_he,
    age, height,
    pipeline_state, first_suggested_by, first_suggested_at, redt_date,
    origin, owner_member_id, visibility
  ) values (
    v_account_id, p_single_id, p_shadchan_id,
    p_name_en, p_name_he,
    p_parents_en, p_parents_he, p_seminary_en, p_seminary_he,
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

revoke all on function public.create_shidduch(bigint, bigint, text, text, text, text, text, text, text, text, text, text, integer, text, text, public.pipeline_state, text, date) from public, anon;
grant execute on function public.create_shidduch(bigint, bigint, text, text, text, text, text, text, text, text, text, text, integer, text, text, public.pipeline_state, text, date) to authenticated;
grant execute on function public.create_shidduch(bigint, bigint, text, text, text, text, text, text, text, text, text, text, integer, text, text, public.pipeline_state, text, date) to service_role;

-- catch_shidduch keeps its exact signature (only its body and output JSON
-- keys change), so CREATE OR REPLACE is safe and its existing grants persist.
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
      coalesce(v_s.parents_en, v_s.parents_he),
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

-- Recreate the three views whose aliased output columns rename
-- (child_id/child_first_name_*/child_last_name_* -> single_*). CREATE OR
-- REPLACE VIEW cannot rename an existing output column, so these were
-- dropped above and are created fresh here — which means they lose their
-- privileges and `security_invoker` and must have both re-added by hand.

create view "public"."singles_summary" with (security_invoker = on) as  SELECT c.id,
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

revoke all on table public.singles_summary from anon, authenticated;
grant select on table public.singles_summary to authenticated;
grant all on table public.singles_summary to service_role;

create view "public"."reference_links_summary" with (security_invoker = on) as  SELECT rl.id,
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

revoke all on table public.reference_links_summary from anon, authenticated;
grant select on table public.reference_links_summary to authenticated;
grant all on table public.reference_links_summary to service_role;

create view "public"."shidduchim_summary" with (security_invoker = on) as  SELECT s.id,
    s.account_id,
    s.created_at,
    s.single_id,
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

revoke all on table public.shidduchim_summary from anon;
grant all on table public.shidduchim_summary to authenticated;
grant all on table public.shidduchim_summary to service_role;
