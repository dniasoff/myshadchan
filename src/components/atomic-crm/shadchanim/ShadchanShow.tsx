import { useRecordContext } from "ra-core";

import { EditButton } from "@/components/admin/edit-button";
import { Show } from "@/components/admin/show";

import { TopToolbar } from "../layout/TopToolbar";
import type { Shadchan } from "../types";
import { ShadchanHeader } from "./ShadchanHeader";
import { ShadchanStatsRow } from "./ShadchanStatsRow";
import { ShadchanSuggestions } from "./ShadchanSuggestions";

/**
 * The shadchan detail page (screen 20) — contact info, productivity stats, and
 * every shidduch this matchmaker has redt, across every single.
 */

const ShadchanShowSkeleton = () => (
  <div className="flex flex-col gap-4">
    <div className="h-[112px] animate-pulse rounded-2xl bg-muted" />
    <div className="h-[90px] animate-pulse rounded-2xl bg-muted md:h-[74px]" />
    <div className="h-40 animate-pulse rounded-2xl bg-muted" />
  </div>
);

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
