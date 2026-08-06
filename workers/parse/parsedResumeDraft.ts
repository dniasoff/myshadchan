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

/**
 * Finding 13 (Epic 11 adversarial review): every field used to accept
 * `string | number` uniformly, so a model response that put a bare number
 * in a text field (e.g. `height: 5`) reached `InboxResolveDialog.tsx`'s RPC
 * parameters and form controls as a raw JS number behind only a
 * compile-time `as string` assertion — nothing runtime-checked or converted
 * it. The real field taxonomy, verified against `public.shidduchim` (age
 * `integer`, height `text` — freeform, e.g. `5'10"`, not a structured
 * dimension) and `CreateShidduchInput`: exactly ONE numeric field (`age`);
 * every other field, `height` included, is text.
 *
 * Coercion happens HERE, at the validation boundary, via `z.preprocess` —
 * never a rejection of the whole field. A model returning `5` for a
 * text-shaped field or `"27"` for `age` is an unambiguous, lossless
 * conversion and is coerced; a value that genuinely cannot be coerced (e.g.
 * `age: "twenties"`) becomes `null` for that field alone, never a guess and
 * never a reason to drop any of the other thirteen fields (see `toDraft`'s
 * per-field-tolerant validation below — Finding 14).
 */
const TextFieldValueSchema = z.object({
  value: z.preprocess(
    (v) => (typeof v === "number" ? String(v) : v),
    z.string().max(MAX_FIELD_VALUE_LENGTH).nullable(),
  ),
  confidence: z.number().min(0).max(1),
});

const NumericFieldValueSchema = z.object({
  value: z.preprocess((v) => {
    if (
      typeof v === "string" &&
      v.trim() !== "" &&
      Number.isFinite(Number(v))
    ) {
      return Number(v);
    }
    return v;
  }, z.number().finite().nullable()),
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
 * Finding 14 (Epic 11 adversarial review): validates an array PER ELEMENT
 * rather than as one array-level schema. `z.array(itemSchema)` fails the
 * WHOLE array the moment any single entry is malformed — exactly the
 * all-or-nothing failure mode this exists to close. Malformed or
 * over-the-bound entries are dropped individually; a well-formed entry
 * elsewhere in the same array always survives.
 */
function tolerantArray<Item extends z.ZodTypeAny>(
  itemSchema: Item,
  maxLength: number,
): z.ZodType<z.infer<Item>[]> {
  return z.preprocess((raw) => {
    if (!Array.isArray(raw)) {
      return [];
    }
    const kept: z.infer<Item>[] = [];
    for (const entry of raw) {
      if (kept.length >= maxLength) {
        break;
      }
      const result = itemSchema.safeParse(entry);
      if (result.success) {
        kept.push(result.data);
      }
    }
    return kept;
  }, z.array(itemSchema).max(maxLength));
}

const SectionsSchema = z.object({
  learningHistory: tolerantArray(
    ResumeSectionSchema,
    MAX_SECTION_ARRAY_LENGTH,
  ).default([]),
  references: tolerantArray(
    ResumeReferenceSchema,
    MAX_SECTION_ARRAY_LENGTH,
  ).default([]),
});

/**
 * Raw extraction shape a resume extractor's response is expected to have.
 * Finding 14: this is now DOCUMENTATION / a shape reference only (used by
 * `geminiResponseSchema.ts`'s own conformance test) — it no longer gates
 * extraction success. `resumeExtractor.ts` stopped calling `.parse()` on
 * it; `toDraft` below validates per top-level field instead, so one
 * malformed field costs only that field, never the other ~13 good ones.
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
  name_en: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  name_he: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  father_en: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  father_he: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  mother_en: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  mother_he: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  seminary_en: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  seminary_he: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  shul_en: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  shul_he: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  location_en: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  location_he: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  age: NumericFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  height: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  sections: SectionsSchema.default({ learningHistory: [], references: [] }),
});

export type RawExtraction = z.infer<typeof RawExtractionSchema>;

/**
 * The fourteen bilingual fields a resume may fill in the shidduch create
 * form. Finding 13: narrowed to ONE type per field — `age` is `number`
 * (`public.shidduchim.age integer`), every other field (including `height`,
 * `public.shidduchim.height text`) is `string`. This now matches
 * `CreateShidduchInput` exactly, field for field — see this module's
 * `contractForDownstream` note in the implementing agent's report for the
 * frontend consequence (`InboxResolveDialog.tsx`'s `as string`/`as number`
 * casts become provably safe direct assignments).
 */
export type ParsedResumeFields = {
  name_en: string | null;
  name_he: string | null;
  father_en: string | null;
  father_he: string | null;
  mother_en: string | null;
  mother_he: string | null;
  seminary_en: string | null;
  seminary_he: string | null;
  shul_en: string | null;
  shul_he: string | null;
  location_en: string | null;
  location_he: string | null;
  age: number | null;
  height: string | null;
};

export type ParsedResumeDraft = {
  fields: ParsedResumeFields;
  lowConfidenceFields: string[];
  sections: RawExtraction["sections"];
};

/** Order matches the fourteen fields above; `age` is the one field
 * validated against `NumericFieldValueSchema` — see the loop in `toDraft`. */
export const FIELD_KEYS: readonly (keyof ParsedResumeFields)[] = [
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
 * Convert a raw extractor result into a validated, nullable draft, flagging
 * any field whose confidence falls below `LOW_CONFIDENCE_THRESHOLD`. A field
 * that fails schema validation, is absent, or is an empty string becomes
 * `null` — never a passed-through guess.
 *
 * Finding 14 (Epic 11 adversarial review): validated PER TOP-LEVEL FIELD,
 * not as one whole-object schema. The old `RawExtractionSchema.safeParse`
 * call failed (and fell back to an all-null draft) the moment ANY single
 * field was malformed — discarding up to nineteen other good, already-paid
 * fields over one bad one. Each field (and each section-array entry, via
 * `tolerantArray` above) is now validated independently, so a single
 * malformed field costs only that field.
 */
export function toDraft(raw: unknown): ParsedResumeDraft {
  const record = z.record(z.string(), z.unknown()).safeParse(raw);
  const source: Record<string, unknown> = record.success ? record.data : {};

  // A UNIFORM value type across every key here (`string | number | null`),
  // never the per-key-narrowed `ParsedResumeFields`. Writing through a
  // generic `key: keyof ParsedResumeFields` into an object whose property
  // types actually DIFFER per key (`age: number | null` vs. every other
  // field's `string | null`) hits a real TypeScript soundness rule: a
  // generic indexed write is checked against the type valid for every
  // possible key at once, which collapses to `null` (the only value common
  // to both `string | null` and `number | null`) — not what an `as` cast on
  // the assigned VALUE can work around, since the LHS slot itself is what's
  // narrowed. Building the loop's output in this uniform shape sidesteps
  // that entirely; the single cast to `ParsedResumeFields` below is backed
  // by the same runtime dispatch (age -> NumericFieldValueSchema, every
  // other key -> TextFieldValueSchema) that `parsedResumeDraft.test.ts`
  // exercises per field.
  const fields: Record<keyof ParsedResumeFields, string | number | null> = {
    name_en: null,
    name_he: null,
    father_en: null,
    father_he: null,
    mother_en: null,
    mother_he: null,
    seminary_en: null,
    seminary_he: null,
    shul_en: null,
    shul_he: null,
    location_en: null,
    location_he: null,
    age: null,
    height: null,
  };
  const lowConfidenceFields: string[] = [];

  for (const key of FIELD_KEYS) {
    const schema =
      key === "age" ? NumericFieldValueSchema : TextFieldValueSchema;
    const result = schema.nullable().safeParse(source[key] ?? null);
    if (
      !result.success ||
      result.data === null ||
      result.data.value === null ||
      result.data.value === ""
    ) {
      continue; // already `null` in `fields`
    }
    fields[key] = result.data.value;
    if (result.data.confidence < LOW_CONFIDENCE_THRESHOLD) {
      lowConfidenceFields.push(key);
    }
  }

  const sectionsResult = SectionsSchema.safeParse(source.sections);
  const sections = sectionsResult.success
    ? sectionsResult.data
    : { learningHistory: [], references: [] };

  return {
    fields: fields as unknown as ParsedResumeFields,
    lowConfidenceFields,
    sections,
  };
}
