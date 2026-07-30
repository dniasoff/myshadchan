import { useGetList } from "ra-core";
import type { Identifier } from "ra-core";

import type { Resume, ResumeFileVersion } from "../types";

/**
 * Newest-first, by `uploaded_at` — the exact sort `ResumeVersionList` (Story
 * 5.3, AC 1) already performs client-side, because `Resume.files` is an
 * append-only jsonb array (`add_resume_file`) never stored sorted. Shared
 * here rather than re-derived so Story 5.7's `useLatestResumeFile` cannot
 * drift from "which version is newest" (Dev Notes, "Reuse").
 */
export function sortResumeFilesNewestFirst(
  files: readonly ResumeFileVersion[],
): ResumeFileVersion[] {
  return [...files].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
}

export interface UseLatestResumeFileResult {
  /** `null` while pending, on error, or when no version has ever been uploaded. */
  latestFile: ResumeFileVersion | null;
  isPending: boolean;
  error: unknown;
}

/**
 * The shidduch's newest resume file version (Story 5.7, Task 3): reads the
 * same `resumes` row `ResumeVersionList` reads — identical `getList` filter/
 * pagination/sort, so React Query dedupes the two into one request when both
 * are mounted together (the same dedupe `shidduchim/entityDescriptorRegions.
 * tsx`'s `ShidduchIdentityHeader` doc comment relies on) — and returns only
 * its first (newest) entry, never the full list.
 */
export function useLatestResumeFile(
  shidduchimId: Identifier,
): UseLatestResumeFileResult {
  const { data, error, isPending } = useGetList<Resume>("resumes", {
    filter: { shidduchim_id: shidduchimId },
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });

  const files = data?.[0]?.files ?? [];
  const latestFile = sortResumeFilesNewestFirst(files)[0] ?? null;

  return { latestFile, isPending, error };
}
