import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ENV } from "./emailFixtures";
import { resolveAccountId } from "./resolveAccount";

type Row = Record<string, unknown>;

const { eq, maybeSingle, select, from } = vi.hoisted(() => {
  const accounts: Row[] = [
    { id: 1, inbound_email_token: "abc123def456" },
    { id: 2, inbound_email_token: "fedcba654321" },
  ];
  let filters: Array<[string, unknown]> = [];

  const eq = vi.fn((col: string, val: unknown) => {
    filters.push([col, val]);
    return builder;
  });
  const maybeSingle = vi.fn(
    async (): Promise<{
      data: Row | null;
      error: { message: string } | null;
    }> => {
      const activeFilters = filters;
      filters = [];
      // citext semantics: case-insensitive equality, mirroring the real column.
      const row = accounts.find((account) =>
        activeFilters.every(
          ([col, val]) =>
            String(account[col]).toLowerCase() === String(val).toLowerCase(),
        ),
      );
      return { data: row ?? null, error: null };
    },
  );
  const select = vi.fn(() => builder);
  const builder = { select, eq, maybeSingle };
  const from = vi.fn(() => builder);
  return { eq, maybeSingle, select, from };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from }),
}));

describe("resolveAccountId", () => {
  beforeEach(() => {
    // Test isolation (testing.md): call-history mocks reset per test — the
    // underlying implementations (and any queued `mockResolvedValueOnce`
    // added within a single test) are untouched by `mockClear()`.
    from.mockClear();
    select.mockClear();
    eq.mockClear();
    maybeSingle.mockClear();
  });

  it("resolves the household account_id for a valid token address", async () => {
    // Arrange / Act
    const accountId = await resolveAccountId(
      "abc123def456@myshadchan.space",
      TEST_ENV,
    );

    // Assert
    expect(from).toHaveBeenCalledWith("accounts");
    expect(eq).toHaveBeenCalledWith("inbound_email_token", "abc123def456");
    expect(accountId).toBe(1);
  });

  it("matches the token case-insensitively, exactly like the citext column", async () => {
    // Arrange / Act
    const accountId = await resolveAccountId(
      "ABC123DEF456@myshadchan.space",
      TEST_ENV,
    );

    // Assert
    expect(accountId).toBe(1);
  });

  it("returns null for an address matching no household's token", async () => {
    // Arrange / Act
    const accountId = await resolveAccountId(
      "nosuchtoken@myshadchan.space",
      TEST_ENV,
    );

    // Assert
    expect(accountId).toBeNull();
  });

  it("returns null for a recipient with no @", async () => {
    // Arrange / Act
    const accountId = await resolveAccountId("not-an-address", TEST_ENV);

    // Assert
    expect(accountId).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("returns null when the database lookup errors, rather than throwing", async () => {
    // Arrange
    maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "connection reset" },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Act
    const accountId = await resolveAccountId(
      "abc123def456@myshadchan.space",
      TEST_ENV,
    );

    // Assert
    expect(accountId).toBeNull();
    errorSpy.mockRestore();
  });
});
