import type { Identifier } from "ra-core";
import { useGetList, useRecordContext } from "ra-core";

import type { Redt, Shadchan, ShidduchSchool, ShidduchSummary } from "../types";
import { RedtHistorySection } from "./RedtHistorySection";
import { ShidduchCatchSection } from "./ShidduchCatchSection";
import { ShidduchFactsCard } from "./ShidduchFactsCard";
import { ShidduchSchoolsSection } from "./ShidduchSchoolsSection";
import { SingleInputForm } from "./SingleInputForm";

/**
 * The `overview` tab's content (Story 5.1 AC 5/6) — the four presentational
 * sections relocated verbatim from the deleted `ShidduchShow.tsx`, together
 * with the data loading that used to sit above them there:
 * `EntityShow`/`ShowBase` fetch nothing beyond the record itself (contract
 * §2 rule 1), so the `redts` / `shadchanim` / `shidduch_schools` fetches
 * move into this tab's own module. `shadchanim` is fetched again by
 * `entityDescriptorRegions.tsx`'s `ShidduchIdentityHeader`; React Query
 * dedupes the identical query key, so this is one request, not two.
 */
export const ShidduchOverviewTab = () => {
  const record = useRecordContext<ShidduchSummary>();
  const { data: redts } = useGetList<Redt>("redts", {
    filter: { shidduchim_id: record?.id },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "redt_date", order: "DESC" },
  });
  const { data: shadchanim } = useGetList<Shadchan>("shadchanim", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "name", order: "ASC" },
  });
  const { data: schools } = useGetList<ShidduchSchool>("shidduch_schools", {
    filter: { shidduchim_id: record?.id },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });

  if (!record) return null;

  const shadchanName = (shadchanId?: Identifier | null) =>
    shadchanim?.find((shadchan) => shadchan.id === shadchanId)?.name ??
    "Unknown shadchan";

  return (
    <div className="flex flex-col gap-5">
      {/* Story 6.4 (AC 6): the single's write surface, above the catch
          section — a canonical tab is the host, never the read-only right
          rail (ShidduchRightRail.guard.test.ts). Renders nothing for any
          viewer other than a single. */}
      <SingleInputForm shidduchId={record.id} />

      <ShidduchCatchSection shidduchimId={record.id} />

      <ShidduchFactsCard shidduch={record} />

      <ShidduchSchoolsSection
        shidduchimId={record.id}
        schools={schools ?? []}
      />

      <RedtHistorySection
        shidduchimId={record.id}
        history={redts ?? []}
        shadchanName={shadchanName}
      />
    </div>
  );
};
