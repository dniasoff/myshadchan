import type { ReactNode } from "react";
import { useRecordContext } from "ra-core";

import { ThreadList } from "../threads";
import type { ShidduchSummary } from "../types";

/**
 * Story 7.1 — the shidduch descriptor's `discussions` tab entry point. Wires
 * `ThreadList` to `subject_type: 'shidduch'` for this shidduch; the tab
 * carries no `visibleTo` restriction (contract §2 rule 7 — an allow-list, not
 * a threshold) because AC-9's dignity floor gives a `single` participant
 * real, readable threads on their own visible suggestion, unlike the five
 * tabs Story 6.3 hid for being permanently empty for that role.
 *
 * `render` is arity-zero (contract §2 rule 4) — reaches the shidduch via
 * `useRecordContext()`, exactly like `ExternalLinksTab`/`MedicalTab`/
 * `ResumeTab`/`PhotoTab`.
 */
export function ShidduchDiscussionsTab(): ReactNode {
  const record = useRecordContext<ShidduchSummary>();
  if (!record) return null;

  return <ThreadList subjectType="shidduch" subjectId={record.id} />;
}
