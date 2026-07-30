import { useRecordContext } from "ra-core";

import { PipelineSnapshot } from "../dashboard/PipelineSnapshot";
import { OverviewTab } from "../entity360/tabs/OverviewTab";
import type { OverviewFact } from "../entity360/tabs/OverviewFactGrid";
import { computeAgeFromDob } from "../shidduchim/shidduchAge";
import type { Single } from "../types";
import { GENDER_LABEL, STATUS_LABEL } from "./singleLabels";

/**
 * The `overview` tab's content (Story 5.8, AC 6 / Task 6): a bilingual fact
 * grid built from the single's OWN fields — `first_name_en/he`,
 * `last_name_en/he`, `dob`, `gender`, `community`, `status` — through the
 * shared `OverviewTab` + `OverviewFactGrid` (contract §12 step 0), exactly
 * like `shidduchim/ShidduchOverviewTab.tsx`.
 *
 * Unlike `shidduchim`/`references`, the Supabase provider does NOT redirect
 * `singles` reads to a summary view (`providers/supabase/dataProvider.ts`),
 * so `useRecordContext<Single>()` here is the base `singles` row — no
 * `total_shidduchim`/`open_shidduchim` counts are available from it. Those
 * live counts are exactly what `PipelineSnapshot` (relocated here as
 * `children`, per AC 9 — the other half of the deleted routed record
 * page's layout) already renders from its own `useGetList` over
 * `shidduchim`, so this tab does not duplicate that fetch with a second
 * `singles_summary` read of its own.
 */
export function SingleOverviewTab() {
  const record = useRecordContext<Single>();
  if (!record) return null;

  const facts: OverviewFact[] = [
    {
      label: "Name",
      en: [record.first_name_en, record.last_name_en].filter(Boolean).join(" "),
      he: [record.first_name_he, record.last_name_he].filter(Boolean).join(" "),
    },
    {
      label: "Gender",
      plain: GENDER_LABEL[record.gender ?? ""] ?? record.gender ?? null,
    },
    {
      label: "Age",
      plain: record.dob ? String(computeAgeFromDob(record.dob)) : null,
    },
    { label: "Date of birth", plain: record.dob ?? null },
    { label: "Community", plain: record.community ?? null },
    {
      label: "Status",
      plain: STATUS_LABEL[record.status] ?? record.status,
    },
  ];

  return (
    <OverviewTab facts={facts}>
      <PipelineSnapshot singleId={record.id} />
    </OverviewTab>
  );
}
