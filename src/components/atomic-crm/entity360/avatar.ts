/**
 * Cross-entity avatar-chip utilities (Epic 3 API contract §1 rule 6). Moved
 * here verbatim from `shidduchim/boardUtils.ts`, which hosted them by
 * historical accident even though every entity (single, shadchan, reference,
 * shidduch) uses them — 9 importers beyond `boardUtils.ts` itself, 6 of them
 * outside `shidduchim/`. `EntityAvatar` is the sole intended caller going
 * forward; the four remaining direct callers are the *card* chips (Epic 4
 * re-renders those rows) and keep importing these two functions directly.
 */

/** Two-letter monogram from an English name, e.g. "Ari Rosenberg" -> "AR". */
export const getMonogram = (name?: string | null): string => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** Deterministic avatar palette index (0-9) from a seed string. */
export const getAvatarIndex = (seed?: string | null): number => {
  if (!seed) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 10;
};
