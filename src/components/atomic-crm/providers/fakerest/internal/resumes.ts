import type { DataProvider, Identifier } from "ra-core";

import {
  isSingleSubject,
  resumeSubjectFilter,
  type ResumeSubject,
} from "../../../resumes/resumeSubject";
import {
  buildResumeInboxStoragePath,
  isEligibleResumeAttachment,
  type ResumeInboxAttachment,
} from "../../../resumes/resumeInbox";
import type { InboxItem, MemberRole } from "../../../types";
import type { Resume, ResumeFileVersion } from "../../../types";

/**
 * The AD-10 mirror of `providers/supabase/resumes.ts` for demo mode.
 * FakeRest has no real storage bucket, so the "bytes" are an in-memory
 * `Map<storage_path, objectUrl>` built with `URL.createObjectURL` — a
 * separate map from `./entityFiles.ts`'s own, one per `createDataProvider()`
 * session, so a fresh demo/test session never sees a stale blob from a
 * previous one.
 */
export type ResumeFileBlobUrls = Map<string, string>;

export type UploadResumeFileParams = ResumeSubject & {
  file: File;
};

export type AttachInboxAttachmentToResumeFileParams = ResumeSubject & {
  inboxItemId: Identifier;
  attachment: ResumeInboxAttachment;
};

const INBOX_RESUME_ATTACH_ERROR =
  "Could not attach this file. It may be too large or no longer available. The Inbox item was not changed.";

/**
 * FakeRest mirror of `add_resume_file` (AC 2; widened to a single subject
 * by Story 5.8): finds the subject's existing `resumes` row (unique on
 * `shidduchim_id`/`single_id`, exactly like the real table) and appends, or
 * creates the row on first upload. `baseDataProvider.update` carries the
 * FULL previous `files` array forward plus the new entry — this is the one
 * place in the FakeRest session allowed to do that read-append-write,
 * because (unlike the real database) nothing else can run concurrently
 * against this in-memory store.
 */
export async function uploadResumeFile(
  baseDataProvider: DataProvider,
  blobUrls: ResumeFileBlobUrls,
  accountId: Identifier,
  memberId: Identifier | null,
  params: UploadResumeFileParams,
): Promise<Resume> {
  const { file, ...subject } = params;
  const ownerSegment = isSingleSubject(subject)
    ? `single-${subject.singleId}`
    : `${subject.shidduchimId}`;
  const storagePath = `${accountId}/resumes/${ownerSegment}/${crypto.randomUUID()}-${file.name}`;
  blobUrls.set(storagePath, URL.createObjectURL(file));

  const entry: ResumeFileVersion = {
    path: storagePath,
    filename: file.name,
    uploaded_at: new Date().toISOString(),
    uploaded_by: memberId,
    mime_type: file.type || "application/octet-stream",
    size: file.size,
  };

  const { data: matches } = await baseDataProvider.getList<Resume>("resumes", {
    filter: resumeSubjectFilter(subject),
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });
  const existing = matches[0];

  if (existing) {
    const { data } = await baseDataProvider.update<Resume>("resumes", {
      id: existing.id,
      data: { files: [...(existing.files ?? []), entry] },
      previousData: existing,
    });
    return data;
  }

  const { data } = await baseDataProvider.create<Resume>("resumes", {
    data: {
      account_id: accountId,
      ...resumeSubjectFilter(subject),
      files: [entry],
      created_at: new Date().toISOString(),
    },
  });
  return data;
}

/**
 * FakeRest mirror of the server's provenance-validated, idempotent attach.
 * The destination key is deterministic and shared by retries. Once the blob
 * is registered, never remove it from `blobUrls` on a write error: the row
 * may already have committed while its response was lost, and a retry must
 * still be able to view the committed file.
 */
export async function attachInboxAttachmentToResumeFile(
  baseDataProvider: DataProvider,
  blobUrls: ResumeFileBlobUrls,
  accountId: Identifier,
  memberId: Identifier | null,
  callerRole: MemberRole | undefined,
  params: AttachInboxAttachmentToResumeFileParams,
): Promise<Resume> {
  if (callerRole == null || callerRole === "single") {
    throw new Error(INBOX_RESUME_ATTACH_ERROR);
  }

  const { data: inboxItems } = await baseDataProvider.getList<InboxItem>(
    "inbox_items",
    {
      filter: { id: params.inboxItemId },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
  );
  const item = inboxItems[0];
  const sourceAttachment = item?.attachments?.find(
    (candidate) => candidate.path === params.attachment.path,
  );
  if (
    !item ||
    String(item.account_id) !== String(accountId) ||
    item.status !== "unresolved" ||
    !sourceAttachment ||
    !isEligibleResumeAttachment(sourceAttachment)
  ) {
    throw new Error(INBOX_RESUME_ATTACH_ERROR);
  }

  const targetId = params.shidduchimId ?? params.singleId;
  const targetResource = params.singleId != null ? "singles" : "shidduchim";
  const { data: targets } = await baseDataProvider.getList(targetResource, {
    filter: { id: targetId },
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });
  if (!targets[0] || String(targets[0].account_id) !== String(accountId)) {
    throw new Error(INBOX_RESUME_ATTACH_ERROR);
  }

  const { data: resumes } = await baseDataProvider.getList<Resume>("resumes", {
    filter: resumeSubjectFilter(params),
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });
  const existing = resumes[0];
  const existingFiles = existing?.files ?? [];
  const duplicate = existingFiles.find(
    (file) =>
      String(file.source_inbox_item_id) === String(params.inboxItemId) &&
      file.source_inbox_attachment_path === sourceAttachment.path,
  );
  if (duplicate && existing) return existing;

  const storagePath = await buildResumeInboxStoragePath(
    accountId,
    params,
    params.inboxItemId,
    sourceAttachment.path,
    sourceAttachment.title,
  );

  try {
    const response = await fetch(sourceAttachment.src);
    if (!response.ok) throw new Error(INBOX_RESUME_ATTACH_ERROR);
    const blob = await response.blob();
    blobUrls.set(storagePath, URL.createObjectURL(blob));
    const entry: ResumeFileVersion = {
      path: storagePath,
      filename: sourceAttachment.title,
      uploaded_at: new Date().toISOString(),
      uploaded_by: memberId,
      mime_type: sourceAttachment.type || "application/octet-stream",
      size: blob.size,
      source_inbox_item_id: params.inboxItemId,
      source_inbox_attachment_path: sourceAttachment.path,
    };

    if (existing) {
      const { data } = await baseDataProvider.update<Resume>("resumes", {
        id: existing.id,
        data: { files: [...existingFiles, entry] },
        previousData: existing,
      });
      return data;
    }

    const { data } = await baseDataProvider.create<Resume>("resumes", {
      data: {
        account_id: accountId,
        ...resumeSubjectFilter(params),
        files: [entry],
        created_at: new Date().toISOString(),
      },
    });
    return data;
  } catch {
    throw new Error(INBOX_RESUME_ATTACH_ERROR);
  }
}

/** FakeRest mirror of `signResumeFileUrl` — returns the same object URL on
 * every call for a given `storagePath` (a real signed URL from Supabase
 * storage is per-call too, but the underlying object is identical either
 * way; nothing here caches the URL on the row or in list state). */
export async function signResumeFileUrl(
  blobUrls: ResumeFileBlobUrls,
  storagePath: string,
): Promise<string> {
  // The Supabase mirror takes an `inline` flag, which decides whether the
  // signed URL carries `Content-Disposition: attachment`. There is no
  // equivalent here and none is needed: a `blob:` object URL carries no
  // disposition at all, so the demo's files already open in the viewer and
  // still save from the Download button. The flag is accepted and ignored at
  // the data-provider boundary rather than being absent from it, so the two
  // providers keep the same shape.
  const url = blobUrls.get(storagePath);
  if (!url) {
    throw new Error("Failed to sign the file URL");
  }
  return url;
}
