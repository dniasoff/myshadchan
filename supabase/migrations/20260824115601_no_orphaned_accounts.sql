-- Make an orphaned account impossible, and delete the demo's root when the
-- demo ends.
--
-- An account with no ACTIVE membership is unreachable forever: my_contexts()
-- and current_context_id() both require status = 'active', so nobody -- not
-- even the person who created it -- can ever reach it again. Four code paths
-- created one, and each looked locally correct:
--
--   * finalize_demo_clear()  archived the caller's sole bootstrap membership,
--     flipped `demo = false` and RETAINED the root. Every demo -> clear cycle
--     stranded another empty household, because the next demo built a fresh
--     root. This is the one that mattered: it fired on the normal, successful
--     path, and the hosted acceptance harness was silently sweeping the husks,
--     which is why it never showed up as a failure.
--   * release_demo_orphan_for_onboarding()  did the same on a cancelled
--     onboarding.
--   * remove_persona() / remove_persona_admin()  archived an account's last
--     active membership whenever guard_persona_removal() allowed it -- and
--     that guard asked account_has_domain_data(), which is a strictly weaker
--     question: an account holding only a listing, an invite, a subscription
--     or a private thread passed it and was orphaned with those rows inside.
--
-- The fix has three parts, and needs all three:
--
--   1. account_is_disposable() -- ONE data fence, now shared by the guard and
--      the disposer. Sharing it is what makes the outcome exhaustive: either
--      the guard refuses (the account stays reachable) or the account can be
--      deleted. A separate list per site is what allowed a state that was
--      neither.
--   2. dispose_orphaned_account() -- deletes a memberless, provably empty
--      account, called from all four sites. Where it declines, each caller
--      restores the membership instead, so an account is never left stranded.
--   3. assert_account_not_orphaned() -- DEFERRED constraint triggers that
--      reject the state at COMMIT. This is the part that makes it impossible
--      rather than merely fixed: a future code path that forgets gets a loud
--      abort in development instead of a silent leak in production.
--
-- Also widened get_demo_release_receipt(): a release clear now DELETES the
-- root, so "the account exists and is no longer flagged demo" can no longer
-- be the proof the clear completed. Its absence is a stronger proof; without
-- accepting it, a lost clear response could never be answered from the ledger
-- and the client's retry would report failure for a clear that had succeeded.

CREATE OR REPLACE FUNCTION "public"."account_is_disposable"("p_account_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  -- Whether an account holds nothing that must outlive it. This is the ONE
  -- data fence behind both halves of the no-orphan invariant: guard_persona_
  -- removal() refuses to archive an account's last active membership unless
  -- this returns true, and dispose_orphaned_account() refuses to delete
  -- unless it does. Sharing the predicate is what makes "delete it, or leave
  -- it reachable" total -- two separately-maintained lists would drift and
  -- leave a state that is neither disposable nor removable.
  --
  -- It is deliberately STRICTER than account_has_domain_data() (which this
  -- calls): that one asks "would a person lose work", which is the right
  -- question for a warning and the wrong one for a DELETE. Every table below
  -- either cascades from accounts -- and so would be destroyed silently -- or
  -- is a cross-account edge whose other side would be left dangling.
  --
  -- Coverage is not maintained by hand: official_demo_account_orphan.sql
  -- derives every account-scoped base table from the catalog and fails if one
  -- is not named in this function's source. A table that deliberately does
  -- NOT block is named here in prose instead, with its reason:
  --   * account_members   -- only ARCHIVED rows remain by the time this is
  --                          consulted; dispose_orphaned_account() deletes them.
  --   * member_state      -- `on delete set null`; dispose repoints it first.
  --   * demo_onboarding_intents -- cascades, so dispose NULLs its account_id
  --                          first to keep the caller's retry state alive.
  --   * demo_clear_receipts -- carries no FK by design; the historical
  --                          root_account_id is the whole point of the ledger.
  --   * demo_run_member_state -- run-scoped and `set null`; a live run is
  --                          already blocked by demo_runs/demo_run_accounts.
  select not (
       public.account_has_domain_data(p_account_id)
    -- Billing and AI entitlement. `subscription` is the server-authoritative
    -- record (accounts.plan is a decoy) -- losing it silently is unacceptable.
    or exists (select 1 from public.subscription where account_id = p_account_id)
    or exists (select 1 from public.ai_usage where account_id = p_account_id)
    or exists (select 1 from public.ai_parse_attempts where account_id = p_account_id)
    or exists (select 1 from public.stripe_events where account_id = p_account_id)
    or exists (select 1 from public.analytics_events where account_id = p_account_id)
    or exists (select 1 from public.account_deletion_requests where account_id = p_account_id)
    -- Content and marketplace surfaces account_has_domain_data does not ask about.
    or exists (select 1 from public.listings where account_id = p_account_id)
    or exists (select 1 from public.listing_withdrawal_locks where account_id = p_account_id)
    or exists (select 1 from public.invites where account_id = p_account_id)
    or exists (select 1 from public.entity_files where account_id = p_account_id)
    or exists (select 1 from public.medical_notes where account_id = p_account_id)
    or exists (select 1 from public.resume_photos where account_id = p_account_id)
    or exists (select 1 from public.single_preferences where account_id = p_account_id)
    or exists (select 1 from public.single_notes where account_id = p_account_id)
    or exists (select 1 from public.share_links where account_id = p_account_id)
    or exists (select 1 from public.trusted_senders where account_id = p_account_id)
    -- Discussion. Private parent-to-parent messages are the most sensitive
    -- rows in the product; they must never be a cascade casualty.
    or exists (select 1 from public.messages where account_id = p_account_id)
    or exists (select 1 from public.threads where account_id = p_account_id)
    or exists (select 1 from public.thread_participants where account_id = p_account_id)
    or exists (select 1 from public.message_notifications where account_id = p_account_id)
    or exists (select 1 from public.task_notifications where account_id = p_account_id)
    -- Cross-account edges: deleting this side would strand the other.
    or exists (
      select 1 from public.connections
      where household_account_id = p_account_id or shadchanus_account_id = p_account_id
    )
    or exists (
      select 1 from public.connection_invites
      where inviter_account_id = p_account_id or accepted_by_account_id = p_account_id
    )
    or exists (
      select 1 from public.child_grants
      where proposer_account_id = p_account_id or grantee_account_id = p_account_id
    )
    -- A live demo lifecycle owns this account's cleanup; never race it.
    or exists (select 1 from public.demo_runs where root_account_id = p_account_id)
    or exists (select 1 from public.demo_run_accounts where account_id = p_account_id)
    or exists (select 1 from public.demo_run_ingest_claims where account_id = p_account_id)
    -- Uploaded bytes. Deleting the row would leave the object unreferenced
    -- and unreachable, which is a leak in the other direction.
    or exists (
      select 1 from storage.objects
      where bucket_id in ('documents', 'entity-files', 'attachments')
        and (name = p_account_id::text or name like p_account_id::text || '/%')
    )
  );
$$;

CREATE OR REPLACE FUNCTION "public"."dispose_orphaned_account"("p_account_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_exists boolean;
begin
  -- Deletes an account that no longer has any live member. This is the
  -- "delete it" half of the invariant assert_account_not_orphaned() enforces;
  -- the other half is that a caller which gets `false` back must leave the
  -- account reachable instead. It is never correct to call this and ignore
  -- the result.
  if p_account_id is null then
    return false;
  end if;

  select true into v_exists
  from public.accounts where id = p_account_id
  for update;
  if not found then
    -- Already gone (a concurrent lifecycle finished first). The invariant
    -- holds, so this is success, not failure.
    return true;
  end if;

  if exists (
    select 1 from public.account_members
    where account_id = p_account_id and status = 'active'
  ) then
    return false;
  end if;

  if not public.account_is_disposable(p_account_id) then
    return false;
  end if;

  -- Release the two references that must survive the account rather than
  -- cascade with it. member_state would be SET NULL anyway; the intent would
  -- be DELETED, taking the caller's retry state and attempts counter with it
  -- (measured -- prepare_demo_onboarding then returned state=null).
  update public.member_state
  set active_account_id = null, updated_at = now()
  where active_account_id = p_account_id;

  update public.demo_onboarding_intents
  set account_id = null, updated_at = now()
  where account_id = p_account_id;

  delete from public.account_members where account_id = p_account_id;
  delete from public.accounts where id = p_account_id;
  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."assert_account_not_orphaned"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_account_ids bigint[];
  v_account_id bigint;
  v_account public.accounts;
begin
  -- SECURITY DEFINER because `accounts` and `account_members` are both
  -- FORCE row level security. A guard that reads its subject through the
  -- invoker's RLS can be blinded by it: rows it cannot see look like rows
  -- that do not exist, so a hidden active membership reads as an orphan
  -- (false abort) and a hidden account reads as already-deleted (silent
  -- non-enforcement). Not reachable today -- `authenticated` holds no DML
  -- grant on account_members at all, so every membership write already
  -- arrives inside a SECURITY DEFINER function running as the owner
  -- (measured: a direct UPDATE as `authenticated` returns 42501) -- but the
  -- invariant must not quietly depend on that staying true. This function
  -- returns only NULL or an exception, so it exposes nothing.
  --
  -- The no-orphan invariant, enforced by the database rather than by every
  -- caller remembering to. An account with no active membership is
  -- unreachable forever: my_contexts() and current_context_id() both require
  -- status = 'active', so nobody -- not even the person who created it -- can
  -- ever see it again. Three separate functions used to leave one behind on
  -- every demo -> clear cycle, and the leak was invisible because each looked
  -- locally correct.
  --
  -- DEFERRED to commit on purpose: an account is legitimately memberless for
  -- part of a transaction (add_persona inserts the account, then the
  -- membership). Only the committed state has to satisfy the invariant.
  --
  -- `demo is true` is exempt, and that exemption is what makes this safe to
  -- apply everywhere: a demo graph is half-built during seeding and half-torn-
  -- down during clearing, across MANY transactions, and its own run manifest
  -- owns that cleanup. The flag is released in the same transaction that
  -- finalizes a clear -- which is precisely the transition that used to leak,
  -- so the exemption lifts exactly where the enforcement is needed.
  -- Resolved with branches, not a CASE over `old`/`new`: plpgsql resolves
  -- record field references when it plans the expression, so a single
  -- expression naming `old.account_id` fails with 42703 on the `accounts`
  -- trigger, where OLD is an accounts row. Measured, not theorised.
  if tg_table_name = 'accounts' then
    v_account_ids := array[new.id];
  elsif tg_op = 'DELETE' then
    v_account_ids := array[old.account_id];
  else
    -- An UPDATE that re-points a membership can orphan the account it LEFT,
    -- so both sides are checked even though enforce_household_scope() makes
    -- that move impossible today.
    v_account_ids := array[old.account_id, new.account_id];
  end if;

  foreach v_account_id in array v_account_ids loop
    if v_account_id is not null then
      select * into v_account from public.accounts where id = v_account_id;
      -- Not found: deleted later in the same transaction, which is the
      -- strongest possible form of "not orphaned".
      if found
         and not v_account.demo
         -- ...and no live demo run owns it. A seed builds its companion
         -- contexts across MANY transactions -- create_demo_companion_context()
         -- commits the account, and the synthetic actors' memberships are
         -- inserted afterwards -- so the manifest, not the membership, is what
         -- proves the account is accounted for while a run is in flight. This
         -- is not a loophole: the exemption is claimable only while a
         -- demo_runs row exists, and finalize_demo_clear() DELETES that row in
         -- the same transaction it must leave clean, so the invariant applies
         -- to exactly the commit that used to leak.
         and not exists (
           select 1
           from public.demo_run_accounts dra
           join public.demo_runs dr on dr.id = dra.run_id
           where dra.account_id = v_account_id
             and dr.status in ('seeding', 'active', 'clearing', 'failed')
         )
         and not exists (
        select 1 from public.account_members
        where account_id = v_account_id and status = 'active'
      ) then
        raise exception
          'account % would be orphaned: it has no active membership and would be unreachable forever. Delete it with dispose_orphaned_account(), or leave a membership active.',
          v_account_id
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;
  return null;
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

  -- Was `account_has_domain_data()`, which is a strictly weaker question:
  -- an account holding only a listing, an invite, a subscription or a private
  -- thread passed it, got its last membership archived, and became an
  -- unreachable orphan. account_is_disposable() is the SAME predicate
  -- dispose_orphaned_account() uses, so the two outcomes are exhaustive --
  -- either this refuses (the account stays reachable) or the caller can
  -- delete it. There is no third state, which is what makes the no-orphan
  -- invariant satisfiable rather than merely asserted.
  if not v_has_other_member and not public.account_is_disposable(p_account_id) then
    raise exception 'cannot remove your last active membership of this account'
      using errcode = 'check_violation';
  end if;
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

  if exists (
    select 1
    from public.account_members am
    join public.demo_run_accounts dra on dra.account_id = am.account_id
    join public.demo_runs dr on dr.id = dra.run_id
    where am.user_id = v_user_id
      and am.status = 'active'
      and dr.status in ('seeding', 'active', 'clearing', 'failed')
  ) then
    raise exception 'persona changes are unavailable while the official demo is active'
      using errcode = 'lock_not_available';
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

    -- guard_persona_removal() above has already proven this account is either
    -- still held by someone else or disposable, so an account left with no
    -- active member here is empty by construction and must not survive: it
    -- would be unreachable forever. Deliberately AFTER the context handoff,
    -- so the caller is moved somewhere valid before their old account goes.
    if not exists (
      select 1 from public.account_members
      where account_id = v_archived_account_id and status = 'active'
    ) then
      perform public.dispose_orphaned_account(v_archived_account_id);
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
      -- Same reasoning as remove_persona(): the guard has proven the account
      -- is disposable if this was its last live member, and an account with
      -- none is unreachable forever. dispose_orphaned_account() clears the
      -- target's own member_state pointer on the way out.
      if not exists (
        select 1 from public.account_members
        where account_id = v_account_id and status = 'active'
      ) then
        perform public.dispose_orphaned_account(v_account_id);
      end if;
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

CREATE OR REPLACE FUNCTION "public"."release_demo_orphan_for_onboarding"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_intent public.demo_onboarding_intents;
  v_account_id bigint;
  v_member_id bigint;
  v_member_count integer;
begin
  if v_user_id is null then
    raise exception 'release_demo_orphan_for_onboarding requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_intent
  from public.demo_onboarding_intents
  where user_id = v_user_id and state in ('pending', 'failed')
  for update;
  if not found or v_intent.account_id is null then
    return false;
  end if;
  v_account_id := v_intent.account_id;

  if exists (
    select 1 from public.demo_runs
    where root_account_id = v_account_id
      and status in ('seeding', 'active', 'clearing', 'failed')
  ) then
    return false;
  end if;
  if not exists (
    select 1 from public.accounts
    where id = v_account_id and kind = 'household' and demo is true
  ) then
    return false;
  end if;
  select count(*)::integer, min(am.id) into v_member_count, v_member_id
  from public.account_members am
  where am.account_id = v_account_id and am.status = 'active';
  if v_member_id is null or v_member_count <> 1
     or not exists (
       select 1 from public.account_members
       where id = v_member_id and user_id = v_user_id and role in ('parent_admin', 'self_manager')
     ) then
    return false;
  end if;

  perform public.demo_assert_empty_account(v_account_id);

  -- This used to archive the membership, flip `demo = false` and KEEP the
  -- account. That is precisely how an orphan is made: my_contexts() requires
  -- an ACTIVE membership, so the released household became unreachable to
  -- everyone, forever, on every cancelled onboarding. Delete it instead.
  update public.account_members set status = 'archived' where id = v_member_id;
  update public.member_state
  set active_account_id = null, updated_at = now()
  where user_id = v_user_id and active_account_id = v_account_id;

  if not public.dispose_orphaned_account(v_account_id) then
    -- Something the emptiness assert does not cover is holding the account.
    -- Restore the membership rather than leave it stranded: an account we
    -- cannot delete must stay reachable. Never both.
    update public.account_members set status = 'active' where id = v_member_id;
    return false;
  end if;

  delete from public.demo_clear_receipts
  where user_id = v_user_id and root_account_id = v_account_id;
  return true;
end;
$$;

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

  -- Nobody else may be relying on this account -- neither as the subject of
  -- their own onboarding intent nor as the root named by their clear receipt.
  if exists (
    select 1 from public.demo_onboarding_intents
    where account_id = v_account_id and user_id <> v_user_id
  ) or exists (
    select 1 from public.demo_clear_receipts
    where root_account_id = v_account_id and user_id <> v_user_id
  ) then
    return false;
  end if;

  -- Everything above is about THIS CALLER's claim on the account, which the
  -- generic disposer cannot know. The data fence, the live-run check and the
  -- deletion itself belong to dispose_orphaned_account(), which every other
  -- orphan site also uses -- one mechanism, not two (see
  -- .claude/rules/parallel-ownership.md on two mechanisms solving one problem).
  if not public.dispose_orphaned_account(v_account_id) then
    return false;
  end if;

  delete from public.demo_clear_receipts
  where user_id = v_user_id and root_account_id = v_account_id;
  return true;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."finalize_demo_clear"(
  "p_run_id" bigint,
  "p_lease_token" text,
  "p_release_demo" boolean DEFAULT false,
  "p_release_persona" boolean DEFAULT false,
  "p_actor_user_id" uuid DEFAULT NULL::uuid
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_run public.demo_runs;
  v_active_members integer;
  v_completed_at timestamp with time zone := now();
  v_archived_membership_id bigint;
begin
  select * into v_run from public.demo_runs where id = p_run_id for update;
  if not found or v_run.status <> 'clearing'
     or v_run.operation <> 'clear'
     or v_run.lease_token is distinct from p_lease_token
     or v_run.lease_expires_at is null
     or v_run.lease_expires_at <= now() then
    raise exception 'demo run % clear lease is stale or fenced', p_run_id
      using errcode = 'serialization_failure';
  end if;

  if p_release_persona and p_actor_user_id is not null then
    select count(*) into v_active_members
    from public.account_members
    where account_id = v_run.root_account_id and status = 'active';
    if v_active_members = 1 then
      update public.account_members
      set status = 'archived'
      where account_id = v_run.root_account_id
        and user_id = p_actor_user_id
        and role = 'parent_admin'
        and status = 'active'
      returning id into v_archived_membership_id;
    end if;
  end if;

  if exists (
    select 1
    from public.demo_run_users dru
    where dru.run_id = p_run_id
      and not exists (
        select 1 from public.demo_run_auth_cleanup dac
        where dac.run_id = dru.run_id
          and dac.actor_key = dru.actor_key
          and dac.resolved_user_id = dru.user_id
          and dac.state = 'deleted'
      )
  ) then
    raise exception 'demo clear cannot finalize before every exact Auth actor is deleted'
      using errcode = 'check_violation';
  end if;

  -- Companion accounts stay present until this transaction. That keeps a
  -- failed clear's manifest strictly valid after every external/Auth step and
  -- makes account removal atomic with finalization.
  delete from public.account_members am
  where am.account_id in (
    select dra.account_id
    from public.demo_run_accounts dra
    where dra.run_id = p_run_id and not dra.is_root
  );
  delete from public.accounts a
  where a.id in (
    select dra.account_id
    from public.demo_run_accounts dra
    where dra.run_id = p_run_id and not dra.is_root
  );

  -- Restore only a live membership. In particular, when release_persona
  -- archived the sole bootstrap membership above, active_account_id becomes
  -- NULL rather than pointing at that archived row.
  insert into public.member_state (user_id, active_account_id, updated_at)
  select s.user_id,
         case
           when s.original_active_account_id is null then null
           when exists (
             select 1 from public.account_members am
             where am.user_id = s.user_id
               and am.account_id = s.original_active_account_id
               and am.status = 'active'
           ) then s.original_active_account_id
           else null
         end,
         coalesce(s.original_updated_at, now())
  from public.demo_run_member_state s
  where s.run_id = p_run_id
  on conflict (user_id) do update
    set active_account_id = excluded.active_account_id,
        updated_at = excluded.updated_at;

  update public.accounts
  set name = coalesce(v_run.original_root_name, name),
      demo = case when p_release_demo then false else demo end
  where id = v_run.root_account_id;

  if (p_release_persona or p_release_demo) and p_actor_user_id is not null then
    delete from public.demo_onboarding_intents
    where user_id = p_actor_user_id
      and account_id = v_run.root_account_id;
  end if;

  if p_release_demo and p_actor_user_id is not null then
    insert into public.demo_clear_receipts
      (user_id, root_account_id, completed_at, release_demo)
    values (p_actor_user_id, v_run.root_account_id, v_completed_at, true)
    on conflict (user_id, root_account_id) do update
      set completed_at = excluded.completed_at,
          release_demo = excluded.release_demo;
  end if;

  delete from public.demo_runs where id = p_run_id;

  -- The demo is over: the root household must not survive it.
  --
  -- This function used to archive the caller's sole bootstrap membership,
  -- flip `demo = false` and KEEP the account. Because my_contexts() and
  -- current_context_id() both require an ACTIVE membership, that account was
  -- unreachable to everyone the instant this transaction committed -- and a
  -- fresh one was built on the next demo, so every clear -> demo cycle
  -- stranded one more empty household in the database forever. The hosted
  -- acceptance harness was quietly sweeping them, which is exactly why it
  -- stayed invisible.
  --
  -- Deliberately AFTER `delete from public.demo_runs`: the run row and its
  -- cascading manifest are themselves disposability blockers, so the account
  -- only becomes deletable once this clear has finished owning it.
  --
  -- Only on the release path. `admin_reseed_demo_accounts` clears with
  -- p_release_demo = false because it is about to seed the SAME root again.
  if p_release_demo and p_actor_user_id is not null then
    if not public.dispose_orphaned_account(v_run.root_account_id)
       and v_archived_membership_id is not null then
      -- Something the clear did not remove is still holding the account.
      -- Give it back to the caller rather than strand it: an account that
      -- cannot be deleted must stay reachable. Never both, never neither --
      -- assert_account_not_orphaned() enforces exactly that at commit.
      update public.account_members
      set status = 'active'
      where id = v_archived_membership_id;
    end if;
  end if;

  return jsonb_build_object(
    'outcome', 'finalized',
    'run_id', p_run_id,
    'completed_at', v_completed_at
  );
end;
$$;

CREATE OR REPLACE FUNCTION "public"."get_demo_release_receipt"("p_user_id" uuid) RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'root_account_id', root_account_id,
    'completed_at', completed_at,
    'release_demo', release_demo
  )
  from public.demo_clear_receipts
  where user_id = p_user_id and release_demo is true
    and not exists (
      select 1 from public.demo_runs dr
      where dr.root_account_id = demo_clear_receipts.root_account_id
        and dr.status in ('seeding', 'active', 'clearing', 'failed')
    )
    -- The root is now DELETED by a release clear, so "the account still
    -- exists and is no longer flagged demo" can no longer be the proof that
    -- the clear completed -- its absence is a strictly stronger one. Accept
    -- either: gone, or present and released. Without this, a lost clear
    -- response could never be answered from the ledger and the retry would
    -- report failure for a clear that had in fact succeeded.
    and not exists (
      select 1 from public.accounts a
      where a.id = demo_clear_receipts.root_account_id and a.demo is true
    )
    and not exists (
      select 1 from public.account_members am
      where am.account_id = demo_clear_receipts.root_account_id
        and am.user_id = p_user_id and am.status = 'active'
    )
  order by completed_at desc
  limit 1;
$$;

revoke all on function public.account_is_disposable(bigint) from public, anon, authenticated;
grant execute on function public.account_is_disposable(bigint) to service_role;
revoke all on function public.dispose_orphaned_account(bigint) from public, anon, authenticated;
grant execute on function public.dispose_orphaned_account(bigint) to service_role;
revoke all on function public.assert_account_not_orphaned() from public, anon, authenticated;
grant execute on function public.assert_account_not_orphaned() to service_role;

drop trigger if exists z_assert_account_not_orphaned_members on public.account_members;
create constraint trigger z_assert_account_not_orphaned_members
after update or delete on public.account_members
deferrable initially deferred
for each row execute function public.assert_account_not_orphaned();

drop trigger if exists z_assert_account_not_orphaned_accounts on public.accounts;
create constraint trigger z_assert_account_not_orphaned_accounts
after insert or update on public.accounts
deferrable initially deferred
for each row execute function public.assert_account_not_orphaned();
