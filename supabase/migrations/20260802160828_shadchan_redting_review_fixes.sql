alter table "public"."inbox_items" add constraint "inbox_items_shadchan_source_requires_connection" CHECK (((source <> 'shadchan'::text) OR (connection_id IS NOT NULL))) not valid;

alter table "public"."inbox_items" validate constraint "inbox_items_shadchan_source_requires_connection";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.redt_via_connection(p_connection_id bigint, p_subject text, p_raw_text text, p_attachments jsonb DEFAULT NULL::jsonb)
 RETURNS public.inbox_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;


