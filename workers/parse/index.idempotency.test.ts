import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createParseApp } from "./index";
import { ENTITLED_PAYLOAD, TEST_ENV, makeExtract } from "./parseTestFixtures";

/**
 * Finding 8 (Story 11-1 review report): a repeat POST /parse for the exact
 * same (account, inbox item, attachment) must replay a completed result
 * instead of re-invoking the model and re-metering usage. Split out of
 * `index.test.ts` once it would have pushed that file well past the
 * ~400-line typical ceiling (coding-style.md) — see `parseIdempotency.ts`
 * for the mechanism itself.
 */

const rpc = vi.fn();
const select = vi.fn().mockReturnThis();
const eq = vi.fn().mockReturnThis();
const single = vi.fn();
const update = vi.fn().mockReturnThis();
const insert = vi.fn().mockReturnThis();
const storageFrom = vi.fn();
const download = vi.fn();
const list = vi.fn();
const from = vi.fn(() => ({ select, eq, single, update, insert }));

const aiUsageEq = vi.fn().mockReturnValue({ data: [], error: null });
const aiUsageSelect = vi.fn().mockReturnValue({ eq: aiUsageEq });
const aiUsageUpdateEq = vi.fn().mockReturnValue({ data: null, error: null });
const aiUsageInsert = vi.fn().mockReturnValue({ error: null });

const mockScopedTable = {
  select: aiUsageSelect,
  insert: aiUsageInsert,
  update: vi.fn(() => ({ eq: aiUsageUpdateEq })),
  delete: vi.fn(),
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc,
    from,
    storage: { from: storageFrom },
  }),
}));

vi.mock("../shared/forAccount", () => ({
  forAccount: vi.fn(() => ({ from: () => mockScopedTable })),
}));

function arrangeEntitledItemWithAttachment() {
  rpc.mockResolvedValue({ data: ENTITLED_PAYLOAD, error: null });
  single.mockResolvedValue({
    data: {
      id: 1,
      account_id: 10,
      attachments: [
        {
          title: "resume.pdf",
          type: "application/pdf",
          path: "10/resume.pdf",
        },
      ],
    },
    error: null,
  });
  storageFrom.mockReturnValue({ download, list });
}

function postParse(app: ReturnType<typeof createParseApp>) {
  return app.request(
    "http://parse.local/parse",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inbox_item_id: 1 }),
    },
    TEST_ENV,
  );
}

describe("Finding 8 — idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    select.mockReturnThis();
    eq.mockReturnThis();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replays a cached result without downloading, extracting, or metering usage", async () => {
    // Arrange
    arrangeEntitledItemWithAttachment();
    const cachedPayload = {
      fields: { name_en: "Cached Rivky" },
      lowConfidenceFields: [],
      sections: { learningHistory: [], references: [] },
      rawDraft: {},
    };
    const cacheMatch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(cachedPayload)));
    vi.stubGlobal("caches", { default: { match: cacheMatch, put: vi.fn() } });
    const extractSpy = vi.fn(async () => makeExtract());
    const app = createParseApp({ extract: extractSpy });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: cachedPayload,
    });
    expect(extractSpy).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
    // The metered path is `forAccount(...).from("ai_usage")`
    // (`aiUsageSelect`/`aiUsageInsert`), not the raw `supabase.from(...)`
    // mock — asserting against these is what actually proves a cache hit
    // never re-meters usage.
    expect(aiUsageSelect).not.toHaveBeenCalled();
    expect(aiUsageInsert).not.toHaveBeenCalled();
  });

  it("writes the completed result to the cache, keyed on account + inbox item + attachment path", async () => {
    // Arrange
    arrangeEntitledItemWithAttachment();
    const cacheMatch = vi.fn().mockResolvedValue(undefined);
    const cachePut = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("caches", {
      default: { match: cacheMatch, put: cachePut },
    });
    list.mockResolvedValue({ data: [], error: null });
    download.mockResolvedValue({
      data: new Blob(["pdf bytes"]),
      error: null,
    });
    const raw = makeExtract();
    const app = createParseApp({ extract: async () => raw });

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(200);
    expect(cachePut).toHaveBeenCalledTimes(1);
    const [cacheKey, cachedResponse] = cachePut.mock.calls[0];
    expect(cacheKey.url).toContain("/parse/10/1/");
    expect(cacheKey.url).toContain(encodeURIComponent("10/resume.pdf"));
    const cachedBody = await cachedResponse.json();
    expect(cachedBody.rawDraft).toEqual(raw);
  });

  it("still enforces the monthly cap ahead of the cache probe (documented ordering trade-off)", async () => {
    // Arrange — the cap check (step 2) runs before the item/attachment are
    // even fetched, so it fires before the cache could ever be consulted.
    // This is the deliberate trade-off documented on the route: no new
    // spend occurs, but a retry of an already-completed item still sees 402
    // while the account is at its cap.
    rpc.mockResolvedValue({
      data: { ...ENTITLED_PAYLOAD, resumes_used: 50, resumes_limit: 50 },
      error: null,
    });
    const cacheMatch = vi.fn();
    vi.stubGlobal("caches", { default: { match: cacheMatch, put: vi.fn() } });
    const app = createParseApp();

    // Act
    const res = await postParse(app);

    // Assert
    expect(res.status).toBe(402);
    expect(cacheMatch).not.toHaveBeenCalled();
  });
});
