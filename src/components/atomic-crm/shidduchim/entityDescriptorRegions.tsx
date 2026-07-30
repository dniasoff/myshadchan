import type { ReactNode } from "react";
import { useGetList, useRecordContext } from "ra-core";

import { ActivityTab } from "../entity360/tabs/ActivityTab";
import { NotesTab } from "../entity360/tabs/NotesTab";
import { TasksTab } from "../entity360/tabs/TasksTab";
import { ShidduchReferencesSection } from "../references/ShidduchReferencesSection";
import type { Shadchan, ShidduchSummary } from "../types";
import { ShidduchShowHeader } from "./ShidduchShowHeader";
import { ShidduchStateControl } from "./ShidduchStateControl";

/**
 * The region/tab adapters `shidduchim/entityDescriptor.tsx` assembles into
 * `shidduchimDescriptor` (Story 5.1 AC 6). Split into their own module
 * because they are React components and `entityDescriptor.tsx`'s other
 * export, `shidduchimDescriptor`, is not — `react-refresh/only-export-
 * components` flags a file that mixes the two, whether or not the
 * component side is itself exported.
 */

/**
 * The `identityHeader` region. `ShidduchShowHeader` takes
 * `{ shidduch, firstSuggestedByName }`, not `{ record }` — this adapter
 * resolves the one extra prop (AC 6): `firstSuggestedByName` needs the
 * `shadchanim` list the old `ShidduchShowContent` also fetched for its
 * `shadchanName` lookup. React Query dedupes the identical query key this
 * shares with `ShidduchOverviewTab`'s own `shadchanim` fetch, so this is
 * one request, not two.
 */
export const ShidduchIdentityHeader = ({
  record,
}: {
  record: ShidduchSummary;
}) => {
  const { data: shadchanim } = useGetList<Shadchan>("shadchanim", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "name", order: "ASC" },
  });
  const firstSuggestedByName = record.first_suggested_by
    ? (shadchanim?.find((shadchan) => shadchan.id === record.first_suggested_by)
        ?.name ?? "Unknown shadchan")
    : null;

  return (
    <ShidduchShowHeader
      shidduch={record}
      firstSuggestedByName={firstSuggestedByName}
    />
  );
};

/**
 * The `actions` region — rendered by `EntityShow` inside `identityHeader`,
 * immediately after it (contract §2 rule 2), so the pipeline-transition UI
 * stays reachable from every tab, exactly as it was on the routed dialog.
 */
export const ShidduchActions = ({ record }: { record: ShidduchSummary }) => (
  <ShidduchStateControl
    id={record.id}
    currentState={record.pipeline_state}
    name={record.name_en}
  />
);

/**
 * `render` is arity-zero (contract §2 rule 4) — each of these four thin
 * wrappers reaches the record via `useRecordContext()` rather than a typed
 * prop, exactly like `ShidduchOverviewTab` itself.
 */
export function ShidduchDiligenceTab(): ReactNode {
  const record = useRecordContext<ShidduchSummary>();
  if (!record) return null;
  return <ShidduchReferencesSection shidduchimId={record.id} />;
}

export function ShidduchNotesTab(): ReactNode {
  const record = useRecordContext<ShidduchSummary>();
  if (!record) return null;
  return <NotesTab targetType="shidduch" targetId={record.id} />;
}

export function ShidduchTasksTab(): ReactNode {
  const record = useRecordContext<ShidduchSummary>();
  if (!record) return null;
  return <TasksTab targetType="shidduch" targetId={record.id} />;
}

export function ShidduchActivityTab(): ReactNode {
  const record = useRecordContext<ShidduchSummary>();
  if (!record) return null;
  return <ActivityTab targetType="shidduch" targetId={record.id} />;
}
