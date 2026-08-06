/**
 * Story 11.4 (Finding 16 follow-up): pure, side-effect-free helpers for
 * deriving a "caller key" from a request's forwarded `Authorization` header
 * or its `CF-Connecting-IP` header.
 *
 * Shared by `rateLimit.ts` (rate-limit bucket keys) and `requestTracing.ts`
 * (a truncated, non-reversible-in-practice prefix for correlating log
 * lines) so the two never need to import from each other for this one piece
 * of overlapping logic — see the Story 11.4 design's Q6 for the rationale.
 *
 * `deriveCallerKey` decodes the JWT `sub` claim WITHOUT verifying the
 * token's signature. That is safe here, specifically because:
 *  - it is only ever used to choose a rate-limit bucket / log-correlation
 *    label, never to authorize anything;
 *  - `requireAiEntitlement` (workers/shared/aiEntitlementGate.ts)
 *    cryptographically verifies the same `Authorization` header one
 *    middleware later (PostgREST/GoTrue), so a forged `sub` here can never
 *    grant access — it can only ever buy the caller their own separate,
 *    harmless bucket.
 */

const CALLER_KEY_ANONYMOUS = "anonymous";
const IP_KEY_UNKNOWN = "unknown";

/** Length of the log-safe prefix `truncateCallerKey` returns. */
export const CALLER_KEY_PREFIX_LENGTH = 8;

/**
 * Decode a JWT's payload segment without verifying its signature. Returns
 * `null` for anything that isn't a syntactically well-formed three-segment
 * JWT with a JSON object payload — this function is never a security
 * boundary, so it fails soft instead of throwing.
 */
function decodeJwtPayloadUnsafe(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return null;
  }
  try {
    const base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const paddingLength = (4 - (base64.length % 4)) % 4;
    const padded = base64.padEnd(base64.length + paddingLength, "=");
    const json = atob(padded);
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Derive a rate-limit / trace bucket key from the forwarded `Authorization`
 * header. Returns `user:<sub>` when a JWT `sub` claim can be decoded, or a
 * shared `anonymous` bucket otherwise (missing header, malformed token, or
 * no `sub` claim) — every unauthenticated caller shares one bucket rather
 * than each minting an unbounded number of fresh ones.
 */
export function deriveCallerKey(authHeader: string | null | undefined): string {
  if (!authHeader) {
    return CALLER_KEY_ANONYMOUS;
  }
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const payload = decodeJwtPayloadUnsafe(token);
  const sub = payload && typeof payload.sub === "string" ? payload.sub : null;
  return sub ? `user:${sub}` : CALLER_KEY_ANONYMOUS;
}

/**
 * Derive a rate-limit bucket key from the `CF-Connecting-IP` header
 * Cloudflare sets on every request. Falls back to a shared `unknown` bucket
 * when the header is absent (e.g. this repo's plain-Node "workers" vitest
 * project, or a local request with no Cloudflare edge in front of it)
 * rather than throwing.
 */
export function deriveIpKey(ipHeader: string | null | undefined): string {
  const trimmed = ipHeader?.trim();
  return trimmed && trimmed.length > 0 ? `ip:${trimmed}` : IP_KEY_UNKNOWN;
}

/**
 * Truncate a caller key to a short, non-reversible-in-practice prefix safe
 * to place in a log line. Callers must never log the full key, and never
 * the `Authorization` header or JWT it was derived from.
 */
export function truncateCallerKey(callerKey: string): string {
  return callerKey.slice(0, CALLER_KEY_PREFIX_LENGTH);
}
