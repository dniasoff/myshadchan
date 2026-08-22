/**
 * Finding 14 (Epic 11 adversarial review): the extractor's own comment used
 * to claim Gemini's response was "constrained to the RawExtractionSchema
 * shape" while the actual request only ever set
 * `generationConfig.responseMimeType: "application/json"` — no JSON schema
 * at all. That asks the model, in prose, to produce the right shape; it
 * does not constrain it. Gemini supports an explicit structured-output
 * schema (`generationConfig.responseSchema`,
 * https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
 * — a restricted subset of the OpenAPI 3.0 Schema object. `GeminiSchema`
 * below models exactly the subset this file uses (`type`, `nullable`,
 * `properties`, `required`, `items`) — no `anyOf`/`oneOf`, which Gemini's
 * dialect does not reliably support for a single property.
 *
 * This is why Finding 13's field-type narrowing (`parsedResumeDraft.ts`,
 * every field exactly ONE JS type — string, except `age`, which is number)
 * is a PRECONDITION for this file, not an independent cleanup: with a
 * `string | number` union per field, there would be no single Gemini `type`
 * to declare for the wrapper's `value` property.
 */

type GeminiSchemaType =
  "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN" | "ARRAY" | "OBJECT";

export interface GeminiSchema {
  type: GeminiSchemaType;
  nullable?: boolean;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
}

/** The `{ value, confidence }` wrapper every field in the resume draft
 * uses — one Gemini `type` per field, per the precondition above. */
function fieldSchema(type: "STRING" | "NUMBER"): GeminiSchema {
  return {
    type: "OBJECT",
    properties: {
      value: { type, nullable: true },
      confidence: { type: "NUMBER" },
    },
    required: ["value", "confidence"],
  };
}

const referenceEntrySchema: GeminiSchema = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    relationship: { type: "STRING" },
    phone: { type: "STRING" },
  },
  required: ["name", "relationship", "phone"],
};

const learningHistoryEntrySchema: GeminiSchema = {
  type: "OBJECT",
  properties: {
    label: { type: "STRING" },
    value: { type: "STRING" },
  },
  required: ["label", "value"],
};

/**
 * The explicit structured-output schema sent as
 * `generationConfig.responseSchema` (`resumeExtractor.ts`). Field-for-field
 * mirror of `parsedResumeDraft.ts`'s `FIELD_KEYS` — `age` is the one
 * numeric field, every other field (including `height`, which is freeform
 * text like `5'10"`, not a structured dimension — see `public.shidduchim`)
 * is text.
 */
export const GEMINI_RESUME_RESPONSE_SCHEMA: GeminiSchema = {
  type: "OBJECT",
  properties: {
    name_en: fieldSchema("STRING"),
    name_he: fieldSchema("STRING"),
    father_en: fieldSchema("STRING"),
    father_he: fieldSchema("STRING"),
    mother_en: fieldSchema("STRING"),
    mother_he: fieldSchema("STRING"),
    seminary_en: fieldSchema("STRING"),
    seminary_he: fieldSchema("STRING"),
    shul_en: fieldSchema("STRING"),
    shul_he: fieldSchema("STRING"),
    location_en: fieldSchema("STRING"),
    location_he: fieldSchema("STRING"),
    age: fieldSchema("NUMBER"),
    height: fieldSchema("STRING"),
    person_gender: fieldSchema("STRING"),
    kohen_status: fieldSchema("STRING"),
    marital_status: fieldSchema("STRING"),
    sections: {
      type: "OBJECT",
      properties: {
        learningHistory: { type: "ARRAY", items: learningHistoryEntrySchema },
        references: { type: "ARRAY", items: referenceEntrySchema },
      },
    },
  },
};
