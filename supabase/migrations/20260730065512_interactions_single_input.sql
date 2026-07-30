-- Story 5.7: widen interactions_kind_check to accept 'single_input' — the
-- shidduch right rail's read-side panel (AC 5). A single_input row is
-- target_type = 'shidduch', scope = 'shidduch', reference_link_id = null,
-- which already satisfies the existing interactions_scope_link_check
-- disjunct for shidduch-targeted rows (01_tables.sql:582) — untouched here.
--
-- MANUAL ADJUSTMENTS (see AGENTS.md; entity_files / resume_photos
-- precedent, migrations 20260729070301 / 20260730041150):
-- 1. The raw diff re-emitted the unrelated `reference_links_summary`,
--    `shadchan_stats`, `shidduchim_summary` and `singles_summary` views
--    (drop + recreate, with `security_invoker` stripped, this repo's known
--    `db diff`-and-views quirk). This story does not touch any of those
--    four views, `interactions`-derived or otherwise, so that block was
--    removed rather than carried — recreating them here would be a no-op
--    at best and, since `db diff` never re-emits `security_invoker`, an RLS
--    regression at worst if that half were forgotten.

alter table "public"."interactions" drop constraint "interactions_kind_check";

alter table "public"."interactions" add constraint "interactions_kind_check" CHECK ((kind = ANY (ARRAY['note'::text, 'call_logged'::text, 'status_change'::text, 'merge'::text, 'link_created'::text, 'link_removed'::text, 'single_input'::text]))) not valid;

alter table "public"."interactions" validate constraint "interactions_kind_check";
