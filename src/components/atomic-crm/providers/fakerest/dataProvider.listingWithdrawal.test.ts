import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";
import type { Db } from "./dataGenerator/types";

/**
 * Story 9.3 — end-to-end FakeRest wiring: `dataProvider.delete("listings",
 * ...)` actually calls the withdrawal-lock trigger mirror
 * (`internal/listingWithdrawal.ts`'s own unit suite pins the pure logic;
 * this file proves the WIRING — the `delete()` override in `dataProvider.ts`
 * — actually reaches it), and `dataProvider.consentToRepublishListing()` is
 * exposed and reaches the RPC mirror. Mirrors
 * `dataProvider.redtViaConnection.test.ts`'s own fixture shape.
 */

const HOUSEHOLD_ACCOUNT_ID = 1;
const PARENT_MEMBER_ID = 1;
const SINGLE_MEMBER_ID = 2;
const SELF_MANAGER_MEMBER_ID = 3;
const SINGLE_LOGIN_SINGLE_ID = 1;
const SELF_MANAGED_SINGLE_ID = 2;
const LISTING_LOGIN_SINGLE_ID = 1;
const LISTING_SELF_MANAGED_ID = 2;

const asParent = { id: 0 };
const asSingle = { id: 1 };
const asSelfManager = { id: 2 };

const LOCKS_LIST_PARAMS = {
  pagination: { page: 1, perPage: 10 },
  sort: { field: "id", order: "ASC" as const },
};

const makeProvider = (db: Db, identity: { id: number } = asParent) =>
  createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => identity },
  });

function seedFixture(db: Db): void {
  db.accounts = [
    {
      id: HOUSEHOLD_ACCOUNT_ID,
      name: "Withdrawal Household",
      transparency_level: "shared",
      kind: "household",
      default_thread_visibility: "open",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  db.account_members = [
    {
      id: PARENT_MEMBER_ID,
      account_id: HOUSEHOLD_ACCOUNT_ID,
      user_id: "0",
      role: "parent_admin",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: SINGLE_MEMBER_ID,
      account_id: HOUSEHOLD_ACCOUNT_ID,
      user_id: "1",
      role: "single",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: SELF_MANAGER_MEMBER_ID,
      account_id: HOUSEHOLD_ACCOUNT_ID,
      user_id: "2",
      role: "self_manager",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  db.singles = [
    {
      id: SINGLE_LOGIN_SINGLE_ID,
      account_id: HOUSEHOLD_ACCOUNT_ID,
      first_name_en: "Login Single",
      status: "active",
      member_id: SINGLE_MEMBER_ID,
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: SELF_MANAGED_SINGLE_ID,
      account_id: HOUSEHOLD_ACCOUNT_ID,
      first_name_en: "Self Managed",
      status: "active",
      member_id: SELF_MANAGER_MEMBER_ID,
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  db.listings = [
    {
      id: LISTING_LOGIN_SINGLE_ID,
      account_id: HOUSEHOLD_ACCOUNT_ID,
      listing_type: "single",
      single_id: SINGLE_LOGIN_SINGLE_ID,
      single_first_name_en: "Login Single",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: LISTING_SELF_MANAGED_ID,
      account_id: HOUSEHOLD_ACCOUNT_ID,
      listing_type: "single",
      single_id: SELF_MANAGED_SINGLE_ID,
      single_first_name_en: "Self Managed",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  db.listing_withdrawal_locks = [];
}

describe("FakeRest wiring — listings delete() triggers the withdrawal lock (Story 9.3)", () => {
  it("AC-1/creates the lock: a plain `single` deleting their OWN listing creates a lock row", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    const dataProvider = makeProvider(db, asSingle);

    // Act
    await dataProvider.delete("listings", { id: LISTING_LOGIN_SINGLE_ID });

    // Assert — read back through the dataProvider, not the seed `db`
    // reference (the engine owns its own internal store once constructed).
    const { data: locks } = await dataProvider.getList(
      "listing_withdrawal_locks",
      { ...LOCKS_LIST_PARAMS, filter: { single_id: SINGLE_LOGIN_SINGLE_ID } },
    );
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({
      single_id: SINGLE_LOGIN_SINGLE_ID,
      account_id: HOUSEHOLD_ACCOUNT_ID,
    });
  });

  it("AC-6: a self_manager deleting their OWN listing creates NO lock row", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    const dataProvider = makeProvider(db, asSelfManager);

    // Act
    await dataProvider.delete("listings", { id: LISTING_SELF_MANAGED_ID });

    // Assert
    const { total } = await dataProvider.getList("listing_withdrawal_locks", {
      ...LOCKS_LIST_PARAMS,
      filter: { single_id: SELF_MANAGED_SINGLE_ID },
    });
    expect(total).toBe(0);
  });

  it("does not blow up deleting a non-listings resource (the hook is listings-only)", async () => {
    // Arrange
    const db = generateData();
    seedFixture(db);
    const dataProvider = makeProvider(db, asParent);

    // Act / Assert
    await expect(
      dataProvider.delete("singles", { id: SELF_MANAGED_SINGLE_ID }),
    ).resolves.toBeDefined();
  });
});

describe("FakeRest wiring — consentToRepublishListing() (Story 9.3, AC-4)", () => {
  it("is a no-op when called by the parent_admin, then clears the lock when called by the single themselves", async () => {
    // Arrange — ONE provider instance for the whole test: `createDataProvider`
    // snapshots `db` into its own internal store at construction time
    // (`dataProvider.redtViaConnection.test.ts`'s own comment on this), so
    // two SEPARATE instances built from the same `db` variable at different
    // times do NOT see each other's writes. Swapping `identity.current`
    // (never `switchActiveContext`, so `resolveContextMembership`'s own
    // per-caller fallback resolves each identity's own membership fresh) is
    // what simulates "a different user calls next" against the SAME store.
    const db = generateData();
    seedFixture(db);
    const identity = { current: asSingle as { id: number } };
    const dataProvider = createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: { getIdentity: async () => identity.current },
    });

    await dataProvider.delete("listings", { id: LISTING_LOGIN_SINGLE_ID });

    // Act — the wrong caller first.
    identity.current = asParent;
    await dataProvider.consentToRepublishListing(SINGLE_LOGIN_SINGLE_ID);

    // Assert — still locked.
    const { total: stillLocked } = await dataProvider.getList(
      "listing_withdrawal_locks",
      { ...LOCKS_LIST_PARAMS, filter: { single_id: SINGLE_LOGIN_SINGLE_ID } },
    );
    expect(stillLocked).toBe(1);

    // Act — the single themselves.
    identity.current = asSingle;
    await dataProvider.consentToRepublishListing(SINGLE_LOGIN_SINGLE_ID);

    // Assert — cleared.
    const { total: clearedNow } = await dataProvider.getList(
      "listing_withdrawal_locks",
      { ...LOCKS_LIST_PARAMS, filter: { single_id: SINGLE_LOGIN_SINGLE_ID } },
    );
    expect(clearedNow).toBe(0);
  });
});
