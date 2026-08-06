import type { MiddlewareHandler } from "hono";
import { deriveCallerKey, truncateCallerKey } from "./callerIdentity";
import { summarizeErrorForLog } from "./safeLog";

/**
 * Story 11.4 (Finding 16): per-request tracing for the AI Workers. Emits
 * exactly one structured line per request — a request id, route, outcome
 * and duration — so a Cloudflare Logs / `wrangler tail` reader can follow
 * one request end to end and tell "cache hit" from "fresh (paid) work" from
 * "refused, and why" (design's tracingDesign).
 *
 * NEVER logs: the `Authorization` header or any JWT content beyond an
 * 8-character prefix of an already-opaque caller key (`callerIdentity.ts`),
 * the request body, any resume field, or any dossier narrative/topic text.
 * The emitted record carries only structural data — route, status, timing,
 * counts/labels — never content. See `requestTracing.test.ts`'s `"PII"`
 * describe block for what this is checked against.
 *
 * Finding 5 (Epic 11 adversarial review, P1): an earlier version of this
 * middleware logged the caught `error`/`c.error` object VERBATIM — a
 * downstream provider/database/validation error can carry request or
 * response content (a provider's rejected-input echo, a Postgrest
 * constraint violation's offending row value, a `ZodError`'s received
 * value), so logging it unredacted was the same content-free-logs
 * violation this comment already disclaimed against for the request body.
 * Both `console.error` call sites below now log `summarizeErrorForLog(...)`
 * (`../shared/safeLog.ts`) instead of the raw error — see that module's own
 * header comment for the exact allowlist/denylist boundary.
 *
 * LOG LEVEL follows this codebase's own existing precedent (grepped
 * `workers/**\/*.ts`): `console.error` marks a genuine failure — most call
 * sites in this tree are inside a `catch` block (e.g. `parseQuota.ts`,
 * `ingest/index.ts`), a few log a failure condition detected without a throw
 * (e.g. `parse/index.ts`'s `parse.release.exhausted`), but none logs routine,
 * expected traffic; `console.warn` is used for that — routine, high-volume,
 * non-failure operational logging (e.g. `cron/index.ts`'s per-tick
 * heartbeat). A per-request trace line is the same shape as that heartbeat,
 * so it uses `console.warn` — an unhandled route error uses `console.error`
 * instead, see below.
 */

/** Hono `Variables` this middleware requires and provides. A route may set
 * `traceOutcome` to a finer-grained label (e.g. `"cache_hit"`,
 * `"fresh_parse"`) before returning; if it doesn't, the trace line falls
 * back to a generic status-derived label. Deliberately a plain `string`,
 * not a closed union — different routes have very different outcome
 * vocabularies, and forcing one global enum across them would be a
 * premature abstraction. */
export interface TracingVariables {
  requestId: string;
  traceOutcome?: string;
}

const OUTCOME_OK = "ok";
const OUTCOME_REFUSED = "refused";
const OUTCOME_ERROR = "error";

/** HTTP status thresholds used only to pick a fallback outcome label when a
 * route doesn't set its own `traceOutcome`. */
const HTTP_STATUS_CLIENT_ERROR_MIN = 400;
const HTTP_STATUS_SERVER_ERROR_MIN = 500;

function defaultOutcome(status: number): string {
  if (status >= HTTP_STATUS_SERVER_ERROR_MIN) {
    return OUTCOME_ERROR;
  }
  if (status >= HTTP_STATUS_CLIENT_ERROR_MIN) {
    return OUTCOME_REFUSED;
  }
  return OUTCOME_OK;
}

/**
 * Build the per-request tracing middleware for one Worker.
 *
 * Registered on both AI Workers, each as the second `app.use("*", ...)`
 * call right after CORS: `workers/parse/registerParseMiddleware.ts`
 * (`createTracingMiddleware<ParseEnvContext>("parse")`, called from
 * `registerParseMiddleware()`, itself invoked by `createParseApp()` in
 * `workers/parse/index.ts`) and `workers/ai/index.ts`
 * (`createTracingMiddleware<AiEnvContext>("ai")`, inside `createAiApp()`).
 * Both follow the same registration order (each file's own middleware-order
 * comment repeats it in full): CORS -> tracing -> IP-scoped rate limiter ->
 * `requireAiEntitlement` -> caller-scoped rate limiter -> route. Tracing
 * sits after CORS so `hono/cors`'s own OPTIONS short-circuit never reaches
 * (and never pollutes) the trace log, and before both rate limiters and the
 * entitlement gate so every real request is traced regardless of which
 * stage refuses it.
 */
export function createTracingMiddleware<
  E extends { Variables: TracingVariables },
>(workerName: string): MiddlewareHandler<E> {
  return async (c, next) => {
    const requestId = c.req.header("CF-Ray") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    const startedAtMs = Date.now();
    const callerKeyPrefix = truncateCallerKey(
      deriveCallerKey(c.req.header("Authorization")),
    );
    const route = c.req.path;
    const method = c.req.method;

    try {
      await next();
    } catch (error) {
      // Reached only when a downstream handler throws something Hono's own
      // error handling could not absorb — `hono/compose` only intercepts
      // `instanceof Error` (verified against `node_modules/hono/dist/compose.js`),
      // so a non-Error throw propagates past it as a genuine rejection here.
      // Logged with full request context and rethrown so the app's outer
      // dispatch still produces a response for it; this middleware never
      // swallows an error.
      console.error(`${workerName}.requestError`, {
        requestId,
        worker: workerName,
        route,
        method,
        durationMs: Date.now() - startedAtMs,
        callerKeyPrefix,
        error: summarizeErrorForLog(error),
      });
      throw error;
    }

    const durationMs = Date.now() - startedAtMs;
    const status = c.res.status;
    const outcome = c.get("traceOutcome") ?? defaultOutcome(status);

    if (c.error) {
      // A downstream handler threw a real `Error`. `hono/compose` (verified
      // directly, see the comment above) catches that internally, sets
      // `c.error`, and converts it into a response via the app's own
      // `onError` BEFORE this middleware's `await next()` above ever
      // resolves — so it never reaches the `catch` block, and Hono's own
      // default `errorHandler` has already logged the bare error itself.
      // This line adds the request context that bare log lacks (request
      // id, route, duration, caller) without duplicating or suppressing it.
      console.error(`${workerName}.requestError`, {
        requestId,
        worker: workerName,
        route,
        method,
        status,
        outcome,
        durationMs,
        callerKeyPrefix,
        error: summarizeErrorForLog(c.error),
      });
      return;
    }

    console.warn(`${workerName}.request`, {
      requestId,
      worker: workerName,
      route,
      method,
      status,
      outcome,
      durationMs,
      callerKeyPrefix,
    });
  };
}
