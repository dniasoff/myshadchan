import type { DataProvider, Identifier, UserIdentity } from "ra-core";

import type { AccountMember } from "../../../types";

const PAGE_ALL = { page: 1, perPage: 10_000 } as const;

// Exported: also used by personas.ts's hasLinkedSingle(), which sorts a
// singles lookup the same way this module sorts memberships.
export const SORT_BY_ID = { field: "id", order: "ASC" } as const;

export type GetIdentity = () => Promise<
  Pick<UserIdentity, "id"> | null | undefined
>;

/**
 * Shared FakeRest fetch shape for "every ACTIVE membership row this caller
 * holds" — used identically by `./contexts.ts` (`public.my_contexts()`
 * mirror) and `./personas.ts` (`public.my_personas()` mirror), since both
 * SQL functions filter `account_members` on the exact same
 * `user_id = auth.uid() and status = 'active'` predicate. Extracted here
 * rather than duplicated in both files (2.4 review finding #7,
 * `.claude/rules/coding-style.md`'s DRY rule).
 */
export const activeMembershipsFor = async (
  baseDataProvider: DataProvider,
  userId: string,
): Promise<AccountMember[]> => {
  const { data } = await baseDataProvider.getList<AccountMember>(
    "account_members",
    {
      filter: { user_id: userId, status: "active" },
      pagination: PAGE_ALL,
      sort: SORT_BY_ID,
    },
  );
  return data;
};

/**
 * Story 3.6 — the FakeRest counterpart to `public.current_member_id()`
 * (Story 3.5) and `can_moderate_note()`'s owning-role branch: "the caller's
 * own ACTIVE membership row in one specific account." `accountId` is the
 * caller's current active context (`dataProvider.ts`'s closure-local
 * `activeAccountId`, possibly `null`); falls back to the login's first
 * membership when unset, mirroring `activate_first_context_trigger` the
 * same way `./contexts.ts`'s `getMyContexts` and `./invites.ts`'s
 * `resolveActiveAccountId` already do. Returns `null` exactly when
 * `current_member_id()` would return `NULL` — no active membership at all,
 * or none in the resolved account.
 */
export const resolveContextMembership = async (
  baseDataProvider: DataProvider,
  userId: string,
  accountId: Identifier | null,
): Promise<AccountMember | null> => {
  const memberships = await activeMembershipsFor(baseDataProvider, userId);
  const resolvedAccountId = accountId ?? memberships[0]?.account_id ?? null;
  return (
    memberships.find(
      (m) => String(m.account_id) === String(resolvedAccountId),
    ) ?? null
  );
};
