import { z } from "zod";

/**
 * Confidence threshold below which a parsed field is flagged for human review.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

const FieldValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.null()]),
  confidence: z.number().min(0).max(1),
});

const ResumeSectionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

const ResumeReferenceSchema = z.object({
  name: z.string(),
  relationship: z.string(),
  phone: z.string(),
});

/**
 * Raw extraction shape returned by a resume extractor. Every field is
 * `{ value, confidence }` so `toDraft` can validate, nullify, and flag.
 */
export const RawExtractionSchema = z.object({
  name_en: FieldValueSchema.nullable().default({ value: null, confidence: 0 }),
  name_he: FieldValueSchema.nullable().default({ value: null, confidence: 0 }),
  parents_en: FieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  parents_he: FieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  seminary_en: FieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  seminary_he: FieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  shul_en: FieldValueSchema.nullable().default({ value: null, confidence: 0 }),
  shul_he: FieldValueSchema.nullable().default({ value: null, confidence: 0 }),
  location_en: FieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  location_he: FieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  age: FieldValueSchema.nullable().default({ value: null, confidence: 0 }),
  height: FieldValueSchema.nullable().default({ value: null, confidence: 0 }),
  sections: z
    .object({
      learningHistory: z.array(ResumeSectionSchema).default([]),
      references: z.array(ResumeReferenceSchema).default([]),
    })
    .default({ learningHistory: [], references: [] }),
});

export type RawExtraction = z.infer<typeof RawExtractionSchema>;

/**
 * The twelve bilingual fields a resume may fill in the shidduch create form.
 */
export type ParsedResumeFields = {
  name_en: string | number | null;
  name_he: string | number | null;
  parents_en: string | number | null;
  parents_he: string | number | null;
  seminary_en: string | number | null;
  seminary_he: string | number | null;
  shul_en: string | number | null;
  shul_he: string | number | null;
  location_en: string | number | null;
  location_he: string | number | null;
  age: string | number | null;
  height: string | number | null;
};

export type ParsedResumeDraft = {
  fields: ParsedResumeFields;
  lowConfidenceFields: string[];
  sections: RawExtraction["sections"];
};

function parseField(raw: z.infer<typeof FieldValueSchema> | null): {
  value: string | number | null;
  isLowConfidence: boolean;
} {
  if (!raw) {
    return { value: null, isLowConfidence: false };
  }

  const parsed = FieldValueSchema.safeParse(raw);
  if (!parsed.success) {
    return { value: null, isLowConfidence: false };
  }

  const value = parsed.data.value;
  if (value === null || value === undefined || value === "") {
    return { value: null, isLowConfidence: false };
  }

  return {
    value,
    isLowConfidence: parsed.data.confidence < LOW_CONFIDENCE_THRESHOLD,
  };
}

const FIELD_KEYS: (keyof ParsedResumeFields)[] = [
  "name_en",
  "name_he",
  "parents_en",
  "parents_he",
  "seminary_en",
  "seminary_he",
  "shul_en",
  "shul_he",
  "location_en",
  "location_he",
  "age",
  "height",
];

/**
 * Convert a raw extractor result into a validated, nullable draft, flagging any
 * field whose confidence falls below `LOW_CONFIDENCE_THRESHOLD`. A field that
 * fails schema validation or is absent becomes `null` — never a passed-through
 * guess.
 */
export function toDraft(raw: unknown): ParsedResumeDraft {
  const parsed = RawExtractionSchema.safeParse(raw);
  const extraction = parsed.success
    ? parsed.data
    : RawExtractionSchema.parse({});

  const fields = {} as ParsedResumeFields;
  const lowConfidenceFields: string[] = [];

  for (const key of FIELD_KEYS) {
    const { value, isLowConfidence } = parseField(extraction[key]);
    fields[key] = value;
    if (isLowConfidence) {
      lowConfidenceFields.push(key);
    }
  }

  return {
    fields,
    lowConfidenceFields,
    sections: extraction.sections,
  };
}
