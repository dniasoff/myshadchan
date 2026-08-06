import { beforeEach, describe, expect, it, vi } from "vitest";
import { createParseApp } from "./index";
import { ENTITLED_PAYLOAD, TEST_ENV } from "./parseTestFixtures";

/**
 * Story 11.4 (Finding 16): registration-order regression tests for
 * `workers/parse/index.ts`'s middleware chain — CORS -> tracing ->
 * IP-scoped rate limiter -> `requireAiEntitlement` -> caller-scoped rate
 * limiter -> route. A dedicated file rather than an addition to
 * `index.test.ts`: this agent's wave ownership of `workers/parse/index.ts`
 * is scoped to middleware registration only (the route/quota logic belongs
 * to a different agent in this wave), and the manifest's explicit grant for
 * this concern is "any NEW test file specifically covering middleware
 * registration order" — never edits to `index.test.ts` itself.
 *
 * Each test below is deliberately built so that swapping the two adjacent
 * middlewares it covers flips the OBSERVABLE OUTCOME (a status code, or
 * whether a particular mock was ever called) — not just the internal call
 * order — so a future accidental reordering fails loudly here. Every one of
 * these was manually verified to actually fail when the corresponding
 * `app.use(...)` lines in `index.ts` were reordered, then restored — see the
 * task's `gatesRun` report for the exact swaps and failures observed.
 */

const rpc = vi.fn();
const select = vi.fn().mockReturnThis();
const eq = vi.fn().mockReturnThis();
const single = vi.fn();
const storageFrom = vi.fn(() => ({ download: vi.fn(), list: vi.fn() }));
const from = vi.fn(() => ({ select, eq, single }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc,
    from,
    storage: { from: storageFrom },
  }),
}));

vi.mock("./parseQuota", () => ({
  claimParseAttempt: vi.fn(),
  confirmParseAttempt: vi.fn(),
}));

vi.mock("./parseQuotaRecovery", () => ({
  releaseParseAttempt: vi.fn(),
  forceReclaimParseAttempt: vi.fn(),
}));

function buildLimiterBinding(success: boolean) {
  return { limit: vi.fn().mockResolvedValue({ success }) };
}

function envWith(overrides: Record<string, unknown>) {
  return { ...TEST_ENV, ...overrides };
}

const NOT_ENTITLED_PAYLOAD = {
  is_entitled: false,
  plan: "free",
  status: "none",
  resumes_used: 0,
  resumes_limit: 0,
};

describe("parse worker — middleware registration order (Story 11.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    select.mockReturnThis();
    eq.mockReturnThis();
  });

  it("answers an OPTIONS preflight with 204 even when the IP rate limiter is configured to refuse every request — fails if the limiter is registered before CORS", async () => {
    // Arrange — a limiter that would 429 anything it is asked to check.
    const ipLimiter = buildLimiterBinding(false);
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
      envWith({
        PARSE_IP_RATE_LIMITER: ipLimiter,
        RATE_LIMITING_ENFORCED: "true",
      }),
    );

    // Assert — `hono/cors` must have answered the preflight itself, before
    // the limiter (or the gate) ever ran.
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://www.myshadchan.space",
    );
    expect(ipLimiter.limit).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an anonymous flood at the IP rate limiter before the entitlement gate ever runs", async () => {
    // Arrange — the limiter always refuses; entitlement, if it ran, would
    // succeed. If the gate ran first, this would 401 (no Authorization
    // header) instead of 429, and `rpc` would have been called.
    const ipLimiter = buildLimiterBinding(false);
    rpc.mockResolvedValue({ data: ENTITLED_PAYLOAD, error: null });
    const app = createParseApp();

    // Act
    const res = await app.request(
      "http://parse.local/parse",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inbox_item_id: 1 }),
      },
      envWith({
        PARSE_IP_RATE_LIMITER: ipLimiter,
        RATE_LIMITING_ENFORCED: "true",
      }),
    );

    // Assert
    expect(res.status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an unentitled caller at the entitlement gate before the caller-scoped rate limiter is ever consulted", async () => {
    // Arrange — the gate refuses (not entitled); the caller-scoped limiter,
    // if reached, would ALSO refuse (over_limit). If the limiter ran first,
    // this would still be a refusal, but `userLimiter.limit` would have
    // been called and the status would be 429, not 402. The IP-scoped
    // limiter must ALLOW here — it runs first and would otherwise mask what
    // this test is actually checking.
    rpc.mockResolvedValue({ data: NOT_ENTITLED_PAYLOAD, error: null });
    const ipLimiter = buildLimiterBinding(true);
    const userLimiter = buildLimiterBinding(false);
    const app = createParseApp();

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
      envWith({
        PARSE_IP_RATE_LIMITER: ipLimiter,
        PARSE_USER_RATE_LIMITER: userLimiter,
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
    rpc.mockResolvedValue({ data: NOT_ENTITLED_PAYLOAD, error: null });
    const ipLimiter = buildLimiterBinding(false);
    const userLimiter = buildLimiterBinding(false);
    const app = createParseApp();

    // Act
    const res = await app.request(
      "http://parse.local/health",
      {},
      envWith({
        PARSE_IP_RATE_LIMITER: ipLimiter,
        PARSE_USER_RATE_LIMITER: userLimiter,
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
