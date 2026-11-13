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
