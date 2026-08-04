/**
 * Best-effort idempotency for `POST /parse` (review Finding 8, Story 11-1
 * follow-up).
 *
 * A retry after a browser timeout must not re-invoke the model and spend a
 * second paid unit for the same attachment — and, worse, a second call can
 * return a genuinely DIFFERENT draft for the same resume. The Workers
 * platform's shared edge Cache API (`caches.default`) lets a repeat request
 * for the exact same (account, inbox item, attachment) return the previously
 * computed result instead of recomputing it, with no new table required for
 * this layer.
 *
 * This is a MITIGATION, not a strict guarantee: `caches.default` is a
 * best-effort, eventually-evicted, per-colo cache with no compare-and-set —
 * two requests that race within the same instant can still both miss and
 * both call the model. Closing that race fully needs a persistent store with
 * a unique constraint (a dedicated table — see the Story 11-1 review report
 * for the exact shape), which is out of scope for this change (no schema
 * file may be created here). This layer still eliminates the common case the
 * finding describes: a client-side retry sent after the first call has
 * already completed.
 *
 * Keyed on the attachment's storage path, not a content hash — the path is
 * the durable object key `extractAndUploadAttachments.ts` writes, so it
 * already changes if the attachment is ever replaced. That is "attachment
 * version" per the finding's own wording, without needing to download the
 * file just to hash it.
 */

const IDEMPOTENCY_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h: comfortably longer than any browser-timeout retry window, short enough that a stale entry cannot linger indefinitely.
const IDEMPOTENCY_CACHE_HOST = "https://parse-idempotency.internal";

function hasCachesApi(): boolean {
  // The Workers runtime always provides `caches.default`. Plain-Node test
  // environments (this repo's "workers" vitest project — see
  // vitest.config.ts) do not, so this guard makes the whole module a no-op
  // there instead of throwing — the base /parse flow must work identically
  // whether or not the platform happens to expose this cache.
  return typeof caches !== "undefined";
}

/**
 * Build the cache key for a given (account, inbox item, attachment) triple.
 * `caches.default` is keyed by `Request`, so this is a synthetic GET request
 * against an internal, never-fetched host — only its URL is used as a key.
 */
export function buildIdempotencyCacheKey(
  accountId: string,
  inboxItemId: number,
  attachmentPath: string,
): Request {
  const url =
    `${IDEMPOTENCY_CACHE_HOST}/parse/${encodeURIComponent(accountId)}` +
    `/${inboxItemId}/${encodeURIComponent(attachmentPath)}`;
  return new Request(url, { method: "GET" });
}

/**
 * Return the previously cached result for this key, or `null` on a miss, on
 * an unavailable cache, or on any read error — a caching failure must never
 * surface as a /parse failure, so errors are logged and swallowed here.
 */
export async function readCachedParseResult<T>(
  cacheKey: Request,
): Promise<T | null> {
  if (!hasCachesApi()) {
    return null;
  }
  try {
    const hit = await caches.default.match(cacheKey);
    if (!hit) {
      return null;
    }
    return (await hit.json()) as T;
  } catch (error) {
    console.error("parse.idempotencyCache.readError", error);
    return null;
  }
}

/**
 * Store a completed result under this key. Best-effort: a write failure is
 * logged, never thrown — the caller has already computed (and metered) a
 * correct result, and that must be returned regardless of whether it could
 * also be cached for next time.
 */
export async function writeCachedParseResult(
  cacheKey: Request,
  payload: unknown,
): Promise<void> {
  if (!hasCachesApi()) {
    return;
  }
  try {
    await caches.default.put(
      cacheKey,
      new Response(JSON.stringify(payload), {
        headers: {
          "content-type": "application/json",
          "cache-control": `max-age=${IDEMPOTENCY_CACHE_TTL_SECONDS}`,
        },
      }),
    );
  } catch (error) {
    console.error("parse.idempotencyCache.writeError", error);
  }
}
