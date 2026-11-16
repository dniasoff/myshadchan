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
  enum?: string[];
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
}

import {
  GEMINI_LEGACY_RESUME_RESPONSE_SCHEMA as FIXTURE_LEGACY_SCHEMA,
  GEMINI_RESUME_RESPONSE_SCHEMA as FIXTURE_SCHEMA,
} from "./geminiModelProbeFixture.mjs";

/**
 * The explicit structured-output schema sent as
 * `generationConfig.responseSchema` (`resumeExtractor.ts`). Field-for-field
 * mirror of `parsedResumeDraft.ts`'s `FIELD_KEYS` — `age` is the one
 * numeric field, every other field (including `height`, which is freeform
 * text like `5'10"`, not a structured dimension — see `public.shidduchim`)
 * is text.
 */
export const GEMINI_RESUME_RESPONSE_SCHEMA = FIXTURE_SCHEMA as GeminiSchema;

/** Schema used by the single bounded recovery request after malformed JSON.
 * It deliberately excludes additionalSections so the retry can recover the
 * legacy fixed fields without asking Gemini to reproduce the truncated data.
 */
export const GEMINI_LEGACY_RESUME_RESPONSE_SCHEMA =
  FIXTURE_LEGACY_SCHEMA as GeminiSchema;
