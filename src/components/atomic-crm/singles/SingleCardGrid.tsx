import type { Identifier, RaRecord } from "ra-core";
import { useGetList, useListContext } from "ra-core";
import { useMemo } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import type { Single, SingleSummary } from "../types";
import { SingleCard } from "./SingleCard";

/**
 * Today's `SingleList.tsx`'s `SingleListSkeleton` markup, moved verbatim
 * (AC 7 deletes that name — see `LSP workspaceSymbol`). A card-grid shape,
 * entity-specific: the state DECISION (loading/empty/error/ready) belongs
 * to `EntityListView` (Story 4.1); this is only the loading markup.
 */
export const SingleCardGridSkeleton = () => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 3 }).map((_, index) => (
      <div key={index} className="rounded-xl border p-5">
        <div className="flex items-start gap-3.5">
          <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <div className="mt-4 border-t pt-3">
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      </div>
    ))}
  </div>
);

export interface SingleCardGridProps {
  data: RaRecord[];
}

/**
 * `EntityList`'s `renderItems` for the singles roster (screen 32). Owns the
 * per-single pipeline-count enrichment (E6): a single account-wide
 * `singles_summary` read, joined by id, so the grid never fires one query
 * per card. Unrelated to list chrome (AC 1) — kept here, not in `EntityList`.
 */
export const SingleCardGrid = ({ data }: SingleCardGridProps) => {
  const singles = data as Single[];
  const { filterValues } = useListContext();
  // The roster is small (perPage 100), so a single 500-row read covers it.
  const { data: summaries } = useGetList<SingleSummary>("singles_summary", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "id", order: "ASC" },
    filter: filterValues,
  });
  const openCountById = useMemo(() => {
    const map = new Map<Identifier, number>();
    (summaries ?? []).forEach((summary) =>
      map.set(summary.id, summary.open_shidduchim),
    );
    return map;
  }, [summaries]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {singles.map((single, index) => (
        <SingleCard
          key={single.id}
          single={single}
          index={index}
          openCount={openCountById.get(single.id)}
        />
      ))}
    </div>
  );
};
