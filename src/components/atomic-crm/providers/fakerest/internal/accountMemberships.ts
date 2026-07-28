import type { DataProvider, UserIdentity } from "ra-core";

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
