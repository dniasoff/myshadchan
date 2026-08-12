-- Adds the comment/edit access-tier RLS: the 'grantee_input' interactions
-- kind (INSERT + SELECT-own via an accepted comment-or-edit grant, plus the
-- general interactions INSERT/UPDATE policies' kind exclusions widened to
-- match), and the edit-tier structural UPDATE policies on
-- public.shidduch_education / public.redts. 05_policies.sql / 01_tables.sql /
-- 03_views.sql carry the full reasoning.
--
-- MANUAL ADJUSTMENT to `supabase db diff` output, verified on a live
-- database rather than assumed (the same class of drift this repo has hit
-- twice before — 20260730202040_fix_interactions_summary_can_moderate_single_input.sql
-- carries the identical fix for the identical reason):
--
--   `alter view … set (security_invoker = on)` — REQUIRED, not defensive.
--   Measured on this exact statement, on stack 4, before writing this
--   comment: reloptions went `security_invoker=on` -> (none) across the
--   `create or replace view` below. Without the restore the view runs as its
--   OWNER, FORCE ROW LEVEL SECURITY on public.interactions stops applying
--   through it, and every caller reads every account's rows (AD-1). `db
--   diff` never re-emits it; the standing guard is
--   supabase/tests/security_invoker_views.sql.
--
--   The grant block below is DEFENSIVE, not a repair: the view's ACL was
--   measured byte-identical before and after this exact statement
--   (`create or replace view` does not drop the relation, so grants tied to
--   its OID survive; only a DROP+CREATE loses them) — `authenticated` still
--   held SELECT immediately after applying, unaided. Replaying
--   06_grants.sql:583-585 verbatim is a no-op today, kept so this migration
--   stays correct if the statement above ever becomes a DROP+CREATE, per the
--   same precedent migration's own reasoning.
--
-- The generated diff dropped and recreated nothing else on the view graph:
-- `dropStatements` covered only the two policies and the CHECK constraint
-- below (both expected — a CHECK constraint value can only be altered via
-- drop+add, and a policy body has no ALTER POLICY equivalent), no other view
-- was touched, and no table/column was dropped. `db diff` was run twice
-- against stack 4 after applying (clean, then convergence) as part of this
-- stage's verification.
drop policy "Interactions insertable within account and parent visibility" on "public"."interactions";

drop policy "Interactions updatable by author or owning role" on "public"."interactions";

alter table "public"."interactions" drop constraint "interactions_kind_check";

alter table "public"."interactions" add constraint "interactions_kind_check" CHECK ((kind = ANY (ARRAY['note'::text, 'call_logged'::text, 'status_change'::text, 'merge'::text, 'link_created'::text, 'link_removed'::text, 'single_input'::text, 'grantee_input'::text]))) not valid;

alter table "public"."interactions" validate constraint "interactions_kind_check";

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
    ((i.kind <> ALL (ARRAY['note'::text, 'single_input'::text, 'grantee_input'::text])) OR ((i.kind = 'note'::text) AND public.can_moderate_note(i.actor_member_id))) AS can_moderate
   FROM ((public.interactions i
     LEFT JOIN public.account_members am ON ((am.id = i.actor_member_id)))
     LEFT JOIN public.members m ON ((m.user_id = am.user_id)));

alter view "public"."interactions_summary" set (security_invoker = on);

revoke all on table public.interactions_summary from anon, authenticated;
grant select on table public.interactions_summary to authenticated;
grant all on table public.interactions_summary to service_role;



  create policy "Grantee inserts commentary via accepted grant"
  on "public"."interactions"
  as permissive
  for insert
  to authenticated
with check (((kind = 'grantee_input'::text) AND (actor_member_id = public.current_member_id()) AND (target_type = 'single'::text) AND (scope = 'account'::text) AND (public.current_member_role() <> 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.access_level = ANY (ARRAY['comment'::text, 'edit'::text])) AND (g.grantee_account_id = public.current_context_id()) AND (g.proposer_account_id = interactions.account_id) AND (g.target_single_id = interactions.target_id))))));



  create policy "Grantee reads own input via accepted grant"
  on "public"."interactions"
  as permissive
  for select
  to authenticated
using (((kind = 'grantee_input'::text) AND (actor_member_id = public.current_member_id()) AND (public.current_member_role() <> 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.access_level = ANY (ARRAY['comment'::text, 'edit'::text])) AND (g.grantee_account_id = public.current_context_id()) AND (g.proposer_account_id = interactions.account_id) AND (g.target_single_id = interactions.target_id))))));



  create policy "Redts updatable via accepted edit grant"
  on "public"."redts"
  as permissive
  for update
  to authenticated
using (((EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.access_level = 'edit'::text) AND (g.grantee_account_id = public.current_context_id()) AND (g.target_single_id = public.shidduch_single_id(redts.shidduchim_id))))) AND (public.current_member_role() = ANY (ARRAY['parent_admin'::text, 'self_manager'::text]))))
with check (((EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.access_level = 'edit'::text) AND (g.grantee_account_id = public.current_context_id()) AND (g.target_single_id = public.shidduch_single_id(redts.shidduchim_id))))) AND (public.current_member_role() = ANY (ARRAY['parent_admin'::text, 'self_manager'::text])) AND (account_id = ( SELECT g.proposer_account_id
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.access_level = 'edit'::text) AND (g.grantee_account_id = public.current_context_id()) AND (g.target_single_id = public.shidduch_single_id(redts.shidduchim_id)))))));



  create policy "Shidduch education updatable via accepted edit grant"
  on "public"."shidduch_education"
  as permissive
  for update
  to authenticated
using (((EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.access_level = 'edit'::text) AND (g.grantee_account_id = public.current_context_id()) AND (g.target_single_id = public.shidduch_single_id(shidduch_education.shidduchim_id))))) AND (public.current_member_role() = ANY (ARRAY['parent_admin'::text, 'self_manager'::text]))))
with check (((EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.access_level = 'edit'::text) AND (g.grantee_account_id = public.current_context_id()) AND (g.target_single_id = public.shidduch_single_id(shidduch_education.shidduchim_id))))) AND (public.current_member_role() = ANY (ARRAY['parent_admin'::text, 'self_manager'::text])) AND (account_id = ( SELECT g.proposer_account_id
   FROM public.child_grants g
  WHERE ((g.status = 'accepted'::text) AND (g.access_level = 'edit'::text) AND (g.grantee_account_id = public.current_context_id()) AND (g.target_single_id = public.shidduch_single_id(shidduch_education.shidduchim_id)))))));



  create policy "Interactions insertable within account and parent visibility"
  on "public"."interactions"
  as permissive
  for insert
  to authenticated
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text) AND (kind <> ALL (ARRAY['single_input'::text, 'grantee_input'::text])) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
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



  create policy "Interactions updatable by author or owning role"
  on "public"."interactions"
  as permissive
  for update
  to authenticated
using (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id())))))) AND ((kind <> ALL (ARRAY['note'::text, 'single_input'::text, 'grantee_input'::text])) OR ((kind = 'note'::text) AND public.can_moderate_note(actor_member_id)))))
with check (((account_id = public.current_context_id()) AND (public.current_member_role() <> 'single'::text) AND (((scope = 'account'::text) AND ((target_type = 'reference'::text) OR ((target_type = 'shadchan'::text) AND (EXISTS ( SELECT 1
   FROM public.shadchanim sh
  WHERE ((sh.id = interactions.target_id) AND (sh.account_id = public.current_context_id()))))) OR ((target_type = 'single'::text) AND (EXISTS ( SELECT 1
   FROM public.singles si
  WHERE ((si.id = interactions.target_id) AND (si.account_id = public.current_context_id()))))))) OR ((target_type = 'reference'::text) AND (EXISTS ( SELECT 1
   FROM (public.reference_links rl
     JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
  WHERE ((rl.id = interactions.reference_link_id) AND (rl.account_id = public.current_context_id()) AND (s.account_id = public.current_context_id()))))) OR ((target_type = 'shidduch'::text) AND (EXISTS ( SELECT 1
   FROM public.shidduchim s
  WHERE ((s.id = interactions.target_id) AND (s.account_id = public.current_context_id())))))) AND ((kind <> ALL (ARRAY['note'::text, 'single_input'::text, 'grantee_input'::text])) OR ((kind = 'note'::text) AND public.can_moderate_note(actor_member_id)))));



