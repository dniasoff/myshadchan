import type { ReactNode } from "react";

import { OnboardingChoice } from "../login/OnboardingChoice";
import { useAccountDemo } from "./useAccountDemo";
import { useMyContexts } from "./useMyContexts";
import { useMyPersonas } from "./useMyPersonas";

/**
 * Wraps the ENTIRE authenticated shell (Layout / MobileLayout render this
 * around their whole return, not just around `children`) and decides
 * whether to show the app or the full-screen onboarding welcome
 * (demo-onboarding-plan.md §B2). Sits below `<Admin>` so `useDataProvider`
 * and `useStore` all resolve normally.
 *
 * Shows the choice screen whenever the login holds no persona yet
 * (`my_personas()` returns zero rows), holds no membership context either
 * (`my_contexts()` returns zero rows), AND isn't already in demo mode —
 * driven purely by that data, deliberately NOT by a "seen/dismissed" store
 * flag. `my_contexts()` is checked in addition to `my_personas()` (2.7
 * review finding #2): `my_personas()` is deliberately persona-shaped
 * (single/parent/shadchan only, per `add_persona()`'s three branches) and
 * reports ZERO rows for an invited `helper` — a real role with a real,
 * already-bound `account_members` row, just not one of the three onboarding
 * personas — and for an invited `single` before anyone has re-derived a
 * `singles` row for them. Both already hold a live context via the invite
 * they accepted (Story 2.7's `handle_new_user()` binds one
 * `account_members` row per accepted invite), so `my_contexts()` reporting
 * ≥1 row is enough to prove "this login is already inside a household or
 * shadchanus, do not offer to create a new one" without needing every role
 * to also be a persona.
 * `<OnboardingChoice/>` is the same element (same type, same
 * position) on every render this condition holds, so React never remounts
 * it merely because this gate re-renders — its own local `mode` state
 * (choice vs. the inline `FirstRunSetup`) survives naturally. A live "seen"
 * flag was tried and reverted: `OnboardingChoice` writes it as the very
 * first, synchronous action of each button handler, which made this gate
 * swap `<OnboardingChoice/>` for the shell in that same render — before the
 * local `mode` switch (or the seeding spinner) ever painted, so "Start with
 * my own family" appeared to do nothing. The choice naturally stops showing
 * once a persona has been provisioned or `seedDemo()` flips `isDemo` — no
 * extra flag needed. Any pending read renders the shell as usual — it has
 * its own skeletons — to avoid a flash of the welcome screen on every
 * reload.
 *
 * Fails TOWARD the shell, never toward onboarding: `getMyPersonas()` and
 * `getMyContexts()` are both fail-loud (dataProvider.ts throws rather than
 * swallowing an RPC error), so a rejected query is a distinct react-query
 * state (`isError`), never `data === undefined` collapsed into "zero rows"
 * by `?? 0`. Showing onboarding to an existing user on a transient read
 * failure (or an RPC that 404s because a migration hasn't shipped yet) is
 * far worse than showing the app shell, which will itself surface the same
 * error through its own data fetching.
 */
export const OnboardingGate = ({ children }: { children: ReactNode }) => {
  const {
    data: personas,
    isPending: personasPending,
    isError: personasErrored,
  } = useMyPersonas();
  const {
    data: contexts,
    isPending: contextsPending,
    isError: contextsErrored,
  } = useMyContexts();
  const { data: isDemo, isPending: demoPending } = useAccountDemo();

  if (
    personasPending ||
    contextsPending ||
    demoPending ||
    personasErrored ||
    contextsErrored
  ) {
    return <>{children}</>;
  }

  const showOnboarding =
    personas.length === 0 && contexts.length === 0 && isDemo !== true;

  if (showOnboarding) {
    return <OnboardingChoice />;
  }

  return <>{children}</>;
};
