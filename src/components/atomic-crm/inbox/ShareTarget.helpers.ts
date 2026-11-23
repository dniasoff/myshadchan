import type { Identifier } from "ra-core";

import { uploadToBucket } from "../providers/supabase/dataProvider";
import type { CreateShidduchInput, RAFile } from "../types";
import type { ParsedResumeFields } from "./useParseResume";

export type SharedAttachment = {
  title: string;
  type: string;
  path: string;
  src: string;
  size: number;
};

export type DerivedShareSource = "whatsapp" | "photo" | "upload";

export const SHARE_UPLOAD_FAILURE_COPY =
  "Couldn't upload the shared file. Nothing was saved. Try again.";

export const SHARE_RECOVERY_FAILURE_COPY =
  "Couldn't finish cleaning up this share. Please check your Inbox before trying again.";

export function deriveShareSource(files: File[]): DerivedShareSource {
  if (files.length === 0) return "whatsapp";
  return files.some((file) => !file.type.startsWith("image/"))
    ? "upload"
    : "photo";
}

export function preserveResumeSourceMarker(
  sections: unknown,
  sourceInboxItemId: Identifier,
): Record<string, unknown> {
  const existing =
    sections != null && typeof sections === "object" && !Array.isArray(sections)
      ? (sections as Record<string, unknown>)
      : {};
  return {
    ...existing,
    source_inbox_item_id:
      existing.source_inbox_item_id != null
        ? existing.source_inbox_item_id
        : sourceInboxItemId,
  };
}

/** Remove captured objects without allowing one failed removal to prevent the
 * rest from running. The returned rows are the objects that remain reachable
 * and must stay recorded for a later cleanup sweep. */
export async function removeSharedFilesBestEffort(
  uploaded: SharedAttachment[],
  remove: (path: string) => Promise<void>,
): Promise<SharedAttachment[]> {
  const candidates = uploaded.filter((attachment) => Boolean(attachment.path));
  const results = await Promise.allSettled(
    candidates.map((attachment) =>
      Promise.resolve().then(() => remove(attachment.path)),
    ),
  );
  return candidates.filter((_, index) => results[index]?.status === "rejected");
}

/** Copy every model field into the create payload, while preserving a name
 * the user edited in the share form over the model's suggestion. */
export function applyParsedResumeFields(
  input: CreateShidduchInput,
  fields: ParsedResumeFields,
  manuallyEnteredName: string | null,
  fallbackName: string | null,
): CreateShidduchInput {
  Object.assign(input, fields);
  input.name_en = manuallyEnteredName ?? fields.name_en ?? fallbackName ?? null;
  return input;
}

/** Upload each shared file and report already-uploaded objects if a later
 * upload fails, so the caller can remove those objects before retrying. */
export async function uploadSharedFiles(
  files: File[],
  inboxItemId?: Identifier,
  onPartialFailure?: (uploaded: SharedAttachment[]) => Promise<void>,
): Promise<SharedAttachment[]> {
  const uploaded: SharedAttachment[] = [];
  try {
    for (const file of files) {
      const objectUrl = URL.createObjectURL(file);
      try {
        const raFile: RAFile = {
          src: objectUrl,
          title: file.name,
          rawFile: file,
          type: file.type,
        };
        const prefix = inboxItemId != null ? `inbox/${inboxItemId}` : undefined;
        const result = await uploadToBucket(raFile, prefix);
        uploaded.push({
          title: result.title,
          type: result.type ?? file.type,
          path: result.path ?? "",
          src: result.src,
          size: file.size,
        });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
  } catch (error) {
    try {
      await onPartialFailure?.(uploaded);
    } catch (cleanupError) {
      // Preserve the upload error. Callers that need a recoverable record keep
      // the uploaded list in their callback, even if cleanup itself rejects.
      console.error("uploadSharedFiles.partialCleanup.error", cleanupError);
    }
    throw error;
  }
  return uploaded;
}
