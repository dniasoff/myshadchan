import { useGetOne, useRecordContext } from "ra-core";

import { OverviewTab } from "../entity360/tabs/OverviewTab";
import type { OverviewFact } from "../entity360/tabs/OverviewFactGrid";
import { formatRedtDate } from "../shidduchim/boardUtils";
import type { Shadchan, ShadchanStats } from "../types";

/**
 * The `overview` tab's content (Story 5.9, RULING 8 — option B, decided
 * 2026-07-29). `Shadchan`'s own fields are all rendered by the identity
 * header already (`ShadchanHeader.tsx` — name, location, "In your book
 * since", responsiveness, contact quick actions), so the one thing left
 * outside it is `name_he`. The two other facts here are NOT `Shadchan`
 * fields at all — they come from the widened `shadchan_stats` view (Task 2b):
 * the last time this shadchan was the current redter of something, and how
 * many distinct singles they are currently working on (an open pipeline
 * state). Location / Responsiveness / "In your book since" are deliberately
 * NOT repeated here — that would be the double-render this tab avoids.
 */
export function ShadchanOverviewTab() {
  const record = useRecordContext<Shadchan>();
  const { data: stats, isPending } = useGetOne<ShadchanStats>(
    "shadchan_stats",
    { id: record?.id ?? "" },
  );

  if (!record) return null;

  const facts: OverviewFact[] = [
    { label: "Hebrew name", he: record.name_he ?? null },
    {
      label: "Last redt",
      plain:
        !isPending && stats?.last_redt_date
          ? formatRedtDate(stats.last_redt_date)
          : null,
    },
    {
      label: "Working on now",
      plain: !isPending && stats ? String(stats.nb_open_singles) : null,
    },
  ];

  return <OverviewTab facts={facts} />;
}
