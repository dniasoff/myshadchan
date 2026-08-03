import type { DataProvider, Identifier } from "ra-core";

import type { Listing, ListingWithdrawalLock, Single } from "../../../types";
import {
  resolveContextMembership,
  SORT_BY_ID,
  type GetIdentity,
} from "./accountMemberships";

const PAGE_ONE = { page: 1, perPage: 1 } as const;

/**
 * FakeRest mirror of the AFTER DELETE trigger `lock_listing_on_single_
 * withdrawal()` (02_functions.sql, Story 9.3). FakeRest has no triggers, so
 * the "listings" delete handler in `dataProvider.ts` calls this explicitly
 * right after a delete succeeds — the same "logic that only exists as a
 * Postgres trigger/function gets a hand-written FakeRest twin" convention
 * `./shidduchCatch.ts`/`./referenceMatch.ts` already establish for this
 * directory.
 *
 * Deliberately checks `role === 'single'` EXACTLY, never `'self_manager'`
 * (AC-6) — mirrors the SQL trigger's own predicate precisely. Widening this
 * "for consistency" with the publish policy's role check would silently
 * break AC-6: a self-manager's own withdrawal must never create a lock,
 * because there is no separate manager to protect against.
 */
export async function lockListingOnSingleWithdrawal(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  deletedListing: Listing,
): Promise<void> {
  if (
    deletedListing.listing_type !== "single" ||
    deletedListing.single_id == null
  ) {
    return;
  }

  const identity = await getIdentity();
  if (identity == null) return;
  const userId = String(identity.id);
  const membership = await resolveContextMembership(
    baseDataProvider,
    userId,
    getActiveAccountId(),
  );
  if (!membership || membership.role !== "single") return;

  // Mirrors the trigger's own join: `s.member_id = am.id and s.id =
  // old.single_id` — the deleting caller must themselves BE the single this
  // listing is about, not merely a `single`-role member of the household.
  const { data: singles } = await baseDataProvider.getList<Single>("singles", {
    filter: { id: deletedListing.single_id, member_id: membership.id },
    pagination: PAGE_ONE,
    sort: SORT_BY_ID,
  });
  if (singles.length === 0) return;

  // `on conflict (single_id) do nothing` — a lock already present (a
  // republish-then-withdraw-again cycle) must not raise or duplicate.
  const { data: existingLocks } =
    await baseDataProvider.getList<ListingWithdrawalLock>(
      "listing_withdrawal_locks",
      {
        filter: { single_id: deletedListing.single_id },
        pagination: PAGE_ONE,
        sort: SORT_BY_ID,
      },
    );
  if (existingLocks.length > 0) return;

  // `id` mirrors `single_id`, matching the real provider's own virtual-id
  // shape for this table (types.ts's `ListingWithdrawalLock` doc comment;
  // `dataProvider.ts`'s `PRIMARY_KEYS` config) — the table itself has no
  // `id` column.
  await baseDataProvider.create<ListingWithdrawalLock>(
    "listing_withdrawal_locks",
    {
      data: {
        id: deletedListing.single_id,
        single_id: deletedListing.single_id,
        account_id: deletedListing.account_id,
        locked_at: new Date().toISOString(),
      },
    },
  );
}

/**
 * Review fix (F3): FakeRest mirror of the amended "Single listings insert"
 * policy's added `not exists (... listing_withdrawal_locks ...)` clause
 * (Story 9.3, AC-2). Postgres refuses the INSERT outright (a row-security
 * violation) the moment a lock row exists for the target single; FakeRest
 * has no RLS, so `dataProvider.create("listings", ...)`'s own `single`
 * branch calls this explicitly, right where the real policy's WITH CHECK
 * would fire, and throws to match. `PublishSingleListingSection.tsx`'s
 * `handlePublish` never parses this error's text — it catches ANY thrown
 * error and re-reads `listing_withdrawal_locks` itself to decide which
 * message to show (`.claude/rules/security-triggers.md`'s own caution
 * against treating error-message shape as a stable contract), so this
 * message only needs to be truthy, not exactly matched anywhere.
 */
export async function assertListingInsertNotLocked(
  baseDataProvider: DataProvider,
  singleId: Identifier,
  accountId: Identifier,
): Promise<void> {
  const { data: locks } = await baseDataProvider.getList<ListingWithdrawalLock>(
    "listing_withdrawal_locks",
    {
      filter: { single_id: singleId, account_id: accountId },
      pagination: PAGE_ONE,
      sort: SORT_BY_ID,
    },
  );
  if (locks.length > 0) {
    throw new Error(
      "this single withdrew this listing and must consent again before it can be republished",
    );
  }
}

/**
 * FakeRest mirror of `public.consent_to_republish_listing()` (Story 9.3,
 * AC-4). Fails CLOSED — a silent no-op for a wrong caller (wrong role, or a
 * `single_id` that is not their own), never a thrown error — matching the
 * real RPC's own AD-19-style contract (never leak whether a lock exists to
 * a caller who has no business asking) and the "scoped to the CALLER's own
 * active account" boundary that makes AC-7's cross-account case a no-op too.
 */
export async function consentToRepublishListing(
  baseDataProvider: DataProvider,
  getIdentity: GetIdentity,
  getActiveAccountId: () => Identifier | null,
  singleId: Identifier,
): Promise<void> {
  const identity = await getIdentity();
  if (identity == null) return;
  const userId = String(identity.id);
  const membership = await resolveContextMembership(
    baseDataProvider,
    userId,
    getActiveAccountId(),
  );
  if (
    !membership ||
    (membership.role !== "single" && membership.role !== "self_manager")
  ) {
    return;
  }

  const { data: singles } = await baseDataProvider.getList<Single>("singles", {
    filter: { id: singleId, member_id: membership.id },
    pagination: PAGE_ONE,
    sort: SORT_BY_ID,
  });
  if (singles.length === 0) return;

  const { data: locks } = await baseDataProvider.getList<ListingWithdrawalLock>(
    "listing_withdrawal_locks",
    {
      filter: { single_id: singleId, account_id: membership.account_id },
      pagination: PAGE_ONE,
      sort: SORT_BY_ID,
    },
  );
  const lock = locks[0];
  if (!lock) return;

  await baseDataProvider.delete("listing_withdrawal_locks", {
    id: lock.id,
    previousData: lock,
  });
}
