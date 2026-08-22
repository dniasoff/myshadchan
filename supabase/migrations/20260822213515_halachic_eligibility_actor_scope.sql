alter table "public"."redts" drop constraint "redts_shadchan_id_fkey";

alter table "public"."shidduchim" drop constraint "shidduchim_first_suggested_by_fkey";

alter table "public"."shidduchim" drop constraint "shidduchim_shadchan_id_fkey";

drop function if exists "public"."create_shidduch"(p_single_id bigint, p_shadchan_id bigint, p_name_en text, p_name_he text, p_father_en text, p_father_he text, p_mother_en text, p_mother_he text, p_dob date, p_background text, p_marital_status text, p_existing_children_note text, p_seminary_en text, p_seminary_he text, p_shul_en text, p_shul_he text, p_location_en text, p_location_he text, p_age integer, p_height text, p_origin text, p_initial_state public.pipeline_state, p_visibility text, p_redt_date date);

alter table "public"."shidduchim" add column "kohen_status" text not null default 'unknown'::text;

alter table "public"."shidduchim" add column "person_gender" text;

alter table "public"."singles" add column "kohen_status" text not null default 'unknown'::text;

alter table "public"."singles" add column "marital_status" text not null default 'unknown'::text;

CREATE UNIQUE INDEX shadchanim_account_id_id_key ON public.shadchanim USING btree (account_id, id);

alter table "public"."shadchanim" add constraint "shadchanim_account_id_id_key" UNIQUE using index "shadchanim_account_id_id_key";

alter table "public"."redts" add constraint "redts_shadchan_id_fkey" FOREIGN KEY (account_id, shadchan_id) REFERENCES public.shadchanim(account_id, id) ON DELETE SET NULL (shadchan_id) not valid;

alter table "public"."redts" validate constraint "redts_shadchan_id_fkey";

alter table "public"."shidduchim" add constraint "shidduchim_first_suggested_by_fkey" FOREIGN KEY (account_id, first_suggested_by) REFERENCES public.shadchanim(account_id, id) ON DELETE SET NULL (first_suggested_by) not valid;

alter table "public"."shidduchim" validate constraint "shidduchim_first_suggested_by_fkey";

alter table "public"."shidduchim" add constraint "shidduchim_shadchan_id_fkey" FOREIGN KEY (account_id, shadchan_id) REFERENCES public.shadchanim(account_id, id) ON DELETE SET NULL (shadchan_id) not valid;

alter table "public"."shidduchim" validate constraint "shidduchim_shadchan_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_shidduch(p_single_id bigint, p_shadchan_id bigint DEFAULT NULL::bigint, p_name_en text DEFAULT NULL::text, p_name_he text DEFAULT NULL::text, p_father_en text DEFAULT NULL::text, p_father_he text DEFAULT NULL::text, p_mother_en text DEFAULT NULL::text, p_mother_he text DEFAULT NULL::text, p_dob date DEFAULT NULL::date, p_background text DEFAULT NULL::text, p_marital_status text DEFAULT NULL::text, p_existing_children_note text DEFAULT NULL::text, p_seminary_en text DEFAULT NULL::text, p_seminary_he text DEFAULT NULL::text, p_shul_en text DEFAULT NULL::text, p_shul_he text DEFAULT NULL::text, p_location_en text DEFAULT NULL::text, p_location_he text DEFAULT NULL::text, p_age integer DEFAULT NULL::integer, p_height text DEFAULT NULL::text, p_origin text DEFAULT 'manual'::text, p_initial_state public.pipeline_state DEFAULT 'new'::public.pipeline_state, p_visibility text DEFAULT 'shared'::text, p_redt_date date DEFAULT NULL::date, p_person_gender text DEFAULT NULL::text, p_kohen_status text DEFAULT 'unknown'::text)
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

CREATE OR REPLACE FUNCTION public.has_known_halachic_conflict(p_target_gender text, p_target_kohen_status text, p_target_marital_status text, p_person_gender text, p_person_kohen_status text, p_person_marital_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  with facts as (
    select
      lower(trim(coalesce(p_target_gender, ''))) as target_gender,
      lower(trim(coalesce(p_target_kohen_status, ''))) as target_kohen,
      lower(trim(coalesce(p_target_marital_status, ''))) as target_marital,
      lower(trim(coalesce(p_person_gender, ''))) as person_gender,
      lower(trim(coalesce(p_person_kohen_status, ''))) as person_kohen,
      lower(trim(coalesce(p_person_marital_status, ''))) as person_marital
  )
  select
    (
      target_gender in ('male', 'female')
      and person_gender in ('male', 'female')
      and target_gender = person_gender
    )
    or (
      target_kohen in ('yes', 'true', 'kohen')
      and person_marital in ('divorced', 'divorcee', 'gerushah', 'gerushin')
    )
    or (
      person_kohen in ('yes', 'true', 'kohen')
      and target_marital in ('divorced', 'divorcee', 'gerushah', 'gerushin')
    )
  from facts;
$function$
;

CREATE OR REPLACE FUNCTION public.shidduch_has_known_halachic_conflict(p_single_id bigint, p_person_gender text, p_person_kohen_status text, p_person_marital_status text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(public.has_known_halachic_conflict(
    s.gender,
    s.kohen_status,
    s.marital_status,
    p_person_gender,
    p_person_kohen_status,
    p_person_marital_status
  ), false)
  from public.singles s
  where s.id = p_single_id;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_shidduch_halachic_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if coalesce(public.shidduch_has_known_halachic_conflict(
    new.single_id,
    new.person_gender,
    new.kohen_status,
    new.marital_status
  ), false) then
    raise exception 'This suggestion conflicts with a recorded detail.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_single_halachic_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if exists (
    select 1
    from public.shidduchim s
    where s.single_id = new.id
      and public.has_known_halachic_conflict(
        new.gender,
        new.kohen_status,
        new.marital_status,
        s.person_gender,
        s.kohen_status,
        s.marital_status
      )
  ) then
    raise exception 'This change conflicts with a recorded detail.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.accept_child_grant(p_token text)
 RETURNS public.child_grants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_grant public.child_grants;
  v_grantee_account_id bigint := public.current_context_id();
  v_grantee_kind text;
  v_member_role text;
begin
  select * into v_grant
  from public.child_grants
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if not found or v_grant.status <> 'pending' or v_grant.expires_at <= now() then
    raise exception 'This child grant is invalid, expired, or has already been used.'
      using errcode = 'check_violation';
  end if;

  if v_grantee_account_id is null or not exists (
    select 1 from public.account_members am
    where am.account_id = v_grantee_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
  ) then
    raise exception 'accept_child_grant requires an active membership of the current context'
      using errcode = 'insufficient_privilege';
  end if;

  select kind into v_grantee_kind from public.accounts where id = v_grantee_account_id;
  if v_grantee_kind not in ('household', 'shadchanus') then
    raise exception 'a child grant can only be accepted by a household or shadchanus context'
      using errcode = 'check_violation';
  end if;

  -- The recipient may be a household owner, helper, or standalone shadchan.
  -- The grant remains scoped to the one target child in every read/write
  -- policy after acceptance.
  select role into v_member_role
  from public.account_members
  where account_id = v_grantee_account_id and user_id = auth.uid() and status = 'active';
  
  if v_member_role not in ('parent_admin', 'self_manager', 'helper', 'shadchan') then
    raise exception 'only an authorized household member or shadchan may accept a child grant'
      using errcode = 'insufficient_privilege';
  end if;

  update public.child_grants
  set status = 'accepted', grantee_account_id = v_grantee_account_id, accepted_at = now()
  where id = v_grant.id
  returning * into v_grant;

  return v_grant;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_household_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if not exists (
    select 1 from public.accounts
    where id = new.account_id
      and (
        kind = 'household'
        or (
          kind = 'shadchanus'
          and tg_table_name in (
            'singles',
            'shadchanim',
            'shidduchim',
            'resumes',
            'resume_photos',
            'references',
            'reference_links',
            'date_records',
            'redts',
            'shidduch_education',
            'shidduchim_external_links',
            'identity_signals'
          )
        )
      )
  ) then
    raise exception 'account % cannot own % domain rows', new.account_id, tg_table_name
      using errcode = 'check_violation';
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
    s.person_gender
  from public.shidduchim s
  where s.id = p_shidduchim_id;
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
    COALESCE(max(cat.catch_count), (0)::bigint) AS catch_count,
    s.person_gender,
    s.kohen_status
   FROM (((((public.shidduchim s
     LEFT JOIN public.shadchanim sh ON ((sh.id = s.shadchan_id)))
     LEFT JOIN public.singles c ON ((c.id = s.single_id)))
     LEFT JOIN public.reference_links rl ON ((rl.shidduchim_id = s.id)))
     LEFT JOIN public.redts r ON ((r.shidduchim_id = s.id)))
     LEFT JOIN public.shidduchim_catch_summary cat ON ((cat.shidduchim_id = s.id)))
  WHERE (NOT COALESCE(public.shidduch_has_known_halachic_conflict(s.single_id, s.person_gender, s.kohen_status, s.marital_status), false))
  GROUP BY s.id, sh.name, sh.name_he, c.first_name_en, c.first_name_he, c.last_name_en, c.last_name_he;


create or replace view "public"."singles_summary" with (security_invoker = on) as  SELECT c.id,
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
    (EXISTS ( SELECT 1
           FROM public.child_grants g
          WHERE ((g.target_single_id = c.id) AND (g.grantee_account_id = public.current_context_id()) AND (g.status = 'accepted'::text) AND (g.proposer_account_id <> public.current_context_id())))) AS is_shared_with_me,
    count(s.id) AS total_shidduchim,
    count(s.id) FILTER (WHERE (s.pipeline_state = ANY (ARRAY['new'::public.pipeline_state, 'look_into'::public.pipeline_state, 'not_sure'::public.pipeline_state]))) AS open_shidduchim,
    c.kohen_status,
    c.marital_status
   FROM (public.singles c
     LEFT JOIN public.shidduchim s ON ((s.single_id = c.id)))
  GROUP BY c.id;



  create policy "Shidduchim updatable via accepted edit grant"
  on "public"."shidduchim"
  as permissive
  for update
  to authenticated
using (((EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.access_level = 'edit'::text) AND (g.grantee_account_id = public.current_context_id()) AND (g.target_single_id = shidduchim.single_id)))) AND (public.current_member_role() <> 'single'::text)))
with check (((account_id = ( SELECT g.proposer_account_id
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.access_level = 'edit'::text) AND (g.grantee_account_id = public.current_context_id()) AND (g.target_single_id = shidduchim.single_id))
 LIMIT 1)) AND (EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.access_level = 'edit'::text) AND (g.grantee_account_id = public.current_context_id()) AND (g.target_single_id = shidduchim.single_id)))) AND (public.current_member_role() <> 'single'::text)));



  create policy "Shidduchim writable by self"
  on "public"."shidduchim"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles c
  WHERE ((c.id = shidduchim.single_id) AND (c.account_id = public.current_context_id()) AND (c.member_id = public.current_member_id()))))))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles c
  WHERE ((c.id = shidduchim.single_id) AND (c.account_id = public.current_context_id()) AND (c.member_id = public.current_member_id()))))));



  create policy "Singles writable by self"
  on "public"."singles"
  as permissive
  for all
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() = 'single'::text) AND (member_id = public.current_member_id())))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() = 'single'::text) AND (member_id = public.current_member_id())));


CREATE TRIGGER validate_shidduch_halachic_eligibility BEFORE INSERT OR UPDATE OF single_id, person_gender, kohen_status, marital_status ON public.shidduchim FOR EACH ROW EXECUTE FUNCTION public.validate_shidduch_halachic_eligibility();

CREATE TRIGGER validate_single_halachic_eligibility BEFORE UPDATE OF gender, kohen_status, marital_status ON public.singles FOR EACH ROW EXECUTE FUNCTION public.validate_single_halachic_eligibility();
