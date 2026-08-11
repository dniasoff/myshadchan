-- Revive the two child_grants SELECT policies, which have been dead since
-- Story 13.1 shipped.
--
-- `authenticated` never held SELECT on this table — 06_grants.sql never
-- mentioned it — and privileges are checked before RLS, so both policies were
-- unreachable and SingleGrantManagement.tsx:281's getList("child_grants")
-- failed with "permission denied for table child_grants" for every caller,
-- parent_admin included. The grant lifecycle's WRITES were unaffected because
-- they all go through SECURITY DEFINER RPCs, which is why this stayed hidden:
-- creating and accepting a grant worked, only listing them did not.
--
-- ORDER IS LOAD-BEARING, for the same reason as 20260811090000: the grant
-- ACTIVATES dormant policies, so the policies must be correct first. Both were
-- account-scoped without the `current_member_role() <> 'single'` conjunct that
-- every other account-scoped policy in 05_policies.sql carries, so granting
-- SELECT alone would have let a single-role member read every grant made by
-- their household, including ones concerning their siblings. The policy
-- replacements below come first and add that guard.
drop policy if exists "Child grants visible to proposer" on public.child_grants;
create policy "Child grants visible to proposer" on public.child_grants
    for select to authenticated
    using (
        proposer_account_id = public.current_context_id()
        and public.current_member_role() <> 'single'
    );

drop policy if exists "Child grants visible to grantee when accepted" on public.child_grants;
create policy "Child grants visible to grantee when accepted" on public.child_grants
    for select to authenticated
    using (
        grantee_account_id = public.current_context_id()
        and status = 'accepted'
        and public.current_member_role() <> 'single'
    );

-- SELECT only: all writes stay on the SECURITY DEFINER RPCs.
revoke all on table public.child_grants from anon;
grant select on table public.child_grants to authenticated;
grant all on table public.child_grants to service_role;
grant all on sequence public.child_grants_id_seq to service_role;
