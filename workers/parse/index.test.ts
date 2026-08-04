import { beforeEach, describe, expect, it, vi } from "vitest";
import { createParseApp } from "./index";
import type { RawExtraction } from "./resumeExtractor";
import { ENTITLED_PAYLOAD, TEST_ENV, makeExtract } from "./parseTestFixtures";

// Finding 8 (idempotency) and Finding 9 (attachment size guard) each moved to
// their own file — `index.idempotency.test.ts` / `index.sizeGuard.test.ts` —
// once adding them here would have pushed this file well past the ~400-line
// typical ceiling (coding-style.md). They share this file's mock shape and
// `parseTestFixtures.ts`'s fixtures, but each still declares its own
// `vi.mock(...)` calls: those are per-file (Vitest hoists them within the
// file that declares them), so mocking cannot be centralized further.

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

const mockScopedTable = {
  select: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ data: [], error: null }),
  }),
  insert: vi.fn().mockReturnValue({ error: null }),
  update: vi.fn(() => ({
    eq: vi.fn().mockReturnValue({ data: null, error: null }),
  })),
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

describe("parse worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    select.mockReturnThis();
    eq.mockReturnThis();
  });

  it("responds to GET /health without auth", async () => {
    // Arrange
    const app = createParseApp();

    // Act
    const res = await app.request("http://parse.local/health", {}, TEST_ENV);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { worker: "parse", status: "ok" },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 402 for an unentitled POST to any route", async () => {
    // Arrange
    const app = createParseApp();
    rpc.mockResolvedValue({
      data: {
        is_entitled: false,
        plan: "free",
        resumes_used: 0,
        resumes_limit: 0,
      },
      error: null,
    });

    // Act
    const res = await app.request(
      "http://parse.local/probe",
      {
        method: "POST",
        headers: { Authorization: "Bearer token" },
      },
      TEST_ENV,
    );

    // Assert
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ success: false, error: "not entitled" });
  });

  it("returns the parsed draft on the happy path", async () => {
    // Arrange
    const raw = makeExtract();
    const app = createParseApp({
      extract: async () => raw,
    });
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
    list.mockResolvedValue({ data: [], error: null });
    download.mockResolvedValue({
      data: new Blob(["pdf bytes"]),
      error: null,
    });

    // Act
    const res = await app.request(
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

    // Assert
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data?: { fields: Record<string, unknown>; rawDraft: RawExtraction };
    };
    expect(json.success).toBe(true);
    expect(json.data?.fields.name_en).toBe("Rivky");
    expect(json.data?.rawDraft).toEqual(raw);
  });

  it("returns 402 when the monthly cap is reached", async () => {
    // Arrange
    const app = createParseApp();
    rpc.mockResolvedValue({
      data: { ...ENTITLED_PAYLOAD, resumes_used: 50, resumes_limit: 50 },
      error: null,
    });

    // Act
    const res = await app.request(
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

    // Assert
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      success: false,
      error: "monthly resume limit reached",
    });
    expect(single).not.toHaveBeenCalled();
  });

  it("returns 404 when the inbox item is not found", async () => {
    // Arrange
    const app = createParseApp();
    rpc.mockResolvedValue({ data: ENTITLED_PAYLOAD, error: null });
    single.mockResolvedValue({ data: null, error: { message: "not found" } });

    // Act
    const res = await app.request(
      "http://parse.local/parse",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inbox_item_id: 999 }),
      },
      TEST_ENV,
    );

    // Assert
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      success: false,
      error: "inbox item not found",
    });
  });

  describe("CORS (Story 11-1 review fix, Finding 1)", () => {
    it("answers an OPTIONS preflight from an allowed origin with 204 + Access-Control-Allow-Origin, WITHOUT invoking the entitlement gate — the regression test for the ordering fix", async () => {
      // Arrange
      const app = createParseApp();

      // Act — no Authorization header, exactly like a real browser
      // preflight. If CORS were ever registered AFTER
      // `requireAiEntitlement`, this request would hit the gate first, get
      // 401'd (`missing Authorization header`), and never reach `hono/cors`
      // at all — no Access-Control-Allow-Origin header, no 2xx.
      const res = await app.request(
        "http://parse.local/parse",
        {
          method: "OPTIONS",
          headers: {
            Origin: "https://www.myshadchan.space",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
          },
        },
        TEST_ENV,
      );

      // Assert
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "https://www.myshadchan.space",
      );
      expect(rpc).not.toHaveBeenCalled();
    });

    it("does NOT grant Access-Control-Allow-Origin to a disallowed origin's preflight", async () => {
      // Arrange
      const app = createParseApp();

      // Act
      const res = await app.request(
        "http://parse.local/parse",
        {
          method: "OPTIONS",
          headers: {
            Origin: "https://evil.example.com",
            "Access-Control-Request-Method": "POST",
          },
        },
        TEST_ENV,
      );

      // Assert
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("allows both Content-Type and Authorization on the preflight response", async () => {
      // Arrange
      const app = createParseApp();

      // Act
      const res = await app.request(
        "http://parse.local/parse",
        {
          method: "OPTIONS",
          headers: {
            Origin: "https://www.myshadchan.space",
            "Access-Control-Request-Method": "POST",
          },
        },
        TEST_ENV,
      );

      // Assert
      const allowHeaders =
        res.headers.get("access-control-allow-headers") ?? "";
      expect(allowHeaders.toLowerCase()).toContain("content-type");
      expect(allowHeaders.toLowerCase()).toContain("authorization");
    });

    it("still requires entitlement on a real POST from an allowed origin — proves the CORS fix did NOT open an auth hole", async () => {
      // Arrange
      const app = createParseApp();

      // Act — a real POST, allowed origin, but no Authorization header.
      const res = await app.request(
        "http://parse.local/parse",
        {
          method: "POST",
          headers: {
            Origin: "https://www.myshadchan.space",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ inbox_item_id: 1 }),
        },
        TEST_ENV,
      );

      // Assert
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        success: false,
        error: "missing Authorization header",
      });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("returns the documented 400 envelope for a syntactically malformed JSON body instead of a 500 (Finding 5)", async () => {
      // Arrange
      const app = createParseApp();
      rpc.mockResolvedValue({ data: ENTITLED_PAYLOAD, error: null });

      // Act — invalid JSON syntax, not merely a schema mismatch.
      const res = await app.request(
        "http://parse.local/parse",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: "{not valid json",
        },
        TEST_ENV,
      );

      // Assert
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        success: false,
        error: "invalid request body",
      });
    });
  });

  it("returns 422 when no resume attachment exists", async () => {
    // Arrange
    const app = createParseApp();
    rpc.mockResolvedValue({ data: ENTITLED_PAYLOAD, error: null });
    single.mockResolvedValue({
      data: {
        id: 1,
        account_id: 10,
        attachments: [
          { title: "note.txt", type: "text/plain", path: "10/note.txt" },
        ],
      },
      error: null,
    });

    // Act
    const res = await app.request(
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

    // Assert
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      success: false,
      error: "no resume attachment found",
    });
    expect(download).not.toHaveBeenCalled();
  });
});
