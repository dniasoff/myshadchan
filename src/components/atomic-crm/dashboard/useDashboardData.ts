import type { Identifier } from "ra-core";
import { useGetIdentity, useGetList } from "ra-core";
import { useEffect, useState } from "react";

import type { Child } from "../types";

export interface DashboardData {
  /** True while identity, the child list, or the selected child's count is loading. */
  isPending: boolean;
  children: Child[];
  childId: Identifier | undefined;
  setChildId: (id: Identifier) => void;
  hasSuggestions: boolean;
  totalShadchanim: number;
  totalReferences: number;
}

/**
 * Data + local child-selection state shared by the desktop and mobile
 * dashboards (foundation-plan §4), mirroring the pattern already used in
 * `ShidduchimList`. No global ChildContext yet (risk #3) — TODO: hoist this
 * once a second screen needs to share the selection.
 */
export const useDashboardData = (): DashboardData => {
  const { identity } = useGetIdentity();
  const { data: children, isPending: childrenPending } = useGetList<Child>(
    "children",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "first_name_en", order: "ASC" },
    },
  );
  const [childId, setChildId] = useState<Identifier | undefined>();

  useEffect(() => {
    if (childId == null && children && children.length > 0) {
      setChildId(children[0].id);
    }
  }, [children, childId]);

  const selectedChildId = childId ?? children?.[0]?.id;

  const { total: totalForChild, isPending: totalForChildPending } =
    useGetList(
      "shidduchim",
      {
        filter: { child_id: selectedChildId },
        pagination: { page: 1, perPage: 1 },
      },
      { enabled: selectedChildId != null },
    );

  const { total: totalShadchanim } = useGetList("shadchanim", {
    pagination: { page: 1, perPage: 1 },
  });
  const { total: totalReferences } = useGetList("references", {
    pagination: { page: 1, perPage: 1 },
  });

  return {
    isPending:
      !identity ||
      childrenPending ||
      (selectedChildId != null && totalForChildPending),
    children: children ?? [],
    childId: selectedChildId,
    setChildId,
    hasSuggestions: (totalForChild ?? 0) > 0,
    totalShadchanim: totalShadchanim ?? 0,
    totalReferences: totalReferences ?? 0,
  };
};
