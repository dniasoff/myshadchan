-- Close the AC-4 close_reason leak at the database (Story 6.3 follow-up).
--
-- `shidduchim_summary` redacted close_reason for a `single` caller inside a
-- view CASE. PostgREST exposes base tables, so a single asked for
-- `/rest/v1/shidduchim?select=id,close_reason` and got the candid text. RLS
-- cannot close it (row-scoped, never column-scoped), so the control is a
-- COLUMN PRIVILEGE.
--
-- HAND-EDITED after `supabase db diff`. Two things migra does not emit and
-- this migration is wrong without:
--   1. the column-level `grant select (...)` below — migra emitted only the
--      table-level `revoke select`, which on its own would leave
--      `authenticated` unable to read ANY column of public.shidduchim;
--   2. `with (security_invoker = on)` on the recreated `shidduchim_summary`
--      (`create or replace view` resets reloptions that are not restated, so
--      without it the view would silently become a definer view and stop
--      applying the caller's RLS).
--
-- Order matters: revoke the blanket table-level SELECT first, then re-grant
-- SELECT column by column WITHOUT close_reason. A column-level REVOKE against
-- a role that still holds table-level SELECT is a silent no-op in Postgres,
-- which is why this is expressed as revoke-then-enumerate rather than
-- `revoke select (close_reason)`.
revoke select on table "public"."shidduchim" from "authenticated";

grant select (
    id,
    account_id,
    created_at,
    single_id,
    shadchan_id,
    name_en,
    name_he,
    seminary_en,
    seminary_he,
    shul_en,
    shul_he,
    location_en,
    location_he,
    age,
    height,
    pipeline_state,
    first_suggested_by,
    first_suggested_at,
    redt_date,
    origin,
    owner_member_id,
    visibility,
    index,
    background,
    dob,
    existing_children_note,
    father_en,
    father_he,
    marital_status,
    mother_en,
    mother_he
) on table "public"."shidduchim" to "authenticated";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.shidduch_close_reason(p_shidduchim_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.close_reason
  from public.shidduchim s
  where s.id = p_shidduchim_id
    and s.account_id = public.current_context_id()
    and public.current_member_role() <> 'single';
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
    s.mother_he
  from public.shidduchim s
  where s.id = p_shidduchim_id;
$function$
;

CREATE OR REPLACE FUNCTION public.add_redt(p_shidduchim_id bigint, p_shadchan_id bigint DEFAULT NULL::bigint, p_redt_date date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS SETOF public.shidduchim
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
begin
  v_account_id := public.current_context_id();

  if not exists (
    select 1 from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
  ) then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;

  if p_shadchan_id is not null and not exists (
    select 1 from public.shadchanim s
    where s.id = p_shadchan_id and s.account_id = v_account_id
  ) then
    raise exception 'shadchan % not found in current account', p_shadchan_id;
  end if;

  insert into public.redts (account_id, shidduchim_id, shadchan_id, redt_date, note)
  values (v_account_id, p_shidduchim_id, p_shadchan_id, coalesce(p_redt_date, current_date), p_note);

  return query select * from public.shidduch_row(p_shidduchim_id);
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

  return query select * from public.shidduch_row(v_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.revoke_invite(p_invite_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_caller_role text;
  v_invite public.invites;
begin
  v_account_id := public.current_context_id();

  select i.* into v_invite
  from public.invites i
  where i.id = p_invite_id and i.account_id = v_account_id;

  if not found then
    raise exception 'invite % not found in current context', p_invite_id;
  end if;

  select am.role into v_caller_role
  from public.account_members am
  where am.account_id = v_account_id
    and am.user_id = auth.uid()
    and am.status = 'active';

  if v_caller_role is null or not public.is_invite_capable_role(v_caller_role) then
    raise exception 'role % may not revoke invites', v_caller_role
      using errcode = 'insufficient_privilege';
  end if;

  -- The mirror of accept_invite()'s own pre-UPDATE guard, and the reason it
  -- has to exist HERE too: `invites_role_target_check` (01_tables.sql) is
  -- deliberately `not valid` forever, and `not valid` only exempts rows that
  -- already existed — every subsequent INSERT *and UPDATE* is still checked.
  -- A `role = 'single'` invite that predates Story 6.1's `target_single_id`
  -- column (Epic 2 shipped `single` as an ordinary invitable household role
  -- two epics earlier) therefore makes the UPDATE below raise a bare 23514
  -- the moment an admin clicks Revoke on it — a raw constraint violation
  -- surfaced to the client, not this function's vocabulary. accept_invite()
  -- was given this guard in the same story; revoke_invite() was not, and it
  -- reproduces on any production-shaped database that carries such a row.
  --
  -- It refuses rather than repairs, on purpose. Repairing would mean writing
  -- a `target_single_id` this invite never had (there is no honest value) or
  -- rewriting its `role`, and deleting it would erase a row the audit trail
  -- keeps for every other outcome. The row is already inert — accept_invite()
  -- refuses it with the same finality — so the honest answer is a refusal in
  -- this function's own words, naming the state.
  if v_invite.role = 'single' and v_invite.target_single_id is null then
    raise exception 'invite % predates single-invite targeting and cannot be revoked; it can never be accepted either', p_invite_id
      using errcode = 'check_violation';
  end if;

  -- Review finding #4 (2.8): the status check and the write used to be two
  -- separate statements (a plain SELECT already read above, then an
  -- unconditional UPDATE), leaving a window under READ COMMITTED where a
  -- concurrent accept_invite() could bind a membership from the SAME invite
  -- between this function's read and its write — both could commit, leaving
  -- an active member the admin believes they just cancelled. Re-checking
  -- `status = 'pending'` IN the UPDATE's WHERE clause closes it: Postgres
  -- re-evaluates that predicate against the latest committed row once any
  -- lock a concurrent writer held is released (EvalPlanQual), so whichever
  -- of revoke_invite()/accept_invite() commits first wins the row and the
  -- other sees it already transitioned and raises here instead of
  -- clobbering it.
  update public.invites
  set status = 'revoked'
  where id = p_invite_id and status = 'pending';

  if not found then
    raise exception 'invite % is not pending', p_invite_id
      using errcode = 'check_violation';
  end if;
end;
$function$
;

create or replace view "public"."shidduchim_summary" with (security_invoker = on) as  SELECT s.id,
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
    public.shidduch_close_reason(s.id) AS close_reason,
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


CREATE OR REPLACE FUNCTION public.transition_shidduch(p_id bigint, p_from public.pipeline_state, p_to public.pipeline_state, p_close_reason text DEFAULT NULL::text)
 RETURNS SETOF public.shidduchim
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_current public.pipeline_state;
  v_close_reason text;
begin
  select pipeline_state into v_current
  from public.shidduchim
  where id = p_id
  for update;

  if not found then
    raise exception 'shidduch % not found', p_id;
  end if;

  if v_current is distinct from p_from then
    raise exception 'stale transition: shidduch % is in state %, not %', p_id, v_current, p_from
      using errcode = 'serialization_failure';
  end if;

  if p_from is not distinct from p_to then
    return query select * from public.shidduch_row(p_id);
    return;
  end if;

  if not exists (
    select 1 from public.pipeline_transitions t
    where t.from_state = p_from and t.to_state = p_to
  ) then
    raise exception 'illegal pipeline transition: % -> %', p_from, p_to
      using errcode = 'check_violation';
  end if;

  -- Two reads of close_reason had to move off the base table, because
  -- `authenticated` no longer holds SELECT on that column (06_grants.sql) and
  -- Postgres checks SELECT on every column an UPDATE *reads*, in its SET
  -- expressions as well as in RETURNING — not only on what it writes:
  --
  --   * `coalesce(p_close_reason, close_reason)` (keep the existing rationale
  --     when the caller supplies none) now coalesces onto the value fetched
  --     through the accessor just below;
  --   * `returning *` becomes a re-read through shidduch_row().
  --
  -- Writing the column is untouched — that needs UPDATE, which is still
  -- granted table-wide — so the transition itself behaves exactly as before.
  v_close_reason := public.shidduch_close_reason(p_id);

  update public.shidduchim
  set pipeline_state = p_to,
      close_reason = case
        when p_to in ('for_sure_not', 'yes', 'unsure', 'no') then coalesce(p_close_reason, v_close_reason)
        else null
      end
  where id = p_id;

  -- `returning *` used to carry the "did the write actually happen?" answer as
  -- well as the row: when RLS refused the UPDATE the statement affected zero
  -- rows and the RPC returned an empty set. Re-reading through shidduch_row()
  -- would silently restore a row here — the caller would get back a shidduch
  -- that looks fine and assume the transition landed. FOUND keeps the old
  -- contract exactly: no write, no row.
  if not found then
    return;
  end if;

  return query select * from public.shidduch_row(p_id);
end;
$function$
;



-- `db diff` never re-emits function grants — hand-added, mirroring the
-- current_member_role() grant block exactly (06_grants.sql).
--
-- `authenticated` MUST hold execute on shidduch_close_reason(): the summary
-- view is `security_invoker = on`, so the accessor is called with the
-- INVOKER's privileges when the board reads the view. It is safe to expose:
-- its own `where` mirrors the "Shidduchim scoped to account" policy, so
-- calling it directly through /rest/v1/rpc answers nothing the caller could
-- not already read — and answers NULL for the `single` role by construction.
revoke all on function public.shidduch_close_reason(bigint) from public, anon;
grant execute on function public.shidduch_close_reason(bigint) to authenticated;
grant execute on function public.shidduch_close_reason(bigint) to service_role;

revoke all on function public.shidduch_row(bigint) from public, anon;
grant execute on function public.shidduch_row(bigint) to authenticated;
grant execute on function public.shidduch_row(bigint) to service_role;
