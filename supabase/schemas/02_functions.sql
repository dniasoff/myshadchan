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
CREATE OR REPLACE FUNCTION "public"."accept_invite"("p_token" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_invite public.invites;
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
  values (v_invite.account_id, v_user_id, v_invite.role, v_invite.invited_by, 'active');
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
CREATE OR REPLACE FUNCTION "public"."create_invite"("p_email" "text", "p_role" "text") RETURNS "public"."invites"
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

  insert into public.invites (email, account_id, role, invited_by)
  values (p_email, v_account_id, p_role, v_membership_id)
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

-- Backs the "before user created" Auth Hook (AC-5,
-- [auth.hook.before_user_created] in supabase/config.toml). THE authoritative
-- gate for AD-11's "new users join only by a verified invite token" and the
-- 18+ affirmation — handle_new_user() only performs the BINDING once this
-- hook has already allowed creation (see "Two gates, one authoritative",
-- story 2.7's Dev Notes).
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
-- Both metadata reads are cast defensively: a hand-crafted, malformed
-- `invite_token`/`age_affirmed` value must refuse cleanly, never crash the
-- hook (a hook error surfaces as an opaque 500, not a clear 403).
CREATE OR REPLACE FUNCTION "public"."check_signup_invite"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_email text;
  v_age_affirmed boolean;
  v_token uuid;
begin
  v_email := event -> 'user' ->> 'email';

  begin
    v_age_affirmed := (event -> 'user' -> 'user_metadata' ->> 'age_affirmed')::boolean;
  exception when others then
    v_age_affirmed := null;
  end;

  if v_age_affirmed is distinct from true then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'You must confirm you are 18 years of age or older to sign up.'
    ));
  end if;

  begin
    v_token := nullif(event -> 'user' -> 'user_metadata' ->> 'invite_token', '')::uuid;
  exception when others then
    v_token := null;
  end;

  if v_token is null or v_email is null or not exists (
    select 1 from public.invites i
    where i.token = v_token
      and lower(i.email) = lower(v_email)
      and i.status = 'pending'
      and i.expires_at > now()
  ) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'This invite is invalid, expired, or has already been used.'
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

  return query select * from public.shidduchim where id = v_id;
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
    return query select * from public.shidduchim where id = p_id;
    return;
  end if;

  if not exists (
    select 1 from public.pipeline_transitions t
    where t.from_state = p_from and t.to_state = p_to
  ) then
    raise exception 'illegal pipeline transition: % -> %', p_from, p_to
      using errcode = 'check_violation';
  end if;

  return query
  update public.shidduchim
  set pipeline_state = p_to,
      close_reason = case
        when p_to in ('for_sure_not', 'yes', 'unsure', 'no') then coalesce(p_close_reason, close_reason)
        else null
      end
  where id = p_id
  returning *;
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

  return query select * from public.shidduchim where id = p_shidduchim_id;
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
-- calls for the same shidduch can never silently overwrite each other's
-- entry; the second call blocks on the row lock until the first commits,
-- then appends onto what the first one wrote. Never mutates or removes an
-- existing array element. Account-scoped so a file can never be attached to
-- a foreign account's shidduch. SECURITY INVOKER so RLS applies.
CREATE OR REPLACE FUNCTION "public"."add_resume_file"(
    "p_shidduchim_id" bigint,
    "p_path" text,
    "p_filename" text,
    "p_mime_type" text,
    "p_size" bigint
) RETURNS SETOF public.resumes
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_account_id bigint;
  v_entry jsonb;
begin
  v_account_id := public.current_context_id();

  if not exists (
    select 1 from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
  ) then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;

  v_entry := jsonb_build_object(
    'path', p_path,
    'filename', p_filename,
    'uploaded_at', now(),
    'uploaded_by', public.current_member_id(),
    'mime_type', p_mime_type,
    'size', p_size
  );

  return query
  insert into public.resumes (account_id, shidduchim_id, files)
  values (v_account_id, p_shidduchim_id, jsonb_build_array(v_entry))
  on conflict (shidduchim_id) do update
    set files = coalesce(public.resumes.files, '[]'::jsonb) || jsonb_build_array(v_entry)
  returning *;
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
-- a photo can never be attached to a foreign account's shidduch.
CREATE OR REPLACE FUNCTION "public"."add_resume_photo"(
    "p_shidduchim_id" bigint,
    "p_path" text,
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

  if not exists (
    select 1 from public.shidduchim s
    where s.id = p_shidduchim_id and s.account_id = v_account_id
  ) then
    raise exception 'shidduch % not found in current account', p_shidduchim_id;
  end if;

  insert into public.resumes (account_id, shidduchim_id)
  values (v_account_id, p_shidduchim_id)
  on conflict (shidduchim_id) do update set shidduchim_id = excluded.shidduchim_id
  returning id into v_resume_id;

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

  select * into v_s
  from public.shidduchim s
  where s.id = p_shidduchim_id and s.account_id = v_account_id;

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
  -- Monthly resume auto-parse allowance for the AI tier. Named rather than
  -- magic; the meter reads "<resumes_used> / <this>". Free tier gets 0.
  c_ai_monthly_resume_limit constant integer := 100;
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
  v_is_entitled := (v_plan = 'ai' and v_status = 'active');
  v_resumes_limit := case when v_is_entitled then c_ai_monthly_resume_limit else 0 end;

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
