CREATE INDEX tasks_account_member_idx ON public.tasks USING btree (account_id, member_id);

-- Story 12.3: member_id is deliberately NOT re-aligned onto
-- account_members.id (see 01_tables.sql for the reasoning) — this
-- rewrite of the column comment just carries that reasoning into the
-- database itself. `db diff` does not diff column comments, so this
-- statement is hand-added; it changes no data and no behavior.
comment on column public.tasks.member_id is 'FK-less reference to public.members(id) — the assignee/reminder-owner user. NOT public.account_members, unlike other *_member_id columns in this schema. Deliberately NOT re-aligned: members.id is stable across a persona archive/re-add round-trip, account_members.id is not (Story 12.3).';

set check_function_bodies = off;

create or replace view "public"."context_members" as  SELECT m.id,
    am.account_id,
    am.user_id,
    am.role,
    NULLIF(btrim(((COALESCE(m.first_name, ''::text) || ' '::text) || COALESCE(m.last_name, ''::text))), ''::text) AS full_name,
    (am.user_id = auth.uid()) AS is_self
   FROM (public.account_members am
     JOIN public.members m ON ((m.user_id = am.user_id)))
  WHERE ((am.status = 'active'::text) AND (am.account_id = public.current_context_id()));

-- MANUAL ADJUSTMENTS (per 20260724112600_add_summary_stats_views.sql's own
-- precedent): `supabase db diff` drops `WITH (security_invoker = on)` when
-- it writes a view, and does not diff view privileges at all. Both are
-- hand-added here — without the first, this view would run as its owner and
-- RLS would never apply; without the second, every authenticated read of
-- the picker 403s.
alter view "public"."context_members" set (security_invoker = on);

revoke all on table public.context_members from anon, authenticated;
grant select on table public.context_members to authenticated;
grant all on table public.context_members to service_role;

CREATE OR REPLACE FUNCTION public.validate_task_assignee()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

-- Story 12.3 AC-9: normalise unresolvable assignments before the guard
-- exists, so no legacy row is left in a state the new trigger would
-- reject on its next member_id write. Pre-migration count on the local
-- stack (2026-08-06): 0 rows matched this predicate.
update public.tasks t
set member_id = null
where t.member_id is not null
  and not exists (
    select 1
    from public.account_members am
      join public.members m on m.user_id = am.user_id
    where m.id = t.member_id
      and am.account_id = t.account_id
      and am.status = 'active'
  );

CREATE TRIGGER validate_task_assignee BEFORE INSERT OR UPDATE OF member_id, account_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.validate_task_assignee();
