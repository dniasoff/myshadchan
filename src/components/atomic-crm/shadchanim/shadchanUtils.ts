import type { Identifier } from "ra-core";

import type { Shadchan } from "../types";

export const PHONE_SEARCH_MIN_DIGITS = 4;
const PHONE_SEARCH_MAX_DIGITS = 10;

export type ShadchanPhoneChannel = "phone" | "whatsapp";

export type ShadchanPhoneMatch = {
  channels: ShadchanPhoneChannel[];
  suffix: string;
};

/**
 * Upper-case the first lower-case letter of each whitespace- or hyphen-
 * separated word while preserving every other character exactly as entered.
 * This intentionally leaves existing casing, punctuation and RTL text alone.
 */
export const capitalizeName = (value: string | null | undefined): string =>
  (value ?? "").replace(
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

const PHONE_EXTENSION_PATTERN = /(?:extension|extn|ext\.?|x|#)\s*\d+/iu;
const PHONE_VALUE_SEPARATOR_PATTERN = /\s*(?:[/,;]|\b(?:or|and)\b)\s*/iu;

/** Keep the base number before an extension, then discard one leading `00`. */
export const normalizePhoneDigits = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const baseNumber = value.split(PHONE_EXTENSION_PATTERN, 1)[0];
  const digits = baseNumber.replace(/[^0-9]/g, "");
  return digits.startsWith("00") ? digits.slice(2) : digits;
};

const getPhoneDigitCandidates = (value: string): string[] =>
  value
    .split(PHONE_VALUE_SEPARATOR_PATTERN)
    .map(normalizePhoneDigits)
    .filter(Boolean);

/** Return the query suffix used for phone mode, or null below the 4-digit floor. */
const getPhoneSearchDigits = (query: string): string | null => {
  const digits = normalizePhoneDigits(query);
  if (digits.length < PHONE_SEARCH_MIN_DIGITS) return null;
  return digits.length > PHONE_SEARCH_MAX_DIGITS
    ? digits.slice(-PHONE_SEARCH_MAX_DIGITS)
    : digits;
};

export const isPhoneSearchQuery = (query: string): boolean =>
  getPhoneSearchDigits(query) !== null;

/** Phone-shaped input stays ephemeral even before it reaches the 4-digit floor. */
export const isPhoneInputQuery = (query: string): boolean => {
  const trimmed = query.trim();
  return (
    trimmed.length > 0 &&
    !/\p{L}/u.test(trimmed) &&
    /^[0-9\s()+.\-\x5B\x5D]+$/u.test(trimmed)
  );
};

export const isNumberLikeSearchQuery = (query: string): boolean => {
  const trimmed = query.trim();
  return (
    trimmed.length > 0 &&
    /[0-9]/u.test(trimmed) &&
    !/\p{L}/u.test(trimmed) &&
    /^[0-9\s()+.\-\x5B\x5D]+$/u.test(trimmed)
  );
};

const PHONE_KEY_ROOTS = [
  "phone",
  "whatsapp",
  "mobile",
  "cell",
  "tel",
  "telephone",
] as const;

const isPhoneLikeContactKey = (key: string): boolean => {
  const compactKey = key.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  return PHONE_KEY_ROOTS.some((root) => {
    if (compactKey === root) return true;
    const suffix = compactKey.slice(root.length);
    return (
      suffix.length > 0 &&
      (suffix === "number" ||
        /^\d+$/.test(suffix) ||
        /^number\d+$/.test(suffix))
    );
  });
};

const getPhoneLikeContactValues = (
  contacts: unknown,
): { channel: ShadchanPhoneChannel; value: string }[] => {
  if (!contacts || typeof contacts !== "object" || Array.isArray(contacts)) {
    return [];
  }

  try {
    return Object.entries(contacts).flatMap(([key, value]) => {
      if (!isPhoneLikeContactKey(key) || typeof value !== "string" || !value) {
        return [];
      }
      return [
        {
          channel: key.toLocaleLowerCase().startsWith("whatsapp")
            ? ("whatsapp" as const)
            : ("phone" as const),
          value,
        },
      ];
    });
  } catch {
    return [];
  }
};

export const getShadchanPhoneMatch = (
  shadchan: Pick<Shadchan, "contacts">,
  query: string,
): ShadchanPhoneMatch | null => {
  const queryDigits = getPhoneSearchDigits(query);
  if (!queryDigits) return null;

  const matchingValues = new Map<ShadchanPhoneChannel, string>();
  for (const { channel, value } of getPhoneLikeContactValues(
    shadchan.contacts,
  )) {
    for (const candidateDigits of getPhoneDigitCandidates(value)) {
      if (
        candidateDigits.length >= PHONE_SEARCH_MIN_DIGITS &&
        candidateDigits.endsWith(queryDigits) &&
        !matchingValues.has(channel)
      ) {
        matchingValues.set(channel, candidateDigits);
        break;
      }
    }
  }

  const channels = (["phone", "whatsapp"] as const).filter((channel) =>
    matchingValues.has(channel),
  );
  if (channels.length === 0) return null;

  const firstMatchedDigits = matchingValues.get(channels[0]);
  return {
    channels: [...channels],
    suffix: firstMatchedDigits?.slice(-4) ?? queryDigits.slice(-4),
  };
};

export const getShadchanPhoneMatchLabel = (
  match: ShadchanPhoneMatch,
): string => {
  const channelLabel =
    match.channels.length > 1
      ? "Phone and WhatsApp"
      : match.channels[0] === "whatsapp"
        ? "WhatsApp"
        : "Phone";
  return `${channelLabel} ending ${match.suffix}`;
};

const matchesShadchanText = (shadchan: Shadchan, query: string): boolean => {
  const phoneMode = isPhoneSearchQuery(query);
  const terms = query
    .replace(/,/g, " ")
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/u)
    .filter((term) => term && (!phoneMode || /\p{L}/u.test(term)));
  if (terms.length === 0) return false;

  const searchableText = [shadchan.name, shadchan.name_he, shadchan.location]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase();
  return terms.every((term) => searchableText.includes(term));
};

/** Apply the shared local search semantics used by Supabase and FakeRest. */
export const filterShadchanimBySearch = <T extends Shadchan>(
  shadchanim: T[],
  query: string,
): T[] => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return shadchanim;

  const phoneMode = isPhoneSearchQuery(trimmedQuery);
  return shadchanim.filter((shadchan) => {
    if (matchesShadchanText(shadchan, trimmedQuery)) return true;
    return phoneMode && getShadchanPhoneMatch(shadchan, trimmedQuery) !== null;
  });
};

export const sortShadchanim = <T extends Shadchan>(
  shadchanim: T[],
  sort: { field: string; order: "ASC" | "DESC" },
): T[] => {
  const sorted = [...shadchanim].sort((left, right) => {
    const leftValue = sort.field === "location" ? left.location : left.name;
    const rightValue = sort.field === "location" ? right.location : right.name;
    return (leftValue ?? "").localeCompare(rightValue ?? "", undefined, {
      sensitivity: "base",
    });
  });
  return sort.order === "DESC" ? sorted.reverse() : sorted;
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
