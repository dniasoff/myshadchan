import type { ResourceCallbacks } from "ra-core";

import type { Resume, ResumePhoto } from "../../types";
import { removeResumeFileObjects } from "./resumes";
import { removeResumePhotoObjects } from "./resumePhotos";

/** The two resources that can ever orphan a resume or photo — the only
 * ones a `resumes` row's `single_id`/`shidduchim_id` FK can point at
 * (`resumes_owner_check`, 01_tables.sql). */
const RESUME_PARENT_FILTER_KEYS = {
  singles: "single_id",
  shidduchim: "shidduchim_id",
} as const;

type ResumeParentResource = keyof typeof RESUME_PARENT_FILTER_KEYS;

/**
 * Story 9.5 (AC-11, AC-12): the `resumes`/`resume_photos` equivalent of
 * `entityFiles.ts#buildEntityFilesCleanupCallbacks` (Story 3.7) — the ONLY
 * precedent for this shape in the codebase, followed exactly. Deleting a
 * `singles` or `shidduchim` row cascades to delete its `resumes`/
 * `resume_photos` rows at the database (the FKs are `on delete cascade`),
 * but `purge_polymorphic_dependents()` (02_functions.sql) is SQL and cannot
 * call the Storage API, so the PDF/photo bytes those rows pointed at are
 * never removed without this. Built here (not inline in `dataProvider.ts`,
 * review-fix F5 precedent) so it is unit-testable independent of the whole
 * custom-methods overlay — `dataProvider.ts` splices this exact array into
 * `lifeCycleCallbacks`, so `resumeStorageCleanup.test.ts` exercises the
 * real production wiring, not a re-implementation of it.
 *
 * `dataProvider` here is the WRAPPED provider `withLifecycleCallbacks`
 * passes to every callback at call time (so `getList("resumes", ...)`
 * itself still goes through the custom-methods overlay) — never a raw
 * client closed over elsewhere.
 *
 * Review fix (F9): the whole body is wrapped in try/catch, not just the two
 * `removeResume*Objects` calls. Those two already fail soft on their own
 * (they log, never throw), but the `getList` calls in between did not —
 * AC-12 promises the parent `singles`/`shidduchim` delete is never blocked
 * by this cleanup, and a transient `getList` failure (a network blip
 * talking to PostgREST, not a Storage failure) was an unguarded way to
 * break that promise: the thrown error would propagate straight out of
 * `beforeDelete` and make the delete itself fail. Catching here keeps the
 * failure exactly where AC-12 says it belongs — logged, never surfaced as
 * a blocked delete — regardless of which step (list or remove) failed.
 */
export function buildResumeStorageCleanupCallbacks(): ResourceCallbacks[] {
  return (Object.keys(RESUME_PARENT_FILTER_KEYS) as ResumeParentResource[]).map(
    (resource) => ({
      resource,
      beforeDelete: async (params, dataProvider) => {
        try {
          const filterKey = RESUME_PARENT_FILTER_KEYS[resource];
          // At most one live row per subject — resumes_single_id_key /
          // resumes_shidduchim_id_key (01_tables.sql), so perPage: 1 is
          // exact, not an approximation (same reasoning as
          // useListingUpsert.ts's own getList).
          const { data: resumes } = await dataProvider.getList<Resume>(
            "resumes",
            {
              filter: { [filterKey]: params.id },
              pagination: { page: 1, perPage: 1 },
              sort: { field: "id", order: "ASC" },
            },
          );
          const resume = resumes[0];
          if (!resume) {
            return params;
          }

          await removeResumeFileObjects(
            (resume.files ?? []).map((file) => file.path),
          );

          const { data: photos } = await dataProvider.getList<ResumePhoto>(
            "resume_photos",
            {
              filter: { resume_id: resume.id },
              pagination: { page: 1, perPage: 10_000 },
              sort: { field: "id", order: "ASC" },
            },
          );
          await removeResumePhotoObjects(photos.map((photo) => photo.path));
        } catch (error: unknown) {
          console.error("resumeStorageCleanup.beforeDelete.error", error);
        }

        return params;
      },
    }),
  );
}
