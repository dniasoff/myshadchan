import { z } from "zod";

/**
 * Finding 5 (Epic 11 adversarial review, P1): the AI Workers' logging
 * promised "content-free" Cloudflare Logs, but `console.error`/`console.warn`
 * call sites across this tree logged arbitrary caught `error` objects
 * verbatim. A downstream provider error, a Postgrest error, or a `ZodError`
 * can all echo back fragments of the request/response they came from — and
 * this product's request/response bodies routinely contain medical notes,
 * names, and candid reference testimony about real people. `kaboom` (the
 * only error every existing test ever threw) cannot exercise that risk by
 * construction; see `safeLog.test.ts` and `requestTracing.test.ts`'s PII
 * suite for the tests that inject something that actually could leak.
 *
 * `summarizeErrorForLog` is the ONE chokepoint every `console.error`/`warn`
 * call site in this tree that logs a caught error is meant to route through
 * instead of the raw value — a single, unit-tested boundary is verifiable
 * with one property ("nothing on the denylist ever appears in the output"),
 * where redacting inline at N call sites needs to be independently correct
 * N times and a regression at N-1 of them would go unnoticed.
 *
 * ALLOWLIST (the only things that may appear in a `SafeErrorSummary`):
 *   - an error's constructor/class name (`Error`, `TypeError`, `ZodError`,
 *     a caller-defined class like `ExtractorProviderError`) — never its
 *     `.message` or `.stack`.
 *   - a bounded, already-known-safe HTTP status integer (e.g. a `fetch`
 *     `Response.status`).
 *   - a Postgres SQLSTATE code, and ONLY when it matches the fixed 5-char
 *     `[0-9A-Z]{5}` shape — never a Postgrest error's free-text `.message`,
 *     `.details`, or `.hint`, which is exactly where Postgres echoes
 *     offending row values on a constraint violation (e.g. "Key
 *     (email)=(x@y.com) already exists.").
 *   - a `ZodError`'s issue COUNT — never `.issues` content, which can
 *     include the actual (possibly PII-bearing) value that failed
 *     validation.
 *
 * DENYLIST (must never reach a `SafeErrorSummary`, under any category):
 *   `error.message`, `error.stack`, `.details`, `.hint`, any further
 *   Postgrest error property, `ZodError.issues`, HTTP request/response
 *   bodies, the `Authorization` header or JWT content, any resume field or
 *   dossier text, API keys.
 */

export type SafeErrorCategory =
  "network" | "timeout" | "http_status" | "database" | "validation" | "unknown";

export interface SafeErrorSummary {
  category: SafeErrorCategory;
  errorClass: string;
  httpStatus?: number;
  postgresCode?: string;
  issueCount?: number;
}

/** Postgres SQLSTATE codes are always exactly 5 alphanumeric characters. */
const POSTGRES_SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

function errorClassName(error: object): string {
  const ctorName = (error as { constructor?: { name?: unknown } }).constructor
    ?.name;
  return typeof ctorName === "string" && ctorName.length > 0
    ? ctorName
    : "UnknownError";
}

/** Duck-types a Postgrest-error-shaped value: something with a string
 * `code` property, without trusting (or reading) anything else about it. */
function isPostgrestErrorShaped(value: unknown): value is { code: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

function isTimeoutShaped(value: unknown): value is { name: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    ((value as { name?: unknown }).name === "TimeoutError" ||
      (value as { name?: unknown }).name === "AbortError")
  );
}

function isHttpStatusShaped(value: unknown): value is { status: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { status?: unknown }).status === "number"
  );
}

/**
 * Reduce an arbitrary caught `error` to a bounded, denylist-safe summary fit
 * for a log line. Never throws — a value this function itself cannot
 * classify falls back to `{ category: "unknown", errorClass: typeof error }`
 * rather than risking any part of the original value leaking through.
 */
export function summarizeErrorForLog(error: unknown): SafeErrorSummary {
  if (error instanceof z.ZodError) {
    return {
      category: "validation",
      errorClass: "ZodError",
      issueCount: error.issues.length,
    };
  }

  if (isTimeoutShaped(error)) {
    return { category: "timeout", errorClass: error.name };
  }

  if (isPostgrestErrorShaped(error)) {
    const summary: SafeErrorSummary = {
      category: "database",
      errorClass: errorClassName(error),
    };
    if (POSTGRES_SQLSTATE_PATTERN.test(error.code)) {
      summary.postgresCode = error.code;
    }
    return summary;
  }

  if (isHttpStatusShaped(error)) {
    return {
      category: "http_status",
      errorClass: errorClassName(error),
      httpStatus: error.status,
    };
  }

  if (error instanceof TypeError) {
    // The common shape of a `fetch()`-level network failure in both the
    // Workers runtime and Node's undici implementation.
    return { category: "network", errorClass: "TypeError" };
  }

  if (error instanceof Error) {
    return { category: "unknown", errorClass: errorClassName(error) };
  }

  return { category: "unknown", errorClass: typeof error };
}
