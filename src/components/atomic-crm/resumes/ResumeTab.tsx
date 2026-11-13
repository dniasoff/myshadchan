import type { ReactNode } from "react";
import { useRecordContext } from "ra-core";

import type { ShidduchSummary } from "../types";
import { useViewerRole } from "../entity360/useViewerRole";
import { ResumeUpload } from "./ResumeUpload";
import { ResumeDocument } from "./ResumeDocument";
import { ResumeReadableSections } from "./ResumeReadableSections";
import { canViewResumeReferences } from "./resumeReferenceVisibility";

/**
 * The shidduch descriptor's `resume` tab entry point (Story 5.3, AC 1 / AC 3
 * / AC 6). `render` is arity-zero (contract §2 rule 4) — this reaches the
 * shidduch via `useRecordContext()`, exactly like
 * `shidduchim/entityDescriptorRegions.tsx`'s own tab adapters.
 *
 * A resume is not a `UniversalTabProps` consumer: it belongs to the
 * shidduch specifically (Story 5.8 gives the single its OWN resume tab
 * later, sharing this same `resumes/` folder, not this component), so it
 * takes `shidduchimId` rather than `targetType`/`targetId`.
 */
export function ResumeTab(): ReactNode {
  const record = useRecordContext<ShidduchSummary>();
  const { role, isPending: isRolePending } = useViewerRole();
  if (!record) return null;

  // The single role can see the original resume through the existing dignity
  // boundary, but never parsed references or candid reference-link content.
  // Fail closed while the active context is settling.
  const canViewReferences = canViewResumeReferences(role, isRolePending);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ResumeUpload shidduchimId={record.id} />
      <section
        aria-labelledby="resume-original-heading"
        className="flex min-w-0 flex-col gap-4 rounded-2xl border p-4 sm:p-6"
      >
        <div>
          <h2 id="resume-original-heading" className="text-xl font-semibold">
            Original resume
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep the file exactly as it was uploaded.
          </p>
        </div>
        <ResumeDocument shidduchimId={record.id} />
      </section>
      <ResumeReadableSections
        record={record}
        canViewReferences={canViewReferences}
      />
    </div>
  );
}
