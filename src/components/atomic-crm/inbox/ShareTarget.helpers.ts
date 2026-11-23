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
    await onPartialFailure?.(uploaded);
    throw error;
  }
  return uploaded;
}
