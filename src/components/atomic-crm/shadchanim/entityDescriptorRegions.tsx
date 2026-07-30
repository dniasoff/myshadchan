import type { ReactNode } from "react";
import { useRecordContext } from "ra-core";

import { EditButton } from "@/components/admin/edit-button";

import { ActivityTab } from "../entity360/tabs/ActivityTab";
import { NotesTab } from "../entity360/tabs/NotesTab";
import { TasksTab } from "../entity360/tabs/TasksTab";
import { TopToolbar } from "../layout/TopToolbar";
import type { Shadchan } from "../types";
import { ShadchanHeader } from "./ShadchanHeader";
import { ShadchanStatsRow } from "./ShadchanStatsRow";
import { ShadchanSuggestions } from "./ShadchanSuggestions";

/**
 * The region/tab adapters `shadchanim/entityDescriptor.tsx` assembles into
 * `shadchanimDescriptor` (Story 5.9). Split into their own module because
 * they are React components and `entityDescriptor.tsx`'s other export,
 * `shadchanimDescriptor`, is not — `react-refresh/only-export-components`
 * flags a file that mixes the two, exactly like
 * `shidduchim/entityDescriptorRegions.tsx` / `singles/entityDescriptorRegions.tsx`.
 */

/**
 * The `identityHeader` region: a one-line adapter over `ShadchanHeader` —
 * `{ shadchan: Shadchan }` does not fit `ComponentType<{ record: T }>`
 * (`entity360/entityDescriptor.ts`). `ShadchanHeader`'s own body is reused
 * unchanged; only its notes block is gone, in the same diff that dropped
 * `shadchanim.notes` (Task 2).
 */
export const ShadchanIdentityHeader = ({ record }: { record: Shadchan }) => (
  <ShadchanHeader shadchan={record} />
);

/**
 * The `statBand` region: a one-line adapter over `ShadchanStatsRow`, whose
 * own prop is deliberately an id (`{ shadchanId }`), not a record — it does
 * its own `useGetOne("shadchan_stats", …)`. Untouched otherwise: its three
 * existing tiles are not where RULING 8's two new columns render (the
 * Overview tab is).
 */
export const ShadchanStatBand = ({ record }: { record: Shadchan }) => (
  <ShadchanStatsRow shadchanId={record.id} />
);

/**
 * The `actions` region: rendered INSIDE the identity header, immediately
 * after it (contract §2 rule 2) — the one affordance the deleted
 * `ShadchanShow.tsx` carried in its own action bar.
 */
export const ShadchanActions = () => (
  <TopToolbar>
    <EditButton />
  </TopToolbar>
);

/**
 * The `shidduchim` tab: `ShadchanSuggestions.tsx`, structurally unchanged
 * (already `RecordLink`-based post-3.9, its own AD-23 label sweep already
 * done by wave S). Deliberately NOT `RelatedRecordsTab` — see
 * `entityDescriptor.tsx`'s doc comment for why this entity keeps the richer,
 * purpose-built component instead.
 */
export function ShadchanShidduchimTab(): ReactNode {
  const record = useRecordContext<Shadchan>();
  if (!record) return null;
  return <ShadchanSuggestions shadchanId={record.id} />;
}

/**
 * `render` is arity-zero (contract §2 rule 4) — these three thin wrappers
 * reach the record via `useRecordContext()` rather than a typed prop,
 * exactly like `shidduchim/entityDescriptorRegions.tsx` / `singles/
 * entityDescriptorRegions.tsx`'s own universal-tab adapters. `targetType`/
 * `targetId`, camelCase — never the DB's `target_type`.
 */
export function ShadchanNotesTab(): ReactNode {
  const record = useRecordContext<Shadchan>();
  if (!record) return null;
  return <NotesTab targetType="shadchan" targetId={record.id} />;
}

export function ShadchanTasksTab(): ReactNode {
  const record = useRecordContext<Shadchan>();
  if (!record) return null;
  return <TasksTab targetType="shadchan" targetId={record.id} />;
}

export function ShadchanActivityTab(): ReactNode {
  const record = useRecordContext<Shadchan>();
  if (!record) return null;
  return <ActivityTab targetType="shadchan" targetId={record.id} />;
}
