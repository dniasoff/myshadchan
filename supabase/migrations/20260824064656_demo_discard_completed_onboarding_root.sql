-- Stop the released demo root from accumulating.
--
-- `clear_demo` deliberately RETAINS the root household and archives its
-- bootstrap membership. `prepare_demo_onboarding` then sees a caller with no
-- live membership, treats it as a first run, and nulls the intent's
-- account_id -- so `add_persona` builds a NEW root and the previous one is
-- left behind forever, unreachable, because `my_contexts()` requires an
-- ACTIVE membership. Every demo -> clear -> demo cycle stranded one more
-- empty household.
--
-- Forward-only, and deliberately NOT a change to clear_demo's retain-and-
-- archive semantics: the husk is discarded at the moment the retry starts,
-- which is the only point at which it is provably finished with and still
-- named by the intent. The proofs live in the function because the account is
-- `demo = false` by then and the demo write-barrier triggers no longer cover
-- it. Fail-open throughout: cleanup must never block a retry.

CREATE OR REPLACE FUNCTION "public"."discard_completed_demo_onboarding_root"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_intent public.demo_onboarding_intents;
  v_account_id bigint;
begin
  -- A release clear RETAINS the root household and archives its bootstrap
  -- membership (clear_demo / release_persona, "Restore only a live
  -- membership"). prepare_demo_onboarding then treats a caller with no live
  -- membership as a first run again and nulls the intent's account_id, so
  -- add_persona builds a NEW root -- and the previous one survives forever as
  -- a household nobody can reach: my_contexts() requires an ACTIVE membership.
  -- Every demo -> clear -> demo cycle stranded one more. This deletes that
  -- husk at the moment the retry starts, which is the only point where it is
  -- provably finished with.
  --
  -- The account is `demo = false` by then (the release flipped it), so the
  -- demo write-barrier triggers do NOT protect it and this function's own
  -- proofs are the whole fence. It therefore refuses unless the account is the
  -- one THIS caller's own onboarding intent recorded, carries no run of any
  -- status, has no membership that is either live or somebody else's, is
  -- nobody's active context, is claimed by no other intent, and passes
  -- demo_assert_empty_account -- which also covers the cross-account
  -- connection/invite/grant edges and storage. Anything short of all of that
  -- returns false and the husk is left alone; cleanup must never be the reason
  -- a customer cannot retry.
  if v_user_id is null then
    raise exception 'discard_completed_demo_onboarding_root requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_intent
  from public.demo_onboarding_intents
  where user_id = v_user_id and state = 'completed'
  for update;
  if not found or v_intent.account_id is null then
    return false;
  end if;
  v_account_id := v_intent.account_id;

  -- Only ever at a genuine retry: a caller still holding a live membership is
  -- an established customer, not somebody restarting onboarding.
  if exists (
    select 1 from public.account_members
    where user_id = v_user_id and status = 'active'
  ) then
    return false;
  end if;

  if not exists (
    select 1 from public.accounts
    where id = v_account_id and kind = 'household'
  ) then
    return false;
  end if;

  -- Any run at all, in any status, means this is not a finished husk.
  if exists (
    select 1 from public.demo_runs where root_account_id = v_account_id
  ) then
    return false;
  end if;

  -- Every surviving membership must be this caller's own archived one. A live
  -- membership, or any membership belonging to somebody else (or orphaned to
  -- NULL by an Auth deletion), disqualifies the account.
  if exists (
    select 1 from public.account_members
    where account_id = v_account_id
      and (status <> 'archived' or user_id is distinct from v_user_id)
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.member_state where active_account_id = v_account_id
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.demo_onboarding_intents
    where account_id = v_account_id and user_id <> v_user_id
  ) then
    return false;
  end if;

  -- These all cascade from `accounts` but are NOT covered by
  -- demo_assert_empty_account, so a husk holding any of them would lose real
  -- rows silently. `subscription` matters most -- it is the
  -- server-authoritative AI entitlement record, never a decoy -- and
  -- demo_run_accounts would mean this account is a COMPANION in some other
  -- root's run, which the root_account_id check above cannot see.
  if exists (select 1 from public.subscription where account_id = v_account_id)
     or exists (select 1 from public.ai_usage where account_id = v_account_id)
     or exists (select 1 from public.ai_parse_attempts where account_id = v_account_id)
     or exists (select 1 from public.account_deletion_requests where account_id = v_account_id)
     or exists (select 1 from public.demo_run_accounts where account_id = v_account_id)
     or exists (select 1 from public.demo_run_ingest_claims where account_id = v_account_id)
     or exists (
       select 1 from public.demo_clear_receipts
       where root_account_id = v_account_id and user_id <> v_user_id
     ) then
    return false;
  end if;

  perform public.demo_assert_empty_account(v_account_id);

  -- demo_onboarding_intents.account_id cascades from accounts, so deleting the
  -- husk would delete the caller's intent row along with it -- taking the retry
  -- state and its attempts counter, and leaving prepare_demo_onboarding's own
  -- `update ... returning` with no row to return. Release the reference first.
  update public.demo_onboarding_intents
  set account_id = null, updated_at = now()
  where user_id = v_user_id and account_id = v_account_id;

  delete from public.demo_clear_receipts
  where user_id = v_user_id and root_account_id = v_account_id;
  delete from public.account_members where account_id = v_account_id;
  delete from public.accounts where id = v_account_id;
  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."prepare_demo_onboarding"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_intent public.demo_onboarding_intents;
begin
  if v_user_id is null then
    raise exception 'prepare_demo_onboarding requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- A release completion receipt is a one-shot retry proof, not a new
  -- onboarding identity. Starting onboarding again retires it atomically.
  delete from public.demo_clear_receipts where user_id = v_user_id;

  select * into v_intent
  from public.demo_onboarding_intents
  where user_id = v_user_id
  for update;
  if found then
    if v_intent.state in ('pending', 'failed') and v_intent.account_id is not null then
      -- Never clear an active/successful run here.  This proof-bound helper
      -- only releases an empty orphan whose ownership is already recorded by
      -- this exact onboarding intent.
      perform public.release_demo_orphan_for_onboarding();
      select * into v_intent
      from public.demo_onboarding_intents
      where user_id = v_user_id;
    end if;
    if v_intent.state = 'completed' and not exists (
      select 1 from public.account_members
      where user_id = v_user_id and status = 'active'
    ) then
      -- Nulling account_id below makes add_persona build a NEW root, so the
      -- retained one is about to become unreachable. Discard it here, while
      -- the intent still names it and its emptiness can still be proven.
      -- Fail-open: a husk left behind is untidy, a blocked retry is a broken
      -- product.
      begin
        perform public.discard_completed_demo_onboarding_root();
      exception when others then
        null;
      end;
      update public.demo_onboarding_intents
      set state = 'pending', account_id = null, demo_run_id = null,
          last_error = null, attempts = attempts + 1, updated_at = now()
      where user_id = v_user_id
      returning * into v_intent;
    end if;
    return jsonb_build_object(
      'state', v_intent.state,
      'account_id', v_intent.account_id,
      'attempts', v_intent.attempts
    );
  end if;

  -- A caller with any live context/persona is an established customer unless
  -- this exact durable intent already exists. Never manufacture a seed intent
  -- for an established account merely because its tables happen to be empty.
  if exists (
    select 1 from public.account_members
    where user_id = v_user_id and status = 'active'
  ) or exists (
    select 1
    from public.singles s
    join public.account_members am on am.id = s.member_id
    where am.user_id = v_user_id and am.status = 'active' and s.status = 'active'
  ) then
    raise exception 'demo onboarding is only available to a first-run login'
      using errcode = 'check_violation';
  end if;

  insert into public.demo_onboarding_intents (user_id, state, attempts)
  values (v_user_id, 'pending', 1)
  returning * into v_intent;

  return jsonb_build_object(
    'state', v_intent.state,
    'account_id', v_intent.account_id,
    'attempts', v_intent.attempts
  );
end;
$$;

revoke all on function public.discard_completed_demo_onboarding_root() from public, anon, authenticated;
grant execute on function public.discard_completed_demo_onboarding_root() to service_role;
