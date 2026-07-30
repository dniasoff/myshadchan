/**
 * Story 5.2: the Overview tab prefers a live age computed from `dob` (the
 * more precise source) over the stored `age` number when both are known.
 * Extracted from `ShidduchFactsCard.tsx` into its own module — a component
 * file may only export components (`react-refresh/only-export-components`).
 */

/**
 * Computes an age in whole years from a `date` string as of `referenceDate`
 * (defaults to now). `referenceDate` is a parameter — not read from `Date.now()`
 * internally by default — so a test can compute the SAME expected value the
 * caller renders, rather than hard-coding a number that would drift with the
 * calendar (`.claude/rules/testing.md` — no flaky/time-dependent assertions).
 */
export const computeAgeFromDob = (
  dob: string,
  referenceDate: Date = new Date(),
): number => {
  // `new Date(dob)` would parse a date-only string ("YYYY-MM-DD") as UTC
  // midnight (per the ISO 8601 spec), while the local getters below
  // (`getFullYear`/`getMonth`/`getDate`) read it back in the runtime's local
  // timezone. In any negative-UTC-offset timezone (e.g. America/New_York),
  // that shifts the parsed date back by one calendar day, making this
  // function report the wrong age on the day before a birthday. Building the
  // Date from its local y/m/d components instead sidesteps the UTC
  // round-trip entirely — the same three numbers come back out regardless of
  // which timezone the code runs in (Review fix F5, Story 5.2).
  const [birthYear, birthMonth, birthDay] = dob.split("-").map(Number);
  const birthDate = new Date(birthYear, birthMonth - 1, birthDay);
  let age = referenceDate.getFullYear() - birthDate.getFullYear();
  const hasHadBirthdayThisYear =
    referenceDate.getMonth() > birthDate.getMonth() ||
    (referenceDate.getMonth() === birthDate.getMonth() &&
      referenceDate.getDate() >= birthDate.getDate());
  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }
  return age;
};
