export type EligibilityFacts = {
  gender?: unknown;
  kohen_status?: unknown;
  marital_status?: unknown;
};

const normalize = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "" ? null : normalized;
};

const isKnownGender = (value: string | null): value is "female" | "male" =>
  value === "female" || value === "male";

const isKohen = (value: string | null): boolean =>
  value === "yes" || value === "true" || value === "kohen";

const isDivorced = (value: string | null): boolean =>
  value === "divorced" ||
  value === "divorcee" ||
  value === "gerushah" ||
  value === "gerushin";

/**
 * Mirrors public.has_known_halachic_conflict(). This is deliberately narrow:
 * only explicit, recognized facts block a suggestion. Missing, unknown, and
 * non-standard values remain usable and are never interpreted here.
 */
export const hasKnownHalachicConflict = (
  target: EligibilityFacts,
  candidate: EligibilityFacts,
): boolean => {
  const targetGender = normalize(target.gender);
  const candidateGender = normalize(candidate.gender);
  if (
    isKnownGender(targetGender) &&
    isKnownGender(candidateGender) &&
    targetGender === candidateGender
  ) {
    return true;
  }

  const targetIsKohen = isKohen(normalize(target.kohen_status));
  const candidateIsKohen = isKohen(normalize(candidate.kohen_status));
  const targetIsDivorced = isDivorced(normalize(target.marital_status));
  const candidateIsDivorced = isDivorced(normalize(candidate.marital_status));

  return (
    (targetIsKohen && candidateIsDivorced) ||
    (candidateIsKohen && targetIsDivorced)
  );
};

export const assertNoKnownHalachicConflict = (
  target: EligibilityFacts,
  candidate: EligibilityFacts,
): void => {
  if (hasKnownHalachicConflict(target, candidate)) {
    throw new Error("This suggestion conflicts with a recorded detail.");
  }
};
