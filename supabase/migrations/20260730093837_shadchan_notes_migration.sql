drop view if exists "public"."reference_links_summary";

drop view if exists "public"."shadchan_stats";

drop view if exists "public"."shidduchim_summary";

drop view if exists "public"."singles_summary";

-- Story 5.9 (AC 2): copy every non-null, non-empty shadchanim.notes value into
-- interactions (target_type = 'shadchan', scope = 'account', kind = 'note')
-- BEFORE the column is dropped below, or the data is gone before it is
-- copied. actor_member_id is left for set_interaction_actor_member_id() to
-- resolve (NULL here, since this migration runs with no authenticated
-- caller) — consistent with every other trigger-set column on this table.
insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
select account_id, 'shadchan', id, 'account', 'note', notes
from public.shadchanim
where notes is not null and notes <> '';

alter table "public"."shadchanim" drop column "notes";

create or replace view "public"."reference_links_summary" as  SELECT rl.id,
    rl.account_id,
    rl.created_at,
    rl.reference_id,
    rl.shidduchim_id,
    rl.resume_id,
    rl.call_status,
    rl.what_they_said,
    rl.conversation_log,
    rl.relationship_override,
    COALESCE(rl.relationship_override, r.relationship) AS effective_relationship,
    COALESCE(jsonb_array_length(rl.conversation_log), 0) AS conversation_log_count,
    r.name_en AS reference_name_en,
    r.name_he AS reference_name_he,
    r.phone AS reference_phone,
    s.name_en AS shidduch_name_en,
    s.name_he AS shidduch_name_he,
    s.pipeline_state AS shidduch_pipeline_state,
    s.visibility AS shidduch_visibility,
    s.single_id,
    c.first_name_en AS single_first_name_en,
    c.first_name_he AS single_first_name_he
   FROM (((public.reference_links rl
     LEFT JOIN public."references" r ON ((r.id = rl.reference_id)))
     LEFT JOIN public.shidduchim s ON ((s.id = rl.shidduchim_id)))
     LEFT JOIN public.singles c ON ((c.id = s.single_id)));


create or replace view "public"."shadchan_stats" as  SELECT sh.id,
    sh.account_id,
    count(s.id) AS nb_suggestions,
    count(s.id) FILTER (WHERE (s.pipeline_state <> 'new'::public.pipeline_state)) AS nb_progressed,
    count(s.id) FILTER (WHERE (s.pipeline_state = 'yes'::public.pipeline_state)) AS nb_reached_yes
   FROM (public.shadchanim sh
     LEFT JOIN public.shidduchim s ON ((s.shadchan_id = sh.id)))
  GROUP BY sh.id;


create or replace view "public"."shidduchim_summary" as  SELECT s.id,
    s.account_id,
    s.created_at,
    s.single_id,
    s.shadchan_id,
    s.name_en,
    s.name_he,
    s.father_en,
    s.father_he,
    s.mother_en,
    s.mother_he,
    s.seminary_en,
    s.seminary_he,
    s.shul_en,
    s.shul_he,
    s.location_en,
    s.location_he,
    s.age,
    s.height,
    s.dob,
    s.background,
    s.marital_status,
    s.existing_children_note,
    s.pipeline_state,
    s.first_suggested_by,
    s.first_suggested_at,
    s.redt_date,
    s.close_reason,
    s.origin,
    s.owner_member_id,
    s.visibility,
    s.index,
    sh.name AS shadchan_name,
    sh.name_he AS shadchan_name_he,
    c.first_name_en AS single_first_name_en,
    c.first_name_he AS single_first_name_he,
    c.last_name_en AS single_last_name_en,
    c.last_name_he AS single_last_name_he,
    count(DISTINCT rl.id) AS nb_references,
    count(DISTINCT r.id) AS nb_redts,
    COALESCE(max(cat.catch_count), (0)::bigint) AS catch_count
   FROM (((((public.shidduchim s
     LEFT JOIN public.shadchanim sh ON ((sh.id = s.shadchan_id)))
     LEFT JOIN public.singles c ON ((c.id = s.single_id)))
     LEFT JOIN public.reference_links rl ON ((rl.shidduchim_id = s.id)))
     LEFT JOIN public.redts r ON ((r.shidduchim_id = s.id)))
     LEFT JOIN public.shidduchim_catch_summary cat ON ((cat.shidduchim_id = s.id)))
  GROUP BY s.id, sh.name, sh.name_he, c.first_name_en, c.first_name_he, c.last_name_en, c.last_name_he;


create or replace view "public"."singles_summary" as  SELECT c.id,
    c.account_id,
    c.created_at,
    c.first_name_en,
    c.first_name_he,
    c.last_name_en,
    c.last_name_he,
    c.gender,
    c.dob,
    c.community,
    c.status,
    c.member_id,
    count(s.id) AS total_shidduchim,
    count(s.id) FILTER (WHERE (s.pipeline_state = ANY (ARRAY['new'::public.pipeline_state, 'look_into'::public.pipeline_state, 'not_sure'::public.pipeline_state]))) AS open_shidduchim
   FROM (public.singles c
     LEFT JOIN public.shidduchim s ON ((s.single_id = c.id)))
  GROUP BY c.id;

-- MANUAL ADJUSTMENTS (see AGENTS.md). `supabase db diff` emits none of the
-- following, and none of it is cosmetic.
--
-- Dropping `shadchanim.notes` is not the last column, so `shidduchim_summary`
-- (which reads `sh.name`/`sh.name_he`) cannot be CREATE OR REPLACE'd in
-- place — the diff above drops and recreates it, and that drop takes three
-- sibling views down with it (`reference_links_summary`, `shadchan_stats`,
-- `singles_summary`), none of which reference `notes` at all. This is
-- `db diff`'s dependency tracking on `public.shadchanim`/`public.shidduchim`,
-- the same shape `20260730011428_shidduch_overview_fields.sql`'s own MANUAL
-- ADJUSTMENTS block already documented for this exact quartet of views — not
-- anything this story asked to change. All four come back above exactly as
-- they were (shadchan_stats keeps its pre-Story-5.9 three columns; Task 2b's
-- widening is a separate migration), plus the two things `CREATE OR REPLACE
-- VIEW`/a fresh `CREATE VIEW` never carries forward:
--
-- 1. It drops `WITH (security_invoker = on)` when it writes a view. Without
--    it these views execute as their owner and RLS never runs — a
--    cross-account read.
alter view "public"."reference_links_summary" set (security_invoker = on);
alter view "public"."shadchan_stats" set (security_invoker = on);
alter view "public"."shidduchim_summary" set (security_invoker = on);
alter view "public"."singles_summary" set (security_invoker = on);

-- 2. It does not diff view privileges at all, so a dropped-and-recreated
--    view keeps only the schema default privileges, not the grants
--    `06_grants.sql` declares. Re-issue them verbatim so `authenticated`
--    is not silently locked out of the board / roster / reference-diligence
--    reads these views back.
revoke all on table "public"."shidduchim_summary" from "anon";
grant all on table "public"."shidduchim_summary" to "authenticated";
grant all on table "public"."shidduchim_summary" to "service_role";

revoke all on table "public"."reference_links_summary" from "anon", "authenticated";
grant select on table "public"."reference_links_summary" to "authenticated";
grant all on table "public"."reference_links_summary" to "service_role";

revoke all on table "public"."singles_summary" from "anon", "authenticated";
grant select on table "public"."singles_summary" to "authenticated";
grant all on table "public"."singles_summary" to "service_role";

revoke all on table "public"."shadchan_stats" from "anon", "authenticated";
grant select on table "public"."shadchan_stats" to "authenticated";
grant all on table "public"."shadchan_stats" to "service_role";


