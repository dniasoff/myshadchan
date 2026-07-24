create or replace view "public"."children_summary" as  SELECT c.id,
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
   FROM (public.children c
     LEFT JOIN public.shidduchim s ON ((s.child_id = c.id)))
  GROUP BY c.id;


create or replace view "public"."shadchan_stats" as  SELECT sh.id,
    sh.account_id,
    count(s.id) AS nb_suggestions,
    count(s.id) FILTER (WHERE (s.pipeline_state <> 'new'::public.pipeline_state)) AS nb_progressed,
    count(s.id) FILTER (WHERE (s.pipeline_state = 'yes'::public.pipeline_state)) AS nb_reached_yes
   FROM (public.shadchanim sh
     LEFT JOIN public.shidduchim s ON ((s.shadchan_id = sh.id)))
  GROUP BY sh.id;


-- ---------------------------------------------------------------------------
-- MANUAL ADJUSTMENTS (see AGENTS.md). `supabase db diff` emits none of the
-- following, and none of it is cosmetic.
--
-- 1. It drops WITH (security_invoker = on) when it writes a view. Without it
--    these views execute as their owner and RLS never runs.
alter view "public"."children_summary" set (security_invoker = on);
alter view "public"."shadchan_stats" set (security_invoker = on);

-- 2. It does not diff view privileges at all, so a new view keeps only the
--    schema default privileges — which grant anon and would leave these
--    shidduchim-domain reads open to the anon role. Revoke anon, keep SELECT
--    for authenticated.
revoke all on table "public"."children_summary" from "anon", "authenticated";
grant select on table "public"."children_summary" to "authenticated";
grant all on table "public"."children_summary" to "service_role";

revoke all on table "public"."shadchan_stats" from "anon", "authenticated";
grant select on table "public"."shadchan_stats" to "authenticated";
grant all on table "public"."shadchan_stats" to "service_role";
