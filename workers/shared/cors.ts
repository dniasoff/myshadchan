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

/**
 * F19 (Epic 12 adversarial review): a predicate over the request's `Origin`
 * header, for a Worker that needs to admit more than one fixed exact-match
 * list — e.g. this project's own verified Vercel preview-domain pattern
 * (`VERCEL_PREVIEW_ORIGIN_PATTERN` below), never a bare wildcard. Given the
 * exact origin string that sent the request; returns whether to allow it.
 */
export type OriginMatcher = (origin: string) => boolean;

export interface CorsMiddlewareOptions {
  /** Exact origins allowed to read the response, OR (F19) an `OriginMatcher`
   * predicate for a Worker that also needs to admit a verified origin
   * PATTERN rather than only a fixed list. Never `"*"` either way. */
  origins: readonly string[] | OriginMatcher;
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
  // F19: `hono/cors`'s own `origin` option accepts either shape natively —
  // a plain array (exact match, unchanged for every caller that still
  // passes one) or a function of the request's `Origin` header. The
  // function form must return the origin STRING to allow it (hono echoes
  // that value back as `Access-Control-Allow-Origin`) or `undefined` to
  // deny it — never `true`/`false`.
  const origin =
    typeof origins === "function"
      ? (requestOrigin: string) =>
          origins(requestOrigin) ? requestOrigin : undefined
      : [...origins];
  return cors({
    origin,
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

/**
 * F19 (Epic 12 adversarial review): "Preview deployments cannot exercise
 * billing." Story 12.4's own Task 1 says `VITE_BILLING_WORKER_URL` must be
 * set "in the Vercel project (production AND preview)" — but until this
 * fix, `BILLING_WORKER_ALLOWED_ORIGINS` was an exact-match list of
 * production + local-dev origins only, identical to
 * `AI_WORKER_ALLOWED_ORIGINS`. A Vercel preview build's `Origin` header is
 * neither, so the browser's own CORS preflight rejected `/checkout` and
 * `/portal` before a single request could reach this Worker — no code bug
 * to fix there, just a CORS allowlist that never admitted the origin the
 * story's own Task 1 says needs to work.
 *
 * This project's team slug is `dniasoffs-projects` (`vercel teams ls`'s own
 * `id` column) and every deployment of this exact project — production or
 * preview alike — resolves at
 * `https://myshadchan-<deployment-id>-dniasoffs-projects.vercel.app`
 * (verified directly against the live project with
 * `vercel ls --scope team_vh6r4A6auhjSNmZApI8YD20v`, 2026-08-07: 20/20
 * sampled deployment URLs matched this exact shape); a preview's stable
 * git-branch alias adds one literal segment,
 * `https://myshadchan-git-<branch-slug>-dniasoffs-projects.vercel.app`.
 * `VERCEL_PREVIEW_ORIGIN_PATTERN` below matches both, and nothing else.
 *
 * Anchored on BOTH ends (`^https://myshadchan-` … `-dniasoffs-projects
 * \.vercel\.app$`) so this can never become the "permissive suffix/substring
 * test an attacker-controlled domain could satisfy" a bare `.vercel.app` or
 * `myshadchan-` check would be: `vercel.app` is a SHARED apex domain (any
 * Vercel customer can register a project under it), so matching on it
 * alone, or on a `myshadchan-` prefix alone, would also admit an attacker's
 * OWN project. The exact team-slug SUFFIX is what closes that — Vercel team
 * slugs are globally unique, so no other team can ever produce
 * `-dniasoffs-projects.vercel.app`, no matter what they name their project.
 * The middle segment is restricted to the exact character class Vercel's
 * own deployment ids and branch slugs use (lowercase alphanumerics and
 * hyphens, bounded length) — never `.` or any other character that could
 * smuggle a second host/path segment past the two anchors (e.g.
 * `https://myshadchan-x-dniasoffs-projects.vercel.app.evil.example` fails
 * this pattern precisely because of the trailing `$`).
 */
export const VERCEL_PREVIEW_ORIGIN_PATTERN =
  /^https:\/\/myshadchan-[a-z0-9-]{1,80}-dniasoffs-projects\.vercel\.app$/;

export function isVercelPreviewOrigin(origin: string): boolean {
  return VERCEL_PREVIEW_ORIGIN_PATTERN.test(origin);
}

/**
 * Story 12.4 (AC-12): `/checkout` and `/portal` need the same production +
 * local-dev origin allowlist as `parse`/`ai` above, but named for what it
 * actually is here rather than reused under the `AI_WORKER_*` name — this
 * Worker never calls `requireAiEntitlement` (billing has to work for callers
 * who are NOT entitled yet; they're the ones trying to become entitled).
 * `/webhook` is deliberately excluded — it is server-to-server (Stripe, not
 * a browser) and gets NO CORS headers at all (AC-12's own failing
 * condition), so this middleware is registered only on the two browser
 * routes, never with `app.use("*", …)`.
 *
 * F19: an `OriginMatcher` now, not a plain array — the exact-match part is
 * byte-for-byte `AI_WORKER_ALLOWED_ORIGINS` (production + local-dev), with
 * `isVercelPreviewOrigin` admitting this project's own preview builds on
 * top. `workers/billing/index.ts` needs no change for this: it already
 * forwards this constant, unread, straight into `createCorsMiddleware`'s
 * `origins:` field, which accepts either shape.
 */
export const BILLING_WORKER_ALLOWED_ORIGINS: OriginMatcher = (origin) =>
  (AI_WORKER_ALLOWED_ORIGINS as readonly string[]).includes(origin) ||
  isVercelPreviewOrigin(origin);

export const BILLING_WORKER_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
] as const;
