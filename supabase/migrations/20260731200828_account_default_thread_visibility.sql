alter table "public"."accounts" add column "default_thread_visibility" text not null default 'open'::text;

alter table "public"."accounts" add constraint "accounts_default_thread_visibility_check" CHECK ((default_thread_visibility = ANY (ARRAY['open'::text, 'private'::text]))) not valid;

alter table "public"."accounts" validate constraint "accounts_default_thread_visibility_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_thread(p_subject_type text, p_subject_id bigint DEFAULT NULL::bigint, p_participant_member_ids bigint[] DEFAULT '{}'::bigint[], p_visibility text DEFAULT NULL::text)
 RETURNS public.threads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id bigint;
  v_member_id bigint;
  v_visibility text;
  v_thread public.threads;
  v_participant_id bigint;
begin
  v_account_id := public.current_context_id();
  if v_account_id is null then
    raise exception 'no account context for create_thread (no account exists)';
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
  -- belong to the caller's account, and must actually exist.
  if p_subject_type = 'shidduch' and not exists (
    select 1 from public.shidduchim where id = p_subject_id and account_id = v_account_id
  ) then
    raise exception 'shidduch % not found in current account', p_subject_id;
  end if;

  if p_visibility is not null and p_visibility not in ('open', 'private') then
    raise exception 'invalid thread visibility: %', p_visibility
      using errcode = 'check_violation';
  end if;

  v_visibility := coalesce(
    p_visibility,
    (select a.default_thread_visibility from public.accounts a where a.id = v_account_id)
  );

  insert into public.threads (
    account_id, connection_id, subject_type, subject_id, visibility, created_by_member_id
  ) values (
    v_account_id, null,
    p_subject_type,
    case when p_subject_type = 'shidduch' then p_subject_id else null end,
    v_visibility, v_member_id
  )
  returning * into v_thread;

  -- The creator is always a participant, from the moment the thread exists
  -- (AC-2).
  insert into public.thread_participants (account_id, connection_id, thread_id, member_id)
  values (v_account_id, null, v_thread.id, v_member_id);

  -- One row per DISTINCT supplied id (AC-7). Fail fast on any id that is
  -- not an active account_members row of the caller's own account — never
  -- let a caller believe someone is in a conversation who silently was
  -- not added (.claude/rules/coding-style.md). ON CONFLICT DO NOTHING
  -- (thread_participants_thread_id_member_id_key) absorbs a duplicate in
  -- the array, or the caller's own id repeated, without a second check.
  foreach v_participant_id in array coalesce(p_participant_member_ids, '{}') loop
    if not exists (
      select 1 from public.account_members
      where id = v_participant_id and account_id = v_account_id and status = 'active'
    ) then
      raise exception 'member % not found in current account', v_participant_id;
    end if;
    insert into public.thread_participants (account_id, connection_id, thread_id, member_id)
    values (v_account_id, null, v_thread.id, v_participant_id)
    on conflict (thread_id, member_id) do nothing;
  end loop;

  return v_thread;
end;
$function$
;

-- HAND-ADDED. `db diff` does not diff privileges, so the column-level UPDATE
-- grant extended in 06_grants.sql (Story 7.2 Task 2) is NOT in the generated
-- SQL above, and `db diff` still reports "No schema changes found" without it
-- — the same blind spot 20260731000707_close_reason_column_privilege.sql and
-- 20260731181450_thread_model.sql both call out.
--
-- Without this line the migrated database ends up with
-- `grant update (name, transparency_level, data_region)` only, so EVERY role
-- gets 42501 on the Settings write — and AC-6(d) ("a single-role member's
-- UPDATE affects zero rows") passes for entirely the wrong reason, because
-- the parent_admin is denied too. That is why AC-6(d) must ship next to a
-- positive control asserting the parent_admin's UPDATE affects one row.
--
-- Additive on purpose: a column-level grant adds to the set `authenticated`
-- already holds, so the three existing columns are untouched. No table-level
-- `revoke update` is restated — `authenticated` holds none to narrow (the
-- original revoke is already in the deployed history), and a column-level
-- revoke could not subtract from a table-level grant anyway, which is the
-- idiom 06_grants.sql documents.
grant update ("default_thread_visibility") on table "public"."accounts" to "authenticated";

