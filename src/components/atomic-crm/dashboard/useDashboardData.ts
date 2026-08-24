import type { Identifier } from "ra-core";
import { useGetIdentity, useGetList } from "ra-core";

import { useSelectedSingle } from "../singles/useSelectedSingle";
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
 * Dashboard data for the desktop and mobile dashboards (foundation-plan §4).
 *
 * The single selection itself is NOT owned here any more: it lives in
 * `useSelectedSingle`, shared with the app-bar pill. This hook used to hold
 * its own `useState` (the "TODO: hoist this once a second screen needs to
 * share the selection" that stood here), which is why picking a name in the
 * app bar left the dashboard showing the other child.
 */
export const useDashboardData = (): DashboardData => {
  const { identity } = useGetIdentity();
  // The SAME selection the app-bar pill drives — see useSelectedSingle for
  // why this is one shared key and not two local useStates.
  const {
    singles,
    selectedId: selectedSingleId,
    setSelectedId: setSingleId,
    isPending: singlesPending,
  } = useSelectedSingle();

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
    singles,
    singleId: selectedSingleId,
    setSingleId,
    hasSuggestions: (totalForSingle ?? 0) > 0,
    totalShadchanim: totalShadchanim ?? 0,
  };
};
