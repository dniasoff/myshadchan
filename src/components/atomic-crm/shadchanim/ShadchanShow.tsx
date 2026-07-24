import type { Identifier } from "ra-core";
import { useGetOne, useRecordContext } from "ra-core";
import { Heart, Sparkles, TrendingUp } from "lucide-react";

import { EditButton } from "@/components/admin/edit-button";
import { Show } from "@/components/admin/show";

import { DashboardStat } from "../dashboard/DashboardStat";
import { TopToolbar } from "../layout/TopToolbar";
import type { Shadchan, ShadchanStats } from "../types";
import { ShadchanHeader } from "./ShadchanHeader";
import { ShadchanSuggestions } from "./ShadchanSuggestions";

/**
 * The shadchan detail page (screen 20) — contact info, productivity stats, and
 * every suggestion this matchmaker has sent, across every child.
 */

const ShadchanShowSkeleton = () => (
  <div className="flex flex-col gap-4">
    <div className="h-[132px] animate-pulse rounded-2xl bg-muted" />
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-[116px] animate-pulse rounded-2xl bg-muted" />
      ))}
    </div>
    <div className="h-40 animate-pulse rounded-2xl bg-muted" />
  </div>
);

/**
 * Productivity tiles (E5) — reads the `shadchan_stats` view (one row per
 * shadchan) and renders three calm counts styled as the dashboard's stat tiles.
 * The totals agree with the "Suggestions from this shadchan" list below, which
 * filters shidduchim on the same shadchan_id. Zero-state simply shows 0s.
 */
const ShadchanStatsRow = ({ shadchanId }: { shadchanId: Identifier }) => {
  const { data, isPending } = useGetOne<ShadchanStats>("shadchan_stats", {
    id: shadchanId,
  });

  if (isPending) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="h-[116px] animate-pulse rounded-2xl bg-muted"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <DashboardStat
        label="Suggestions"
        value={data?.nb_suggestions ?? 0}
        icon={Sparkles}
      />
      <DashboardStat
        label="Progressed"
        value={data?.nb_progressed ?? 0}
        icon={TrendingUp}
      />
      <DashboardStat
        label="Reached yes"
        value={data?.nb_reached_yes ?? 0}
        icon={Heart}
      />
    </div>
  );
};

const ShadchanShowLayout = () => {
  const record = useRecordContext<Shadchan>();
  if (!record) return <ShadchanShowSkeleton />;

  return (
    <div className="flex flex-col gap-4">
      <ShadchanHeader shadchan={record} />
      <ShadchanStatsRow shadchanId={record.id} />
      <ShadchanSuggestions shadchanId={record.id} />
    </div>
  );
};

const ShadchanShowActions = () => (
  <TopToolbar>
    <EditButton />
  </TopToolbar>
);

export const ShadchanShow = () => (
  <Show title={false} actions={<ShadchanShowActions />}>
    <ShadchanShowLayout />
  </Show>
);
