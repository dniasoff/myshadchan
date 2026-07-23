import { Plus } from "lucide-react";
import { useGetList, useListContext } from "ra-core";
import { Link } from "react-router";

import { List } from "@/components/admin/list";

import { TopToolbar } from "../layout/TopToolbar";
import { EmptyState } from "../misc/EmptyState";
import type { Shadchan, ShidduchSummary } from "../types";
import { ShadchanCard } from "./ShadchanCard";
import { countSuggestionsByShadchan } from "./shadchanUtils";

/**
 * The shadchan book (§5's screen 19): the account-wide directory of
 * matchmakers, one calm card per shadchan. The per-card suggestion count
 * comes from a single account-wide `shidduchim` query grouped client-side
 * (no `shadchanim`-level aggregate view exists yet, and a per-card query
 * would be an N+1 — screens-plan Lane 4 risk note).
 */

const AddShadchanButton = () => (
  <Link
    to="/shadchanim/create"
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
    <Plus className="size-4" aria-hidden="true" />
    Add a shadchan
  </Link>
);

const ShadchanListActions = () => (
  <TopToolbar>
    <AddShadchanButton />
  </TopToolbar>
);

const ShadchanGridSkeleton = () => (
  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 3 }).map((_, index) => (
      <div key={index} className="h-[126px] animate-pulse rounded-2xl bg-muted" />
    ))}
  </div>
);

const ShadchanDirectory = () => {
  const { data: shadchanim, isPending: shadchanimPending } =
    useListContext<Shadchan>();
  const { data: shidduchim, isPending: shidduchimPending } =
    useGetList<ShidduchSummary>("shidduchim", {
      pagination: { page: 1, perPage: 500 },
      sort: { field: "id", order: "ASC" },
    });

  const isPending = shadchanimPending || shidduchimPending;
  const counts = countSuggestionsByShadchan(shidduchim ?? []);

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Matchmaker book
      </p>
      <h1 className="font-display text-2xl font-bold tracking-tight">
        Shadchanim
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every matchmaker your family has worked with, in one calm book.
      </p>

      {isPending ? (
        <ShadchanGridSkeleton />
      ) : !shadchanim || shadchanim.length === 0 ? (
        <EmptyState
          title="Add your first shadchan"
          description="Every redt comes from somewhere — keep a book of the matchmakers your family works with."
          actionLabel="Add a shadchan"
          actionTo="/shadchanim/create"
          className="py-14"
        />
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shadchanim.map((shadchan, index) => (
            <ShadchanCard
              key={shadchan.id}
              shadchan={shadchan}
              suggestionCount={counts.get(shadchan.id) ?? 0}
              index={index}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const ShadchanList = () => (
  <List
    title={false}
    actions={<ShadchanListActions />}
    perPage={200}
    pagination={null}
    sort={{ field: "name", order: "ASC" }}
  >
    <ShadchanDirectory />
  </List>
);
