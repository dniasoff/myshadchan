/**
 * Shared label maps for `Single` fields — extracted into their own module
 * because `SingleProfileHeader.tsx` may only export components
 * (`react-refresh/only-export-components`), the same reason
 * `shidduchim/shidduchAge.ts` was split out of `ShidduchFactsCard.tsx`.
 * Reused by `SingleProfileHeader` and `SingleOverviewTab` (Story 5.8) so the
 * two can never disagree on how a gender/status value renders.
 */
export const GENDER_LABEL: Record<string, string> = {
  female: "Female",
  male: "Male",
};

// 2.5 AC-8: the singles roster and 360 keep archived singles reachable (the
// full family record), so the pill/fact reads "Archived" rather than the
// generic non-active "Paused".
export const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};
