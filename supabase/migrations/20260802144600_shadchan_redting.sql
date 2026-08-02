alter table "public"."inbox_items" drop constraint "inbox_items_source_check";

alter table "public"."inbox_items" add column "connection_id" bigint;

alter table "public"."inbox_items" add constraint "inbox_items_connection_id_fkey" FOREIGN KEY (connection_id) REFERENCES public.connections(id) not valid;

alter table "public"."inbox_items" validate constraint "inbox_items_connection_id_fkey";

alter table "public"."inbox_items" add constraint "inbox_items_source_check" CHECK ((source = ANY (ARRAY['whatsapp'::text, 'sms'::text, 'email'::text, 'photo'::text, 'upload'::text, 'shadchan'::text]))) not valid;

alter table "public"."inbox_items" validate constraint "inbox_items_source_check";

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

  if not exists (
    select 1 from public.account_members am
    where am.account_id = v_connection.shadchanus_account_id
      and am.user_id = auth.uid() and am.status = 'active'
  ) then
    raise exception 'caller is not an active member of this connection''s shadchanus context'
      using errcode = 'insufficient_privilege';
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

-- db diff does not reliably re-emit grants for a brand-new function (the
-- same gap the project has already hit for views' security_invoker/grants —
-- see .claude/rules and 06_grants.sql's own header) — hand-added to match
-- 06_grants.sql exactly. Never `anon`: sending a redt requires an
-- authenticated, connected shadchan (AD-1).
revoke all on function "public"."redt_via_connection"(bigint, text, text, jsonb) from "public", "anon";

grant execute on function "public"."redt_via_connection"(bigint, text, text, jsonb) to "authenticated";

grant execute on function "public"."redt_via_connection"(bigint, text, text, jsonb) to "service_role";


