import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The `shidduchim` read redirects, tested against what ships.
 *
 * These used to be a pure AD-10 convention (the summary view carries the
 * joined names, so the board fetches once instead of N+1). They are now a
 * PRIVILEGE requirement as well: `public.shidduchim` no longer grants
 * `authenticated` a table-level SELECT, because Story 6.3's AC-4 —
 * `close_reason` always reads NULL for a `single` — is enforced by withholding
 * that one column, and Postgres has no "all columns except one" grant. So
 * SELECT is granted column by column instead, and PostgREST's default
 * `select=*` representation answers
 * `403 {"code":"42501","message":"permission denied for table shidduchim"}`.
 *
 * A redirect silently dropped from any of these three methods therefore does
 * not degrade a join — it turns a working screen into an error. Nothing else
 * in the repo covers this wiring: it is behaviour of the provider object, not
 * of the lifecycle callbacks `dataProvider.test.ts` exercises.
 */

const baseProvider = {
  getList: vi.fn(async () => ({ data: [], total: 0 })),
  getOne: vi.fn(async () => ({ data: { id: 1 } })),
  getMany: vi.fn(async () => ({ data: [] })),
};

vi.mock("ra-supabase-core", () => ({
  supabaseDataProvider: () => baseProvider,
}));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({ rpc: vi.fn(), functions: { invoke: vi.fn() } }),
}));

const { getDataProviderWithCustomMethods } = await import("./dataProvider");

describe("supabase dataProvider — shidduchim reads never address the base table", () => {
  beforeEach(() => {
    baseProvider.getList.mockClear();
    baseProvider.getOne.mockClear();
    baseProvider.getMany.mockClear();
  });

  it("routes getList to shidduchim_summary", async () => {
    // Arrange
    const dataProvider = getDataProviderWithCustomMethods();

    // Act
    await dataProvider.getList("shidduchim", {
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
      filter: {},
    });

    // Assert
    expect(baseProvider.getList).toHaveBeenCalledWith(
      "shidduchim_summary",
      expect.anything(),
    );
  });

  it("routes getOne to shidduchim_summary", async () => {
    // Arrange
    const dataProvider = getDataProviderWithCustomMethods();

    // Act
    await dataProvider.getOne("shidduchim", { id: 1 });

    // Assert
    expect(baseProvider.getOne).toHaveBeenCalledWith(
      "shidduchim_summary",
      expect.anything(),
    );
  });

  it("routes getMany to shidduchim_summary — the reminders hub would 403 on the base table", async () => {
    // Arrange
    const dataProvider = getDataProviderWithCustomMethods();

    // Act
    await dataProvider.getMany("shidduchim", { ids: [1, 2] });

    // Assert
    expect(baseProvider.getMany).toHaveBeenCalledWith("shidduchim_summary", {
      ids: [1, 2],
    });
  });

  it("leaves an unrelated resource's getMany on its own table", async () => {
    // Arrange
    const dataProvider = getDataProviderWithCustomMethods();

    // Act
    await dataProvider.getMany("singles", { ids: [1] });

    // Assert
    expect(baseProvider.getMany).toHaveBeenCalledWith("singles", { ids: [1] });
  });
});
