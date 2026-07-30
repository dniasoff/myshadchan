-- Story 6.1: invites.target_single_id (a single joins the household) —
-- links a single-role invite to the singles row it will bind at acceptance,
-- extends create_invite()/accept_invite() to validate/write that link, and
-- drops the now-superseded 2-argument create_invite() overload (two
-- overloads would make PostgREST RPC resolution ambiguous).
--
-- MANUAL ADJUSTMENTS (see AGENTS.md; resume_photos precedent, migration
-- 20260730041150):
-- 1. `db diff` does not re-emit function grants for a brand-new overload
--    (same class of gap as security_invoker/GRANT lines on views). The
--    revoke-then-grant block after create_invite()'s new definition below
--    is copied verbatim from 06_grants.sql's create_invite(text, text,
--    bigint) entry so the applied database matches the declared schema
--    exactly. The old 2-argument overload's own grants need no matching
--    REVOKE here: dropping the function drops its ACL with it.

drop function if exists "public"."create_invite"(p_email text, p_role text);

alter table "public"."invites" add column "target_single_id" bigint;

alter table "public"."invites" add constraint "invites_role_target_check" CHECK (((role = 'single'::text) = (target_single_id IS NOT NULL))) not valid;

alter table "public"."invites" validate constraint "invites_role_target_check";

alter table "public"."invites" add constraint "invites_target_single_id_fkey" FOREIGN KEY (account_id, target_single_id) REFERENCES public.singles(account_id, id) ON DELETE CASCADE not valid;

alter table "public"."invites" validate constraint "invites_target_single_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_invite(p_email text, p_role text, p_target_single_id bigint DEFAULT NULL::bigint)
 RETURNS public.invites
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

revoke all on function public.create_invite(text, text, bigint) from public, anon;

grant execute on function public.create_invite(text, text, bigint) to authenticated;

grant execute on function public.create_invite(text, text, bigint) to service_role;

CREATE OR REPLACE FUNCTION public.accept_invite(p_token uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
