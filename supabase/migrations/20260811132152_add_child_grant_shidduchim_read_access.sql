-- Child grants, RLS increment 3: an accepted grantee may read the PROPOSER's
-- shidduchim rows for the granted single.
--
-- ADDITIVE, SELECT-only policy on `public.shidduchim` (the two existing
-- policies — "Shidduchim scoped to account" and "Shidduchim visible to single"
-- — are untouched). `status = 'accepted'` is explicit and LITERAL, not
-- inferred from grantee_account_id being non-null: sever_child_grant()
-- (02_functions.sql) sets status = 'severed' but never NULLs grantee_account_id,
-- so checking only that column would keep a severed grant leak-open. The
-- `<> 'single'` role guard closes the read-only-structural boundary: a
-- single-role member inside the accepted grantee's OWN household still sees
-- zero rows for the given single.
--
-- This opens the BASE shidduchim row only. `close_reason` stays NULL for the
-- grantee by design — the column is omitted from the column-by-column SELECT
-- grant in 06_grants.sql, and its sole reader is the SECURITY DEFINER
-- shidduch_close_reason(), whose guard is proposer-account-scoped and stays
-- so (fail-closed for a grantee).
create policy "Shidduchim readable via accepted grant"
  on "public"."shidduchim"
  as permissive
  for select
  to authenticated
using (((EXISTS ( SELECT 1
   FROM public.child_grants g
  WHERE ((g.target_single_id = shidduchim.single_id) AND (g.grantee_account_id = public.current_context_id()) AND (g.status = 'accepted'::text)))) AND (public.current_member_role() <> 'single'::text)));