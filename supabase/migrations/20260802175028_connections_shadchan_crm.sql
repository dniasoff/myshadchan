drop policy "Interactions insertable within account and parent visibility" on "public"."interactions";

drop policy "Interactions readable within account and parent visibility" on "public"."interactions";

alter table "public"."entity_files" drop constraint "entity_files_target_type_check";

alter table "public"."interactions" drop constraint "interactions_scope_link_check";

alter table "public"."interactions" drop constraint "interactions_target_type_check";

alter table "public"."tasks" drop constraint "tasks_target_type_check";

-- Story 8.5 (AC-2): `connections` already carries production rows (the
-- migration-data-safety fixture's seed, plus 8.2/8.4's own SQL test
-- fixtures) — a bare `not null` add would fail against any of them. Added
-- nullable, backfilled from a join to `accounts` (the migration runs as
-- postgres/superuser, unaffected by "Accounts readable to their members"),
-- THEN set NOT NULL — the same two-step shape `proposed_by_account_id` used
-- in the prior migration.
alter table "public"."connections" add column "household_account_name" text;

update "public"."connections" c
set household_account_name = a.name
from "public"."accounts" a
where a.id = c.household_account_id
  and c.household_account_name is null;

alter table "public"."connections" alter column "household_account_name" set not null;

alter table "public"."entity_files" add constraint "entity_files_target_type_check" CHECK ((target_type = ANY (ARRAY['reference'::text, 'shidduch'::text, 'shadchan'::text, 'single'::text, 'connection'::text]))) not valid;

alter table "public"."entity_files" validate constraint "entity_files_target_type_check";

alter table "public"."interactions" add constraint "interactions_scope_link_check" CHECK ((((scope = 'shidduch'::text) AND (target_type = 'reference'::text) AND (reference_link_id IS NOT NULL)) OR ((scope = 'shidduch'::text) AND (target_type = 'shidduch'::text) AND (reference_link_id IS NULL)) OR ((scope = 'account'::text) AND (target_type = 'reference'::text) AND (reference_link_id IS NULL)) OR ((scope = 'account'::text) AND (target_type = ANY (ARRAY['shadchan'::text, 'single'::text, 'connection'::text])) AND (reference_link_id IS NULL)))) not valid;

alter table "public"."interactions" validate constraint "interactions_scope_link_check";

alter table "public"."interactions" add constraint "interactions_target_type_check" CHECK ((target_type = ANY (ARRAY['reference'::text, 'shidduch'::text, 'shadchan'::text, 'single'::text, 'connection'::text]))) not valid;

alter table "public"."interactions" validate constraint "interactions_target_type_check";

alter table "public"."tasks" add constraint "tasks_target_type_check" CHECK ((target_type = ANY (ARRAY['shadchan'::text, 'shidduch'::text, 'reference'::text, 'single'::text, 'connection'::text]))) not valid;

alter table "public"."tasks" validate constraint "tasks_target_type_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.accept_connection_invite(p_token text)
 RETURNS public.connections
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;


  create policy "Interactions insertable within account and parent visibility"
  on "public"."interactions"
  as permissive
  for insert
  to authenticated
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text) AND (kind <> 'single_input'::text) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))) OR ((target_type = 'connection'::text) AND (EXISTS ( SELECT 1
   FROM public.connections c
  WHERE ((c.id = interactions.target_id) AND ((c.household_account_id = public.current_context_id()) OR (c.shadchanus_account_id = public.current_context_id())))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id()))))))));



  create policy "Interactions readable within account and parent visibility"
  on "public"."interactions"
  as permissive
  for select
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))) OR ((target_type = 'connection'::text) AND (EXISTS ( SELECT 1
   FROM public.connections c
  WHERE ((c.id = interactions.target_id) AND ((c.household_account_id = public.current_context_id()) OR (c.shadchanus_account_id = public.current_context_id())))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id()))))))));



