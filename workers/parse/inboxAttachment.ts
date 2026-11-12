import { z } from "zod";

/**
 * The shape `extractAndUploadAttachments.ts` already writes into
 * `inbox_items.attachments`. `type` and `path` are required; `title` and `src`
 * are tolerated.
 */
export const InboxAttachmentSchema = z.object({
  type: z.string(),
  path: z.string(),
  title: z.string().optional(),
  src: z.string().optional(),
});

export type InboxAttachment = z.infer<typeof InboxAttachmentSchema>;

export const ATTACHMENTS_BUCKET = "attachments";

/**
 * Review fix (Finding 9): an explicit allowlist, not a `startsWith("image/")`
 * prefix match. The attachment's `type` comes straight from the sender's
 * email client's `Content-Type` header (`extractAndUploadAttachments.ts`) —
 * untrusted, and a prefix match accepted anything from `image/svg+xml` (an
 * XML format, not something Gemini's `inline_data` can OCR as a document —
 * forwarding it is wasted spend at best) to formats Gemini's inline-data
 * input does not document support for. This list is exactly the intersection
 * of "Gemini documents inline-data support for it" and "a resume attachment
 * plausibly arrives in this format."
 */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/**
 * Review fix (Finding 9): hard byte cap on a resume attachment, checked
 * BEFORE it is loaded into memory (see `index.ts`'s pre-download `list()`
 * metadata check). Base64-encoding inflates a buffer to 4/3 its raw size,
 * and `arrayBufferToBase64()` (resumeExtractor.ts) builds that base64 string
 * one character at a time — each JS string char costs ~2 bytes — then
 * `JSON.stringify()` copies the whole base64 string again into the request
 * body. Worst-case in-memory footprint for a raw file of size N is therefore
 * roughly N (the ArrayBuffer) + ~2.67N (the base64 string) + ~2.67N again
 * (the JSON body) — call it 7N. Cloudflare's per-invocation Worker memory
 * ceiling is 128 MB
 * (https://developers.cloudflare.com/workers/platform/limits/#memory-limits).
 * An 8 MiB raw cap keeps the worst case (~56 MB) comfortably under that
 * ceiling, leaving headroom for the Hono app, the Supabase client, and
 * everything else already resident in the isolate.
 */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function hasEncryptedPackage(bytes: Uint8Array): boolean {
  const marker = new Uint8Array(
    Array.from("EncryptedPackage", (character) =>
      character.charCodeAt(0),
    ).flatMap((code) => [code, 0]),
  );
  outer: for (
    let start = 0;
    start + marker.length <= bytes.length;
    start += 1
  ) {
    for (let index = 0; index < marker.length; index += 1) {
      if (bytes[start + index] !== marker[index]) continue outer;
    }
    return true;
  }
  return false;
}

/** Validate claimed MIME against bytes before any parser or model sees them. */
export function validateAttachmentMagic(
  bytes: ArrayBuffer,
  mimeType: string,
): "ok" | "password_protected" | "malformed" {
  const data = new Uint8Array(bytes);
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    if (startsWith(data, CFB_MAGIC)) {
      return hasEncryptedPackage(data) ? "password_protected" : "malformed";
    }
    return startsWith(data, [0x50, 0x4b, 0x03, 0x04]) ? "ok" : "malformed";
  }
  if (mimeType === "application/pdf") {
    return startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])
      ? "ok"
      : "malformed";
  }
  if (mimeType === "image/jpeg") {
    return startsWith(data, [0xff, 0xd8, 0xff]) ? "ok" : "malformed";
  }
  if (mimeType === "image/png") {
    return startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ? "ok"
      : "malformed";
  }
  if (mimeType === "image/webp") {
    return startsWith(data, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(data.slice(8), [0x57, 0x45, 0x42, 0x50])
      ? "ok"
      : "malformed";
  }
  if (mimeType === "image/heic" || mimeType === "image/heif") {
    const brand = new TextDecoder().decode(data.slice(8, 12));
    return startsWith(data.slice(4), [0x66, 0x74, 0x79, 0x70]) &&
      /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)
      ? "ok"
      : "malformed";
  }
  return "malformed";
}

function isResumeShapedType(type: string): boolean {
  return (ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(type);
}

/**
 * Split a storage object key (`{accountId}/{filename}`) into the directory
 * prefix and file name `supabase.storage.from(bucket).list()` expects. Used
 * to fetch an object's metadata (including size) without downloading its
 * body — see `index.ts`'s Finding 9 size guard.
 */
export function splitStoragePath(path: string): {
  dirPath: string;
  fileName: string;
} {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return { dirPath: "", fileName: path };
  }
  return {
    dirPath: path.slice(0, lastSlash),
    fileName: path.slice(lastSlash + 1),
  };
}

/**
 * Defensively parse `inbox_items.attachments` and return the first entry that
 * looks like a resume (PDF, DOCX, or supported image). Returns `null` on any
 * unexpected shape so the route can return a clean 422 instead of crashing.
 */
export function findResumeAttachment(
  attachments: unknown,
): InboxAttachment | null {
  if (!Array.isArray(attachments)) {
    return null;
  }

  for (const item of attachments) {
    const parsed = InboxAttachmentSchema.safeParse(item);
    if (parsed.success && isResumeShapedType(parsed.data.type)) {
      return parsed.data;
    }
  }

  return null;
}
