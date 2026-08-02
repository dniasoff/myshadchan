import type { DataProvider, Identifier } from "ra-core";

import type { Account, AccountMember, Member, Single } from "../../../types";
import { addPersona, getMyPersonas } from "./personas";

/**
 * Pins the FakeRest mirror of `public.my_personas()` / `public.add_persona()`
 * (02_functions.sql) to the same provisioning rules the SQL enforces —
 * previously untested (2.3 review finding #3): the `self_manager` ->
 * `parent_admin` in-place promotion, the "never promote / never attach to a
 * helper's household" rules, and every idempotency no-op. Also pins 2.2
 * review finding #4's household/shadchanus naming (2.3 review finding #4:
 * this mirror had drifted from the SQL it claims to copy).
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

/** A minimal in-memory DataProvider — getList (equality filter only),
 * getOne, create (auto-increment id) and update by id — enough to serve
 * `personas.ts`'s exact call shapes without pulling in `ra-data-fakerest`. */
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
        Object.entries(filter).every(([key, value]) => row[key] === value),
      );
      return { data, total: data.length };
    },
    getOne: async (resource: string, params: { id: Identifier }) => {
      const row = tableFor(resource).find((r) => r.id === params.id);
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
      const index = table.findIndex((r) => r.id === params.id);
      table[index] = { ...table[index], ...params.data };
      return { data: table[index] };
    },
  } as unknown as DataProvider;
};

const identityFor = (id: Identifier | null) => async () =>
  id == null ? null : { id };

const member = (overrides: Partial<Member>): Member =>
  ({
    id: 0,
    first_name: "Jane",
    last_name: "Doe",
    administrator: false,
    user_id: "0",
    email: "jane@example.com",
    ...overrides,
  }) as Member;

const account = (overrides: Partial<Account>): Account =>
  ({
    id: 1,
    name: "My Account",
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

describe("getMyPersonas", () => {
  it("returns no personas for a signed-out caller", async () => {
    // Arrange
    const db = emptyDb();
    const provider = buildProvider(db);

    // Act
    const personas = await getMyPersonas(provider, identityFor(null));

    // Assert
    expect(personas).toEqual([]);
  });

  it("returns no personas for a caller with zero active memberships", async () => {
    // Arrange
    const db = emptyDb();
    const provider = buildProvider(db);

    // Act
    const personas = await getMyPersonas(provider, identityFor(0));

    // Assert
    expect(personas).toEqual([]);
  });

  it("reports parent for an active parent_admin with no singles row yet", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(account({ id: 1, kind: "household" }));
    db.account_members.push(
      accountMember({
        id: 1,
        account_id: 1,
        user_id: "0",
        role: "parent_admin",
      }),
    );
    const provider = buildProvider(db);

    // Act
    const personas = await getMyPersonas(provider, identityFor(0));

    // Assert
    expect(personas).toEqual([
      {
        persona: "parent",
        account_id: 1,
        account_kind: "household",
        role: "parent_admin",
      },
    ]);
  });

  it("reports both parent and single when a singles row points at the parent_admin membership", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(account({ id: 1, kind: "household" }));
    db.account_members.push(
      accountMember({
        id: 1,
        account_id: 1,
        user_id: "0",
        role: "parent_admin",
      }),
    );
    db.singles.push({
      id: 1,
      account_id: 1,
      member_id: 1,
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    } as Single);
    const provider = buildProvider(db);

    // Act
    const personas = await getMyPersonas(provider, identityFor(0));

    // Assert
    expect(personas).toEqual([
      {
        persona: "parent",
        account_id: 1,
        account_kind: "household",
        role: "parent_admin",
      },
      {
        persona: "single",
        account_id: 1,
        account_kind: "household",
        role: "parent_admin",
      },
    ]);
  });

  it("reports single for an invited single-role membership with a linked singles row", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(account({ id: 1, kind: "household" }));
    db.account_members.push(
      accountMember({ id: 1, account_id: 1, user_id: "5", role: "single" }),
    );
    db.singles.push({
      id: 1,
      account_id: 1,
      member_id: 1,
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    } as Single);
    const provider = buildProvider(db);

    // Act
    const personas = await getMyPersonas(provider, identityFor(5));

    // Assert
    expect(personas).toEqual([
      {
        persona: "single",
        account_id: 1,
        account_kind: "household",
        role: "single",
      },
    ]);
  });

  it("reports shadchan with the shadchanus account kind", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(account({ id: 2, kind: "shadchanus" }));
    db.account_members.push(
      accountMember({ id: 1, account_id: 2, user_id: "0", role: "shadchan" }),
    );
    const provider = buildProvider(db);

    // Act
    const personas = await getMyPersonas(provider, identityFor(0));

    // Assert
    expect(personas).toEqual([
      {
        persona: "shadchan",
        account_id: 2,
        account_kind: "shadchanus",
        role: "shadchan",
      },
    ]);
  });

  it("never reports a persona for a helper membership (helper is not a persona)", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(account({ id: 1, kind: "household" }));
    db.account_members.push(
      accountMember({ id: 1, account_id: 1, user_id: "0", role: "helper" }),
    );
    const provider = buildProvider(db);

    // Act
    const personas = await getMyPersonas(provider, identityFor(0));

    // Assert
    expect(personas).toEqual([]);
  });
});

describe("addPersona", () => {
  it("throws when there is no signed-in user", async () => {
    // Arrange
    const provider = buildProvider(emptyDb());

    // Act / Assert
    await expect(
      addPersona(provider, identityFor(null), "parent"),
    ).rejects.toThrow("addPersona requires a signed-in user");
  });

  it("creates a new household named after the caller when adding parent from nothing", async () => {
    // Arrange
    const db = emptyDb();
    db.members.push(member({ id: 0, first_name: "Chana" }));
    const provider = buildProvider(db);

    // Act
    await addPersona(provider, identityFor(0), "parent");

    // Assert
    expect(db.accounts).toHaveLength(1);
    expect(db.accounts[0]).toMatchObject({
      name: "Chana's Family",
      kind: "household",
    });
    expect(db.account_members).toHaveLength(1);
    expect(db.account_members[0]).toMatchObject({
      account_id: db.accounts[0].id,
      role: "parent_admin",
      status: "active",
    });
  });

  it("names a fresh household 'My Account' when the caller's first name is the dead 'Pending' placeholder", async () => {
    // Arrange — mirrors 02_functions.sql's nullif(v_first_name, 'Pending')
    // guard (2.2 review finding #4): the real default for members.first_name.
    const db = emptyDb();
    db.members.push(member({ id: 0, first_name: "Pending" }));
    const provider = buildProvider(db);

    // Act
    await addPersona(provider, identityFor(0), "parent");

    // Assert
    expect(db.accounts[0].name).toBe("My Account");
  });

  it("promotes an existing active self_manager membership to parent_admin in place", async () => {
    // Arrange
    const db = emptyDb();
    db.members.push(member({ id: 0, first_name: "Chana" }));
    db.accounts.push(account({ id: 1, kind: "household" }));
    db.account_members.push(
      accountMember({
        id: 1,
        account_id: 1,
        user_id: "0",
        role: "self_manager",
      }),
    );
    const provider = buildProvider(db);

    // Act
    await addPersona(provider, identityFor(0), "parent");

    // Assert: no second household created, the SAME membership was promoted.
    expect(db.accounts).toHaveLength(1);
    expect(db.account_members).toHaveLength(1);
    expect(db.account_members[0]).toMatchObject({
      id: 1,
      account_id: 1,
      role: "parent_admin",
    });
  });

  it("no-ops when the caller already holds an active parent_admin membership", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(account({ id: 1, kind: "household" }));
    db.account_members.push(
      accountMember({
        id: 1,
        account_id: 1,
        user_id: "0",
        role: "parent_admin",
      }),
    );
    const provider = buildProvider(db);

    // Act
    await addPersona(provider, identityFor(0), "parent");

    // Assert: nothing new created.
    expect(db.accounts).toHaveLength(1);
    expect(db.account_members).toHaveLength(1);
  });

  it("never promotes a non-owning (helper) membership — creates a separate household instead", async () => {
    // Arrange — a helper in someone else's household is not entitled to be
    // promoted into admin of it.
    const db = emptyDb();
    db.members.push(member({ id: 0, first_name: "Chana" }));
    db.accounts.push(
      account({ id: 1, kind: "household", name: "Someone Else's Family" }),
    );
    db.account_members.push(
      accountMember({ id: 1, account_id: 1, user_id: "0", role: "helper" }),
    );
    const provider = buildProvider(db);

    // Act
    await addPersona(provider, identityFor(0), "parent");

    // Assert: a SECOND, separate household was created; the helper
    // membership is untouched.
    expect(db.accounts).toHaveLength(2);
    expect(db.account_members).toHaveLength(2);
    expect(db.account_members[0]).toMatchObject({
      id: 1,
      role: "helper",
      account_id: 1,
    });
    const newMembership = db.account_members[1];
    expect(newMembership.role).toBe("parent_admin");
    expect(newMembership.account_id).not.toBe(1);
  });

  it("creates a self-managed household and a singles row when adding single from nothing", async () => {
    // Arrange
    const db = emptyDb();
    db.members.push(member({ id: 0, first_name: "Devorah" }));
    const provider = buildProvider(db);

    // Act
    await addPersona(provider, identityFor(0), "single");

    // Assert
    expect(db.accounts).toHaveLength(1);
    expect(db.account_members).toHaveLength(1);
    expect(db.account_members[0].role).toBe("self_manager");
    expect(db.singles).toHaveLength(1);
    expect(db.singles[0]).toMatchObject({
      account_id: db.accounts[0].id,
      member_id: db.account_members[0].id,
    });
  });

  it("attaches single to an existing owning (parent_admin) membership rather than creating a new household", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(account({ id: 1, kind: "household" }));
    db.account_members.push(
      accountMember({
        id: 1,
        account_id: 1,
        user_id: "0",
        role: "parent_admin",
      }),
    );
    const provider = buildProvider(db);

    // Act
    await addPersona(provider, identityFor(0), "single");

    // Assert
    expect(db.accounts).toHaveLength(1);
    expect(db.account_members).toHaveLength(1);
    expect(db.singles).toHaveLength(1);
    expect(db.singles[0]).toMatchObject({ account_id: 1, member_id: 1 });
  });

  it("never attaches single to a helper's (non-owning) household — creates a separate one instead", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(
      account({ id: 1, kind: "household", name: "Someone Else's Family" }),
    );
    db.account_members.push(
      accountMember({ id: 1, account_id: 1, user_id: "0", role: "helper" }),
    );
    db.members.push(member({ id: 0, first_name: "Devorah" }));
    const provider = buildProvider(db);

    // Act
    await addPersona(provider, identityFor(0), "single");

    // Assert: a NEW household was created for the caller's own single record;
    // the helper's household gained no singles row.
    expect(db.accounts).toHaveLength(2);
    expect(db.singles).toHaveLength(1);
    expect(db.singles[0].account_id).not.toBe(1);
  });

  it("no-ops when a singles row already points at one of the caller's owning memberships", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(account({ id: 1, kind: "household" }));
    db.account_members.push(
      accountMember({
        id: 1,
        account_id: 1,
        user_id: "0",
        role: "parent_admin",
      }),
    );
    db.singles.push({
      id: 1,
      account_id: 1,
      member_id: 1,
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    } as Single);
    const provider = buildProvider(db);

    // Act
    await addPersona(provider, identityFor(0), "single");

    // Assert: no second singles row.
    expect(db.singles).toHaveLength(1);
  });

  it("creates a shadchanus account named 'My Account' (matches the SQL's bare `insert (kind)`)", async () => {
    // Arrange — 2.2 review finding #4: the real add_persona() never sets
    // `name` on the shadchanus insert, so it takes the column default.
    const db = emptyDb();
    db.members.push(member({ id: 0, first_name: "Moshe" }));
    const provider = buildProvider(db);

    // Act
    await addPersona(provider, identityFor(0), "shadchan");

    // Assert
    expect(db.accounts).toHaveLength(1);
    expect(db.accounts[0]).toMatchObject({
      name: "My Account",
      kind: "shadchanus",
    });
    expect(db.account_members).toHaveLength(1);
    expect(db.account_members[0]).toMatchObject({
      account_id: db.accounts[0].id,
      role: "shadchan",
      status: "active",
    });
  });

  it("no-ops when the caller already holds an active shadchan membership", async () => {
    // Arrange
    const db = emptyDb();
    db.accounts.push(account({ id: 2, kind: "shadchanus" }));
    db.account_members.push(
      accountMember({ id: 1, account_id: 2, user_id: "0", role: "shadchan" }),
    );
    const provider = buildProvider(db);

    // Act
    await addPersona(provider, identityFor(0), "shadchan");

    // Assert
    expect(db.accounts).toHaveLength(1);
    expect(db.account_members).toHaveLength(1);
  });
});
