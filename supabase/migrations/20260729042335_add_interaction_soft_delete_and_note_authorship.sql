drop policy "Interactions scoped to account and parent visibility" on "public"."interactions";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.can_moderate_note(p_actor_member_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

create or replace view "public"."interactions_summary" as  SELECT i.id,
    i.account_id,
    i.created_at,
    i.target_type,
    i.target_id,
    i.scope,
    i.reference_link_id,
    i.actor_member_id,
    i.kind,
    i.body,
    i.metadata,
    i.deleted_at,
    NULLIF(btrim(((COALESCE(m.first_name, ''::text) || ' '::text) || COALESCE(m.last_name, ''::text))), ''::text) AS author_name,
    public.can_moderate_note(i.actor_member_id) AS can_moderate
   FROM ((public.interactions i
     LEFT JOIN public.account_members am ON ((am.id = i.actor_member_id)))
     LEFT JOIN public.members m ON ((m.user_id = am.user_id)));



  create policy "Interactions insertable within account and parent visibility"
  on "public"."interactions"
  as permissive
  for insert
  to authenticated
with check (((account_id = public.current_context_id()) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
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
using (((account_id = public.current_context_id()) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id()))))))));



  create policy "Interactions updatable by author or owning role"
  on "public"."interactions"
  as permissive
  for update
  to authenticated
using (((account_id = public.current_context_id()) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id())))))) AND ((kind <> 'note'::text) OR public.can_moderate_note(actor_member_id))))
with check (((account_id = public.current_context_id()) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id())))))) AND ((kind <> 'note'::text) OR public.can_moderate_note(actor_member_id))));

-- ---------------------------------------------------------------------------
-- MANUAL ADJUSTMENTS. `supabase db diff` emits none of the following, and
-- none of it is cosmetic (same two documented gaps as
-- 20260724112600_add_summary_stats_views.sql):
--
-- 1. It drops WITH (security_invoker = on) when it writes a NEW view.
--    Without it, interactions_summary would execute as its owner and the
--    caller's own RLS (and can_moderate_note()'s author-vs-owning-role
--    answer) would never apply — proven live: without this line,
--    AC 5(iv)'s archived-author check leaks the author's name straight
--    through, because the view reads `members` as the view's OWNER, not the
--    caller, bypassing that table's own SELECT policy entirely.
alter view "public"."interactions_summary" set (security_invoker = on);

-- 2. It does not diff new-object privileges (function EXECUTE, view SELECT)
--    or column-level UPDATE grants at all, so these three are added by hand
--    to match 02_functions.sql / 03_views.sql / 06_grants.sql exactly, then
--    verified by re-running `db diff --local` to "No schema changes found"
--    after `migration up --local`.
revoke all on function public.can_moderate_note(bigint) from public, anon;
grant execute on function public.can_moderate_note(bigint) to authenticated;
grant execute on function public.can_moderate_note(bigint) to service_role;

revoke all on table public.interactions_summary from anon, authenticated;
grant select on table public.interactions_summary to authenticated;
grant all on table public.interactions_summary to service_role;

revoke update on table public.interactions from authenticated;
grant update (body, metadata, deleted_at) on table public.interactions to authenticated;



