import { z } from "zod";

/**
 * Confidence threshold below which a parsed field is flagged for human review.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Review fix (Finding 10, SMALL scope only — see the Story 11-1 review
 * report): bounds on string length and array size so a pathological model
 * response (a single field holding megabytes of repeated text, or a section
 * array with tens of thousands of entries) cannot blow up the client that
 * renders this draft. This is deliberately NOT source-grounding or an
 * evidence-span validator — the review's verification pass concluded the
 * human-review gate in `InboxResolveDialog.tsx` already covers that risk and
 * building a proof system here would be YAGNI.
 */
const MAX_FIELD_VALUE_LENGTH = 500;
const MAX_SECTION_TEXT_LENGTH = 1000;
const MAX_SECTION_ARRAY_LENGTH = 50;

const FieldValueSchema = z.object({
  value: z.union([
    z.string().max(MAX_FIELD_VALUE_LENGTH),
    z.number().finite(),
    z.null(),
  ]),
  confidence: z.number().min(0).max(1),
});

const ResumeSectionSchema = z.object({
  label: z.string().max(MAX_SECTION_TEXT_LENGTH),
  value: z.string().max(MAX_SECTION_TEXT_LENGTH),
});

const ResumeReferenceSchema = z.object({
  name: z.string().max(MAX_SECTION_TEXT_LENGTH),
  relationship: z.string().max(MAX_SECTION_TEXT_LENGTH),
  phone: z.string().max(MAX_SECTION_TEXT_LENGTH),
});

/**
 * Raw extraction shape returned by a resume extractor. Every field is
 * `{ value, confidence }` so `toDraft` can validate, nullify, and flag.
 *
 * Review fix (Finding 3): this used to be a single combined `parents_en` /
 * `parents_he` pair, but `public.shidduchim` (supabase/schemas/01_tables.sql)
 * — and the form that consumes this draft, `ShidduchInputs.tsx` /
 * `ShidduchCreate.tsx` — has always stored and rendered father and mother as
 * four SEPARATE split fields (`father_en`, `father_he`, `mother_en`,
 * `mother_he`). The combined shape had no input that rendered it and no
 * submit mapping that read it, so any parent information the model extracted
 * was silently discarded on every auto-fill. Emit the same four split fields
 * the rest of the app already uses.
 */
export const RawExtractionSchema = z.object({
  name_en: FieldValueSchema.nullable().default({ value: null, confidence: 0 }),
  name_he: FieldValueSchema.nullable().default({ value: null, confidence: 0 }),
  father_en: FieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  father_he: FieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  mother_en: FieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  mother_he: FieldValueSchema.nullable().default({
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
      learningHistory: z
        .array(ResumeSectionSchema)
        .max(MAX_SECTION_ARRAY_LENGTH)
        .default([]),
      references: z
        .array(ResumeReferenceSchema)
        .max(MAX_SECTION_ARRAY_LENGTH)
        .default([]),
    })
    .default({ learningHistory: [], references: [] }),
});

export type RawExtraction = z.infer<typeof RawExtractionSchema>;

/**
 * The fourteen bilingual fields a resume may fill in the shidduch create form.
 */
export type ParsedResumeFields = {
  name_en: string | number | null;
  name_he: string | number | null;
  father_en: string | number | null;
  father_he: string | number | null;
  mother_en: string | number | null;
  mother_he: string | number | null;
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
  "father_en",
  "father_he",
  "mother_en",
  "mother_he",
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
