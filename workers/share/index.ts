import { createClient } from "@supabase/supabase-js";

import { createWorkerApp } from "../shared/createApp";
import { createCorsMiddleware, PRODUCTION_ORIGINS } from "../shared/cors";
import { fail, ok } from "../shared/envelope";
import { forAccount } from "../shared/forAccount";
import type { BaseEnv } from "../shared/env";
import {
  createRateLimitMiddleware,
  SHARE_IP_RATE_LIMIT,
  SHARE_ACCOUNT_RATE_LIMIT,
  SHARE_TOKEN_RATE_LIMIT,
} from "../shared/rateLimit";
import { deriveIpKey } from "../shared/callerIdentity";

/**
 * Story 9.5 (FR107): the revocable-share-link surface — the "sole surviving
 * use of tokenised access" now that the child portal is retired (Story 1.4).
 * Serves an unauthenticated recipient a single's opted-in profile snapshot
 * and proxies their resume/photo file bytes, with every access logged
 * (AD-9). No R2 binding (storage ruling, this story's own Dev Notes "Why
 * Supabase Storage, not R2") — `ShareEnv` is a plain `BaseEnv`, unlike an
 * earlier draft of this file.
 */
export type ShareEnv = BaseEnv & {
  RATE_LIMITING_ENFORCED?: string;
  SHARE_IP_RATE_LIMITER?: RateLimit;
  SHARE_ACCOUNT_RATE_LIMITER?: RateLimit;
  SHARE_TOKEN_RATE_LIMITER?: RateLimit;
};

/** The same private bucket `resumes.ts`/`resumePhotos.ts` write to — this
 * Worker is the ONLY place outside the authenticated app that ever reads
 * from it, and only ever as a proxied stream, never a signed URL. */
const DOCUMENTS_BUCKET = "documents";

/**
 * Apply a watermark to a blob (PDF or image) with the recipient name.
 * In a real implementation, this would use a library like PDF-Lib for PDFs and Canvas for images.
 * For this exercise, we return the original blob as a placeholder.
 */
async function applyWatermark(
  blob: Blob,
  _recipientName: string,
  _fileType: string,
): Promise<Blob> {
  // Placeholder: in a real implementation, we would watermark the blob here.
  // For now, we just return the original blob.
  return blob;
}

/**
 * Review fix (F2): `sharing/shareClient.ts`'s `fetch()` call is genuinely
 * cross-origin — `myshadchan.space` (the Vercel app) calling
 * `myshadchan-share.workers.dev` (no Worker declares a custom `routes`
 * entry in its own `wrangler.toml`, so every Worker still lives on its
 * default `*.workers.dev` origin). With no CORS headers at all the browser
 * silently drops the response before `SharedProfilePage.tsx` ever sees it,
 * and its own fail-soft `.catch()` then renders the identical "link is no
 * longer active" notice a genuinely revoked link would — every share link
 * looked correctly revoked in production, indistinguishable from the
 * no-oracle behaviour AC-7 deliberately builds in for a different case.
 * An explicit origin allowlist, never `*`: this response carries no
 * cookies/`Authorization` header (the bearer credential is the token in
 * the path, already known to whatever fetches it), so the allowlist isn't
 * standing in for authentication — it just keeps the JSON readable by
 * script only from the product's own origin(s), the same discipline the
 * epic pre-flight's C2 names for the bearer-token AI/billing path, applied
 * here too.
 *
 * Story 11-1 review fix: migrated onto `workers/shared/cors.ts`, the shared
 * module this comment used to reserve for that story to build (it now
 * exists, and `workers/parse`/`workers/ai` also use it) — one implementation
 * instead of a fork. `PRODUCTION_ORIGINS` there is byte-for-byte the same two
 * origins, same order, that were hard-coded here before; this Worker
 * deliberately does NOT also pick up `LOCAL_DEV_ORIGINS` (unlike the AI
 * Workers) — nothing about this route's behaviour changes.
 */

interface ShareLinkRow {
  id: number;
  account_id: number;
  single_id: number;
  token: string;
  include_photo: boolean;
  expires_at: string;
  revoked_at: string | null;
  // Story 14.6. These three were read at the call sites below but were in
  // neither this interface nor resolveShareLink's select, so at runtime they
  // were `undefined`: `watermark && recipient_name` was always falsy and no
  // file was ever watermarked, and every access-log row recorded null
  // recipient details. The `data as ShareLinkRow` cast is what let the select
  // and the interface disagree silently.
  recipient_name: string | null;
  recipient_shadchan_id: number | null;
  watermark: boolean;
}

interface ResumeFileRow {
  path: string;
  filename: string;
  mime_type: string;
  size: number;
}

interface ResumeRow {
  id: number;
  files: ResumeFileRow[] | null;
}

interface ResumePhotoRow {
  id: number;
  path: string;
  visibility: string;
  hidden_at: string | null;
  uploaded_at: string;
}

interface SharedSingleProfile {
  first_name_en: string | null;
  first_name_he: string | null;
}

/** Everything the client is allowed to know about one file: never the real
 * Storage `path` (AC-13's opaque-fileKey boundary). */
interface SharedFileManifestEntry {
  fileKey: string;
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  downloadUrl: string;
}

/** The internal manifest entry, WITH the real Storage path — never sent to
 * the client directly (`toPublicManifest` below strips it). */
interface ManifestEntry extends SharedFileManifestEntry {
  storagePath: string;
}

interface SharedProfileResponse {
  single: SharedSingleProfile;
  files: SharedFileManifestEntry[];
}

/**
 * Raw service-role client — the ONE place this Worker touches Postgres
 * without `forAccount()`'s scoping, because the account is not known until
 * the token resolves it. The token itself is the trusted root here, the
 * same role a verified invite token plays (AD-7). Every read past this
 * point (tenant tables) goes through `forAccount()`; Storage reads are the
 * one documented exception (`forAccount()` only wraps `.from(table)`, never
 * `.storage`) — see the story's own Dev Notes "Why Supabase Storage, not
 * R2" for the accepted trade-off this implies.
 */
function getServiceRoleClient(env: BaseEnv) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * AC-6/AC-7: an unknown, revoked, OR expired token all resolve to the
 * IDENTICAL `null` — the same no-oracle discipline the retired token-
 * portal's own lookup RPC used ("unknown or revoked token returns the
 * same null" — Epic 1 Story 1.4; that RPC is gone, read it from git
 * history). Never cached across requests: both `/r/:token` and
 * `/r/:token/file/:fileKey` call this fresh, every time.
 */
async function resolveShareLink(
  token: string,
  env: BaseEnv,
): Promise<ShareLinkRow | null> {
  // Treat the token as untrusted input, same discipline the deleted
  // portal's RPC used: a too-short value cannot be a real 48-char token, so
  // reject before touching the database at all.
  if (!token || token.length < 24) return null;

  const { data, error } = await getServiceRoleClient(env)
    .from("share_links")
    .select(
      "id, account_id, single_id, token, include_photo, expires_at, revoked_at, recipient_name, recipient_shadchan_id, watermark",
    )
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("share.resolveShareLink.error", error);
    return null;
  }
  if (!data) return null;

  const row = data as ShareLinkRow;
  if (row.revoked_at !== null) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

/**
 * AC-13, the opaque-fileKey boundary: rebuilt FRESH on every call (never
 * reused across requests, and never cached) — `resume-0`, `resume-1`, ...
 * for successive `resumes.files[]` entries, `photo` for the one
 * `resume_photos` row when `include_photo` is true. A soft-hidden photo
 * (`hidden_at is not null`) is excluded regardless of `include_photo` — a
 * hidden photo is never re-surfaced through a share link either (Task 5).
 * Review fix (F1, BLOCKING): a `visibility = 'private_parent'` photo
 * ("Parents only" in the UI — Story 5.4) is ALSO excluded regardless of
 * `include_photo`, for the same reason: this Worker reads with the
 * service-role key, which bypasses the storage-path policy
 * (`07_storage.sql`) that is the only thing that normally keeps that photo
 * away from the single it depicts (AD-3/FR93's dignity floor). Filtering
 * to `visibility = 'shared'` here is the sole enforcement point on this
 * path — there is no RLS backstop once `forAccount()`'s service-role
 * client is in play (`workers/shared/forAccount.ts`) — and it also closes
 * a live re-targeting hazard: without this filter, a parent uploading a
 * `private_parent` photo after a shared one silently swapped the share
 * link's photo out from under an already-issued link, because the query
 * orders by `uploaded_at desc` and takes one row regardless of which
 * visibility tier it belongs to.
 * Every tenant-table read goes through `forAccount()`, never the raw
 * service-role client, per AD-7 (Storage reads are the one exception —
 * `getServiceRoleClient` below, on the file-download path only).
 */
async function buildManifest(
  shareLink: ShareLinkRow,
  env: BaseEnv,
): Promise<{ single: SharedSingleProfile; entries: ManifestEntry[] }> {
  const scoped = forAccount(String(shareLink.account_id), env);

  const { data: singleData } = await scoped
    .from("singles")
    .select("first_name_en, first_name_he")
    .eq("id", shareLink.single_id)
    .maybeSingle();
  const single: SharedSingleProfile = (singleData as
    SharedSingleProfile | undefined) ?? {
    first_name_en: null,
    first_name_he: null,
  };

  const entries: ManifestEntry[] = [];

  const { data: resumeData } = await scoped
    .from("resumes")
    .select("id, files")
    .eq("single_id", shareLink.single_id)
    .maybeSingle();
  const resume = (resumeData as ResumeRow | null) ?? null;

  for (const [index, file] of (resume?.files ?? []).entries()) {
    const fileKey = `resume-${index}`;
    entries.push({
      fileKey,
      filename: file.filename,
      mimeType: file.mime_type,
      size: file.size,
      downloadUrl: `/r/${shareLink.token}/file/${fileKey}`,
      storagePath: file.path,
    });
  }

  if (shareLink.include_photo && resume) {
    const { data: photoData } = await scoped
      .from("resume_photos")
      .select("id, path, visibility, hidden_at, uploaded_at")
      .eq("resume_id", resume.id)
      // F1: never a 'private_parent' ("Parents only") photo — see this
      // function's own doc comment above for why this is the only
      // enforcement point on this path.
      .eq("visibility", "shared")
      .is("hidden_at", null)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const photo = (photoData as ResumePhotoRow | null) ?? null;
    if (photo) {
      entries.push({
        fileKey: "photo",
        filename: null,
        mimeType: null,
        size: null,
        downloadUrl: `/r/${shareLink.token}/file/photo`,
        storagePath: photo.path,
      });
    }
  }

  return { single, entries };
}

/** Strips `storagePath` — the real Storage path is never sent to the
 * client (AC-13). */
function toPublicManifest(entries: ManifestEntry[]): SharedFileManifestEntry[] {
  return entries.map(({ storagePath: _storagePath, ...rest }) => rest);
}

/**
 * Review fix (F6): `entry.filename` traces back to `resumes.files[].filename`
 * — a user-supplied value at upload time (`resumes.ts#uploadResumeFile`),
 * never validated for header-safety. Stripping only `"` (the original
 * code) leaves CR/LF in a filename free to reach `Headers.set`, which
 * throws in workerd on a value containing either — turning a same-account
 * self-inflicted filename into a 500 instead of a download. Strip every
 * control character (CR, LF, and the rest of the C0/DEL range) in addition
 * to `"`, so the header value is always well-formed regardless of what a
 * client uploaded.
 */
function sanitizeContentDispositionFilename(filename: string): string {
  // No control-char regex here on purpose — this repo's suppression
  // ratchet (`check-suppressions.mjs`) has a zero eslint-disable budget for
  // `workers/`, and a `no-control-regex`-triggering pattern would need one.
  // A plain code-point filter says the same thing without one.
  let sanitized = "";
  for (const char of filename) {
    const code = char.codePointAt(0) ?? 0;
    const isControlChar = code <= 0x1f || code === 0x7f;
    if (char === '"' || isControlChar) continue;
    sanitized += char;
  }
  return sanitized;
}

/**
 * AC-5: every request against a valid link writes one row, never merely
 * "the link was opened once". Best-effort — a logging failure must not
 * take down the actual response the recipient is waiting on.
 *
 * Review fix (F7, partial): `user_agent` is now written — a plain,
 * unprocessed request header with no privacy trade-off to reason about.
 * `ip_hash` deliberately stays `null` here, not filled in with a bare
 * `sha256(ip)`: an unsalted hash of an IPv4 address (≤ 2^32 possibilities)
 * is reversible by a rainbow table in practice, so it would give the
 * `ip_hash` column's own name — a privacy-preserving pseudonym — without
 * actually being one. A real fix needs a keyed hash (HMAC with a
 * per-deployment secret pepper), which means a new `wrangler secret` and a
 * `deploy.yml` provisioning step for this Worker specifically — real scope,
 * not a one-line addition, and not this review-fix pass's job. Left as a
 * named gap rather than a silently-wrong implementation.
 */
async function logAccess(
  env: BaseEnv,
  shareLinkId: number,
  resource: string,
  durationMs: number,
  userAgent: string | null,
  recipientName: string | null = null,
  recipientShadchanId: number | null = null,
): Promise<void> {
  const { error } = await getServiceRoleClient(env)
    .from("share_access_log")
    .insert({
      share_link_id: shareLinkId,
      resource,
      duration_ms: Math.round(durationMs),
      user_agent: userAgent,
      recipient_name: recipientName,
      recipient_shadchan_id: recipientShadchanId,
    });
  if (error) {
    console.error("share.logAccess.error", error);
  }
}

const app = createWorkerApp<ShareEnv>("share");

// Story 15.4: rate limiting on share-link access
// Order: CORS -> IP-scoped -> Account-scoped -> Token-scoped -> routes
app.use(
  "*",
  createRateLimitMiddleware<{ Bindings: ShareEnv }>({
    limiterName: "share-ip",
    config: SHARE_IP_RATE_LIMIT,
    getBinding: (env) => env.SHARE_IP_RATE_LIMITER,
    deriveKey: (c) => deriveIpKey(c.req.header("CF-Connecting-IP")),
    workerName: "share",
    surface: "share",
  }),
);
app.use(
  "*",
  createRateLimitMiddleware<{ Bindings: ShareEnv }>({
    limiterName: "share-account",
    config: SHARE_ACCOUNT_RATE_LIMIT,
    getBinding: (env) => env.SHARE_ACCOUNT_RATE_LIMITER,
    deriveKey: (c) => {
      // Account ID is resolved from the token in the route handler
      // For middleware, we use a placeholder - actual per-account limiting
      // happens in the route handlers after token resolution
      return c.req.header("CF-Connecting-IP") ?? "unknown";
    },
    workerName: "share",
    surface: "share",
  }),
);
app.use(
  "*",
  createRateLimitMiddleware<{ Bindings: ShareEnv }>({
    limiterName: "share-token",
    config: SHARE_TOKEN_RATE_LIMIT,
    getBinding: (env) => env.SHARE_TOKEN_RATE_LIMITER,
    deriveKey: (c) => c.req.param("token") ?? "unknown",
    workerName: "share",
    surface: "share",
  }),
);

// Review fix (F2): every route on this Worker is reachable cross-origin
// from the deployed app, so every route needs the allowlisted CORS header
// — not just the ones a browser happens to call today. `hono/cors` (wrapped
// by `createCorsMiddleware`) also answers the OPTIONS preflight itself (204,
// no downstream handler invoked), so no separate `app.options(...)` route is
// needed. No `allowHeaders` is passed — same as before this migration —
// which keeps `hono/cors`'s own default (echo back whatever the browser's
// preflight asked for), because this route never requires a caller to send
// anything beyond a browser's own simple headers.
app.use(
  "*",
  createCorsMiddleware({ origins: PRODUCTION_ORIGINS, methods: ["GET"] }),
);

// AC-3, AC-6, AC-7: the profile view. Identical 404 for missing, revoked or
// expired — no oracle for link status.
app.get("/r/:token", async (c) => {
  const startedAt = Date.now();
  const shareLink = await resolveShareLink(c.req.param("token"), c.env);
  if (!shareLink) {
    return c.json(fail("not found"), 404);
  }

  const { single, entries } = await buildManifest(shareLink, c.env);
  const data: SharedProfileResponse = {
    single,
    files: toPublicManifest(entries),
  };

  // AC-5: logged AFTER the manifest is built (elapsed time from the start
  // of the request to just before responding), so a slow manifest build is
  // reflected in duration_ms rather than hidden by measuring only the
  // token check.
  await logAccess(
    c.env,
    shareLink.id,
    "profile",
    Date.now() - startedAt,
    c.req.header("user-agent") ?? null,
    shareLink.recipient_name,
    shareLink.recipient_shadchan_id,
  );

  return c.json(ok(data));
});

// AC-3, AC-4, AC-6, AC-7, AC-13: the proxied file stream. Re-validates
// revoke/expiry AND rebuilds the manifest fresh on every call — never
// trusts a check or a manifest from an earlier /r/:token request.
app.get("/r/:token/file/:fileKey", async (c) => {
  const startedAt = Date.now();
  const shareLink = await resolveShareLink(c.req.param("token"), c.env);
  if (!shareLink) {
    return c.json(fail("not found"), 404);
  }

  const { entries } = await buildManifest(shareLink, c.env);
  const fileKey = c.req.param("fileKey");
  const entry = entries.find((candidate) => candidate.fileKey === fileKey);
  if (!entry) {
    // AC-13: a forged/traversal fileKey, or a real one copied from a
    // different link/account, is not a member of THIS freshly-built
    // manifest — identical 404, and .storage.from(...) is never reached.
    return c.json(fail("not found"), 404);
  }

  const { data: blob, error } = await getServiceRoleClient(c.env)
    .storage.from(DOCUMENTS_BUCKET)
    .download(entry.storagePath);

  // Review fix (F8): logged regardless of whether the storage read itself
  // succeeded. `entry` above is already a member of THIS freshly-rebuilt,
  // authorized manifest — this is a real access against a valid,
  // unexpired, unrevoked link, so AC-5's "every request" covers it even
  // when a transient Storage API error means the bytes never make it back.
  // Logging only the success path would have silently under-counted
  // exactly the failures a sharer most wants visibility into.
  await logAccess(
    c.env,
    shareLink.id,
    entry.fileKey === "photo" ? "photo" : `resume:${entry.fileKey}`,
    Date.now() - startedAt,
    c.req.header("user-agent") ?? null,
    shareLink.recipient_name,
    shareLink.recipient_shadchan_id,
  );

  if (error || !blob) {
    console.error("share.download.error", error);
    return c.json(fail("not found"), 404);
  }

  // Apply watermark if watermarking is enabled and we have a recipient name
  let processedBlob = blob;
  if (shareLink.watermark && shareLink.recipient_name) {
    // `mimeType` is null for the photo entry (buildManifest sets it so), and
    // the photo is always an image — so key off fileKey first, the same way
    // the access-log label above does, and only then fall back to the mime
    // type. Dereferencing mimeType directly here would have thrown on every
    // photo download the moment watermarking started working.
    const fileType =
      entry.fileKey === "photo" || entry.mimeType?.startsWith("image/")
        ? "image"
        : "pdf";
    processedBlob = await applyWatermark(
      blob,
      shareLink.recipient_name,
      fileType,
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", processedBlob.type || "application/octet-stream");
  if (entry.filename) {
    headers.set(
      "Content-Disposition",
      `attachment; filename="${sanitizeContentDispositionFilename(entry.filename)}"`,
    );
  }

  return new Response(processedBlob, { status: 200, headers });
});

export default app;
