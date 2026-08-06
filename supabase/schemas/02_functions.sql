--
-- Functions
-- This file declares all PL/pgSQL functions in the public schema.
--

-- Provisions a new auth user's `members` profile row. Membership itself
-- (the account_members row) is bound separately by accept_invite() below —
-- deliberately NOT here, and NOT at auth.users INSERT time at all.
--
-- Story 2.7 review finding #4: this function used to look up the invite by
-- `new.raw_user_meta_data->>'invite_token'` and bind account_members right
-- here, on INSERT. That fires the instant an invitee's OTP is REQUESTED
-- (`authProvider.login({ requestOtp: true, ... })`), not once it is
-- VERIFIED — GoTrue creates (and, under this project's
-- `enable_confirmations = false` autoconfirm setting, even stamps
-- `email_confirmed_at`/`last_sign_in_at` on) the auth.users row the moment
-- the code is requested, before the invitee has typed anything back
-- (verified empirically against the running local stack: both timestamps
-- are already non-null immediately after the bare `/otp` call). So anyone
-- who merely obtained the invite link (a forwarded email) could burn it —
-- flipping it to `accepted` and provisioning an active membership — without
-- ever proving mailbox control, locking the real invitee out with "this
-- invite has already been used." There is no auth.users column that
-- reliably distinguishes "requested" from "verified" under this config, so
-- binding on `auth.uid()` (obtainable ONLY via a verified session) is the
-- only mechanically sound gate — see accept_invite()'s own comment.
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

-- Binds an invite to a real membership and marks it `accepted` — the other
-- half of Story 2.7's invite-only signup, and the fix for review finding
-- #4 (see handle_new_user()'s comment for the full "requested vs verified"
-- rationale this replaces). Called by InviteAcceptance.tsx immediately
-- after its own verifyOtp() succeeds, i.e. only once `auth.uid()` resolves
-- to a real, code-verified session — that is the one thing a bare `/otp`
-- request can never produce, which is exactly why it is the gate here
-- instead of an auth.users trigger. `role` is never read from the request
-- body for a mass assignment (AC-6) — it is looked up server-side from the
-- invites row the token names, never from a client-supplied role field.
-- Re-validates BOTH the token and the caller's own email against the
-- invite (review finding #3's fix lives here now, not in handle_new_user():
-- moving the bind off the auth.users trigger closes that finding at the
-- root — no code path can create a membership from a bare token anymore,
-- only this definer function, and only for the session's own email).
-- Idempotent: a retry for an invite this SAME caller already completed
-- (a page reload right after success) is a silent no-op, not an error.
--
-- Story 6.1 (AC-3/AC-4): when the invite names a target single
-- (`target_single_id`, a `role = 'single'` invite only — the table's own
-- `invites_role_target_check` constraint), the same statement block also
-- links `singles.member_id` to the membership row just created, so a
-- `singles` row is never left half-linked. The link's own guard
-- (`where ... member_id is null` + `if not found`) is race-safe: two
-- concurrent acceptances of invites naming the same target cannot both pass
-- — the second UPDATE matches zero rows and raises, rolling back the whole
-- function INCLUDING the invite's `status = 'accepted'` claim above, which
-- is correct: an invite that could not be honoured must not be burnt.
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

-- =====================================================================
-- MyShadchan — Shidduchim pipeline functions (AD-2, AD-3, AD-4)
-- =====================================================================

-- Resolves the caller's ACTIVE context (AD-19) from member_state, validated
-- against a live active-status membership every time it is called.
--
-- FAILS CLOSED. The single-account resolver this replaces fell back to an
-- arbitrary membership (`order by am.id limit 1`) whenever the caller held
-- one, which meant a user in two contexts could never choose which one
-- they were looking at. Returning NULL — never a guessed
-- fallback — is what makes the tenant boundary real: every policy reads
-- `account_id = public.current_context_id()`, which is NULL-false, so a
-- caller with no live active context sees and writes nothing.
--
-- The other half of this lives in activate_first_context() (04_triggers.sql),
-- which must actually grant an active context on first membership or nobody
-- can use the app at all.
--
-- SECURITY DEFINER so it can be called from RLS policies without recursing into
-- the very policies it feeds.
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

-- Resolves the caller's own account_members.id within their currently
-- active context (Story 3.5). Same shape as current_context_id() and for
-- the same reason: SECURITY DEFINER so it can be called from RLS policies
-- (and from a client-visible "is this mine" read, Story 3.6) without
-- recursing into the policies account_members itself carries. Returns NULL
-- when there is no active context, because current_context_id() does
-- (fail-closed by design) — a NULL actor_member_id is legal and correct
-- for such a caller, who cannot insert at all under RLS's own
-- `account_id = public.current_context_id()` (NULL-false).
--
-- `order by am.id limit 1` is a defensive tiebreak, not the primary
-- guarantee: `account_members_account_user_active_uq` (01_tables.sql) is a
-- PARTIAL unique index (`where status = 'active'`), so a login holding both
-- an archived and an active membership in the same account has two rows,
-- and this filters to `status = 'active'` explicitly rather than relying on
-- the index alone — so this function cannot start raising "more than one
-- row" if that partial index is ever dropped. The single named, reusable
-- resolver every other caller (log_reference_call, merge_references,
-- set_interaction_actor_member_id) replaces its own inline copy with.
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

-- The single authority for "what role does the caller hold in their
-- active context" (AD-2). Derived from current_member_id() (defined
-- above, once) so the membership-row resolution stays single-owner.
-- SECURITY DEFINER so RLS policies can call it without recursing into
-- account_members' own policies (the same reason current_context_id()
-- and current_member_id() are SECURITY DEFINER).
-- Returns NULL when the caller has no active membership — fails closed.
CREATE OR REPLACE FUNCTION "public"."current_member_role"() RETURNS text
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select am.role
  from public.account_members am
  where am.id = public.current_member_id();
$$;

-- Private writer shared by set_active_context() and the
-- activate_first_context trigger (AC-4/AC-5) — the ONLY code path that ever
-- writes member_state. Does no membership validation of its own: callers are
-- responsible for proving p_user_id actually holds an active membership of
-- p_account_id before calling this. EXECUTE is revoked from every client
-- role (06_grants.sql) — only its two SECURITY DEFINER callers and
-- service_role can reach it.
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

-- The one validated way a client switches its active context (AD-19:
-- "Switching goes through set_active_context(account_id), which validates
-- membership before writing"). Raises rather than silently no-op-ing when
-- the caller does not hold a live active membership of p_account_id — a
-- raw client write to member_state is impossible (AC-3: no insert/update
-- policy for authenticated), so this function is the only door.
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

-- Trigger function for activate_first_context_trigger (04_triggers.sql):
-- AFTER INSERT on account_members, WHEN (new.status = 'active'). Auto-
-- activates a user's first live context so FR84 ("active context explicit,
-- never inferred") and 2.4's "no switcher clutter with one context" both
-- hold from the moment a context exists, without a UI-side bootstrap step.
--
-- Calls activate_context_for() directly, NEVER set_active_context():
-- handle_new_user() inserts the bootstrap membership from an auth.users
-- trigger, where auth.uid() is NULL — set_active_context()'s membership
-- check would raise there and roll back the entire signup. The newly
-- inserted row itself is the proof of membership; no second check is
-- needed.
--
-- Tolerates new.user_id is null (account_members.user_id is nullable, ON
-- DELETE SET NULL) by doing nothing — there is no user to activate a
-- context for.
--
-- Only acts when the user currently has NO live active context: either no
-- member_state row exists yet, or the existing row's active_account_id no
-- longer names any of the user's own active memberships (the same rule
-- current_context_id() applies, expressed over new.user_id instead of
-- auth.uid()). Gaining a SECOND context while the first is still live is a
-- deliberate no-op — a new membership must never silently move someone's
-- active context.
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

-- Reads the demo flag for the caller's account so the SPA can show the demo
-- banner (later stage) without a bespoke query. SECURITY DEFINER + search_path
-- '' like current_context_id; returns false when the caller has no account.
CREATE OR REPLACE FUNCTION "public"."current_account_demo"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(
    (select a.demo from public.accounts a where a.id = public.current_context_id()),
    false
  );
$$;

-- Serves the context switcher (Story 2.4, AD-19): one row per context
-- (account) the caller holds an ACTIVE membership in, never one row per
-- persona — a household held for both the parent and single personas is
-- still one context to switch to, not two. Contrast my_personas(), which is
-- deliberately persona-shaped further below.
--
-- SECURITY INVOKER (no SECURITY DEFINER clause): safe, and correct, only
-- because Story 2.1 AC-7 widened the `accounts` and `account_members` SELECT
-- policies to expose every context a caller belongs to, not merely the one
-- that is currently active — a plain invoker-rights read here relies on that
-- widened shape rather than re-deciding visibility itself.
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

-- Auto-populate account_id from the caller's account on insert (AD-1), so the
-- normal dataProvider.create() path for singles/shadchanim/references/etc.
-- never has to trust a client-sent account_id. Mirrors set_member_id_default.
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

-- Server-sets actor_member_id on every interactions insert (Story 3.5, AC 4).
-- Unconditionally OVERWRITES any client-supplied value — unlike
-- set_account_id_default() above, this does not merely default a NULL — so a
-- caller cannot attribute a row to another member by supplying
-- actor_member_id in the request body. NOT SECURITY DEFINER: the definer
-- privilege it needs lives inside current_member_id() itself, which this
-- trigger just calls (mirrors the current_context_id()/set_account_id_default
-- split above).
CREATE OR REPLACE FUNCTION "public"."set_interaction_actor_member_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.actor_member_id := public.current_member_id();
  return new;
end;
$$;

-- Server-sets uploaded_by_member_id on an entity_files insert (Story 3.7, AC
-- 2f). Unconditionally overwrites, exactly like
-- set_interaction_actor_member_id() above — the review fix for Story 3.7's
-- F6: the table-level INSERT grant covers every column, so a client-supplied
-- uploaded_by_member_id was NOT merely a no-op default (the original
-- if-null comment's premise) but an accepted value, proven live by
-- inserting a row from account A's context with another account's
-- account_members.id and watching it land, attributed to a foreign member
-- entity_files_summary then resolved to a real name across the tenant
-- boundary. NOT SECURITY DEFINER: the definer privilege it needs lives
-- inside current_member_id() itself, exactly like
-- set_interaction_actor_member_id() above.
CREATE OR REPLACE FUNCTION "public"."set_entity_files_uploaded_by"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.uploaded_by_member_id := public.current_member_id();
  return new;
end;
$$;

-- =====================================================================
-- MyShadchan — Persona and context data model (Story 2.2, AD-2)
-- =====================================================================

-- AC-3/AC-3a: a shadchanus-kind account can never hold a household domain
-- row, enforced by Postgres rather than by convention. Attached
-- (04_triggers.sql) to 11 household-only domain tables as
-- `validate_<table>_household_scope` — NOT SECURITY DEFINER, because it only
-- reads accounts.kind for the row it is validating, which the
-- inserting/updating member's own RLS already lets them read. `before insert
-- or update of account_id`, so a row can never be *moved* onto a shadchanus
-- account either. A NULL new.account_id also raises (fail-closed): the only
-- legitimate way to reach this trigger with a NULL account_id is a broken
-- caller, since set_account_id_default() always fills it in first — see the
-- trigger-naming rationale below before renaming anything. Mirrors
-- purge_polymorphic_dependents()'s one-function-many-tables shape.
-- Story 3.14 dropped this trigger from `interactions` and `tasks` (13 -> 11)
-- on the project owner's ruling that a shadchanus context must be able to
-- hold a task and log an interaction (AD-2). The function body itself is
-- unchanged: it still just checks `accounts.kind`, and is simply no longer
-- attached to those two tables.
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

-- AC-5: the mirror case on account_members itself — a shadchan-role
-- membership may only ever exist on a shadchanus-kind account, and every
-- other role only on a household-kind account (AD-2: the shadchan role's
-- access is granted solely through a connection, never through household
-- membership). Fires on UPDATE too, so a role CHANGE on an existing
-- membership is checked, not just the initial insert. Not SECURITY DEFINER,
-- for the same reason as enforce_household_scope().
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

-- Shared "is this an owning role" predicate (AC-6/AC-8): parent_admin and
-- self_manager are the two roles entitled to have a household's `single`
-- persona attached to them, and the only ones add_persona('parent') ever
-- promotes in place. Factored out so add_persona() and my_personas() can
-- never diverge on this list. IMMUTABLE: a pure function of its argument.
CREATE OR REPLACE FUNCTION "public"."is_owning_membership_role"("p_role" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select p_role in ('parent_admin', 'self_manager');
$$;

-- Story 3.6 (AC 3): "may this caller edit or soft-delete this note" — the
-- ONE predicate both the interactions UPDATE policy (05_policies.sql) and
-- interactions_summary's can_moderate column (03_views.sql) call, so the
-- two can never answer differently for the same row (the same reasoning
-- that produced is_owning_membership_role() itself, just above).
--
-- Two review-blocking traps this function exists to avoid:
--   1. The owning-role branch calls is_owning_membership_role(am.role) —
--      NEVER a literal `am.role = 'parent_admin'`. A self-managing
--      household's only owning membership is `self_manager`; hardcoding
--      `parent_admin` would lock such a household out of moderating its
--      own notes (Story 3.6 Dev Notes, AC 4(d)).
--   2. The author branch joins account_members on `id = p_actor_member_id`
--      and compares `am.user_id = auth.uid()` — NEVER
--      `p_actor_member_id = current_member_id()`. Membership rows are not
--      stable across a persona archive/re-add round-trip
--      (account_members_account_user_active_uq, 01_tables.sql, is a
--      PARTIAL unique index on `where status = 'active'`), so the archived
--      and the freshly re-added row coexist with different ids.
--      current_member_id() only ever resolves the ACTIVE one, so comparing
--      ids would permanently strip an author of their own older notes the
--      moment their membership round-trips (Story 3.6 Dev Notes, AC 4(e)).
--      Comparing on `user_id` survives that round-trip: the FK is
--      `on delete set null` (01_tables.sql), never `on delete cascade`, and
--      a persona round-trip only ever flips `status`, never `user_id`.
--
-- SECURITY DEFINER for the same reason as current_context_id() /
-- current_member_id(): it is called from inside an RLS policy on
-- account_members and must not recurse into that table's own SELECT
-- policy. Returns a boolean and no row data, so the definer rights leak
-- nothing.
--
-- A NULL p_actor_member_id IS A PERMANENTLY LEGAL STATE, AND IS DELIBERATELY
-- NEVER BACKFILLED. The Epic 3 loose-ends audit counted 6 live
-- `kind = 'note'` rows in production carrying actor_member_id IS NULL. The
-- author branch below cannot match them — `am.id = NULL` selects nothing —
-- so they fall through to the owning-role branch: moderable by an owner of
-- the active context and by nobody else. That is the intended answer, not a
-- defect. The decision to leave them alone was taken explicitly and does not
-- depend on the count; the reasons, in increasing order of how hard they are
-- to undo:
--
--   1. There is nothing to backfill FROM. interactions carries exactly one
--      authorship-shaped column (01_tables.sql) — no created_by, no user_id
--      — and its metadata holds only call/merge context. The one member id
--      that appears anywhere nearby, the 'member_id' key inside
--      reference_links.conversation_log, is the SAME current_member_id()
--      value written by the same statement of log_reference_call(), so it is
--      NULL in exactly the cases that would need it.
--   2. NULL is reachable by three routes that are indistinguishable after
--      the fact:
--        (a) the row predates set_interaction_actor_member_id()
--            (04_triggers.sql), which is BEFORE INSERT and so could not see
--            rows that already existed when it landed;
--        (b) interactions_actor_member_id_fkey is ON DELETE SET NULL
--            (01_tables.sql), so deleting a membership row nulls this column
--            on every note that member ever wrote;
--        (c) a SECURITY DEFINER writer (log_reference_call(),
--            merge_references()) invoked with no active context stamps
--            current_member_id(), which is NULL by design (see its own
--            comment above). Such rows are 'call_logged' or 'merge', neither
--            'note' nor 'single_input', so both callers' `kind not in
--            ('note', 'single_input') or can_moderate_note(...)` guard means
--            they never reach this function — but (c) is why the column is
--            nullable at all, and
--            why a NOT NULL constraint must not be "tidied" onto it.
--      (b) and (c) are ongoing, not historical. A backfill would therefore
--      never converge — it would have to be re-run forever, which is the
--      opposite of 20260729095558_backfill_member_state.sql, whose whole
--      justification is that it is idempotent and self-healing.
--   3. This column is not a label, it is a grant. The author branch turns
--      actor_member_id straight into edit/soft-delete rights, so guessing an
--      author hands moderation of someone's content to a member who may not
--      have written it. Unlike the member_state backfill, that cannot be
--      repaired by re-running anything: an invented value is
--      indistinguishable from a real one the moment it is written.
--
-- If a non-owning member ever needs to moderate one of these rows, the
-- answer is an owning-role member doing it — not inventing an author.
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

-- Provisions a persona (AC-6) — the one function every onboarding/lifecycle
-- screen calls (2.3, 2.5) rather than reimplementing its own
-- household-creation rule. SECURITY DEFINER, deliberately, not SECURITY
-- INVOKER: the target household for the single/parent branches is whichever
-- one auth.uid() already holds an OWNING membership in, which is not
-- necessarily the caller's currently-active context (current_context_id()),
-- so a plain invoker-rights insert would be silently rejected by the target
-- table's own `with check` the moment that household is not active — the
-- exact set_active_context() problem 2.1 already solved, recurring here.
-- Every query inside is filtered to user_id = auth.uid() alone — never a
-- parameter, never another user's id — so bypassing RLS never becomes
-- bypassing the tenant boundary. Idempotent per persona. Never switches the
-- caller's active context: that stays set_active_context()'s job alone.
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

-- The one query every later screen uses to answer "what am I" (AC-8): 2.3,
-- 2.4 and 2.5 all call this rather than re-deriving these predicates three
-- ways. SECURITY DEFINER for the same reason as add_persona(): a persona can
-- sit in a context that is not the caller's currently-active one, and
-- singles/account_members RLS is scoped to that active context only, so a
-- plain invoker-rights read would silently under-report. Every branch is
-- filtered to user_id = auth.uid() alone; the empty argument list is the
-- only guard that matters, so it can never be used to inspect anyone else.
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

-- Review finding #1 (2.5): "does this account still hold real data" —
-- checked against every domain table this function has always enumerated
-- (14 of them, Story 5.6 adds shidduchim_external_links), status-agnostic
-- (an archived/paused row is still data per AC-3's "remains auditable").
-- Kept general rather than scoped to the household-only set (04_triggers.sql's
-- validate_<table>_household_scope list, 11 tables as of Story 3.14): a
-- shadchanus account can never hold a row in any of those 11 (the same
-- trigger still forbids it), so those arms stay structurally always false
-- there — but `interactions` and `tasks` no longer carry that trigger
-- (Story 3.14, AD-2), so a shadchanus account CAN answer yes via those two
-- arms today. The function body below is unchanged on purpose: checking
-- every table it always has is what keeps it correct both for the 11 that
-- stay closed and the 2 Story 3.14 opened up.
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
    or exists (select 1 from public.shidduch_schools where account_id = p_account_id)
    or exists (select 1 from public.shidduchim_external_links where account_id = p_account_id)
    or exists (select 1 from public.interactions where account_id = p_account_id)
    or exists (select 1 from public.identity_signals where account_id = p_account_id)
    or exists (select 1 from public.inbox_items where account_id = p_account_id)
    or exists (select 1 from public.tasks where account_id = p_account_id);
$$;

-- Review finding #1 (2.5, BLOCKER): shared refusal guard for
-- remove_persona()'s shadchan branch and the parent branch's
-- archive-outright arm — the two places that archive an account_members row
-- without checking anything first. Not used by the single branch: archiving
-- a singles row never touches account_members, so there is no membership
-- (and therefore no account-level orphan) at stake there.
--
-- Refuses archiving `p_membership_id` when it is the caller's LAST active
-- membership of `p_account_id` (no other active member, of any role, could
-- ever reach it again) AND that account still holds any domain row. Without
-- this, add_persona() re-provisioning always mints a brand-new, empty
-- account rather than reactivating the archived one (there is no
-- un-archive path today), so this specific account's history becomes
-- permanently unreachable — the opposite of AC-3/AC-4's "archived, never
-- deleted, remains auditable forever." Deliberately account-scoped, not a
-- global "is this your only persona anywhere" check: the caller may hold
-- other personas on other accounts and still orphan this one.
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

-- Story 2.5 (AC-2/AC-3/AC-5/AC-7): the one function that owns persona
-- removal, mirroring add_persona()'s shape and rationale exactly — SECURITY
-- DEFINER because the target membership may not be the caller's currently
-- active context (the same problem set_active_context()/add_persona()
-- already solve), and every query is filtered to user_id = auth.uid() alone,
-- never a parameter, so bypassing RLS never becomes bypassing the tenant
-- boundary or reaching another user's row.
--
-- Archives, never deletes (AC-3): the only writes in this body are
-- `update ... set status = 'archived'` or `update ... set role =
-- 'self_manager'` — zero `delete from`. `grep -in "delete from"` over this
-- function's body must return nothing.
--
-- Each of the three branches is independent and mutually exclusive
-- (p_persona selects exactly one), so `v_archived_account_id` is set by at
-- most one of them; the AC-7 dangling-active-context handoff at the bottom
-- runs once, common to whichever branch actually archived a membership.
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

-- =====================================================================
-- MyShadchan — Invite-only signup with 18+ affirmation (Story 2.7, AD-11)
-- =====================================================================

-- The concrete shape of "role <= inviter authority" from the epic text
-- (AC-3). IMMUTABLE — a pure function of its argument — used by
-- create_invite() to refuse granting a role above the caller's own.
-- `self_manager` (2) sits between `parent_admin` (3) and the three
-- authority-1 roles: a self-managing single may invite a `helper` or
-- another `single` into their own household, but never a `parent_admin`.
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

-- The shared "may this role send invites at all" predicate (AC-3) — the
-- caller-side half of authority, distinct from role_authority()'s
-- ceiling-on-the-invitee-role half. IMMUTABLE, like role_authority() above.
-- Factored out (Story 2.8) so the literal `parent_admin`/`self_manager`/
-- `shadchan` list is written once, shared by create_invite() below and
-- revoke_invite() (Story 2.8, further down this section), rather than
-- repeated per function. Deliberately BROADER than 2.2's owning-role helper
-- `is_owning_membership_role()` (parent_admin/self_manager only): a
-- shadchan can invite into their shadchanus but never owns a `singles` row
-- — do not merge the two predicates.
CREATE OR REPLACE FUNCTION "public"."is_invite_capable_role"("p_role" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select p_role in ('parent_admin', 'self_manager', 'shadchan');
$$;

-- The one function that creates an invitee-facing invite (AC-3). SECURITY
-- DEFINER: AC-2 withholds every DML grant on `invites` from `authenticated`,
-- so an invoker-rights insert would be refused at the grant before any of
-- these checks ever ran — this function's own checks are therefore the ONLY
-- write gate, not merely a convenience layer in front of RLS. Refuses
-- unless: the caller holds an active membership of the current context;
-- that membership's role is invite-capable (is_invite_capable_role() above);
-- `role_authority(p_role)` does not exceed the caller's own; and `p_role`
-- matches the active context's `kind` (household -> parent_admin/helper/
-- single, shadchanus -> shadchan). The kind check exists so an invite that
-- could never be accepted (2.2's enforce_membership_role_matches_context()
-- trigger would reject it) is refused at creation, not discovered broken by
-- the invitee. Sets `invited_by` from the caller's own
-- `account_members.id`, never from a parameter — a client cannot forge who
-- an invite came from.
--
-- Story 6.1 (AC-1/AC-2): `p_target_single_id` is appended LAST (a leading or
-- middle parameter would change the PostgREST RPC signature for every
-- existing caller). The two checks against it are a UX layer only — for a
-- better client message than a raw constraint violation — never the tenant
-- boundary: `invites_role_target_check` (role/target coupling) and the
-- `invites_target_single_id_fkey` composite FK (cross-household targeting)
-- are what actually enforce this at INSERT time regardless of what this
-- function validates first.
CREATE OR REPLACE FUNCTION "public"."create_invite"("p_email" "text", "p_role" "text", "p_target_single_id" bigint DEFAULT NULL) RETURNS "public"."invites"
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

-- Backs /accept-invite/:token (AC-4): an UNAUTHENTICATED invitee looks up
-- their invite by token before signing up. Returns ONLY the five fields an
-- invitee needs to render "You've been invited to join The Klein Family as
-- a helper" — never the inviting account's own data, `invited_by`, `id` or
-- the token itself. Deliberately anon-callable (06_grants.sql) — the one new
-- anon surface this story adds, and a deliberate, scoped exception to AD-1's
-- "the only anon-readable relation is the published-listing snapshot": this
-- is a function returning five non-domain fields for a caller who already
-- holds the token, not a relation. `status` is the caller-EFFECTIVE status:
-- a `pending` row whose `expires_at` has passed reports as `expired` even
-- though nothing in this schema ever writes that literal value on a timer.
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

-- Backs the "before user created" Auth Hook
-- ([auth.hook.before_user_created] in supabase/config.toml). Originally
-- (Story 2.7, AC-5) THE authoritative gate for AD-11's "new users join only
-- by a verified invite token" AND the 18+ affirmation. Open signup removed
-- the invite requirement — a signup no longer needs a matching, pending,
-- unexpired invite to create an account — so this function is now solely
-- the age gate, and it is renamed from check_signup_invite to match: a
-- function still called "check_signup_invite" that lets invite-less
-- signups through would be exactly the name/behaviour drift
-- `.claude/rules/coding-style.md` warns about. Invites are not gone —
-- accept_invite() still joins an invitee to an EXISTING account as a
-- specific role, unchanged — this hook simply no longer requires one to
-- exist before an account can be created at all.
--
-- Verified empirically against the running local stack (this repo pins no
-- Supabase CLI version, see story 2.7's Dev Notes "Running the Supabase CLI
-- here"): GoTrue calls this ONLY for the self-serve signup paths (`/otp`,
-- `/signup`) — never for a service-role `auth.admin.createUser()` — as
-- `supabase_auth_admin`, passing `event` shaped like
-- `{"user": {"email": ..., "user_metadata": {...}}, "metadata": {...}}`.
-- Note the metadata lives under `user_metadata` (GoTrue's external name for
-- `raw_user_meta_data`), NOT `raw_user_meta_data` itself — a different key
-- path than handle_new_user()'s own trigger, which reads the real column.
-- To ALLOW, return `{}`; to REFUSE, return
-- `{"error": {"http_code": ..., "message": ...}}`, which GoTrue surfaces to
-- the client as that exact HTTP status and message — verified to produce a
-- real 403 with the given message, not GoTrue's generic hook-failure text.
-- The metadata read is cast defensively: a hand-crafted, malformed
-- `age_affirmed` value must refuse cleanly, never crash the hook (a hook
-- error surfaces as an opaque 500, not a clear 403).
--
-- Google OAuth signups cannot carry `age_affirmed` here at all —
-- signInWithOAuth() forwards its queryParams to the identity provider,
-- never into GoTrue's own user_metadata, unlike signInWithOtp()'s
-- email/OTP path. When user_metadata lacks the field, this function falls
-- back to public.signup_intents: a short-lived, single-use row the
-- frontend inserts (as `anon`, before ever redirecting to Google) for the
-- exact email address about to authenticate. A matching, unconsumed,
-- unexpired row is treated as an affirmation and consumed — never merely
-- read — in the same UPDATE that finds it, which is what makes it
-- single-use even under a raced retry (the UPDATE's own WHERE clause is
-- the atomicity: a second, concurrent match finds zero rows once the first
-- has committed `consumed_at`). See signup_intents' own comment
-- (01_tables.sql) for why an anon-insertable table keyed only on an email
-- address is safe. Expired intents are swept here too — this repo has no
-- scheduled-job (pg_cron) infrastructure, so cleanup piggybacks on the one
-- code path that already touches this table on every signup attempt,
-- rather than growing the table forever.
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

-- The one function that revokes a not-yet-accepted invite (Story 2.8,
-- AC-3). SECURITY DEFINER for the same reason as create_invite() above:
-- AC-2 withholds every DML grant on `invites` from `authenticated`, so an
-- invoker-rights update would be refused at the grant before any of these
-- checks ever ran. Deliberately scoped to current_context_id(), exactly
-- like create_invite() and exactly like the "Invites readable within active
-- account" SELECT policy (05_policies.sql): an invite belonging to an
-- account the caller is NOT currently active in is simply not found by the
-- lookup below — the same shape of invisibility RLS would produce, not a
-- distinct "you don't have permission" branch (a caller who also holds a
-- separate, invite-capable membership elsewhere still cannot revoke an
-- invite there without first switching context to it). Refuses unless: the
-- invite exists in the caller's current context; the caller holds an
-- active, invite-capable membership there (is_invite_capable_role(),
-- shared with create_invite()); and the invite is still `pending` — an
-- already-`accepted` invite is a real member now, removing them is Story
-- 2.5's persona-removal path, a different action for a different state.
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

-- The ONE authority for which pipeline states a single may see (AD-3, D5).
-- Closed enumeration over ALL 7 states: visible = look_into/yes/unsure;
-- hidden = new/not_sure/for_sure_not/no. No include/exclude gap — an
-- unclassified value raises rather than silently leaking. Both RLS and the
-- Epic 6 single-login screens will call this, never re-implement it.
CREATE OR REPLACE FUNCTION "public"."is_single_visible_state"("s" public.pipeline_state) RETURNS boolean
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

-- Defense-in-depth for AD-4 invariant 2: any UPDATE that changes
-- pipeline_state must follow a legal edge in pipeline_transitions, so a raw
-- dataProvider.update() cannot bypass the transition graph. INSERTs set the
-- initial state freely (validated inside create_shidduch).
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

-- Defense-in-depth for AD-4 invariant 1: even a raw INSERT (bypassing
-- create_shidduch) cannot land a shidduch straight into a decision state.
-- A decision (yes/unsure/no) is reachable ONLY from look_into via
-- transition_shidduch. Mirrors the initial-state guard inside create_shidduch.
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

-- =====================================================================
-- close_reason: the column-level control (Epic 6 follow-up, Story 6.3 AC-4)
-- =====================================================================
--
-- Story 6.3 redacted `close_reason` for a `single` caller in
-- shidduchim_summary's own CASE. That was a READ-PATH CONVENTION, not a
-- control: PostgREST exposes base tables, 06_grants.sql granted table-level
-- SELECT on public.shidduchim to `authenticated`, and
-- `GET /rest/v1/shidduchim?select=id,close_reason` therefore handed a single
-- the candid text verbatim. RLS cannot close it — a policy decides whether a
-- ROW comes back, never which COLUMNS do — so the control has to be a column
-- privilege.
--
-- Postgres cannot subtract a column from a table-level grant: `revoke select
-- (close_reason) ... from authenticated` is a silent no-op while the role
-- still holds table-level SELECT (verified: has_column_privilege stays true).
-- So 06_grants.sql now grants SELECT on public.shidduchim COLUMN BY COLUMN,
-- omitting close_reason. `authenticated` — the ONE Postgres role every member
-- of every household logs in as, whatever their `account_members.role` — can
-- no longer read that column at all, through any path.
--
-- Which leaves the legitimate readers. There is no per-member-role Postgres
-- role to re-grant the column to (member role is a row in account_members,
-- resolved by current_member_role()), and shidduchim_summary is
-- `security_invoker = on`, so the view's own scan needs the INVOKER's column
-- privilege — the CASE could not even be evaluated any more. Hence this
-- SECURITY DEFINER accessor: it is the ONLY thing in the database that reads
-- public.shidduchim.close_reason on behalf of `authenticated`, and it hands
-- the value back only to a caller the SELECT policy would already have shown
-- the whole row to.
--
-- The guard is a byte-for-byte mirror of "Shidduchim scoped to account"'s
-- `using` clause (05_policies.sql) — `account_id = current_context_id() and
-- current_member_role() <> 'single'` — plus the id. That policy is the WHOLE
-- non-single read predicate for this table (`visibility`/`owner_member_id`
-- narrow nothing for a non-single member), so a definer function cannot
-- widen anything here: any row it answers for is a row the caller can
-- already SELECT. For a `single` caller the role conjunct fails and the
-- function returns NULL — the AC-4 promise, now enforced by the database
-- rather than described by a view.
--
-- Any change to that policy has to be made here in the same commit.
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

-- The masked whole-row read of public.shidduchim, and the reason the column
-- grant above does not break every RPC in this section.
--
-- create_shidduch(), transition_shidduch() and add_redt() all return
-- `SETOF public.shidduchim` and all reached it with `select *`. `select *`
-- needs SELECT on EVERY column, so each of them would now fail with a bare
-- 42501 for every caller, single or not. Listing 31 columns three times over
-- would be the same list drifting in three places, so it is written ONCE
-- here and the three RPCs (plus catch_shidduch's row fetch) read through it.
--
-- SECURITY INVOKER (the default) — deliberately, and this is the load-bearing
-- half: RLS on public.shidduchim still applies exactly as it did to the
-- `select *` this replaces, so these functions return the same rows to the
-- same callers as before. Only close_reason changes, and only for a caller
-- the accessor above refuses.
--
-- COLUMN-ORDER TRAP: the select list is the PHYSICAL column order of
-- public.shidduchim (declaredColumnOrder.ts / column_order.test.ts is the
-- guard for that order), because `RETURNS SETOF public.shidduchim` matches
-- positionally. A column added to the table must be appended here, and must
-- be added to the grant in 06_grants.sql, or this function stops compiling —
-- loudly, which is the intended failure mode for a table whose default is now
-- "not readable".
CREATE OR REPLACE FUNCTION "public"."shidduch_row"("p_shidduchim_id" bigint) RETURNS SETOF public.shidduchim
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

-- The SOLE INSERT path into shidduchim (AD-4 invariant 1). Written as a
-- low-level reusable primitive: a future fileInboxItem() (Epic-6) must call
-- this rather than duplicate the INSERT. Sets account_id, provenance,
-- visibility, owner_member_id and the initial state. Decision states
-- (yes/unsure/no) can NEVER be created directly — they are reachable only
-- from look_into via transition_shidduch. SECURITY INVOKER so RLS applies.
CREATE OR REPLACE FUNCTION "public"."create_shidduch"(
    "p_single_id" bigint,
    "p_shadchan_id" bigint DEFAULT NULL,
    "p_name_en" text DEFAULT NULL,
    "p_name_he" text DEFAULT NULL,
    "p_father_en" text DEFAULT NULL,
    "p_father_he" text DEFAULT NULL,
    "p_mother_en" text DEFAULT NULL,
    "p_mother_he" text DEFAULT NULL,
    "p_dob" date DEFAULT NULL,
    "p_background" text DEFAULT NULL,
    "p_marital_status" text DEFAULT NULL,
    "p_existing_children_note" text DEFAULT NULL,
    "p_seminary_en" text DEFAULT NULL,
    "p_seminary_he" text DEFAULT NULL,
    "p_shul_en" text DEFAULT NULL,
    "p_shul_he" text DEFAULT NULL,
    "p_location_en" text DEFAULT NULL,
    "p_location_he" text DEFAULT NULL,
    "p_age" integer DEFAULT NULL,
    "p_height" text DEFAULT NULL,
    "p_origin" text DEFAULT 'manual',
    "p_initial_state" public.pipeline_state DEFAULT 'new',
    "p_visibility" text DEFAULT 'shared',
    "p_redt_date" date DEFAULT NULL
) RETURNS SETOF public.shidduchim
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

  return query select * from public.shidduch_row(v_id);
end;
$$;

-- The SOLE writer of pipeline_state (AD-4 invariant 2). Enforces the
-- transitions-as-data graph (pipeline_transitions) with optimistic
-- concurrency on `p_from`. close_reason is set on entry to a terminal state
-- and cleared otherwise. SECURITY INVOKER so RLS applies.
CREATE OR REPLACE FUNCTION "public"."transition_shidduch"(
    "p_id" bigint,
    "p_from" public.pipeline_state,
    "p_to" public.pipeline_state,
    "p_close_reason" text DEFAULT NULL
) RETURNS SETOF public.shidduchim
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

-- Keeps the denormalized redt summary on shidduchim in sync with the redts
-- history: redt_date = the LAST (most recent) redt, shadchan_id = that latest
-- redt's shadchan (the card "via"), first_suggested_by/at = the earliest redt.
-- Fires on any redts insert/update/delete. RLS on shidduchim confines the
-- UPDATE to the caller's own account, so a redt cannot mutate a foreign shidduch.
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

-- Append a redt to a shidduch (the same or a different shadchan can redt it
-- again, on a new date). Account-scoped so a redt can never be added to a
-- foreign account's shidduch. Returns the refreshed shidduch row. SECURITY
-- INVOKER so RLS applies.
CREATE OR REPLACE FUNCTION "public"."add_redt"(
    "p_shidduchim_id" bigint,
    "p_shadchan_id" bigint DEFAULT NULL,
    "p_redt_date" date DEFAULT NULL,
    "p_note" text DEFAULT NULL
) RETURNS SETOF public.shidduchim
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

-- Link a school/seminary/yeshiva (with optional years) to a shidduch. A single
-- can have several. Account-scoped so it can't attach to a foreign shidduch.
-- SECURITY INVOKER so RLS applies.
CREATE OR REPLACE FUNCTION "public"."add_school"(
    "p_shidduchim_id" bigint,
    "p_kind" text DEFAULT 'seminary',
    "p_name_en" text DEFAULT NULL,
    "p_name_he" text DEFAULT NULL,
    "p_start_year" integer DEFAULT NULL,
    "p_end_year" integer DEFAULT NULL
) RETURNS SETOF public.shidduch_schools
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
  insert into public.shidduch_schools (
    account_id, shidduchim_id, kind, name_en, name_he, start_year, end_year
  ) values (
    v_account_id, p_shidduchim_id, coalesce(p_kind, 'seminary'),
    p_name_en, p_name_he, p_start_year, p_end_year
  )
  returning *;
end;
$$;

-- Append one file version to a shidduch's resume (Story 5.3, AC 2). The ONE
-- write path into resumes.files — the SPA never PATCHes the column
-- directly, because a client read-modify-write would race under concurrent
-- uploads (two tabs, two uploads, last write wins, silently dropping the
-- other version). This function closes that race the same way
-- log_reference_call() closes it for reference_links.conversation_log: the
-- append happens inside one statement, server-side.
--
-- The resumes row is upserted on first upload: resumes_shidduchim_id_key is
-- UNIQUE on shidduchim_id (01_tables.sql), so ON CONFLICT is clean, and its
-- DO UPDATE re-reads `files` from the row Postgres has just locked — not a
-- value read into a variable earlier in this function — so two concurrent
-- calls for the same shidduch (or the same single, Story 5.8) can never
-- silently overwrite each other's entry; the second call blocks on the row
-- lock until the first commits, then appends onto what the first one wrote.
-- Never mutates or removes an existing array element. Account-scoped so a
-- file can never be attached to a foreign account's shidduch/single.
-- SECURITY INVOKER so RLS applies.
--
-- Story 5.8 widens this to a single's OWN resume: exactly one of
-- p_shidduchim_id/p_single_id is required (mirrors resumes_owner_check),
-- and the two required-then-defaulted parameters move after the four
-- always-required ones — Postgres requires every parameter with a DEFAULT
-- to follow every parameter without one, regardless of the shape callers
-- actually use (PostgREST/supabase-js always calls by name, never
-- positionally, so this reorder is invisible to the SPA; direct SQL call
-- sites — the paired .sql test suites — must use named notation too).
CREATE OR REPLACE FUNCTION "public"."add_resume_file"(
    "p_path" text,
    "p_filename" text,
    "p_mime_type" text,
    "p_size" bigint,
    "p_shidduchim_id" bigint DEFAULT NULL,
    "p_single_id" bigint DEFAULT NULL
) RETURNS SETOF public.resumes
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

-- Append one photo row to a shidduch's resume (Story 5.4, AC 2). Distinct
-- in shape from add_resume_file above: a photo is a first-class
-- per-photo ROW (RLS enforces at row granularity, AD-1), not an appended
-- entry inside a whole-row-visible jsonb array, so this is a plain INSERT —
-- no ON CONFLICT/upsert shape for the photo itself, because resume_photos
-- carries no unique-per-resume constraint (many photos per resume is the
-- normal case). The parent `resumes` row IS upserted first (the same
-- resumes_shidduchim_id_key uniqueness add_resume_file relies on), because
-- a shidduch may get its first photo before it ever has a resume file.
-- SECURITY INVOKER (no clause = invoker) so RLS applies; account-scoped so
-- a photo can never be attached to a foreign account's shidduch/single.
--
-- Story 5.8 widens this the same way as add_resume_file above: exactly one
-- of p_shidduchim_id/p_single_id, both defaulted and moved after the one
-- always-required parameter (Postgres' default-parameter ordering rule —
-- see that function's own comment).
CREATE OR REPLACE FUNCTION "public"."add_resume_photo"(
    "p_path" text,
    "p_shidduchim_id" bigint DEFAULT NULL,
    "p_single_id" bigint DEFAULT NULL,
    "p_visibility" text DEFAULT 'shared'
) RETURNS SETOF public.resume_photos
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

-- Soft-hide a photo (Story 5.4, AC 2): sets hidden_at and never deletes — a
-- hidden photo is excluded everywhere by a plain `hidden_at is null` filter
-- (PhotoTab.tsx), including in any future share, matching the "never a
-- DELETE" contract this function exists to close off. Account-scoped so a
-- caller can never hide a photo belonging to a foreign account's shidduch.
-- SECURITY INVOKER so RLS applies.
CREATE OR REPLACE FUNCTION "public"."hide_resume_photo"(
    "p_photo_id" bigint
) RETURNS SETOF public.resume_photos
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

-- =====================================================================
-- MyShadchan — Identity matching + References (AD-5, AD-12, AD-13)
-- =====================================================================
-- AD-5: there is exactly ONE account-scoped identity service. Reference
-- dedupe (FR20/FR42), shidduch-suggestion dedupe and date-record dedupe all
-- call match_identity() against identity_signals; nobody writes a bespoke
-- matcher. AD-12: normalization is bilingual and happens ONLY here, in the
-- database — the SPA never normalizes.

-- Canonical text normalizer: strips Hebrew nikud (U+0591-U+05C7), folds Latin
-- diacritics, lowercases, drops punctuation and collapses whitespace. Keeps
-- Hebrew letters (U+05D0-U+05EA) intact. IMMUTABLE so it is safe in indexes
-- and generated values, and so the same input always produces the same key.
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

-- Canonical phone normalizer: digits only, international/trunk prefixes
-- stripped (IL +972, NANP +1, UK +44), so 054-123-4567, +972-54-123-4567 and
-- 0541234567 all compare equal. Returns null for anything too short to be a
-- trustworthy match signal — a half-typed phone must never produce a match.
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

-- Variant-folding name key (NFR-6). Two people spelled "Yitzchak" and "Itzhak",
-- or "Chaim" and "Haim", are the same person; literal string equality would miss
-- them. This produces a comparison skeleton by (1) canonicalizing well-known
-- Hebrew/English given-name variants and nicknames, (2) folding transliteration
-- digraphs (tz/ts -> z, ch/kh -> h, ph -> f, c/q -> k, w -> v), (3) unifying
-- Hebrew final letter forms, and (4) dropping non-initial vowels and doubled
-- letters. The nickname list is deliberately data-shaped and extensible — it
-- covers the common cases, not every case, which is exactly why match_identity()
-- never treats a name key match alone as sufficient evidence.
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

-- Server-set match keys on references (AD-5: the SPA never normalizes).
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

-- Keeps identity_signals in step with references. A reference's school is its
-- corroborating institution signal, so it lands in the shared seminary_norm
-- slot rather than a reference-only column — that is what lets ONE matcher
-- serve references, shidduchim and date records.
-- SECURITY DEFINER: identity_signals is read-only to clients (05_policies.sql)
-- so nobody can poison the matcher by writing their own match keys. The row's
-- own account_id is what is written, so tenant isolation is preserved.
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

-- The second caller of the shared identity service: shidduchim carry the full
-- signal set (name + parents + seminary + shul + location). Age/height are
-- deliberately absent — they are informational, never matching signals (FR11).
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

-- interactions/tasks/identity_signals/entity_files are polymorphic, so no FK
-- cascades them. This trigger IS the cascade: deleting the target removes
-- everything pointing at it, leaving no orphaned candid content, no stale
-- match signal and no dangling file catalog row. The target_type is passed
-- as a trigger argument so one function serves every polymorphic parent.
-- SECURITY DEFINER because identity_signals is not client-writable (see
-- 05_policies.sql) — it still filters on the row's own account_id, so it can
-- never reach across a tenant boundary.
--
-- Story 3.7 (AC 7a): the entity_files delete removes the CATALOG rows only.
-- It does NOT remove the storage objects those rows pointed at — SQL cannot:
-- storage.objects carries its own BEFORE DELETE statement-level trigger that
-- raises unless the Storage API is used, and even with that guard lifted,
-- deleting the row does not reclaim the bytes. Byte cleanup is a
-- `beforeDelete` ResourceCallbacks entry at the dataProvider seam instead
-- (providers/supabase/dataProvider.ts), which reads these rows BEFORE this
-- trigger fires and removes the objects via the Storage API. A parent
-- deleted by any path that skips the SPA's dataProvider (service_role, psql,
-- a future edge function) leaves the rows correctly purged here but the
-- bytes orphaned — a stated, not hidden, limitation (AC 7c).
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

-- Guards that a task always carries a polymorphic target. Redundant with
-- tasks.target_id being not null, but kept as a defense-in-depth guard with a
-- clear error message (supabase/tests/references_entity.sql asserts this
-- function exists with a hardened search_path).
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

-- Story 12.3 (AC-5, AC-6, AC-8): guards that tasks.member_id, when set,
-- names an ACTIVE member of the task's own account_id. NOT SECURITY
-- DEFINER, deliberately — the same split set_interaction_actor_member_id()
-- documents above. Under invoker rights the two base tables' RLS applies,
-- which makes the check stricter, never looser: a foreign members row is
-- invisible to the caller, `not exists` holds, and the statement raises. A
-- service_role writer bypasses RLS and still gets the correct answer,
-- because the predicate is written on real ids, not on auth.uid().
--
-- `before insert or update of member_id, account_id` (04_triggers.sql) —
-- never a bare `update` — so completing or snoozing a task whose assignee
-- has since been archived (AC-6) never re-validates a historical
-- assignment.
CREATE OR REPLACE FUNCTION "public"."validate_task_assignee"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.member_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.account_members am
      join public.members m on m.user_id = am.user_id
    where m.id = new.member_id
      and am.account_id = new.account_id
      and am.status = 'active'
  ) then
    raise exception 'member % is not an active member of account %',
      new.member_id, new.account_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- THE account-scoped identity matcher (AD-5). Returns candidates with a
-- confidence and the deciding facts that produced it — never a bare boolean,
-- and never a decision: the caller's user always confirms or dismisses.
--
-- HARD RULE (AD-5, FR20): a name match is NEVER sufficient on its own. A
-- candidate is returned only when the evidence includes a normalized phone
-- match, or a name match corroborated by at least one non-name signal
-- (parents / seminary-school / shul / location). Name-only similarity returns
-- nothing, because acting on it is exactly the false-merge this design forbids.
--
-- PRV-2: every read is filtered by current_context_id(). Identity is never
-- pooled or matched across accounts, no matter how identical the details look.
CREATE OR REPLACE FUNCTION "public"."match_identity"(
    "p_target_type" "text",
    "p_name_en" "text" DEFAULT NULL,
    "p_name_he" "text" DEFAULT NULL,
    "p_phone" "text" DEFAULT NULL,
    "p_parents" "text" DEFAULT NULL,
    "p_seminary" "text" DEFAULT NULL,
    "p_shul" "text" DEFAULT NULL,
    "p_location" "text" DEFAULT NULL,
    "p_exclude_target_id" bigint DEFAULT NULL
) RETURNS TABLE("target_id" bigint, "confidence" numeric, "deciding_facts" "jsonb")
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

-- Match-on-entry for references (FR20/FR42). A thin, typed caller of the shared
-- match_identity() service: it maps a reference's fields onto the shared signal
-- slots (school -> seminary) and returns candidate cards complete enough to
-- render without a second round-trip. NEVER gated by subscription state — this
-- recognition is free, always (FR42).
CREATE OR REPLACE FUNCTION "public"."match_reference_on_entry"(
    "p_name_en" "text" DEFAULT NULL,
    "p_name_he" "text" DEFAULT NULL,
    "p_phone" "text" DEFAULT NULL,
    "p_school" "text" DEFAULT NULL,
    "p_exclude_id" bigint DEFAULT NULL
) RETURNS TABLE(
    "reference_id" bigint,
    "confidence" numeric,
    "deciding_facts" "jsonb",
    "name_en" "text",
    "name_he" "text",
    "phone" "text",
    "relationship" "text",
    "school" "text",
    "grad_year" integer,
    "linked_shidduchim_count" bigint
)
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

-- The confirm-link half of match-on-entry: the user said "yes, this is the same
-- person", so the new mention becomes another link on the EXISTING reference
-- rather than a duplicate row. Account-scoped on both sides. Idempotent — a
-- second confirm returns the link that already exists instead of duplicating it.
CREATE OR REPLACE FUNCTION "public"."link_reference_to_shidduch"(
    "p_reference_id" bigint,
    "p_shidduchim_id" bigint,
    "p_relationship_override" "text" DEFAULT NULL
) RETURNS SETOF public.reference_links
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

-- The ONE write path for call capture. Both the mid-call capture screen and the
-- AI guided call script call this, so the assistant can never become a second,
-- disconnected data path: they write the same call_status, the same
-- what_they_said, and append to the same conversation_log.
CREATE OR REPLACE FUNCTION "public"."log_reference_call"(
    "p_reference_link_id" bigint,
    "p_call_status" "text" DEFAULT NULL,
    "p_what_they_said" "text" DEFAULT NULL,
    "p_source" "text" DEFAULT 'manual'
) RETURNS SETOF public.reference_links
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

-- Re-points every interaction on one reference_link onto another. This exists
-- because the structural columns of `interactions` (scope, reference_link_id,
-- target_*) are NOT client-writable — otherwise a client could move a candid
-- note onto a different parent and change what it inherits. SECURITY DEFINER so
-- the merge can still do it, but it derives the account from the caller and
-- verifies BOTH links belong to them, so it can only ever shuffle rows inside
-- one account.
CREATE OR REPLACE FUNCTION "public"."rehome_reference_link_interactions"(
    "p_from_link_id" bigint,
    "p_to_link_id" bigint
) RETURNS integer
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

-- Moves a reference's whole timeline onto another reference during a merge.
-- Same reasoning as rehome_reference_link_interactions: target_id is a
-- structural column and therefore not client-writable, so the merge needs a
-- definer path. Both references are verified against the CALLER's account, so
-- this can only ever move rows within one account.
CREATE OR REPLACE FUNCTION "public"."rehome_reference_interactions"(
    "p_from_reference_id" bigint,
    "p_to_reference_id" bigint
) RETURNS integer
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

-- What a merge would do, computed before anything is destroyed. The `collisions`
-- array is the case where both duplicate references hold a link to the SAME
-- shidduch, each with its own call log. The UI must make the user resolve
-- every collision — merge_references() refuses to run otherwise.
CREATE OR REPLACE FUNCTION "public"."preview_reference_merge"(
    "p_loser_id" bigint,
    "p_winner_id" bigint
) RETURNS "jsonb"
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

-- Merge two duplicate references. Everything the loser owns moves to the winner
-- BEFORE the loser row is deleted: links, interactions, tasks. conversation_log
-- lives on the link, so reassigning reference_id carries it forward untouched.
--
-- The collision case (both references linked to the same shidduch) is resolved
-- explicitly by the user via p_resolutions — a jsonb object keyed by
-- shidduchim_id with values 'winner' | 'loser' | 'both'. An unresolved collision
-- RAISES rather than picking a side, because silently discarding one side's
-- what_they_said is exactly the data loss this design refuses to risk. In every
-- resolution the losing side's candid content is preserved as an interaction, so
-- no call log is ever destroyed, only re-filed.
CREATE OR REPLACE FUNCTION "public"."merge_references"(
    "p_loser_id" bigint,
    "p_winner_id" bigint,
    "p_resolutions" "jsonb" DEFAULT '{}'::jsonb
) RETURNS bigint
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

-- =====================================================================
-- MyShadchan — Dedupe "catch" engine (E3, AD-5, FR11)
-- =====================================================================
-- "You've come across this person before." Given one shidduch, returns the
-- prior evidence a shadchan needs to decide whether a suggested person has
-- already been suggested (for ANY single in this family) or already dated. It is
-- the third caller of the shared identity service (AD-5): it reuses
-- match_identity('shidduch', ...) rather than growing a bespoke matcher.
--
-- Two hard rules, inherited from the identity service:
--   * Never merges. It returns evidence with a confidence and the deciding
--     facts; the caller's user always confirms or dismisses. There is no
--     threshold above which anything happens on its own.
--   * Never name-only. A catch always needs a name match plus at least one
--     corroborating non-name signal. Age/height are NEVER matching signals
--     (FR11) -- age is returned only as informational context to DISPLAY, and is
--     never part of the gate.
--
-- Prior dating: date_records is not (yet) wired into identity_signals (that is
-- Epic-4), so there is no shared-store row to match against. Rather than
-- fabricate a dating history or omit it entirely, this matches date_records
-- DIRECTLY with the SAME shared normalizers (normalize_identity_text /
-- identity_name_key), held to the SAME bar as the identity matcher: a name match
-- corroborated by parents / seminary / location. Anything weaker returns no
-- date. STABLE + security invoker, so identity_signals / date_records RLS
-- (account scope, PRV-2) applies to the caller. NEVER gated by AI entitlement.
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

-- =====================================================================
-- MyShadchan — Billing / AI entitlement (E4)
-- =====================================================================
-- THE SINGLE SERVER-AUTHORITATIVE SOURCE OF TRUTH for "may this account spend
-- inference?". The SPA calls it to decide whether to show the research
-- assistant, and — critically — the (future, Epic-10) AI edge functions MUST
-- call this same function before spending a single token of inference. There is
-- no second, client-trusted copy of the decision to drift out of sync.
--
-- WHY IT CANNOT BE BYPASSED FROM THE CLIENT. The answer derives entirely from
-- the `subscription` row, and `subscription` is SELECT-only for authenticated
-- (05_policies.sql / 06_grants.sql): the only writer is service_role. There is
-- no RPC, no policy, and no grant that lets a browser set plan='ai' or
-- status='active'. A modified client can therefore lie to ITSELF about the
-- return value, but the moment real inference is requested the edge function
-- re-runs this function server-side under the user's own JWT and gets the true,
-- unforgeable answer. This is what the retired client-side placeholder
-- (useAiEntitlement's hardcoded `true`) explicitly warned had to happen.
--
-- Single source of truth for the AI tier's monthly resume-parse allowance,
-- read by both ai_entitlement() (the check shown to the client) and
-- claim_ai_parse_attempt() (the atomic reservation, below) so the two can
-- never silently disagree — see Epic 11 Findings 6/7 closure. STABLE, not
-- IMMUTABLE: reserves room for a future per-plan or per-account limit
-- without changing either caller's call shape; today it is a pure constant.
CREATE OR REPLACE FUNCTION "public"."ai_monthly_resume_limit"() RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select 100;
$$;

-- The entitlement DECISION ("is this account, by id, on the paid AI tier and
-- currently active?") reduced to the one number every caller actually needs:
-- 0 for unentitled, ai_monthly_resume_limit() for entitled. Parameterised by
-- account id (not current_context_id()) so it works both for ai_entitlement()
-- (RLS-scoped to the caller's own context) and for claim_ai_parse_attempt()
-- below (SECURITY DEFINER, given an explicit p_account_id by the Worker's
-- service-role client, no JWT/context to derive from). This is what lets
-- claim_ai_parse_attempt() refuse a reservation for an unentitled account
-- WITHOUT re-stating the plan/status formula a second time — Epic 11
-- Findings 6/7 exist precisely because a second, out-of-band copy of an
-- enforcement decision is how it drifts or gets bypassed; this keeps the
-- formula itself in exactly one place.
--
-- STABLE, no SECURITY DEFINER (default invoker): it only reads
-- public.subscription, and every real caller already has the right to see
-- that row (a plain authenticated caller via RLS, scoped to their own
-- account_id — asking about another account's id here simply resolves no
-- row and returns 0, never another tenant's data; or claim_ai_parse_attempt()
-- itself, which is SECURITY DEFINER and so already runs with owner rights,
-- under which RLS does not restrict the table owner).
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

-- STABLE + security invoker (like catch_shidduch): it resolves the account with
-- current_context_id() and reads subscription/ai_usage under the caller's RLS,
-- so it works identically for the SPA (authenticated JWT) and an edge function
-- that forwards the user's JWT. Returns the unentitled default for a caller with
-- no account rather than raising, so the app degrades to the free path.
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

-- Atomically claim (or replay, or refuse) a resume-parse attempt for one
-- (account, inbox item, attachment). SECURITY DEFINER, called ONLY from the
-- Worker's service-role client (EXECUTE revoked from every client role,
-- 06_grants.sql) — never reachable with a caller-supplied JWT, so
-- p_account_id can never be spoofed from the browser. This is the ONE
-- atomic operation that closes Epic 11 Findings 6, 7 and 8 together: it is
-- simultaneously the idempotency check (Finding 8's remaining
-- compare-and-set gap) and the quota reservation (Findings 6/7), so a
-- caller cannot observe "claimed" without the increment already being
-- durably committed, and cannot slip two concurrent claims for the same key
-- or two concurrent over-cap claims for different keys past it.
--
-- Same key, two simultaneous claims: the unique constraint on
-- (account_id, inbox_item_id, attachment_path) lets exactly one INSERT win;
-- the loser raises unique_violation (caught here, never propagated) and
-- gets 'conflict'. Different keys at the cap boundary: the row lock
-- Postgres takes for the ai_usage upsert below serializes concurrent
-- callers against the same (account_id, period) row, so exactly one of two
-- simultaneous callers can observe resumes_parsed < limit become false
-- first — the other's increment is guaranteed to see the first's committed
-- value before evaluating its own WHERE.
--
-- Recovery from an abandoned 'in_progress' row (Worker died, model timed
-- out) is lazy reclaim, not a scheduled reaper: a subsequent claim() call
-- for the same key locks the row and checks started_at; if older than
-- c_stale_after, it silently resumes the SAME reservation (started_at
-- refreshed, no re-increment — the original increment is still validly
-- held) instead of blocking forever. A 'failed' row (its reservation
-- already released) goes through the full atomic reserve-or-refuse path
-- again, same as a brand-new key.
--
-- Fencing token (review Finding C2): every reclaim — of a stale
-- 'in_progress' row OR a 'failed' one — bumps `generation`, and the new
-- value is returned to the caller alongside `attempt_id`. The Worker MUST
-- carry that generation into its later confirm_ai_parse_attempt() /
-- release_ai_parse_attempt() call. Those two functions require the
-- generation they are given to still match the row's CURRENT value; if it
-- does not (a newer generation already reclaimed this row), the call is a
-- benign no-op ('superseded'), never an exception. Without this, an
-- original request whose own extractor call outlives c_stale_after — and
-- Postgres's row lock on the reclaiming UPDATE/SELECT-FOR-UPDATE is what
-- makes this safe under REAL concurrency, not merely when called in a
-- chosen order — could otherwise still confirm/release the SAME row a
-- reclaiming generation has already taken over: forging a stale result
-- over a newer one's real result, or releasing (decrementing ai_usage for)
-- a reservation a newer generation is still legitimately holding. Verified
-- under two real overlapping sessions in ai_parse_quota.test.ts.
--
-- v_limit is entitlement-aware (ai_resume_limit_for_account(), above) — an
-- unentitled account (no subscription row, free plan, or lapsed status)
-- resolves to a limit of 0, so a fresh claim for it returns 'cap_reached'
-- immediately, never 'claimed'. This does not depend on the Worker's own
-- advisory pre-check having run correctly first (Epic 11 review, Finding 6
-- closure: the Worker-side pre-check was DELETED — this RPC is now the SOLE
-- cap gate. Read against its own branches: the 'replay' branch below and the
-- stale-in_progress reclaim branch both return before v_limit is ever
-- consulted, so a replay and a stale reclaim both succeed at ANY usage
-- level, including exactly at the cap — only a genuinely NEW reservation
-- (the `v_needs_reservation` path) ever checks it).
--
-- p_current_result_schema_version (Finding 12 closure): the Worker's own
-- CURRENT_PARSE_RESULT_SCHEMA_VERSION constant (parsedResumeDraft.ts). A
-- 'completed' row whose result_schema_version is BEHIND this value is not
-- served as a replay — it is flipped back to a free re-claim instead (see
-- the 'completed' branch below), exactly like reclaiming an abandoned
-- in_progress row, because the account already paid once for this document
-- and a re-parse forced by OUR OWN contract change must not charge it again.
--
-- Opportunistic reaper (Finding 10 closure): before doing its own main job,
-- every call sweeps and refunds THIS SAME ACCOUNT's own other rows that have
-- sat 'in_progress' for 3x the ordinary staleness window (c_reap_after,
-- below) — no scheduled-job (pg_cron) infrastructure exists in this repo
-- (see public.signup_intents / check_signup_age() for the established
-- precedent of piggybacking cleanup on the one code path that already
-- touches the relevant row); this piggybacks on the one code path that
-- already touches this account's ai_usage row on every /parse call instead.
-- A row this stale can only be genuinely abandoned (a crashed/evicted Worker
-- that never reached confirm or release) — resumeExtractor.ts's own fetch
-- timeout (GEMINI_EXTRACT_TIMEOUT_MS) keeps any live request well under
-- c_stale_after, let alone 3x it. The row currently being claimed is
-- explicitly excluded from this sweep: it is handled for free by the
-- ordinary stale-in_progress reclaim branch below (a resume, not a
-- refund-then-respend), which is what lets that branch succeed even at the
-- account's cap — sweeping it here first would refund then immediately
-- re-spend it through the capped reservation path, defeating that guarantee.
--
-- Returns jsonb: {"outcome": "claimed", "attempt_id": <id>, "generation": <n>}
--              | {"outcome": "replay", "attempt_id": <id>, "result": <jsonb>, "result_schema_version": <n>}
--              | {"outcome": "conflict", "attempt_id": <id>}
--              | {"outcome": "cap_reached"}
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

-- Mark a claimed attempt completed and cache its result for future
-- idempotent replay. Does NOT touch ai_usage — the spend already happened,
-- atomically, inside claim_ai_parse_attempt(). Idempotent: a retry against
-- an already-'completed' row FROM THE SAME GENERATION (e.g. the Worker's own
-- network retry after a lost response) is a no-op success, not an error.
--
-- Fencing token (review Finding C2): p_generation MUST match the row's
-- current `generation` for this call to actually mutate anything. A caller
-- from an OLDER, superseded generation (claim_ai_parse_attempt()'s own
-- comment explains how a generation becomes superseded) gets 'superseded'
-- back — a benign no-op, never an exception — instead of overwriting a
-- newer generation's real result with a stale one, or (worse, if it somehow
-- raced ahead) getting confused with a genuinely wrong attempt/account pair.
-- Only a truly unknown (id, account_id) pair — never issued by
-- claim_ai_parse_attempt() for this account at all — still raises; that
-- remains a hard error, not a benign outcome, exactly as before.
--
-- p_result_schema_version (Finding 12 closure): the Worker's own
-- CURRENT_PARSE_RESULT_SCHEMA_VERSION constant, stamped onto the row
-- alongside its result so a future claim can tell a stale-contract replay
-- from a current one (see claim_ai_parse_attempt() above).
--
-- superseded (Finding 8 closure): the response now tells the superseded
-- caller what actually happened to the WINNING generation instead of a bare
-- 'superseded'. If the winner has already completed, its result/version ride
-- along so the caller can serve the SAME durable answer instead of its own,
-- never-replayable draft — both concurrent HTTP responses then converge on
-- the one answer future replays will actually return. If the winner is still
-- working, there is nothing final to offer yet and only `status` comes back.
--
-- Returns jsonb: {"outcome": "applied"}
--              | {"outcome": "superseded", "status": "completed", "result": <jsonb>, "result_schema_version": <n>}
--              | {"outcome": "superseded", "status": "in_progress" | "failed"}
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

-- Release a claimed attempt that failed before producing a draft (extractor
-- error, oversized/undownloadable attachment, etc.) — marks it 'failed' and
-- atomically gives back the reservation it held, floored at zero. Idempotent
-- for the same reason as confirm_ai_parse_attempt() above, and gated by the
-- SAME fencing token: p_generation must match the row's current value, or
-- this is a benign 'superseded' no-op rather than an exception, and — the
-- specific defect this closes — rather than decrementing ai_usage for a
-- reservation a newer generation is still legitimately holding.
--
-- Returns jsonb: {"outcome": "applied"} | {"outcome": "superseded"}
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

-- Force-reclaim a 'completed' parse attempt whose cached result failed the
-- Worker's OWN Zod validation despite matching the current
-- result_schema_version (Epic 11 Finding 12 closure) — genuine data
-- corruption (a manual edit, a bug), not the version drift
-- claim_ai_parse_attempt() already catches for free by comparing
-- result_schema_version. SECURITY DEFINER, service_role-only
-- (06_grants.sql): reachable from the browser it could force-reclaim ANY
-- account's row, same reasoning as claim/confirm/release above. Does NOT
-- touch ai_usage — this is the platform's own bug/corruption, not a cost
-- the account should bear, mirroring the version-mismatch free-reclaim
-- branch in claim_ai_parse_attempt() above. Bumps `generation` like every
-- other reclaim path, so a slow, still-live caller from the pre-reclaim
-- generation cannot race the fresh attempt this unlocks.
--
-- Returns jsonb: {"outcome": "reclaimed", "generation": <n>} | {"outcome": "not_reclaimable"}
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

-- Daily retention sweep (Epic 11 Finding 11 closure): deletes any
-- ai_parse_attempts row older than a flat 30-day TTL, regardless of status.
-- The cached `result` exists only to make a genuine RETRY free; the
-- realistic retry window (a user re-opening an unfinished resolve dialog) is
-- hours to a couple of weeks, not months — 30 days is generous margin above
-- that window while still bounding indefinite PII retention (names,
-- parents, schools, synagogues, locations, reference names/phones) to a
-- finite lifetime. Deliberately NOT the same window as c_stale_after (5
-- minutes, above) or c_reap_after (15 minutes, above): those detect an
-- abandoned reservation; this one bounds how long a completed cache entry's
-- personal data may live at all. Swept by workers/cron's scheduled()
-- (event.cron-gated, see workers/cron/wrangler.toml), not by anything in
-- this transaction's own callers. SECURITY DEFINER, service_role-only
-- (06_grants.sql) — never reachable from a caller-supplied JWT. Returns only
-- the deleted row COUNT so the caller's log line stays content-free (never
-- which rows, whose account, or what they held) — see workers/shared's
-- redaction discipline (Epic 11 Finding 5).
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

-- =====================================================================
-- MyShadchan — Communication (Epic 7: threads, AD-1, AD-3, AD-20, AD-22)
-- =====================================================================

-- Story 7.1 (AC-5, AC-6): a connection's household side must actually be a
-- household-kind account and its shadchanus side a shadchanus-kind one —
-- enforced by Postgres, not by convention (mirrors enforce_household_scope()
-- above). NOT SECURITY DEFINER: it only reads accounts.kind for the two
-- rows being connected, which `connections` SELECT policy already lets a
-- caller on either side read; and this table has no client INSERT path
-- anyway (06_grants.sql) — only service_role ever fires this trigger.
-- Named `enforce_*`/wired as `validate_connections_kinds` so it sorts after
-- any future `set_*` trigger were one ever added to this table (04_triggers.sql's
-- alphabetical BEFORE-trigger-order warning) — none exists today.
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

-- Story 8.5 review fix (F2 — BLOCKING, contract §8 rule 3): the purge
-- trigger the original Task 8 comment (01_tables.sql) argued connections
-- could never need, on the premise that "connections rows are never
-- hard-deleted". That premise is false: connections_household_account_id_fkey
-- / connections_shadchanus_account_id_fkey (01_tables.sql) are both ON
-- DELETE CASCADE, and "Accounts writable by non-single members"
-- (05_policies.sql) is a FOR ALL policy granting DELETE on accounts to
-- authenticated — so an ordinary household (or shadchanus) member deleting
-- their OWN account hard-deletes every connections row it is a party to,
-- with no service-role or admin action involved. Proven live: deleting a
-- household's account cascades its connections row away while the
-- shadchan's OWN target_type='connection' tasks/interactions (account-scoped
-- to the shadchan's account, not the deleted one — 05_policies.sql) survive,
-- now pointing at a target_id no row will ever satisfy again. That is
-- exactly the dangling-reference class purge_polymorphic_dependents() exists
-- to prevent.
--
-- Not a sixth TG_ARGV[0] branch of purge_polymorphic_dependents() itself:
-- that function's every other caller (references/singles/shadchanim/
-- shidduchim) deletes by `account_id = old.account_id and target_type =
-- ... and target_id = old.id` because each row has exactly one owning
-- account. `public.connections` has no account_id column at all — it names
-- its two sides `household_account_id`/`shadchanus_account_id` — and either
-- side may independently hold its OWN private task/interaction about the
-- SAME connection (05_policies.sql's own-account-scoped `connection`
-- branch), so there is no single `old.<column>` to filter by. Purging by
-- `target_id` alone is correct and sufficient here: a connection's id is
-- unique across the whole table, so `target_type = 'connection' and
-- target_id = old.id` can only ever match rows about THIS connection,
-- whichever side holds them — no account_id predicate is needed to avoid
-- over-deleting.
--
-- entity_files is purged too, for parity with the other three
-- ENTITY_TARGET_TYPES purge callers (contract §8 rule 1) even though no
-- story wires a connection Files tab today (01_tables.sql's own comment on
-- entity_files_target_type_check) — the CHECK constraint makes the row
-- legal via any API client, not only the SPA's UI. Storage-object cleanup
-- for a connection-targeted file is NOT attempted here, matching the
-- existing, named limitation on every other purge_* path deleted outside
-- the SPA's own dataProvider (that file's own comment, "AC 7c"): this
-- trigger only ever fires via a cascaded accounts delete, a path the SPA's
-- entity_files cleanup hook (providers/supabase/dataProvider.ts) never sees.
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

-- Story 7.1 (AC-5, AC-7): server-sets threads.account_id from the caller's
-- active context ONLY when BOTH scope columns are null — never overwrites
-- a non-null value (a connection-scoped row, seeded by service_role until
-- Story 7.4, is never touched) and never sets both. Reuses
-- current_context_id() — never a re-resolved inline query, per this story's
-- Dev Notes.
--
-- created_by_member_id is UNCONDITIONALLY overwritten with
-- current_member_id() — the review fix for Story 7.1's F1, exactly like
-- set_entity_files_uploaded_by() above (Story 3.7's F6, the identical bug
-- shape). The original IF-NULL default was a decoy: `authenticated` holds a
-- whole-table INSERT grant on threads (06_grants.sql, prior to this fix),
-- and neither the INSERT policy nor any constraint touched
-- created_by_member_id, so a client-supplied value was silently ACCEPTED,
-- not merely redundant with what the trigger would have set — proved live
-- by inserting a row attributed to a member of a completely different
-- account. create_thread() (02_functions.sql below) still passes its own
-- resolved member id explicitly; this trigger now recomputes the identical
-- value itself rather than trusting the caller's insert list, so the two
-- can never diverge.
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

-- Story 7.1 (AC-2, AC-5): a thread_participants row always lands on the
-- SAME axis as its parent thread — copying only account_id (the older
-- single-axis pattern other tables use) is the bug that would make every
-- connection-scoped participant row violate its own XOR check. Never
-- trusts a client-sent scope column: both are copied from the parent
-- thread, never taken from new.account_id/new.connection_id themselves.
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

-- Story 7.1 (AC-4, AC-5): same parent-copy shape as
-- set_thread_participant_defaults() above, plus server-stamps
-- sender_member_id — UNCONDITIONALLY, exactly like
-- set_interaction_actor_member_id()'s shape, NOT the IF-NULL shape this
-- function originally shipped with. The review fix for Story 7.1's F1:
-- `authenticated` holds a whole-table INSERT grant on messages, and neither
-- the INSERT policy nor any constraint touched sender_member_id, so a
-- listed participant of a thread could post attributing the message to a
-- DIFFERENT member — even one of a completely different account — and the
-- row would persist with the forged sender_member_id. Proved live on both
-- axes before this fix. The FakeRest mirror
-- (providers/fakerest/internal/threads.ts) already stamped the sender
-- unconditionally; this closes the AD-10 parity gap between the two
-- providers, not just the security hole.
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

-- Story 7.4 (AC-1, AC-4, AC-6): the ONE authority for "is the caller's
-- ACTIVE context one of the two parties to this connection, and is the
-- connection itself currently in force" — written once (Task 1) and called
-- from create_thread(), thread_is_readable() and the two client-reachable
-- INSERT policies (thread_participants, messages) below. Three inline
-- copies of the same `exists` is exactly the drift surface 7.1/7.3 avoided
-- by centralizing thread_is_readable() itself; this function is that same
-- discipline applied to the connection axis.
--
-- STABLE SECURITY DEFINER for the same reason as current_context_id()/
-- current_member_id() above: RLS policies call this directly (evaluated as
-- `authenticated`, 06_grants.sql grants it there), and it must resolve
-- current_context_id() itself rather than trust a caller-supplied account
-- id.
--
-- `status = 'accepted'` names the live state explicitly rather than
-- `<> 'ended'`: Story 7.1's `connections_status_check` allows only these two
-- values today, so the two reads are equivalent now, but Epic 8 Story 8.2
-- adds propose/accept metadata to this table WITHOUT ever adding a third
-- live status (AD-20: a connection exists only after acceptance) — so this
-- still reads correctly once that story lands.
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

-- Story 7.4 (Task 2): the visibility decision, extracted out of
-- thread_is_readable() so it is written ONCE and shared by both scope axes
-- rather than duplicated per branch — exactly the shape Task 2 asks for.
-- Deliberately carries NO scope gate of its own (no account/connection
-- membership check): thread_is_readable() below always calls this AFTER its
-- own scope gate has already passed, and this function trusts that. Because
-- of that, it must NEVER be reachable directly by `authenticated` — see
-- 06_grants.sql, which revokes it from every client role and grants it only
-- to service_role, mirroring activate_context_for()'s posture above. A
-- direct RPC to this function would let any signed-in caller probe an
-- arbitrary thread id's open/private visibility without ever passing the
-- scope check thread_is_readable() enforces.
--
-- AC-9: for a `single`, a `subject_type = 'shidduch'` thread is readable
-- ONLY when the subject shidduch satisfies Story 6.2's shipped three-clause
-- test verbatim in shape (05_policies.sql:352-367) — visibility = 'shared'
-- AND is_single_visible_state(pipeline_state) AND the row's single_id
-- resolves to the caller's OWN singles row. Reusing one clause of that test
-- (e.g. the pipeline state alone) is a leak in any household with two
-- singles or one using 'private_parent' visibility — this is the composed
-- dignity floor, not a re-derivation of it. AC-5 requires this SAME test to
-- keep applying, unchanged in shape, across the connection axis too — there
-- is no shadchanus-side `single` case (a `single`-role membership can only
-- exist on a household-kind account, Story 2.2's role/kind trigger), so
-- this branch needs no axis-specific code at all to satisfy AC-5.
--
-- Story 7.3 (AC-2, AC-3): `visibility = 'private'` now closes BOTH readers
-- Story 7.1/7.2's own review findings (F1.5, re-widened by 7.2's F1)
-- flagged as open: a same-account non-participant (e.g. a `helper`) and a
-- `single` participant reading a private thread as if it were open. The
-- private branch below is evaluated BEFORE the single's dignity-floor
-- branch and, when it fires, is the WHOLE answer — never re-narrowed by
-- role, `parent_admin` included (AD-22 resolution rule 1: private beats
-- scope, overriding AD-1's general account read outright). It deliberately
-- does NOT also require the AC-9 shidduch-visibility test: a single
-- deliberately added to a private thread about a shidduch they could not
-- otherwise see reads it anyway, because the participant list IS the human
-- consent decision (Dev Notes, "Why private does not re-apply the single
-- gate" — and see that section's own scoping proof, AC-6, for why this is
-- not a back door: the carve-out is the thread and nothing else).
-- `CommunicationSection.tsx` still disables the account-default "Private"
-- radio as of this diff — re-enabling that UI is a follow-up outside this
-- story's declared file set, not a gap in this function.
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

-- Story 7.1 (AC-1, AC-9)/Story 7.3 (AC-2, AC-3, AC-4, AC-6, AC-7)/Story 7.4
-- (AC-1, AC-4, AC-5, AC-9): the ONE authority every Epic 7 RLS policy calls
-- — exactly as is_single_visible_state() is the one authority for its own
-- axis. Extending this ONE function is why Story 7.3's entire enforcement
-- change was a single `CREATE OR REPLACE FUNCTION` rather than three edited
-- policies that could drift (Dev Notes, "Why extending one function is
-- safer than editing three policies").
--
-- Story 7.4 v3 restructures the body into two parts, so the open/private
-- decision stays written EXACTLY ONCE across both axes (Task 2):
--   1. The SCOPE GATE below — is the caller even a party to this thread's
--      own scope at all. Replaces the 7.1 line that returned `false`
--      unconditionally for any connection-scoped thread; that line's
--      removal is a PURE WIDENING (AC-4's own note) — nothing that was
--      previously readable changes, because nothing on the connection axis
--      was ever readable before this story.
--   2. thread_visibility_permits() above — the identical open/private/
--      dignity-floor resolution for whichever axis passed the gate.
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

-- Story 7.1 (AC-1, AC-2, AC-7)/Story 7.4 (AC-1, AC-2, AC-3, AC-7): the SOLE
-- creation path for a thread and its initial participants together (mirrors
-- create_shidduch()'s "one creation path" precedent, AD-4) — the SPA never
-- calls dataProvider.create("threads", …) directly. SECURITY DEFINER so its
-- inserts are unaffected by the participant-gated INSERT policies
-- (05_policies.sql) — `postgres` (the owner) carries BYPASSRLS, so this is
-- unaffected by FORCE ROW LEVEL SECURITY either (Task 5's evidence).
--
-- Story 7.4 (Task 3) adds `p_connection_id`, appended as a fifth, defaulted
-- parameter — a NEW signature for Postgres's own overload-resolution
-- purposes, since functions are identified by name + parameter TYPES, never
-- by name + defaults. The migration that ships this DROPs the old 4-argument
-- signature explicitly (and re-issues its grants under the new signature) —
-- leaving both would make every 4-argument call site ambiguous between "the
-- old exact match" and "the new one with a default filled in", raising
-- 42725 (`function is not unique`) on every existing caller. See this
-- story's migration file for the DROP.
--
-- AD-20: a connection is chosen by the PARAMETER'S PRESENCE, not layered on
-- top of the account default — supplying `p_connection_id` sets
-- `connection_id` and leaves `account_id` null; omitting it is the
-- unchanged 7.1/7.2 account-scoped path.
--
-- Story 7.2 (AC-3, AC-4): when p_visibility is omitted, the new thread's
-- visibility resolves from the OWNING side's account's
-- accounts.default_thread_visibility — the caller's own account on the
-- account axis (unchanged), the connection's `household_account_id` on the
-- connection axis (AC-7: FR99 gives FAMILIES the default posture, and the
-- household is the only family in the pair; the shadchanus account's own
-- setting is never consulted). An explicit p_visibility always wins over
-- either default (validated against p_visibility itself, BEFORE the
-- coalesce, so an invalid explicit argument still raises rather than
-- silently falling through to a default — always valid, per its own CHECK
-- constraint).
CREATE OR REPLACE FUNCTION "public"."create_thread"(
    "p_subject_type" text,
    "p_subject_id" bigint DEFAULT NULL,
    "p_participant_member_ids" bigint[] DEFAULT '{}',
    "p_visibility" text DEFAULT NULL,
    "p_connection_id" bigint DEFAULT NULL
) RETURNS public.threads
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

-- Story 7.3 (AC-1, AC-4, AC-8): the ONLY write path for `threads.visibility`
-- after creation — `authenticated` holds no table-level UPDATE grant on
-- `threads` at all (06_grants.sql), matching 7.1's "no UPDATE grant, no
-- UPDATE policy" decision for the table. If that ever changed, this whole
-- story would be one `dataProvider.update("threads", …)` away from
-- bypassed.
--
-- "By agreement" (FR97) means ANY current thread_participants member, not
-- only the thread's creator — checked below against
-- `public.current_member_id()`, never `created_by_member_id` (Dev Notes,
-- "Why any participant, not just the creator, can flip visibility"). The
-- symmetric consequence is deliberate: whoever can lock it can also unlock
-- it.
--
-- Two refusals, two distinct SQLSTATEs, checked in order:
--   1. `p_visibility` is not one of the two legal values -> 22023
--      (invalid_parameter_value). Checked FIRST so a garbage argument never
--      even reaches the readability/participation checks.
--   2. the caller may not act on this thread at all -> 42501
--      (insufficient_privilege). This single code covers BOTH remaining
--      requirements — `thread_is_readable(p_thread_id)` and "the caller is
--      a listed thread_participants member" — because for a `private`
--      thread the two are the same test by construction
--      (thread_is_readable()'s own private branch), and because Task 2
--      names them as ONE compound "may this caller touch this thread"
--      refusal, not three. Requiring `thread_is_readable()` FIRST closed
--      AC-8 (Story 7.1) with no connection-specific code at all: that
--      story's function returned false for EVERY connection-scoped thread
--      unconditionally, so a service-role-seeded connection thread was
--      refused here for free, even naming a real thread_participants row
--      for the caller. Story 7.4 widens `thread_is_readable()` to admit a
--      real participant of an ACTIVE, accepted connection — this RPC
--      follows that widening without its own edit, so the SAME caller can
--      now flip a connection-scoped thread's visibility once the
--      connection admits them (threads_entity.sql's own AC-8-era assertion
--      is updated in place for this, not left asserting the pre-7.4
--      unconditional denial). The SEPARATE participant check below is still
--      required on an `open` thread: `thread_is_readable()` alone would
--      admit any same-scope member, and AC-8 says a non-participant may not
--      flip visibility on a thread they are not in, open or private —
--      unchanged by which axis the thread sits on.
CREATE OR REPLACE FUNCTION "public"."set_thread_visibility"("p_thread_id" bigint, "p_visibility" text) RETURNS public.threads
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

-- =====================================================================
-- MyShadchan — Communication (Epic 7 Story 7.5: notification delivery)
-- =====================================================================
--
-- Story 7.5 (AC-3, AC-4, AC-5, AC-6, AC-7, AC-8): fires AFTER INSERT on
-- messages (04_triggers.sql) and queues one message_notifications row per
-- OTHER thread participant per deliverable channel. SECURITY DEFINER because
-- an ordinary message INSERT runs as `authenticated` (05_policies.sql's
-- "Messages insertable by an existing participant" policy), which holds no
-- grant on message_notifications at all (AC-11) and no read access to every
-- OTHER participant's account_members/members rows this resolution needs.
--
-- `is distinct from`, not `<>` (AC-7): sender_member_id is nullable
-- (messages_sender_member_id_fkey is ON DELETE SET NULL), and
-- `member_id <> NULL` is never true for any row, which would silently queue
-- NOTHING for a message whose sender member has since been deleted.
--
-- Email resolution happens HERE, not in the Worker (AC-10): the `auth` schema
-- is not exposed through PostgREST, so the account_members.user_id ->
-- auth.uid() linkage can only be walked from inside Postgres. The join
-- target is public.members (NOT auth.users) via members.user_id, which is
-- uniquely indexed (uq__members__user_id, 01_tables.sql).
--
-- AC-4's skipped/failed split (adopting Story 12.2's F2 ruling): a NULL
-- account_members.user_id is an invited-but-not-accepted membership —
-- deliberate, `skipped`, never a failure. A non-null user_id that resolves to
-- no live public.members row, or to a disabled one, settles `failed` with an
-- explanatory error. Treating the first case as `failed` would drive a
-- permanent error state on a perfectly normal household.
--
-- AC-5: a push row is queued only when the recipient holds at least one
-- push_subscriptions row — no dead letter for a member who never opted in.
--
-- `on conflict (message_id, recipient_member_id, channel) do nothing` on
-- every insert makes the whole fan-out idempotent under any future re-run or
-- retry of this trigger.
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

-- Story 7.5 (AC-1, AC-2): the ONLY write path for
-- thread_participants.last_read_at — `authenticated` holds no UPDATE grant
-- on thread_participants at all (06_grants.sql). The `current_member_id()`
-- predicate IS the entire authorization check: by construction it can only
-- ever match the CALLER's own membership row in their currently active
-- context, so a caller with no matching participant row (someone else's
-- thread, or a thread they are not in) updates zero rows rather than
-- raising — AC-2's falsifiable check asserts this by row count, not by a
-- raised error.
CREATE OR REPLACE FUNCTION "public"."mark_thread_read"("p_thread_id" bigint) RETURNS public.thread_participants
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

-- Story 7.5 (AC-9, AC-10): the claim-then-return step of the claim/dispatch/
-- settle pattern (Dev Notes, "The claim-then-dispatch pattern" — the CTE
-- below is that pattern verbatim, schema-qualified for `search_path ''`).
-- Ships as a function, not a view, because PostgREST cannot express `for
-- update skip locked` — the one thing that makes two overlapping sweeps (the
-- Worker's `scheduled()` handler firing again before a slow run finishes)
-- claim disjoint rows instead of double-sending. The join to
-- messages/threads is what lets the Worker satisfy AC-10 (no `.from(...)`
-- anywhere in its files) with this single RPC call and no second lookup.
--
-- Review fix (Story 7.5 F4): `push_subscriptions` is a per-row correlated
-- `jsonb_agg` of the recipient's own rows, populated only for
-- `channel = 'push'`. Before
-- this fix the function returned no subscription data at all for a push
-- row — AC-10 forbids a Worker `.from("push_subscriptions")` read, and
-- nothing else supplied one, so `sendWebPush()` could never be given a
-- subscription to send to; the read side of push delivery did not exist.
-- NULL (not an empty array) both for an `email` row and for a `push` row
-- whose subscriptions have since all been removed — either way there is
-- nothing to send, and the Worker's dispatch logic (outside this file's
-- ownership) settles that how it chooses.
CREATE OR REPLACE FUNCTION "public"."claim_message_notifications"("p_limit" integer) RETURNS TABLE("id" bigint, "channel" text, "recipient_member_id" bigint, "recipient_email" text, "thread_id" bigint, "message_body" text, "subject_type" text, "subject_id" bigint, "push_subscriptions" jsonb)
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

-- Story 7.5 (AC-9): mirrors Story 12.2's settle_task_notification() shape.
-- Rejects any status outside the three terminal states a settle call may
-- report; updates ONLY rows currently `sending`, so a late duplicate settle
-- (the Worker retrying after a timeout whose original call actually
-- succeeded) can never resurrect an already-finished row. `p_error`, when
-- given, is the transport's own raw error string — unlike Story 12.2's
-- cron_heartbeat.last_error, this column is on a row NO client can ever read
-- (AC-11), so it carries no bounded-code requirement.
CREATE OR REPLACE FUNCTION "public"."settle_message_notification"("p_id" bigint, "p_status" text, "p_error" text DEFAULT NULL::text) RETURNS void
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

-- Story 7.5 (AC-10, Task 6): the sweep's self-healing path for a `410 Gone`/
-- `404` response from a push service — without this the Worker would need a
-- direct `.from("push_subscriptions")` delete, which AC-10 forbids.
-- service_role only: a client deletes its OWN subscription through the
-- ordinary push_subscriptions RLS policy instead (AC-12), never by endpoint
-- alone.
CREATE OR REPLACE FUNCTION "public"."delete_push_subscription_by_endpoint"("p_endpoint" text) RETURNS void
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint;
end;
$$;

-- =====================================================================
-- MyShadchan — Shadchan Context (Epic 8 Story 8.2: consent-based connection)
-- =====================================================================
--
-- 7.4 shipped `connections` read-only to `authenticated` — no INSERT/UPDATE
-- grant, no write policy — precisely so a client cannot self-grant a
-- connection (that story's own Dev Notes walk the attack). This story keeps
-- that posture and extends it to `connection_invites`: a SECURITY INVOKER
-- function cannot write either table (refused at the grant, before RLS is
-- even consulted), so every writer below is SECURITY DEFINER with an
-- explicit active-membership check, following the handle_new_user()/
-- accept_invite() precedent above. accept_connection_invite() additionally
-- writes a shadchanim row into the HOUSEHOLD's account while the acceptor
-- may be the shadchan — a cross-account write only a definer function can
-- make.

-- Story 8.2 (AC-1, AC-2): starts the consent workflow. Caller must be an
-- active member of their own current context — either kind: a shadchanus
-- account invites a household exactly the same way a household invites a
-- shadchan. Returns the RAW token once; only its SHA-256 digest is ever
-- stored (01_tables.sql's own comment on connection_invites explains why —
-- unlike Story 2.7's stored-raw-uuid invites.token, a connection invite
-- crosses the tenant boundary, so a read of this table must never yield a
-- usable token).
CREATE OR REPLACE FUNCTION "public"."create_connection_invite"() RETURNS text
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

-- Story 8.2 (AC-2, AC-6): withdraws an outstanding invite before it is
-- accepted. Caller's ACTIVE CONTEXT must be the INVITING account — the same
-- "active member of current_context_id()" idiom create_connection_invite()
-- uses just above (the invite's own `inviter_account_id` is always set from
-- that same value at creation), and the same scope the invite's own SELECT
-- policy uses (05_policies.sql), so a non-issuer sees "not found", never a
-- distinct "not yours" error — mirrors revoke_invite()'s own
-- account-boundary shape (Story 2.8) above.
--
-- Review finding F5 (fix): this was "any active membership of
-- inviter_account_id", which let a caller acting under a DIFFERENT active
-- context revoke an invite belonging to an account they merely also hold a
-- membership in — a permission check disagreeing with every sibling
-- function's own idiom, and with the FakeRest mirror
-- (fakerest/internal/connections.ts's revokeConnectionInvite(), which
-- already required the caller's active context to match). Tightened to
-- match both.
CREATE OR REPLACE FUNCTION "public"."revoke_connection_invite"("p_invite_id" bigint) RETURNS void
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

-- Story 8.2 (Task 3): the acceptor has no SELECT path to connection_invites
-- at all (05_policies.sql scopes reads to the issuer only), so this is the
-- one purpose-built read letting the accept screen show "You've been
-- invited by The Klein Family" before the user commits. Returns an EMPTY
-- SET — never an error, never a row — for an unknown, expired or
-- already-consumed token: mirrors get_invite_preview()'s enumeration-safety
-- intent (2.7), but stricter — even "found but unusable" folds into "not
-- open" rather than surfacing a computed status a caller could probe with.
-- Requires only an authenticated caller (the grant, 06_grants.sql) — no
-- active-membership check of its own, since the accept step right after
-- this one is what actually needs one.
CREATE OR REPLACE FUNCTION "public"."preview_connection_invite"("p_token" text) RETURNS TABLE("inviter_name" text, "inviter_kind" text, "status" text, "expires_at" timestamp with time zone)
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

-- Story 8.2 (AC-1, AC-3, AC-4, AC-6): the one place a `connections` row is
-- ever created. Steps mirror the story's own numbered spec exactly:
--   1. resolve + lock the invite (must be pending, unexpired) — the row
--      lock plus the re-checked status on the UPDATE at the bottom closes
--      the double-accept race (AC-6 idempotency), the same shape
--      accept_invite()'s own comment (above) explains for 2.7's invites.
--   2. the caller's active context must be the OPPOSITE kind (AC-4) — a
--      household can only ever connect to a shadchanus context, never
--      another household (or vice versa).
--   3. resolve which id is which side.
--   4. insert the connections row.
--   5. insert the household's own book entry — what makes the shadchan
--      appear in Shadchan 360 (Story 5.9) from the moment of connecting.
--   6. burn the invite.
CREATE OR REPLACE FUNCTION "public"."accept_connection_invite"("p_token" text) RETURNS public.connections
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

-- Story 8.2 (AC-3): either party ends an accepted connection. Immediate and
-- irreversible for THIS row (this story's Dev Notes, "What ending does and
-- does not do") — a later reconnection is a new invite/accept cycle
-- producing a new row, which connections_live_pair_idx (01_tables.sql)
-- permits once this one is ended.
--
-- Review finding F4 (fix): the caller's ACTIVE CONTEXT must itself be one of
-- the two parties, and `ended_by_account_id` stamps that SAME value — one
-- check, one value, so the stamped id can never be a third account the
-- caller merely happens to also hold a membership in under a different
-- active context. The original shape checked "any active membership of
-- either party" but stamped `current_context_id()` — two different notions
-- of "who is acting" in one statement — and was proven to let a user whose
-- active context is shadchanus S2 (while also an active member of household
-- A) end the A<->S connection and have the row record
-- `ended_by_account_id = S2`, an account with no relationship to the
-- connection at all. This also brings the check back in line with every
-- sibling writer's "active member of current_context_id()" idiom
-- (create_connection_invite()/revoke_connection_invite() above) and with
-- the FakeRest mirror (fakerest/internal/connections.ts's endConnection(),
-- which already required this).
CREATE OR REPLACE FUNCTION "public"."end_connection"("p_connection_id" bigint) RETURNS public.connections
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

-- =====================================================================
-- MyShadchan — Shadchan Context (Epic 8 Story 8.3: in-platform redting)
-- =====================================================================
--
-- AD-4 requires ONE createSuggestion() service as the sole INSERT path into
-- shidduchim — already public.create_shidduch() above, which derives
-- account_id from the CALLER'S OWN current_context_id(). A connected
-- shadchan's active context is their own shadchanus account, never the
-- household's, so this function does not extend create_shidduch() with a
-- foreign target account (that would mean trusting a client-supplied
-- account id, or duplicating create_shidduch()'s whole validation surface
-- behind a role branch — exactly the divergent second path AD-4 forbids).
--
-- Resolution (story's Dev Notes, "The key design decision"): a shadchan's
-- redt is inbound capture, like every other channel (AD-6: "every channel
-- converges on one inbox_item"). It lands as an inbox_items row scoped to
-- the CONNECTION'S HOUSEHOLD — a shadchan holds no table-level access to
-- write there directly ("Inbox items scoped to account", 05_policies.sql,
-- keys strictly on account_id = current_context_id()) — so this is a
-- narrowly-scoped SECURITY DEFINER cross-account write, following the
-- handle_new_user()/accept_connection_invite() precedent above. The
-- household then resolves it through the SAME InboxResolveDialog ->
-- create_shidduch() path any other channel goes through (Task 4,
-- inbox/InboxResolveDialog.tsx) — AD-7's "all inbound, including
-- shadchan-originated, enters via the confirm step", literally.
--
-- Story 8.3 review fix (Finding 4): the membership check below requires
-- current_context_id() to EQUAL shadchanus_account_id — the caller must be
-- ACTING AS the connection's shadchanus account, not merely hold some
-- active account_members row in it while acting under a different context.
--
-- The original check was "ANY active account_members row of
-- shadchanus_account_id", reasoned by analogy to create_shidduch()'s own
-- precedent of "never role- or context-gating beyond plain account
-- membership". That analogy does not hold: create_shidduch() has no
-- foreign-target-account parameter to gate at all — it always writes into
-- the CALLER'S OWN current_context_id(), so there was never a second
-- membership row it could have checked instead. There is no precedent here
-- to follow beyond this function's own NESTED create_thread() call three
-- statements below, which gates on current_context_id() via
-- connection_is_active_for_caller() — and that IS the right precedent,
-- because it is checking the exact same fact ("is the caller acting for
-- this connection's shadchanus side").
--
-- Under the old, looser check, a caller holding active memberships in BOTH
-- a household and a shadchanus account, acting in the HOUSEHOLD context,
-- could pass THIS function's gate (an active shadchanus-account membership
-- row exists somewhere for them) while create_thread()'s independent gate
-- also passed — because the household side happens to be the other legal
-- party to this SAME connection. The result, measured: the inbox item's
-- `sender` (an accounts.name lookup, unconditional on context) named the
-- shadchan, while the mirror thread's created_by_member_id and the
-- message's sender_member_id (both derived from current_member_id(), i.e.
-- current_context_id()) resolved to the HOUSEHOLD membership — two records
-- the household and the shadchan both read, disagreeing about who sent it.
-- Requiring current_context_id() equality here makes this function's gate
-- and create_thread()'s gate THE SAME CONDITION by construction: the
-- divergence above is now structurally impossible, not merely untested,
-- and every field derived from "who is acting" (sender name, thread
-- creator, message sender) is guaranteed to describe the one account whose
-- context this call actually ran under.
--
-- The prior version of this comment also claimed that a caller who passed
-- this function's old, looser gate under a THIRD, unrelated active context
-- would leave "the inbox item created but only the thread mirror failing".
-- Measured false: a PL/pgSQL RAISE with no enclosing EXCEPTION handler
-- aborts the whole top-level statement, so the entire call — including the
-- earlier insert — rolls back; the caller saw create_thread()'s own error
-- text, not a message naming this function's rule. That scenario is also
-- now unreachable by construction: the check below fails first, before any
-- insert runs, whenever the caller is not acting in this connection's
-- shadchanus context.
--
-- Story 8.3 review fix (Finding 5): every client-supplied field is
-- validated immediately below, BEFORE any insert — a malformed call must
-- create nothing and get a message naming the actual violated rule, never
-- a downstream NOT NULL/constraint error from a table (`messages.body`, in
-- particular) this function's own caller never sees the shape of.
-- `.claude/rules/coding-style.md`: validate input, fail fast, clear
-- messages. Length caps mirror log_reference_call()'s own 20000-character
-- precedent above.
CREATE OR REPLACE FUNCTION "public"."redt_via_connection"(
    "p_connection_id" bigint,
    "p_subject" text,
    "p_raw_text" text,
    "p_attachments" jsonb DEFAULT NULL
) RETURNS public.inbox_items
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

-- =====================================================================
-- MyShadchan — Listings & Sharing (Epic 9 Story 9.3: a single controls
-- their own listing)
-- =====================================================================

-- The sole creator of a public.listing_withdrawal_locks row. SECURITY
-- DEFINER because 06_grants.sql deliberately gives `authenticated` no DML
-- grant on that table at all (AC-4's own boundary) — an ordinary (SECURITY
-- INVOKER, the default) trigger would hit that same absent grant and fail.
-- Fires on every DELETE from `listings`, but only ever inserts a lock for
-- the `single` branch, and only when the DELETING caller (auth.uid()) is
-- THEMSELVES the subject via role = 'single' EXACTLY — not 'self_manager'.
-- AC-6 requires a self-manager's own withdrawal to NOT set the lock (there
-- is no separate manager to protect against); widening this predicate to
-- `role in ('single', 'self_manager')` "for consistency" with the publish
-- policy's check would silently break AC-6. `on conflict (single_id) do
-- nothing`: a single who withdraws, is somehow republished, and withdraws
-- again must not raise on the second lock (the primary key would otherwise
-- collide) — the lock simply stays.
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

-- The sole remover of a lock row. SECURITY DEFINER for the same reason as
-- the trigger above — `authenticated` cannot DELETE this table directly.
-- Scoped to the CALLER's own active context (current_context_id()), so a
-- caller from a DIFFERENT account can never clear, or even discover via
-- row-count, another household's lock (AC-7). No matching row is a SILENT
-- no-op, never an exception — mirrors current_context_id()'s own
-- fail-closed style (AD-19) rather than leaking existence information to a
-- caller who has no business asking whether a lock exists at all. The role
-- check deliberately widens to `single` OR `self_manager` (unlike the
-- trigger's exact `single`) — only the subject themselves can ever match
-- this EXISTS clause (the member_id join binds the caller to their own
-- singles row), and a locked single whose role later changes to
-- self_manager (persona lifecycle, Epic 2 Story 2.5) must still be able to
-- clear their own lock; publishing-as-self-manager while locked is still
-- refused until they consent, which is coherent — consent is the explicit
-- act.
CREATE OR REPLACE FUNCTION "public"."consent_to_republish_listing"("p_single_id" bigint) RETURNS void
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

-- Story 9.5 (AC-2): server-owned defaults for a share link, mirroring the
-- retired token-portal's own token-default trigger exactly (Epic 1 Story
-- 1.4 — that function is gone; read it from git history). `token` is
-- ALWAYS overwritten with a fresh CSPRNG value (192 bits from pgcrypto,
-- hex-encoded) regardless of what a client supplies — a client can never
-- choose, predict or supply the bearer secret that guards a resume/photo.
-- INSERT-only (never re-run on the revoke UPDATE, and there is no
-- corresponding `before update` trigger for this function), so revoking a
-- link never silently rotates its token.
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

-- Story 9.5 (AC-6): revocation is one-way. `authenticated` holds only a
-- `revoked_at`-only column UPDATE grant (06_grants.sql), so the client-side
-- surface is already narrow — this closes the remaining gap, "can a client
-- flip a revoked link back to null and resurrect a leaked link". Plain
-- SECURITY INVOKER: it only ever blocks, never needs elevated privilege.
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

-- Epic 11 (inbound email capture): every FUTURE household account gets its
-- own private inbound address at birth. Unlike set_share_link_token_defaults()
-- this token is short — 6 random bytes (12 hex chars, 48 bits) rather than a
-- share_link's 192 bits — because entropy is not load-bearing here: mail
-- from an unrecognized sender is held for review regardless of how the
-- address was found, so guessing one yields a spam item in a review queue,
-- not access to real data, and a wrong guess simply bounces as
-- unresolvable. The address is also displayed to and typed by users, so
-- readability wins over the extra bits. Like that function's own
-- `new.token` line, this is still an UNCONDITIONAL overwrite, not an `is
-- null` guard: a client-supplied value must never be honored. A
-- shadchanus-kind account is left untouched — it has no mailbox of its own
-- (accounts_inbound_email_token_kind_check, 01_tables.sql catches a
-- shadchanus row that somehow arrives with a non-null token anyway).
-- Pre-existing rows are backfilled once, by the migration that adds this
-- column; this trigger only ever runs on INSERT, so it never re-derives a
-- token for a row that already has one.
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
