import type { Identifier } from "ra-core";

import type {
  InboxAttachment,
  InboxItem,
  MemberRole,
  ResumeFileVersion,
} from "../types";

const RESUME_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const RESUME_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

export type ResumeInboxRow = {
  inboxItemId: Identifier;
  attachmentPath: string;
  title: string;
  mimeType: string;
  size: number | null;
  sourceLabel: string;
  receivedAt: string;
  alreadyAttached: boolean;
  attachment: InboxAttachment;
};

export function canPickResumeFromInbox(
  role: MemberRole | undefined,
  isRolePending: boolean,
): boolean {
  return !isRolePending && role != null && role !== "single";
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

/** The browser only uses this for display; the server repeats the checks. */
export function isEligibleResumeAttachment(
  attachment: InboxAttachment,
): boolean {
  if (attachment.path.trim() === "") return false;

  const mimeType = attachment.type.trim().toLowerCase();
  if (mimeType.startsWith("image/")) return true;
  if (RESUME_MIME_TYPES.has(mimeType)) return true;
  return (
    mimeType === "" && RESUME_EXTENSIONS.has(extensionOf(attachment.title))
  );
}

function sourceLabelFor(item: InboxItem): string {
  return (
    item.sender?.trim() || item.sender_email?.trim() || "Shared from your phone"
  );
}

function sameSource(
  version: ResumeFileVersion,
  itemId: Identifier,
  attachmentPath: string,
): boolean {
  return (
    String(version.source_inbox_item_id) === String(itemId) &&
    version.source_inbox_attachment_path === attachmentPath
  );
}

export function flattenEligibleResumeAttachments(
  items: InboxItem[],
  existingFiles: ResumeFileVersion[],
): ResumeInboxRow[] {
  return items.flatMap((item) => {
    if (item.status !== "unresolved") return [];

    return (item.attachments ?? [])
      .filter(isEligibleResumeAttachment)
      .map((attachment) => ({
        inboxItemId: item.id,
        attachmentPath: attachment.path,
        title: attachment.title,
        mimeType: attachment.type,
        size: attachment.size ?? null,
        sourceLabel: sourceLabelFor(item),
        receivedAt: item.created_at,
        alreadyAttached: existingFiles.some((version) =>
          sameSource(version, item.id, attachment.path),
        ),
        attachment,
      }));
  });
}

export function formatResumeInboxSize(size: number | null): string {
  if (size == null || !Number.isFinite(size) || size < 0)
    return "Size unavailable";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function ownerSegment(subject: {
  shidduchimId?: Identifier;
  singleId?: Identifier;
}): string {
  return subject.singleId != null
    ? `single-${subject.singleId}`
    : `${subject.shidduchimId}`;
}

function safeStorageFilename(filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  return safe || "resume";
}

/** A retry-safe destination key shared by the real and FakeRest providers. */
export async function buildResumeInboxStoragePath(
  accountId: Identifier,
  subject: { shidduchimId?: Identifier; singleId?: Identifier },
  inboxItemId: Identifier,
  attachmentPath: string,
  filename: string,
): Promise<string> {
  const input = `${accountId}|${ownerSegment(subject)}|${inboxItemId}|${attachmentPath}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${accountId}/resumes/${ownerSegment(subject)}/inbox-${hash}-${safeStorageFilename(filename)}`;
}
