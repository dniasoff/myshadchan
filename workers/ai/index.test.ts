import { describe, expect, it, vi } from "vitest";
import { createAiApp } from "./index";

const rpc = vi.fn();
const select = vi.fn().mockReturnThis();
const eq = vi.fn();
const from = vi.fn(() => ({ select, eq }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc,
    from,
  }),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  AI_GATEWAY_ACCOUNT_ID: "acct",
  AI_GATEWAY_ID: "gateway",
  ANTHROPIC_API_KEY: "key",
};

const entitledPayload = {
  is_entitled: true,
  plan: "ai_tier",
  status: "active",
  resumes_used: 0,
  resumes_limit: 50,
};

describe("ai worker", () => {
  it("responds to GET /health without auth", async () => {
    // Arrange / Act
    const app = createAiApp();
    const res = await app.request("http://ai.local/health", {}, env);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { worker: "ai", status: "ok" },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 402 for an unentitled POST to any route", async () => {
    // Arrange
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
    const app = createAiApp();
    const res = await app.request(
      "http://ai.local/probe",
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
});

describe("POST /dossier", () => {
  const mockEntitlement = () => {
    rpc.mockResolvedValue({ data: entitledPayload, error: null });
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the computed dossier for reference links", async () => {
    // Arrange
    mockEntitlement();
    eq.mockResolvedValue({
      data: [
        {
          id: 1,
          shidduchim_id: 42,
          call_status: "answered",
          what_they_said: "Wonderful character, very warm.",
          conversation_log: [],
        },
        {
          id: 2,
          shidduchim_id: 42,
          call_status: "answered",
          what_they_said: "Fine, but I have a concern about temperament.",
          conversation_log: [],
        },
      ],
      error: null,
    });
    const fakeNarrator = {
      compose: vi.fn().mockResolvedValue("A composed narrative."),
    };

    // Act
    const app = createAiApp(fakeNarrator);
    const res = await app.request(
      "http://ai.local/dossier",
      {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ shidduchim_id: 42 }),
      },
      env,
    );

    // Assert
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        spokenToCount: number;
        endorsementCount: number;
        reservationCount: number;
        hasContradiction: boolean;
        covered: string[];
        narrative: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.spokenToCount).toBe(2);
    expect(body.data.endorsementCount).toBe(1);
    expect(body.data.reservationCount).toBe(1);
    expect(body.data.hasContradiction).toBe(true);
    expect(body.data.covered).toContain("Character");
    expect(body.data.narrative).toBe("A composed narrative.");
  });

  it("returns the zero-row shape when the shidduchim_id resolves to nothing", async () => {
    // Arrange
    mockEntitlement();
    eq.mockResolvedValue({ data: [], error: null });

    // Act
    const app = createAiApp();
    const res = await app.request(
      "http://ai.local/dossier",
      {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ shidduchim_id: 99 }),
      },
      env,
    );

    // Assert
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        spokenToCount: number;
        outstandingCount: number;
        endorsementCount: number;
        reservationCount: number;
        covered: string[];
        gaps: string[];
        hasContradiction: boolean;
        narrative: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.spokenToCount).toBe(0);
    expect(body.data.outstandingCount).toBe(0);
    expect(body.data.endorsementCount).toBe(0);
    expect(body.data.reservationCount).toBe(0);
    expect(body.data.covered).toEqual([]);
    expect(body.data.gaps).toEqual([]);
    expect(body.data.hasContradiction).toBe(false);
    expect(body.data.narrative).toContain("Nothing has been recorded");
  });

  it("returns 400 for a malformed body", async () => {
    // Arrange
    mockEntitlement();

    // Act
    const app = createAiApp();
    const res = await app.request(
      "http://ai.local/dossier",
      {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: JSON.stringify({ shidduchim_id: "not-a-number" }),
      },
      env,
    );

    // Assert
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "invalid request body",
    });
  });
});
