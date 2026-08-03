import type { DataProvider, Identifier } from "ra-core";
import { describe, expect, it } from "vitest";

import type {
  AccountMember,
  Listing,
  ListingWithdrawalLock,
  Single,
} from "../../../types";
import {
  consentToRepublishListing,
  lockListingOnSingleWithdrawal,
} from "./listingWithdrawal";

/**
 * FakeRest mirrors of Story 9.3's dignity-floor lock: the AFTER DELETE
 * trigger (`lock_listing_on_single_withdrawal()`) and the sole-consent RPC
 * (`consent_to_republish_listing()`, both `02_functions.sql`). Pins the same
 * rules `supabase/tests/listings.sql` proves against the real database —
 * every sibling FakeRest `internal/*.ts` that owns a workflow has its own
 * unit suite (`connections.test.ts`'s own precedent, and this module's own
 * exact harness shape).
 */

type Db = {
  account_members: AccountMember[];
  singles: Single[];
  listing_withdrawal_locks: ListingWithdrawalLock[];
};

const emptyDb = (): Db => ({
  account_members: [],
  singles: [],
  listing_withdrawal_locks: [],
});

/** A minimal in-memory DataProvider — getList (equality filter only),
 * create (id as given) and delete by id — enough to serve
 * listingWithdrawal.ts's exact call shapes. Mirrors `connections.test.ts`'s
 * own harness exactly. */
const buildProvider = (db: Db): DataProvider => {
  const tableFor = (resource: string): Array<Record<string, unknown>> => {
    const table = db[resource as keyof Db] as
      Array<Record<string, unknown>> | undefined;
    if (!table) throw new Error(`Unknown resource: ${resource}`);
    return table;
  };

  return {
    getList: async (
      resource: string,
      params: { filter?: Record<string, unknown> },
    ) => {
      const filter = params.filter ?? {};
      const data = tableFor(resource).filter((row) =>
        Object.entries(filter).every(
          ([key, value]) => String(row[key]) === String(value),
        ),
      );
      return { data, total: data.length };
    },
    create: async (
      resource: string,
      params: { data: Record<string, unknown> },
    ) => {
      const row = { ...params.data };
      tableFor(resource).push(row);
      return { data: row };
    },
    delete: async (resource: string, params: { id: Identifier }) => {
      const table = tableFor(resource);
      const index = table.findIndex((r) => String(r.id) === String(params.id));
      const [removed] = table.splice(index, 1);
      return { data: removed };
    },
  } as unknown as DataProvider;
};

const identityFor = (id: Identifier | null) => async () =>
  id == null ? null : { id };

const accountMember = (overrides: Partial<AccountMember>): AccountMember =>
  ({
    id: 1,
    account_id: 1,
    user_id: "0",
    role: "parent_admin",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as AccountMember;

const single = (overrides: Partial<Single>): Single =>
  ({
    id: 1,
    account_id: 1,
    first_name_en: "Rivky",
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Single;

const listing = (overrides: Partial<Listing>): Listing =>
  ({
    id: 500,
    account_id: 1,
    listing_type: "single",
    single_id: 1,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Listing;

describe("lockListingOnSingleWithdrawal — mirrors lock_listing_on_single_withdrawal()", () => {
  it("AC-1: creates a lock when a plain `single` role withdraws their OWN listing", async () => {
    // Arrange
    const db = emptyDb();
    db.account_members.push(
      accountMember({ id: 10, user_id: "u-single", role: "single" }),
    );
    db.singles.push(single({ id: 1, member_id: 10 }));
    const provider = buildProvider(db);

    // Act
    await lockListingOnSingleWithdrawal(
      provider,
      identityFor("u-single"),
      () => 1,
      listing({ listing_type: "single", single_id: 1, account_id: 1 }),
    );

    // Assert
    expect(db.listing_withdrawal_locks).toHaveLength(1);
    expect(db.listing_withdrawal_locks[0]).toMatchObject({
      single_id: 1,
      account_id: 1,
    });
  });

  it("AC-6: does NOT create a lock when a self_manager withdraws their own listing (no separate manager to protect against)", async () => {
    // Arrange
    const db = emptyDb();
    db.account_members.push(
      accountMember({ id: 10, user_id: "u-self", role: "self_manager" }),
    );
    db.singles.push(single({ id: 1, member_id: 10 }));
    const provider = buildProvider(db);

    // Act
    await lockListingOnSingleWithdrawal(
      provider,
      identityFor("u-self"),
      () => 1,
      listing({ listing_type: "single", single_id: 1, account_id: 1 }),
    );

    // Assert
    expect(db.listing_withdrawal_locks).toHaveLength(0);
  });

  it("AC-3: does NOT create a lock when a parent_admin withdraws a listing about a single who never touched it", async () => {
    // Arrange
    const db = emptyDb();
    db.account_members.push(
      accountMember({ id: 20, user_id: "u-parent", role: "parent_admin" }),
    );
    db.singles.push(single({ id: 1, member_id: null }));
    const provider = buildProvider(db);

    // Act
    await lockListingOnSingleWithdrawal(
      provider,
      identityFor("u-parent"),
      () => 1,
      listing({ listing_type: "single", single_id: 1, account_id: 1 }),
    );

    // Assert
    expect(db.listing_withdrawal_locks).toHaveLength(0);
  });

  it("never fires for the shadchan branch (no single_id to lock at all)", async () => {
    // Arrange
    const db = emptyDb();
    const provider = buildProvider(db);

    // Act
    await lockListingOnSingleWithdrawal(
      provider,
      identityFor("whoever"),
      () => 1,
      listing({ listing_type: "shadchan", single_id: null, account_id: 1 }),
    );

    // Assert
    expect(db.listing_withdrawal_locks).toHaveLength(0);
  });

  it("is idempotent — withdrawing again while already locked does not duplicate the lock row", async () => {
    // Arrange
    const db = emptyDb();
    db.account_members.push(
      accountMember({ id: 10, user_id: "u-single", role: "single" }),
    );
    db.singles.push(single({ id: 1, member_id: 10 }));
    db.listing_withdrawal_locks.push({
      id: 1,
      single_id: 1,
      account_id: 1,
      locked_at: "2026-01-01T00:00:00Z",
    });
    const provider = buildProvider(db);

    // Act
    await lockListingOnSingleWithdrawal(
      provider,
      identityFor("u-single"),
      () => 1,
      listing({ listing_type: "single", single_id: 1, account_id: 1 }),
    );

    // Assert
    expect(db.listing_withdrawal_locks).toHaveLength(1);
  });
});

describe("consentToRepublishListing — mirrors consent_to_republish_listing() (AC-4)", () => {
  it("clears the lock when called by the single themselves", async () => {
    // Arrange
    const db = emptyDb();
    db.account_members.push(
      accountMember({ id: 10, user_id: "u-single", role: "single" }),
    );
    db.singles.push(single({ id: 1, member_id: 10 }));
    db.listing_withdrawal_locks.push({
      id: 1,
      single_id: 1,
      account_id: 1,
      locked_at: "2026-01-01T00:00:00Z",
    });
    const provider = buildProvider(db);

    // Act
    await consentToRepublishListing(
      provider,
      identityFor("u-single"),
      () => 1,
      1,
    );

    // Assert
    expect(db.listing_withdrawal_locks).toHaveLength(0);
  });

  it("is a SILENT no-op when called by a parent_admin (wrong caller) — never throws, never clears", async () => {
    // Arrange
    const db = emptyDb();
    db.account_members.push(
      accountMember({ id: 20, user_id: "u-parent", role: "parent_admin" }),
    );
    db.singles.push(single({ id: 1, member_id: 10 }));
    db.listing_withdrawal_locks.push({
      id: 1,
      single_id: 1,
      account_id: 1,
      locked_at: "2026-01-01T00:00:00Z",
    });
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      consentToRepublishListing(provider, identityFor("u-parent"), () => 1, 1),
    ).resolves.toBeUndefined();
    expect(db.listing_withdrawal_locks).toHaveLength(1);
  });

  it("AC-7: is a no-op for a DIFFERENT account's caller, even one with the right role", async () => {
    // Arrange — u-other is a genuine `single` in account 2, calling for
    // single_id 1's lock (which belongs to account 1).
    const db = emptyDb();
    db.account_members.push(
      accountMember({
        id: 30,
        account_id: 2,
        user_id: "u-other",
        role: "single",
      }),
    );
    db.singles.push(single({ id: 5, account_id: 2, member_id: 30 }));
    db.listing_withdrawal_locks.push({
      id: 1,
      single_id: 1,
      account_id: 1,
      locked_at: "2026-01-01T00:00:00Z",
    });
    const provider = buildProvider(db);

    // Act
    await consentToRepublishListing(
      provider,
      identityFor("u-other"),
      () => 2,
      1,
    );

    // Assert
    expect(db.listing_withdrawal_locks).toHaveLength(1);
  });

  it("is a no-op for a self_manager consenting for a single_id that is not their own", async () => {
    // Arrange
    const db = emptyDb();
    db.account_members.push(
      accountMember({ id: 10, user_id: "u-self", role: "self_manager" }),
    );
    db.singles.push(single({ id: 1, member_id: 10 }));
    db.singles.push(single({ id: 2, member_id: null }));
    db.listing_withdrawal_locks.push({
      id: 2,
      single_id: 2,
      account_id: 1,
      locked_at: "2026-01-01T00:00:00Z",
    });
    const provider = buildProvider(db);

    // Act
    await consentToRepublishListing(
      provider,
      identityFor("u-self"),
      () => 1,
      2,
    );

    // Assert
    expect(db.listing_withdrawal_locks).toHaveLength(1);
  });

  it("resolves without error when no signed-in identity exists", async () => {
    // Arrange
    const db = emptyDb();
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      consentToRepublishListing(provider, identityFor(null), () => 1, 1),
    ).resolves.toBeUndefined();
  });
});
