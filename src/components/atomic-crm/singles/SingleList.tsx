import type { Identifier } from "ra-core";
import { useGetList, useListContext } from "ra-core";
import { useMemo } from "react";
import { Link } from "react-router";

import { List } from "@/components/admin/list";
import { Skeleton } from "@/components/ui/skeleton";

import { EmptyState } from "../misc/EmptyState";
import type { Single, SingleSummary } from "../types";
import { SingleCard } from "./SingleCard";

const SingleListSkeleton = () => (
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

const SingleListHeader = () => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Family roster
      </p>
      <h1 className="font-display text-2xl font-bold tracking-tight">
        Singles
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every single you are redting for, each with their own pipeline.
      </p>
    </div>
    <Link
      to="/singles/create"
      className="inline-flex h-11 items-center gap-2 rounded-xl px-4
        font-semibold text-primary-foreground
        bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))]
        shadow-sm shadow-[0_8px_24px_-6px_var(--glow-accent)]
        transition-[transform,box-shadow] duration-[160ms] ease-[--ease-spring]
        hover:shadow-[0_10px_30px_-6px_var(--glow-accent-strong)]
        active:scale-[0.97]
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        focus-visible:ring-offset-background outline-none"
    >
      Add a single
    </Link>
  </div>
);

const SingleListContent = () => {
  const { data, isPending } = useListContext<Single>();
  // Per-single pipeline counts (E6) come from the singles_summary view, fetched
  // alongside the roster so the list resource (and its breadcrumb) stays the
  // plain `singles`. Keyed by single id; a single with no summary row just has
  // no count. The roster is small (perPage 100), so a single 500-row read
  // covers it.
  const { data: summaries } = useGetList<SingleSummary>("singles_summary", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "id", order: "ASC" },
  });
  const openCountById = useMemo(() => {
    const map = new Map<Identifier, number>();
    (summaries ?? []).forEach((summary) =>
      map.set(summary.id, summary.open_shidduchim),
    );
    return map;
  }, [summaries]);

  return (
    <div>
      <SingleListHeader />
      {isPending ? (
        <SingleListSkeleton />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Add your first single"
          description="A shidduchim pipeline belongs to a single — the person you are redting for. Add a single to start tracking suggestions."
          actionLabel="Add a single"
          actionTo="/singles/create"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((single, index) => (
            <SingleCard
              key={single.id}
              single={single}
              index={index}
              openCount={openCountById.get(single.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * The singles roster (screen 32): a card grid, not a table — the family's
 * singles are few, and each deserves a humane presence, not a datagrid row.
 * The default admin title/actions row is suppressed (`title={false}`,
 * `actions={<></>}`); this builds its own QL header with a single gradient
 * primary CTA instead of the plain admin `CreateButton`. Pipeline counts (E6)
 * are joined in by SingleListContent from the singles_summary view.
 */
export const SingleList = () => (
  <List
    title={false}
    actions={<></>}
    perPage={100}
    pagination={null}
    sort={{ field: "first_name_en", order: "ASC" }}
  >
    <SingleListContent />
  </List>
);
