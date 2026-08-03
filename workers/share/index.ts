import { createClient } from "@supabase/supabase-js";

import { createWorkerApp } from "../shared/createApp";
import { fail, ok } from "../shared/envelope";
import { forAccount } from "../shared/forAccount";
import type { BaseEnv } from "../shared/env";

/**
 * Story 9.5 (FR107): the revocable-share-link surface — the "sole surviving
 * use of tokenised access" now that the child portal is retired (Story 1.4).
 * Serves an unauthenticated recipient a single's opted-in profile snapshot
 * and proxies their resume/photo file bytes, with every access logged
 * (AD-9). No R2 binding (storage ruling, this story's own Dev Notes "Why
 * Supabase Storage, not R2") — `ShareEnv` is a plain `BaseEnv`, unlike an
 * earlier draft of this file.
 */
export type ShareEnv = BaseEnv;

/** The same private bucket `resumes.ts`/`resumePhotos.ts` write to — this
 * Worker is the ONLY place outside the authenticated app that ever reads
 * from it, and only ever as a proxied stream, never a signed URL. */
const DOCUMENTS_BUCKET = "documents";

interface ShareLinkRow {
  id: number;
  account_id: number;
  single_id: number;
  token: string;
  include_photo: boolean;
  expires_at: string;
  revoked_at: string | null;
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
      "id, account_id, single_id, token, include_photo, expires_at, revoked_at",
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
      .select("id, path, hidden_at, uploaded_at")
      .eq("resume_id", resume.id)
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
 * AC-5: every request against a valid link writes one row, never merely
 * "the link was opened once". Best-effort — a logging failure must not
 * take down the actual response the recipient is waiting on.
 */
async function logAccess(
  env: BaseEnv,
  shareLinkId: number,
  resource: string,
  durationMs: number,
): Promise<void> {
  const { error } = await getServiceRoleClient(env)
    .from("share_access_log")
    .insert({
      share_link_id: shareLinkId,
      resource,
      duration_ms: Math.round(durationMs),
    });
  if (error) {
    console.error("share.logAccess.error", error);
  }
}

const app = createWorkerApp<ShareEnv>("share");

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
  await logAccess(c.env, shareLink.id, "profile", Date.now() - startedAt);

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

  if (error || !blob) {
    console.error("share.download.error", error);
    return c.json(fail("not found"), 404);
  }

  await logAccess(
    c.env,
    shareLink.id,
    entry.fileKey === "photo" ? "photo" : `resume:${entry.fileKey}`,
    Date.now() - startedAt,
  );

  const headers = new Headers();
  headers.set("Content-Type", blob.type || "application/octet-stream");
  if (entry.filename) {
    headers.set(
      "Content-Disposition",
      `attachment; filename="${entry.filename.replace(/"/g, "")}"`,
    );
  }

  return new Response(blob, { status: 200, headers });
});

export default app;
