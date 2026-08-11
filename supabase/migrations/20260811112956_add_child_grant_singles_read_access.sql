-- Child grants, RLS increment 1: consume an ACCEPTED grant to read a single.
--
-- Until now no RLS policy anywhere consulted a `child_grants` row to grant
-- cross-household access, so accepting a grant granted nothing. This adds the
-- FIRST consuming policy — an ADDITIVE SELECT-only policy on `public.singles`
-- (the two existing singles policies in 05_policies.sql are untouched):
-- a grantee household that has accepted a grant for a proposer's single may
-- read exactly that single's row.
--
-- status = 'accepted' is explicit and LITERAL, not inferred from
-- grantee_account_id being non-null: sever_child_grant() (02_functions.sql)
-- sets status = 'severed' but never NULLs grantee_account_id, so checking only
-- that column would keep a severed grant leak-open. The `<> 'single'` role
-- guard closes the read-only-structural boundary: a single-role member inside
-- the grantee's OWN household still sees zero rows for this single.
create policy "Singles readable via accepted grant"
  on "public"."singles"
  as permissive
  for select
  to authenticated
using (((EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.target_single_id = singles.id) AND (g.grantee_account_id = public.current_context_id()) AND (g.status = 'accepted'::text)))) AND (public.current_member_role() <> 'single'::text)));