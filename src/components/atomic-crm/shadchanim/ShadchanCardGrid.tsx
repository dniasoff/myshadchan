import type { RaRecord } from "ra-core";
import { useGetList } from "ra-core";

import type { Shadchan, ShidduchSummary } from "../types";
import { ShadchanCard } from "./ShadchanCard";
import { countSuggestionsByShadchan } from "./shadchanUtils";

/**
 * Review fix (F6): extracted out of `ShadchanList.tsx`, mirroring
 * `singles/SingleCardGrid.tsx`. AC-1's own falsification check
 * (`grep -n "Skeleton\|EmptyState" singles/SingleList.tsx
 * shadchanim/ShadchanList.tsx`) named this exact identifier, still defined
 * inline in `ShadchanList.tsx`, as a failing match — Task 6 renamed
 * `ShadchanGridSkeleton` to satisfy AC-7 but never extracted it the way
 * Task 5 did for singles, leaving the two lists asymmetric. The *state
 * decision* (loading/empty/error/ready) still belongs to `EntityListView`
 * (Story 4.1); this file is only the card-grid markup and its
 * `shidduchim`-count enrichment.
 */
export const ShadchanCardGridSkeleton = () => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 3 }).map((_, index) => (
      <div
        key={index}
        className="h-[126px] animate-pulse rounded-2xl bg-muted"
      />
    ))}
  </div>
);

export interface ShadchanCardGridProps {
  data: RaRecord[];
}

/**
 * `EntityList`'s `renderItems` for the shadchan book (§5's screen 19). Owns
 * the per-shadchan suggestion-count enrichment: one account-wide
 * `shidduchim` query, grouped client-side (no `shadchanim`-level aggregate
 * view exists yet, and a per-card query would be an N+1 — screens-plan
 * Lane 4 risk note). Unrelated to list chrome (AC 1) — kept here, not in
 * `EntityList`.
 *
 * Review fix (F5): the pre-story `ShadchanDirectory` gated its skeleton on
 * `shadchanimPending || shidduchimPending` — the retrofit dropped the
 * second half, so a card rendered the instant the `shadchanim` list
 * resolved even while the `shidduchim` count query was still in flight,
 * flashing a wrong "0 suggestions" on every card. `renderItems` only runs
 * once `EntityListView`'s own state machine has already decided `"ready"`
 * for the `shadchanim` list (so `shadchanimPending` is always false here),
 * but the nested `shidduchim` fetch below is independent of that decision
 * and needs its own gate.
 */
export const ShadchanCardGrid = ({ data }: ShadchanCardGridProps) => {
  const shadchanim = data as Shadchan[];
  const { data: shidduchim, isPending: shidduchimPending } =
    useGetList<ShidduchSummary>("shidduchim", {
      pagination: { page: 1, perPage: 500 },
      sort: { field: "id", order: "ASC" },
    });

  if (shidduchimPending) {
    return <ShadchanCardGridSkeleton />;
  }

  const counts = countSuggestionsByShadchan(shidduchim ?? []);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {shadchanim.map((shadchan, index) => (
        <ShadchanCard
          key={shadchan.id}
          shadchan={shadchan}
          suggestionCount={counts.get(shadchan.id) ?? 0}
          index={index}
        />
      ))}
    </div>
  );
};
