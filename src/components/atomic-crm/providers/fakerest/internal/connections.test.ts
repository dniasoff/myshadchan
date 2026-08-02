import type { DataProvider, Identifier } from "ra-core";
import { describe, expect, it } from "vitest";

import type {
  Account,
  AccountMember,
  Connection,
  ConnectionInvite,
  Shadchan,
} from "../../../types";
import {
  acceptConnectionInvite,
  createConnectionInvite,
  endConnection,
  previewConnectionInvite,
  revokeConnectionInvite,
} from "./connections";

/**
 * Pins the FakeRest mirrors of Story 8.2's five consent-workflow functions
 * (`02_functions.sql`) to the same rules the SQL enforces — previously
 * untested at this layer (review finding F7; every sibling FakeRest
 * `internal/*.ts` that owns a workflow has one, including `invites.test.ts`,
 * this module's own explicit precedent).
 *
 * Also pins review findings F4/F5's fix: `endConnection()` and
 * `revokeConnectionInvite()` require the caller's ACTIVE CONTEXT
 * (`getActiveAccountId()`, resolved through `resolveContextMembership`) to
 * be the party / the inviter — not merely ANY active membership of it.
 */

type Db = {
  accounts: Account[];
  account_members: AccountMember[];
  connections: Connection[];
  connection_invites: ConnectionInvite[];
  shadchanim: Shadchan[];
};

const emptyDb = (): Db => ({
  accounts: [],
  account_members: [],
  connections: [],
  connection_invites: [],
  shadchanim: [],
});

/** A minimal in-memory DataProvider — getList (equality filter only),
 * getOne, create (auto-increment id) and update by id — enough to serve
 * connections.ts's exact call shapes without pulling in `ra-data-fakerest`.
 * Mirrors `invites.test.ts`'s own harness exactly. */
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
    default_thread_visibility: "open",
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

const invite = (overrides: Partial<ConnectionInvite>): ConnectionInvite =>
  ({
    id: 1,
    inviter_account_id: 1,
    inviter_kind: "household",
    token_hash: "token-1",
    status: "pending",
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    accepted_by_account_id: null,
    accepted_at: null,
    revoked_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as ConnectionInvite;

/** One household (id 1, user "0", parent_admin) and one shadchanus account
 * (id 2, user "1", shadchan) — the baseline every test below extends. */
const buildHouseholdAndShadchanus = (): Db => {
  const db = emptyDb();
  db.accounts.push(account({ id: 1, kind: "household", name: "Household A" }));
  db.accounts.push(account({ id: 2, kind: "shadchanus", name: "Shadchan S" }));
  db.account_members.push(
    accountMember({ id: 1, account_id: 1, user_id: "0", role: "parent_admin" }),
  );
  db.account_members.push(
    accountMember({ id: 2, account_id: 2, user_id: "1", role: "shadchan" }),
  );
  return db;
};

describe("createConnectionInvite", () => {
  it("requires a signed-in user", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      createConnectionInvite(provider, identityFor(null), () => 1),
    ).rejects.toThrow("createConnectionInvite requires a signed-in user");
  });

  it("requires an active membership of the current context", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    const provider = buildProvider(db);

    // Act / Assert — user "0" is active in account 1, not account 2
    await expect(
      createConnectionInvite(provider, identityFor("0"), () => 2),
    ).rejects.toThrow(
      "createConnectionInvite requires an active membership of the current context",
    );
  });

  it("creates a pending invite carrying the caller's account id and kind, returning the raw token", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    const provider = buildProvider(db);

    // Act
    const token = await createConnectionInvite(
      provider,
      identityFor("0"),
      () => 1,
    );

    // Assert
    expect(token).toBeTruthy();
    expect(db.connection_invites).toHaveLength(1);
    expect(db.connection_invites[0]).toMatchObject({
      inviter_account_id: 1,
      inviter_kind: "household",
      status: "pending",
      token_hash: token,
    });
  });
});

describe("revokeConnectionInvite", () => {
  it("revokes a pending invite for its owning caller", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    db.connection_invites.push(invite({ id: 1, inviter_account_id: 1 }));
    const provider = buildProvider(db);

    // Act
    await revokeConnectionInvite(provider, identityFor("0"), () => 1, 1);

    // Assert
    expect(db.connection_invites[0].status).toBe("revoked");
    expect(db.connection_invites[0].revoked_at).not.toBeNull();
  });

  it("refuses an invite outside the caller's inviting account, as a plain not-found (no distinct 'not yours' error)", async () => {
    // Arrange — invite belongs to account 2, caller acts as account 1
    const db = buildHouseholdAndShadchanus();
    db.connection_invites.push(invite({ id: 1, inviter_account_id: 2 }));
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      revokeConnectionInvite(provider, identityFor("0"), () => 1, 1),
    ).rejects.toThrow("connection invite 1 not found");
  });

  it("review findings F4/F5 — refuses when the caller merely holds an active membership of the inviting account under a DIFFERENT active context", async () => {
    // Arrange — user "0" is ALSO an active member of account 2 (a second
    // account), but their ACTIVE CONTEXT (getActiveAccountId) is account 2,
    // not account 1, the invite's actual owner.
    const db = buildHouseholdAndShadchanus();
    db.account_members.push(
      accountMember({ id: 3, account_id: 2, user_id: "0", role: "shadchan" }),
    );
    db.connection_invites.push(invite({ id: 1, inviter_account_id: 1 }));
    const provider = buildProvider(db);

    // Act / Assert — acting as account 2, revoking account 1's invite fails
    await expect(
      revokeConnectionInvite(provider, identityFor("0"), () => 2, 1),
    ).rejects.toThrow("connection invite 1 not found");
    expect(db.connection_invites[0].status).toBe("pending");
  });

  it("refuses revoking an invite that is no longer pending", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    db.connection_invites.push(
      invite({ id: 1, inviter_account_id: 1, status: "revoked" }),
    );
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      revokeConnectionInvite(provider, identityFor("0"), () => 1, 1),
    ).rejects.toThrow("connection invite 1 is not pending (status revoked)");
  });
});

describe("previewConnectionInvite", () => {
  it("resolves to null for a signed-out caller", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    const provider = buildProvider(db);

    // Act
    const result = await previewConnectionInvite(
      provider,
      identityFor(null),
      "some-token",
    );

    // Assert
    expect(result).toBeNull();
  });

  it("resolves to null for an unknown token, never an error", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    const provider = buildProvider(db);

    // Act
    const result = await previewConnectionInvite(
      provider,
      identityFor("0"),
      "not-a-real-token",
    );

    // Assert
    expect(result).toBeNull();
  });

  it("shows the inviter's name and kind for a pending, unexpired invite — to ANY signed-in caller", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    db.connection_invites.push(
      invite({ id: 1, inviter_account_id: 1, token_hash: "abc" }),
    );
    const provider = buildProvider(db);

    // Act — caller "1" is a stranger to this invite (shadchan S's own user)
    const result = await previewConnectionInvite(
      provider,
      identityFor("1"),
      "abc",
    );

    // Assert
    expect(result).toEqual({
      inviter_name: "Household A",
      inviter_kind: "household",
      status: "pending",
      expires_at: db.connection_invites[0].expires_at,
    });
  });

  it("resolves to null for an expired invite, indistinguishable from unknown", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    db.connection_invites.push(
      invite({
        id: 1,
        inviter_account_id: 1,
        token_hash: "abc",
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    const provider = buildProvider(db);

    // Act
    const result = await previewConnectionInvite(
      provider,
      identityFor("0"),
      "abc",
    );

    // Assert
    expect(result).toBeNull();
  });

  it("resolves to null for an already-accepted invite", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    db.connection_invites.push(
      invite({
        id: 1,
        inviter_account_id: 1,
        token_hash: "abc",
        status: "accepted",
      }),
    );
    const provider = buildProvider(db);

    // Act
    const result = await previewConnectionInvite(
      provider,
      identityFor("0"),
      "abc",
    );

    // Assert
    expect(result).toBeNull();
  });
});

describe("acceptConnectionInvite", () => {
  it("requires the acceptor's context to be the OPPOSITE kind of the inviter (AC-4)", async () => {
    // Arrange — inviter is household 1; acceptor's own active context (also
    // household-kind) tries to accept.
    const db = buildHouseholdAndShadchanus();
    db.accounts.push(
      account({ id: 3, kind: "household", name: "Household C" }),
    );
    db.account_members.push(
      accountMember({
        id: 3,
        account_id: 3,
        user_id: "2",
        role: "parent_admin",
      }),
    );
    db.connection_invites.push(
      invite({
        id: 1,
        inviter_account_id: 1,
        inviter_kind: "household",
        token_hash: "abc",
      }),
    );
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      acceptConnectionInvite(provider, identityFor("2"), () => 3, "abc"),
    ).rejects.toThrow(
      "a connection links a household and a shadchanus context, not two of the same kind",
    );
    expect(db.connections).toHaveLength(0);
  });

  it("refuses an invalid, expired, or already-used invite", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    db.connection_invites.push(
      invite({
        id: 1,
        inviter_account_id: 1,
        token_hash: "abc",
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      acceptConnectionInvite(provider, identityFor("1"), () => 2, "abc"),
    ).rejects.toThrow(
      "This connection invite is invalid, expired, or has already been used.",
    );
  });

  it("creates the connection, seeds the household's own book entry, and burns the invite", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    db.connection_invites.push(
      invite({
        id: 1,
        inviter_account_id: 1,
        inviter_kind: "household",
        token_hash: "abc",
      }),
    );
    const provider = buildProvider(db);

    // Act — shadchan S (account 2) accepts household A's invite
    const connection = await acceptConnectionInvite(
      provider,
      identityFor("1"),
      () => 2,
      "abc",
    );

    // Assert
    expect(connection).toMatchObject({
      household_account_id: 1,
      shadchanus_account_id: 2,
      status: "accepted",
      proposed_by_account_id: 1,
    });
    expect(db.shadchanim).toHaveLength(1);
    expect(db.shadchanim[0]).toMatchObject({
      account_id: 1,
      name: "Shadchan S",
      connection_id: connection.id,
    });
    expect(db.connection_invites[0]).toMatchObject({
      status: "accepted",
      accepted_by_account_id: 2,
    });
  });
});

describe("endConnection", () => {
  const connection = (overrides: Partial<Connection>): Connection =>
    ({
      id: 1,
      household_account_id: 1,
      shadchanus_account_id: 2,
      status: "accepted",
      ended_at: null,
      proposed_by_account_id: 1,
      accepted_at: "2026-01-01T00:00:00Z",
      ended_by_account_id: null,
      created_at: "2026-01-01T00:00:00Z",
      household_account_name: "Test Household",
      ...overrides,
    }) as Connection;

  it("lets an active member of either party end an accepted connection", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    db.connections.push(connection({ id: 1 }));
    const provider = buildProvider(db);

    // Act
    const updated = await endConnection(provider, identityFor("1"), () => 2, 1);

    // Assert
    expect(updated.status).toBe("ended");
    expect(updated.ended_by_account_id).toBe(2);
    expect(db.connections[0].ended_at).not.toBeNull();
  });

  it("refuses a caller whose active context is neither party", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    db.accounts.push(
      account({ id: 3, kind: "shadchanus", name: "Shadchan S2" }),
    );
    db.account_members.push(
      accountMember({ id: 3, account_id: 3, user_id: "2", role: "shadchan" }),
    );
    db.connections.push(connection({ id: 1 }));
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      endConnection(provider, identityFor("2"), () => 3, 1),
    ).rejects.toThrow("connection 1 not found");
    expect(db.connections[0].status).toBe("accepted");
  });

  it("review findings F4/F5 — refuses a caller who holds an active membership of a party but whose ACTIVE CONTEXT is a different, unrelated account", async () => {
    // Arrange — user "1" (shadchan S's own user, account 2) is ALSO an
    // active member of a third, unrelated account (3), and is ACTING AS it.
    const db = buildHouseholdAndShadchanus();
    db.accounts.push(
      account({ id: 3, kind: "household", name: "Unrelated Household" }),
    );
    db.account_members.push(
      accountMember({
        id: 3,
        account_id: 3,
        user_id: "1",
        role: "parent_admin",
      }),
    );
    db.connections.push(connection({ id: 1 }));
    const provider = buildProvider(db);

    // Act / Assert — acting as account 3 (not a party), even though user "1"
    // remains an active member of account 2 (a party)
    await expect(
      endConnection(provider, identityFor("1"), () => 3, 1),
    ).rejects.toThrow("connection 1 not found");
    expect(db.connections[0].status).toBe("accepted");
    expect(db.connections[0].ended_by_account_id).toBeNull();
  });

  it("refuses ending an already-ended connection", async () => {
    // Arrange
    const db = buildHouseholdAndShadchanus();
    db.connections.push(
      connection({ id: 1, status: "ended", ended_at: "2026-01-02T00:00:00Z" }),
    );
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      endConnection(provider, identityFor("0"), () => 1, 1),
    ).rejects.toThrow("connection 1 has already ended");
  });
});
