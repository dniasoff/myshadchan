import type { Identifier } from "ra-core";

/**
 * Upper-case the first lower-case letter of each whitespace- or hyphen-
 * separated word while preserving every other character exactly as entered.
 * This intentionally leaves existing casing, punctuation and RTL text alone.
 */
export const capitalizeName = (value: string): string =>
  value.replace(
    /(^|[\s-])(\p{Ll})/gu,
    (_match, boundary: string, letter: string) =>
      `${boundary}${letter.toUpperCase()}`,
  );

export const normalizeShadchanName = <T extends Record<string, unknown>>(
  data: T,
): T => {
  if (typeof data.name !== "string") return data;
  return { ...data, name: capitalizeName(data.name) };
};

/** The three responsiveness levels a shadchan can be tagged with. */
export type ResponsivenessLevel = "high" | "medium" | "low";

export const isResponsivenessLevel = (
  value: unknown,
): value is ResponsivenessLevel =>
  value === "high" || value === "medium" || value === "low";

export interface ShadchanContactInfo {
  phone?: string;
  email?: string;
  whatsapp?: string;
}

/**
 * Safely read the `shadchanim.contacts` jsonb column. The column is untyped
 * at the database layer, so this never trusts its shape — an unexpected value
 * (wrong type, extra keys, not an object at all) degrades to "no contact
 * info" rather than throwing.
 */
export const parseContactInfo = (contacts: unknown): ShadchanContactInfo => {
  if (!contacts || typeof contacts !== "object" || Array.isArray(contacts)) {
    return {};
  }
  const record = contacts as Record<string, unknown>;
  const pick = (key: string): string | undefined =>
    typeof record[key] === "string" && record[key]
      ? (record[key] as string)
      : undefined;

  return {
    phone: pick("phone"),
    email: pick("email"),
    whatsapp: pick("whatsapp"),
  };
};

/**
 * Count suggestions per shadchan_id from a flat list of shidduchim summaries.
 * Callers fetch that list once, account-wide, and pass it in — this stays a
 * pure grouping function so the shadchan book's list never fires one query
 * per shadchan (N+1).
 */
export const countSuggestionsByShadchan = (
  items: { shadchan_id?: Identifier | null }[],
): Map<Identifier, number> => {
  const counts = new Map<Identifier, number>();
  items.forEach((item) => {
    if (item.shadchan_id == null) return;
    counts.set(item.shadchan_id, (counts.get(item.shadchan_id) ?? 0) + 1);
  });
  return counts;
};
