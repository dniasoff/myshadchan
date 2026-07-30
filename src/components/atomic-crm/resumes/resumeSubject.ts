import type { Identifier } from "ra-core";

/**
 * The two things a resume (Story 5.3) — and, by extension, a resume's
 * photos (Story 5.4) — can belong to: a shidduch, or (Story 5.8) a single's
 * OWN resume, "the one I send out to shadchanim." A discriminated union,
 * not two independent optional props, so a caller can never pass both or
 * neither and have TypeScript stay silent about it — mirrors the database's
 * own `resumes_owner_check`.
 *
 * Shared by `ResumeUpload`, `ResumeVersionList` and `PhotoTab` (AC 3): one
 * subject type, three reusers, rather than each component re-declaring its
 * own optional-`shidduchimId`-plus-optional-`singleId` shape.
 */
export type ResumeSubject =
  | { shidduchimId: Identifier; singleId?: never }
  | { shidduchimId?: never; singleId: Identifier };

/** Narrows a `ResumeSubject` to its single-owned arm. */
export function isSingleSubject(
  subject: ResumeSubject,
): subject is { singleId: Identifier; shidduchimId?: never } {
  return subject.singleId != null;
}

/**
 * The `getList("resumes", …)` filter for a subject — `shidduchim_id` or
 * `single_id`, whichever the caller passed. Shared by `ResumeVersionList`
 * and `PhotoTab`'s own `resumes` lookup, so the two can never resolve the
 * same subject to two different filters.
 */
export function resumeSubjectFilter(
  subject: ResumeSubject,
): Record<string, Identifier> {
  return isSingleSubject(subject)
    ? { single_id: subject.singleId }
    : { shidduchim_id: subject.shidduchimId as Identifier };
}
