import type { Identifier } from "ra-core";

import {
  isSingleSubject,
  type ResumeSubject,
} from "../../resumes/resumeSubject";
import {
  buildResumeInboxStoragePath,
  isEligibleResumeAttachment,
  type ResumeInboxAttachment,
} from "../../resumes/resumeInbox";
import type { InboxAttachment, Resume } from "../../types";
import { ATTACHMENTS_BUCKET } from "../commons/attachments";
import { getSupabaseClient } from "./supabase";

/**
 * A third private bucket, separate from `ATTACHMENTS_BUCKET` and
 * `entity-files` (Story 5.3, contract re-ratified in the story's own "Why a
 * new `documents` bucket" section): a resume needs a `{account}/resumes/…`
 * key grammar `uploadToBucket()`'s two-segment shape cannot express, and
 * Story 5.4's photo visibility rules need a bucket whose every policy is
 * written from scratch — a permissive account-wide SELECT policy on either
 * existing bucket can only ever ADD access, never narrow it back down.
 */
const DOCUMENTS_BUCKET = "documents";

/**
 * Minted per click, never persisted (AC 5) — same order of magnitude as
 * `entityFiles.ts`'s `ENTITY_FILE_URL_TTL_SECONDS`, NOT
 * `ATTACHMENT_URL_TTL_SECONDS` (`dataProvider.ts`, one hour): that one is
 * written onto a record and re-read later, this one is consumed
 * immediately after `signResumeFileUrl` returns it.
 */
export const RESUME_FILE_URL_TTL_SECONDS = 60;

/** The viewing counterpart — see `entityFiles.ts`'s
 * `ENTITY_FILE_VIEW_TTL_SECONDS` for why an embedded viewer needs a longer
 * window than a modal. This is the constant the embedded resume uses. */
export const RESUME_FILE_VIEW_TTL_SECONDS = 3600;

/**
 * The caller's ACTIVE account id, resolved the same way `dataProvider.ts`'s
 * `getCurrentAccountId` and `entityFiles.ts`'s own copy do
 * (`current_context_id` RPC, never client state) — duplicated rather than
 * imported to avoid a circular import between this module and
 * `dataProvider.ts` (which imports this module to wire the two methods
 * below into the custom-methods overlay), exactly like `entityFiles.ts`.
 */
async function getCurrentAccountId(): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc("current_context_id");
  if (error || data == null) {
    throw new Error("Cannot resolve the account for this resume upload");
  }
  return data as number;
}

export type UploadResumeFileParams = ResumeSubject & {
  file: File;
};

export type SignResumeFileUrlParams = {
  storagePath: string;
  fileName: string;
  /** Serve for viewing in the page rather than saving to disk — mirrors
   * `entityFiles.ts`'s `SignEntityFileUrlParams.inline`. */
  inline?: boolean;
};

export type RemoveResumeFileParams = {
  resumeId: Identifier;
  path: string;
  size: number;
  uploadedAt: string;
  deleteToken: string;
};

export type ResumeFileDeleteResult = {
  purgePending: boolean;
};

/**
 * AC 1/2/4/5: uploads the file under the AC-4 key grammar, then calls
 * `add_resume_file()` — the server-side append that keeps two concurrent
 * uploads from racing (see that function's own comment). Mirrors
 * `uploadEntityFile`'s "no object without a row" ordering: if the RPC
 * rejects, the just-uploaded object is removed before rethrowing.
 *
 * Story 5.8 widens the subject to a single alongside a shidduch: a single's
 * segment is `single-{id}` — distinct from a shidduch's bare `{id}` — so the
 * two id spaces can never collide in a storage path; storage RLS itself
 * only ever inspects segments [1] (account) and [2] (`resumes`), so this is
 * a naming choice, not a policy requirement.
 */
export async function uploadResumeFile(
  params: UploadResumeFileParams,
): Promise<Resume> {
  const { file, ...subject } = params;
  const accountId = await getCurrentAccountId();
  const ownerSegment = isSingleSubject(subject)
    ? `single-${subject.singleId}`
    : `${subject.shidduchimId}`;
  const storagePath = `${accountId}/resumes/${ownerSegment}/${crypto.randomUUID()}-${file.name}`;

  const { error: uploadError } = await getSupabaseClient()
    .storage.from(DOCUMENTS_BUCKET)
    .upload(storagePath, file);
  if (uploadError) {
    console.error("uploadResumeFile.upload.error", uploadError);
    throw new Error("Failed to upload the resume");
  }

  const { data, error } = await getSupabaseClient().rpc("add_resume_file", {
    p_path: storagePath,
    p_filename: file.name,
    p_mime_type: file.type || "application/octet-stream",
    p_size: file.size,
    p_shidduchim_id: isSingleSubject(subject)
      ? undefined
      : subject.shidduchimId,
    p_single_id: isSingleSubject(subject) ? subject.singleId : undefined,
  });
  if (error) {
    console.error("uploadResumeFile.add_resume_file.error", error);
    await getSupabaseClient()
      .storage.from(DOCUMENTS_BUCKET)
      .remove([storagePath])
      .catch((removeError) => {
        console.error("uploadResumeFile.cleanup.error", removeError);
      });
    throw new Error(error.message || "Failed to upload the resume");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error(INBOX_RESUME_ATTACH_ERROR);
  return row as Resume;
}

export type CopyInboxAttachmentToResumeFileParams = ResumeSubject & {
  inboxItemId: number | string;
  attachment: InboxAttachment;
};

export type AttachInboxAttachmentToResumeFileParams = ResumeSubject & {
  inboxItemId: number | string;
  attachment: ResumeInboxAttachment;
};

const INBOX_RESUME_ATTACH_ERROR =
  "Could not attach this file. It may be too large or no longer available. The Inbox item was not changed.";

function isExistingStorageObjectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { statusCode?: string | number; message?: string };
  return (
    String(candidate.statusCode) === "409" ||
    /already exists|duplicate/i.test(candidate.message ?? "")
  );
}

/**
 * The read-only checks keep common rejections out of the copy window. The
 * provenance-aware RPC remains the final authority because the Inbox,
 * target, and resume can change between this check and the append.
 */
async function validateInboxResumeAttach(
  accountId: number,
  subject: ResumeSubject,
  inboxItemId: number | string,
  attachment: ResumeInboxAttachment,
): Promise<Resume | null> {
  const client = getSupabaseClient();
  const { data: role, error: roleError } = await client.rpc(
    "current_member_role",
  );
  if (roleError || role == null || role === "single") {
    throw new Error(INBOX_RESUME_ATTACH_ERROR);
  }

  const { data: inboxItem, error: inboxError } = await client
    .from("inbox_items")
    .select("id,status")
    .eq("account_id", accountId)
    .eq("id", inboxItemId)
    .maybeSingle();
  if (inboxError || !inboxItem || inboxItem.status !== "unresolved") {
    throw new Error(INBOX_RESUME_ATTACH_ERROR);
  }
  if (!isEligibleResumeAttachment(attachment)) {
    throw new Error(INBOX_RESUME_ATTACH_ERROR);
  }

  const targetTable = isSingleSubject(subject) ? "singles" : "shidduchim";
  const targetColumn = isSingleSubject(subject) ? "single_id" : "shidduchim_id";
  const targetId = isSingleSubject(subject)
    ? subject.singleId
    : subject.shidduchimId;
  const { data: target, error: targetError } = await client
    .from(targetTable)
    .select("id")
    .eq("account_id", accountId)
    .eq("id", targetId)
    .maybeSingle();
  if (targetError || !target) {
    throw new Error(INBOX_RESUME_ATTACH_ERROR);
  }

  const { data: resume, error: resumeError } = await client
    .from("resumes")
    .select("*")
    .eq("account_id", accountId)
    .eq(targetColumn, targetId)
    .maybeSingle();
  if (resumeError) {
    throw new Error(INBOX_RESUME_ATTACH_ERROR);
  }

  const files = Array.isArray(resume?.files) ? resume.files : [];
  const alreadyAttached = files.some(
    (file: unknown) =>
      file &&
      typeof file === "object" &&
      String(
        (file as { source_inbox_item_id?: unknown }).source_inbox_item_id,
      ) === String(inboxItemId) &&
      (file as { source_inbox_attachment_path?: unknown })
        .source_inbox_attachment_path === attachment.path,
  );
  if (alreadyAttached) {
    return resume as Resume;
  }

  return null;
}

/**
 * Copies one still-unresolved Inbox attachment and appends it through the
 * provenance-aware `add_resume_file` contract. The RPC repeats all account,
 * role, target, status, and source-path checks; the client never treats the
 * persisted signed URL as a source of authority.
 *
 * The destination key is deterministic and shared by retries. If the RPC
 * fails after the copy, this function deliberately leaves the private object
 * in place: a lost response can race with a retry that commits the same
 * object, so deleting it here could remove bytes referenced by a committed
 * resume. Common rejections are prevalidated above; an ambiguous failure can
 * therefore leave at most one bounded, private, deterministic object for this
 * account/target/source tuple, which a retry reuses. We intentionally leave
 * the object on every ambiguous or otherwise unclassified RPC error: a
 * response can be lost after the catalog append, and deleting it here could
 * silently remove a committed resume. The bounded leftover is private and
 * retry-safe; bead 89p tracks its Inbox-attachment object GC. The explicit
 * source/provenance rejection below is authoritative and cleanup is attempted
 * immediately; if that cleanup is unavailable, the same bounded GC policy
 * applies.
 */
export async function attachInboxAttachmentToResumeFile(
  params: AttachInboxAttachmentToResumeFileParams,
): Promise<Resume> {
  const { attachment, inboxItemId, ...subject } = params;
  const sourcePath = attachment.path;
  const accountId = await getCurrentAccountId();
  const storagePath = await buildResumeInboxStoragePath(
    accountId,
    subject,
    inboxItemId,
    sourcePath,
    attachment.title,
  );

  const existingResume = await validateInboxResumeAttach(
    accountId,
    subject,
    inboxItemId,
    attachment,
  );
  if (existingResume) return existingResume;

  try {
    const { data: blob, error: downloadError } = await getSupabaseClient()
      .storage.from(ATTACHMENTS_BUCKET)
      .download(sourcePath);
    if (downloadError || !blob) throw new Error(INBOX_RESUME_ATTACH_ERROR);

    const { error: uploadError } = await getSupabaseClient()
      .storage.from(DOCUMENTS_BUCKET)
      .upload(storagePath, blob);
    if (uploadError && !isExistingStorageObjectError(uploadError)) {
      throw new Error(INBOX_RESUME_ATTACH_ERROR);
    }

    const { data, error: appendError } = await getSupabaseClient().rpc(
      "add_resume_file",
      {
        p_path: storagePath,
        p_filename: attachment.title,
        p_mime_type: attachment.type || "application/octet-stream",
        p_size: blob.size,
        p_shidduchim_id: isSingleSubject(subject)
          ? undefined
          : subject.shidduchimId,
        p_single_id: isSingleSubject(subject) ? subject.singleId : undefined,
        p_source_inbox_item_id: inboxItemId,
        p_source_inbox_attachment_path: sourcePath,
      },
    );
    if (appendError) {
      // An explicit source/provenance rejection means the delete won after
      // the pre-copy checks but before this append. The destination was
      // created by this attempt and is therefore safe to remove. A rejected
      // RPC is distinct from an unknown network outcome below: in the latter
      // case a retry may already have committed the deterministic object.
      if (
        /Inbox attachment not found|source Inbox provenance/i.test(
          appendError.message ?? "",
        )
      ) {
        await getSupabaseClient()
          .storage.from(DOCUMENTS_BUCKET)
          .remove([storagePath])
          .catch(() => undefined);
      }
      throw new Error(INBOX_RESUME_ATTACH_ERROR);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return row as Resume;
  } catch (error) {
    if (error instanceof Error && error.message === INBOX_RESUME_ATTACH_ERROR) {
      throw error;
    }
    throw new Error(INBOX_RESUME_ATTACH_ERROR);
  }
}

export type CopiedResumeFile = {
  storagePath: string;
  size: number;
};

/**
 * Story 11.2 review fix (Finding 2, P1): a resume draft's saved file version
 * used to persist the ORIGINAL inbox attachment's path verbatim — a key
 * inside `ATTACHMENTS_BUCKET` — while every resume download signs against
 * `DOCUMENTS_BUCKET` (`signResumeFileUrl` below). Every auto-parsed resume
 * was therefore permanently undownloadable: `createSignedUrl` looks the path
 * up in the wrong bucket and 404s.
 *
 * Worse than a broken download link: leaving the object in `attachments`
 * would also silently defeat Story 6.3's AC-6 guarantee that a `single`
 * cannot reach a resume's raw PDF bytes at the storage layer.
 * `07_storage.sql`'s `documents`/`resumes/` policies carry an explicit
 * `current_member_role() <> 'single'` guard; `attachments`' policies carry
 * no such guard at all — any authenticated member of the account can read
 * any object under their account's `attachments` prefix, regardless of role.
 * So this is not an optimization, it is the fix: copy the bytes into
 * `documents`, under the exact same `{account}/resumes/{ownerSegment}/…`
 * grammar `uploadResumeFile` above uses, so every `resumes.files[]` entry —
 * manually uploaded or auto-parsed — lives under the one bucket the signer
 * and the RLS policies both agree on. The real byte size comes back from the
 * downloaded blob rather than being invented, which is also this same
 * code path's fix for a second, unrelated data-fidelity gap (the auto-parse
 * writer used to hardcode `size: 0`).
 */
export async function copyInboxAttachmentToResumeFile(
  params: CopyInboxAttachmentToResumeFileParams,
): Promise<CopiedResumeFile> {
  const { attachment, inboxItemId, ...subject } = params;
  const attachmentPath = attachment.path;
  const fileName = attachment.title;
  const accountId = await getCurrentAccountId();
  // This path is owned by the Inbox item and source attachment. A retry after
  // an ambiguous upload response upserts the same private object, so it can
  // never create a second copy. Any bounded leftover is covered by bead 89p's
  // Inbox-attachment object GC.
  const storagePath = await buildResumeInboxStoragePath(
    accountId,
    subject,
    inboxItemId,
    attachmentPath,
    fileName,
  );

  const { data: blob, error: downloadError } = await getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .download(attachmentPath);
  if (downloadError || !blob) {
    console.error(
      "copyInboxAttachmentToResumeFile.download.error",
      downloadError,
    );
    throw new Error("Failed to read the captured resume attachment");
  }

  const { error: uploadError } = await getSupabaseClient()
    .storage.from(DOCUMENTS_BUCKET)
    .upload(storagePath, blob, { upsert: true });
  if (uploadError) {
    console.error("copyInboxAttachmentToResumeFile.upload.error", uploadError);
    throw new Error("Failed to save the captured resume");
  }

  return { storagePath, size: blob.size };
}

/**
 * Story 9.5 (AC-11, AC-12): byte cleanup for a deleted single's/shidduch's
 * resume — mirrors `entityFiles.ts#removeEntityFileObjects` exactly.
 * `purge_polymorphic_dependents()` (02_functions.sql) removes the `resumes`
 * CATALOG row when its parent `singles`/`shidduchim` row is deleted, but it
 * is SQL and cannot reach the Storage API, so the PDF bytes those `files[]`
 * entries pointed at are never removed without this. No-op on an empty
 * array; a failure here is logged, never thrown — the parent row delete has
 * already been requested and must not be blocked by a storage cleanup
 * failure (AC-12).
 */
export class ResumeStorageCleanupError extends Error {
  constructor() {
    super("Could not clean up the resume file objects.");
    this.name = "ResumeStorageCleanupError";
  }
}

/** Strict cleanup for an owned, newly-created resume attempt. */
export async function removeResumeFileObjectsOrThrow(
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await getSupabaseClient()
      .storage.from(DOCUMENTS_BUCKET)
      .remove(paths);
    if (error) {
      console.error("removeResumeFileObjects.error", error);
      throw new ResumeStorageCleanupError();
    }
  } catch (thrown) {
    console.error("removeResumeFileObjects.error", thrown);
    if (thrown instanceof ResumeStorageCleanupError) throw thrown;
    throw new ResumeStorageCleanupError();
  }
}

/**
 * Best-effort cleanup for lifecycle deletes. Parent deletion must retain its
 * existing fail-soft behavior; attempt compensation uses the strict sibling
 * above so it never drops a catalog pointer while storage cleanup failed.
 */
export async function removeResumeFileObjects(paths: string[]): Promise<void> {
  try {
    await removeResumeFileObjectsOrThrow(paths);
  } catch {
    // The strict helper already logs the provider failure. Keep this public
    // lifecycle helper's historical fail-soft contract unchanged.
  }
}

/**
 * AC 5: a signed, expiring URL minted at click time, never persisted.
 * `download: fileName` restores the original name to the browser without
 * putting it in the object key — mirrors `signEntityFileUrl`.
 */
export async function signResumeFileUrl(
  params: SignResumeFileUrlParams,
): Promise<string> {
  const { data, error } = await getSupabaseClient()
    .storage.from(DOCUMENTS_BUCKET)
    .createSignedUrl(
      params.storagePath,
      params.inline
        ? RESUME_FILE_VIEW_TTL_SECONDS
        : RESUME_FILE_URL_TTL_SECONDS,
      params.inline ? undefined : { download: params.fileName },
    );
  if (error || !data) {
    console.error("signResumeFileUrl.error", error);
    throw new Error("Failed to sign the file URL");
  }
  return data.signedUrl;
}
