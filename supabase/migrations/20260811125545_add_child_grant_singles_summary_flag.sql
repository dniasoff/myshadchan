drop view if exists "public"."singles_summary";

create or replace view "public"."singles_summary" with (security_invoker = on) as  SELECT c.id,
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
    (EXISTS ( SELECT 1
           FROM public.child_grants g
          WHERE ((g.target_single_id = c.id) AND (g.grantee_account_id = public.current_context_id()) AND (g.status = 'accepted'::text) AND (g.proposer_account_id <> public.current_context_id())))) AS is_shared_with_me,
    count(s.id) AS total_shidduchim,
    count(s.id) FILTER (WHERE (s.pipeline_state = ANY (ARRAY['new'::public.pipeline_state, 'look_into'::public.pipeline_state, 'not_sure'::public.pipeline_state]))) AS open_shidduchim
   FROM (public.singles c
     LEFT JOIN public.shidduchim s ON ((s.single_id = c.id)))
  GROUP BY c.id;

-- Recreating the view dropped its owned grants (06_grants.sql). Restore them,
-- mirroring the declarative grants for singles_summary exactly.
revoke all on table public.singles_summary from anon, authenticated;
grant select on table public.singles_summary to authenticated;
grant all on table public.singles_summary to service_role;



