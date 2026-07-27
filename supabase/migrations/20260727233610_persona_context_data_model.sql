drop policy "Enable read access for authenticated users" on "public"."members";

alter table "public"."account_members" drop constraint "account_members_role_check";

alter table "public"."accounts" add column "kind" text not null default 'household'::text;

alter table "public"."accounts" add constraint "accounts_kind_check" CHECK ((kind = ANY (ARRAY['household'::text, 'shadchanus'::text]))) not valid;

alter table "public"."accounts" validate constraint "accounts_kind_check";

alter table "public"."account_members" add constraint "account_members_role_check" CHECK ((role = ANY (ARRAY['parent_admin'::text, 'single'::text, 'helper'::text, 'self_manager'::text, 'shadchan'::text]))) not valid;

alter table "public"."account_members" validate constraint "account_members_role_check";

-- AC-4: db diff does not emit COMMENT ON statements (same class of gap as
-- security_invoker/GRANT lines around a regenerated function) — added by
-- hand, verified present in the schema file at 01_tables.sql.
comment on table "public"."subscription" is 'Deliberately excluded from enforce_household_scope() (Story 2.2 AC-4): no source restricts a shadchanus context from holding billing/entitlement rows; scoped generically by current_context_id() until a story states a rule.';
comment on table "public"."ai_usage" is 'Deliberately excluded from enforce_household_scope() (Story 2.2 AC-4): same open question as public.subscription — no source restricts entitlement usage-metering to household contexts.';

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.add_persona(p_persona text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_first_name text;
  v_account_id bigint;
  v_membership_id bigint;
begin
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
    insert into public.accounts (name, kind)
    values (coalesce(v_first_name || '''s Family', 'My Account'), 'household')
    returning id into v_account_id;

    insert into public.account_members (account_id, user_id, role, status)
    values (v_account_id, v_user_id, 'parent_admin', 'active');

    return;
  end if;

  if p_persona = 'single' then
    -- No-op: a singles row already points at one of the caller's own active
    -- memberships (the invited single, or re-ticking a box already held).
    -- This predicate must match my_personas()'s single-detection exactly.
    if exists (
      select 1
      from public.singles s
      join public.account_members am on am.id = s.member_id
      where am.user_id = v_user_id
        and am.status = 'active'
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
      values (coalesce(v_first_name || '''s Family', 'My Account'), 'household')
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
$function$
;

revoke all on function public.add_persona(text) from public, anon;
grant execute on function public.add_persona(text) to authenticated;
grant execute on function public.add_persona(text) to service_role;

CREATE OR REPLACE FUNCTION public.enforce_household_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

revoke all on function public.enforce_household_scope() from public, anon;
grant execute on function public.enforce_household_scope() to authenticated;
grant execute on function public.enforce_household_scope() to service_role;

CREATE OR REPLACE FUNCTION public.enforce_membership_role_matches_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

revoke all on function public.enforce_membership_role_matches_context() from public, anon;
grant execute on function public.enforce_membership_role_matches_context() to authenticated;
grant execute on function public.enforce_membership_role_matches_context() to service_role;

CREATE OR REPLACE FUNCTION public.is_owning_membership_role(p_role text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_role in ('parent_admin', 'self_manager');
$function$
;

revoke all on function public.is_owning_membership_role(text) from public, anon;
grant execute on function public.is_owning_membership_role(text) to authenticated;
grant execute on function public.is_owning_membership_role(text) to service_role;

CREATE OR REPLACE FUNCTION public.my_personas()
 RETURNS TABLE(persona text, account_id bigint, account_kind text, role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  select 'single'::text, am.account_id, a.kind, am.role
  from public.singles s
  join public.account_members am on am.id = s.member_id
  join public.accounts a on a.id = am.account_id
  where am.user_id = auth.uid()
    and am.status = 'active'
    and (am.role = 'single' or public.is_owning_membership_role(am.role));
$function$
;

revoke all on function public.my_personas() from public, anon;
grant execute on function public.my_personas() to authenticated;
grant execute on function public.my_personas() to service_role;


  create policy "Members readable by self or within active account"
  on "public"."members"
  as permissive
  for select
  to authenticated
using (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.account_members am
  WHERE ((am.account_id = public.current_context_id()) AND (am.status = 'active'::text) AND (am.user_id = members.user_id))))));


CREATE TRIGGER enforce_membership_role_matches_context_trigger BEFORE INSERT OR UPDATE ON public.account_members FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_role_matches_context();

CREATE TRIGGER validate_date_records_household_scope BEFORE INSERT OR UPDATE OF account_id ON public.date_records FOR EACH ROW EXECUTE FUNCTION public.enforce_household_scope();

CREATE TRIGGER validate_identity_signals_household_scope BEFORE INSERT OR UPDATE OF account_id ON public.identity_signals FOR EACH ROW EXECUTE FUNCTION public.enforce_household_scope();

CREATE TRIGGER validate_inbox_items_household_scope BEFORE INSERT OR UPDATE OF account_id ON public.inbox_items FOR EACH ROW EXECUTE FUNCTION public.enforce_household_scope();

CREATE TRIGGER validate_interactions_household_scope BEFORE INSERT OR UPDATE OF account_id ON public.interactions FOR EACH ROW EXECUTE FUNCTION public.enforce_household_scope();

CREATE TRIGGER validate_redts_household_scope BEFORE INSERT OR UPDATE OF account_id ON public.redts FOR EACH ROW EXECUTE FUNCTION public.enforce_household_scope();

CREATE TRIGGER validate_reference_links_household_scope BEFORE INSERT OR UPDATE OF account_id ON public.reference_links FOR EACH ROW EXECUTE FUNCTION public.enforce_household_scope();

CREATE TRIGGER validate_references_household_scope BEFORE INSERT OR UPDATE OF account_id ON public."references" FOR EACH ROW EXECUTE FUNCTION public.enforce_household_scope();

CREATE TRIGGER validate_resumes_household_scope BEFORE INSERT OR UPDATE OF account_id ON public.resumes FOR EACH ROW EXECUTE FUNCTION public.enforce_household_scope();

CREATE TRIGGER validate_shadchanim_household_scope BEFORE INSERT OR UPDATE OF account_id ON public.shadchanim FOR EACH ROW EXECUTE FUNCTION public.enforce_household_scope();

CREATE TRIGGER validate_shidduch_schools_household_scope BEFORE INSERT OR UPDATE OF account_id ON public.shidduch_schools FOR EACH ROW EXECUTE FUNCTION public.enforce_household_scope();

CREATE TRIGGER validate_shidduchim_household_scope BEFORE INSERT OR UPDATE OF account_id ON public.shidduchim FOR EACH ROW EXECUTE FUNCTION public.enforce_household_scope();

CREATE TRIGGER validate_singles_household_scope BEFORE INSERT OR UPDATE OF account_id ON public.singles FOR EACH ROW EXECUTE FUNCTION public.enforce_household_scope();

CREATE TRIGGER validate_tasks_household_scope BEFORE INSERT OR UPDATE OF account_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.enforce_household_scope();


