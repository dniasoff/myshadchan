-- Suggested-by provenance for Inbox filings (myshadchan-cgw / myshadchan-glk).
-- Additive and idempotent: the fields are nullable and are appended because
-- ALTER TABLE ADD COLUMN creates them at the physical tail of shidduchim.
alter table public.shidduchim
  add column if not exists suggested_by_name text,
  add column if not exists suggested_by_phone text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shidduchim_suggested_by_name_check'
      and conrelid = 'public.shidduchim'::regclass
  ) then
    alter table public.shidduchim
      add constraint shidduchim_suggested_by_name_check check (
        suggested_by_name is null
        or (
          suggested_by_name = btrim(suggested_by_name)
          and suggested_by_name <> ''
          and char_length(suggested_by_name) <= 200
          and suggested_by_name !~ '[[:cntrl:]]'
        )
      );
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shidduchim_suggested_by_phone_check'
      and conrelid = 'public.shidduchim'::regclass
  ) then
    alter table public.shidduchim
      add constraint shidduchim_suggested_by_phone_check check (
        suggested_by_phone is null
        or (
          suggested_by_phone = btrim(suggested_by_phone)
          and suggested_by_phone <> ''
          and char_length(suggested_by_phone) <= 40
          and suggested_by_phone !~ '[[:cntrl:]]'
        )
      );
  end if;
end;
$$;

-- Ronit approved this legacy backfill. It only fills a currently empty
-- suggested-by name from a resolved Inbox item; it never changes shadchan_id
-- or first_suggested_by, creates no shadchan, and is safe to rerun. When a
-- suggestion has several qualifying Inbox items, the oldest item wins
-- deterministically. Values that cannot satisfy the new checks are left for
-- manual review rather than making the migration fail.
with candidates as (
  select distinct on (i.resolved_shidduchim_id)
    i.resolved_shidduchim_id as shidduch_id,
    btrim(i.sender) as sender
  from public.inbox_items i
  join public.shidduchim s
    on s.id = i.resolved_shidduchim_id
   and s.account_id = i.account_id
  where i.status = 'resolved'
    and s.shadchan_id is null
    and s.suggested_by_name is null
    and btrim(coalesce(i.sender, '')) <> ''
    and position('@' in coalesce(i.sender, '')) = 0
    and char_length(btrim(i.sender)) <= 200
    and btrim(i.sender) !~ '[[:cntrl:]]'
  order by i.resolved_shidduchim_id, i.created_at asc, i.id asc
)
update public.shidduchim s
set suggested_by_name = c.sender
from candidates c
where s.id = c.shidduch_id
  and s.suggested_by_name is null;

-- Keep the row-returning helper in lockstep with the 37-column shidduchim
-- rowtype before create_shidduch below calls it. This is intentionally kept
-- in the exact pg_dump format used by schemas/02_functions.sql.
CREATE OR REPLACE FUNCTION "public"."shidduch_row"("p_shidduchim_id" bigint) RETURNS SETOF "public"."shidduchim"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
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
    s.person_gender,
    s.archived_at,
    s.suggested_by_name,
    s.suggested_by_phone
  from public.shidduchim s
  where s.id = p_shidduchim_id;
$$;

-- Replace the old input signature rather than leaving an overload whose
-- defaults would make PostgREST calls ambiguous. All existing callers remain
-- valid because the two new inputs have NULL defaults.
drop function if exists public.create_shidduch(
  bigint, bigint, text, text, text, text, text, text, date, text, text, text,
  text, text, text, text, text, text, integer, text, text,
  public.pipeline_state, text, date, text, text
);

create or replace function public.create_shidduch(
  p_single_id bigint,
  p_shadchan_id bigint default null,
  p_name_en text default null,
  p_name_he text default null,
  p_father_en text default null,
  p_father_he text default null,
  p_mother_en text default null,
  p_mother_he text default null,
  p_dob date default null,
  p_background text default null,
  p_marital_status text default null,
  p_existing_children_note text default null,
  p_seminary_en text default null,
  p_seminary_he text default null,
  p_shul_en text default null,
  p_shul_he text default null,
  p_location_en text default null,
  p_location_he text default null,
  p_age integer default null,
  p_height text default null,
  p_origin text default 'manual',
  p_initial_state public.pipeline_state default 'new',
  p_visibility text default 'shared',
  p_redt_date date default null,
  p_person_gender text default null,
  p_kohen_status text default 'unknown',
  p_suggested_by_name text default null,
  p_suggested_by_phone text default null
) returns setof public.shidduchim
security definer
language plpgsql
set search_path to ''
as $$
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
    person_gender, kohen_status, suggested_by_name, suggested_by_phone
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
    p_person_gender, p_kohen_status, p_suggested_by_name, p_suggested_by_phone
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
$$;

revoke all on function public.create_shidduch(
  bigint, bigint, text, text, text, text, text, text, date, text, text, text,
  text, text, text, text, text, text, integer, text, text,
  public.pipeline_state, text, date, text, text, text, text
) from public, anon;
grant execute on function public.create_shidduch(
  bigint, bigint, text, text, text, text, text, text, date, text, text, text,
  text, text, text, text, text, text, integer, text, text,
  public.pipeline_state, text, date, text, text, text, text
) to authenticated, service_role;

grant select (suggested_by_name, suggested_by_phone)
  on table public.shidduchim to authenticated;

create or replace view public.shidduchim_summary
with (security_invoker = on) as
select
    s.id,
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
    public.shidduch_close_reason(s.id) as close_reason,
    s.origin,
    s.owner_member_id,
    s.visibility,
    s.index,
    sh.name as shadchan_name,
    sh.name_he as shadchan_name_he,
    c.first_name_en as single_first_name_en,
    c.first_name_he as single_first_name_he,
    c.last_name_en as single_last_name_en,
    c.last_name_he as single_last_name_he,
    count(distinct rl.id) as nb_references,
    count(distinct r.id) as nb_redts,
    coalesce(max(cat.catch_count), 0) as catch_count,
    s.person_gender,
    s.kohen_status,
    s.archived_at,
    s.suggested_by_name,
    s.suggested_by_phone
from public.shidduchim s
    left join public.shadchanim sh on sh.id = s.shadchan_id
    left join public.singles c on c.id = s.single_id
    left join public.reference_links rl on rl.shidduchim_id = s.id
    left join public.redts r on r.shidduchim_id = s.id
    left join public.shidduchim_catch_summary cat on cat.shidduchim_id = s.id
where not coalesce(
    public.shidduch_has_known_halachic_conflict(
        s.single_id,
        s.person_gender,
        s.kohen_status,
        s.marital_status
    ),
    false
)
group by s.id, sh.name, sh.name_he, c.first_name_en, c.first_name_he,
  c.last_name_en, c.last_name_he;
