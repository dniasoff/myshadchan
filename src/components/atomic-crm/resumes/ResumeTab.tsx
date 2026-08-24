import type { ReactNode } from "react";
import { useRecordContext } from "ra-core";

import type { ShidduchSummary } from "../types";
import { ResumeUpload } from "./ResumeUpload";
import { ResumeDocument } from "./ResumeDocument";

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
  if (!record) return null;

  return (
    <div className="flex flex-col gap-4">
      <ResumeUpload shidduchimId={record.id} />
      <ResumeDocument shidduchimId={record.id} />
    </div>
  );
}
