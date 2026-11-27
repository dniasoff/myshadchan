import type { Identifier } from "ra-core";

import type { ResumePhotoVisibility } from "../types";

/**
 * Build a stable storage key for a photo promoted from an inbox attachment.
 * The source path is already the durable identity of the captured object, so
 * keeping its marker in the storage key gives both providers idempotency
 * without adding a catalog column or a migration.
 */
export function resumePhotoStoragePath(
  accountId: Identifier,
  ownerSegment: string,
  visibility: ResumePhotoVisibility,
  sourceAttachmentPath?: string,
  fileName?: string,
): string {
  const suffix =
    sourceAttachmentPath == null
      ? `${crypto.randomUUID()}-${fileName ?? "photo.jpg"}`
      : `inbox-${stableSourceToken(sourceAttachmentPath)}${imageExtension(sourceAttachmentPath)}`;
  return `${accountId}/photos/${visibility}/${ownerSegment}/${suffix}`;
}

function imageExtension(path: string): ".jpg" | ".png" {
  const extension = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
  return extension === "png" ? ".png" : ".jpg";
}

function stableSourceToken(sourcePath: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (const character of sourcePath) {
    const code = character.codePointAt(0) ?? 0;
    first ^= code;
    first = Math.imul(first, 16777619);
    second ^= code;
    second = Math.imul(second, 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}
