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
  renderItems: (data: RaRecord[]) => ReactNode;
}

/**
 * The four-state list body (AC 1, AC 6): loading / error / empty /
 * no-matches / ready, decided once by `useEntityListStatus` and never
 * re-derived here. Pure render — no data-provider calls, and no pagination,
 * sort, or search UI (that is `EntityList`'s job, Task 3). Exactly one
 * branch below renders per call.
 */
export const EntityListView = ({
  skeleton,
  emptyState,
  noMatchesMessage,
  renderItems,
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

  return <>{renderItems(status.data)}</>;
};
