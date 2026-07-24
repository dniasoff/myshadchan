import { useEffect } from "react";
import { useStore } from "ra-core";

import {
  ONBOARDING_JUST_SEEDED_KEY,
  TOUR_COMPLETED_KEY,
} from "../root/onboardingKeys";
import { useTour } from "./useTour";

/**
 * Invisible effect-only component, mounted inside the authenticated shell
 * (below `OnboardingGate` so it only runs once the shell is actually
 * showing). Watches `onboarding.justSeeded` — set by `OnboardingChoice`
 * right after a successful `seedDemo()` — and auto-starts the walkthrough
 * once, then clears the flag so it never re-fires on its own.
 */
export const TourAutostart = () => {
  const [justSeeded, setJustSeeded] = useStore<boolean>(
    ONBOARDING_JUST_SEEDED_KEY,
    false,
  );
  const [tourCompleted] = useStore<boolean>(TOUR_COMPLETED_KEY, false);
  const { startTour } = useTour();

  useEffect(() => {
    if (!justSeeded || tourCompleted) return;
    setJustSeeded(false);
    // Give the freshly-seeded dashboard a beat to mount its data-tour
    // anchors before highlighting the first one.
    const timer = setTimeout(() => startTour(), 400);
    return () => clearTimeout(timer);
    // Deliberately mount-scoped (empty deps): this component only mounts
    // fresh right when `OnboardingGate` swaps from the onboarding screen to
    // the shell after a successful seed, so reading `justSeeded` once on
    // mount is correct. Depending on `justSeeded` here would be
    // self-defeating — the `setJustSeeded(false)` line above changes that
    // very dependency, which would re-run this effect, clean up (cancel)
    // the pending timer, and bail out on the guard before it ever fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
};
