import type { ReactNode } from "react";
import { useRecordContext } from "ra-core";

import type { ShidduchSummary } from "../types";
import { useViewerRole } from "../entity360/useViewerRole";
import { ResumeUpload } from "./ResumeUpload";
import { ResumeInboxPicker } from "./ResumeInboxPicker";
import { ResumeDocument } from "./ResumeDocument";
import { ResumeReadableSections } from "./ResumeReadableSections";
import {
  canRereadResume,
  canViewResumeReferences,
} from "./resumeReferenceVisibility";
import { canPickResumeFromInbox } from "./resumeInbox";

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
  const canReread = canRereadResume(role, isRolePending);
  const canPickInboxResume = canPickResumeFromInbox(role, isRolePending);
  const targetLabel =
    record.name_en?.trim() ||
    [record.single_first_name_en, record.single_last_name_en]
      .filter(Boolean)
      .join(" ") ||
    "this suggestion";

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <section
        aria-labelledby="resume-original-heading"
        className="flex min-w-0 flex-col gap-4 rounded-2xl border p-4 sm:p-6 lg:col-start-1 lg:row-start-1"
      >
        <div>
          <h2 id="resume-original-heading" className="text-xl font-semibold">
            Original resume
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep the file exactly as it was uploaded.
          </p>
        </div>
        <ResumeDocument shidduchimId={record.id} canReread={canReread} />
      </section>
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start lg:col-start-1 lg:row-start-2">
        <ResumeUpload shidduchimId={record.id} autoRead={canReread} />
        {canPickInboxResume ? (
          <ResumeInboxPicker
            shidduchimId={record.id}
            targetLabel={targetLabel}
            autoRead={canReread}
          />
        ) : null}
      </div>
      <ResumeReadableSections
        record={record}
        canViewReferences={canViewReferences}
        canRead={canReread}
        className="lg:col-start-2 lg:row-span-2 lg:row-start-1"
      />
    </div>
  );
}
