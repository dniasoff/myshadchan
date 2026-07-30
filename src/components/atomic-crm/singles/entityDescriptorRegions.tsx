import type { ReactNode } from "react";
import { useRecordContext } from "ra-core";

import { EditButton } from "@/components/admin/edit-button";

import { ActivityTab } from "../entity360/tabs/ActivityTab";
import { FilesTab } from "../entity360/tabs/FilesTab";
import { NotesTab } from "../entity360/tabs/NotesTab";
import { RelatedRecordsTab } from "../entity360/tabs/RelatedRecordsTab";
import { TasksTab } from "../entity360/tabs/TasksTab";
import type { EntityRelationshipDescriptor } from "../entity360/relationshipDescriptor";
import { TopToolbar } from "../layout/TopToolbar";
import { PhotoTabContent } from "../resumes/PhotoTab";
import { ResumeUpload } from "../resumes/ResumeUpload";
import { ResumeVersionList } from "../resumes/ResumeVersionList";
import type { Single } from "../types";
import { SingleLoginInvite } from "./SingleLoginInvite";
import { SingleProfileHeader } from "./SingleProfileHeader";

/**
 * The region/tab adapters `singles/entityDescriptor.tsx` assembles into
 * `singlesDescriptor` (Story 5.8, AC 6/7/8/9). Split into their own module
 * because they are React components and `entityDescriptor.tsx`'s other
 * export, `singlesDescriptor`, is not — `react-refresh/only-export-
 * components` flags a file that mixes the two, exactly like
 * `shidduchim/entityDescriptorRegions.tsx`.
 */

/**
 * The `identityHeader` region: a one-line adapter over `SingleProfileHeader`
 * (AC 9) — `{ single: Single }` does not fit `ComponentType<{ record: T }>`
 * (`entityDescriptor.ts`).
 */
export const SingleIdentityHeader = ({ record }: { record: Single }) => (
  <SingleProfileHeader single={record} />
);

/**
 * The `actions` region: preserves the one affordance the deleted routed
 * record page carried in its own action bar — an `EditButton` back to
 * `/singles/{id}/edit` — rendered INSIDE the identity header, immediately
 * after it (contract §2 rule 2), exactly like `shidduchim/
 * entityDescriptorRegions.tsx`'s own `ShidduchActions`.
 *
 * Story 6.1 (AC-1) adds `SingleLoginInvite` as a sibling action — the one
 * entry point that gives this single their own login. It owns its own
 * role/link-state gating (renders nothing, the button, or the linked
 * indicator) — this component stays a thin composition, matching
 * `entityDescriptorRegions.tsx`'s own "thin adapter list" convention.
 */
export const SingleActions = ({ record }: { record: Single }) => (
  <TopToolbar>
    <SingleLoginInvite single={record} />
    <EditButton />
  </TopToolbar>
);

/**
 * The `resume` tab (AC 3): reuses Story 5.3's `ResumeUpload`/
 * `ResumeVersionList` with a `{ singleId }` subject — the single, shared
 * implementation those components already accept, no new upload or
 * version-list code.
 */
export function SingleResumeTab(): ReactNode {
  const record = useRecordContext<Single>();
  if (!record) return null;

  return (
    <div className="flex flex-col gap-4">
      <ResumeUpload singleId={record.id} />
      <ResumeVersionList singleId={record.id} />
    </div>
  );
}

/**
 * The `photo` tab (AC 3): reuses Story 5.4's `PhotoTabContent` directly with
 * a `{ singleId }` subject — `PhotoTab` itself stays the shidduch-only
 * arity-zero wrapper; this is the single-side sibling call site.
 */
export function SinglePhotoTab(): ReactNode {
  const record = useRecordContext<Single>();
  if (!record) return null;

  return <PhotoTabContent subject={{ singleId: record.id }} />;
}

/**
 * AC 8: the worked `relationshipDescriptor.ts` example for this exact case
 * — `resource` IS the link target (a plain FK), so no `linkResource`/
 * `linkId` is needed. Declared as an explicit `tabs` entry rendering
 * `<RelatedRecordsTab/>` (below), NOT as a `relationships` entry —
 * `mergeEntityTabs` appends every relationship-derived tab AFTER every
 * explicit `tabs` entry, which would render Shidduchim last instead of at
 * its canonical position 5.
 *
 * **Review fix.** `relationshipDescriptor.ts`'s worked example says no
 * `linkLabel` is needed when `resource` IS the link target — true only when
 * that resource has a `recordRepresentation`. `shidduchim/index.ts` (unlike
 * `singles`/`shadchanim`/`references`/`members`) declares none, so without
 * `linkLabel` each row falls back to ra-core's bare `#{id}` — a functioning
 * link to an unreadable label. `RelatedRecordsTab.tsx` reads
 * `relationship.linkLabel?.(row) ?? getRecordRepresentation(row)`, so this
 * is a purely additive, in-scope fix: `resource: "shidduchim"` resolves
 * (both live and FakeRest) through `shidduchim_summary`, whose own display
 * convention (`ShidduchCard.tsx`) is `name_en ?? single_first_name_en`.
 */
const singleShidduchimRelationship: EntityRelationshipDescriptor = {
  key: "shidduchim",
  resource: "shidduchim",
  getFilter: (record) => ({ single_id: record.id }),
  linkLabel: (row) => row.name_en ?? row.single_first_name_en ?? `#${row.id}`,
};

export function SingleShidduchimTab(): ReactNode {
  return <RelatedRecordsTab relationship={singleShidduchimRelationship} />;
}

/**
 * `render` is arity-zero (contract §2 rule 4) — these four thin wrappers
 * reach the record via `useRecordContext()` rather than a typed prop,
 * exactly like `shidduchim/entityDescriptorRegions.tsx`'s own universal-tab
 * adapters.
 */
export function SingleFilesTab(): ReactNode {
  const record = useRecordContext<Single>();
  if (!record) return null;
  return <FilesTab targetType="single" targetId={record.id} />;
}

export function SingleNotesTab(): ReactNode {
  const record = useRecordContext<Single>();
  if (!record) return null;
  return <NotesTab targetType="single" targetId={record.id} />;
}

export function SingleTasksTab(): ReactNode {
  const record = useRecordContext<Single>();
  if (!record) return null;
  return <TasksTab targetType="single" targetId={record.id} />;
}

export function SingleActivityTab(): ReactNode {
  const record = useRecordContext<Single>();
  if (!record) return null;
  return <ActivityTab targetType="single" targetId={record.id} />;
}
