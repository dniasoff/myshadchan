-- Rename the shidduch_schools container entity to shidduch_education.
--
-- Data-preserving by construction: every statement below is an ALTER on the
-- existing objects (table/constraint/index/sequence/trigger/function rename,
-- or a safe CREATE OR REPLACE FUNCTION body-only update), never a
-- drop-and-recreate. `alter table ... rename to` alone already preserves
-- every row, the identity sequence's current value, and re-attaches
-- constraints/indexes/triggers/policies under their OLD names automatically
-- — the statements below only rename those surviving objects to match what a
-- fresh build of the declarative schema would produce.
--
-- Deliberately NOT renamed: the check constraint's 'school' ENUM VALUE. That
-- is a legitimate education sub-kind (a primary/secondary school) alongside
-- 'seminary'/'yeshiva'/'college'/'other', distinct from the container entity
-- name being renamed here. shidduch_education_kind_check keeps the exact
-- same allowed values as shidduch_schools_kind_check did.
--
-- See .claude/rules/ (migration-guard-integrity.md's sibling concerns) for
-- why this is hand-written rather than `db diff`-generated: migra has no
-- notion of a table rename and would have proposed
-- `drop table shidduch_schools` + `create table shidduch_education`, which
-- deletes every row and resets the identity sequence to 1 on a populated
-- production table.

-- 1. Table rename (data-preserving: rows, identity sequence, and OID
--    untouched; PostgreSQL keeps every constraint/index/trigger/policy
--    attached, still under their OLD names).
alter table public.shidduch_schools rename to shidduch_education;

-- 2. Constraint renames. `ALTER TABLE ... RENAME TO` does not rename
--    constraints (confirmed empirically before writing this migration) — a
--    fresh build of 01_tables.sql's inline `primary key` would auto-name the
--    PK constraint (and its backing index) "shidduch_education_pkey", so
--    that rename is included even though it is not itself a
--    TypeScript-facing name, to keep this migration convergent with the
--    declarative schema.
alter table public.shidduch_education
    rename constraint shidduch_schools_pkey to shidduch_education_pkey;
alter table public.shidduch_education
    rename constraint shidduch_schools_account_id_fkey to shidduch_education_account_id_fkey;
alter table public.shidduch_education
    rename constraint shidduch_schools_shidduchim_id_fkey to shidduch_education_shidduchim_id_fkey;
alter table public.shidduch_education
    rename constraint shidduch_schools_kind_check to shidduch_education_kind_check;

-- 3. Index renames (non-constraint-backed indexes are separate catalog
--    objects and do not follow the table rename automatically).
alter index public.shidduch_schools_account_id_idx rename to shidduch_education_account_id_idx;
alter index public.shidduch_schools_shidduchim_id_idx rename to shidduch_education_shidduchim_id_idx;

-- 4. Identity sequence rename (owned by shidduch_education.id; renaming it
--    does not reset its current value or restart it).
alter sequence public.shidduch_schools_id_seq rename to shidduch_education_id_seq;

-- 5. Trigger renames. Both fire generic, reusable functions
--    (set_account_id_default / enforce_household_scope) — only the trigger
--    NAMES reference the old table name, so no function body changes here.
alter trigger set_shidduch_schools_account_id
    on public.shidduch_education rename to set_shidduch_education_account_id;
alter trigger validate_shidduch_schools_household_scope
    on public.shidduch_education rename to validate_shidduch_education_household_scope;

-- 6. RPC function rename (preserves the grants already made on it), followed
--    by a CREATE OR REPLACE to fix the body's literal SQL text. A function
--    body is re-parsed and name-resolved on every call, so the pre-rename
--    body (`insert into public.shidduch_schools ...`) would raise
--    "relation does not exist" once the table no longer answers to that
--    name — the ALTER FUNCTION RENAME alone is not enough.
alter function public.add_school(bigint, text, text, text, integer, integer)
    rename to add_education;

CREATE OR REPLACE FUNCTION "public"."add_education"("p_shidduchim_id" bigint, "p_kind" "text" DEFAULT 'seminary'::"text", "p_name_en" "text" DEFAULT NULL::"text", "p_name_he" "text" DEFAULT NULL::"text", "p_start_year" integer DEFAULT NULL::integer, "p_end_year" integer DEFAULT NULL::integer) RETURNS SETOF "public"."shidduch_education"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
  insert into public.shidduch_education (
    account_id, shidduchim_id, kind, name_en, name_he, start_year, end_year
  ) values (
    v_account_id, p_shidduchim_id, coalesce(p_kind, 'seminary'),
    p_name_en, p_name_he, p_start_year, p_end_year
  )
  returning *;
end;
$$;

-- 7. Body-only fixes for two functions that reference the table but do not
--    return it or take it as a parameter — safe CREATE OR REPLACE, no rename
--    needed for either function itself.
CREATE OR REPLACE FUNCTION "public"."account_has_domain_data"("p_account_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select
       exists (select 1 from public.singles where account_id = p_account_id)
    or exists (select 1 from public.shadchanim where account_id = p_account_id)
    or exists (select 1 from public."references" where account_id = p_account_id)
    or exists (select 1 from public.shidduchim where account_id = p_account_id)
    or exists (select 1 from public.resumes where account_id = p_account_id)
    or exists (select 1 from public.reference_links where account_id = p_account_id)
    or exists (select 1 from public.date_records where account_id = p_account_id)
    or exists (select 1 from public.redts where account_id = p_account_id)
    or exists (select 1 from public.shidduch_education where account_id = p_account_id)
    or exists (select 1 from public.shidduchim_external_links where account_id = p_account_id)
    or exists (select 1 from public.interactions where account_id = p_account_id)
    or exists (select 1 from public.identity_signals where account_id = p_account_id)
    or exists (select 1 from public.inbox_items where account_id = p_account_id)
    or exists (select 1 from public.tasks where account_id = p_account_id);
$$;

CREATE OR REPLACE FUNCTION "public"."create_shidduch"("p_single_id" bigint, "p_shadchan_id" bigint DEFAULT NULL::bigint, "p_name_en" "text" DEFAULT NULL::"text", "p_name_he" "text" DEFAULT NULL::"text", "p_father_en" "text" DEFAULT NULL::"text", "p_father_he" "text" DEFAULT NULL::"text", "p_mother_en" "text" DEFAULT NULL::"text", "p_mother_he" "text" DEFAULT NULL::"text", "p_dob" "date" DEFAULT NULL::"date", "p_background" "text" DEFAULT NULL::"text", "p_marital_status" "text" DEFAULT NULL::"text", "p_existing_children_note" "text" DEFAULT NULL::"text", "p_seminary_en" "text" DEFAULT NULL::"text", "p_seminary_he" "text" DEFAULT NULL::"text", "p_shul_en" "text" DEFAULT NULL::"text", "p_shul_he" "text" DEFAULT NULL::"text", "p_location_en" "text" DEFAULT NULL::"text", "p_location_he" "text" DEFAULT NULL::"text", "p_age" integer DEFAULT NULL::integer, "p_height" "text" DEFAULT NULL::"text", "p_origin" "text" DEFAULT 'manual'::"text", "p_initial_state" "public"."pipeline_state" DEFAULT 'new'::"public"."pipeline_state", "p_visibility" "text" DEFAULT 'shared'::"text", "p_redt_date" "date" DEFAULT NULL::"date") RETURNS SETOF "public"."shidduchim"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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

-- 8. RLS policies. Recreated (drop-then-create is safe: policies hold no
--    data of their own) with the SAME USING/WITH CHECK logic, renamed and
--    re-targeted at the renamed table. In particular the third policy below
--    is the Story 13.3 increment-6 child_grants policy — its USING clause is
--    reproduced byte-for-byte, only the policy name and table reference
--    changed.
drop policy "Shidduch schools scoped to account" on public.shidduch_education;
create policy "Shidduch education scoped to account" on public.shidduch_education
    for all to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    )
    with check (
        account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

drop policy "Shidduch schools visible to single" on public.shidduch_education;
create policy "Shidduch education visible to single" on public.shidduch_education
    for select to authenticated
    using (
        account_id = public.current_context_id()
        and public.current_member_role() = 'single'
        and exists (
            select 1
            from public.shidduchim s
                join public.singles c on c.id = s.single_id
            where s.id = shidduch_education.shidduchim_id
              and s.visibility = 'shared'
              and public.is_single_visible_state(s.pipeline_state)
              and c.member_id = public.current_member_id()
        )
    );

drop policy "Shidduch schools readable via accepted grant" on public.shidduch_education;
create policy "Shidduch education readable via accepted grant" on public.shidduch_education
    for select to authenticated
    using (
        exists (
            select 1 from public.shidduchim s
            where s.id = shidduch_education.shidduchim_id
              and exists (
                  select 1 from public.child_grants g
                  where g.status = 'accepted'
                    and g.grantee_account_id = public.current_context_id()
                    and g.target_single_id = s.single_id
              )
        )
        and public.current_member_role() <> 'single'
    );
