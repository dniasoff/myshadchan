import { requireAiEntitlement } from "../shared/aiEntitlementGate";
import {
  AI_WORKER_ALLOWED_HEADERS,
  AI_WORKER_ALLOWED_ORIGINS,
  createCorsMiddleware,
} from "../shared/cors";
import { deriveCallerKey, deriveIpKey } from "../shared/callerIdentity";
import {
  AI_WORKER_IP_RATE_LIMIT,
  PARSE_USER_RATE_LIMIT,
  createRateLimitMiddleware,
} from "../shared/rateLimit";
import { createTracingMiddleware } from "../shared/requestTracing";
import type { ParseApp, ParseEnvContext } from "./parseAppTypes";

/**
 * Registers CORS, tracing, both rate limiters, and the entitlement gate on
 * `app`, in the exact order Findings 1/16 require. Split out of `index.ts`
 * once it, plus the route handler, pushed that file well past the
 * ~400-line typical ceiling (coding-style.md). `index.middlewareOrder.test.ts`
 * exercises this ordering by observable behavior (status codes, which mocks
 * got called) against `createParseApp()`, not against this file's own
 * structure, so the split changes nothing it covers.
 */
export function registerParseMiddleware(app: ParseApp): void {
  // E5/E11 (resume auto-parse) land here — AD-6, AD-8, AD-12. Every non-health
  // route is gated by `requireAiEntitlement` (Story 11.1).
  //
  // Review fix (Finding 1, P1): CORS MUST be registered before the
  // entitlement gate. `callAiWorker()` sends `Authorization` +
  // `Content-Type: application/json`, so every real call preflights with an
  // `OPTIONS` request first — one that never carries `Authorization`. With
  // the gate registered first it 401'd every preflight, with no
  // Access-Control-Allow-Origin header, so the browser blocked the response
  // and never sent the real POST: this endpoint was unreachable from any
  // browser. `hono/cors` answers `OPTIONS` itself (204, short-circuits
  // before `next()`), so registering it first means the gate never even
  // sees a preflight — only real requests reach it.
  app.use(
    "*",
    createCorsMiddleware({
      origins: AI_WORKER_ALLOWED_ORIGINS,
      methods: ["POST"],
      allowHeaders: [...AI_WORKER_ALLOWED_HEADERS],
    }),
  );

  // Story 11.4 (Finding 16): tracing, then the pre-auth IP-scoped rate
  // limiter, THEN the entitlement gate, THEN the post-auth caller-scoped
  // rate limiter.
  //
  //   - Tracing is registered right after CORS (never before it), so
  //     `hono/cors`'s own OPTIONS short-circuit — which never calls
  //     `next()` — means a preflight is never traced, rate-limited, or
  //     gated; only a real request reaches any of the three.
  //   - The IP-scoped limiter runs BEFORE `requireAiEntitlement` on purpose:
  //     it is a pre-auth backstop against unauthenticated flooding, so a
  //     scripted burst is refused with a cheap `binding.limit()` call before
  //     this route ever spends a Supabase RPC re-verifying entitlement
  //     (design Q1/limiterDesign — "stop pre-auth/scripted hammering ...
  //     before any auth work happens").
  //   - The caller-scoped limiter runs AFTER the gate on purpose: its bucket
  //     key is the JWT `sub` (`deriveCallerKey`), which the gate is the
  //     first thing in this chain to authenticate — putting it before the
  //     gate would rate-limit by an unverified claim with no entitlement
  //     check behind it yet, and would lump every unauthenticated request
  //     into one shared "anonymous" bucket instead of a per-caller one.
  //   - `/health` is bypassed by both `createRateLimitMiddleware` and
  //     `requireAiEntitlement` internally (see their own files) — this
  //     ordering only decides what happens to routes that are NOT `/health`.
  app.use("*", createTracingMiddleware<ParseEnvContext>("parse"));
  app.use(
    "*",
    createRateLimitMiddleware<ParseEnvContext>({
      limiterName: "parse-ip",
      config: AI_WORKER_IP_RATE_LIMIT,
      getBinding: (env) => env.PARSE_IP_RATE_LIMITER,
      deriveKey: (c) => deriveIpKey(c.req.header("CF-Connecting-IP")),
      workerName: "parse",
      surface: "parse",
    }),
  );
  app.use("*", requireAiEntitlement);
  app.use(
    "*",
    createRateLimitMiddleware<ParseEnvContext>({
      limiterName: "parse-user",
      config: PARSE_USER_RATE_LIMIT,
      getBinding: (env) => env.PARSE_USER_RATE_LIMITER,
      deriveKey: (c) => deriveCallerKey(c.req.header("Authorization")),
      workerName: "parse",
      surface: "parse",
    }),
  );
}
