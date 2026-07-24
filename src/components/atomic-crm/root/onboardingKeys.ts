/**
 * CRM-store (localStorage, `"CRM"` namespace — see `crmStore.ts`) keys shared
 * across the onboarding gate, the demo banner, and the walkthrough. Kept in
 * one place so the surfaces that read/write them (OnboardingChoice,
 * DemoBanner, tour/*) never drift on the string literal.
 *
 * `OnboardingGate`'s decision to show the welcome screen is driven purely by
 * data (no children yet, not in demo mode) — deliberately NOT by a
 * "seen/dismissed" flag; see `OnboardingGate.tsx` for why an earlier version
 * with such a flag broke the "start with my own family" path.
 *
 * - `justSeeded`  — seed just succeeded → auto-start the tour once.
 * - `tourCompleted` — walkthrough finished/skipped → don't auto-repeat;
 *   reset by the Clear flow.
 */
export const ONBOARDING_JUST_SEEDED_KEY = "onboarding.justSeeded";
export const TOUR_COMPLETED_KEY = "tour.completed";
