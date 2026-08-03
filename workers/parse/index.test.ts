import { describe, expect, it, vi } from "vitest";
import { createParseApp } from "./index";
import type { RawExtraction } from "./resumeExtractor";

const rpc = vi.fn();
const select = vi.fn().mockReturnThis();
const eq = vi.fn().mockReturnThis();
const single = vi.fn();
const update = vi.fn().mockReturnThis();
const insert = vi.fn().mockReturnThis();
const storageFrom = vi.fn();
const download = vi.fn();
const from = vi.fn(() => ({ select, eq, single, update, insert }));

const aiUsageEq = vi.fn().mockReturnValue({ data: [], error: null });
const aiUsageSelect = vi.fn().mockReturnValue({
  eq: aiUsageEq,
});
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

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  AI_GATEWAY_ACCOUNT_ID: "acct",
  AI_GATEWAY_ID: "gateway",
  GOOGLE_AI_STUDIO_API_KEY: "key",
};

const entitledPayload = {
  is_entitled: true,
  plan: "ai_tier",
  status: "active",
  resumes_used: 0,
  resumes_limit: 50,
};

const makeExtract = (
  overrides: Partial<RawExtraction> = {},
): RawExtraction => ({
  name_en: { value: "Rivky", confidence: 0.95 },
  name_he: { value: "רבקה", confidence: 0.9 },
  parents_en: { value: null, confidence: 0 },
  parents_he: { value: null, confidence: 0 },
  seminary_en: { value: "Bais Yaakov", confidence: 0.85 },
  seminary_he: { value: null, confidence: 0 },
  shul_en: { value: null, confidence: 0 },
  shul_he: { value: null, confidence: 0 },
  location_en: { value: "Lakewood, NJ", confidence: 0.88 },
  location_he: { value: null, confidence: 0 },
  age: { value: 24, confidence: 0.92 },
  height: { value: "5'6\"", confidence: 0.8 },
  sections: { learningHistory: [], references: [] },
  ...overrides,
});

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
    const res = await app.request("http://parse.local/health", {}, env);

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
      env,
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
    rpc.mockResolvedValue({ data: entitledPayload, error: null });
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
    storageFrom.mockReturnValue({ download });
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
      env,
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
      data: { ...entitledPayload, resumes_used: 50, resumes_limit: 50 },
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
      env,
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
    rpc.mockResolvedValue({ data: entitledPayload, error: null });
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
      env,
    );

    // Assert
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      success: false,
      error: "inbox item not found",
    });
  });

  it("returns 422 when no resume attachment exists", async () => {
    // Arrange
    const app = createParseApp();
    rpc.mockResolvedValue({ data: entitledPayload, error: null });
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
      env,
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
