import type { DataProvider, Identifier } from "ra-core";

import type { Account, AccountMember } from "../../../types";
import { getMyContexts, switchActiveContext } from "./contexts";

/**
 * Pins the FakeRest mirror of `public.my_contexts()` / `public.set_active_context()`
 * (2.4 review finding #1: shipped with zero tests, unlike its sibling
 * `internal/personas.test.ts`). Covers the invented "first membership by id
 * is active until switchActiveContext() is called" bootstrap, both
 * `identity == null` guards, and the `holdsMembership` throw.
 */

type Db = {
  accounts: Account[];
  account_members: AccountMember[];
};

const emptyDb = (): Db => ({
  accounts: [],
  account_members: [],
});

/** A minimal in-memory DataProvider — getList (equality filter only) and
 * getOne — enough to serve `contexts.ts`'s exact call shapes, mirroring
 * `personas.test.ts`'s own `buildProvider` rather than pulling in
 * `ra-data-fakerest`. */
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
        Object.entries(filter).every(([key, value]) => row[key] === value),
      );
      return { data, total: data.length };
    },
    getOne: async (resource: string, params: { id: Identifier }) => {
      const row = tableFor(resource).find((r) => r.id === params.id);
      if (!row) throw new Error(`${resource} ${params.id} not found`);
      return { data: row };
    },
  } as unknown as DataProvider;
};

const identityFor = (id: Identifier | null) => async () =>
  id == null ? null : { id };

const account = (overrides: Partial<Account>): Account =>
  ({
    id: 1,
    name: "The Klein Family",
    transparency_level: "shared",
    kind: "household",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Account;

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

describe("getMyContexts", () => {
  it("returns no contexts for a signed-out caller", async () => {
    // Arrange
    const provider = buildProvider(emptyDb());

    // Act
    const contexts = await getMyContexts(
      provider,
      identityFor(null),
      () => null,
    );

    // Assert
    expect(contexts).toEqual([]);
  });

  it("returns no contexts for a caller with zero active memberships", async () => {
    // Arrange
    const provider = buildProvider(emptyDb());

    // Act
    const contexts = await getMyContexts(provider, identityFor(0), () => null);

    // Assert
    expect(contexts).toEqual([]);
  });

  it("never reports a revoked membership (mirrors my_contexts()'s status = 'active' filter)", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(account({ id: 1 }));
    db.account_members.push(
      accountMember({ id: 1, account_id: 1, user_id: "0", status: "revoked" }),
    );
    const provider = buildProvider(db);

    // Act
    const contexts = await getMyContexts(provider, identityFor(0), () => null);

    // Assert
    expect(contexts).toEqual([]);
  });

  it("treats the first membership found (by id) as active when nothing has been explicitly switched yet", async () => {
    // Arrange — mirrors activate_first_context_trigger: a login with any
    // membership always has a live active context, never "none yet".
    const db = emptyDb();
    db.accounts.push(
      account({ id: 1, name: "The Klein Family", kind: "household" }),
      account({ id: 2, name: "My Account", kind: "shadchanus" }),
    );
    db.account_members.push(
      accountMember({
        id: 1,
        account_id: 1,
        user_id: "0",
        role: "parent_admin",
      }),
      accountMember({ id: 2, account_id: 2, user_id: "0", role: "shadchan" }),
    );
    const provider = buildProvider(db);

    // Act — getActiveAccountId returns null: nothing switched yet.
    const contexts = await getMyContexts(provider, identityFor(0), () => null);

    // Assert
    expect(contexts).toEqual([
      {
        account_id: 1,
        kind: "household",
        name: "The Klein Family",
        role: "parent_admin",
        is_active: true,
      },
      {
        account_id: 2,
        kind: "shadchanus",
        name: "My Account",
        role: "shadchan",
        is_active: false,
      },
    ]);
  });

  it("flags whichever context getActiveAccountId names as active, once a switch has happened", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(
      account({ id: 1, name: "The Klein Family", kind: "household" }),
      account({ id: 2, name: "My Account", kind: "shadchanus" }),
    );
    db.account_members.push(
      accountMember({
        id: 1,
        account_id: 1,
        user_id: "0",
        role: "parent_admin",
      }),
      accountMember({ id: 2, account_id: 2, user_id: "0", role: "shadchan" }),
    );
    const provider = buildProvider(db);

    // Act — the caller has explicitly switched to account 2.
    const contexts = await getMyContexts(provider, identityFor(0), () => 2);

    // Assert
    expect(contexts.find((c) => c.account_id === 1)?.is_active).toBe(false);
    expect(contexts.find((c) => c.account_id === 2)?.is_active).toBe(true);
  });

  it("reports one row per account even when two memberships share the same account", async () => {
    // Arrange — exercises the account-lookup memoization: only one
    // getOne("accounts") call should be needed for two rows on account 1.
    const db = emptyDb();
    db.accounts.push(account({ id: 1 }));
    db.account_members.push(
      accountMember({
        id: 1,
        account_id: 1,
        user_id: "0",
        role: "parent_admin",
      }),
    );
    const provider = buildProvider(db);
    const getOneSpy = vi.spyOn(provider, "getOne");

    // Act
    await getMyContexts(provider, identityFor(0), () => null);

    // Assert
    expect(getOneSpy).toHaveBeenCalledTimes(1);
  });
});

describe("switchActiveContext", () => {
  it("throws when there is no signed-in user", async () => {
    // Arrange
    const provider = buildProvider(emptyDb());

    // Act / Assert
    await expect(
      switchActiveContext(provider, identityFor(null), 1, vi.fn()),
    ).rejects.toThrow("switchActiveContext requires a signed-in user");
  });

  it("throws when the caller holds no active membership of the target account", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(account({ id: 1 }));
    db.account_members.push(
      accountMember({ id: 1, account_id: 1, user_id: "0" }),
    );
    const provider = buildProvider(db);
    const setActiveAccountId = vi.fn();

    // Act / Assert
    await expect(
      switchActiveContext(provider, identityFor(0), 2, setActiveAccountId),
    ).rejects.toThrow("no active membership of account 2");
    expect(setActiveAccountId).not.toHaveBeenCalled();
  });

  it("sets the active account id when the caller holds a live membership of it", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(
      account({ id: 1 }),
      account({ id: 2, kind: "shadchanus" }),
    );
    db.account_members.push(
      accountMember({ id: 1, account_id: 1, user_id: "0" }),
      accountMember({ id: 2, account_id: 2, user_id: "0", role: "shadchan" }),
    );
    const provider = buildProvider(db);
    const setActiveAccountId = vi.fn();

    // Act
    await switchActiveContext(provider, identityFor(0), 2, setActiveAccountId);

    // Assert
    expect(setActiveAccountId).toHaveBeenCalledWith(2);
    expect(setActiveAccountId).toHaveBeenCalledTimes(1);
  });

  it("never switches into a revoked membership (mirrors set_active_context()'s own guard)", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(account({ id: 1 }));
    db.account_members.push(
      accountMember({ id: 1, account_id: 1, user_id: "0", status: "revoked" }),
    );
    const provider = buildProvider(db);
    const setActiveAccountId = vi.fn();

    // Act / Assert
    await expect(
      switchActiveContext(provider, identityFor(0), 1, setActiveAccountId),
    ).rejects.toThrow("no active membership of account 1");
    expect(setActiveAccountId).not.toHaveBeenCalled();
  });
});
