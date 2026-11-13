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

/** Bounds for model-generated generic resume sections. These limits protect
 * both the JSONB row and the read-only UI from an unexpectedly verbose or
 * adversarial model response. */
export const MAX_ADDITIONAL_SECTION_COUNT = 20;
export const MAX_ADDITIONAL_SECTION_ITEMS = 50;
const MAX_ADDITIONAL_SECTION_RAW_ITEMS = 250;
export const MAX_ADDITIONAL_SECTION_ITEM_COUNT = 250;
export const MAX_ADDITIONAL_SECTION_KEY_LENGTH = 80;
export const MAX_ADDITIONAL_SECTION_TITLE_LENGTH = 120;
export const MAX_ADDITIONAL_SECTION_TOTAL_TEXT_LENGTH = 40_000;

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

const hasSafePlainText = (value: string): boolean =>
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

const additionalSectionTextSchema = (maxLength: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" ? stripBidiSpoofingControls(value) : value,
    z.string().trim().min(1).max(maxLength).refine(hasSafePlainText),
  );

const AdditionalSectionItemSchema = z.object({
  label: additionalSectionTextSchema(MAX_SECTION_TEXT_LENGTH),
  value: additionalSectionTextSchema(MAX_SECTION_TEXT_LENGTH),
});

const AdditionalSectionKeySchema = z.preprocess(
  (value) =>
    typeof value === "string" ? stripBidiSpoofingControls(value) : value,
  z
    .string()
    .trim()
    .min(1)
    .max(MAX_ADDITIONAL_SECTION_KEY_LENGTH)
    .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/u),
);

const AdditionalSectionSchema = z.object({
  key: AdditionalSectionKeySchema,
  title: additionalSectionTextSchema(MAX_ADDITIONAL_SECTION_TITLE_LENGTH),
  items: tolerantArray(
    AdditionalSectionItemSchema,
    MAX_ADDITIONAL_SECTION_RAW_ITEMS,
  ),
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

/**
 * Validate each generic section independently, then apply the aggregate item
 * and character caps while preserving the model's source order. Once an
 * item would cross either aggregate cap, all later output is trailing model
 * output and is dropped rather than causing the whole parse to fail.
 */
const normalizeSectionTitle = (value: string): string =>
  value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();

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
      if (currentIsYear && /\s/u.test(separator) && !isYearRangeLink) {
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

const isReferenceLikeSection = (key: string, title: string): boolean =>
  isReferenceLikePrivacyText(key) || isReferenceLikePrivacyText(title);

const normalizeItemKey = (
  item: z.infer<typeof AdditionalSectionItemSchema>,
): string =>
  JSON.stringify([
    item.label.trim().replace(/\s+/gu, " ").toLocaleLowerCase(),
    item.value.trim().replace(/\s+/gu, " ").toLocaleLowerCase(),
  ]);

const normalizeAdditionalSections = (
  raw: unknown,
): Array<z.infer<typeof AdditionalSectionSchema>> => {
  if (!Array.isArray(raw)) return [];

  const mergedSections: Array<z.infer<typeof AdditionalSectionSchema>> = [];
  const sectionsByTitle = new Map<
    string,
    z.infer<typeof AdditionalSectionSchema>
  >();

  for (const entry of raw) {
    const result = AdditionalSectionSchema.safeParse(entry);
    if (!result.success || result.data.items.length === 0) continue;
    if (
      isReferenceLikeSection(result.data.key, result.data.title) ||
      containsSensitiveContactInfo(result.data.title)
    ) {
      continue;
    }

    const sectionItems: z.infer<typeof AdditionalSectionItemSchema>[] = [];
    const itemKeys = new Set<string>();
    for (const item of result.data.items) {
      if (containsSensitiveContactInfo(`${item.label} ${item.value}`)) {
        continue;
      }
      const itemKey = normalizeItemKey(item);
      if (itemKeys.has(itemKey)) continue;
      itemKeys.add(itemKey);
      sectionItems.push(item);
    }
    if (sectionItems.length === 0) continue;

    const titleKey = normalizeSectionTitle(result.data.title);
    const existing = sectionsByTitle.get(titleKey);
    if (existing) {
      const existingItemKeys = new Set(existing.items.map(normalizeItemKey));
      for (const item of sectionItems) {
        const itemKey = normalizeItemKey(item);
        if (existingItemKeys.has(itemKey)) continue;
        existingItemKeys.add(itemKey);
        existing.items.push(item);
      }
      continue;
    }

    const section = { ...result.data, items: sectionItems };
    sectionsByTitle.set(titleKey, section);
    mergedSections.push(section);
  }

  const sections: Array<z.infer<typeof AdditionalSectionSchema>> = [];
  let itemCount = 0;
  let textLength = 0;

  for (const section of mergedSections) {
    if (sections.length >= MAX_ADDITIONAL_SECTION_COUNT) break;
    const sectionTextLength = section.key.length + section.title.length;
    const items: z.infer<typeof AdditionalSectionItemSchema>[] = [];
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

    sections.push({
      ...section,
      items,
    });
    textLength += sectionTextLength + acceptedItemTextLength;

    if (itemCount >= MAX_ADDITIONAL_SECTION_ITEM_COUNT) break;
    if (textLength >= MAX_ADDITIONAL_SECTION_TOTAL_TEXT_LENGTH) break;
  }

  return sections;
};

const AdditionalSectionsSchema = z.preprocess(
  normalizeAdditionalSections,
  z.array(AdditionalSectionSchema).max(MAX_ADDITIONAL_SECTION_COUNT),
);

const SectionsSchema = z.object({
  learningHistory: tolerantArray(
    ResumeSectionSchema,
    MAX_SECTION_ARRAY_LENGTH,
  ).default([]),
  references: tolerantArray(
    ResumeReferenceSchema,
    MAX_SECTION_ARRAY_LENGTH,
  ).default([]),
  additionalSections: AdditionalSectionsSchema.default([]),
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
  person_gender: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  kohen_status: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  marital_status: TextFieldValueSchema.nullable().default({
    value: null,
    confidence: 0,
  }),
  sections: SectionsSchema.default({
    learningHistory: [],
    references: [],
    additionalSections: [],
  }),
});

export type RawExtraction = z.infer<typeof RawExtractionSchema>;

/**
 * The seventeen fields a resume may fill in the shidduch create
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
  person_gender: string | null;
  kohen_status: string | null;
  marital_status: string | null;
};

export type ParsedResumeDraft = {
  fields: ParsedResumeFields;
  lowConfidenceFields: string[];
  sections: RawExtraction["sections"];
};

/** Order matches the seventeen fields above; `age` is the one field
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
  "person_gender",
  "kohen_status",
  "marital_status",
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
    person_gender: null,
    kohen_status: null,
    marital_status: null,
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
    : { learningHistory: [], references: [], additionalSections: [] };

  return {
    fields: fields as unknown as ParsedResumeFields,
    lowConfidenceFields,
    sections,
  };
}
