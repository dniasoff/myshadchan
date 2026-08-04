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
 * looks like a resume (PDF or image). Returns `null` on any unexpected shape
 * so the route can return a clean 422 instead of crashing.
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
