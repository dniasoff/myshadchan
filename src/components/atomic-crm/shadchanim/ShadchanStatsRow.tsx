import type { Identifier } from "ra-core";
import { useGetOne } from "ra-core";

import { StatStrip } from "../dashboard/StatStrip";
import type { ShadchanStats } from "../types";

export interface ShadchanStatsRowProps {
  shadchanId: Identifier;
}

/**
 * Productivity strip (E5, extracted from `ShadchanShow.tsx` for the
 * mobile-redesign-plan.md §4 S-B density pass) — reads the `shadchan_stats`
 * view (one row per shadchan) and renders three calm counts in a single
 * `StatStrip` rather than three stacked `DashboardStat` tiles (482px of a
 * 1,189px page down to one 90px/74px band). The totals agree with
 * "Shidduchim from this shadchan" below, which filters shidduchim on the
 * same shadchan_id. Zero-state simply shows 0s.
 */
export const ShadchanStatsRow = ({ shadchanId }: ShadchanStatsRowProps) => {
  const { data, isPending } = useGetOne<ShadchanStats>("shadchan_stats", {
    id: shadchanId,
  });

  if (isPending) {
    return (
      <div className="h-[90px] animate-pulse rounded-2xl bg-muted md:h-[74px]" />
    );
  }

  return (
    <StatStrip
      items={[
        { label: "Shidduchim", value: data?.nb_suggestions ?? 0 },
        { label: "Progressed", value: data?.nb_progressed ?? 0 },
        { label: "Reached yes", value: data?.nb_reached_yes ?? 0 },
      ]}
    />
  );
};
