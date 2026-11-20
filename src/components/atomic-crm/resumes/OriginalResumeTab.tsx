import type { ReactNode } from "react";
import { useRecordContext } from "ra-core";

import { buildTabPath } from "../entity360/entityPaths";
import type { ShidduchSummary } from "../types";
import { useViewerRole } from "../entity360/useViewerRole";
import { ResumeDocument } from "./ResumeDocument";
import { canRereadResume } from "./resumeReferenceVisibility";
import { canDeleteResumeFile as canDeleteResumeFileForRole } from "./resumeFileDelete";

/**
 * The original-file surface is deliberately separate from `ResumeTab`: the
 * Resume tab owns upload/inbox and parsed facts, while this tab owns the one
 * full-width original viewer. `ResumeDocument` remains the single preview
 * host, so switching tabs cannot mount a second PDF preview or signed fetch.
 */
export function OriginalResumeTab(): ReactNode {
  const record = useRecordContext<ShidduchSummary>();
  const { role, isPending: isRolePending } = useViewerRole();
  if (!record) return null;

  const canReread = canRereadResume(role, isRolePending);
  const canDelete = canDeleteResumeFileForRole(role, isRolePending);

  return (
    <section
      aria-labelledby="original-resume-heading"
      className="flex min-w-0 max-w-full flex-col gap-4"
    >
      <h2 id="original-resume-heading" className="text-xl font-semibold">
        Original resume
      </h2>
      <ResumeDocument
        shidduchimId={record.id}
        canReread={canReread}
        canDelete={canDelete}
        presentation="picker"
        emptyActionHref={buildTabPath("shidduchim", record.id, "resume")}
      />
    </section>
  );
}
