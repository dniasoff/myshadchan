import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";

/**
 * Story 11-1 review fix (Finding 1, P1): the shared CORS module the Story
 * 9.5 review fix (F2, `workers/share/index.ts`) explicitly reserved for this
 * story to build. Built directly on `hono/cors` rather than inventing a new
 * mechanism — see `workers/share/index.ts`'s own F2 comment for the prior
 * art this mirrors (an explicit origin allowlist, never a wildcard, because
 * these responses are read by script from the product's own origin(s) only).
 *
 * NEVER default `origins` to `"*"`. `workers/parse` and `workers/ai` carry an
 * `Authorization` header on every real request — a wildcard origin on a
 * credentialed, paid inference endpoint would let any third-party page read
 * the response merely by getting a signed-in user to load it, which is a
 * real vulnerability, not a theoretical one.
 */
export interface CorsMiddlewareOptions {
  /** Exact origins allowed to read the response. Never `"*"`. */
  origins: readonly string[];
  /** HTTP methods this route set actually serves (OPTIONS is handled by
   * `hono/cors` itself and must not be listed here). */
  methods: readonly string[];
  /**
   * Headers a preflight may declare the real request will send. Omit to fall
   * back to `hono/cors`'s own default (echo back whatever the browser's
   * `Access-Control-Request-Headers` asked for) — this is what preserves
   * `workers/share`'s pre-existing behaviour exactly, since share's routes
   * never require a caller to send anything beyond the browser's own simple
   * headers.
   */
  allowHeaders?: readonly string[];
}

/**
 * Build the CORS middleware for one Worker's route set. Register with
 * `app.use("*", createCorsMiddleware(...))` **before** any auth/entitlement
 * middleware — `hono/cors` answers an `OPTIONS` preflight itself (204, no
 * downstream handler invoked), so a gate registered after it never even sees
 * the preflight. A gate registered *before* it would 401/402 the preflight
 * instead (no `Authorization` header ever rides on an OPTIONS request),
 * which is exactly Finding 1: the browser then refuses to send the real
 * request at all, because the preflight itself failed.
 */
export function createCorsMiddleware(
  options: CorsMiddlewareOptions,
): MiddlewareHandler {
  const { origins, methods, allowHeaders } = options;
  return cors({
    origin: [...origins],
    allowMethods: [...methods],
    ...(allowHeaders ? { allowHeaders: [...allowHeaders] } : {}),
  });
}

/**
 * The deployed app's own origin(s) — `www.myshadchan.space` is the live
 * domain, and the bare apex is kept alongside it for the same reason
 * `workers/share/index.ts`'s original `SHARE_ALLOWED_ORIGINS` did (unknown
 * whether anything redirects apex -> www at the edge vs. serving both).
 */
export const PRODUCTION_ORIGINS = [
  "https://www.myshadchan.space",
  "https://myshadchan.space",
] as const;

/**
 * Local origins a developer's own browser actually runs the SPA from,
 * derived from the two env files that pin these Workers' URLs rather than
 * guessed:
 *  - `.env.development` points `VITE_PARSE_WORKER_URL` /
 *    `VITE_AI_WORKER_URL` at `localhost:8788` / `:8789` (this Worker's own
 *    `wrangler.toml` `[dev] port`) for `make start`'s dev stack, whose Vite
 *    server is `supabase/config.toml`'s own `site_url` -
 *    `http://localhost:5173` (also `vite.config.ts`'s hard-coded
 *    `server.port`).
 *  - `.env.e2e` points the same two vars at the same ports for the e2e
 *    stack; stack 0's Vite server is `supabase/config.e2e.toml`'s `site_url`
 *    - `http://localhost:5175` (`scripts/stack-env.mjs`'s `APP_PORT_BASE`).
 *    No e2e suite exercises `/parse` or `/dossier` today (there is no
 *    `workers/parse` or `workers/ai` reference under `e2e/`), so only
 *    stack 0's origin is listed — extend this if/when a non-zero-`STACK_ID`
 *    suite starts calling either Worker from a browser.
 */
export const LOCAL_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5175",
] as const;

/**
 * `workers/parse` and `workers/ai` both need production + local-dev origins,
 * `POST`, and the two headers `callAiWorker()` always sends
 * (`src/components/atomic-crm/providers/commons/aiWorkerClient.ts`) —
 * `Content-Type: application/json` and `Authorization`. One constant so
 * both Workers stay identical rather than drifting apart.
 */
export const AI_WORKER_ALLOWED_ORIGINS = [
  ...PRODUCTION_ORIGINS,
  ...LOCAL_DEV_ORIGINS,
] as const;

export const AI_WORKER_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
] as const;
