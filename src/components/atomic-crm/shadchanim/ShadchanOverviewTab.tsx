import { useGetOne, useRecordContext, useTranslate } from "ra-core";

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
  const translate = useTranslate();
  // `enabled: record != null` (rather than falling back to `id: ""`) so no
  // request fires before the record resolves — an empty-string id is not
  // `null`, so `useGetOne`'s own `enabled: id != null` default would not
  // have skipped it.
  const {
    data: stats,
    isPending,
    error,
  } = useGetOne<ShadchanStats>(
    "shadchan_stats",
    { id: record?.id },
    { enabled: record != null },
  );

  if (!record) return null;

  // Never silently swallow a failed fetch (coding-style.md) — a 403/500 on
  // `shadchan_stats` must not render as though this shadchan simply has no
  // details on file.
  if (error) {
    return (
      <p className="text-sm text-destructive">
        {translate("crm.entity360.overview.statsError", {
          _: "Could not load this shadchan's stats. Try refreshing the page.",
        })}
      </p>
    );
  }

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
