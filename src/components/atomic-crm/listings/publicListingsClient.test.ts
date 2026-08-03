import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `loadPublicListings` against a MOCKED Supabase client — FakeRest is a
 * `dataProvider` seam and plays no part in this direct-client path (Task
 * 4). These tests pin the query-builder call SHAPE: exactly which table,
 * columns, and filters get built for a given input, and that the search
 * text always reaches Postgres through `.ilike()`/`.or()`, never a raw
 * string concatenated in.
 */

interface MockListingsBuilder {
  select: (...args: unknown[]) => MockListingsBuilder;
  eq: (...args: unknown[]) => MockListingsBuilder;
  or: (...args: unknown[]) => MockListingsBuilder;
  order: (...args: unknown[]) => MockListingsBuilder;
  then: (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
  ) => Promise<unknown>;
}

type BuilderCalls = Record<"select" | "eq" | "or" | "order", unknown[][]>;

/** A chainable stand-in for postgrest-js's real query builder, which is
 * itself a thenable — `.then` is what lets `publicListingsClient.ts`'s own
 * `await builder` resolve the way it would against the real client. */
function createQueryBuilder(result: { data: unknown; error: unknown }): {
  builder: MockListingsBuilder;
  calls: BuilderCalls;
} {
  const calls: BuilderCalls = { select: [], eq: [], or: [], order: [] };
  const builder: MockListingsBuilder = {
    select: (...args) => {
      calls.select.push(args);
      return builder;
    },
    eq: (...args) => {
      calls.eq.push(args);
      return builder;
    },
    or: (...args) => {
      calls.or.push(args);
      return builder;
    },
    order: (...args) => {
      calls.order.push(args);
      return builder;
    },
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return { builder, calls };
}

const client = { from: vi.fn() };

vi.mock("../providers/supabase/supabase", () => ({
  getSupabaseClient: () => client,
}));

const { loadPublicListings } = await import("./publicListingsClient");

describe("loadPublicListings — query shape", () => {
  beforeEach(() => {
    client.from.mockReset();
  });

  it("selects every column from the listings table, newest first, with no filter for an empty query", async () => {
    // Arrange
    const { builder, calls } = createQueryBuilder({ data: [], error: null });
    client.from.mockReturnValue(builder);

    // Act
    await loadPublicListings({});

    // Assert
    expect(client.from).toHaveBeenCalledWith("listings");
    expect(calls.select).toEqual([["*"]]);
    expect(calls.order).toEqual([["created_at", { ascending: false }]]);
    expect(calls.eq).toEqual([]);
    expect(calls.or).toEqual([]);
  });

  it("filters by listing_type through .eq(), never a raw filter string", async () => {
    // Arrange
    const { builder, calls } = createQueryBuilder({ data: [], error: null });
    client.from.mockReturnValue(builder);

    // Act
    await loadPublicListings({ type: "shadchan" });

    // Assert
    expect(calls.eq).toEqual([["listing_type", "shadchan"]]);
  });

  it("searches every opted-in text column through one .or()/.ilike() filter list", async () => {
    // Arrange
    const { builder, calls } = createQueryBuilder({ data: [], error: null });
    client.from.mockReturnValue(builder);

    // Act
    await loadPublicListings({ text: "chaya" });

    // Assert
    expect(calls.or).toHaveLength(1);
    expect(calls.or[0][0]).toBe(
      [
        'shadchan_name.ilike."%chaya%"',
        'shadchan_area.ilike."%chaya%"',
        'single_first_name_en.ilike."%chaya%"',
        'single_first_name_he.ilike."%chaya%"',
        'single_community.ilike."%chaya%"',
        'single_location.ilike."%chaya%"',
      ].join(","),
    );
  });

  it("issues no .or() filter at all for an empty or whitespace-only search", async () => {
    // Arrange
    const { builder, calls } = createQueryBuilder({ data: [], error: null });
    client.from.mockReturnValue(builder);

    // Act
    await loadPublicListings({ text: "   " });

    // Assert
    expect(calls.or).toEqual([]);
  });

  it("escapes a comma, parenthesis and quote in the search text so it cannot be read as a second filter condition", async () => {
    // Arrange — a comma/parenthesis in an UNESCAPED PostgREST .or() value
    // would terminate the first condition early and start a new one; a
    // literal double quote would terminate the escaped value early.
    const { builder, calls } = createQueryBuilder({ data: [], error: null });
    client.from.mockReturnValue(builder);

    // Act
    await loadPublicListings({ text: 'a,b(c)"d' });

    // Assert — the whole value stays inside one pair of double quotes, with
    // the inner quote itself backslash-escaped, and every one of the six
    // searchable columns carries that same escaped value verbatim (proving
    // the comma inside it was never treated as a filter-list separator).
    const orFilter = calls.or[0][0] as string;
    expect(orFilter).toBe(
      [
        'shadchan_name.ilike."%a,b(c)\\"d%"',
        'shadchan_area.ilike."%a,b(c)\\"d%"',
        'single_first_name_en.ilike."%a,b(c)\\"d%"',
        'single_first_name_he.ilike."%a,b(c)\\"d%"',
        'single_community.ilike."%a,b(c)\\"d%"',
        'single_location.ilike."%a,b(c)\\"d%"',
      ].join(","),
    );
  });

  it("resolves to the rows the query returns", async () => {
    // Arrange
    const rows = [{ id: 1, listing_type: "shadchan" }];
    const { builder } = createQueryBuilder({ data: rows, error: null });
    client.from.mockReturnValue(builder);

    // Act
    const result = await loadPublicListings({});

    // Assert
    expect(result).toEqual(rows);
  });

  it("resolves to an empty array when the query returns null data", async () => {
    // Arrange
    const { builder } = createQueryBuilder({ data: null, error: null });
    client.from.mockReturnValue(builder);

    // Act
    const result = await loadPublicListings({});

    // Assert
    expect(result).toEqual([]);
  });

  it("throws a friendly error when the query fails", async () => {
    // Arrange
    const { builder } = createQueryBuilder({
      data: null,
      error: { message: "permission denied for table listings" },
    });
    client.from.mockReturnValue(builder);

    // Act / Assert
    await expect(loadPublicListings({})).rejects.toThrow(
      "permission denied for table listings",
    );
  });
});
