import { useState } from "react";
import { useListContext } from "ra-core";

import { buildNewPath } from "../entity360/entityPaths";
import type { EmptyStateProps } from "../misc/EmptyState";
import { EmptyState } from "../misc/EmptyState";
import { EntityListView } from "../misc/EntityListView";
import type { PipelineState, ShidduchSummary } from "../types";
import { getShidduchimByState } from "./boardUtils";
import { PipelineJumpBar } from "./PipelineJumpBar";
import { PipelineSection } from "./PipelineSection";
import { PIPELINE_STATES } from "./pipelineStates";
import { ShidduchMoveSheet } from "./ShidduchMoveSheet";
import { ShidduchRowSkeleton } from "./ShidduchRow";

export interface ShidduchimPipelineListProps {
  view: "list" | "cards";
}

/**
 * Review fix F7: `EntityListView`'s `emptyState` prop is required but
 * provably unreachable here — see `ShidduchimPipelineList`'s own doc comment
 * ("AC-7's 'pipeline is empty' EmptyState is decided HERE") — yet it used to
 * be a second, hand-written copy of the exact literal the early return below
 * renders. Two copies of the same literal drift; one shared constant, read
 * from both call sites, cannot.
 */
const PIPELINE_EMPTY_STATE: EmptyStateProps = {
  title: "No redts yet",
  description:
    "Every suggestion for this single will show up here, grouped by stage.",
  actionLabel: "Add a redt",
  actionTo: `${buildNewPath("shidduchim")}?state=new`,
};

/** AC-13: assembled from the same section/row primitives the loaded content
 * renders, so loading height equals loaded height by construction. */
export const PipelineListSkeleton = () => (
  <div className="flex flex-col gap-6">
    {PIPELINE_STATES.map((state) => (
      <div
        key={state.value}
        data-slot="pipeline-section"
        className="flex flex-col"
      >
        <div className="flex items-center gap-2 border-b px-1 py-2">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 animate-pulse rounded-full bg-muted"
          />
          <span className="h-4 w-20 animate-pulse rounded bg-muted" />
        </div>
        <div className="flex flex-col divide-y">
          <ShidduchRowSkeleton />
          <ShidduchRowSkeleton />
        </div>
      </div>
    ))}
  </div>
);

/**
 * The List/Cards pipeline sub-view (Task 4): one section per
 * `PIPELINE_STATES` entry, a jump bar above them, and the Move sheet a row's
 * `⇄ Move` button opens. Wired through `EntityListView` directly (not the
 * `<EntityList>` wrapper — there is already an enclosing `<List>` in
 * `ShidduchimList.tsx`; a second one would double-fetch, AC-6).
 *
 * AC-7's "pipeline is empty" EmptyState is decided HERE, not by
 * `EntityListView`'s own generic empty/no-matches split: this list's
 * `<List filterDefaultValues={{ single_id }}>` means `filterValues` always
 * carries `single_id`, so the shared `useEntityListStatus()` hook can never
 * return `"empty"` for this resource — it would always fall through to
 * `"no-matches"`. Checking `data.length === 0 && !filterValues.q` directly
 * is what makes the true zero-shidduchim case render the rich, actionable
 * EmptyState instead of a bare "no matches" paragraph, while a genuine
 * zero-result search still reaches `EntityListView`'s own "no matches" text.
 */
export const ShidduchimPipelineList = ({
  view,
}: ShidduchimPipelineListProps) => {
  const { data, filterValues } = useListContext<ShidduchSummary>();
  const [moveTarget, setMoveTarget] = useState<ShidduchSummary | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const shidduchim = (data ?? []) as ShidduchSummary[];
  const hasSearchTerm = Boolean(
    (filterValues as Record<string, unknown> | undefined)?.q,
  );
  const isPipelineEmpty = shidduchim.length === 0 && !hasSearchTerm;

  const openMoveSheetFor = (shidduch: ShidduchSummary) => {
    setMoveTarget(shidduch);
    setSheetOpen(true);
  };

  if (isPipelineEmpty) {
    return <EmptyState {...PIPELINE_EMPTY_STATE} />;
  }

  const byState = getShidduchimByState(shidduchim);
  const counts = PIPELINE_STATES.reduce<Partial<Record<PipelineState, number>>>(
    (acc, state) => ({
      ...acc,
      [state.value]: byState[state.value]?.length ?? 0,
    }),
    {},
  );

  const renderSections = (variant: "list" | "cards") => (
    <div className="flex flex-col gap-6">
      {PIPELINE_STATES.map((state, index) => (
        <PipelineSection
          key={state.value}
          state={state}
          shidduchim={byState[state.value] ?? []}
          variant={variant}
          onMove={openMoveSheetFor}
          tourAnchor={index === 0}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <PipelineJumpBar counts={counts} />
      <EntityListView
        resource="shidduchim"
        viewMode={view}
        skeleton={<PipelineListSkeleton />}
        emptyState={PIPELINE_EMPTY_STATE}
        noMatchesMessage="No shidduchim match this search."
        renderList={() => renderSections("list")}
        renderCards={() => renderSections("cards")}
      />
      <ShidduchMoveSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        id={moveTarget?.id ?? 0}
        currentState={moveTarget?.pipeline_state ?? "new"}
        name={moveTarget?.name_en}
      />
    </div>
  );
};
