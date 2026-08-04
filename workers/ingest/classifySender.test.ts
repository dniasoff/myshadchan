import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ENV } from "./emailFixtures";
import { classifySender } from "./classifySender";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/**
 * A minimal in-memory fake of the two tables `classifySender.ts` touches
 * through TWO different clients — the raw service-role client (`members`,
 * which has no `account_id` column) and `forAccount()`'s scoped client
 * (`account_members`, `trusted_senders`) — both resolving to the SAME
 * `@supabase/supabase-js` mock, so both see the same fake rows. Same
 * "mock the client entirely" idiom `forAccount.test.ts` and
 * `share/index.test.ts` already use in this repo.
 */
const { tables, from, resetFakeDb } = vi.hoisted(() => {
  const tables: Tables = {};

  // Loose (`==`) equality, not strict: `forAccount()`'s string accountId
  // ("1") legitimately matches a numeric `account_id` column (1) — this
  // fake reproduces that PostgREST-over-HTTP coercion rather than being
  // stricter than the real thing it stands in for.
  function matches(row: Row, filters: Array<[string, unknown]>): boolean {
    return filters.every(([col, val]) => row[col] == val);
  }

  function makeQuery(tableName: string) {
    const filters: Array<[string, unknown]> = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      async maybeSingle() {
        const rows = (tables[tableName] ?? []).filter((row) =>
          matches(row, filters),
        );
        return { data: rows[0] ?? null, error: null };
      },
    };
    return builder;
  }

  const from = vi.fn((tableName: string) => makeQuery(tableName));

  function resetFakeDb() {
    for (const key of Object.keys(tables)) delete tables[key];
    from.mockClear();
  }

  return { tables, from, resetFakeDb };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from }),
}));

describe("classifySender", () => {
  beforeEach(() => {
    resetFakeDb();
    tables.members = [
      { user_id: "user-a", email: "parent@household-a.example.com" },
      { user_id: "user-b", email: "parent@household-b.example.com" },
    ];
    tables.account_members = [
      { account_id: 1, user_id: "user-a", status: "active" },
      { account_id: 2, user_id: "user-b", status: "active" },
      // An archived membership must not count as "known".
      { account_id: 1, user_id: "user-archived", status: "archived" },
    ];
    tables.members.push({
      user_id: "user-archived",
      email: "former-member@household-a.example.com",
    });
    tables.trusted_senders = [
      { account_id: 1, email: "trusted@example.com" },
      { account_id: 2, email: "trusted-for-b-only@example.com" },
    ];
  });

  it("classifies an active member of the resolved account as known", async () => {
    // Arrange / Act
    const result = await classifySender(
      "parent@household-a.example.com",
      1,
      TEST_ENV,
    );

    // Assert
    expect(result).toBe("known");
  });

  it("classifies a trusted_senders address for the resolved account as known", async () => {
    // Arrange / Act
    const result = await classifySender("trusted@example.com", 1, TEST_ENV);

    // Assert
    expect(result).toBe("known");
  });

  it("classifies a sender who is neither a member nor trusted as unknown", async () => {
    // Arrange / Act
    const result = await classifySender("stranger@example.com", 1, TEST_ENV);

    // Assert
    expect(result).toBe("unknown");
  });

  it("classifies an archived (no longer active) member as unknown", async () => {
    // Arrange / Act
    const result = await classifySender(
      "former-member@household-a.example.com",
      1,
      TEST_ENV,
    );

    // Assert
    expect(result).toBe("unknown");
  });

  it("SECURITY: a member of a DIFFERENT account is classified unknown, never known", async () => {
    // Arrange: user-b is an ACTIVE member — but of account 2, not account 1.
    // This is the cross-tenant regression this test exists to catch: if
    // classifySender's account_members lookup ever stopped scoping by
    // account_id (e.g. reverted to a raw, unscoped `members`-only check),
    // this assertion would flip to "known" and fail.
    // Act
    const result = await classifySender(
      "parent@household-b.example.com",
      1,
      TEST_ENV,
    );

    // Assert
    expect(result).toBe("unknown");
  });

  it("SECURITY: a trusted_senders row for a DIFFERENT account does not make a sender known here", async () => {
    // Arrange / Act — "trusted-for-b-only@example.com" is trusted for
    // account 2 only.
    const result = await classifySender(
      "trusted-for-b-only@example.com",
      1,
      TEST_ENV,
    );

    // Assert
    expect(result).toBe("unknown");
  });

  it("the same address can be independently trusted by two unrelated households", async () => {
    // Arrange
    tables.trusted_senders.push({
      account_id: 2,
      email: "shared-rebbetzin@example.com",
    });
    tables.trusted_senders.push({
      account_id: 1,
      email: "shared-rebbetzin@example.com",
    });

    // Act
    const resultForA = await classifySender(
      "shared-rebbetzin@example.com",
      1,
      TEST_ENV,
    );
    const resultForB = await classifySender(
      "shared-rebbetzin@example.com",
      2,
      TEST_ENV,
    );

    // Assert
    expect(resultForA).toBe("known");
    expect(resultForB).toBe("known");
  });
});
