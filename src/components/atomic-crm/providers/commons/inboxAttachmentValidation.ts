import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  validateAttachmentMagic,
} from "../../../../../workers/parse/inboxAttachment";

/** The manual Inbox picker limit. Existing email ingestion is unchanged. */
export const MAX_INBOX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_INBOX_FILES = 10;
export const MAX_INBOX_TOTAL_BYTES = 40 * 1024 * 1024;

const MSWORD_MIME_TYPE = "application/msword";
const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const PICKER_MIME_TYPES = new Set<string>([
  ...ALLOWED_ATTACHMENT_MIME_TYPES,
  MSWORD_MIME_TYPE,
]);

const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".doc": MSWORD_MIME_TYPE,
  ".docx": DOCX_MIME_TYPE,
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
};

export type InboxFileKind = "Resume" | "Picture" | "File";

export type InboxFileValidation =
  | { ok: true; kind: InboxFileKind; mimeType: string }
  | { ok: false; reason: "too_big" | "unsupported" | "malformed" };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function kindForMimeType(mimeType: string): InboxFileKind {
  return mimeType.startsWith("image/") ? "Picture" : "Resume";
}

function validateOldWordDocument(bytes: ArrayBuffer): "ok" | "malformed" {
  const data = new Uint8Array(bytes);
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return signature.every((byte, index) => data[index] === byte)
    ? "ok"
    : "malformed";
}

/**
 * Validate a file before an Inbox row exists. MIME is only a claim: the
 * existing parser's byte-signature checks are reused so a renamed HTML/text
 * file cannot pass as a PDF, Word document, or picture.
 */
export async function validateInboxFile(
  file: File,
): Promise<InboxFileValidation> {
  if (file.size > MAX_INBOX_FILE_BYTES) {
    return { ok: false, reason: "too_big" };
  }

  const declaredType = file.type.trim().toLowerCase();
  const extensionType = EXTENSION_MIME_TYPES[extensionOf(file.name)];
  const mimeType = PICKER_MIME_TYPES.has(declaredType)
    ? declaredType
    : declaredType === "" && extensionType
      ? extensionType
      : null;

  if (!mimeType) {
    return { ok: false, reason: "unsupported" };
  }

  const bytes = await file.arrayBuffer();
  const magic =
    mimeType === MSWORD_MIME_TYPE
      ? validateOldWordDocument(bytes)
      : validateAttachmentMagic(bytes, mimeType);

  return magic === "ok"
    ? { ok: true, kind: kindForMimeType(mimeType), mimeType }
    : { ok: false, reason: "malformed" };
}
