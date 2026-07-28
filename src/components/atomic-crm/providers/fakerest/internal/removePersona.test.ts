import type { DataProvider, Identifier } from "ra-core";

import type { Account, AccountMember, Member, Single } from "../../../types";
import { removePersona } from "./removePersona";

/**
 * Pins the FakeRest mirror of `public.remove_persona()` (2.5 AC-2/AC-3/
 * AC-5/AC-7) to the same predicates the SQL enforces: the two removal
 * guards, archive-never-delete, and the dangling-active-context handoff.
 * Mirrors `personas.test.ts`'s own in-memory `buildProvider` rather than
 * pulling in `ra-data-fakerest`.
 */

type Db = {
  members: Member[];
  accounts: Account[];
  account_members: AccountMember[];
  singles: Single[];
};

const emptyDb = (): Db => ({
  members: [],
  accounts: [],
  account_members: [],
  singles: [],
});

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
    update: async (
      resource: string,
      params: { id: Identifier; data: Record<string, unknown> },
    ) => {
      const table = tableFor(resource);
      const index = table.findIndex((r) => r.id === params.id);
      table[index] = { ...table[index], ...params.data };
      return { data: table[index] };
    },
  } as unknown as DataProvider;
};

const identityFor = (id: Identifier | null) => async () =>
  id == null ? null : { id };

const account = (overrides: Partial<Account>): Account =>
  ({
    id: 1,
    name: "My Account",
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

const single = (overrides: Partial<Single>): Single =>
  ({
    id: 1,
    account_id: 1,
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Single;

describe("removePersona", () => {
  it("throws when there is no signed-in user", async () => {
    // Arrange
    const provider = buildProvider(emptyDb());

    // Act / Assert
    await expect(
      removePersona(provider, identityFor(null), "single", () => null, vi.fn()),
    ).rejects.toThrow("removePersona requires a signed-in user");
  });

  describe("shadchan", () => {
    it("no-ops when the caller holds no active shadchan membership", async () => {
      // Arrange
      const provider = buildProvider(emptyDb());
      const setActiveAccountId = vi.fn();

      // Act
      await removePersona(
        provider,
        identityFor(0),
        "shadchan",
        () => null,
        setActiveAccountId,
      );

      // Assert
      expect(setActiveAccountId).not.toHaveBeenCalled();
    });

    it("archives the shadchan membership and never deletes it", async () => {
      // Arrange
      const db = emptyDb();
      db.accounts.push(account({ id: 2, kind: "shadchanus" }));
      db.account_members.push(
        accountMember({ id: 1, account_id: 2, user_id: "0", role: "shadchan" }),
      );
      const provider = buildProvider(db);

      // Act
      await removePersona(
        provider,
        identityFor(0),
        "shadchan",
        () => null,
        vi.fn(),
      );

      // Assert
      expect(db.account_members).toHaveLength(1);
      expect(db.account_members[0]).toMatchObject({
        id: 1,
        status: "archived",
      });
    });

    it("hands off the dangling active context to a remaining membership", async () => {
      // Arrange — the caller holds household (id 1) and shadchanus (id 2);
      // shadchanus is currently active.
      const db = emptyDb();
      db.accounts.push(
        account({ id: 1, kind: "household" }),
        account({ id: 2, kind: "shadchanus" }),
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
      const setActiveAccountId = vi.fn();

      // Act
      await removePersona(
        provider,
        identityFor(0),
        "shadchan",
        () => 2,
        setActiveAccountId,
      );

      // Assert
      expect(setActiveAccountId).toHaveBeenCalledExactlyOnceWith(1);
    });

    it("clears the active context to NULL when no membership remains", async () => {
      // Arrange
      const db = emptyDb();
      db.accounts.push(account({ id: 2, kind: "shadchanus" }));
      db.account_members.push(
        accountMember({ id: 1, account_id: 2, user_id: "0", role: "shadchan" }),
      );
      const provider = buildProvider(db);
      const setActiveAccountId = vi.fn();

      // Act
      await removePersona(
        provider,
        identityFor(0),
        "shadchan",
        () => 2,
        setActiveAccountId,
      );

      // Assert
      expect(setActiveAccountId).toHaveBeenCalledExactlyOnceWith(null);
    });

    it("does not hand off the active context when the archived membership was not the active one", async () => {
      // Arrange
      const db = emptyDb();
      db.accounts.push(
        account({ id: 1, kind: "household" }),
        account({ id: 2, kind: "shadchanus" }),
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
      const setActiveAccountId = vi.fn();

      // Act — household (1) is active, not the shadchanus being removed.
      await removePersona(
        provider,
        identityFor(0),
        "shadchan",
        () => 1,
        setActiveAccountId,
      );

      // Assert
      expect(setActiveAccountId).not.toHaveBeenCalled();
    });
  });

  describe("single", () => {
    it("no-ops when the caller holds no active single persona", async () => {
      // Arrange
      const db = emptyDb();
      db.accounts.push(account({ id: 1 }));
      db.account_members.push(
        accountMember({ id: 1, account_id: 1, user_id: "0" }),
      );
      const provider = buildProvider(db);

      // Act / Assert — must not throw.
      await removePersona(
        provider,
        identityFor(0),
        "single",
        () => null,
        vi.fn(),
      );
      expect(db.singles).toHaveLength(0);
    });

    it("throws 'ask your household admin' for an invited (non-owning) single-role member", async () => {
      // Arrange
      const db = emptyDb();
      db.accounts.push(account({ id: 1 }));
      db.account_members.push(
        accountMember({ id: 1, account_id: 1, user_id: "5", role: "single" }),
      );
      db.singles.push(single({ id: 1, account_id: 1, member_id: 1 }));
      const provider = buildProvider(db);

      // Act / Assert
      await expect(
        removePersona(provider, identityFor(5), "single", () => null, vi.fn()),
      ).rejects.toThrow("ask your household admin");
      expect(db.singles[0].status).toBe("active");
    });

    it("throws 'cannot remove your only persona' when single is the caller's sole persona", async () => {
      // Arrange
      const db = emptyDb();
      db.accounts.push(account({ id: 1 }));
      db.account_members.push(
        accountMember({
          id: 1,
          account_id: 1,
          user_id: "0",
          role: "self_manager",
        }),
      );
      db.singles.push(single({ id: 1, account_id: 1, member_id: 1 }));
      const provider = buildProvider(db);

      // Act / Assert
      await expect(
        removePersona(provider, identityFor(0), "single", () => null, vi.fn()),
      ).rejects.toThrow("cannot remove your only persona");
      expect(db.singles[0].status).toBe("active");
    });

    it("archives the singles row (never deletes) when the caller holds another persona", async () => {
      // Arrange — parent_admin + single in the same household.
      const db = emptyDb();
      db.accounts.push(account({ id: 1 }));
      db.account_members.push(
        accountMember({ id: 1, account_id: 1, user_id: "0" }),
      );
      db.singles.push(single({ id: 1, account_id: 1, member_id: 1 }));
      const provider = buildProvider(db);

      // Act
      await removePersona(
        provider,
        identityFor(0),
        "single",
        () => null,
        vi.fn(),
      );

      // Assert
      expect(db.singles).toHaveLength(1);
      expect(db.singles[0].status).toBe("archived");
    });
  });

  describe("parent", () => {
    it("no-ops when the caller holds no active parent_admin membership", async () => {
      // Arrange
      const provider = buildProvider(emptyDb());
      const setActiveAccountId = vi.fn();

      // Act / Assert — must not throw.
      await removePersona(
        provider,
        identityFor(0),
        "parent",
        () => null,
        setActiveAccountId,
      );
      expect(setActiveAccountId).not.toHaveBeenCalled();
    });

    it("refuses when the household has other active singles and no other admin remains", async () => {
      // Arrange — an unmanaged dependent (no member_id) with no second admin.
      const db = emptyDb();
      db.accounts.push(account({ id: 1 }));
      db.account_members.push(
        accountMember({ id: 1, account_id: 1, user_id: "0" }),
      );
      db.singles.push(single({ id: 1, account_id: 1, member_id: null }));
      const provider = buildProvider(db);

      // Act / Assert
      await expect(
        removePersona(provider, identityFor(0), "parent", () => null, vi.fn()),
      ).rejects.toThrow(
        "cannot remove parent — no other admin manages this household's other singles",
      );
      expect(db.account_members[0]).toMatchObject({
        role: "parent_admin",
        status: "active",
      });
    });

    it("checks the dependents guard before the demote branch, even when the caller holds single themselves", async () => {
      // Arrange — the caller holds their own single persona AND there is an
      // unmanaged dependent with no other admin: the guard must still fire.
      const db = emptyDb();
      db.accounts.push(account({ id: 1 }));
      db.account_members.push(
        accountMember({ id: 1, account_id: 1, user_id: "0" }),
      );
      db.singles.push(
        single({ id: 1, account_id: 1, member_id: 1 }),
        single({ id: 2, account_id: 1, member_id: null }),
      );
      const provider = buildProvider(db);

      // Act / Assert
      await expect(
        removePersona(provider, identityFor(0), "parent", () => null, vi.fn()),
      ).rejects.toThrow("cannot remove parent");
      expect(db.account_members[0].role).toBe("parent_admin");
    });

    it("demotes to self_manager (role only, account_id unchanged) when the caller still holds single in the same household", async () => {
      // Arrange — no other dependents, so the guard never fires.
      const db = emptyDb();
      db.accounts.push(account({ id: 1 }));
      db.account_members.push(
        accountMember({ id: 1, account_id: 1, user_id: "0" }),
      );
      db.singles.push(single({ id: 1, account_id: 1, member_id: 1 }));
      const provider = buildProvider(db);
      const setActiveAccountId = vi.fn();

      // Act
      await removePersona(
        provider,
        identityFor(0),
        "parent",
        () => 1,
        setActiveAccountId,
      );

      // Assert
      expect(db.account_members[0]).toMatchObject({
        role: "self_manager",
        status: "active",
        account_id: 1,
      });
      // A demote is never an archive — the active-context handoff must not run.
      expect(setActiveAccountId).not.toHaveBeenCalled();
    });

    it("archives the membership outright and hands off the active context when the caller holds no single persona there", async () => {
      // Arrange — sole persona is parent, no dependents.
      const db = emptyDb();
      db.accounts.push(
        account({ id: 1, kind: "household" }),
        account({ id: 2, kind: "shadchanus" }),
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
      const setActiveAccountId = vi.fn();

      // Act — household (1) is the caller's active context.
      await removePersona(
        provider,
        identityFor(0),
        "parent",
        () => 1,
        setActiveAccountId,
      );

      // Assert
      expect(db.account_members[0]).toMatchObject({
        role: "parent_admin",
        status: "archived",
      });
      expect(setActiveAccountId).toHaveBeenCalledExactlyOnceWith(2);
    });
  });
});
