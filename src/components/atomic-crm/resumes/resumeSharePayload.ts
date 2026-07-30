import type { ResumeFileVersion } from "../types";

/**
 * Builds the Web Share API `files` payload for exactly ONE resume file
 * version — Story 5.4's "a photo is never included in a share unless
 * chosen" guarantee (AD-9): the signature only ever accepts a single blob,
 * so the payload it returns cannot structurally hold anything from
 * `resume_photos`, and `ForwardResumeButton` only ever calls it with the one
 * version `useLatestResumeFile` resolves. A standalone module (not inlined
 * into `ForwardResumeButton.tsx`) so it is independently unit-testable
 * without driving `navigator.share` itself, and so that component's own
 * file stays component-only (`react-refresh/only-export-components`).
 */
export function buildResumeSharePayload(
  blob: Blob,
  version: Pick<ResumeFileVersion, "filename" | "mime_type">,
): { files: File[] } {
  return {
    files: [
      new File([blob], version.filename, {
        type: version.mime_type || blob.type,
      }),
    ],
  };
}
