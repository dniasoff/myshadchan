import type { DataProvider, Identifier } from "ra-core";
import { describe, expect, it } from "vitest";

import type { Account, AccountMember, Invite, Single } from "../../../types";
import { createInvite, revokeInvite } from "./invites";

/**
 * Pins the FakeRest mirror of `public.create_invite()` / `public.
 * revoke_invite()` (02_functions.sql) to the same rules the SQL enforces —
 * previously untested at this layer (only exercised indirectly through
 * `dataProvider.ts`). Story 6.1 adds `targetSingleId`
 * (`p_target_single_id`): this file's own falsifiable claims are that
 * `createInvite()` validates it exactly like the SQL does (required for
 * `single`, must exist/be unlinked/belong to the caller's own account), that
 * a `single`-role call is gated by the SAME authority/kind rules as any
 * other role (never refused merely because `invitableRoles()`'s own
 * candidate list dropped `single`), and that the resulting row carries
 * `target_single_id`.
 */

type Db = {
  accounts: Account[];
  account_members: AccountMember[];
  singles: Single[];
  invites: Invite[];
};

const emptyDb = (): Db => ({
  accounts: [],
  account_members: [],
  singles: [],
  invites: [],
});

/** A minimal in-memory DataProvider — getList (equality filter only),
 * getOne, create (auto-increment id) and update by id — enough to serve
 * invites.ts's exact call shapes without pulling in `ra-data-fakerest`. */
const buildProvider = (db: Db): DataProvider => {
  const tableFor = (resource: string): Array<Record<string, unknown>> => {
    const table = db[resource as keyof Db] as
      Array<Record<string, unknown>> | undefined;
    if (!table) throw new Error(`Unknown resource: ${resource}`);
    return table;
  };

  const nextId = (resource: string): number => {
    const table = tableFor(resource);
    const maxId = table.reduce((max, row) => Math.max(max, Number(row.id)), 0);
    return maxId + 1;
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
    getOne: async (resource: string, params: { id: Identifier }) => {
      const row = tableFor(resource).find(
        (r) => String(r.id) === String(params.id),
      );
      if (!row) throw new Error(`${resource} ${params.id} not found`);
      return { data: row };
    },
    create: async (
      resource: string,
      params: { data: Record<string, unknown> },
    ) => {
      const row = { id: nextId(resource), ...params.data };
      tableFor(resource).push(row);
      return { data: row };
    },
    update: async (
      resource: string,
      params: { id: Identifier; data: Record<string, unknown> },
    ) => {
      const table = tableFor(resource);
      const index = table.findIndex((r) => String(r.id) === String(params.id));
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

const single = (overrides: Partial<Single>): Single =>
  ({
    id: 1,
    account_id: 1,
    first_name_en: "Chana",
    status: "active",
    member_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Single;

/** Arranges one household (id 1), one parent_admin (membership id 1, user
 * "0") and one unlinked single (id 1) — the baseline every test below
 * extends. */
const buildHousehold = (): Db => {
  const db = emptyDb();
  db.accounts.push(account({ id: 1, kind: "household" }));
  db.account_members.push(
    accountMember({ id: 1, account_id: 1, user_id: "0", role: "parent_admin" }),
  );
  db.singles.push(single({ id: 1, account_id: 1, member_id: null }));
  return db;
};

describe("createInvite — target validation (Story 6.1)", () => {
  it("requires a target for a single-role invite", async () => {
    // Arrange
    const db = buildHousehold();
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      createInvite(
        provider,
        identityFor("0"),
        () => 1,
        "chana@test.local",
        "single",
      ),
    ).rejects.toThrow("a single-role invite requires a target single");
  });

  it("refuses a target that does not exist in the caller's account", async () => {
    // Arrange
    const db = buildHousehold();
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      createInvite(
        provider,
        identityFor("0"),
        () => 1,
        "chana@test.local",
        "single",
        999,
      ),
    ).rejects.toThrow("single 999 not found in current account");
  });

  it("refuses a target belonging to a different account", async () => {
    // Arrange
    const db = buildHousehold();
    db.accounts.push(account({ id: 2, kind: "household" }));
    db.singles.push(single({ id: 2, account_id: 2, member_id: null }));
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      createInvite(
        provider,
        identityFor("0"),
        () => 1,
        "chana@test.local",
        "single",
        2,
      ),
    ).rejects.toThrow("single 2 not found in current account");
  });

  it("refuses an already-linked target", async () => {
    // Arrange
    const db = buildHousehold();
    db.singles[0] = single({ id: 1, account_id: 1, member_id: 42 });
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      createInvite(
        provider,
        identityFor("0"),
        () => 1,
        "chana@test.local",
        "single",
        1,
      ),
    ).rejects.toThrow("single 1 not found in current account");
  });

  it("creates a single-role invite carrying target_single_id, for an unlinked target in the caller's own account", async () => {
    // Arrange
    const db = buildHousehold();
    const provider = buildProvider(db);

    // Act
    const invite = await createInvite(
      provider,
      identityFor("0"),
      () => 1,
      "chana@test.local",
      "single",
      1,
    );

    // Assert
    expect(invite.role).toBe("single");
    expect(invite.target_single_id).toBe(1);
    expect(invite.account_id).toBe(1);
  });

  it("never sets target_single_id for a non-single-role invite", async () => {
    // Arrange
    const db = buildHousehold();
    const provider = buildProvider(db);

    // Act
    const invite = await createInvite(
      provider,
      identityFor("0"),
      () => 1,
      "helper@test.local",
      "helper",
    );

    // Assert
    expect(invite.target_single_id).toBeNull();
  });
});

describe("createInvite — a single-role call is gated by role_authority()/kind, never invitableRoles()'s narrower selector list (Story 6.1)", () => {
  it("a self_manager (authority 2) may still invite a single into their own household", async () => {
    // Arrange — self_manager sits above single (authority 1) in
    // role_authority(), so this must succeed even though invitableRoles()'s
    // OWN candidate list (the Settings selector) no longer offers 'single'
    // at all.
    const db = buildHousehold();
    db.account_members[0] = accountMember({
      id: 1,
      account_id: 1,
      user_id: "0",
      role: "self_manager",
    });
    const provider = buildProvider(db);

    // Act
    const invite = await createInvite(
      provider,
      identityFor("0"),
      () => 1,
      "chana@test.local",
      "single",
      1,
    );

    // Assert
    expect(invite.role).toBe("single");
  });

  it("refuses a single-role invite from a shadchanus-kind account", async () => {
    // Arrange
    const db = buildHousehold();
    db.accounts[0] = account({ id: 1, kind: "shadchanus" });
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      createInvite(
        provider,
        identityFor("0"),
        () => 1,
        "chana@test.local",
        "single",
        1,
      ),
    ).rejects.toThrow(
      "role single is not invitable into a shadchanus-kind account",
    );
  });

  it("refuses a non-owning caller (helper) inviting a single, same as any other role", async () => {
    // Arrange
    const db = buildHousehold();
    db.account_members[0] = accountMember({
      id: 1,
      account_id: 1,
      user_id: "0",
      role: "helper",
    });
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      createInvite(
        provider,
        identityFor("0"),
        () => 1,
        "chana@test.local",
        "single",
        1,
      ),
    ).rejects.toThrow("role helper may not send invites");
  });
});

describe("revokeInvite — unchanged by Story 6.1", () => {
  it("revokes a pending invite for its owning caller", async () => {
    // Arrange
    const db = buildHousehold();
    db.invites.push({
      id: 1,
      token: "11111111-1111-1111-1111-111111111111",
      email: "chana@test.local",
      account_id: 1,
      role: "single",
      invited_by: 1,
      target_single_id: 1,
      status: "pending",
      expires_at: "2099-01-01T00:00:00Z",
      accepted_at: null,
      created_at: "2026-01-01T00:00:00Z",
    } as Invite);
    const provider = buildProvider(db);

    // Act
    await revokeInvite(provider, identityFor("0"), () => 1, 1);

    // Assert
    expect(db.invites[0].status).toBe("revoked");
  });
});
