import { useListContext } from "ra-core";
import { Link } from "react-router";

import { List } from "@/components/admin/list";
import { Skeleton } from "@/components/ui/skeleton";

import { EmptyState } from "../misc/EmptyState";
import type { Child } from "../types";
import { ChildCard } from "./ChildCard";

const ChildListSkeleton = () => (
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

const ChildListHeader = () => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Family roster
      </p>
      <h1 className="font-display text-2xl font-bold tracking-tight">
        Children
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every single you are redting for, each with their own pipeline.
      </p>
    </div>
    <Link
      to="/children/create"
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
      Add a child
    </Link>
  </div>
);

const ChildListContent = () => {
  const { data, isPending } = useListContext<Child>();

  return (
    <div>
      <ChildListHeader />
      {isPending ? (
        <ChildListSkeleton />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Add your first child"
          description="A shidduchim pipeline belongs to a child — the single you are redting for. Add a child to start tracking suggestions."
          actionLabel="Add a child"
          actionTo="/children/create"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((child, index) => (
            <ChildCard key={child.id} child={child} index={index} />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * The children roster (screen 32): a card grid, not a table — the family's
 * children are few, and each deserves a humane presence, not a datagrid row.
 * The default admin title/actions row is suppressed (`title={false}`,
 * `actions={<></>}`); this builds its own QL header with a single gradient
 * primary CTA instead of the plain admin `CreateButton`.
 */
export const ChildList = () => (
  <List
    title={false}
    actions={<></>}
    perPage={100}
    pagination={null}
    sort={{ field: "first_name_en", order: "ASC" }}
  >
    <ChildListContent />
  </List>
);
