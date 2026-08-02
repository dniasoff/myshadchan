import type { DataProvider, Identifier } from "ra-core";
import { describe, expect, it } from "vitest";

import type { Account, AccountMember, Connection } from "../../../types";
import { redtViaConnection } from "./redting";

/**
 * Pins the FakeRest mirror of Story 8.3's `redt_via_connection()`
 * (`02_functions.sql`) to the same rules the SQL enforces — the identity/
 * connection-lookup guards that are awkward to express through the full
 * `createDataProvider()` factory's stricter `authProvider` typing (see
 * `dataProvider.redtViaConnection.test.ts`, which covers the realistic,
 * always-signed-in scenarios through that factory instead). Same minimal
 * harness `./connections.test.ts` already establishes for its own SQL
 * counterpart.
 */

type Db = {
  accounts: Account[];
  account_members: AccountMember[];
  connections: Connection[];
  inbox_items: Array<Record<string, unknown>>;
};

const emptyDb = (): Db => ({
  accounts: [],
  account_members: [],
  connections: [],
  inbox_items: [],
});

/** A minimal in-memory DataProvider — getList (equality filter only),
 * getOne and create (auto-increment id) — enough to serve
 * redting.ts's exact call shapes without pulling in `ra-data-fakerest`.
 * Mirrors `connections.test.ts`'s own harness exactly. */
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
    ...overrides,
  }) as Connection;

describe("redtViaConnection", () => {
  it("requires a signed-in user", async () => {
    // Arrange
    const db = emptyDb();
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      redtViaConnection(provider, identityFor(null), () => null, {
        connection_id: 1,
        subject: null,
        raw_text: "hello",
        attachments: null,
      }),
    ).rejects.toThrow("redtViaConnection requires a signed-in user");
    expect(db.inbox_items).toHaveLength(0);
  });

  it("rejects a connection id that does not exist", async () => {
    // Arrange
    const db = emptyDb();
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      redtViaConnection(provider, identityFor("0"), () => 1, {
        connection_id: 999,
        subject: null,
        raw_text: "hello",
        attachments: null,
      }),
    ).rejects.toThrow("connection 999 is not an active connection");
    expect(db.inbox_items).toHaveLength(0);
  });

  it("rejects a connection whose status is not accepted", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(account({ id: 1, kind: "household" }));
    db.accounts.push(account({ id: 2, kind: "shadchanus" }));
    db.account_members.push(
      accountMember({ id: 2, account_id: 2, user_id: "1", role: "shadchan" }),
    );
    db.connections.push(connection({ id: 1, status: "ended" }));
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      redtViaConnection(provider, identityFor("1"), () => 2, {
        connection_id: 1,
        subject: null,
        raw_text: "hello",
        attachments: null,
      }),
    ).rejects.toThrow("connection 1 is not an active connection");
    expect(db.inbox_items).toHaveLength(0);
  });

  it("rejects a caller who holds no active membership of the connection's shadchanus account", async () => {
    // Arrange — user "2" belongs to neither side of connection 1.
    const db = emptyDb();
    db.accounts.push(account({ id: 1, kind: "household" }));
    db.accounts.push(account({ id: 2, kind: "shadchanus" }));
    db.account_members.push(
      accountMember({ id: 3, account_id: 3, user_id: "2", role: "shadchan" }),
    );
    db.connections.push(connection({ id: 1, status: "accepted" }));
    const provider = buildProvider(db);

    // Act / Assert
    await expect(
      redtViaConnection(provider, identityFor("2"), () => 3, {
        connection_id: 1,
        subject: null,
        raw_text: "hello",
        attachments: null,
      }),
    ).rejects.toThrow(
      "caller is not an active member of this connection's shadchanus context",
    );
    expect(db.inbox_items).toHaveLength(0);
  });
});
