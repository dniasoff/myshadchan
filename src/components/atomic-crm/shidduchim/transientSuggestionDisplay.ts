import type { Identifier } from "ra-core";

const transientSuggestionNames = new Map<string, string>();

/**
 * Keeps a display-only fallback for the just-created nameless suggestion.
 * This is intentionally process-local: it is not written to the database,
 * URL, localStorage, analytics, or notifications, and disappears on reload.
 */
export function rememberTransientSuggestionName(
  id: Identifier,
  fileName: string | undefined,
): string {
  const displayName = `New suggestion (from ${fileName?.trim() || "resume"})`;
  transientSuggestionNames.set(String(id), displayName);
  return displayName;
}

export function getTransientSuggestionName(id: Identifier): string | undefined {
  return transientSuggestionNames.get(String(id));
}
