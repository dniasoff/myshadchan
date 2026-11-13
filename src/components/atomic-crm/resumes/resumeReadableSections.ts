import type { ReferenceLinkSummary } from "../types";

type ParsedLearningItem = { label: string; value: string };

export type ParsedResumeReference = {
  name: string;
  relationship: string;
  phone: string;
};

export type ParsedResumeSections = {
  learningHistory: ParsedLearningItem[];
  references: ParsedResumeReference[];
};

const asText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

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

/**
 * Parser output is persisted JSONB and can be absent or malformed on old
 * resumes. The readable surface is deliberately fail-soft: invalid entries
 * disappear, while the original file remains available above it.
 */
export function parseResumeSections(value: unknown): ParsedResumeSections {
  const sections = recordValue(value);
  if (!sections) return { learningHistory: [], references: [] };

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
  };
}
