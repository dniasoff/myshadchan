import type { Context, MiddlewareHandler } from "hono";
import { fail } from "./envelope";
import { summarizeErrorForLog } from "./safeLog";

/**
 * Story 11.4 (Finding 16): abuse-prevention rate limiting for `/parse` and
 * `/dossier`, built on Cloudflare's native `[[ratelimits]]` binding — see
 * the approved design's Q1 for why this over a Durable Object, a
 * Postgres-backed counter, or the Workers Cache API. This is a fast, cheap,
 * per-colo-approximate SPEED BUMP against abuse; it does NOT replace the
 * atomic, durable monthly quota reservation on `ai_usage` (Findings 6/7,
 * owned by a different agent in this wave) — that is the actual cap.
 *
 * The binding's runtime surface (`@cloudflare/workers-types`, globally
 * ambient under `tsconfig.workers.json`) is exactly
 * `{ limit(options: { key: string }): Promise<{ success: boolean }> }` — a
 * type-only dependency, so this module has zero runtime dependency on the
 * Workers runtime and is fully testable under this repo's plain-Node
 * "workers" vitest project by injecting a fake binding.
 *
 * FAIL-CLOSED VS. UNCONFIGURED (design Q3 — the crux of this module):
 * a missing binding is ambiguous on its own — it means "this environment
 * never configures rate limiting" (local dev, the vitest "workers" project)
 * exactly as often as it could mean "a `[[ratelimits]]` block was dropped
 * from wrangler.toml by mistake in a real deploy." Those two must not
 * resolve to the same outcome, so a second, independently-sourced signal —
 * the `RATE_LIMITING_ENFORCED` marker — decides which one applies. A
 * binding that IS present but throws is NEVER treated as "unconfigured":
 * that is a live fault, and it always fails closed regardless of
 * `enforced`. See `checkRateLimit` below for the exact decision table.
 *
 * External review Finding 3 (2026-08-06): this marker used to be a Worker
 * *secret*, pushed by a separate `wrangler secret put` step in
 * .github/workflows/deploy.yml, and `isRateLimitingEnforced` treated any
 * value other than the exact literal `"true"` — including absent,
 * differently cased, or misspelled — as "not enforced", i.e. fail OPEN. A
 * manual production deploy that forgot that one extra CLI command (or
 * mistyped the value it pushed) got unlimited rate limiting with no
 * indication anything was wrong.
 *
 * The fix is structural, not a stricter string comparison: `deploy.yml` (and
 * both `workers/parse/wrangler.toml` / `workers/ai/wrangler.toml`) now
 * declare `RATE_LIMITING_ENFORCED = "true"` as a plain `[vars]` entry
 * *inside* wrangler.toml itself, rather than pushing it as a secret from a
 * separate CI step. A `[vars]` entry is part of the Worker's own committed
 * configuration — it ships with `wrangler deploy` / `wrangler versions
 * upload` automatically, on literally any invocation of either command
 * against this repo's code, CI-driven or run by hand from a laptop. There is
 * no longer a separate step whose absence can leave it unset in a real
 * deploy. The only place this marker is legitimately absent is a plain-Node
 * test harness that never goes through wrangler at all (this repo's
 * "workers" vitest project constructs `env` objects by hand).
 *
 * That leaves exactly one more failure mode to close: a value that is
 * PRESENT but neither the recognized `"true"` nor absent — a stray edit, a
 * copy-paste mistake, a differently-cased value written by hand. The old
 * code folded that case into "not enforced" (fail open) because it only
 * ever compared against the one string it expected. `resolveRateLimitState`
 * below makes this a real third outcome — "malformed" — and
 * `isRateLimitingEnforced` treats it the same as `"true"`: fail CLOSED. A
 * value nobody can explain is exactly the situation this flag exists to
 * protect against, so it must never resolve the same way as "this
 * environment intentionally never configures rate limiting" — that would
 * just be the original bug wearing a new set of accepted spellings.
 *
 * External review Finding 5 residual (2026-08-06): `checkRateLimit`'s
 * `catch` block used to log the caught `error` object VERBATIM
 * (`console.error("rateLimit.limiterError", error)`). `checkRateLimit` runs
 * on every `/parse` and `/dossier` request via `createRateLimitMiddleware`
 * (`app.use("*", ...)` in both `workers/parse/registerParseMiddleware.ts`
 * and `workers/ai/index.ts`), so any throw from the Cloudflare RateLimit
 * binding — or, more importantly, from whatever `.limit()` wraps in a given
 * runtime — logged unredacted. This is the same content-free-logs violation
 * `requestTracing.ts` documents (its own Finding 5) and fixed with
 * `summarizeErrorForLog` (`./safeLog.ts`); this module now routes its one
 * caught-error log site through the same chokepoint, alongside the
 * already-redacted `limiterName` label (an operational identifier like
 * `"parse-ip"`, never derived from request content).
 */

/** Cloudflare's `simple` rate-limit config shape restricts `period` to
 * exactly these two values (seconds) — see
 * `node_modules/wrangler/config-schema.json`'s `ratelimits[].simple.period`
 * enum. Kept here as a literal union so a typo can never silently produce a
 * binding Cloudflare would reject at deploy time. */
export type RateLimitPeriodSeconds = 10 | 60;

export interface RateLimitConfig {
  readonly limit: number;
  readonly periodSeconds: RateLimitPeriodSeconds;
}

/**
 * Pre-auth, IP-scoped backstop shared by both `/parse` and `/dossier`.
 * Registered before `requireAiEntitlement` — its job is to stop scripted
 * hammering before any Supabase RPC call is spent, not to enforce the real
 * quota. 20 requests / 10s comfortably absorbs a household sharing one NAT
 * while bounding a scripted burst tightly (design Q1/limiterDesign).
 */
export const AI_WORKER_IP_RATE_LIMIT: RateLimitConfig = {
  limit: 20,
  periodSeconds: 10,
};

/**
 * Post-auth, caller-scoped backstop for `/parse`. A household parsing a
 * handful of resumes a day — even an enthusiastic backlog-clearing session —
 * stays well under 10/60s; this exists to stop the 100/month cap being
 * burned through in seconds, not to be the primary quota enforcement
 * (design Q1/limiterDesign).
 */
export const PARSE_USER_RATE_LIMIT: RateLimitConfig = {
  limit: 10,
  periodSeconds: 60,
};

/**
 * Post-auth, caller-scoped backstop for `/dossier`. More generous than
 * parse's because `/dossier` is read-only, makes no model call, and is
 * cacheable — flipping between several shidduchim's dossiers in one review
 * session is normal, deliberate use (design Q1/limiterDesign).
 */
export const DOSSIER_USER_RATE_LIMIT: RateLimitConfig = {
  limit: 30,
  periodSeconds: 60,
};

export type RateLimitRefusalReason = "over_limit" | "limiter_error";

export type RateLimitCheckResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: RateLimitRefusalReason };

export interface CheckRateLimitOptions {
  /** The Worker's Cloudflare rate-limit binding, or `undefined` when this
   * environment does not provide one (local dev, tests, or a dropped
   * wrangler.toml block). */
  binding: RateLimit | undefined;
  /** This request's bucket key — an IP key or a caller key, see
   * `callerIdentity.ts`. */
  key: string;
  /** Whether THIS environment declares that rate limiting must be enforced
   * — see `isRateLimitingEnforced`. Only consulted when `binding` is
   * `undefined`; a present-but-throwing binding always fails closed. */
  enforced: boolean;
  /** Short label identifying which limiter this is (e.g. `"parse-ip"`,
   * `"ai-user"`) — logged alongside a `limiter_error` refusal so a
   * Cloudflare Logs reader can tell which of a Worker's two limiters
   * (IP-scoped vs. caller-scoped) failed, without the log line carrying
   * anything derived from request content. Optional because callers that
   * only care about the allow/refuse decision (not the log line) need not
   * supply it; `createRateLimitMiddleware` always does. */
  limiterName?: string;
}

/**
 * Decide whether a request may proceed, per the decision table in this
 * module's header comment:
 *
 * | binding   | enforced | outcome                        |
 * |-----------|----------|---------------------------------|
 * | undefined | false    | allowed (not configured here)   |
 * | undefined | true     | refused, limiter_error (misconfigured deploy) |
 * | present, resolves success=true  | (any) | allowed |
 * | present, resolves success=false | (any) | refused, over_limit |
 * | present, throws                 | (any) | refused, limiter_error (ALWAYS) |
 */
export async function checkRateLimit(
  options: CheckRateLimitOptions,
): Promise<RateLimitCheckResult> {
  const { binding, key, enforced, limiterName } = options;

  if (!binding) {
    return enforced
      ? { allowed: false, reason: "limiter_error" }
      : { allowed: true };
  }

  try {
    const outcome = await binding.limit({ key });
    return outcome.success
      ? { allowed: true }
      : { allowed: false, reason: "over_limit" };
  } catch (error) {
    // External review Finding 5 residual: this used to log the caught
    // `error` verbatim — see this module's header comment. `limiterName` is
    // an operational label the caller chose (never derived from the
    // request), so it is safe alongside the redacted summary and is what
    // lets an operator tell the IP-scoped limiter failing from the
    // caller-scoped one.
    console.error("rateLimit.limiterError", {
      limiterName,
      error: summarizeErrorForLog(error),
    });
    return { allowed: false, reason: "limiter_error" };
  }
}

/** The three ways `RATE_LIMITING_ENFORCED` can resolve — see this module's
 * header comment (External review Finding 3) for why "malformed" must be its
 * own outcome rather than folding into "not configured". */
export type RateLimitEnforcementState =
  "enforced" | "not_configured" | "malformed";

const ENFORCED_LITERAL = "true";

/**
 * Classifies the raw `RATE_LIMITING_ENFORCED` value:
 *   - `undefined` (never set — the only legitimate case, a plain-Node test
 *     harness that never goes through wrangler) -> "not_configured".
 *   - the exact literal `"true"` (the value `[vars]` in both workers'
 *     wrangler.toml declares) -> "enforced".
 *   - anything else — `"false"`, a typo, different casing, an empty string
 *     — -> "malformed". There is no code path in this repo that
 *     legitimately produces any of these; a value nobody can explain is
 *     configuration drift, not an intentional "off" switch.
 */
export function resolveRateLimitState(
  value: string | undefined,
): RateLimitEnforcementState {
  if (value === undefined) return "not_configured";
  if (value === ENFORCED_LITERAL) return "enforced";
  return "malformed";
}

/**
 * `true` whenever this environment's configuration must be treated as
 * requiring enforcement — i.e. whenever the marker is anything OTHER than a
 * clean, deliberate absence. Both "enforced" and "malformed" map to `true`:
 * a value that doesn't parse must fail CLOSED (refused, once combined with
 * an absent binding — see `checkRateLimit`), never fail open the way the
 * pre-fix code did for every misspelling of `"true"`. A "malformed" reading
 * is logged so it is visible in Cloudflare Logs rather than silently
 * swallowed into either bucket.
 */
export function isRateLimitingEnforced(value: string | undefined): boolean {
  const state = resolveRateLimitState(value);
  if (state === "malformed") {
    console.error("rateLimit.enforcementMarkerMalformed", { value });
  }
  return state !== "not_configured";
}

/** Every Worker env this middleware can be mounted on must carry the
 * enforcement flag; the specific binding is supplied per-limiter via
 * `getBinding` below, since a Worker can hold more than one binding
 * (IP-scoped and caller-scoped) with different names. */
export interface RateLimitEnforcementEnv {
  RATE_LIMITING_ENFORCED?: string;
}

export interface CreateRateLimitMiddlewareOptions<
  E extends { Bindings: RateLimitEnforcementEnv },
> {
  /** Short label identifying which limiter refused a request — echoed into
   * the failure envelope's `meta` and never into any log by itself (not
   * PII, just an operational label). */
  limiterName: string;
  config: RateLimitConfig;
  /** Reads this limiter's own Cloudflare binding off the Worker's env.
   * Returns `undefined` when this environment does not provide it. */
  getBinding: (env: E["Bindings"]) => RateLimit | undefined;
  /** Derives this request's bucket key — e.g. `deriveIpKey` or
   * `deriveCallerKey` from `callerIdentity.ts`, applied to the relevant
   * header. */
  deriveKey: (c: Context<E>) => string;
}

/**
 * Build one Hono middleware for one rate-limit dimension (IP or caller) on
 * one Worker. `/health` is always bypassed, matching
 * `requireAiEntitlement`'s own precedent. A refusal returns `429` with a
 * `Retry-After` header for `over_limit`, or `503` for `limiter_error` (the
 * limiter itself is unavailable — not the caller's fault).
 *
 * Registered on both `workers/parse/index.ts` and `workers/ai/index.ts`, in
 * the order their own middleware-order comments describe: CORS -> tracing ->
 * IP-scoped limiter -> `requireAiEntitlement` -> caller-scoped limiter ->
 * route.
 */
export function createRateLimitMiddleware<
  E extends { Bindings: RateLimitEnforcementEnv },
>(options: CreateRateLimitMiddlewareOptions<E>): MiddlewareHandler<E> {
  const { limiterName, config, getBinding, deriveKey } = options;

  return async (c, next) => {
    if (c.req.path === "/health") {
      return next();
    }

    const binding = getBinding(c.env);
    const enforced = isRateLimitingEnforced(c.env.RATE_LIMITING_ENFORCED);
    const key = deriveKey(c);
    const result = await checkRateLimit({
      binding,
      key,
      enforced,
      limiterName,
    });

    if (result.allowed) {
      return next();
    }

    if (result.reason === "over_limit") {
      c.header("Retry-After", String(config.periodSeconds));
      return c.json(fail("rate limit exceeded", { limiter: limiterName }), 429);
    }

    return c.json(
      fail("rate limiter unavailable", { limiter: limiterName }),
      503,
    );
  };
}
