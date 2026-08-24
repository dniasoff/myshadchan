import type { Identifier } from "ra-core";
import { useGetList, useStore } from "ra-core";

import type { Single } from "../types";

/**
 * One shared key, so "which single am I looking at" has a single owner.
 *
 * There used to be two: `layout/TopBar.tsx`'s `SingleSwitcherPill` and
 * `dashboard/useDashboardData.ts` each held their own `useState`, and both
 * carried the same TODO to hoist it "once a second consumer needs the
 * selection". There were already two consumers. The visible symptom was that
 * picking a name in the app-bar pill changed the pill and nothing else — the
 * dashboard kept showing the other child's pipeline, so the header said one
 * name while the switcher said another. The pill's own docstring admitted it:
 * "Purely a display/selection affordance for now — it does not drive any
 * other screen."
 *
 * `useStore` rather than a React context because it is what this codebase
 * already uses for shared cross-component state (DemoBanner, OnboardingChoice)
 * and because it survives a reload, which is the behaviour a parent expects
 * from a switcher they set once.
 */
export const SELECTED_SINGLE_KEY = "single.selected";

export interface SelectedSingle {
  /** Every selectable single, already excluding archived ones. */
  singles: Single[];
  /** The resolved selection — never a dangling id. */
  selected: Single | undefined;
  selectedId: Identifier | undefined;
  setSelectedId: (id: Identifier) => void;
  isPending: boolean;
}

export const useSelectedSingle = (): SelectedSingle => {
  const { data, isPending } = useGetList<Single>("singles", {
    // 2.5 AC-8: an archived single is not a selectable "current" single.
    filter: { "status@neq": "archived" },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "first_name_en", order: "ASC" },
  });
  const [storedId, setStoredId] = useStore<Identifier | undefined>(
    SELECTED_SINGLE_KEY,
  );

  const singles = data ?? [];

  // Derived, not mirrored into a second state + effect (web-patterns.md:
  // "derive values instead of storing redundant computed state"). It also
  // makes the fallback total: a stored id can stop resolving because the
  // single was archived, or because the store outlived a context switch into
  // an account that never had it — neither may strand the UI on nothing.
  const selected =
    singles.find((single) => single.id === storedId) ?? singles[0];

  return {
    singles,
    selected,
    selectedId: selected?.id,
    setSelectedId: setStoredId,
    isPending,
  };
};
