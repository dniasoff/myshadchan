import type { ReactNode } from "react";
import { useRecordContext } from "ra-core";

import { EditButton } from "@/components/admin/edit-button";

import { ActivityTab } from "../entity360/tabs/ActivityTab";
import { NotesTab } from "../entity360/tabs/NotesTab";
import { RelatedRecordsTab } from "../entity360/tabs/RelatedRecordsTab";
import { TasksTab } from "../entity360/tabs/TasksTab";
import type { EntityRelationshipDescriptor } from "../entity360/relationshipDescriptor";
import { TopToolbar } from "../layout/TopToolbar";
import type { Reference } from "../types";
import { ReferenceCallLog } from "./ReferenceCallLog";
import { ReferenceHeader } from "./ReferenceHeader";
import { ReferenceMergeButton } from "./ReferenceMergeButton";
import { RepeatRecognitionPanel } from "./RepeatRecognitionPanel";
import { ResearchAssistantPanel } from "./ResearchAssistantPanel";
import { useReferenceLinks } from "./useReferenceLinks";

/**
 * The region/tab adapters `references/entityDescriptor.tsx` assembles into
 * `referencesDescriptor` (Story 5.10, AC 4). Split into their own module
 * because they are React components and `entityDescriptor.tsx`'s other
 * export, `referencesDescriptor`, is not — `react-refresh/only-export-
 * components` flags a file that mixes the two, exactly like
 * `shadchanim/entityDescriptorRegions.tsx` / `singles/entityDescriptorRegions.tsx`.
 */

/**
 * The `identityHeader` region: a one-line adapter over `ReferenceHeader` —
 * `{ reference: Reference }` does not fit `ComponentType<{ record: T }>`
 * (`entity360/entityDescriptor.ts`).
 */
export const ReferenceIdentityHeader = ({ record }: { record: Reference }) => (
  <ReferenceHeader reference={record} />
);

/**
 * The `actions` region: the two affordances the deleted routed record page
 * carried in its own action bar — an `EditButton` back to
 * `/references/{id}/edit`, and the merge-duplicates action — rendered
 * INSIDE the identity header, immediately after it (contract §2 rule 2).
 */
export const ReferenceActions = () => (
  <TopToolbar>
    <EditButton />
    <ReferenceMergeButton />
  </TopToolbar>
);

/**
 * The `conversations` tab: unchanged content (`RepeatRecognitionPanel` +
 * `ReferenceCallLog`), now reached via `useRecordContext()`/
 * `useReferenceLinks()` instead of the deleted `ReferenceShow`'s own
 * `record`/`links` locals — the standalone (non-`compact`) rendering, so
 * every other shidduch this reference has spoken about is shown (no
 * `excludeShidduchimId`, unlike the compact rendering inside
 * `ShidduchReferencesSection.tsx`).
 */
export function ReferenceConversationsTab(): ReactNode {
  const record = useRecordContext<Reference>();
  const { links, isPending } = useReferenceLinks(record?.id);
  if (!record) return null;

  return (
    <div className="flex flex-col gap-4">
      <RepeatRecognitionPanel
        referenceName={record.name_en || "?"}
        links={links}
        isPending={isPending}
      />
      <ReferenceCallLog links={links} />
    </div>
  );
}

/**
 * The `shidduchim` tab (AC 4, Task 3): the reference's own many-to-many, via
 * `reference_links_summary` — `linkResource`/`linkId`/`linkLabel` because
 * the queried row is a link/summary row, not the target record itself
 * (`entity360/relationshipDescriptor.ts`'s own worked example for this exact
 * case). Declared as an explicit `tabs` entry rendering `<RelatedRecordsTab/>`
 * here, NOT as a `relationships` entry: `mergeEntityTabs` appends every
 * relationship-derived tab AFTER every explicit `tabs` entry, which would
 * render Shidduchim last instead of at its canonical position 3.
 *
 * `"shidduchim_id@not.is": null` excludes a link with no shidduch — the
 * column is nullable and an unguarded row would render a `RecordLink` to
 * `/shidduchim/null` (`RepeatRecognitionPanel.tsx`/`ReferenceCallLog.tsx`
 * already guard the same case).
 */
const referenceShidduchim: EntityRelationshipDescriptor = {
  key: "shidduchim",
  resource: "reference_links_summary",
  getFilter: (record) => ({
    reference_id: record.id,
    "shidduchim_id@not.is": null,
  }),
  linkResource: "shidduchim",
  linkId: (row) => row.shidduchim_id,
  linkLabel: (row) => row.shidduch_name_en,
};

export function ReferenceShidduchimTab(): ReactNode {
  return <RelatedRecordsTab relationship={referenceShidduchim} />;
}

/**
 * The `assistant` tab: unchanged content (`ResearchAssistantPanel`), still
 * AI-entitlement-gated inside that component — this adapter only supplies
 * the `{ reference, links }` props it was already written against.
 */
export function ReferenceAssistantTab(): ReactNode {
  const record = useRecordContext<Reference>();
  const { links } = useReferenceLinks(record?.id);
  if (!record) return null;
  return <ResearchAssistantPanel reference={record} links={links} />;
}

/**
 * `render` is arity-zero (contract §2 rule 4) — these three thin wrappers
 * reach the record via `useRecordContext()` rather than a typed prop,
 * exactly like `shidduchim`/`singles`/`shadchanim`'s own universal-tab
 * adapters. `targetType`/`targetId`, camelCase, never the DB's `target_type`
 * (Epic 3 API contract §8 — `UniversalTabProps`).
 */
export function ReferenceNotesTab(): ReactNode {
  const record = useRecordContext<Reference>();
  if (!record) return null;
  return <NotesTab targetType="reference" targetId={record.id} />;
}

export function ReferenceTasksTab(): ReactNode {
  const record = useRecordContext<Reference>();
  if (!record) return null;
  return <TasksTab targetType="reference" targetId={record.id} />;
}

export function ReferenceActivityTab(): ReactNode {
  const record = useRecordContext<Reference>();
  if (!record) return null;
  return <ActivityTab targetType="reference" targetId={record.id} />;
}
