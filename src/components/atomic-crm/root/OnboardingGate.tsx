import type { ReactNode } from "react";
import { useGetList } from "ra-core";

import { OnboardingChoice } from "../login/OnboardingChoice";
import type { Child } from "../types";
import { useAccountDemo } from "./useAccountDemo";

/**
 * Wraps the ENTIRE authenticated shell (Layout / MobileLayout render this
 * around their whole return, not just around `children`) and decides
 * whether to show the app or the full-screen onboarding welcome
 * (demo-onboarding-plan.md §B2). Sits below `<Admin>` so `useGetList`,
 * `useDataProvider` and `useStore` all resolve normally.
 *
 * Shows the choice screen whenever the account has no children AND isn't
 * already in demo mode — driven purely by that data, deliberately NOT by a
 * "seen/dismissed" store flag. `<OnboardingChoice/>` is the same element
 * (same type, same position) on every render this condition holds, so React
 * never remounts it merely because this gate re-renders — its own local
 * `mode` state (choice vs. the inline `FirstRunSetup`) survives naturally.
 * A live "seen" flag was tried and reverted: `OnboardingChoice` writes it as
 * the very first, synchronous action of each button handler, which made
 * this gate swap `<OnboardingChoice/>` for the shell in that same render —
 * before the local `mode` switch (or the seeding spinner) ever painted, so
 * "Start with my own family" appeared to do nothing. The choice naturally
 * stops showing once a child exists or `seedDemo()` flips `isDemo` — no
 * extra flag needed. Any pending read renders the shell as usual — it has
 * its own skeletons — to avoid a flash of the welcome screen on every
 * reload.
 */
export const OnboardingGate = ({ children }: { children: ReactNode }) => {
  const { total: childrenTotal, isPending: childrenPending } =
    useGetList<Child>("children", {
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    });
  const { data: isDemo, isPending: demoPending } = useAccountDemo();

  if (childrenPending || demoPending) {
    return <>{children}</>;
  }

  const hasChildren = (childrenTotal ?? 0) > 0;
  const showOnboarding = !hasChildren && isDemo !== true;

  if (showOnboarding) {
    return <OnboardingChoice />;
  }

  return <>{children}</>;
};
