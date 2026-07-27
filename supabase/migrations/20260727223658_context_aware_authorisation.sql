-- AD-1's anon default-privilege revocation (AC-13). `supabase db diff` does
-- not diff `ALTER DEFAULT PRIVILEGES` at all, so these three statements are
-- hand-added — and placed first, before `create table "public"."member_state"`
-- below, so the new table never inherits the fork's now-withdrawn
-- "grant all to anon" default.
alter default privileges for role postgres in schema public revoke all on sequences from anon;

alter default privileges for role postgres in schema public revoke all on functions from anon;

alter default privileges for role postgres in schema public revoke all on tables from anon;

drop policy "Account members scoped to account" on "public"."account_members";

drop policy "Account access scoped to member" on "public"."accounts";

drop policy "AI usage readable within account" on "public"."ai_usage";

drop policy "Date records scoped to account" on "public"."date_records";

drop policy "Identity signals readable within account" on "public"."identity_signals";

drop policy "Inbox items scoped to account" on "public"."inbox_items";

drop policy "Interactions scoped to account and parent visibility" on "public"."interactions";

drop policy "Redts scoped to account" on "public"."redts";

drop policy "Reference links scoped to account" on "public"."reference_links";

drop policy "References scoped to account" on "public"."references";

drop policy "Resumes scoped to account" on "public"."resumes";

drop policy "Shadchanim scoped to account" on "public"."shadchanim";

drop policy "Shidduch schools scoped to account" on "public"."shidduch_schools";

drop policy "Shidduchim scoped to account" on "public"."shidduchim";

drop policy "Singles scoped to account" on "public"."singles";

drop policy "Subscription readable within account" on "public"."subscription";

drop policy "Tasks scoped to account" on "public"."tasks";

-- The 3 storage.objects policies (07_storage.sql) must be dropped here too,
-- BEFORE the function drop below — `db diff` placed their drop+recreate at
-- the very end of the generated migration, which left them still depending
-- on current_account_id() at the point of the DROP FUNCTION and made it
-- fail outright (the safe failure mode; never CASCADE past it). Moved up so
-- every dependent policy is gone before the function itself is.
drop policy "Attachments deletable within account" on "storage"."objects";

drop policy "Attachments readable within account" on "storage"."objects";

drop policy "Attachments writable within account" on "storage"."objects";

drop function if exists "public"."current_account_id"();


  create table "public"."member_state" (
    "user_id" uuid not null,
    "active_account_id" bigint,
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."member_state" enable row level security;

CREATE UNIQUE INDEX account_members_account_user_active_uq ON public.account_members USING btree (account_id, user_id) WHERE (status = 'active'::text);

CREATE UNIQUE INDEX member_state_pkey ON public.member_state USING btree (user_id);

alter table "public"."member_state" add constraint "member_state_pkey" PRIMARY KEY using index "member_state_pkey";

alter table "public"."member_state" add constraint "member_state_active_account_id_fkey" FOREIGN KEY (active_account_id) REFERENCES public.accounts(id) ON DELETE SET NULL not valid;

alter table "public"."member_state" validate constraint "member_state_active_account_id_fkey";

alter table "public"."member_state" add constraint "member_state_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."member_state" validate constraint "member_state_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.activate_context_for(p_user_id uuid, p_account_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.member_state (user_id, active_account_id, updated_at)
  values (p_user_id, p_account_id, now())
  on conflict (user_id) do update
    set active_account_id = excluded.active_account_id,
        updated_at = excluded.updated_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.activate_first_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.user_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.member_state ms
      join public.account_members am
        on am.user_id = ms.user_id
       and am.account_id = ms.active_account_id
       and am.status = 'active'
    where ms.user_id = new.user_id
  ) then
    perform public.activate_context_for(new.user_id, new.account_id);
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.current_context_id()
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
begin
  select ms.active_account_id into v_account_id
  from public.member_state ms
  where ms.user_id = auth.uid()
    and exists (
      select 1
      from public.account_members am
      where am.user_id = ms.user_id
        and am.account_id = ms.active_account_id
        and am.status = 'active'
    );

  return v_account_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_active_context(p_account_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1
    from public.account_members
    where user_id = auth.uid()
      and account_id = p_account_id
      and status = 'active'
  ) then
    raise exception 'no active membership of account %', p_account_id;
  end if;

  perform public.activate_context_for(auth.uid(), p_account_id);
end;
$function$
;

-- Function grants (AC-13). `supabase db diff` did not emit these — the
-- generated migration only detected the member_state table's grants — so
-- they are hand-added here, matching the revoke-then-grant pattern every
-- other function in this schema follows.
revoke all on function public.current_context_id() from public, anon;

grant execute on function public.current_context_id() to authenticated;

grant execute on function public.current_context_id() to service_role;

revoke all on function public.set_active_context(bigint) from public, anon;

grant execute on function public.set_active_context(bigint) to authenticated;

grant execute on function public.set_active_context(bigint) to service_role;

-- activate_context_for() gets NO grant to authenticated: only service_role
-- and its two SECURITY DEFINER callers can reach it.
revoke all on function public.activate_context_for(uuid, bigint) from public, anon, authenticated;

grant execute on function public.activate_context_for(uuid, bigint) to service_role;

revoke all on function public.activate_first_context() from public, anon;

grant execute on function public.activate_first_context() to authenticated;

grant execute on function public.activate_first_context() to service_role;

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

  return query select * from public.shidduchim where id = p_shidduchim_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_school(p_shidduchim_id bigint, p_kind text DEFAULT 'seminary'::text, p_name_en text DEFAULT NULL::text, p_name_he text DEFAULT NULL::text, p_start_year integer DEFAULT NULL::integer, p_end_year integer DEFAULT NULL::integer)
 RETURNS SETOF public.shidduch_schools
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

  if coalesce(p_kind, 'seminary') not in ('seminary', 'yeshiva', 'school', 'college', 'other') then
    raise exception 'invalid school kind: %', p_kind using errcode = 'check_violation';
  end if;

  return query
  insert into public.shidduch_schools (
    account_id, shidduchim_id, kind, name_en, name_he, start_year, end_year
  ) values (
    v_account_id, p_shidduchim_id, coalesce(p_kind, 'seminary'),
    p_name_en, p_name_he, p_start_year, p_end_year
  )
  returning *;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ai_entitlement()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  -- Monthly resume auto-parse allowance for the AI tier. Named rather than
  -- magic; the meter reads "<resumes_used> / <this>". Free tier gets 0.
  c_ai_monthly_resume_limit constant integer := 100;
  v_account_id bigint;
  v_plan text := 'free';
  v_status text := 'none';
  v_is_entitled boolean := false;
  v_resumes_limit integer := 0;
  v_resumes_used integer := 0;
  v_period text := to_char(now(), 'YYYY-MM');
begin
  v_account_id := public.current_context_id();
  if v_account_id is null then
    return jsonb_build_object(
      'is_entitled', false,
      'plan', 'free',
      'status', 'none',
      'resumes_used', 0,
      'resumes_limit', 0
    );
  end if;

  select s.plan, s.status
    into v_plan, v_status
  from public.subscription s
  where s.account_id = v_account_id;

  -- Default posture is UNENTITLED: entitlement requires EXACTLY the paid,
  -- currently-active state. 'lapsed' (was paid, now expired) is not entitled —
  -- AI auto-fill pauses, nothing is lost, the free manual path stays.
  v_plan := coalesce(v_plan, 'free');
  v_status := coalesce(v_status, 'none');
  v_is_entitled := (v_plan = 'ai' and v_status = 'active');
  v_resumes_limit := case when v_is_entitled then c_ai_monthly_resume_limit else 0 end;

  select coalesce(u.resumes_parsed, 0)
    into v_resumes_used
  from public.ai_usage u
  where u.account_id = v_account_id and u.period = v_period;

  v_resumes_used := coalesce(v_resumes_used, 0);

  return jsonb_build_object(
    'is_entitled', v_is_entitled,
    'plan', v_plan,
    'status', v_status,
    'resumes_used', v_resumes_used,
    'resumes_limit', v_resumes_limit
  );
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

CREATE OR REPLACE FUNCTION public.current_account_demo()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select a.demo from public.accounts a where a.id = public.current_context_id()),
    false
  );
$function$
;

CREATE OR REPLACE FUNCTION public.link_reference_to_shidduch(p_reference_id bigint, p_shidduchim_id bigint, p_relationship_override text DEFAULT NULL::text)
 RETURNS SETOF public.reference_links
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_existing_id bigint;
  v_new_id bigint;
begin
  v_account_id := public.current_context_id();

  if not exists (
    select 1 from public."references" r
    where r.id = p_reference_id and r.account_id = v_account_id
  ) then
    raise exception 'reference % not found in current account', p_reference_id;
  end if;

  if not exists (
    select 1 from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
  ) then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;

  select rl.id into v_existing_id
  from public.reference_links rl
  where rl.reference_id = p_reference_id
    and rl.shidduchim_id = p_shidduchim_id
    and rl.account_id = v_account_id
  limit 1;

  if v_existing_id is not null then
    return query select * from public.reference_links where id = v_existing_id;
    return;
  end if;

  insert into public.reference_links (
    account_id, reference_id, shidduchim_id, call_status, relationship_override
  ) values (
    v_account_id, p_reference_id, p_shidduchim_id, 'not_started', p_relationship_override
  )
  returning id into v_new_id;

  insert into public.interactions (
    account_id, target_type, target_id, scope, reference_link_id, kind, body, metadata
  ) values (
    v_account_id, 'reference', p_reference_id, 'shidduch', v_new_id, 'link_created',
    null, jsonb_build_object('shidduchim_id', p_shidduchim_id)
  );

  return query select * from public.reference_links where id = v_new_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_reference_call(p_reference_link_id bigint, p_call_status text DEFAULT NULL::text, p_what_they_said text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text)
 RETURNS SETOF public.reference_links
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_link public.reference_links;
  v_member_id bigint;
  v_entry jsonb;
begin
  v_account_id := public.current_context_id();

  select * into v_link
  from public.reference_links rl
  where rl.id = p_reference_link_id and rl.account_id = v_account_id;

  if not found then
    raise exception 'reference link % not found in current account', p_reference_link_id;
  end if;

  if p_call_status is not null and p_call_status not in
    ('not_started', 'answered', 'no_answer', 'call_back', 'they_will_call_back') then
    raise exception 'invalid call status: %', p_call_status using errcode = 'check_violation';
  end if;

  if p_source not in ('manual', 'assistant') then
    raise exception 'invalid call log source: %', p_source using errcode = 'check_violation';
  end if;

  -- The log is append-only and lives in a jsonb column, so an unbounded note
  -- grows the row without limit on every call. 20k characters is far more than
  -- anyone types mid-call and keeps a single link's log bounded.
  if length(coalesce(p_what_they_said, '')) > 20000 then
    raise exception 'call note is too long (% characters, limit 20000)', length(p_what_they_said)
      using errcode = 'check_violation';
  end if;

  select am.id into v_member_id
  from public.account_members am
  where am.user_id = auth.uid() and am.account_id = v_account_id
  order by am.id
  limit 1;

  v_entry := jsonb_build_object(
    'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'call_status', coalesce(p_call_status, v_link.call_status),
    'text', p_what_they_said,
    'source', p_source,
    'member_id', v_member_id
  );

  update public.reference_links rl
  set call_status = coalesce(p_call_status, rl.call_status),
      what_they_said = coalesce(nullif(p_what_they_said, ''), rl.what_they_said),
      conversation_log = coalesce(rl.conversation_log, '[]'::jsonb) || jsonb_build_array(v_entry)
  where rl.id = p_reference_link_id;

  insert into public.interactions (
    account_id, target_type, target_id, scope, reference_link_id, actor_member_id, kind, body, metadata
  ) values (
    v_account_id, 'reference', v_link.reference_id, 'shidduch', p_reference_link_id, v_member_id,
    'call_logged', nullif(p_what_they_said, ''),
    jsonb_build_object(
      'call_status', coalesce(p_call_status, v_link.call_status),
      'shidduchim_id', v_link.shidduchim_id,
      'source', p_source
    )
  );

  return query select * from public.reference_links where id = p_reference_link_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.match_identity(p_target_type text, p_name_en text DEFAULT NULL::text, p_name_he text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_parents text DEFAULT NULL::text, p_seminary text DEFAULT NULL::text, p_shul text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_exclude_target_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(target_id bigint, confidence numeric, deciding_facts jsonb)
 LANGUAGE plpgsql
 STABLE
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

  -- Nothing identifying was supplied: no candidates, no guessing.
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
    where s.account_id = v_account_id
      and s.target_type = p_target_type
      and (p_exclude_target_id is null or s.target_id <> p_exclude_target_id)
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

CREATE OR REPLACE FUNCTION public.merge_references(p_loser_id bigint, p_winner_id bigint, p_resolutions jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_collision record;
  v_resolution text;
  v_member_id bigint;
begin
  if p_loser_id = p_winner_id then
    raise exception 'cannot merge a reference into itself' using errcode = 'check_violation';
  end if;

  v_account_id := public.current_context_id();

  if not exists (
    select 1 from public."references" r
    where r.id = p_loser_id and r.account_id = v_account_id
  ) then
    raise exception 'reference % not found in current account', p_loser_id;
  end if;

  if not exists (
    select 1 from public."references" r
    where r.id = p_winner_id and r.account_id = v_account_id
  ) then
    raise exception 'reference % not found in current account', p_winner_id;
  end if;

  select am.id into v_member_id
  from public.account_members am
  where am.user_id = auth.uid() and am.account_id = v_account_id
  order by am.id
  limit 1;

  for v_collision in
    select
      l.id as loser_link_id,
      w.id as winner_link_id,
      l.shidduchim_id,
      l.call_status as loser_call_status,
      l.what_they_said as loser_what_they_said,
      l.conversation_log as loser_conversation_log,
      w.call_status as winner_call_status,
      w.what_they_said as winner_what_they_said
    from public.reference_links l
      join public.reference_links w
        on w.reference_id = p_winner_id
       and w.shidduchim_id = l.shidduchim_id
       and w.account_id = v_account_id
    where l.reference_id = p_loser_id
      and l.account_id = v_account_id
      and l.shidduchim_id is not null
  loop
    v_resolution := p_resolutions ->> v_collision.shidduchim_id::text;

    if v_resolution is null then
      raise exception
        'unresolved merge conflict: both references are linked to shidduch %. Choose which call log to keep before merging.',
        v_collision.shidduchim_id
        using errcode = 'check_violation';
    end if;

    if v_resolution not in ('winner', 'loser', 'both') then
      raise exception 'invalid merge resolution % for shidduch %', v_resolution, v_collision.shidduchim_id
        using errcode = 'check_violation';
    end if;

    -- Whatever is not kept as the live call log is preserved as an interaction.
    if v_resolution = 'winner' then
      insert into public.interactions (
        account_id, target_type, target_id, scope, reference_link_id, actor_member_id, kind, body, metadata
      ) values (
        v_account_id, 'reference', p_winner_id, 'shidduch', v_collision.winner_link_id, v_member_id, 'merge',
        v_collision.loser_what_they_said,
        jsonb_build_object(
          'reason', 'duplicate reference merged; superseded call log preserved',
          'shidduchim_id', v_collision.shidduchim_id,
          'call_status', v_collision.loser_call_status,
          'conversation_log', coalesce(v_collision.loser_conversation_log, '[]'::jsonb)
        )
      );

    elsif v_resolution = 'loser' then
      insert into public.interactions (
        account_id, target_type, target_id, scope, reference_link_id, actor_member_id, kind, body, metadata
      ) values (
        v_account_id, 'reference', p_winner_id, 'shidduch', v_collision.winner_link_id, v_member_id, 'merge',
        v_collision.winner_what_they_said,
        jsonb_build_object(
          'reason', 'duplicate reference merged; superseded call log preserved',
          'shidduchim_id', v_collision.shidduchim_id,
          'call_status', v_collision.winner_call_status
        )
      );

      update public.reference_links w
      set call_status = v_collision.loser_call_status,
          what_they_said = v_collision.loser_what_they_said,
          conversation_log = coalesce(w.conversation_log, '[]'::jsonb)
            || coalesce(v_collision.loser_conversation_log, '[]'::jsonb)
      where w.id = v_collision.winner_link_id;

    else
      update public.reference_links w
      set conversation_log = coalesce(w.conversation_log, '[]'::jsonb)
            || coalesce(v_collision.loser_conversation_log, '[]'::jsonb),
          what_they_said = concat_ws(
            E'\n\n', nullif(w.what_they_said, ''), nullif(v_collision.loser_what_they_said, '')
          )
      where w.id = v_collision.winner_link_id;

      insert into public.interactions (
        account_id, target_type, target_id, scope, reference_link_id, actor_member_id, kind, body, metadata
      ) values (
        v_account_id, 'reference', p_winner_id, 'shidduch', v_collision.winner_link_id, v_member_id, 'merge',
        v_collision.loser_what_they_said,
        jsonb_build_object(
          'reason', 'duplicate reference merged; both call logs kept',
          'shidduchim_id', v_collision.shidduchim_id,
          'call_status', v_collision.loser_call_status
        )
      );
    end if;

    -- Re-home the losing link's interactions, then drop the duplicate link.
    perform public.rehome_reference_link_interactions(
      v_collision.loser_link_id, v_collision.winner_link_id
    );

    delete from public.reference_links where id = v_collision.loser_link_id;
  end loop;

  -- Non-colliding links, the whole timeline, and every reminder move across.
  update public.reference_links rl
  set reference_id = p_winner_id
  where rl.reference_id = p_loser_id and rl.account_id = v_account_id;

  perform public.rehome_reference_interactions(p_loser_id, p_winner_id);

  update public.tasks t
  set target_id = p_winner_id
  where t.target_type = 'reference' and t.target_id = p_loser_id and t.account_id = v_account_id;

  -- The loser's identity_signals row is removed by purge_polymorphic_dependents
  -- when the row below is deleted, so the matcher never points at a dead id.
  -- Account-scoped: it names no shidduch and carries no candid content, only the
  -- fact that two records became one.
  insert into public.interactions (
    account_id, target_type, target_id, scope, actor_member_id, kind, body, metadata
  ) values (
    v_account_id, 'reference', p_winner_id, 'account', v_member_id, 'merge', null,
    jsonb_build_object('merged_from_reference_id', p_loser_id)
  );

  delete from public."references" where id = p_loser_id and account_id = v_account_id;

  return p_winner_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.preview_reference_merge(p_loser_id bigint, p_winner_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_loser public."references";
  v_winner public."references";
begin
  v_account_id := public.current_context_id();

  select * into v_loser from public."references" r
  where r.id = p_loser_id and r.account_id = v_account_id;
  if not found then
    raise exception 'reference % not found in current account', p_loser_id;
  end if;

  select * into v_winner from public."references" r
  where r.id = p_winner_id and r.account_id = v_account_id;
  if not found then
    raise exception 'reference % not found in current account', p_winner_id;
  end if;

  return jsonb_build_object(
    'loser', to_jsonb(v_loser),
    'winner', to_jsonb(v_winner),
    'reference_links_count', (
      select count(*) from public.reference_links rl where rl.reference_id = p_loser_id
    ),
    'interactions_count', (
      select count(*) from public.interactions i
      where i.target_type = 'reference' and i.target_id = p_loser_id
    ),
    'open_tasks_count', (
      select count(*) from public.tasks t
      where t.target_type = 'reference' and t.target_id = p_loser_id and t.done_date is null
    ),
    'collisions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'shidduchim_id', l.shidduchim_id,
          'shidduch_name_en', s.name_en,
          'shidduch_name_he', s.name_he,
          'loser_link', jsonb_build_object(
            'id', l.id,
            'call_status', l.call_status,
            'what_they_said', l.what_they_said,
            'conversation_log_count', coalesce(jsonb_array_length(l.conversation_log), 0)
          ),
          'winner_link', jsonb_build_object(
            'id', w.id,
            'call_status', w.call_status,
            'what_they_said', w.what_they_said,
            'conversation_log_count', coalesce(jsonb_array_length(w.conversation_log), 0)
          )
        )
      ), '[]'::jsonb)
      from public.reference_links l
        join public.reference_links w
          on w.reference_id = p_winner_id
         and w.shidduchim_id = l.shidduchim_id
         and w.account_id = v_account_id
        left join public.shidduchim s on s.id = l.shidduchim_id
      where l.reference_id = p_loser_id
        and l.account_id = v_account_id
        and l.shidduchim_id is not null
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rehome_reference_interactions(p_from_reference_id bigint, p_to_reference_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_moved integer;
begin
  v_account_id := public.current_context_id();
  if v_account_id is null then
    raise exception 'no account context';
  end if;

  if not exists (
    select 1 from public."references" r
    where r.id = p_from_reference_id and r.account_id = v_account_id
  ) or not exists (
    select 1 from public."references" r
    where r.id = p_to_reference_id and r.account_id = v_account_id
  ) then
    raise exception 'reference not found in current account';
  end if;

  update public.interactions i
  set target_id = p_to_reference_id
  where i.target_type = 'reference'
    and i.target_id = p_from_reference_id
    and i.account_id = v_account_id;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rehome_reference_link_interactions(p_from_link_id bigint, p_to_link_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_moved integer;
begin
  v_account_id := public.current_context_id();
  if v_account_id is null then
    raise exception 'no account context';
  end if;

  -- Both links must belong to the caller AND concern the SAME shidduch. The
  -- second half matters: without it this function would hand back exactly the
  -- capability the column-level UPDATE revoke removed — moving a candid note
  -- onto a different shidduch, and so changing whose visibility it inherits.
  -- The only caller, merge_references, only ever re-homes between two links for
  -- the same shidduch, so nothing legitimate needs more than this.
  if not exists (
    select 1
    from public.reference_links l
      join public.reference_links w
        on w.id = p_to_link_id
       and w.account_id = v_account_id
       and w.shidduchim_id is not distinct from l.shidduchim_id
    where l.id = p_from_link_id
      and l.account_id = v_account_id
  ) then
    raise exception 'reference links not found in current account, or not for the same shidduch';
  end if;

  update public.interactions i
  set reference_link_id = p_to_link_id
  where i.reference_link_id = p_from_link_id
    and i.account_id = v_account_id;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_account_id_default()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.account_id is null then
    new.account_id := public.current_context_id();
  end if;
  return new;
end;
$function$
;

-- `db diff` computed only the additive grants below for this brand-new
-- table and never emitted the revoke, so the table-creation default
-- privilege (`grant all on tables to authenticated`, 06_grants.sql) left
-- authenticated with TRUNCATE/REFERENCES/TRIGGER/MAINTAIN as well as
-- SELECT. Hand-added to match identity_signals' actual ACL shape (the
-- declared "revoke all ... from anon, authenticated" precedent).
revoke all on table "public"."member_state" from "anon", "authenticated";

grant select on table "public"."member_state" to "authenticated";

grant delete on table "public"."member_state" to "service_role";

grant insert on table "public"."member_state" to "service_role";

grant references on table "public"."member_state" to "service_role";

grant select on table "public"."member_state" to "service_role";

grant trigger on table "public"."member_state" to "service_role";

grant truncate on table "public"."member_state" to "service_role";

grant update on table "public"."member_state" to "service_role";


  create policy "Member state readable by owner"
  on "public"."member_state"
  as permissive
  for select
  to authenticated
using ((user_id = auth.uid()));



  create policy "Account members scoped to account"
  on "public"."account_members"
  as permissive
  for all
  to authenticated
using (((user_id = auth.uid()) OR (account_id = public.current_context_id())))
with check (((user_id = auth.uid()) OR (account_id = public.current_context_id())));



  create policy "Account access scoped to member"
  on "public"."accounts"
  as permissive
  for all
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.account_members am
  WHERE ((am.account_id = accounts.id) AND (am.user_id = auth.uid()) AND (am.status = 'active'::text)))))
with check ((EXISTS ( SELECT 1
   FROM public.account_members am
  WHERE ((am.account_id = accounts.id) AND (am.user_id = auth.uid()) AND (am.status = 'active'::text)))));



  create policy "AI usage readable within account"
  on "public"."ai_usage"
  as permissive
  for select
  to authenticated
using ((account_id = public.current_context_id()));



  create policy "Date records scoped to account"
  on "public"."date_records"
  as permissive
  for all
  to authenticated
using ((account_id = public.current_context_id()))
with check ((account_id = public.current_context_id()));



  create policy "Identity signals readable within account"
  on "public"."identity_signals"
  as permissive
  for select
  to authenticated
using ((account_id = public.current_context_id()));



  create policy "Inbox items scoped to account"
  on "public"."inbox_items"
  as permissive
  for all
  to authenticated
using ((account_id = public.current_context_id()))
with check ((account_id = public.current_context_id()));



  create policy "Interactions scoped to account and parent visibility"
  on "public"."interactions"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND ((scope = 'account'::text) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id()))))))))
with check (((account_id = public.current_context_id()) AND ((scope = 'account'::text) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id()))))))));



  create policy "Redts scoped to account"
  on "public"."redts"
  as permissive
  for all
  to authenticated
using ((account_id = public.current_context_id()))
with check ((account_id = public.current_context_id()));



  create policy "Reference links scoped to account"
  on "public"."reference_links"
  as permissive
  for all
  to authenticated
using ((account_id = public.current_context_id()))
with check ((account_id = public.current_context_id()));



  create policy "References scoped to account"
  on "public"."references"
  as permissive
  for all
  to authenticated
using ((account_id = public.current_context_id()))
with check ((account_id = public.current_context_id()));



  create policy "Resumes scoped to account"
  on "public"."resumes"
  as permissive
  for all
  to authenticated
using ((account_id = public.current_context_id()))
with check ((account_id = public.current_context_id()));



  create policy "Shadchanim scoped to account"
  on "public"."shadchanim"
  as permissive
  for all
  to authenticated
using ((account_id = public.current_context_id()))
with check ((account_id = public.current_context_id()));



  create policy "Shidduch schools scoped to account"
  on "public"."shidduch_schools"
  as permissive
  for all
  to authenticated
using ((account_id = public.current_context_id()))
with check ((account_id = public.current_context_id()));



  create policy "Shidduchim scoped to account"
  on "public"."shidduchim"
  as permissive
  for all
  to authenticated
using ((account_id = public.current_context_id()))
with check ((account_id = public.current_context_id()));



  create policy "Singles scoped to account"
  on "public"."singles"
  as permissive
  for all
  to authenticated
using ((account_id = public.current_context_id()))
with check ((account_id = public.current_context_id()));



  create policy "Subscription readable within account"
  on "public"."subscription"
  as permissive
  for select
  to authenticated
using ((account_id = public.current_context_id()));



  create policy "Tasks scoped to account"
  on "public"."tasks"
  as permissive
  for all
  to authenticated
using ((account_id = public.current_context_id()))
with check ((account_id = public.current_context_id()));


CREATE TRIGGER activate_first_context_trigger AFTER INSERT ON public.account_members FOR EACH ROW WHEN ((new.status = 'active'::text)) EXECUTE FUNCTION public.activate_first_context();


  create policy "Attachments deletable within account"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'attachments'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text)));



  create policy "Attachments readable within account"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'attachments'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text)));



  create policy "Attachments writable within account"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'attachments'::text) AND ((storage.foldername(name))[1] = (public.current_context_id())::text)));



