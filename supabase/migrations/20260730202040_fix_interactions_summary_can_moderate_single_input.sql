-- Realigns interactions_summary.can_moderate with the post-Story-6.4 UPDATE
-- policy on public.interactions.
--
-- THE DEFECT. Story 6.4 rewrote `"Interactions updatable by author or owning
-- role"` (05_policies.sql) so that `single_input` is APPEND-ONLY — its
-- moderation clause became `kind not in ('note', 'single_input') or (kind =
-- 'note' and can_moderate_note(actor_member_id))`, in both `using` and `with
-- check`. The view's `can_moderate` column was left on the Story 5.7 shape,
-- `kind not in ('note', 'single_input') or can_moderate_note(...)`, which
-- calls can_moderate_note() on `single_input` rows. That function returns
-- true for a row's AUTHOR, so the view reported `can_moderate = t` on rows
-- the database refuses to update — verified live before this migration:
-- `can_moderate = t` alongside `UPDATE … → 0 rows affected` for the author of
-- a single_input row. The view told the UI an action was available that no
-- UPDATE path would honour.
--
-- The new expression is the policy's moderation clause character for
-- character (03_views.sql carries the full reasoning, including why the
-- visibility conjuncts still need no mirroring and why the policy's
-- `current_member_role() <> 'single'` conjunct does not — yet).
--
-- MANUAL ADJUSTMENTS to `supabase db diff` output, both verified on a live
-- database rather than assumed:
--
--   1. `alter view … set (security_invoker = on)` — REQUIRED, not defensive.
--      Measured on this exact statement: reloptions went `security_invoker=on`
--      → (none) across the `create or replace view` below. Without the
--      restore the view runs as its OWNER, FORCE ROW LEVEL SECURITY on
--      public.interactions stops applying through it, and every caller reads
--      every account's rows (AD-1). `db diff` never re-emits it; the standing
--      guard is supabase/tests/security_invoker_views.sql.
--
--   2. The grant block — DEFENSIVE, and stated as such rather than repeated
--      from the standing warning. Measured on the same statement: the view's
--      ACL was byte-identical before and after (`create or replace` does not
--      drop the relation, so its grants survive; only a DROP+CREATE loses
--      them). Replaying 06_grants.sql:514-516 verbatim is therefore a no-op
--      here — which is exactly what supabase/tests/view_grants.sql asserts by
--      replaying that file and requiring the ACL not to move. It is included
--      so this migration stays correct if the statement above ever becomes a
--      DROP+CREATE, not because it repairs anything today.
--
-- The generated diff dropped and recreated nothing else: `dropStatements` was
-- empty and no dependent view was touched — checked because a column-order
-- divergence in 01_tables.sql has twice made every diff on this repo's view
-- graph carry a destructive cascade (see the COLUMN-ORDER TRAP note at the
-- top of supabase/schemas/01_tables.sql). `db diff --local` was clean on this
-- tree immediately before and after this migration.

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
    ((i.kind <> ALL (ARRAY['note'::text, 'single_input'::text])) OR ((i.kind = 'note'::text) AND public.can_moderate_note(i.actor_member_id))) AS can_moderate
   FROM ((public.interactions i
     LEFT JOIN public.account_members am ON ((am.id = i.actor_member_id)))
     LEFT JOIN public.members m ON ((m.user_id = am.user_id)));

alter view "public"."interactions_summary" set (security_invoker = on);

revoke all on table public.interactions_summary from anon, authenticated;
grant select on table public.interactions_summary to authenticated;
grant all on table public.interactions_summary to service_role;
