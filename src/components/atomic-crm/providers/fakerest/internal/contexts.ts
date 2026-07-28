import type { DataProvider, Identifier, UserIdentity } from "ra-core";

import type { Account, AccountMember, MyContext } from "../../../types";

const PAGE_ALL = { page: 1, perPage: 10_000 } as const;
const SORT_BY_ID = { field: "id", order: "ASC" } as const;

type GetIdentity = () => Promise<Pick<UserIdentity, "id"> | null | undefined>;

/**
 * FakeRest mirrors of `public.my_contexts()` / `public.set_active_context()`
 * (2.4 AC-5/AC-6). One row per account the caller holds an ACTIVE
 * membership in — never one row per persona (contrast `./personas.ts`'s
 * `getMyPersonas`, which is deliberately persona-shaped). The active
 * context itself is held by the caller as a closure-local `activeAccountId`
 * (next to `fakeDemo` in `dataProvider.ts`, per 2.1's Dev Notes that Story
 * 2.1 added no fakerest `member_state` emulation) — this module only reads
 * and validates it through the passed accessor/setter, it never owns the
 * state itself.
 */

const activeMembershipsFor = async (
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

/** FakeRest mirror of `public.my_contexts()` — derives, never stores. */
export async function getMyContexts(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
): Promise<MyContext[]> {
  const identity = await getIdentity();
  if (identity == null) {
    return [];
  }
  const userId = String(identity.id);
  const memberships = await activeMembershipsFor(baseDataProvider, userId);
  if (memberships.length === 0) {
    return [];
  }

  // Mirrors activate_first_context_trigger: a login with any membership
  // always has a live active context, never "none yet". FakeRest has no
  // trigger to bootstrap member_state, so the first membership found (by
  // id) is treated as active until switchActiveContext() is called.
  const activeAccountId = getActiveAccountId() ?? memberships[0].account_id;

  const contexts: MyContext[] = [];
  for (const membership of memberships) {
    const { data: account } = await baseDataProvider.getOne<Account>(
      "accounts",
      { id: membership.account_id },
    );
    contexts.push({
      account_id: membership.account_id,
      kind: account.kind,
      name: account.name,
      role: membership.role,
      is_active: String(membership.account_id) === String(activeAccountId),
    });
  }
  return contexts;
}

/**
 * FakeRest mirror of `public.set_active_context()` — raises rather than
 * silently no-op-ing when the caller does not hold a live active membership
 * of `accountId`, matching the SQL function's own guard.
 */
export async function switchActiveContext(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  accountId: Identifier,
  setActiveAccountId: (accountId: Identifier) => void,
): Promise<void> {
  const identity = await getIdentity();
  if (identity == null) {
    throw new Error("switchActiveContext requires a signed-in user");
  }
  const userId = String(identity.id);
  const memberships = await activeMembershipsFor(baseDataProvider, userId);
  const holdsMembership = memberships.some(
    (membership) => String(membership.account_id) === String(accountId),
  );
  if (!holdsMembership) {
    throw new Error(`no active membership of account ${accountId}`);
  }
  setActiveAccountId(accountId);
}
