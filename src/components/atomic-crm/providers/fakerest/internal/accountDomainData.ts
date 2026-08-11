import type { DataProvider, Identifier } from "ra-core";

import type { AccountMember } from "../../../types";
import { SORT_BY_ID } from "./accountMemberships";

/**
 * Every domain resource FakeRest actually models — mirrors
 * `public.account_has_domain_data()` (`supabase/schemas/02_functions.sql`,
 * 2.5 review finding #1), which still checks every table it always has.
 * `identity_signals` exists in the SQL schema (one of
 * `enforce_household_scope()`'s household-only tables — 11 of them as of
 * Story 3.14; `interactions`/`tasks` no longer carry that trigger, but they
 * stay in this list because `account_has_domain_data()` still checks them)
 * but has no FakeRest counterpart at all — it is never exposed through the
 * dataProvider layer (no `Db["identity_signals"]`, no read/write site
 * anywhere in `src/`), so there is nothing to check here for it. Keep this
 * list in lockstep with the SQL function's table list by hand.
 */
const DOMAIN_RESOURCES = [
  "singles",
  "shadchanim",
  "references",
  "shidduchim",
  "resumes",
  "reference_links",
  "date_records",
  "redts",
  "shidduch_education",
  "shidduchim_external_links",
  "interactions",
  "inbox_items",
  "tasks",
] as const;

/**
 * FakeRest mirror of `public.account_has_domain_data()`: does this account
 * still hold any row in a household-only domain table, regardless of
 * status — an archived/paused row is still data per AC-3's "remains
 * auditable".
 */
export async function accountHasDomainData(
  baseDataProvider: DataProvider,
  accountId: Identifier,
): Promise<boolean> {
  for (const resource of DOMAIN_RESOURCES) {
    const { data } = await baseDataProvider.getList(resource, {
      filter: { account_id: accountId },
      pagination: { page: 1, perPage: 1 },
      sort: SORT_BY_ID,
    });
    if (data.length > 0) return true;
  }
  return false;
}

/**
 * FakeRest mirror of `public.guard_persona_removal()` (2.5 review finding
 * #1, BLOCKER): refuses archiving `membershipId` when it is the account's
 * LAST active member (no other active member, of any role, could ever
 * reach it again) AND the account still holds any domain row. Deliberately
 * account-scoped, not a global "is this your only persona anywhere" check —
 * see the SQL function's own comment for why.
 */
export async function guardPersonaRemoval(
  baseDataProvider: DataProvider,
  membershipId: Identifier,
  accountId: Identifier,
): Promise<void> {
  const { data: activeAccountMembers } =
    await baseDataProvider.getList<AccountMember>("account_members", {
      filter: { account_id: accountId, status: "active" },
      pagination: { page: 1, perPage: 10_000 },
      sort: SORT_BY_ID,
    });
  const hasOtherMember = activeAccountMembers.some(
    (m) => String(m.id) !== String(membershipId),
  );

  if (
    !hasOtherMember &&
    (await accountHasDomainData(baseDataProvider, accountId))
  ) {
    throw new Error(
      "cannot remove your last active membership of this account",
    );
  }
}
