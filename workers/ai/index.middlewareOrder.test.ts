import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAiApp } from "./index";

/**
 * Story 11.4 (Finding 16): registration-order regression tests for
 * `workers/ai/index.ts`'s middleware chain — CORS -> tracing -> IP-scoped
 * rate limiter -> `requireAiEntitlement` -> caller-scoped rate limiter ->
 * route. A dedicated file (permitted by the wave manifest's "any NEW test
 * file specifically covering middleware registration order" grant) rather
 * than folding these into `index.test.ts`, which already covers the route
 * behaviour and CORS/Finding-1 regression and would otherwise grow past the
 * ~400-line typical ceiling (coding-style.md).
 *
 * Each test is built so swapping the two adjacent middlewares it targets
 * flips the OBSERVABLE OUTCOME — a status code, or whether a mock was ever
 * called — not just the internal call order. Every one of these was
 * manually verified to fail when the corresponding `app.use(...)` lines in
 * `index.ts` were reordered, then restored — see the task's `gatesRun`
 * report for the exact swaps and failures observed.
 */

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

const notEntitledPayload = {
  is_entitled: false,
  plan: "free",
  status: "none",
  resumes_used: 0,
  resumes_limit: 0,
};

function buildLimiterBinding(success: boolean) {
  return { limit: vi.fn().mockResolvedValue({ success }) };
}

function envWith(overrides: Record<string, unknown>) {
  return { ...env, ...overrides };
}

describe("ai worker — middleware registration order (Story 11.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers an OPTIONS preflight with 204 even when the IP rate limiter is configured to refuse every request — fails if the limiter is registered before CORS", async () => {
    // Arrange
    const ipLimiter = buildLimiterBinding(false);
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
      envWith({
        AI_IP_RATE_LIMITER: ipLimiter,
        RATE_LIMITING_ENFORCED: "true",
      }),
    );

    // Assert
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://www.myshadchan.space",
    );
    expect(ipLimiter.limit).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an anonymous flood at the IP rate limiter before the entitlement gate ever runs", async () => {
    // Arrange
    const ipLimiter = buildLimiterBinding(false);
    rpc.mockResolvedValue({ data: entitledPayload, error: null });
    const app = createAiApp();

    // Act
    const res = await app.request(
      "http://ai.local/dossier",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shidduchim_id: 1 }),
      },
      envWith({
        AI_IP_RATE_LIMITER: ipLimiter,
        RATE_LIMITING_ENFORCED: "true",
      }),
    );

    // Assert
    expect(res.status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an unentitled caller at the entitlement gate before the caller-scoped rate limiter is ever consulted", async () => {
    // Arrange — the IP-scoped limiter must ALLOW here (it runs first and
    // would otherwise mask what this test is actually checking); only the
    // caller-scoped limiter is configured to refuse.
    rpc.mockResolvedValue({ data: notEntitledPayload, error: null });
    const ipLimiter = buildLimiterBinding(true);
    const userLimiter = buildLimiterBinding(false);
    const app = createAiApp();

    // Act
    const res = await app.request(
      "http://ai.local/dossier",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ shidduchim_id: 1 }),
      },
      envWith({
        AI_IP_RATE_LIMITER: ipLimiter,
        AI_USER_RATE_LIMITER: userLimiter,
        RATE_LIMITING_ENFORCED: "true",
      }),
    );

    // Assert
    expect(res.status).toBe(402);
    expect(rpc).toHaveBeenCalled();
    expect(userLimiter.limit).not.toHaveBeenCalled();
  });

  it("keeps /health ungated and unlimited even when every limiter and the entitlement gate are configured to refuse", async () => {
    // Arrange
    rpc.mockResolvedValue({ data: notEntitledPayload, error: null });
    const ipLimiter = buildLimiterBinding(false);
    const userLimiter = buildLimiterBinding(false);
    const app = createAiApp();

    // Act
    const res = await app.request(
      "http://ai.local/health",
      {},
      envWith({
        AI_IP_RATE_LIMITER: ipLimiter,
        AI_USER_RATE_LIMITER: userLimiter,
        RATE_LIMITING_ENFORCED: "true",
      }),
    );

    // Assert
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
    expect(ipLimiter.limit).not.toHaveBeenCalled();
    expect(userLimiter.limit).not.toHaveBeenCalled();
  });
});
