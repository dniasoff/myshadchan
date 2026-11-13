import type { ReferenceLinkSummary } from "../types";

type ParsedLearningItem = { label: string; value: string };

export type ParsedAdditionalSectionItem = ParsedLearningItem;

export type ParsedAdditionalSection = {
  key: string;
  title: string;
  items: ParsedAdditionalSectionItem[];
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
      !isSafePlainText(text)
    ) {
      return null;
    }
    return { label, value: text };
  }).slice(0, MAX_ADDITIONAL_SECTION_RAW_ITEMS);

const normalizeSectionTitle = (value: string): string =>
  value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();

const normalizeItemKey = (item: ParsedAdditionalSectionItem): string =>
  JSON.stringify([
    item.label.trim().replace(/\s+/gu, " ").toLocaleLowerCase(),
    item.value.trim().replace(/\s+/gu, " ").toLocaleLowerCase(),
  ]);

const readAdditionalSections = (value: unknown): ParsedAdditionalSection[] => {
  if (!Array.isArray(value)) return [];

  const mergedSections: ParsedAdditionalSection[] = [];
  const sectionsByTitle = new Map<string, ParsedAdditionalSection>();

  for (const entry of value) {
    const section = recordValue(entry);
    if (!section) continue;

    const key = asText(section.key);
    const title = stripBidiSpoofingControls(asText(section.title));
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
    if (key === "references" || normalizeSectionTitle(title) === "references") {
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

    const mergedSection = { key, title, items };
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
export function parseResumeSections(value: unknown): ParsedResumeSections {
  const sections = recordValue(value);
  if (!sections) {
    return { learningHistory: [], references: [], additionalSections: [] };
  }

  return {
    learningHistory: readStringArray(sections.learningHistory, (item) => {
      const label = asText(item.label);
      const text = asText(item.value);
      return label && text ? { label, value: text } : null;
    }),
    references: readStringArray(sections.references, (item) => {
      const name = asText(item.name);
      if (!name) return null;
      return {
        name,
        relationship: asText(item.relationship),
        phone: asText(item.phone),
      };
    }),
    additionalSections: readAdditionalSections(sections.additionalSections),
  };
}
