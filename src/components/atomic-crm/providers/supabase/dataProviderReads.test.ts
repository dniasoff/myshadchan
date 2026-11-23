import { beforeEach, describe, expect, it, vi } from "vitest";
import postgrestRestProvider from "@raphiniert/ra-data-postgrest";

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

const { applyFullTextSearch, getDataProviderWithCustomMethods } =
  await import("./dataProvider");

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

  it("adds an explicit active filter for reminder label lookups", async () => {
    const dataProvider = getDataProviderWithCustomMethods();

    await dataProvider.getMany("shidduchim", {
      ids: [1, 2],
      meta: { shidduchActiveOnly: true },
    });

    expect(baseProvider.getList).toHaveBeenCalledWith("shidduchim_summary", {
      filter: { "id@in": "(1,2)", "archived_at@is": null },
      pagination: { page: 1, perPage: 2 },
      sort: { field: "id", order: "ASC" },
    });
    expect(baseProvider.getMany).not.toHaveBeenCalled();
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

describe("the real PostgREST request builder", () => {
  it("encodes an explicit null filter as is.null", async () => {
    let requestedUrl = "";
    const httpClient = vi.fn(async (url: string) => {
      requestedUrl = url;
      return {
        headers: {
          has: () => true,
          get: () => "0-0/0",
        },
        json: [],
      };
    });
    const provider = postgrestRestProvider({
      apiUrl: "http://supabase.test/rest/v1",
      httpClient,
      defaultListOp: "eq",
      primaryKeys: new Map(),
      schema: () => "",
    });

    await provider.getList("resume_photos", {
      filter: { resume_id: 33, "hidden_at@is": null },
      pagination: { page: 1, perPage: 20 },
      sort: { field: "uploaded_at", order: "DESC" },
    });

    expect(requestedUrl).toContain("hidden_at=is.null");
    expect(requestedUrl).not.toContain("hidden_at=eq.null");
  });

  it("quotes structural search punctuation while preserving phone digit matching", async () => {
    const searchableColumns = [
      "name_en",
      "shadchan_name",
      "suggested_by_phone",
    ];

    const requestUrlFor = async (q: string): Promise<URL> => {
      let requestedUrl = "";
      const httpClient = vi.fn(async (url: string) => {
        requestedUrl = url;
        return {
          headers: {
            has: () => true,
            get: () => "0-0/0",
          },
          json: [],
        };
      });
      const provider = postgrestRestProvider({
        apiUrl: "http://supabase.test/rest/v1",
        httpClient,
        defaultListOp: "eq",
        primaryKeys: new Map(),
        schema: () => "",
      });
      const params = applyFullTextSearch(searchableColumns)({
        filter: { q },
        pagination: { page: 1, perPage: 20 },
        sort: { field: "id", order: "ASC" },
      });

      await provider.getList("shidduchim", params);
      return new URL(requestedUrl);
    };

    const splitOutsideQuotes = (value: string): string[] => {
      const expressions: string[] = [];
      let start = 0;
      let quoted = false;
      let escaped = false;
      for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (escaped) {
          escaped = false;
        } else if (quoted && character === "\\") {
          escaped = true;
        } else if (character === '"') {
          quoted = !quoted;
        } else if (!quoted && character === ",") {
          expressions.push(value.slice(start, index));
          start = index + 1;
        }
      }
      expressions.push(value.slice(start));
      return expressions;
    };

    const assertValuesQuoteStructuralCharacters = (url: URL) => {
      const or = url.searchParams.get("or");
      expect(or).toBeTruthy();
      const expressions = splitOutsideQuotes(or!.slice(1, -1));
      for (const expression of expressions) {
        const value = expression.slice(expression.indexOf(".ilike.") + 7);
        let quoted = false;
        let escaped = false;
        const unquotedStructuralCharacters: string[] = [];
        for (const character of value) {
          if (escaped) {
            escaped = false;
          } else if (quoted && character === "\\") {
            escaped = true;
          } else if (character === '"') {
            quoted = !quoted;
          } else if (!quoted && /[,():;\\]/.test(character)) {
            unquotedStructuralCharacters.push(character);
          }
        }
        expect(unquotedStructuralCharacters).toEqual([]);
      }
    };

    const formattedPhoneUrl = await requestUrlFor("(732) 814-5891");
    assertValuesQuoteStructuralCharacters(formattedPhoneUrl);
    expect(formattedPhoneUrl.searchParams.get("or")).toContain(
      "suggested_by_phone.ilike.*7%3%2%8%1%4%5%8%9%1*",
    );

    const punctuationUrl = await requestUrlFor('a,b(c)"d');
    assertValuesQuoteStructuralCharacters(punctuationUrl);
    expect(punctuationUrl.searchParams.get("or")).toContain(
      'name_en.ilike.*"a,b(c)\\"d"*',
    );

    const plainUrl = await requestUrlFor("Rivka");
    assertValuesQuoteStructuralCharacters(plainUrl);
    expect(plainUrl.searchParams.get("or")).toContain("name_en.ilike.*Rivka*");
  });
});
