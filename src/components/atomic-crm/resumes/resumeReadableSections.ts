import type { ReferenceLinkSummary } from "../types";

type ParsedLearningItem = { label: string; value: string };

export type ParsedAdditionalSectionItem = ParsedLearningItem;

export type ParsedAdditionalSectionAfter =
  "personal_details" | "family" | "learning_and_community" | "learning_history";

export type ParsedAdditionalSection = {
  key: string;
  title: string;
  items: ParsedAdditionalSectionItem[];
  after?: ParsedAdditionalSectionAfter;
  order?: number;
};

export type ParsedResumeReference = {
  name: string;
  relationship: string;
  phone: string;
};

export type ParsedResumeSections = {
  learningHistory: ParsedLearningItem[];
  references: ParsedResumeReference[];
  additionalSections: ParsedAdditionalSection[];
};

const MAX_ADDITIONAL_SECTION_COUNT = 20;
const MAX_ADDITIONAL_SECTION_ITEMS = 50;
const MAX_ADDITIONAL_SECTION_RAW_ITEMS = 250;
const MAX_ADDITIONAL_SECTION_ITEM_COUNT = 250;
const MAX_ADDITIONAL_SECTION_TOTAL_TEXT_LENGTH = 40_000;
const MAX_ADDITIONAL_SECTION_KEY_LENGTH = 80;
const MAX_ADDITIONAL_SECTION_TITLE_LENGTH = 120;
const MAX_ADDITIONAL_SECTION_TEXT_LENGTH = 1_000;
const MAX_ADDITIONAL_SECTION_ORDER = 249;
const ADDITIONAL_SECTION_AFTER_VALUES: readonly ParsedAdditionalSectionAfter[] =
  ["personal_details", "family", "learning_and_community", "learning_history"];
const FIXED_SECTION_TITLE_KEYS = new Set([
  "personal details",
  "learning and community",
  "learning history",
  "name",
  "age",
  "height",
  "location",
  "marital status",
  "kohen status",
  "father",
  "mother",
  "seminary / yeshiva",
  "shul",
]);
const REFERENCE_LIKE_LATIN_STEMS = [
  "reference",
  "references",
  "referee",
  "referees",
  "recommendation",
  "recommendations",
  "recommender",
  "recommenders",
] as const;
const REFERENCE_LIKE_HEBREW_STEMS = ["ממליצ", "המלצ"] as const;
const CONFUSABLE_FOLD_MAP: Readonly<Record<string, string>> = {
  а: "a",
  в: "b",
  е: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  α: "a",
  β: "b",
  ε: "e",
  η: "n",
  ι: "i",
  κ: "k",
  μ: "m",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "y",
  χ: "x",
  ω: "w",
};

const asText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const stripBidiSpoofingControls = (value: string): string =>
  [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return !(
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069)
      );
    })
    .join("");

const isSafePlainText = (value: string): boolean =>
  [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return !(
      (codePoint >= 0 && codePoint <= 8) ||
      codePoint === 11 ||
      codePoint === 12 ||
      (codePoint >= 14 && codePoint <= 31) ||
      codePoint === 127
    );
  });

const foldPrivacyConfusables = (value: string): string =>
  [...value]
    .map((character) => CONFUSABLE_FOLD_MAP[character] ?? character)
    .join("");

const normalizePrivacyText = (value: string): string =>
  foldPrivacyConfusables(
    value
      .normalize("NFKC")
      .replace(/[\p{Cf}\p{Mn}]/gu, "")
      .toLocaleLowerCase(),
  );

const squashPrivacyText = (value: string): string =>
  normalizePrivacyText(value).replace(/[\s\p{P}\p{S}]+/gu, "");

const stemPattern = (stem: string): RegExp =>
  new RegExp(
    `(?:^|[^\\p{L}])${[...stem].join("[^\\p{L}]*")}(?:$|[^\\p{L}])`,
    "iu",
  );

const REFERENCE_LIKE_PATTERNS = REFERENCE_LIKE_LATIN_STEMS.map(stemPattern);

const isReferenceLikePrivacyText = (value: string): boolean => {
  const normalized = normalizePrivacyText(value);
  if (
    REFERENCE_LIKE_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    REFERENCE_LIKE_HEBREW_STEMS.some((stem) => normalized.includes(stem))
  ) {
    return true;
  }

  const squashed = squashPrivacyText(value);
  return (
    REFERENCE_LIKE_LATIN_STEMS.includes(
      squashed as (typeof REFERENCE_LIKE_LATIN_STEMS)[number],
    ) || REFERENCE_LIKE_HEBREW_STEMS.some((stem) => squashed.includes(stem))
  );
};

const DECIMAL_DIGIT_ZEROES = [
  0x30, 0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66,
  0xce6, 0xd66, 0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x1090, 0x17e0, 0x1810,
  0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620,
  0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10, 0x104a0, 0x10d30,
  0x11066, 0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450, 0x114d0, 0x11650,
  0x116c0, 0x11730, 0x118e0, 0x11950, 0x11c50, 0x11d50, 0x11da0, 0x16a60,
  0x16ac0, 0x16b50, 0x1d7ce, 0x1e140, 0x1e2f0, 0x1e950,
];

const toAsciiDecimalDigit = (character: string): string | null => {
  const codePoint = character.codePointAt(0) ?? 0;
  for (const zero of DECIMAL_DIGIT_ZEROES) {
    if (codePoint >= zero && codePoint <= zero + 9) {
      return String(codePoint - zero);
    }
  }
  return null;
};

const isYear = (value: string): boolean =>
  value.length === 4 && /^(?:19|20)\d{2}$/u.test(value);

const PHONE_DIGIT_GROUP_PATTERN = /\p{Nd}+/gu;

const normalizeDigitGroup = (value: string): string =>
  [...value].map((character) => toAsciiDecimalDigit(character) ?? "").join("");

const isPhoneSeparator = (separator: string): boolean =>
  separator.length >= 1 &&
  separator.length <= 2 &&
  !/[\p{L}\p{N}]/u.test(separator) &&
  !/[,:;]/u.test(separator) &&
  !/\.\s/u.test(separator);

const isPhoneLikeToken = (token: string, runs: string[]): boolean => {
  const all = runs.join("");
  if (all.length === 0 || runs.every(isYear)) return false;

  const hasInternationalPrefix = /^(?:\+|00)/u.test(token);
  if (hasInternationalPrefix) return all.length >= 7 && all.length <= 15;
  if (all.length < 9 || all.length > 15) return false;
  if (runs.length === 2 && runs[0].length === 5 && runs[1].length === 4) {
    return false;
  }
  return true;
};

const isPhoneLikeNumber = (value: string): boolean => {
  const normalized = value.normalize("NFKC").replace(/\p{Cf}/gu, "");
  const groups = [...normalized.matchAll(PHONE_DIGIT_GROUP_PATTERN)];

  for (let index = 0; index < groups.length; index += 1) {
    const first = groups[index];
    const firstStart = first.index ?? 0;
    const tokenStart =
      firstStart > 0 && normalized[firstStart - 1] === "+"
        ? firstStart - 1
        : firstStart;
    const runs = [normalizeDigitGroup(first[0])];
    let tokenEnd = firstStart + first[0].length;

    for (let nextIndex = index + 1; nextIndex < groups.length; nextIndex += 1) {
      const next = groups[nextIndex];
      const nextStart = next.index ?? 0;
      const separator = normalized.slice(tokenEnd, nextStart);
      if (!isPhoneSeparator(separator)) break;

      const nextRun = normalizeDigitGroup(next[0]);
      const currentIsYear = isYear(runs[runs.length - 1]);
      const isYearRangeLink =
        currentIsYear && isYear(nextRun) && /[^\p{L}\p{N}\s]/u.test(separator);
      const nonYearIntoParenthesizedYear =
        !currentIsYear &&
        isYear(nextRun) &&
        runs[runs.length - 1].length <= 2 &&
        /[\s(]/u.test(separator);
      if (
        (currentIsYear && /\s/u.test(separator) && !isYearRangeLink) ||
        nonYearIntoParenthesizedYear
      ) {
        break;
      }

      runs.push(nextRun);
      tokenEnd = nextStart + next[0].length;
      index = nextIndex;
    }

    if (isPhoneLikeToken(normalized.slice(tokenStart, tokenEnd), runs)) {
      return true;
    }
  }

  return false;
};

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/u;

const containsSensitiveContactInfo = (value: string): boolean => {
  const normalized = value.normalize("NFKC").replace(/[\p{Cf}\p{Mn}]/gu, "");
  return EMAIL_PATTERN.test(normalized) || isPhoneLikeNumber(normalized);
};

/**
 * Faithful client port of public.normalize_identity_text(). Keep spaces
 * because the SQL key keeps them; removing punctuation must not accidentally
 * join two words that the server would keep separate.
 */
export const normalizeResumeReferenceName = (value: string): string | null => {
  const normalized = value
    .replace(/[֑-ׇ]/g, "")
    .toLocaleLowerCase()
    .replace(/œ/g, "o")
    .replace(/æ/g, "a")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9א-ת ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
};

/** Faithful client port of public.normalize_phone(). */
export const normalizeResumeReferencePhone = (value: string): string | null => {
  let digits = value.replace(/[^0-9]/g, "");
  if (!digits) return null;

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("972")) {
    digits = digits.slice(3);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  } else if (digits.startsWith("44") && digits.length > 10) {
    digits = digits.slice(2);
  }

  digits = digits.replace(/^0+/, "");
  return digits.length < 7 ? null : digits;
};

/**
 * Match a parsed candidate to the canonical link identity using the same
 * name-column and phone rules as the server reconciliation function. A blank
 * phone permits the server's name-only fallback; a non-empty invalid phone
 * must never be treated as blank.
 */
export const linkMatchesResumeReference = (
  link: ReferenceLinkSummary,
  reference: ParsedResumeReference,
): boolean => {
  const candidateName = normalizeResumeReferenceName(reference.name);
  if (!candidateName) return false;

  const linkNames = [link.reference_name_en, link.reference_name_he]
    .map((name) => (name ? normalizeResumeReferenceName(name) : null))
    .filter((name): name is string => name !== null);
  if (!linkNames.includes(candidateName)) return false;

  const candidatePhone = asText(reference.phone);
  if (!candidatePhone) return true;

  const normalizedCandidatePhone =
    normalizeResumeReferencePhone(candidatePhone);
  const normalizedLinkPhone = normalizeResumeReferencePhone(
    asText(link.reference_phone),
  );
  return (
    normalizedCandidatePhone !== null &&
    normalizedLinkPhone !== null &&
    normalizedCandidatePhone === normalizedLinkPhone
  );
};

export function matchResumeReferenceLinks(
  references: ParsedResumeReference[],
  links: ReferenceLinkSummary[],
): Array<ReferenceLinkSummary | null> {
  const used = new Set<ReferenceLinkSummary["id"]>();
  return references.map((reference) => {
    const candidates = links.filter(
      (link) =>
        !used.has(link.id) && linkMatchesResumeReference(link, reference),
    );
    const link = candidates.length === 1 ? candidates[0] : undefined;
    if (link) used.add(link.id);
    return link ?? null;
  });
}

const recordValue = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const readStringArray = <T>(
  value: unknown,
  map: (item: Record<string, unknown>) => T | null,
): T[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const mapped = recordValue(item);
    if (!mapped) return [];
    const result = map(mapped);
    return result ? [result] : [];
  });
};

const readAdditionalSectionItems = (
  value: unknown,
): ParsedAdditionalSectionItem[] =>
  readStringArray(value, (item) => {
    const label = stripBidiSpoofingControls(asText(item.label));
    const text = stripBidiSpoofingControls(asText(item.value));
    if (
      !label ||
      !text ||
      label.length > MAX_ADDITIONAL_SECTION_TEXT_LENGTH ||
      text.length > MAX_ADDITIONAL_SECTION_TEXT_LENGTH ||
      !isSafePlainText(label) ||
      !isSafePlainText(text) ||
      containsSensitiveContactInfo(`${label} ${text}`)
    ) {
      return null;
    }
    return { label, value: text };
  }).slice(0, MAX_ADDITIONAL_SECTION_RAW_ITEMS);

const normalizeSectionTitle = (value: string): string =>
  value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();

const readAdditionalSectionAfter = (
  value: unknown,
): ParsedAdditionalSectionAfter | undefined =>
  typeof value === "string" &&
  ADDITIONAL_SECTION_AFTER_VALUES.includes(
    value as ParsedAdditionalSectionAfter,
  )
    ? (value as ParsedAdditionalSectionAfter)
    : undefined;

const readAdditionalSectionOrder = (value: unknown): number | undefined =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_ADDITIONAL_SECTION_ORDER
    ? value
    : undefined;

const isReferenceLikeSection = (key: string, title: string): boolean =>
  isReferenceLikePrivacyText(key) || isReferenceLikePrivacyText(title);

const isFixedSectionDuplicate = (title: string): boolean =>
  FIXED_SECTION_TITLE_KEYS.has(normalizeSectionTitle(title));

const normalizeItemKey = (item: ParsedAdditionalSectionItem): string =>
  JSON.stringify([
    item.label.trim().replace(/\s+/gu, " ").toLocaleLowerCase(),
    item.value.trim().replace(/\s+/gu, " ").toLocaleLowerCase(),
  ]);

const normalizeLearningHistory = (value: unknown): ParsedLearningItem[] => {
  const items = readStringArray(value, (item) => {
    const label = asText(item.label);
    const text = asText(item.value);
    return label && text ? { label, value: text } : null;
  });
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeItemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const readAdditionalSections = (
  value: unknown,
  canViewReferences: boolean,
): ParsedAdditionalSection[] => {
  if (!Array.isArray(value)) return [];

  const mergedSections: ParsedAdditionalSection[] = [];
  const sectionsByTitle = new Map<string, ParsedAdditionalSection>();

  for (const entry of value) {
    const section = recordValue(entry);
    if (!section) continue;

    const key = asText(section.key);
    const title = stripBidiSpoofingControls(asText(section.title));
    const after = readAdditionalSectionAfter(section.after);
    const order = readAdditionalSectionOrder(section.order);
    if (
      !/^[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(key) ||
      key.length > MAX_ADDITIONAL_SECTION_KEY_LENGTH ||
      !title ||
      title.length > MAX_ADDITIONAL_SECTION_TITLE_LENGTH ||
      !isSafePlainText(key) ||
      !isSafePlainText(title)
    ) {
      continue;
    }
    if (
      key === "references" ||
      normalizeSectionTitle(title) === "references" ||
      (!canViewReferences && isReferenceLikeSection(key, title)) ||
      containsSensitiveContactInfo(title) ||
      isFixedSectionDuplicate(title)
    ) {
      continue;
    }

    const sourceItems = readAdditionalSectionItems(section.items);
    if (sourceItems.length === 0) continue;
    const items: ParsedAdditionalSectionItem[] = [];
    const itemKeys = new Set<string>();
    for (const item of sourceItems) {
      const itemKey = normalizeItemKey(item);
      if (itemKeys.has(itemKey)) continue;
      itemKeys.add(itemKey);
      items.push(item);
    }
    if (items.length === 0) continue;

    const titleKey = normalizeSectionTitle(title);
    const existing = sectionsByTitle.get(titleKey);
    if (existing) {
      const existingItemKeys = new Set(existing.items.map(normalizeItemKey));
      for (const item of items) {
        const itemKey = normalizeItemKey(item);
        if (existingItemKeys.has(itemKey)) continue;
        existingItemKeys.add(itemKey);
        existing.items.push(item);
      }
      continue;
    }

    const mergedSection = {
      key,
      title,
      items,
      ...(after === undefined ? {} : { after }),
      ...(order === undefined ? {} : { order }),
    };
    sectionsByTitle.set(titleKey, mergedSection);
    mergedSections.push(mergedSection);
  }

  const sections: ParsedAdditionalSection[] = [];
  let itemCount = 0;
  let textLength = 0;

  for (const section of mergedSections) {
    if (sections.length >= MAX_ADDITIONAL_SECTION_COUNT) break;
    const items: ParsedAdditionalSectionItem[] = [];
    const sectionTextLength = section.key.length + section.title.length;
    let acceptedItemTextLength = 0;
    for (const item of section.items) {
      const itemTextLength = item.label.length + item.value.length;
      if (
        items.length >= MAX_ADDITIONAL_SECTION_ITEMS ||
        itemCount >= MAX_ADDITIONAL_SECTION_ITEM_COUNT ||
        textLength +
          sectionTextLength +
          acceptedItemTextLength +
          itemTextLength >
          MAX_ADDITIONAL_SECTION_TOTAL_TEXT_LENGTH
      ) {
        break;
      }
      items.push(item);
      itemCount += 1;
      acceptedItemTextLength += itemTextLength;
    }

    if (items.length === 0) break;
    sections.push({ ...section, items });
    textLength += sectionTextLength + acceptedItemTextLength;

    if (
      itemCount >= MAX_ADDITIONAL_SECTION_ITEM_COUNT ||
      textLength >= MAX_ADDITIONAL_SECTION_TOTAL_TEXT_LENGTH
    ) {
      break;
    }
  }

  return sections;
};

/**
 * Parser output is persisted JSONB and can be absent or malformed on old
 * resumes. The readable surface is deliberately fail-soft: invalid entries
 * disappear, while the original file remains available above it.
 */
export function parseResumeSections(
  value: unknown,
  canViewReferences = true,
): ParsedResumeSections {
  const sections = recordValue(value);
  if (!sections) {
    return { learningHistory: [], references: [], additionalSections: [] };
  }

  return {
    learningHistory: normalizeLearningHistory(sections.learningHistory),
    references: readStringArray(sections.references, (item) => {
      const name = asText(item.name);
      if (!name) return null;
      return {
        name,
        relationship: asText(item.relationship),
        phone: asText(item.phone),
      };
    }),
    additionalSections: readAdditionalSections(
      sections.additionalSections,
      canViewReferences,
    ),
  };
}
