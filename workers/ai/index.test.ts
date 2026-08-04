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

    // Act
    const app = createAiApp();
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
        hasMixedSentiment: boolean;
        covered: string[];
        narrative: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.spokenToCount).toBe(2);
    expect(body.data.endorsementCount).toBe(1);
    expect(body.data.reservationCount).toBe(1);
    expect(body.data.hasMixedSentiment).toBe(true);
    expect(body.data.covered).toContain("Character");
    // Review fix (Finding 12): no model call, no injected fake — the
    // narrative is the real deterministic sentence built from these facts.
    expect(body.data.narrative).toContain("2 references were spoken to");
    expect(body.data.narrative).toContain("1 spoke warmly");
    expect(body.data.narrative).toContain("1 raised a reservation");
  });

  it("returns every topic as a gap — never an empty gap list — when the shidduchim_id resolves to nothing (Finding 4)", async () => {
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
        hasMixedSentiment: boolean;
        narrative: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.spokenToCount).toBe(0);
    expect(body.data.outstandingCount).toBe(0);
    expect(body.data.endorsementCount).toBe(0);
    expect(body.data.reservationCount).toBe(0);
    expect(body.data.covered).toEqual([]);
    // This is the regression test for Finding 4: the response used to
    // hard-code `gaps: []` for the zero-row case, which the card rendered as
    // "Every topic has been touched on" — the opposite of the truth. Every
    // COVERAGE_TOPICS entry must be reported missing when nothing has been
    // recorded, exactly as the non-empty-corpus path already does.
    expect(body.data.gaps).toEqual([
      "Character",
      "Family",
      "Learning or work",
      "Health",
      "Observance",
      "Friends and social",
    ]);
    expect(body.data.hasMixedSentiment).toBe(false);
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

  it("returns 400 for a syntactically malformed JSON body instead of a 500 (Finding 5)", async () => {
    // Arrange
    mockEntitlement();

    // Act — invalid JSON syntax, not merely a schema mismatch (that's the
    // test above).
    const app = createAiApp();
    const res = await app.request(
      "http://ai.local/dossier",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: "{not valid json",
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

describe("CORS (Story 11-1 review fix, Finding 1)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("answers an OPTIONS preflight from an allowed origin with 204 + Access-Control-Allow-Origin, WITHOUT invoking the entitlement gate — the regression test for the ordering fix", async () => {
    // Arrange
    const app = createAiApp();

    // Act — no Authorization header, exactly like a real browser preflight.
    // If CORS were ever registered AFTER `requireAiEntitlement`, this
    // request would hit the gate first, get 401'd (`missing Authorization
    // header`), and never reach `hono/cors` at all — no
    // Access-Control-Allow-Origin header, no 2xx.
    const res = await app.request(
      "http://ai.local/dossier",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://www.myshadchan.space",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,content-type",
        },
      },
      env,
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
    const app = createAiApp();

    // Act
    const res = await app.request(
      "http://ai.local/dossier",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example.com",
          "Access-Control-Request-Method": "POST",
        },
      },
      env,
    );

    // Assert
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows both Content-Type and Authorization on the preflight response", async () => {
    // Arrange
    const app = createAiApp();

    // Act
    const res = await app.request(
      "http://ai.local/dossier",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://www.myshadchan.space",
          "Access-Control-Request-Method": "POST",
        },
      },
      env,
    );

    // Assert
    const allowHeaders = res.headers.get("access-control-allow-headers") ?? "";
    expect(allowHeaders.toLowerCase()).toContain("content-type");
    expect(allowHeaders.toLowerCase()).toContain("authorization");
  });

  it("still requires entitlement on a real POST from an allowed origin — proves the CORS fix did NOT open an auth hole", async () => {
    // Arrange
    const app = createAiApp();

    // Act — a real POST, allowed origin, but no Authorization header.
    const res = await app.request(
      "http://ai.local/dossier",
      {
        method: "POST",
        headers: {
          Origin: "https://www.myshadchan.space",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ shidduchim_id: 1 }),
      },
      env,
    );

    // Assert
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "missing Authorization header",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
