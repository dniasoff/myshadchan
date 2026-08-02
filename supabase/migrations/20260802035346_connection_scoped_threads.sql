-- Story 7.4: any pairing may hold a private thread. Opens the connection
-- axis 7.1 built but left permanently closed (thread_is_readable()'s
-- unconditional `connection_id is not null -> false` line) and Story 7.2's
-- forward-hazard note flagged in create_thread()'s own default-posture
-- coalesce.
--
-- No ALTER TABLE anywhere in this migration — it is CREATE OR REPLACE
-- FUNCTION plus policy replacements only, so it is safe to apply without a
-- production rehearsal of a data-bearing change (rehearsed anyway per this
-- story's Task 5).
--
-- create_thread() gains a fifth, defaulted parameter (p_connection_id).
-- Functions are identified by name + parameter TYPES, never by name +
-- defaults, so this is a NEW signature for Postgres's overload resolution —
-- leaving the old 4-argument signature in place alongside the new 5-argument
-- one would make every existing call site ambiguous between "the old exact
-- match" and "the new one with a default filled in" (42725, function is not
-- unique). The DROP FUNCTION below removes the old signature (and its
-- grants) explicitly; the GRANT block at the end re-issues them under the
-- new signature.
drop policy "Messages insertable by an existing participant" on "public"."messages";

drop policy "Thread participants insertable by an existing participant" on "public"."thread_participants";

drop function if exists "public"."create_thread"(p_subject_type text, p_subject_id bigint, p_participant_member_ids bigint[], p_visibility text);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.connection_is_active_for_caller(p_connection_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_thread(p_subject_type text, p_subject_id bigint DEFAULT NULL::bigint, p_participant_member_ids bigint[] DEFAULT '{}'::bigint[], p_visibility text DEFAULT NULL::text, p_connection_id bigint DEFAULT NULL::bigint)
 RETURNS public.threads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.thread_visibility_permits(p_thread_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.thread_is_readable(p_thread_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;


  create policy "Messages insertable by an existing participant"
  on "public"."messages"
  as permissive
  for insert
  to authenticated
with check (((((account_id = public.current_context_id()) AND (connection_id IS NULL)) OR ((connection_id IS NOT NULL) AND public.connection_is_active_for_caller(connection_id))) AND (EXISTS ( SELECT 1
   FROM public.thread_participants tp
  WHERE ((tp.thread_id = messages.thread_id) AND (tp.member_id = public.current_member_id()))))));



  create policy "Thread participants insertable by an existing participant"
  on "public"."thread_participants"
  as permissive
  for insert
  to authenticated
with check (((((account_id = public.current_context_id()) AND (connection_id IS NULL)) OR ((connection_id IS NOT NULL) AND public.connection_is_active_for_caller(connection_id))) AND (EXISTS ( SELECT 1
   FROM public.thread_participants tp
  WHERE ((tp.thread_id = thread_participants.thread_id) AND (tp.member_id = public.current_member_id())))) AND (EXISTS ( SELECT 1
   FROM public.account_members am
  WHERE ((am.id = thread_participants.member_id) AND (am.account_id = public.current_context_id()) AND (am.status = 'active'::text))))));

-- `db diff` never re-emits function grants for a NEW function signature
-- (Story 7.1's own hard-won lesson, repeated by Story 7.3, repeated here) —
-- hand-added, matching 06_grants.sql. thread_is_readable() and
-- thread_visibility_permits()'s SHARED (thread_visibility_permits is new,
-- but see below) function bodies changed with an UNCHANGED signature for
-- thread_is_readable(), which already carries its grants from Story 7.1's
-- migration — untouched here. connection_is_active_for_caller() and
-- thread_visibility_permits() are both new objects; create_thread() is a
-- NEW signature (the old one's grants were dropped along with the function
-- above). thread_visibility_permits() is deliberately NOT granted to
-- `authenticated` — see 02_functions.sql's own comment on why a direct RPC
-- to it would bypass thread_is_readable()'s scope gate.
revoke all on function public.connection_is_active_for_caller(bigint) from public, anon;
grant execute on function public.connection_is_active_for_caller(bigint) to authenticated;
grant execute on function public.connection_is_active_for_caller(bigint) to service_role;

revoke all on function public.thread_visibility_permits(bigint) from public, anon, authenticated;
grant execute on function public.thread_visibility_permits(bigint) to service_role;

revoke all on function public.create_thread(text, bigint, bigint[], text, bigint) from public, anon;
grant execute on function public.create_thread(text, bigint, bigint[], text, bigint) to authenticated;
grant execute on function public.create_thread(text, bigint, bigint[], text, bigint) to service_role;
