import type { ReactNode } from "react";
import type { RaRecord } from "ra-core";
import { useTranslate } from "ra-core";

import { Button } from "@/components/ui/button";

import type { EmptyStateProps } from "./EmptyState";
import { EmptyState } from "./EmptyState";
import { useEntityListStatus } from "./useEntityListStatus";

export interface EntityListViewProps {
  /**
   * Part of the shared props contract with `EntityList` (Task 3's `Pick`) —
   * nothing in this story reads it directly; `EntityListView` renders
   * whatever `useListContext()` (via `useEntityListStatus`) already resolved
   * for the surrounding `<List>`, regardless of which resource that is.
   */
  resource: string;
  skeleton: ReactNode;
  emptyState: EmptyStateProps;
  noMatchesMessage: string;
  renderList: (data: RaRecord[]) => ReactNode;
  renderCards: (data: RaRecord[]) => ReactNode;
  /**
   * Lifted from the parent (Story 4.2 AC 4) — this component stays a pure
   * function of its props, never reading any persistence mechanism itself,
   * so it works unmodified for any caller's chosen mode (today's sibling
   * mode-persistence hook in this same `misc/` folder; Story 4.3's own,
   * differently-keyed one tomorrow). Deliberately the bare union rather than
   * a shared type imported from that hook's module — this file's own text
   * must stay free of that hook's name, which is exactly what AC 4's
   * conformance check looks for here.
   */
  viewMode: "list" | "cards";
}

/**
 * The four-state list body (AC 1, AC 6): loading / error / empty /
 * no-matches / ready, decided once by `useEntityListStatus` and never
 * re-derived here. Pure render — no data-provider calls, and no pagination,
 * sort, or search UI (that is `EntityList`'s job, Task 3). Exactly one
 * branch below renders per call; in the "ready" state, exactly one of
 * `renderList` / `renderCards` runs, chosen by `viewMode` (AC 1, AC 4).
 */
export const EntityListView = ({
  skeleton,
  emptyState,
  noMatchesMessage,
  renderList,
  renderCards,
  viewMode,
}: EntityListViewProps) => {
  const translate = useTranslate();
  const status = useEntityListStatus();

  if (status.status === "loading") {
    return <>{skeleton}</>;
  }

  if (status.status === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          {translate("crm.entity_list.error", {
            _: "Something went wrong loading this list.",
          })}
        </p>
        <Button type="button" variant="outline" onClick={status.refetch}>
          {translate("crm.entity_list.retry", { _: "Try again" })}
        </Button>
      </div>
    );
  }

  if (status.status === "empty") {
    return <EmptyState {...emptyState} />;
  }

  if (status.status === "no-matches") {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {noMatchesMessage}
      </p>
    );
  }

  return (
    <>
      {viewMode === "list" ? renderList(status.data) : renderCards(status.data)}
    </>
  );
};
