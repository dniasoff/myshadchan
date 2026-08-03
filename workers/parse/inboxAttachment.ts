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

function isResumeShapedType(type: string): boolean {
  return type.startsWith("application/pdf") || type.startsWith("image/");
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
