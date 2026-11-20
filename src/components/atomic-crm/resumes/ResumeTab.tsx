import type { ReactNode } from "react";
import { useRecordContext } from "ra-core";

import type { ShidduchSummary } from "../types";
import { useViewerRole } from "../entity360/useViewerRole";
import { ResumeUpload } from "./ResumeUpload";
import { ResumeInboxPicker } from "./ResumeInboxPicker";
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
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
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
      />
    </div>
  );
}
