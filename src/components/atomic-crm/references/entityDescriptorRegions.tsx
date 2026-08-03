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
import { ReferenceAttachToShidduch } from "./ReferenceAttachToShidduch";
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
 *
 * **Review fix.** Task 6's own text (subtask 2) names this exact call site —
 * "reused by the 360 … render it in the reference's actions region when
 * `useReferenceLinks(record.id).links.length === 0`, and only then" — as
 * the second and last place `ReferenceAttachToShidduch` is ever rendered.
 * That wiring was missing: an orphan reference opened at its own 360 had no
 * way to fix its own orphan-ness short of navigating back to the unattached-
 * references index (`ReferencesIndex.tsx`). `useReferenceLinks` is already
 * imported in this module for the two tab adapters below, so this reuses the
 * same query rather than issuing a second one.
 */
export const ReferenceActions = ({ record }: { record: Reference }) => {
  const { links, isPending } = useReferenceLinks(record.id);

  return (
    <TopToolbar>
      {!isPending && links.length === 0 && (
        <ReferenceAttachToShidduch
          referenceId={record.id}
          referenceName={record.name_en}
        />
      )}
      <EditButton />
      <ReferenceMergeButton />
    </TopToolbar>
  );
};

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
 *
 * **Review fix.** `shidduchim.name_en` is nullable and `shidduchim/index.ts`
 * declares no `recordRepresentation`, so a null `shidduch_name_en` fell
 * through to ra-core's default representation of the QUERIED row — the
 * `reference_links_summary` link row, not the shidduch — rendering the
 * unrelated link id (`#<link-id>`) as the label. Same defect Story 5.8's own
 * review fix closed for `singles/entityDescriptorRegions.tsx`'s identical
 * `shidduchim` relationship, with the identical fallback field
 * (`single_first_name_en`) available on this same view. The id fallback
 * must be `row.shidduchim_id` (the link target), not `row.id` (the link
 * row) — singles's `#${row.id}` works only because `resource` there IS
 * `shidduchim` itself.
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
  linkLabel: (row) =>
    row.shidduch_name_en ?? row.single_first_name_en ?? `#${row.shidduchim_id}`,
};

export function ReferenceShidduchimTab(): ReactNode {
  return <RelatedRecordsTab relationship={referenceShidduchim} />;
}

/**
 * The `assistant` tab: unchanged content (`ResearchAssistantPanel`), still
 * AI-entitlement-gated inside that component.
 */
export function ReferenceAssistantTab(): ReactNode {
  const record = useRecordContext<Reference>();
  if (!record) return null;
  return <ResearchAssistantPanel reference={record} />;
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
