-- Halachic eligibility hardening after the initial actor-scope migration.
-- Keep this as a follow-up migration so an environment that already applied
-- 20260822213515 receives the same read/search/concurrency guarantees.

set check_function_bodies = off;

-- The initial migration adds these columns after the existing column-level
-- grant was created. Without this explicit grant PostgREST rejects the whole
-- shidduchim representation, including the filtered summary view.
grant select (person_gender, kohen_status)
  on table public.shidduchim to authenticated;

-- Re-establish least-privilege ACLs after CREATE OR REPLACE of the RPC and
-- newly-created eligibility helpers (Postgres gives new functions PUBLIC
-- EXECUTE unless it is revoked explicitly).
revoke all on function public.create_shidduch(
  bigint, bigint, text, text, text, text, text, text, date, text, text,
  text, text, text, text, text, text, text, integer, text, text,
  public.pipeline_state, text, date, text, text
) from public, anon;
grant execute on function public.create_shidduch(
  bigint, bigint, text, text, text, text, text, text, date, text, text,
  text, text, text, text, text, text, text, integer, text, text,
  public.pipeline_state, text, date, text, text
) to authenticated, service_role;

revoke all on function public.has_known_halachic_conflict(
  text, text, text, text, text, text
) from public, anon;
grant execute on function public.has_known_halachic_conflict(
  text, text, text, text, text, text
) to authenticated, service_role;

revoke all on function public.shidduch_has_known_halachic_conflict(
  bigint, text, text, text
) from public, anon;
grant execute on function public.shidduch_has_known_halachic_conflict(
  bigint, text, text, text
) to authenticated, service_role;

revoke all on function public.validate_shidduch_halachic_eligibility()
  from public, anon;
grant execute on function public.validate_shidduch_halachic_eligibility()
  to authenticated, service_role;

revoke all on function public.validate_single_halachic_eligibility()
  from public, anon;
grant execute on function public.validate_single_halachic_eligibility()
  to authenticated, service_role;

-- Keep this helper SECURITY INVOKER. A SECURITY DEFINER implementation would
-- turn an arbitrary single_id into a cross-account conflict oracle.
create or replace function public.shidduch_has_known_halachic_conflict(
  p_single_id bigint,
  p_person_gender text,
  p_person_kohen_status text,
  p_person_marital_status text
)
returns boolean
language sql stable
set search_path to ''
as $function$
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
$function$;

-- Serialize changes to a target single's facts with writes to its linked
-- suggestions. This closes the READ COMMITTED race where each transaction
-- could otherwise validate against the other's old snapshot.
create or replace function public.validate_shidduch_halachic_eligibility()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'myshadchan.halachic.single:' || new.single_id::text, 0
    )
  );

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
$function$;

create or replace function public.validate_single_halachic_eligibility()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'myshadchan.halachic.single:' || new.id::text, 0
    )
  );

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
$function$;

-- Every base-table SELECT policy remains useful for direct REST/SQL/MCP
-- callers, so the same narrow predicate is applied there as in the summary
-- view. The triggers remain authoritative for writes.
alter policy "Shidduchim scoped to account" on public.shidduchim
  using (
    account_id = public.current_context_id()
    and public.current_member_role() <> 'single'
    and not coalesce(public.shidduch_has_known_halachic_conflict(
      single_id, person_gender, kohen_status, marital_status
    ), false)
  )
  with check (
    account_id = public.current_context_id()
    and public.current_member_role() <> 'single'
    and not coalesce(public.shidduch_has_known_halachic_conflict(
      single_id, person_gender, kohen_status, marital_status
    ), false)
  );

alter policy "Shidduchim visible to single" on public.shidduchim
  using (
    account_id = public.current_context_id()
    and public.current_member_role() = 'single'
    and visibility = 'shared'
    and public.is_single_visible_state(pipeline_state)
    and not coalesce(public.shidduch_has_known_halachic_conflict(
      single_id, person_gender, kohen_status, marital_status
    ), false)
    and exists (
      select 1 from public.singles c
      where c.id = shidduchim.single_id
        and c.member_id = public.current_member_id()
    )
  );

alter policy "Shidduchim writable by self" on public.shidduchim
  using (
    account_id = public.current_context_id()
    and public.current_member_role() = 'single'
    and exists (
      select 1 from public.singles c
      where c.id = shidduchim.single_id
        and c.account_id = public.current_context_id()
        and c.member_id = public.current_member_id()
    )
    and not coalesce(public.shidduch_has_known_halachic_conflict(
      single_id, person_gender, kohen_status, marital_status
    ), false)
  )
  with check (
    account_id = public.current_context_id()
    and public.current_member_role() = 'single'
    and exists (
      select 1 from public.singles c
      where c.id = shidduchim.single_id
        and c.account_id = public.current_context_id()
        and c.member_id = public.current_member_id()
    )
    and not coalesce(public.shidduch_has_known_halachic_conflict(
      single_id, person_gender, kohen_status, marital_status
    ), false)
  );

alter policy "Shidduchim readable via accepted grant" on public.shidduchim
  using (
    exists (
      select 1 from public.child_grants g
      where g.target_single_id = shidduchim.single_id
        and g.grantee_account_id = public.current_context_id()
        and g.status = 'accepted'
    )
    and public.current_member_role() <> 'single'
    and not coalesce(public.shidduch_has_known_halachic_conflict(
      single_id, person_gender, kohen_status, marital_status
    ), false)
  );

alter policy "Shidduchim updatable via accepted edit grant" on public.shidduchim
  using (
    exists (
      select 1 from public.child_grants g
      where g.status = 'accepted'
        and g.access_level = 'edit'
        and g.grantee_account_id = public.current_context_id()
        and g.target_single_id = shidduchim.single_id
    )
    and public.current_member_role() <> 'single'
    and not coalesce(public.shidduch_has_known_halachic_conflict(
      single_id, person_gender, kohen_status, marital_status
    ), false)
  )
  with check (
    account_id = (
      select g.proposer_account_id
      from public.child_grants g
      where g.status = 'accepted'
        and g.access_level = 'edit'
        and g.grantee_account_id = public.current_context_id()
        and g.target_single_id = shidduchim.single_id
      limit 1
    )
    and exists (
      select 1 from public.child_grants g
      where g.status = 'accepted'
        and g.access_level = 'edit'
        and g.grantee_account_id = public.current_context_id()
        and g.target_single_id = shidduchim.single_id
    )
    and public.current_member_role() <> 'single'
    and not coalesce(public.shidduch_has_known_halachic_conflict(
      single_id, person_gender, kohen_status, marital_status
    ), false)
  );

-- Keep catch counts and roster totals aligned with the filtered suggestion
-- list, including for legacy rows that predate the triggers.
create or replace view public.shidduchim_catch_summary
  with (security_invoker = on) as
select
    a.target_id as shidduchim_id,
    a.account_id,
    count(distinct b.target_id) as catch_count
from public.identity_signals a
join public.identity_signals b
  on b.account_id = a.account_id
 and b.target_type = 'shidduch'
 and b.target_id <> a.target_id
 and (
   (a.name_en_norm is not null and b.name_en_norm = a.name_en_norm)
   or (a.name_he_norm is not null and b.name_he_norm = a.name_he_norm)
   or (a.name_en_key is not null and b.name_en_key = a.name_en_key)
   or (a.name_he_key is not null and b.name_he_key = a.name_he_key)
 )
 and (
   (a.parents_norm is not null and b.parents_norm = a.parents_norm)
   or (a.seminary_norm is not null and b.seminary_norm = a.seminary_norm)
   or (a.shul_norm is not null and b.shul_norm = a.shul_norm)
   or (a.location_norm is not null and b.location_norm = a.location_norm)
 )
join public.shidduchim ash on ash.id = a.target_id
join public.shidduchim bsh on bsh.id = b.target_id
where a.target_type = 'shidduch'
  and not coalesce(public.shidduch_has_known_halachic_conflict(
    ash.single_id, ash.person_gender, ash.kohen_status, ash.marital_status
  ), false)
  and not coalesce(public.shidduch_has_known_halachic_conflict(
    bsh.single_id, bsh.person_gender, bsh.kohen_status, bsh.marital_status
  ), false)
group by a.target_id, a.account_id;

create or replace view public.singles_summary
  with (security_invoker = on) as
select
  c.id,
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
  exists (
    select 1 from public.child_grants g
    where g.target_single_id = c.id
      and g.grantee_account_id = public.current_context_id()
      and g.status = 'accepted'
      and g.proposer_account_id <> public.current_context_id()
  ) as is_shared_with_me,
  count(s.id) filter (where not coalesce(public.shidduch_has_known_halachic_conflict(
    s.single_id, s.person_gender, s.kohen_status, s.marital_status
  ), false)) as total_shidduchim,
  count(s.id) filter (
    where s.pipeline_state in ('new', 'look_into', 'not_sure')
      and not coalesce(public.shidduch_has_known_halachic_conflict(
        s.single_id, s.person_gender, s.kohen_status, s.marital_status
      ), false)
  ) as open_shidduchim,
  c.kohen_status,
  c.marital_status
from public.singles c
left join public.shidduchim s on s.single_id = c.id
group by c.id;

-- Search/catch both use match_identity; filtering the target rows there keeps
-- every caller of the shared identity matcher aligned with the board view.
create or replace function public.match_identity(
  p_target_type text,
  p_name_en text default null,
  p_name_he text default null,
  p_phone text default null,
  p_parents text default null,
  p_seminary text default null,
  p_shul text default null,
  p_location text default null,
  p_exclude_target_id bigint default null
)
returns table(target_id bigint, confidence numeric, deciding_facts jsonb)
language plpgsql stable
set search_path to ''
as $function$
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
  if v_account_id is null then return; end if;

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
      ((v_name_en_norm is not null and s.name_en_norm = v_name_en_norm)
        or (v_name_he_norm is not null and s.name_he_norm = v_name_he_norm)) as name_exact,
      ((v_name_en_key is not null and s.name_en_key = v_name_en_key)
        or (v_name_he_key is not null and s.name_he_key = v_name_he_key)) as name_variant,
      (v_parents_norm is not null and s.parents_norm = v_parents_norm) as parents_hit,
      (v_seminary_norm is not null and s.seminary_norm = v_seminary_norm) as seminary_hit,
      (v_shul_norm is not null and s.shul_norm = v_shul_norm) as shul_hit,
      (v_location_norm is not null and s.location_norm = v_location_norm) as location_hit
    from public.identity_signals s
    left join public.shidduchim candidate
      on p_target_type = 'shidduch' and candidate.id = s.target_id
    where s.account_id = v_account_id
      and s.target_type = p_target_type
      and (p_exclude_target_id is null or s.target_id <> p_exclude_target_id)
      and (
        p_target_type <> 'shidduch'
        or (candidate.id is not null and not coalesce(
          public.shidduch_has_known_halachic_conflict(
            candidate.single_id, candidate.person_gender,
            candidate.kohen_status, candidate.marital_status
          ), false))
      )
  ),
  weighted as (
    select sc.*,
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
        select jsonb_build_object('signal', 'phone', 'detail', 'phone number matches exactly') as fact where w.phone_hit
        union all select jsonb_build_object('signal', 'name', 'detail', 'name matches exactly') where w.name_exact
        union all select jsonb_build_object('signal', 'name', 'detail', 'name matches as a Hebrew/English spelling variant') where w.name_variant and not w.name_exact
        union all select jsonb_build_object('signal', 'parents', 'detail', 'same parents') where w.parents_hit
        union all select jsonb_build_object('signal', 'school', 'detail', 'same school or seminary') where w.seminary_hit
        union all select jsonb_build_object('signal', 'shul', 'detail', 'same shul') where w.shul_hit
        union all select jsonb_build_object('signal', 'location', 'detail', 'same location') where w.location_hit
      ) f
    )
  from weighted w
  where w.phone_hit or ((w.name_exact or w.name_variant) and w.corroborators >= 1)
  order by 2 desc, 1 asc
  limit 10;
end;
$function$;
