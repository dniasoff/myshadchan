-- Function definitions for the `public` schema.
--
-- GENERATED, not hand-written: produced by
--   npx supabase db dump --db-url <stack> --schema public
-- and kept in that exact format, because `supabase db diff` compares against
-- it byte-for-byte and any reformatting produces a phantom diff (AGENTS.md).
--
-- Why all 117 are here. This file used to declare 5. The other 112 existed
-- only in migrations, so the declarative shadow database could not be
-- provisioned: 03_views.sql and 05_policies.sql reference functions that must
-- actually exist, and `db diff` failed on the first one it reached. That made
-- `db diff` unusable repo-wide, and every migration had to be hand-written.
-- Adding one function at a time only moved the failure to the next one.
--
-- `check_function_bodies = false` mirrors pg_dump's own preamble. 17 of these
-- are LANGUAGE sql, whose bodies Postgres validates at CREATE time; without
-- this, they would have to be topologically ordered by their dependencies
-- rather than left in the dump's own order.
--
-- To regenerate after changing a function: write the migration as usual, apply
-- it, then re-dump. Do not hand-edit a definition here.

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION "public"."accept_child_grant"("p_token" "text") RETURNS "public"."child_grants"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  if v_grantee_kind <> 'household' then
    raise exception 'a child grant can only be accepted by a household context'
      using errcode = 'check_violation';
  end if;

  -- Grantee must be a parent_admin or self_manager to accept (E13-D1 DEFAULT IF SILENT)
  select role into v_member_role
  from public.account_members
  where account_id = v_grantee_account_id and user_id = auth.uid() and status = 'active';
  
  if v_member_role not in ('parent_admin', 'self_manager') then
    raise exception 'only a parent_admin or self_manager may accept a child grant'
      using errcode = 'insufficient_privilege';
  end if;

  update public.child_grants
  set status = 'accepted', grantee_account_id = v_grantee_account_id, accepted_at = now()
  where id = v_grant.id
  returning * into v_grant;

  return v_grant;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."accept_connection_invite"("p_token" "text") RETURNS "public"."connections"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_invite public.connection_invites;
  v_acceptor_account_id bigint := public.current_context_id();
  v_acceptor_kind text;
  v_household_account_id bigint;
  v_shadchanus_account_id bigint;
  v_shadchanus_name text;
  v_connection public.connections;
begin
  select * into v_invite
  from public.connection_invites
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if not found or v_invite.status <> 'pending' or v_invite.expires_at <= now() then
    raise exception 'This connection invite is invalid, expired, or has already been used.'
      using errcode = 'check_violation';
  end if;

  if v_acceptor_account_id is null or not exists (
    select 1 from public.account_members am
    where am.account_id = v_acceptor_account_id and am.user_id = auth.uid() and am.status = 'active'
  ) then
    raise exception 'accept_connection_invite requires an active membership of the current context'
      using errcode = 'insufficient_privilege';
  end if;

  select kind into v_acceptor_kind from public.accounts where id = v_acceptor_account_id;

  if v_acceptor_kind = v_invite.inviter_kind then
    raise exception 'a connection links a household and a shadchanus context, not two of the same kind'
      using errcode = 'check_violation';
  end if;

  if v_acceptor_kind = 'household' then
    v_household_account_id := v_acceptor_account_id;
    v_shadchanus_account_id := v_invite.inviter_account_id;
  else
    v_household_account_id := v_invite.inviter_account_id;
    v_shadchanus_account_id := v_acceptor_account_id;
  end if;

  select name into v_shadchanus_name from public.accounts where id = v_shadchanus_account_id;

  -- Story 8.5 (AC-2): the mirror-image snapshot of v_shadchanus_name above —
  -- taken at the same moment, for the same reason (the household caller's
  -- own RLS never lets a shadchanus caller read `accounts` back the other
  -- way). See household_account_name's own comment in 01_tables.sql.
  insert into public.connections (
    household_account_id, shadchanus_account_id, status,
    proposed_by_account_id, accepted_at, household_account_name
  ) values (
    v_household_account_id, v_shadchanus_account_id, 'accepted',
    v_invite.inviter_account_id, now(),
    (select name from public.accounts where id = v_household_account_id)
  )
  returning * into v_connection;

  insert into public.shadchanim (account_id, name, connection_id)
  values (v_household_account_id, v_shadchanus_name, v_connection.id);

  update public.connection_invites
  set status = 'accepted', accepted_by_account_id = v_acceptor_account_id, accepted_at = now()
  where id = v_invite.id;

  return v_connection;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."accept_invite"("p_token" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_invite public.invites;
  v_membership_id bigint;
begin
  if v_user_id is null then
    raise exception 'accept_invite requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  select email into v_email from auth.users where id = v_user_id;

  select i.* into v_invite
  from public.invites i
  where i.token = p_token
    and lower(i.email) = lower(coalesce(v_email, ''));

  if not found then
    raise exception 'This invite is invalid, expired, or has already been used.'
      using errcode = 'check_violation';
  end if;

  if v_invite.status = 'accepted' and exists (
    select 1 from public.account_members
    where account_id = v_invite.account_id and user_id = v_user_id
  ) then
    return;
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'This invite is invalid, expired, or has already been used.'
      using errcode = 'check_violation';
  end if;

  -- Story 6.1 review fix (BLOCKER #2): a `role = 'single'` invite that
  -- predates this story's `target_single_id` column (Epic 2 shipped
  -- `single` as an ordinary invitable household role two epics earlier) can
  -- have no target. `invites_role_target_check` (01_tables.sql) is
  -- deliberately NOT VALID forever rather than backfilled or deleted (the
  -- migration-data-safety guard forbids both for a pre-existing row), which
  -- means the UPDATE just below WOULD still raise for such a row — but as a
  -- raw constraint-violation error, not this function's own vocabulary.
  -- Catching it here first turns it into the exact same friendly message
  -- every other unhonourable invite gets: it can never be linked under the
  -- invariant this story establishes, so it is refused the same way an
  -- expired or already-used one is, never a leaked implementation detail.
  if v_invite.role = 'single' and v_invite.target_single_id is null then
    raise exception 'This invite is invalid, expired, or has already been used.'
      using errcode = 'check_violation';
  end if;

  -- Review finding #4 (2.8): claim the invite atomically BEFORE inserting
  -- the membership, re-checking `status = 'pending'` in the UPDATE's WHERE
  -- clause rather than relying on the plain SELECT read above (which a
  -- concurrent revoke_invite() could invalidate between this function's
  -- read and its write). See revoke_invite()'s matching comment for why the
  -- WHERE-clause re-check — not an explicit lock — is what makes the two
  -- functions mutually exclusive on the same row: whichever commits first
  -- wins, the other's UPDATE affects zero rows and raises here instead of
  -- creating a membership for an invite the admin just revoked.
  update public.invites
  set status = 'accepted', accepted_at = now()
  where id = v_invite.id and status = 'pending';

  if not found then
    raise exception 'This invite is invalid, expired, or has already been used.'
      using errcode = 'check_violation';
  end if;

  insert into public.account_members (account_id, user_id, role, invited_by, status)
  values (v_invite.account_id, v_user_id, v_invite.role, v_invite.invited_by, 'active')
  returning id into v_membership_id;

  -- Story 6.1 (AC-3/AC-4): a `role = 'single'` invite always carries a
  -- target (the table's check constraint), so this branch is the ONLY place
  -- `singles.member_id` is ever set from an invite. Fails closed even if the
  -- target became linked in the window between invite and acceptance (e.g.
  -- via add_persona('single')) — never silently reassigned.
  if v_invite.target_single_id is not null then
    update public.singles
    set member_id = v_membership_id
    where id = v_invite.target_single_id
      and account_id = v_invite.account_id
      and member_id is null;

    if not found then
      raise exception 'single % is already linked to a login, or does not belong to this household', v_invite.target_single_id
        using errcode = 'check_violation';
    end if;
  end if;
end;
$$;

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

CREATE OR REPLACE FUNCTION "public"."activate_context_for"("p_user_id" "uuid", "p_account_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.member_state (user_id, active_account_id, updated_at)
  values (p_user_id, p_account_id, now())
  on conflict (user_id) do update
    set active_account_id = excluded.active_account_id,
        updated_at = excluded.updated_at;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."activate_first_context"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

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

CREATE OR REPLACE FUNCTION "public"."add_persona"("p_persona" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_first_name text;
  v_account_id bigint;
  v_membership_id bigint;
begin
  -- Review finding #2: fail closed on an unauthenticated caller. Without
  -- this, service_role (which holds EXECUTE for legitimate server-side
  -- callers, e.g. a future edge function) calling add_persona() with no
  -- user JWT would silently insert an accounts/account_members row with
  -- user_id NULL — an orphan tenant nothing can ever reach, not a
  -- cross-tenant leak, but a violation of the fail-closed convention
  -- current_context_id()/set_active_context() already establish.
  if v_user_id is null then
    raise exception 'add_persona requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if p_persona not in ('single', 'parent', 'shadchan') then
    raise exception 'unknown persona: %', p_persona
      using errcode = 'invalid_parameter_value';
  end if;

  select m.first_name into v_first_name
  from public.members m
  where m.user_id = v_user_id;

  if p_persona = 'parent' then
    -- No-op: an active parent_admin membership already exists.
    if exists (
      select 1 from public.account_members
      where user_id = v_user_id and status = 'active' and role = 'parent_admin'
    ) then
      return;
    end if;

    -- Promote an existing self_manager membership in place (never rewrite
    -- account_id — that would trip enforce_household_scope() for no reason,
    -- the household is already valid).
    update public.account_members
      set role = 'parent_admin'
    where id = (
      select id from public.account_members
      where user_id = v_user_id and status = 'active' and role = 'self_manager'
      order by id
      limit 1
    );

    if found then
      return;
    end if;

    -- Otherwise (no memberships at all, or only non-owning ones elsewhere —
    -- e.g. a helper in someone else's household): a fresh household. A
    -- non-owning membership is never promoted — that would hand the caller
    -- admin of a household that is not theirs.
    --
    -- Review finding #4: nullif(v_first_name, 'Pending') closes a dead
    -- fallback. public.members.first_name is NOT NULL DEFAULT 'Pending' and
    -- handle_new_user() always creates the row (01_tables.sql, 02_functions.sql),
    -- so plain `coalesce(v_first_name || '''s Family', 'My Account')` could
    -- never reach its own 'My Account' arm — a signup with no first/given
    -- name in their OAuth metadata got a household literally named
    -- "Pending's Family" instead of the intended placeholder.
    insert into public.accounts (name, kind)
    values (coalesce(nullif(v_first_name, 'Pending') || '''s Family', 'My Account'), 'household')
    returning id into v_account_id;

    insert into public.account_members (account_id, user_id, role, status)
    values (v_account_id, v_user_id, 'parent_admin', 'active');

    return;
  end if;

  if p_persona = 'single' then
    -- No-op: a singles row already points at one of the caller's own active
    -- memberships (the invited single, or re-ticking a box already held).
    -- This predicate must match my_personas()'s single-detection exactly.
    -- Story 2.5: `s.status = 'active'` is load-bearing, not decorative —
    -- without it, re-ticking `single` after remove_persona() archived the
    -- caller's own singles row would silently no-op forever (the archived
    -- row still satisfies `s.member_id = am.id`), the exact "add a persona
    -- back" round trip the epic's own example requires.
    if exists (
      select 1
      from public.singles s
      join public.account_members am on am.id = s.member_id
      where am.user_id = v_user_id
        and am.status = 'active'
        and s.status = 'active'
        and (am.role = 'single' or public.is_owning_membership_role(am.role))
    ) then
      return;
    end if;

    -- Attach to an existing OWNING membership if the caller has one (never a
    -- helper's household — see the Dev Notes on why `single` never attaches
    -- to a helper's household).
    select am.id, am.account_id into v_membership_id, v_account_id
    from public.account_members am
    where am.user_id = v_user_id
      and am.status = 'active'
      and public.is_owning_membership_role(am.role)
    order by am.id
    limit 1;

    if v_membership_id is null then
      insert into public.accounts (name, kind)
      values (coalesce(nullif(v_first_name, 'Pending') || '''s Family', 'My Account'), 'household')
      returning id into v_account_id;

      insert into public.account_members (account_id, user_id, role, status)
      values (v_account_id, v_user_id, 'self_manager', 'active')
      returning id into v_membership_id;
    end if;

    insert into public.singles (account_id, member_id)
    values (v_account_id, v_membership_id);

    return;
  end if;

  if p_persona = 'shadchan' then
    -- No-op: an active shadchan-role membership already exists.
    if exists (
      select 1 from public.account_members
      where user_id = v_user_id and status = 'active' and role = 'shadchan'
    ) then
      return;
    end if;

    insert into public.accounts (kind)
    values ('shadchanus')
    returning id into v_account_id;

    insert into public.account_members (account_id, user_id, role, status)
    values (v_account_id, v_user_id, 'shadchan', 'active');

    return;
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."add_redt"("p_shidduchim_id" bigint, "p_shadchan_id" bigint DEFAULT NULL::bigint, "p_redt_date" "date" DEFAULT NULL::"date", "p_note" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."shidduchim"
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
$$;

CREATE OR REPLACE FUNCTION "public"."add_resume_file"("p_path" "text", "p_filename" "text", "p_mime_type" "text", "p_size" bigint, "p_shidduchim_id" bigint DEFAULT NULL::bigint, "p_single_id" bigint DEFAULT NULL::bigint) RETURNS SETOF "public"."resumes"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_entry jsonb;
begin
  v_account_id := public.current_context_id();

  if (p_shidduchim_id is not null) = (p_single_id is not null) then
    raise exception 'exactly one of p_shidduchim_id/p_single_id must be provided';
  end if;

  if p_shidduchim_id is not null then
    if not exists (
      select 1 from public.shidduchim s
      where s.id = p_shidduchim_id and s.account_id = v_account_id
    ) then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;
  else
    if not exists (
      select 1 from public.singles s
      where s.id = p_single_id and s.account_id = v_account_id
    ) then
      raise exception 'single % not found in current account', p_single_id;
    end if;
  end if;

  v_entry := jsonb_build_object(
    'path', p_path,
    'filename', p_filename,
    'uploaded_at', now(),
    'uploaded_by', public.current_member_id(),
    'mime_type', p_mime_type,
    'size', p_size
  );

  if p_shidduchim_id is not null then
    return query
    insert into public.resumes (account_id, shidduchim_id, files)
    values (v_account_id, p_shidduchim_id, jsonb_build_array(v_entry))
    on conflict (shidduchim_id) where shidduchim_id is not null do update
      set files = coalesce(public.resumes.files, '[]'::jsonb) || jsonb_build_array(v_entry)
    returning *;
  else
    return query
    insert into public.resumes (account_id, single_id, files)
    values (v_account_id, p_single_id, jsonb_build_array(v_entry))
    on conflict (single_id) where single_id is not null do update
      set files = coalesce(public.resumes.files, '[]'::jsonb) || jsonb_build_array(v_entry)
    returning *;
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."add_resume_photo"("p_path" "text", "p_shidduchim_id" bigint DEFAULT NULL::bigint, "p_single_id" bigint DEFAULT NULL::bigint, "p_visibility" "text" DEFAULT 'shared'::"text") RETURNS SETOF "public"."resume_photos"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_resume_id bigint;
begin
  v_account_id := public.current_context_id();

  if (p_shidduchim_id is not null) = (p_single_id is not null) then
    raise exception 'exactly one of p_shidduchim_id/p_single_id must be provided';
  end if;

  if p_shidduchim_id is not null then
    if not exists (
      select 1 from public.shidduchim s
      where s.id = p_shidduchim_id and s.account_id = v_account_id
    ) then
      raise exception 'shidduch % not found in current account', p_shidduchim_id;
    end if;

    insert into public.resumes (account_id, shidduchim_id)
    values (v_account_id, p_shidduchim_id)
    on conflict (shidduchim_id) where shidduchim_id is not null
      do update set shidduchim_id = excluded.shidduchim_id
    returning id into v_resume_id;
  else
    if not exists (
      select 1 from public.singles s
      where s.id = p_single_id and s.account_id = v_account_id
    ) then
      raise exception 'single % not found in current account', p_single_id;
    end if;

    insert into public.resumes (account_id, single_id)
    values (v_account_id, p_single_id)
    on conflict (single_id) where single_id is not null
      do update set single_id = excluded.single_id
    returning id into v_resume_id;
  end if;

  return query
  insert into public.resume_photos (account_id, resume_id, path, visibility)
  values (v_account_id, v_resume_id, p_path, coalesce(p_visibility, 'shared'))
  returning *;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."ai_cost_per_active_family"() RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_total_cost numeric;
  v_active_accounts bigint;
begin
  select coalesce(sum(cost_usd), 0) into v_total_cost
  from public.ai_usage_meter
  where account_id = public.current_context_id();

  select count(*) into v_active_accounts
  from public.accounts
  where id = public.current_context_id();

  if v_active_accounts = 0 then
    return 0;
  end if;

  return round(v_total_cost / v_active_accounts, 4);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."ai_entitlement"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
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
  -- ai_resume_limit_for_account() is the one place that formula lives now
  -- (shared with claim_ai_parse_attempt()) — is_entitled is derived from its
  -- answer rather than restating "plan = 'ai' and status = 'active'" here too.
  v_resumes_limit := public.ai_resume_limit_for_account(v_account_id);
  v_is_entitled := (v_resumes_limit > 0);

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
$$;

CREATE OR REPLACE FUNCTION "public"."ai_monthly_resume_limit"() RETURNS integer
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  v_limit integer;
begin
  select coalesce((config->>'ai_monthly_resume_limit')::integer, 100)
    into v_limit
  from public.configuration
  where id = 1;

  if v_limit is null or v_limit < 0 then
    v_limit := 100;
  end if;

  return v_limit;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."ai_resume_limit_for_account"("p_account_id" bigint) RETURNS integer
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  v_plan text;
  v_status text;
begin
  select s.plan, s.status
    into v_plan, v_status
  from public.subscription s
  where s.account_id = p_account_id;

  if coalesce(v_plan, 'free') = 'ai' and coalesce(v_status, 'none') = 'active' then
    return public.ai_monthly_resume_limit();
  end if;

  return 0;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."can_moderate_note"("p_actor_member_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
      -- the caller wrote it: compare the AUTHOR's membership row on user_id,
      -- never on account_members.id (see Dev Notes "Why authorship joins on user_id")
      select 1
      from public.account_members am
      where am.id = p_actor_member_id
        and am.user_id = auth.uid()
    ) or exists (
      -- or the caller holds an owning role in the context they are active in
      select 1
      from public.account_members am
      where am.user_id = auth.uid()
        and am.account_id = public.current_context_id()
        and am.status = 'active'
        and public.is_owning_membership_role(am.role)
    );
$$;

CREATE OR REPLACE FUNCTION "public"."catch_shidduch"("p_shidduchim_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."check_signup_age"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_email text;
  v_age_affirmed boolean;
begin
  v_email := event -> 'user' ->> 'email';

  begin
    v_age_affirmed := (event -> 'user' -> 'user_metadata' ->> 'age_affirmed')::boolean;
  exception when others then
    v_age_affirmed := null;
  end;

  if v_age_affirmed is distinct from true and v_email is not null then
    update public.signup_intents
    set consumed_at = now()
    where email = v_email
      and consumed_at is null
      and expires_at > now();

    if found then
      v_age_affirmed := true;
    end if;
  end if;

  delete from public.signup_intents where expires_at <= now();

  if v_age_affirmed is distinct from true then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'You must confirm you are 18 years of age or older to sign up.'
    ));
  end if;

  return '{}'::jsonb;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."claim_ai_parse_attempt"("p_account_id" bigint, "p_inbox_item_id" bigint, "p_attachment_path" "text", "p_current_result_schema_version" smallint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  c_stale_after constant interval := interval '5 minutes';
  -- 3x c_stale_after: comfortably outside any genuinely live request (see
  -- the function comment above), so a row this old can only be abandoned.
  c_reap_after constant interval := interval '15 minutes';
  v_period text := to_char(now(), 'YYYY-MM');
  -- Entitlement-aware, not the raw constant: an unentitled account (no
  -- subscription row, wrong plan, lapsed status) resolves to 0 here, so the
  -- `where v_limit > 0` reservation guard below refuses it outright — the
  -- SAME formula ai_entitlement() uses, never a second copy of it. Findings
  -- 6/7 are exactly about not trusting an earlier, out-of-band entitlement
  -- snapshot for enforcement; deriving it fresh, inside the same atomic
  -- operation that spends the quota, is what makes this fail-closed rather
  -- than merely relying on the Worker's own advisory pre-check.
  v_limit integer := public.ai_resume_limit_for_account(p_account_id);
  v_attempt_id bigint;
  v_generation bigint;
  v_status text;
  v_result jsonb;
  v_result_schema_version smallint;
  v_started_at timestamptz;
  v_new_count integer;
  v_is_fresh_claim boolean := false;
  v_needs_reservation boolean := false;
begin
  -- Opportunistic reaper (Finding 10 closure) — see function comment above
  -- for the full argument. Refunds only THIS account's own OTHER stuck
  -- rows; the key being claimed right now is excluded on purpose.
  with reaped as (
    update public.ai_parse_attempts
       set status = 'failed', result = null, generation = generation + 1
     where account_id = p_account_id
       and status = 'in_progress'
       and started_at < now() - c_reap_after
       and not (inbox_item_id = p_inbox_item_id and attachment_path = p_attachment_path)
    returning period
  ), reaped_counts as (
    select period, count(*) as n from reaped group by period
  )
  update public.ai_usage u
     set resumes_parsed = greatest(u.resumes_parsed - rc.n, 0)
    from reaped_counts rc
   where u.account_id = p_account_id and u.period = rc.period;

  -- Serialize on the unique constraint itself: the first INSERT for this
  -- key wins outright; a genuinely concurrent second INSERT blocks on
  -- Postgres's own conflict handling and then raises unique_violation,
  -- never silently succeeding twice.
  begin
    insert into public.ai_parse_attempts
      (account_id, inbox_item_id, attachment_path, period, status, started_at)
    values
      (p_account_id, p_inbox_item_id, p_attachment_path, v_period, 'in_progress', now())
    returning id, generation into v_attempt_id, v_generation;
    v_is_fresh_claim := true;
    v_needs_reservation := true;
  exception when unique_violation then
    select id, status, result, result_schema_version, started_at, generation
      into v_attempt_id, v_status, v_result, v_result_schema_version, v_started_at, v_generation
    from public.ai_parse_attempts
    where account_id = p_account_id
      and inbox_item_id = p_inbox_item_id
      and attachment_path = p_attachment_path
    for update;

    if v_status = 'completed' and v_result_schema_version >= p_current_result_schema_version then
      return jsonb_build_object(
        'outcome', 'replay', 'attempt_id', v_attempt_id, 'result', v_result,
        'result_schema_version', v_result_schema_version
      );
    elsif v_status = 'completed' then
      -- Stale CONTRACT, not stale time (Finding 12 closure): the cached
      -- result was written under an older response shape than the caller's
      -- own current one. Same free-reclaim treatment as an abandoned
      -- in_progress row below — the account already paid for one
      -- extraction of this document; a re-parse forced by OUR OWN contract
      -- change must not charge it again.
      update public.ai_parse_attempts
         set status = 'in_progress', started_at = now(), result = null, generation = generation + 1
       where id = v_attempt_id
      returning generation into v_generation;
      return jsonb_build_object('outcome', 'claimed', 'attempt_id', v_attempt_id, 'generation', v_generation);
    elsif v_status = 'in_progress' and v_started_at > now() - c_stale_after then
      return jsonb_build_object('outcome', 'conflict', 'attempt_id', v_attempt_id);
    elsif v_status = 'in_progress' then
      -- Stale: the original claim's reservation is still held (never
      -- released), so this resumes the SAME reservation without reserving
      -- a second unit — but it IS a new generation: bumping the fencing
      -- token here is what makes the original (now superseded) holder's
      -- later confirm/release a no-op instead of a race.
      update public.ai_parse_attempts
         set started_at = now(), generation = generation + 1
       where id = v_attempt_id
      returning generation into v_generation;
      return jsonb_build_object('outcome', 'claimed', 'attempt_id', v_attempt_id, 'generation', v_generation);
    else
      -- 'failed': its reservation was already released — needs a fresh
      -- atomic reserve-or-refuse, same as a brand-new key.
      v_needs_reservation := true;
    end if;
  end;

  if v_needs_reservation then
    -- Atomic reserve-or-refuse: the `WHERE v_limit > 0` on the INSERT's
    -- source rows gates the very-first-row-of-the-period case; the
    -- `WHERE resumes_parsed < v_limit` on the UPDATE gates every later
    -- increment. See the function comment above for the concurrency
    -- argument.
    insert into public.ai_usage as u (account_id, period, resumes_parsed)
    select p_account_id, v_period, 1
    where v_limit > 0
    on conflict (account_id, period) do update
      set resumes_parsed = u.resumes_parsed + 1
      where u.resumes_parsed < v_limit
    returning u.resumes_parsed into v_new_count;

    if not found then
      if v_is_fresh_claim then
        -- Undo the claim so this key isn't left permanently wedged by a
        -- reservation that was refused.
        delete from public.ai_parse_attempts where id = v_attempt_id;
      end if;
      -- Reclaim-from-'failed' path: leave the row as 'failed' — nothing
      -- to undo, it already reflects "no reservation held".
      return jsonb_build_object('outcome', 'cap_reached');
    end if;

    if not v_is_fresh_claim then
      -- Reclaim-from-'failed': a brand-new reservation, so — same reasoning
      -- as the stale-reclaim branch above — this is also a new generation.
      update public.ai_parse_attempts
         set status = 'in_progress', started_at = now(), result = null, period = v_period, generation = generation + 1
       where id = v_attempt_id
      returning generation into v_generation;
    end if;
  end if;

  return jsonb_build_object('outcome', 'claimed', 'attempt_id', v_attempt_id, 'generation', v_generation);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."claim_due_task_notifications"("p_limit" integer) RETURNS TABLE("id" bigint, "task_id" bigint, "account_id" bigint, "recipient_email" "text", "task_text" "text", "due_date" timestamp with time zone, "target_type" "text", "target_id" bigint, "attempts" integer, "claimed_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform public.enqueue_due_task_notifications();

  return query
  with claimed as (
    update public.task_notifications tn
    set status = 'sending', attempts = tn.attempts + 1, claimed_at = now()
    where tn.id in (
      select tn2.id from public.task_notifications tn2
      where (
        tn2.status = 'pending'
        and (tn2.next_attempt_at is null or tn2.next_attempt_at <= now())
      ) or (
        tn2.status = 'sending'
        and tn2.claimed_at < now() - interval '10 minutes'
      )
      order by tn2.created_at
      limit p_limit
      for update skip locked
    )
    returning tn.*
  )
  select
    claimed.id,
    claimed.task_id,
    claimed.account_id,
    claimed.recipient_email,
    t.text,
    claimed.due_date,
    t.target_type,
    t.target_id,
    claimed.attempts,
    claimed.claimed_at
  from claimed
  join public.tasks t on t.id = claimed.task_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."claim_message_notifications"("p_limit" integer) RETURNS TABLE("id" bigint, "channel" "text", "recipient_member_id" bigint, "recipient_email" "text", "thread_id" bigint, "message_body" "text", "subject_type" "text", "subject_id" bigint, "push_subscriptions" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  -- Every OUT column above (id, channel, ...) is an implicitly declared
  -- plpgsql variable in scope for the whole function body, so a BARE `id`
  -- inside the query below is ambiguous with the OUT parameter of the same
  -- name — table aliases on every reference (mn/mn2), not just on the final
  -- projection, are required here, not stylistic.
  return query
  with claimed as (
    update public.message_notifications mn
    set status = 'sending', attempts = attempts + 1
    where mn.id in (
      select mn2.id from public.message_notifications mn2
      where mn2.status = 'pending'
      order by mn2.created_at
      limit p_limit
      for update skip locked
    )
    returning mn.*
  )
  select
    claimed.id,
    claimed.channel,
    claimed.recipient_member_id,
    claimed.recipient_email,
    m.thread_id,
    m.body,
    t.subject_type,
    t.subject_id,
    case when claimed.channel = 'push' then (
      select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth))
      from public.push_subscriptions ps
      where ps.member_id = claimed.recipient_member_id
    ) else null end
  from claimed
  join public.messages m on m.id = claimed.message_id
  join public.threads t on t.id = m.thread_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."confirm_ai_parse_attempt"("p_account_id" bigint, "p_attempt_id" bigint, "p_generation" bigint, "p_result" "jsonb", "p_result_schema_version" smallint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_generation bigint;
  v_status text;
  v_result jsonb;
  v_result_schema_version smallint;
begin
  update public.ai_parse_attempts
     set status = 'completed', result = p_result, result_schema_version = p_result_schema_version
   where id = p_attempt_id
     and account_id = p_account_id
     and status = 'in_progress'
     and generation = p_generation;

  if found then
    return jsonb_build_object('outcome', 'applied');
  end if;

  select generation, status, result, result_schema_version
    into v_generation, v_status, v_result, v_result_schema_version
  from public.ai_parse_attempts
  where id = p_attempt_id and account_id = p_account_id;

  if not found then
    raise exception 'ai_parse_attempts % is not confirmable for account %', p_attempt_id, p_account_id;
  end if;

  if v_generation = p_generation and v_status = 'completed' then
    -- Idempotent retry of THIS SAME generation's own already-applied
    -- confirm (e.g. a lost-response network retry) — success, not merely
    -- "superseded by someone else".
    return jsonb_build_object('outcome', 'applied');
  end if;

  -- Either a newer generation already reclaimed this row (v_generation !=
  -- p_generation), or this generation's own reservation was already
  -- released through a different path (e.g. a client-side timeout) before
  -- this confirm arrived. Either way this call must not touch status,
  -- result, or ai_usage on another generation's behalf.
  if v_status = 'completed' then
    return jsonb_build_object(
      'outcome', 'superseded', 'status', v_status,
      'result', v_result, 'result_schema_version', v_result_schema_version
    );
  end if;

  return jsonb_build_object('outcome', 'superseded', 'status', v_status);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."connection_is_active_for_caller"("p_connection_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return exists (
    select 1 from public.connections c
    where c.id = p_connection_id
      and c.status = 'accepted'
      and (
        c.household_account_id = public.current_context_id()
        or c.shadchanus_account_id = public.current_context_id()
      )
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."consent_to_republish_listing"("p_single_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.listing_withdrawal_locks ll
    where ll.account_id = public.current_context_id()
      and ll.single_id = p_single_id
      and exists (
        select 1
        from public.account_members am
          join public.singles s on s.member_id = am.id
        where am.account_id = public.current_context_id()
          and am.user_id = auth.uid()
          and am.role in ('single', 'self_manager')
          and s.id = ll.single_id
      );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."create_child_grant"("p_target_single_id" bigint, "p_grantee_email" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_proposer_account_id bigint := public.current_context_id();
  v_proposer_kind text;
  v_token text;
  v_single public.singles;
  v_member_role text;
begin
  -- Caller must be an active member of the current context with owning role
  if v_proposer_account_id is null or not exists (
    select 1 from public.account_members am
    where am.account_id = v_proposer_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'create_child_grant requires an active parent_admin or self_manager membership of the current context'
      using errcode = 'insufficient_privilege';
  end if;

  -- Current context must be a household (grants are household-to-household)
  select kind into v_proposer_kind from public.accounts where id = v_proposer_account_id;
  if v_proposer_kind <> 'household' then
    raise exception 'grants can only be proposed from a household context'
      using errcode = 'check_violation';
  end if;

  -- Target single must exist and belong to the proposer's account
  select * into v_single
  from public.singles
  where id = p_target_single_id
    and account_id = v_proposer_account_id;

  if not found then
    raise exception 'single % not found in this household', p_target_single_id
      using errcode = 'check_violation';
  end if;

  -- Generate token and store hash
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.child_grants (
    proposer_account_id, target_single_id, token_hash, expires_at
  ) values (
    v_proposer_account_id, p_target_single_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '7 days'
  );

  return v_token;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."create_connection_invite"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint := public.current_context_id();
  v_kind text;
  v_token text;
begin
  if v_account_id is null or not exists (
    select 1 from public.account_members am
    where am.account_id = v_account_id and am.user_id = auth.uid() and am.status = 'active'
  ) then
    raise exception 'create_connection_invite requires an active membership of the current context'
      using errcode = 'insufficient_privilege';
  end if;

  select kind into v_kind from public.accounts where id = v_account_id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.connection_invites (
    inviter_account_id, inviter_kind, token_hash, expires_at
  ) values (
    v_account_id, v_kind,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '7 days'
  );

  return v_token;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."create_invite"("p_email" "text", "p_role" "text", "p_target_single_id" bigint DEFAULT NULL::bigint) RETURNS "public"."invites"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_membership_id bigint;
  v_caller_role text;
  v_account_kind text;
  v_invite public.invites;
begin
  v_account_id := public.current_context_id();

  select am.id, am.role into v_membership_id, v_caller_role
  from public.account_members am
  where am.account_id = v_account_id
    and am.user_id = auth.uid()
    and am.status = 'active';

  if v_membership_id is null then
    raise exception 'no active membership of the current context'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.is_invite_capable_role(v_caller_role) then
    raise exception 'role % may not send invites', v_caller_role
      using errcode = 'insufficient_privilege';
  end if;

  if public.role_authority(p_role) > public.role_authority(v_caller_role) then
    raise exception 'cannot invite role % above your own authority', p_role
      using errcode = 'insufficient_privilege';
  end if;

  select kind into v_account_kind from public.accounts where id = v_account_id;

  if v_account_kind = 'household' and p_role not in ('parent_admin', 'helper', 'single') then
    raise exception 'role % is not invitable into a household-kind account', p_role
      using errcode = 'check_violation';
  end if;

  if v_account_kind = 'shadchanus' and p_role <> 'shadchan' then
    raise exception 'role % is not invitable into a shadchanus-kind account', p_role
      using errcode = 'check_violation';
  end if;

  -- Story 6.1 (AC-2, AC-4): a single-role invite always names a target — the
  -- check constraint would catch a null one too, but this is a clearer
  -- client message than a bare constraint violation.
  if p_role = 'single' and p_target_single_id is null then
    raise exception 'a single-role invite requires a target single'
      using errcode = 'check_violation';
  end if;

  -- Story 6.1 (AC-4): refuses an already-linked target at creation time
  -- (UX only — accept_invite() fails closed independently if the target
  -- becomes linked in the window between invite and acceptance).
  if p_target_single_id is not null and not exists (
    select 1 from public.singles s
    where s.id = p_target_single_id
      and s.account_id = v_account_id
      and s.member_id is null
  ) then
    raise exception 'single % not found in current account', p_target_single_id
      using errcode = 'check_violation';
  end if;

  insert into public.invites (email, account_id, role, invited_by, target_single_id)
  values (p_email, v_account_id, p_role, v_membership_id, p_target_single_id)
  returning * into v_invite;

  return v_invite;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."create_reference_for_shidduch"("p_shidduchim_id" bigint, "p_name_en" "text" DEFAULT NULL::"text", "p_name_he" "text" DEFAULT NULL::"text", "p_relationship" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_school" "text" DEFAULT NULL::"text", "p_grad_year" integer DEFAULT NULL::integer, "p_relationship_override" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."references"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_reference_id bigint;
  v_link_id bigint;
begin
  -- RULING 7 / R7: a reference exists only inside a shidduch's context. The
  -- two-call client path (insert, then link_reference_to_shidduch) could mint
  -- an orphan whenever the second call failed. Both inserts happen here, in
  -- one statement, so the orphan state is unreachable by construction rather
  -- than merely discouraged.
  --
  -- SECURITY DEFINER, deliberately, so that direct INSERT on "references" can
  -- be revoked from `authenticated` and this becomes the only door. That
  -- turns the two checks below from belt-and-braces into the ONLY enforcement
  -- there is: under DEFINER the RLS policies on "references" and
  -- reference_links (05_policies.sql:423-431 and :641-650) no longer apply to
  -- this function, and BOTH of their conjuncts have to be re-stated here.
  -- The account scope was already re-implemented; the role check was not, and
  -- omitting it would have let a `single` write to the reference book that
  -- Story 6.3 denies them. Do not remove either check.
  v_account_id := public.current_context_id();
  if v_account_id is null then
    raise exception 'no account context for create_reference_for_shidduch';
  end if;

  if public.current_member_role() = 'single' then
    raise exception 'a single cannot create references'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
  ) then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;

  insert into public."references" (
    account_id, name_en, name_he, relationship, phone, school, grad_year
  ) values (
    v_account_id, p_name_en, p_name_he, p_relationship, p_phone, p_school, p_grad_year
  )
  returning id into v_reference_id;

  insert into public.reference_links (
    account_id, reference_id, shidduchim_id, call_status, relationship_override
  ) values (
    v_account_id, v_reference_id, p_shidduchim_id, 'not_started', p_relationship_override
  )
  returning id into v_link_id;

  insert into public.interactions (
    account_id, target_type, target_id, scope, reference_link_id, kind, body, metadata
  ) values (
    v_account_id, 'reference', v_reference_id, 'shidduch', v_link_id, 'link_created',
    null, jsonb_build_object('shidduchim_id', p_shidduchim_id)
  );

  return query select * from public."references" where id = v_reference_id;
end;
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

CREATE OR REPLACE FUNCTION "public"."create_thread"("p_subject_type" "text", "p_subject_id" bigint DEFAULT NULL::bigint, "p_participant_member_ids" bigint[] DEFAULT '{}'::bigint[], "p_visibility" "text" DEFAULT NULL::"text", "p_connection_id" bigint DEFAULT NULL::bigint) RETURNS "public"."threads"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_connection_id bigint;
  v_household_account_id bigint;
  v_shadchanus_account_id bigint;
  v_member_id bigint;
  v_visibility text;
  v_thread public.threads;
  v_participant_id bigint;
begin
  if p_connection_id is not null then
    -- AC-1: the caller's active context must be one side of THIS
    -- connection, currently accepted — anything else raises 42501. This
    -- also covers "no active context at all" for free: current_context_id()
    -- is then NULL, which never equals either side, so
    -- connection_is_active_for_caller() returns false.
    if not public.connection_is_active_for_caller(p_connection_id) then
      raise exception 'connection % is not active for the current context', p_connection_id
        using errcode = '42501';
    end if;
    v_connection_id := p_connection_id;
    v_account_id := null;
    select c.household_account_id, c.shadchanus_account_id
      into v_household_account_id, v_shadchanus_account_id
      from public.connections c
      where c.id = p_connection_id;
  else
    v_account_id := public.current_context_id();
    if v_account_id is null then
      raise exception 'no account context for create_thread (no account exists)';
    end if;
    v_connection_id := null;
  end if;

  v_member_id := public.current_member_id();
  if v_member_id is null then
    raise exception 'no active membership for create_thread';
  end if;

  if p_subject_type not in ('shidduch', 'relationship') then
    raise exception 'invalid thread subject_type: %', p_subject_type
      using errcode = 'check_violation';
  end if;

  -- Never cross the account boundary (AD-1): the subject shidduch must
  -- belong to the RELEVANT household — the caller's own account on the
  -- account axis; the connection's HOUSEHOLD side on the connection axis
  -- (AC-2/AD-4), never `current_context_id()` — a shadchan's active context
  -- is always their shadchanus account, which by AD-2 may never contain a
  -- household domain row and therefore holds no `shidduchim` at all. Under
  -- an account-only check this would raise for every shadchan caller.
  if p_subject_type = 'shidduch' and not exists (
    select 1 from public.shidduchim
    where id = p_subject_id
      and account_id = coalesce(v_household_account_id, v_account_id)
  ) then
    raise exception 'shidduch % not found in current account', p_subject_id;
  end if;

  if p_visibility is not null and p_visibility not in ('open', 'private') then
    raise exception 'invalid thread visibility: %', p_visibility
      using errcode = 'check_violation';
  end if;

  v_visibility := coalesce(
    p_visibility,
    (
      select a.default_thread_visibility from public.accounts a
      where a.id = coalesce(v_account_id, v_household_account_id)
    )
  );

  insert into public.threads (
    account_id, connection_id, subject_type, subject_id, visibility, created_by_member_id
  ) values (
    v_account_id, v_connection_id,
    p_subject_type,
    case when p_subject_type = 'shidduch' then p_subject_id else null end,
    v_visibility, v_member_id
  )
  returning * into v_thread;

  -- The creator is always a participant, from the moment the thread exists
  -- (AC-2). Both scope columns left NULL on purpose (Task 3): NEVER hand-set
  -- account_id/connection_id here — set_thread_participant_defaults()
  -- (04_triggers.sql-wired) copies both from the parent thread, and doing it
  -- twice, in two places, is how the two get out of step.
  insert into public.thread_participants (thread_id, member_id)
  values (v_thread.id, v_member_id);

  -- One row per DISTINCT supplied id (AC-3, AC-7). Fail fast on any id that
  -- is not legal for this thread's axis — never let a caller believe
  -- someone is in a conversation who silently was not added
  -- (.claude/rules/coding-style.md). ON CONFLICT DO NOTHING
  -- (thread_participants_thread_id_member_id_key) absorbs a duplicate in
  -- the array, or the caller's own id repeated, without a second check.
  --
  -- AC-3: for a connection-scoped thread, an id is legal if it is an ACTIVE
  -- account_members row of EITHER side of the connection — cross-side
  -- participants are the whole point of this story. For the account axis,
  -- 7.1's rule is unchanged: the caller's own account only.
  foreach v_participant_id in array coalesce(p_participant_member_ids, '{}') loop
    if v_connection_id is not null then
      if not exists (
        select 1 from public.account_members
        where id = v_participant_id
          and status = 'active'
          and account_id in (v_household_account_id, v_shadchanus_account_id)
      ) then
        raise exception 'member % not found in either side of this connection', v_participant_id;
      end if;
    else
      if not exists (
        select 1 from public.account_members
        where id = v_participant_id and account_id = v_account_id and status = 'active'
      ) then
        raise exception 'member % not found in current account', v_participant_id;
      end if;
    end if;
    insert into public.thread_participants (thread_id, member_id)
    values (v_thread.id, v_participant_id)
    on conflict (thread_id, member_id) do nothing;
  end loop;

  return v_thread;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."cross_account_leak_reports"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from public.analytics_events
  where account_id != public.current_context_id();
  return v_count;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."current_account_demo"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(
    (select a.demo from public.accounts a where a.id = public.current_context_id()),
    false
  );
$$;

CREATE OR REPLACE FUNCTION "public"."current_context_id"() RETURNS bigint
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."current_member_id"() RETURNS bigint
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_member_id bigint;
begin
  select am.id into v_member_id
  from public.account_members am
  where am.user_id = auth.uid()
    and am.account_id = public.current_context_id()
    and am.status = 'active'
  order by am.id
  limit 1;

  return v_member_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."current_member_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select am.role
  from public.account_members am
  where am.id = public.current_member_id();
$$;

CREATE OR REPLACE FUNCTION "public"."delete_push_subscription_by_endpoint"("p_endpoint" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."duplicate_flag_false_positive_rate"() RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_total bigint;
  v_dismissed bigint;
begin
  select count(*) into v_total
  from public.analytics_events
  where account_id = public.current_context_id()
    and event_type = 'duplicate_confirmed';

  if v_total = 0 then
    return 0;
  end if;

  select count(*) into v_dismissed
  from public.analytics_events
  where account_id = public.current_context_id()
    and event_type = 'duplicate_confirmed'
    and (properties->>'dismissed')::boolean = true;

  return round((v_dismissed::numeric / v_total::numeric) * 100, 2);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."end_connection"("p_connection_id" bigint) RETURNS "public"."connections"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_connection public.connections;
  v_actor_account_id bigint := public.current_context_id();
begin
  select * into v_connection from public.connections where id = p_connection_id;

  if not found
     or v_actor_account_id is null
     or v_actor_account_id not in (v_connection.household_account_id, v_connection.shadchanus_account_id)
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id and am.user_id = auth.uid() and am.status = 'active'
  ) then
    raise exception 'connection % not found', p_connection_id;
  end if;

  if v_connection.status = 'ended' then
    raise exception 'connection % has already ended', p_connection_id
      using errcode = 'check_violation';
  end if;

  update public.connections
  set status = 'ended', ended_at = now(), ended_by_account_id = v_actor_account_id
  where id = p_connection_id
  returning * into v_connection;

  return v_connection;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."enforce_connection_kinds"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_household_kind text;
  v_shadchanus_kind text;
begin
  select kind into v_household_kind from public.accounts where id = new.household_account_id;
  select kind into v_shadchanus_kind from public.accounts where id = new.shadchanus_account_id;

  if v_household_kind is distinct from 'household' then
    raise exception 'connections.household_account_id % is not a household-kind account', new.household_account_id
      using errcode = 'check_violation';
  end if;

  if v_shadchanus_kind is distinct from 'shadchanus' then
    raise exception 'connections.shadchanus_account_id % is not a shadchanus-kind account', new.shadchanus_account_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."enforce_household_scope"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1 from public.accounts
    where id = new.account_id and kind = 'household'
  ) then
    raise exception 'account % is not a household-kind account', new.account_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."enforce_membership_role_matches_context"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_kind text;
begin
  select kind into v_kind from public.accounts where id = new.account_id;

  if new.role = 'shadchan' and v_kind is distinct from 'shadchanus' then
    raise exception 'a shadchan-role membership requires a shadchanus-kind account'
      using errcode = 'check_violation';
  end if;

  if new.role <> 'shadchan' and v_kind is distinct from 'household' then
    raise exception 'role % requires a household-kind account', new.role
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."enforce_pipeline_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.pipeline_state is distinct from old.pipeline_state then
    if not exists (
      select 1 from public.pipeline_transitions t
      where t.from_state = old.pipeline_state
        and t.to_state = new.pipeline_state
    ) then
      raise exception 'illegal pipeline transition: % -> %', old.pipeline_state, new.pipeline_state
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."enforce_share_link_revoke_once"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if old.revoked_at is not null
     and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a revoked share link cannot be un-revoked';
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."enforce_shidduch_initial_state"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.pipeline_state not in ('new', 'look_into', 'not_sure', 'for_sure_not') then
    raise exception 'a shidduch cannot be created in decision state % (reachable only from look_into)', new.pipeline_state
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."enqueue_due_task_notifications"("p_now" timestamp with time zone DEFAULT "now"()) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_count integer;
begin
  with candidates as (
    select
      t.id as task_id,
      t.account_id,
      t.due_date,
      m.email::text as recipient_email,
      case
        when t.member_id is null then 'skipped'
        when m.email is null then 'failed'
        else 'pending'
      end as status,
      case
        when t.member_id is null then 'unassigned — no member_id set (deliberate, not a delivery failure)'
        when m.email is null then 'member_id names no live or no enabled member of this task''s own account'
        else null
      end as error
    from public.tasks t
    left join public.members m
      on m.id = t.member_id and public.is_deliverable_member(m.id, t.account_id)
    where t.done_date is null
      and t.due_date is not null
      and t.due_date <= p_now
      and 'email' = any (t.delivery_channels)
  ),
  inserted as (
    insert into public.task_notifications (account_id, task_id, channel, due_date, status, recipient_email, error)
    select candidates.account_id, candidates.task_id, 'email', candidates.due_date, candidates.status, candidates.recipient_email, candidates.error
    from candidates
    on conflict (task_id, channel, due_date) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

-- Export all data for the current account across all tenant tables.
-- Returns JSONB with one key per table containing an array of rows.
-- Uses explicit table list to avoid dynamic SQL issues with to_jsonb()
CREATE OR REPLACE FUNCTION "public"."export_account_data"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint := public.current_context_id();
  v_result jsonb := '{}'::jsonb;
begin
  -- Verify authenticated caller (not service_role)
  if current_user = 'postgres' then
    raise exception 'export_account_data: must be called by authenticated user'
      using errcode = 'insufficient_privilege';
  end if;

  -- Explicitly list each table to avoid dynamic SQL issues
  -- This is maintainable because schema changes require migrations anyway
  SELECT jsonb_set(v_result, '{accounts}', coalesce(jsonb_agg(to_jsonb(acc)), '[]'))
  FROM public.accounts acc WHERE acc.id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{singles}', coalesce(jsonb_agg(to_jsonb(s)), '[]'))
  FROM public.singles s WHERE s.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{resumes}', coalesce(jsonb_agg(to_jsonb(r)), '[]'))
  FROM public.resumes r WHERE r.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{shidduchim}', coalesce(jsonb_agg(to_jsonb(sh)), '[]'))
  FROM public.shidduchim sh WHERE sh.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{messages}', coalesce(jsonb_agg(to_jsonb(m)), '[]'))
  FROM public.messages m WHERE m.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{references}', coalesce(jsonb_agg(to_jsonb(ref)), '[]'))
  FROM public.references ref WHERE ref.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{tasks}', coalesce(jsonb_agg(to_jsonb(t)), '[]'))
  FROM public.tasks t WHERE t.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{notes}', coalesce(jsonb_agg(to_jsonb(n)), '[]'))
  FROM public.notes n WHERE n.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{events}', coalesce(jsonb_agg(to_jsonb(e)), '[]'))
  FROM public.events e WHERE e.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{medical_notes}', coalesce(jsonb_agg(to_jsonb(mn)), '[]'))
  FROM public.medical_notes mn WHERE mn.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{connections}', coalesce(jsonb_agg(to_jsonb(c)), '[]'))
  FROM public.connections c WHERE c.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{connection_invites}', coalesce(jsonb_agg(to_jsonb(ci)), '[]'))
  FROM public.connection_invites ci WHERE ci.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{child_grants}', coalesce(jsonb_agg(to_jsonb(cg)), '[]'))
  FROM public.child_grants cg WHERE cg.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{share_links}', coalesce(jsonb_agg(to_jsonb(sl)), '[]'))
  FROM public.share_links sl WHERE sl.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{account_members}', coalesce(jsonb_agg(to_jsonb(am)), '[]'))
  FROM public.account_members am WHERE am.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{purge_requests}', coalesce(jsonb_agg(to_jsonb(pr)), '[]'))
  FROM public.purge_requests pr WHERE pr.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{deletion_requests}', coalesce(jsonb_agg(to_jsonb(dr)), '[]'))
  FROM public.deletion_requests dr WHERE dr.account_id = v_account_id
  INTO v_result;

  -- Add remaining tables with account_id column
  SELECT jsonb_set(v_result, '{entity_files}', coalesce(jsonb_agg(to_jsonb(ef)), '[]'))
  FROM public.entity_files ef WHERE ef.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{configuration}', coalesce(jsonb_agg(to_jsonb(c)), '[]'))
  FROM public.configuration c WHERE c.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{ai_usage}', coalesce(jsonb_agg(to_jsonb(au)), '[]'))
  FROM public.ai_usage au WHERE au.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{stripe_events}', coalesce(jsonb_agg(to_jsonb(se)), '[]'))
  FROM public.stripe_events se WHERE se.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{ai_parse_attempts}', coalesce(jsonb_agg(to_jsonb(apa)), '[]'))
  FROM public.ai_parse_attempts apa WHERE apa.account_id = v_account_id
  INTO v_result;

  SELECT jsonb_set(v_result, '{cron_heartbeat}', coalesce(jsonb_agg(to_jsonb(ch)), '[]'))
  FROM public.cron_heartbeat ch WHERE ch.account_id = v_account_id
  INTO v_result;

  RETURN v_result;
end;
$$;

-- Export files (resumes, photos, attachments) as base64-encoded bytes.
-- Returns JSONB with one key per file table containing array of {id, filename, content_base64, content_type, storage_path}.
-- Note: entity_files are stored in Supabase Storage; only metadata + storage_path are exported.
-- Resume photos have file_bytes stored directly in the database.
CREATE OR REPLACE FUNCTION "public"."export_account_files"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint := public.current_context_id();
  v_result jsonb := '{}'::jsonb;
  v_rows jsonb;
begin
  -- Verify authenticated caller
  if current_user = 'postgres' then
    raise exception 'export_account_files: must be called by authenticated user'
      using errcode = 'insufficient_privilege';
  end if;

  -- Resume photos (have file_bytes in DB)
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows
  from (
    select
      rp.id,
      rp.file_name as filename,
      encode(rp.file_bytes, 'base64') as content_base64,
      rp.content_type,
      null as storage_path
    from public.resume_photos rp
    join public.resumes r on r.id = rp.resume_id
    where r.account_id = v_account_id
  ) t;
  v_result := jsonb_set(v_result, array['resume_photos'], v_rows);

  -- Entity files (attachments) - stored in Supabase Storage, export metadata + storage_path
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows
  from (
    select
      ef.id,
      ef.file_name as filename,
      null as content_base64,
      ef.mime_type as content_type,
      ef.storage_path
    from public.entity_files ef
    where ef.account_id = v_account_id
  ) t;
  v_result := jsonb_set(v_result, array['entity_files'], v_rows);

  return v_result;
end;
$$;

-- Combined export: data + files in one call.
CREATE OR REPLACE FUNCTION "public"."export_full_account_bundle"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_data jsonb;
  v_files jsonb;
  v_bundle jsonb;
begin
  v_data := public.export_account_data();
  v_files := public.export_account_files();
  v_bundle := jsonb_build_object(
    'exported_at', now(),
    'account_id', public.current_context_id(),
    'data', v_data,
    'files', v_files
  );
  return v_bundle;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."fan_out_message_notifications"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_participant record;
  v_user_id uuid;
  v_email text;
  v_disabled boolean;
begin
  for v_participant in
    select tp.member_id
    from public.thread_participants tp
    where tp.thread_id = new.thread_id
      and tp.member_id is distinct from new.sender_member_id
  loop
    select am.user_id into v_user_id
    from public.account_members am
    where am.id = v_participant.member_id;

    if v_user_id is null then
      insert into public.message_notifications (
        account_id, connection_id, message_id, recipient_member_id, channel, status, error
      )
      values (
        new.account_id, new.connection_id, new.id, v_participant.member_id, 'email', 'skipped',
        'recipient membership has no accepted login (account_members.user_id is null)'
      )
      on conflict (message_id, recipient_member_id, channel) do nothing;
    else
      select m.email::text, m.disabled into v_email, v_disabled
      from public.members m
      where m.user_id = v_user_id;

      if v_email is null or v_disabled then
        insert into public.message_notifications (
          account_id, connection_id, message_id, recipient_member_id, channel, status, error
        )
        values (
          new.account_id, new.connection_id, new.id, v_participant.member_id, 'email', 'failed',
          case
            when v_email is null then 'no public.members row for this login'
            else 'recipient member is disabled'
          end
        )
        on conflict (message_id, recipient_member_id, channel) do nothing;
      else
        insert into public.message_notifications (
          account_id, connection_id, message_id, recipient_member_id, channel, status, recipient_email
        )
        values (
          new.account_id, new.connection_id, new.id, v_participant.member_id, 'email', 'pending', v_email
        )
        on conflict (message_id, recipient_member_id, channel) do nothing;
      end if;
    end if;

    if exists (
      select 1 from public.push_subscriptions ps
      where ps.member_id = v_participant.member_id
    ) then
      insert into public.message_notifications (
        account_id, connection_id, message_id, recipient_member_id, channel, status
      )
      values (
        new.account_id, new.connection_id, new.id, v_participant.member_id, 'push', 'pending'
      )
      on conflict (message_id, recipient_member_id, channel) do nothing;
    end if;
  end loop;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."force_reclaim_ai_parse_attempt"("p_account_id" bigint, "p_attempt_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_generation bigint;
begin
  update public.ai_parse_attempts
     set status = 'in_progress', started_at = now(), result = null, generation = generation + 1
   where id = p_attempt_id
     and account_id = p_account_id
     and status = 'completed'
  returning generation into v_generation;

  if found then
    return jsonb_build_object('outcome', 'reclaimed', 'generation', v_generation);
  end if;

  return jsonb_build_object('outcome', 'not_reclaimable');
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_invite_preview"("p_token" "uuid") RETURNS TABLE("email" "text", "account_name" "text", "role" "text", "status" "text", "expires_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    i.email,
    a.name as account_name,
    i.role,
    case
      when i.status = 'pending' and i.expires_at < now() then 'expired'
      else i.status
    end as status,
    i.expires_at
  from public.invites i
  join public.accounts a on a.id = i.account_id
  where i.token = p_token;
$$;

-- Get all tenant tables that have an account_id column.
-- This derives the export scope from the schema rather than hardcoding.
CREATE OR REPLACE FUNCTION "public"."get_tenant_tables"() RETURNS TABLE("table_name" "text", "column_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return query
  select c.relname::text as table_name, a.attname::text as column_name
  from pg_class c
  join pg_attribute a on a.attrelid = c.oid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and a.attname = 'account_id'
    and a.attnum > 0
    and not a.attisdropped
    and c.relname not in (
      'subscription', 'ai_usage', 'stripe_events', 'ai_parse_attempts',
      'cron_heartbeat', 'configuration', 'entity_files'
    )
  order by c.relname;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."guard_persona_removal"("p_membership_id" bigint, "p_account_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_has_other_member boolean;
begin
  select exists (
    select 1 from public.account_members
    where account_id = p_account_id and status = 'active' and id <> p_membership_id
  ) into v_has_other_member;

  if not v_has_other_member and public.account_has_domain_data(p_account_id) then
    raise exception 'cannot remove your last active membership of this account'
      using errcode = 'check_violation';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  member_count int;
begin
  select count(id) into member_count
  from public.members;

  insert into public.members (first_name, last_name, email, user_id, administrator)
  values (
    coalesce(
      nullif(new.raw_user_meta_data ->> 'first_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', ''),
      nullif(new.raw_user_meta_data ->> 'given_name', ''),
      nullif(split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ' ', 1), ''),
      'Pending'),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'last_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', ''),
      nullif(new.raw_user_meta_data ->> 'family_name', ''),
      case when position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')) > 0
           then substr(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')) + 1)
      end,
      'Pending'),
    new.email,
    new.id,
    case when member_count > 0 then FALSE else TRUE end
  );

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_update_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.members
  set
    first_name = coalesce(
      nullif(new.raw_user_meta_data ->> 'first_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', ''),
      nullif(new.raw_user_meta_data ->> 'given_name', ''),
      nullif(split_part(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), ' ', 1), ''),
      'Pending'),
    last_name = coalesce(
      nullif(new.raw_user_meta_data ->> 'last_name', ''),
      nullif(new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', ''),
      nullif(new.raw_user_meta_data ->> 'family_name', ''),
      case when position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')) > 0
           then substr(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), position(' ' in coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')) + 1)
      end,
      'Pending'),
    email = new.email
  where user_id = new.id;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."hide_resume_photo"("p_photo_id" bigint) RETURNS SETOF "public"."resume_photos"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
begin
  v_account_id := public.current_context_id();

  if not exists (
    select 1 from public.resume_photos p
    where p.id = p_photo_id and p.account_id = v_account_id
  ) then
    raise exception 'photo % not found in current account', p_photo_id;
  end if;

  return query
  update public.resume_photos
  set hidden_at = now()
  where id = p_photo_id and account_id = v_account_id
  returning *;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."identity_name_key"("p_input" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  v_norm text;
  v_token text;
  v_out text[] := array[]::text[];
begin
  v_norm := public.normalize_identity_text(p_input);
  if v_norm is null then
    return null;
  end if;

  -- Hebrew final forms fold to their medial forms.
  v_norm := translate(v_norm, 'ךםןףץ', 'כמנפצ');

  foreach v_token in array string_to_array(v_norm, ' ') loop
    if v_token = '' then
      continue;
    end if;

    -- Honorifics are dropped from the KEY only. "Rabbi Chaim Cohen" and
    -- "Haim Cohen" are the same person, but their exact normalized names still
    -- differ — which is right, because the key is the fuzzy signal and
    -- name_*_norm stays the strict one.
    if v_token in (
      'rabbi', 'rav', 'harav', 'reb', 'rebbetzin', 'rebbitzen', 'rebetzin',
      'rabanit', 'harabanit', 'morah', 'mr', 'mrs', 'ms', 'miss', 'dr', 'prof',
      'הרב', 'רב', 'רבי', 'מרת', 'הרבנית'
    ) then
      continue;
    end if;

    v_token := case v_token
      when 'moishe' then 'moshe' when 'moses' then 'moshe' when 'moshy' then 'moshe'
      when 'yakov' then 'yaakov' when 'yankel' then 'yaakov' when 'jacob' then 'yaakov'
      when 'kobi' then 'yaakov'
      when 'haim' then 'chaim' when 'hyman' then 'chaim'
      when 'yitzchok' then 'yitzchak' when 'itzhak' then 'yitzchak' when 'itzik' then 'yitzchak'
      when 'isaac' then 'yitzchak' when 'yitz' then 'yitzchak'
      when 'abraham' then 'avraham' when 'avrohom' then 'avraham' when 'avi' then 'avraham'
      when 'abe' then 'avraham'
      when 'yossi' then 'yosef' when 'joseph' then 'yosef' when 'yoseph' then 'yosef'
      when 'shloime' then 'shlomo' when 'solomon' then 'shlomo' when 'shloimy' then 'shlomo'
      when 'dovid' then 'david' when 'dovi' then 'david' when 'duvid' then 'david'
      when 'shmuly' then 'shmuel' when 'samuel' then 'shmuel'
      when 'mendy' then 'menachem' when 'mendel' then 'menachem'
      when 'motty' then 'mordechai' when 'mordche' then 'mordechai' when 'motti' then 'mordechai'
      when 'benjamin' then 'binyamin' when 'binyomin' then 'binyamin' when 'benny' then 'binyamin'
      when 'ephraim' then 'efraim' when 'efrayim' then 'efraim'
      when 'zvi' then 'tzvi' when 'hershel' then 'tzvi' when 'hirsch' then 'tzvi'
      when 'rivky' then 'rivka' when 'rebecca' then 'rivka' when 'rifka' then 'rivka'
      when 'sara' then 'sarah' when 'suri' then 'sarah' when 'sori' then 'sarah'
      when 'estee' then 'esther' when 'esti' then 'esther' when 'ester' then 'esther'
      when 'hana' then 'chana' when 'hannah' then 'chana' when 'chani' then 'chana'
      when 'lea' then 'leah' when 'leiah' then 'leah'
      when 'miri' then 'miriam' when 'mimi' then 'miriam'
      when 'rochel' then 'rachel' when 'ruchi' then 'rachel' when 'ruchy' then 'rachel'
      when 'debbie' then 'devorah' when 'dvora' then 'devorah' when 'devora' then 'devorah'
      when 'malky' then 'malka' when 'malkie' then 'malka'
      when 'shaindy' then 'shaindel' when 'shaindi' then 'shaindel'
      else v_token
    end;

    -- Transliteration digraph folding (order matters: digraphs before letters).
    v_token := replace(v_token, 'tz', 'z');
    v_token := replace(v_token, 'ts', 'z');
    v_token := replace(v_token, 'ch', 'h');
    v_token := replace(v_token, 'kh', 'h');
    v_token := replace(v_token, 'ph', 'f');
    v_token := replace(v_token, 'ck', 'k');
    v_token := replace(v_token, 'q', 'k');
    v_token := replace(v_token, 'c', 'k');
    v_token := replace(v_token, 'w', 'v');
    v_token := replace(v_token, 'x', 'ks');

    -- Drop non-initial vowels, then collapse repeated letters.
    v_token := left(v_token, 1) || regexp_replace(substr(v_token, 2), '[aeiouy]', '', 'g');
    v_token := regexp_replace(v_token, '(.)\1+', '\1', 'g');

    if v_token <> '' then
      v_out := v_out || v_token;
    end if;
  end loop;

  if array_length(v_out, 1) is null then
    return null;
  end if;

  return array_to_string(v_out, ' ');
end;
$$;

CREATE OR REPLACE FUNCTION "public"."is_deliverable_member"("p_member_id" bigint, "p_account_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.members m
      join public.account_members am on am.user_id = m.user_id
    where m.id = p_member_id
      and am.account_id = p_account_id
      and am.status = 'active'
      and m.disabled = false
  );
$$;

CREATE OR REPLACE FUNCTION "public"."is_invite_capable_role"("p_role" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select p_role in ('parent_admin', 'self_manager', 'shadchan');
$$;

CREATE OR REPLACE FUNCTION "public"."is_owning_membership_role"("p_role" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select p_role in ('parent_admin', 'self_manager');
$$;

CREATE OR REPLACE FUNCTION "public"."is_single_visible_state"("s" "public"."pipeline_state") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."link_reference_to_shidduch"("p_reference_id" bigint, "p_shidduchim_id" bigint, "p_relationship_override" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."reference_links"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."lock_listing_on_single_withdrawal"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if old.listing_type = 'single' then
    if exists (
      select 1
      from public.account_members am
        join public.singles s on s.member_id = am.id
      where am.account_id = old.account_id
        and am.user_id = auth.uid()
        and am.role = 'single'
        and s.id = old.single_id
    ) then
      insert into public.listing_withdrawal_locks (account_id, single_id)
        values (old.account_id, old.single_id)
        on conflict (single_id) do nothing;
    end if;
  end if;
  return old;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."log_reference_call"("p_reference_link_id" bigint, "p_call_status" "text" DEFAULT NULL::"text", "p_what_they_said" "text" DEFAULT NULL::"text", "p_source" "text" DEFAULT 'manual'::"text") RETURNS SETOF "public"."reference_links"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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

  v_member_id := public.current_member_id();

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
$$;

CREATE OR REPLACE FUNCTION "public"."mark_thread_read"("p_thread_id" bigint) RETURNS "public"."thread_participants"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_participant public.thread_participants;
begin
  update public.thread_participants tp
  set last_read_at = now()
  where tp.member_id = public.current_member_id()
    and tp.thread_id = p_thread_id
  returning tp.* into v_participant;

  return v_participant;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."match_identity"("p_target_type" "text", "p_name_en" "text" DEFAULT NULL::"text", "p_name_he" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_parents" "text" DEFAULT NULL::"text", "p_seminary" "text" DEFAULT NULL::"text", "p_shul" "text" DEFAULT NULL::"text", "p_location" "text" DEFAULT NULL::"text", "p_exclude_target_id" bigint DEFAULT NULL::bigint) RETURNS TABLE("target_id" bigint, "confidence" numeric, "deciding_facts" "jsonb")
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."match_reference_on_entry"("p_name_en" "text" DEFAULT NULL::"text", "p_name_he" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_school" "text" DEFAULT NULL::"text", "p_exclude_id" bigint DEFAULT NULL::bigint) RETURNS TABLE("reference_id" bigint, "confidence" numeric, "deciding_facts" "jsonb", "name_en" "text", "name_he" "text", "phone" "text", "relationship" "text", "school" "text", "grad_year" integer, "linked_shidduchim_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select
    m.target_id,
    m.confidence,
    m.deciding_facts,
    r.name_en,
    r.name_he,
    r.phone,
    r.relationship,
    r.school,
    r.grad_year,
    (
      select count(distinct rl.shidduchim_id)
      from public.reference_links rl
      where rl.reference_id = r.id and rl.shidduchim_id is not null
    )
  from public.match_identity(
    'reference', p_name_en, p_name_he, p_phone, null, p_school, null, null, p_exclude_id
  ) m
  join public."references" r on r.id = m.target_id
  order by m.confidence desc, r.id asc;
$$;

CREATE OR REPLACE FUNCTION "public"."merge_references"("p_loser_id" bigint, "p_winner_id" bigint, "p_resolutions" "jsonb" DEFAULT '{}'::"jsonb") RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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

  v_member_id := public.current_member_id();

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
$$;

CREATE OR REPLACE FUNCTION "public"."misrouted_channel_items"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from public.inbox_items
  where account_id = public.current_context_id()
    and (
      source = 'shadchan' and connection_id is null
      or source in ('email', 'whatsapp', 'sms') and sender_needs_confirmation
    );
  return v_count;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."my_contexts"() RETURNS TABLE("account_id" bigint, "kind" "text", "name" "text", "role" "text", "is_active" boolean)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select
    am.account_id,
    a.kind,
    a.name,
    am.role,
    coalesce(am.account_id = public.current_context_id(), false) as is_active
  from public.account_members am
  join public.accounts a on a.id = am.account_id
  where am.user_id = auth.uid() and am.status = 'active';
$$;

CREATE OR REPLACE FUNCTION "public"."my_personas"() RETURNS TABLE("persona" "text", "account_id" bigint, "account_kind" "text", "role" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select 'shadchan'::text as persona, am.account_id, a.kind as account_kind, am.role
  from public.account_members am
  join public.accounts a on a.id = am.account_id
  where am.user_id = auth.uid() and am.status = 'active' and am.role = 'shadchan'

  union all

  select 'parent'::text, am.account_id, a.kind, am.role
  from public.account_members am
  join public.accounts a on a.id = am.account_id
  where am.user_id = auth.uid() and am.status = 'active' and am.role = 'parent_admin'

  union all

  -- Story 2.5: `s.status = 'active'` excludes a single remove_persona() has
  -- archived — without it, an archived single would still report as a held
  -- persona forever (the row still satisfies `s.member_id = am.id`), which
  -- would both re-suppress onboarding (AD-19/AC-8) and leave the Settings
  -- checklist showing the persona as still ticked right after removing it.
  select 'single'::text, am.account_id, a.kind, am.role
  from public.singles s
  join public.account_members am on am.id = s.member_id
  join public.accounts a on a.id = am.account_id
  where am.user_id = auth.uid()
    and am.status = 'active'
    and s.status = 'active'
    and (am.role = 'single' or public.is_owning_membership_role(am.role));
$$;

CREATE OR REPLACE FUNCTION "public"."normalize_identity_text"("p_input" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select nullif(
    trim(
      regexp_replace(
        regexp_replace(
          translate(
            lower(regexp_replace(coalesce(p_input, ''), '[֑-ׇ]', '', 'g')),
            'áàâäãåéèêëíìîïóòôöõúùûüñçýÿœæ',
            'aaaaaaeeeeiiiiooooouuuuncyyoa'
          ),
          '[^a-z0-9א-ת ]', ' ', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION "public"."normalize_phone"("p_input" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_input, ''), '[^0-9]', '', 'g');
  if v_digits = '' then
    return null;
  end if;

  if left(v_digits, 2) = '00' then
    v_digits := substr(v_digits, 3);
  end if;

  if left(v_digits, 3) = '972' then
    v_digits := substr(v_digits, 4);
  elsif length(v_digits) = 11 and left(v_digits, 1) = '1' then
    v_digits := substr(v_digits, 2);
  elsif left(v_digits, 2) = '44' and length(v_digits) > 10 then
    v_digits := substr(v_digits, 3);
  end if;

  v_digits := regexp_replace(v_digits, '^0+', '');

  if length(v_digits) < 7 then
    return null;
  end if;

  return v_digits;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."preview_child_grant"("p_token" "text") RETURNS TABLE("proposer_name" "text", "target_single_name_en" "text", "target_single_name_he" "text", "status" "text", "expires_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select a.name, s.first_name_en, s.first_name_he, cg.status, cg.expires_at
  from public.child_grants cg
  join public.accounts a on a.id = cg.proposer_account_id
  join public.singles s on s.id = cg.target_single_id and s.account_id = cg.proposer_account_id
  where cg.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and cg.status = 'pending'
    and cg.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION "public"."preview_connection_invite"("p_token" "text") RETURNS TABLE("inviter_name" "text", "inviter_kind" "text", "status" "text", "expires_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select a.name, ci.inviter_kind, ci.status, ci.expires_at
  from public.connection_invites ci
  join public.accounts a on a.id = ci.inviter_account_id
  where ci.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and ci.status = 'pending'
    and ci.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION "public"."preview_reference_merge"("p_loser_id" bigint, "p_winner_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."purge_connection_dependents"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.interactions
  where target_type = 'connection' and target_id = old.id;

  delete from public.tasks
  where target_type = 'connection' and target_id = old.id;

  delete from public.entity_files
  where target_type = 'connection' and target_id = old.id;

  return old;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."purge_polymorphic_dependents"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_target_type text := TG_ARGV[0];
begin
  delete from public.identity_signals
  where account_id = old.account_id and target_type = v_target_type and target_id = old.id;

  delete from public.interactions
  where account_id = old.account_id and target_type = v_target_type and target_id = old.id;

  delete from public.tasks
  where account_id = old.account_id and target_type = v_target_type and target_id = old.id;

  delete from public.entity_files
  where account_id = old.account_id and target_type = v_target_type and target_id = old.id;

  -- Story 7.1 (AC-10): a deleted shidduch takes its threads with it, on
  -- BOTH scope axes. thread_participants/messages cascade from this delete
  -- via their own composite FKs to threads (01_tables.sql) — no separate
  -- delete needed for them. An account_id = old.account_id predicate alone
  -- would miss a connection-scoped thread about the same subject (its
  -- account_id is NULL), leaving a shadchan holding a conversation about a
  -- deleted shidduch, pointing at a dangling subject — hence the exists()
  -- arm walking the connection back to old.account_id. v_target_type is
  -- 'reference'/'single'/'shadchan' for the other three callers of this
  -- function; none of those ever matches a thread's subject_type
  -- ('shidduch'/'relationship'), so this delete is a no-op for them.
  delete from public.threads t
  where t.subject_type = v_target_type
    and t.subject_id = old.id
    and (
      t.account_id = old.account_id
      or exists (
        select 1 from public.connections c
        where c.id = t.connection_id
          and c.household_account_id = old.account_id
      )
    );

  return old;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."record_cron_heartbeat"("p_worker" "text", "p_error" "text" DEFAULT NULL::"text", "p_failed_count" integer DEFAULT NULL::integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_error is not null and p_error not in ('rpc_failed', 'transport_failed', 'unknown') then
    raise exception 'invalid cron_heartbeat error code: %', p_error
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.cron_heartbeat (worker, last_run_at, last_ok_at, last_error, last_failed_count)
  values (
    p_worker, now(),
    case when p_error is null then now() else null end,
    p_error,
    case when p_error is null then coalesce(p_failed_count, 0) else 0 end
  )
  on conflict (worker) do update
    set last_run_at = now(),
        last_ok_at = case when p_error is null then now() else public.cron_heartbeat.last_ok_at end,
        last_error = p_error,
        last_failed_count = case
          when p_error is null then coalesce(p_failed_count, 0)
          else public.cron_heartbeat.last_failed_count
        end;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."redt_via_connection"("p_connection_id" bigint, "p_subject" "text", "p_raw_text" "text", "p_attachments" "jsonb" DEFAULT NULL::"jsonb") RETURNS "public"."inbox_items"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_connection public.connections;
  v_shadchan_name text;
  v_row public.inbox_items;
  v_thread public.threads;
  v_household_member_ids bigint[];
begin
  select * into v_connection from public.connections
    where id = p_connection_id and status = 'accepted';
  if v_connection is null then
    raise exception 'connection % is not an active connection', p_connection_id
      using errcode = 'insufficient_privilege';
  end if;

  if public.current_context_id() is distinct from v_connection.shadchanus_account_id then
    raise exception 'caller is not an active member of this connection''s shadchanus context'
      using errcode = 'insufficient_privilege';
  end if;

  -- Finding 5: p_raw_text becomes messages.body (NOT NULL) further down —
  -- reject it here, up front, with a message naming THIS rule rather than
  -- letting the caller hit that table's own constraint error later.
  if p_raw_text is null or length(trim(p_raw_text)) = 0 then
    raise exception 'redt text is required' using errcode = 'check_violation';
  end if;

  if length(p_raw_text) > 20000 then
    raise exception 'redt text is too long (% characters, limit 20000)', length(p_raw_text)
      using errcode = 'check_violation';
  end if;

  if p_subject is not null and length(p_subject) > 500 then
    raise exception 'redt subject is too long (% characters, limit 500)', length(p_subject)
      using errcode = 'check_violation';
  end if;

  -- Every legitimate writer (the Postmark inbound webhook, extractAndUpload
  -- Attachments.ts) always produces an array or null; a scalar or object
  -- here can only come from a direct RPC call bypassing every shipped UI
  -- (RedtComposeDialog.tsx never sends anything but null — see its own
  -- header comment). Size-capped for the same reason p_raw_text is: an
  -- unbounded client jsonb value would otherwise grow the household's row
  -- without limit.
  if p_attachments is not null and (
    jsonb_typeof(p_attachments) is distinct from 'array'
    or length(p_attachments::text) > 20000
  ) then
    raise exception 'redt attachments must be a JSON array no larger than 20000 characters'
      using errcode = 'check_violation';
  end if;

  select name into v_shadchan_name from public.accounts
    where id = v_connection.shadchanus_account_id;

  insert into public.inbox_items (
    account_id, source, subject, raw_text, sender, attachments, status, connection_id
  ) values (
    v_connection.household_account_id, 'shadchan', p_subject, p_raw_text,
    v_shadchan_name, p_attachments, 'unresolved', p_connection_id
  )
  returning * into v_row;

  -- Task 3 (AC-5): mirror this redt into a connection-scoped thread (Epic 7
  -- shape) so the shadchan retains their own durable record of what they
  -- sent — never the inbox_items row itself (household-scoped, unreachable
  -- to them per AD-20) and never the resulting shidduchim row's pipeline
  -- state. create_thread() is the ONE thread-creation function (7.1's,
  -- widened by 7.4 to accept p_connection_id) — never a second bespoke
  -- insert into public.threads. It already inserts the calling shadchan
  -- (via current_member_id()) as a participant, so p_participant_member_ids
  -- only needs the household's ACTIVE account_members ids.
  select array_agg(id) into v_household_member_ids
  from public.account_members
  where account_id = v_connection.household_account_id and status = 'active';

  -- Plain assignment, not `select ... into v_thread`: the latter raises a
  -- spurious "invalid input syntax for type bigint" against create_thread()'s
  -- own composite return value on this Postgres version when the call uses
  -- named-parameter (`:=`) syntax — reproduced in isolation against a
  -- minimal fixture; assignment form is unaffected and is what every other
  -- composite-returning call in this file already uses.
  v_thread := public.create_thread(
    p_subject_type := 'relationship',
    p_connection_id := p_connection_id,
    p_participant_member_ids := coalesce(v_household_member_ids, '{}')
  );

  -- There is no create_message()/send_message() RPC anywhere in the shipped
  -- schema: public.messages grants INSERT directly to authenticated, gated
  -- only by its own RLS ("Messages insertable by an existing participant",
  -- 05_policies.sql) — so this is necessarily a direct insert, the only
  -- path, mirroring the exact shape a client insert would use. Only
  -- thread_id/body are set: set_message_defaults() (04_triggers.sql-wired
  -- BEFORE INSERT) copies account_id/connection_id from the thread and
  -- stamps sender_member_id from current_member_id() itself — setting them
  -- again here would be a second place computing the same defaults
  -- (.claude/rules/coding-style.md DRY).
  insert into public.messages (thread_id, body)
  values (v_thread.id, p_raw_text);

  return v_row;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."refresh_shidduch_redt_summary"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_shidduch_id bigint;
  v_last_shadchan bigint;
  v_last_date date;
  v_first_shadchan bigint;
  v_first_date date;
begin
  v_shidduch_id := coalesce(new.shidduchim_id, old.shidduchim_id);

  select r.shadchan_id, r.redt_date into v_last_shadchan, v_last_date
  from public.redts r
  where r.shidduchim_id = v_shidduch_id
  order by r.redt_date desc, r.id desc
  limit 1;

  if not found then
    -- No redts remain (e.g. the last one was deleted); leave the summary as-is.
    return null;
  end if;

  select r.shadchan_id, r.redt_date into v_first_shadchan, v_first_date
  from public.redts r
  where r.shidduchim_id = v_shidduch_id
  order by r.redt_date asc, r.id asc
  limit 1;

  update public.shidduchim s
  set redt_date = v_last_date,
      shadchan_id = v_last_shadchan,
      first_suggested_by = v_first_shadchan,
      first_suggested_at = v_first_date
  where s.id = v_shidduch_id;

  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."regrant_child_grant"("p_grant_id" bigint) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_old_grant public.child_grants;
  v_actor_account_id bigint := public.current_context_id();
  v_token text;
begin
  select * into v_old_grant from public.child_grants where id = p_grant_id;

  if not found
     or v_actor_account_id is null
     or v_actor_account_id <> v_old_grant.proposer_account_id
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'child grant % not found or not authorized to re-grant', p_grant_id;
  end if;

  if v_old_grant.status not in ('severed', 'revoked', 'expired') then
    raise exception 'child grant % cannot be re-granted (status %)', p_grant_id, v_old_grant.status
      using errcode = 'check_violation';
  end if;

  -- Generate new token for the re-grant
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.child_grants (
    proposer_account_id, target_single_id, token_hash, expires_at
  ) values (
    v_old_grant.proposer_account_id, v_old_grant.target_single_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '7 days'
  );

  return v_token;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."rehome_reference_interactions"("p_from_reference_id" bigint, "p_to_reference_id" bigint) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."rehome_reference_link_interactions"("p_from_link_id" bigint, "p_to_link_id" bigint) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."release_ai_parse_attempt"("p_account_id" bigint, "p_attempt_id" bigint, "p_generation" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_period text;
  v_generation bigint;
  v_status text;
begin
  update public.ai_parse_attempts
     set status = 'failed', result = null
   where id = p_attempt_id
     and account_id = p_account_id
     and status = 'in_progress'
     and generation = p_generation
  returning period into v_period;

  if found then
    update public.ai_usage
       set resumes_parsed = greatest(resumes_parsed - 1, 0)
     where account_id = p_account_id
       and period = v_period;
    return jsonb_build_object('outcome', 'applied');
  end if;

  select generation, status
    into v_generation, v_status
  from public.ai_parse_attempts
  where id = p_attempt_id and account_id = p_account_id;

  if not found then
    raise exception 'ai_parse_attempts % is not releasable for account %', p_attempt_id, p_account_id;
  end if;

  if v_generation = p_generation and v_status = 'failed' then
    -- Idempotent retry of THIS SAME generation's own already-applied
    -- release.
    return jsonb_build_object('outcome', 'applied');
  end if;

  return jsonb_build_object('outcome', 'superseded');
end;
$$;

CREATE OR REPLACE FUNCTION "public"."remove_persona"("p_persona" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_membership_id bigint;
  v_account_id bigint;
  v_role text;
  v_single_id bigint;
  v_persona_count int;
  v_holds_single boolean;
  v_other_singles_count int;
  v_other_admins_count int;
  v_archived_account_id bigint;
  v_was_active boolean;
  v_new_active_account_id bigint;
begin
  if v_user_id is null then
    raise exception 'remove_persona requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if p_persona not in ('single', 'parent', 'shadchan') then
    raise exception 'unknown persona: %', p_persona
      using errcode = 'invalid_parameter_value';
  end if;

  -- shadchan: archive the caller's shadchan-role membership outright. No-op
  -- if none is active (mirrors add_persona()'s idempotent-no-op idiom).
  if p_persona = 'shadchan' then
    select id, account_id into v_membership_id, v_account_id
    from public.account_members
    where user_id = v_user_id and status = 'active' and role = 'shadchan'
    order by id
    limit 1;

    if v_membership_id is not null then
      -- Review finding #1: refuse if this is the account's last active
      -- member and it still holds domain data (see guard_persona_removal()).
      perform public.guard_persona_removal(v_membership_id, v_account_id);
      update public.account_members set status = 'archived' where id = v_membership_id;
      v_archived_account_id := v_account_id;
    end if;
  end if;

  -- single: archive the caller's own singles row, but only if it hangs off
  -- an OWNING membership (parent_admin/self_manager — an invited single-role
  -- member's record is managed by the household's parent_admin, never by
  -- this function) and the caller holds at least one other active persona.
  -- No-op if the caller holds no active single persona at all.
  if p_persona = 'single' then
    -- Review finding #3: owning-role candidates (self-managed) must always
    -- be picked over a non-owning invited-single candidate, or a caller who
    -- both self-manages their own single AND is invited as a `single`
    -- elsewhere would be told "ask your household admin" for the record
    -- they DO own, whenever `order by s.id` happened to surface the
    -- non-owning row first. Ordering owning-role first means the
    -- "ask your household admin" branch below is only ever reached when no
    -- owning candidate exists at all.
    select s.id, am.role into v_single_id, v_role
    from public.singles s
    join public.account_members am on am.id = s.member_id
    where am.user_id = v_user_id
      and am.status = 'active'
      and s.status = 'active'
      and (am.role = 'single' or public.is_owning_membership_role(am.role))
    order by public.is_owning_membership_role(am.role) desc, s.id
    limit 1;

    if v_single_id is not null then
      if not public.is_owning_membership_role(v_role) then
        raise exception 'ask your household admin'
          using errcode = 'insufficient_privilege';
      end if;

      -- "at least one other active persona": my_personas() already reports
      -- this exact single persona, so a total count of 1 means it is the
      -- caller's only one.
      select count(*) into v_persona_count from public.my_personas();
      if v_persona_count <= 1 then
        raise exception 'cannot remove your only persona'
          using errcode = 'check_violation';
      end if;

      update public.singles set status = 'archived' where id = v_single_id;
    end if;
  end if;

  -- parent: refuse when the household has other active singles and no other
  -- active parent_admin would remain to manage them; otherwise demote to
  -- self_manager (role only, never account_id — enforce_household_scope()
  -- only fires on account_id changes) if the caller still holds the single
  -- persona in this same household, else archive the membership outright.
  if p_persona = 'parent' then
    select id, account_id into v_membership_id, v_account_id
    from public.account_members
    where user_id = v_user_id and status = 'active' and role = 'parent_admin'
    order by id
    limit 1;

    if v_membership_id is not null then
      select exists (
        select 1 from public.singles
        where member_id = v_membership_id and status = 'active'
      ) into v_holds_single;

      select count(*) into v_other_singles_count
      from public.singles
      where account_id = v_account_id
        and status = 'active'
        and member_id is distinct from v_membership_id;

      select count(*) into v_other_admins_count
      from public.account_members
      where account_id = v_account_id
        and status = 'active'
        and role = 'parent_admin'
        and id <> v_membership_id;

      if v_other_singles_count > 0 and v_other_admins_count = 0 then
        raise exception 'cannot remove parent — no other admin manages this household''s other singles'
          using errcode = 'check_violation';
      end if;

      if v_holds_single then
        update public.account_members set role = 'self_manager' where id = v_membership_id;
      else
        -- Review finding #1: refuse if this is the account's last active
        -- member and it still holds domain data (see guard_persona_removal()).
        -- Covers the case the dependents check above cannot: a household
        -- with only paused singles, or only references/shadchanim/tasks and
        -- no singles at all, still gets orphaned by an outright archive.
        perform public.guard_persona_removal(v_membership_id, v_account_id);
        update public.account_members set status = 'archived' where id = v_membership_id;
        v_archived_account_id := v_account_id;
      end if;
    end if;
  end if;

  -- AC-7: if a membership was just archived above and it was the caller's
  -- active context, re-activate any other remaining active membership, or
  -- clear to NULL if none remain (the fail-closed representation AD-19
  -- specifies). Always activate_context_for() — 2.1's single private
  -- writer — never a second writer of member_state, and never
  -- set_active_context() (it raises rather than writing NULL and would
  -- re-validate a membership this function has just proven).
  if v_archived_account_id is not null then
    select (ms.active_account_id = v_archived_account_id) into v_was_active
    from public.member_state ms
    where ms.user_id = v_user_id;

    if coalesce(v_was_active, false) then
      select am.account_id into v_new_active_account_id
      from public.account_members am
      where am.user_id = v_user_id and am.status = 'active'
      order by am.id
      limit 1;

      perform public.activate_context_for(v_user_id, v_new_active_account_id);
    end if;
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."remove_persona_admin"("p_target_account_member_id" bigint, "p_target_type" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_account_id bigint;
  v_caller_role text;
  v_caller_membership_id bigint;
  v_target_membership public.account_members;
  v_target_single_id bigint;
  v_target_single_member_id bigint;
  v_holds_single boolean;
  v_other_singles_count int;
  v_other_admins_count int;
  v_archived_account_id bigint;
  v_was_active boolean;
  v_new_active_account_id bigint;
begin
  if v_user_id is null then
    raise exception 'remove_persona_admin requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if p_target_type not in ('member', 'single') then
    raise exception 'unknown target_type: %', p_target_type
      using errcode = 'invalid_parameter_value';
  end if;

  v_account_id := public.current_context_id();
  if v_account_id is null then
    raise exception 'no active context'
      using errcode = 'insufficient_privilege';
  end if;

  -- Caller must be parent_admin in this account
  select am.id, am.role into v_caller_membership_id, v_caller_role
  from public.account_members am
  where am.account_id = v_account_id
    and am.user_id = v_user_id
    and am.status = 'active'
  order by am.id
  limit 1;

  if v_caller_membership_id is null or v_caller_role <> 'parent_admin' then
    raise exception 'only a parent_admin may remove another person'
      using errcode = 'insufficient_privilege';
  end if;

  -- Target must be in the same account
  select * into v_target_membership
  from public.account_members
  where id = p_target_account_member_id
    and account_id = v_account_id;

  if not found then
    raise exception 'target membership % not found in this household', p_target_account_member_id
      using errcode = 'check_violation';
  end if;

  -- Cannot remove yourself via this path (use remove_persona() instead)
  if v_target_membership.user_id = v_user_id then
    raise exception 'use remove_persona() to remove your own persona'
      using errcode = 'check_violation';
  end if;

  -- member branch: archive the target's account_members row
  if p_target_type = 'member' then
    if v_target_membership.status = 'active' then
      -- Refuse if this would orphan the account (reuse guard_persona_removal)
      perform public.guard_persona_removal(v_target_membership.id, v_account_id);
      update public.account_members set status = 'archived' where id = v_target_membership.id;
      v_archived_account_id := v_account_id;
    end if;
  end if;

  -- single branch: archive the target's singles row (if they have one linked to this membership)
  if p_target_type = 'single' then
    select s.id, s.member_id into v_target_single_id, v_target_single_member_id
    from public.singles s
    where s.member_id = v_target_membership.id
      and s.account_id = v_account_id
      and s.status = 'active'
    order by s.id
    limit 1;

    if v_target_single_id is not null then
      -- If the target membership holds a single, check the parent guard
      -- (cannot remove parent_admin if other active singles exist and no other admin)
      select exists (
        select 1 from public.singles
        where member_id = v_target_membership.id and status = 'active'
      ) into v_holds_single;

      select count(*) into v_other_singles_count
      from public.singles
      where account_id = v_account_id
        and status = 'active'
        and member_id is distinct from v_target_membership.id;

      select count(*) into v_other_admins_count
      from public.account_members
      where account_id = v_account_id
        and status = 'active'
        and role = 'parent_admin'
        and id <> v_caller_membership_id;

      if v_other_singles_count > 0 and v_other_admins_count = 0 then
        raise exception 'cannot remove single — no other admin manages this household''s other singles'
          using errcode = 'check_violation';
      end if;

      update public.singles set status = 'archived' where id = v_target_single_id;
    end if;
  end if;

  -- AC-7: if a membership was just archived and it was the target's active
  -- context, we do NOT switch the target's context here — the target's own
  -- member_state is theirs to manage. We only handle the CALLER's context
  -- handoff if the caller archived their own membership (which this function
  -- prevents above). The target's context will naturally fail closed on their
  -- next request (current_context_id() requires status='active').
end;
$$;

CREATE OR REPLACE FUNCTION "public"."restore_persona_admin"("p_target_account_member_id" bigint, "p_target_type" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_account_id bigint;
  v_caller_role text;
  v_caller_membership_id bigint;
  v_target_membership public.account_members;
  v_target_single_id bigint;
begin
  if v_user_id is null then
    raise exception 'restore_persona_admin requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if p_target_type not in ('member', 'single') then
    raise exception 'unknown target_type: %', p_target_type
      using errcode = 'invalid_parameter_value';
  end if;

  v_account_id := public.current_context_id();
  if v_account_id is null then
    raise exception 'no active context'
      using errcode = 'insufficient_privilege';
  end if;

  -- Caller must be parent_admin in this account
  select am.id, am.role into v_caller_membership_id, v_caller_role
  from public.account_members am
  where am.account_id = v_account_id
    and am.user_id = v_user_id
    and am.status = 'active'
  order by am.id
  limit 1;

  if v_caller_membership_id is null or v_caller_role <> 'parent_admin' then
    raise exception 'only a parent_admin may restore a person'
      using errcode = 'insufficient_privilege';
  end if;

  -- Target must be in the same account
  select * into v_target_membership
  from public.account_members
  where id = p_target_account_member_id
    and account_id = v_account_id;

  if not found then
    raise exception 'target membership % not found in this household', p_target_account_member_id
      using errcode = 'check_violation';
  end if;

  -- member branch: restore the target's account_members row
  if p_target_type = 'member' then
    if v_target_membership.status = 'archived' then
      update public.account_members set status = 'active' where id = v_target_membership.id;
      -- Also restore any singles row linked to this membership
      update public.singles
      set status = 'active'
      where member_id = v_target_membership.id
        and account_id = v_account_id
        and status = 'archived';
    end if;
  end if;

  -- single branch: restore the target's singles row
  if p_target_type = 'single' then
    select s.id into v_target_single_id
    from public.singles s
    where s.member_id = v_target_membership.id
      and s.account_id = v_account_id
      and s.status = 'archived'
    order by s.id
    limit 1;

    if v_target_single_id is not null then
      update public.singles set status = 'active' where id = v_target_single_id;
    end if;
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."revoke_child_grant"("p_grant_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_grant public.child_grants;
  v_actor_account_id bigint := public.current_context_id();
begin
  select * into v_grant from public.child_grants where id = p_grant_id;

  if not found
     or v_actor_account_id is null
     or v_actor_account_id <> v_grant.proposer_account_id
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'child grant % not found', p_grant_id;
  end if;

  if v_grant.status <> 'pending' then
    raise exception 'child grant % is not pending (status %)', p_grant_id, v_grant.status
      using errcode = 'check_violation';
  end if;

  update public.child_grants
  set status = 'revoked', revoked_at = now()
  where id = p_grant_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."revoke_connection_invite"("p_invite_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_invite public.connection_invites;
  v_actor_account_id bigint := public.current_context_id();
begin
  select * into v_invite from public.connection_invites where id = p_invite_id;

  if not found
     or v_actor_account_id is null
     or v_actor_account_id <> v_invite.inviter_account_id
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id and am.user_id = auth.uid() and am.status = 'active'
  ) then
    raise exception 'connection invite % not found', p_invite_id;
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'connection invite % is not pending (status %)', p_invite_id, v_invite.status
      using errcode = 'check_violation';
  end if;

  update public.connection_invites
  set status = 'revoked', revoked_at = now()
  where id = p_invite_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."revoke_invite"("p_invite_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."role_authority"("p_role" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case p_role
    when 'parent_admin' then 3
    when 'self_manager' then 2
    when 'helper' then 1
    when 'single' then 1
    when 'shadchan' then 1
    else 0
  end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_account_id_default"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.account_id is null then
    new.account_id := public.current_context_id();
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_account_inbound_email_token_default"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.kind = 'household' then
    new.inbound_email_token := encode(extensions.gen_random_bytes(6), 'hex');
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_active_context"("p_account_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."set_entity_files_uploaded_by"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.uploaded_by_member_id := public.current_member_id();
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_interaction_actor_member_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.actor_member_id := public.current_member_id();
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_member_id_default"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.member_id IS NULL THEN
    SELECT id INTO NEW.member_id FROM members WHERE user_id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."set_message_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_connection_id bigint;
begin
  if new.account_id is null and new.connection_id is null then
    select t.account_id, t.connection_id into v_account_id, v_connection_id
    from public.threads t where t.id = new.thread_id;
    new.account_id := v_account_id;
    new.connection_id := v_connection_id;
  end if;
  new.sender_member_id := public.current_member_id();
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_reference_norms"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.name_norm_en := public.normalize_identity_text(new.name_en);
  new.name_norm_he := public.normalize_identity_text(new.name_he);
  new.phone_norm := public.normalize_phone(new.phone);
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_share_link_token_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.account_id is null then
    new.account_id := public.current_context_id();
  end if;
  new.token := encode(extensions.gen_random_bytes(24), 'hex');
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_thread_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.account_id is null and new.connection_id is null then
    new.account_id := public.current_context_id();
  end if;
  new.created_by_member_id := public.current_member_id();
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_thread_participant_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_connection_id bigint;
begin
  if new.account_id is null and new.connection_id is null then
    select t.account_id, t.connection_id into v_account_id, v_connection_id
    from public.threads t where t.id = new.thread_id;
    new.account_id := v_account_id;
    new.connection_id := v_connection_id;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_thread_visibility"("p_thread_id" bigint, "p_visibility" "text") RETURNS "public"."threads"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_thread public.threads;
begin
  if p_visibility not in ('open', 'private') then
    raise exception 'invalid thread visibility: %', p_visibility
      using errcode = 'invalid_parameter_value';
  end if;

  if not public.thread_is_readable(p_thread_id) then
    raise exception 'thread % not found or not readable in current context', p_thread_id
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.thread_participants tp
    where tp.thread_id = p_thread_id
      and tp.member_id = public.current_member_id()
  ) then
    raise exception 'only a listed participant of this thread may change its visibility'
      using errcode = 'insufficient_privilege';
  end if;

  update public.threads
  set visibility = p_visibility
  where id = p_thread_id
  returning * into v_thread;

  return v_thread;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."settle_message_notification"("p_id" bigint, "p_status" "text", "p_error" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'invalid message_notification status: %', p_status
      using errcode = 'invalid_parameter_value';
  end if;

  update public.message_notifications
  set status = p_status,
      error = p_error,
      sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_id
    and status = 'sending';
end;
$$;

CREATE OR REPLACE FUNCTION "public"."settle_task_notification"("p_id" bigint, "p_status" "text", "p_error" "text" DEFAULT NULL::"text", "p_next_attempt_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_claimed_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if p_status not in ('sent', 'failed', 'pending') then
    raise exception 'invalid task_notification status: %', p_status
      using errcode = 'invalid_parameter_value';
  end if;

  update public.task_notifications
  set status = p_status,
      error = p_error,
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      next_attempt_at = case when p_status = 'pending' then p_next_attempt_at else null end,
      claimed_at = case when p_status = 'pending' then null else claimed_at end
  where id = p_id
    and status = 'sending'
    and (p_claimed_at is null or claimed_at = p_claimed_at);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."sever_child_grant"("p_grant_id" bigint) RETURNS "public"."child_grants"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_grant public.child_grants;
  v_actor_account_id bigint := public.current_context_id();
  v_member_role text;
begin
  select * into v_grant from public.child_grants where id = p_grant_id;

  if not found
     or v_actor_account_id is null
     or v_actor_account_id not in (v_grant.proposer_account_id, v_grant.grantee_account_id)
     or not exists (
    select 1 from public.account_members am
    where am.account_id = v_actor_account_id
      and am.user_id = auth.uid()
      and am.status = 'active'
      and am.role in ('parent_admin', 'self_manager')
  ) then
    raise exception 'child grant % not found', p_grant_id;
  end if;

  if v_grant.status <> 'accepted' then
    raise exception 'child grant % is not accepted (status %)', p_grant_id, v_grant.status
      using errcode = 'check_violation';
  end if;

  update public.child_grants
  set status = 'severed', severed_at = now(), severed_by_account_id = v_actor_account_id
  where id = p_grant_id
  returning * into v_grant;

  return v_grant;
end;
$$;

-- Read a shidduch's close_reason, tenant-scoped and hidden from the `single`
-- role. Called by 03_views.sql; declared here because `db diff` seeds this
-- file before the views and fails to provision its shadow database otherwise.
CREATE OR REPLACE FUNCTION "public"."shidduch_close_reason"("p_shidduchim_id" bigint) RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select s.close_reason
  from public.shidduchim s
  where s.id = p_shidduchim_id
    and s.account_id = public.current_context_id()
    and public.current_member_role() <> 'single';
$$;

-- FR63 — aggregate counts only, never used to filter, rank, score or match.
CREATE OR REPLACE FUNCTION "public"."shidduch_diligence_progress"("p_shidduchim_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_total bigint;
  v_contacted bigint;
begin
  select count(*) into v_total
  from public.reference_links
  where account_id = public.current_context_id()
    and shidduchim_id = p_shidduchim_id;

  select count(*) into v_contacted
  from public.reference_links
  where account_id = public.current_context_id()
    and shidduchim_id = p_shidduchim_id
    and call_status = 'answered';

  return jsonb_build_object(
    'contacted', v_contacted,
    'total', v_total,
    'outstanding', v_total - v_contacted
  );
end;
$$;

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
    s.mother_he
  from public.shidduchim s
  where s.id = p_shidduchim_id;
$$;

CREATE OR REPLACE FUNCTION "public"."sweep_expired_ai_parse_attempts"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_deleted integer;
begin
  delete from public.ai_parse_attempts
   where created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."sync_reference_identity_signals"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.identity_signals (
    account_id, target_type, target_id,
    name_en_norm, name_he_norm, name_en_key, name_he_key,
    phone_norm, seminary_norm
  ) values (
    new.account_id, 'reference', new.id,
    public.normalize_identity_text(new.name_en),
    public.normalize_identity_text(new.name_he),
    public.identity_name_key(new.name_en),
    public.identity_name_key(new.name_he),
    public.normalize_phone(new.phone),
    public.normalize_identity_text(new.school)
  )
  on conflict (account_id, target_type, target_id) do update
  set name_en_norm = excluded.name_en_norm,
      name_he_norm = excluded.name_he_norm,
      name_en_key = excluded.name_en_key,
      name_he_key = excluded.name_he_key,
      phone_norm = excluded.phone_norm,
      seminary_norm = excluded.seminary_norm;

  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."sync_shidduch_identity_signals"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."sync_task_target"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.target_id is null then
    raise exception 'a task needs a target: set target_type + target_id'
      using errcode = 'not_null_violation';
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."thread_is_readable"("p_thread_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_thread public.threads;
begin
  select * into v_thread from public.threads where id = p_thread_id;
  if not found then
    return false;
  end if;

  if v_thread.account_id is not null then
    -- `is distinct from`, not `<>`: a NULL current_context_id() (no active
    -- context) must deny, not silently fall through to `true` the way a
    -- NULL-yielding `<>` comparison would inside an `if`.
    if v_thread.account_id is distinct from public.current_context_id() then
      return false;
    end if;
  else
    -- Story 7.4 (AC-4, AC-9): the connection axis. Requires the caller's
    -- active context to be a member of THIS connection, with
    -- `status = 'accepted'` — ending a connection ends every read on its
    -- threads, even for participants unchanged since before the end
    -- (Dev Notes, "Why the ended case is called out separately").
    if not public.connection_is_active_for_caller(v_thread.connection_id) then
      return false;
    end if;
  end if;

  return public.thread_visibility_permits(p_thread_id);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."thread_visibility_permits"("p_thread_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_thread public.threads;
begin
  select * into v_thread from public.threads where id = p_thread_id;
  if not found then
    return false;
  end if;

  -- Story 7.3 (AC-2, AC-3, AC-6): private beats scope AND beats the
  -- dignity-floor branch below — this IS the whole answer for a private
  -- thread, nothing else narrows or widens it.
  if v_thread.visibility = 'private' then
    return exists (
      select 1
      from public.thread_participants tp
      where tp.thread_id = p_thread_id
        and tp.member_id = public.current_member_id()
    );
  end if;

  if v_thread.subject_type = 'shidduch' and public.current_member_role() = 'single' then
    return exists (
      select 1
      from public.shidduchim s
      where s.id = v_thread.subject_id
        and s.visibility = 'shared'
        and public.is_single_visible_state(s.pipeline_state)
        and exists (
          select 1 from public.singles c
          where c.id = s.single_id and c.member_id = public.current_member_id()
        )
    );
  end if;

  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."transition_shidduch"("p_id" bigint, "p_from" "public"."pipeline_state", "p_to" "public"."pipeline_state", "p_close_reason" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."shidduchim"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."trial_to_paid_conversion"() RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_trial_started bigint;
  v_active_subscriptions bigint;
begin
  select count(*) into v_trial_started
  from public.accounts
  where trial_end is not null;

  if v_trial_started = 0 then
    return 0;
  end if;

  select count(*) into v_active_subscriptions
  from public.accounts
  where subscription_status = 'active'
    and plan is not null;

  return round((v_active_subscriptions::numeric / v_trial_started::numeric) * 100, 2);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."validate_task_assignee"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.member_id is null then
    return new;
  end if;

  if not public.is_deliverable_member(new.member_id, new.account_id) then
    raise exception 'member % is not an active, enabled member of account %',
      new.member_id, new.account_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."verify_purge_request"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_row public.purge_requests;
begin
  select * into v_row
  from public.purge_requests
  where verification_token = p_token
  for update;

  if not found then
    return jsonb_build_object('verified', false);
  end if;

  if v_row.expires_at <= now() then
    return jsonb_build_object('verified', false);
  end if;

  if v_row.status <> 'pending' or v_row.verified_at is not null then
    return jsonb_build_object('verified', false);
  end if;

  update public.purge_requests
  set status = 'verified', verified_at = now()
  where id = v_row.id;

  return jsonb_build_object('verified', true);
end;
$$;
