import type { Identifier } from "ra-core";
import { useGetIdentity, useGetList } from "ra-core";
import { useEffect, useState } from "react";

import type { Single } from "../types";

export interface DashboardData {
  /** True while identity, the single list, or the selected single's count is loading. */
  isPending: boolean;
  singles: Single[];
  singleId: Identifier | undefined;
  setSingleId: (id: Identifier) => void;
  hasSuggestions: boolean;
  totalShadchanim: number;
}

/**
 * Data + local single-selection state shared by the desktop and mobile
 * dashboards (foundation-plan §4), mirroring the pattern already used in
 * `ShidduchimList`. No global SingleContext yet (risk #3) — TODO: hoist this
 * once a second screen needs to share the selection.
 */
export const useDashboardData = (): DashboardData => {
  const { identity } = useGetIdentity();
  const { data: singles, isPending: singlesPending } = useGetList<Single>(
    "singles",
    {
      // 2.5 AC-8: an archived single is not a selectable "current" single.
      filter: { "status@neq": "archived" },
      pagination: { page: 1, perPage: 100 },
      sort: { field: "first_name_en", order: "ASC" },
    },
  );
  const [singleId, setSingleId] = useState<Identifier | undefined>();

  useEffect(() => {
    if (singleId == null && singles && singles.length > 0) {
      setSingleId(singles[0].id);
    }
  }, [singles, singleId]);

  const selectedSingleId = singleId ?? singles?.[0]?.id;

  const { total: totalForSingle, isPending: totalForSinglePending } =
    useGetList(
      "shidduchim",
      {
        filter: { single_id: selectedSingleId },
        pagination: { page: 1, perPage: 1 },
      },
      { enabled: selectedSingleId != null },
    );

  const { total: totalShadchanim } = useGetList("shadchanim", {
    pagination: { page: 1, perPage: 1 },
  });

  return {
    isPending:
      !identity ||
      singlesPending ||
      (selectedSingleId != null && totalForSinglePending),
    singles: singles ?? [],
    singleId: selectedSingleId,
    setSingleId,
    hasSuggestions: (totalForSingle ?? 0) > 0,
    totalShadchanim: totalShadchanim ?? 0,
  };
};
