import { z } from "zod";
import { RawExtractionSchema } from "./parsedResumeDraft";

/**
 * Finding 12 (Epic 11 adversarial review): the exact shape `POST /parse`
 * returns on success, and the version stamp `claim_ai_parse_attempt()` /
 * `confirm_ai_parse_attempt()` (`supabase/schemas/02_functions.sql`) gate a
 * replay against. Bump this WHENEVER this schema's shape changes, together
 * with the SQL side's own `p_current_result_schema_version` /
 * `p_result_schema_version` arguments (`parseQuota.ts`) — the two must move
 * together, never independently. A row cached under a version behind this
 * constant is never trusted as-is: `claim_ai_parse_attempt()` serves it as a
 * free re-claim instead (see that function's own comment) — the account
 * already paid for one extraction of the document, and a re-parse forced by
 * OUR OWN contract change must not charge it again.
 *
 * Version 2 adds three optional, explicitly stated candidate facts used by
 * the app's narrow eligibility guard. Older cached results are deliberately
 * re-parsed rather than guessed at.
 */
export const CURRENT_PARSE_RESULT_SCHEMA_VERSION = 2;

/**
 * Mirrors `ParsedResumeFields` (`parsedResumeDraft.ts`, Finding 13 closure)
 * field for field: `age` is the one numeric field, every other field —
 * `height` included — is text. Duplicated here rather than imported because
 * `ParsedResumeFields` is a plain TS type, not a Zod schema — `toDraft()`
 * already validated a freshly-extracted value once on the way in. This
 * schema's job is different: it re-validates a value read back OUT of
 * `ai_parse_attempts.result` on a replay, a value that crossed a
 * JSON/database boundary and must not be trusted blindly (Finding 12) — a
 * corrupted row, or one written under an older, incompatible response
 * shape, must never be cast and returned as a current success.
 */
const ParseResultFieldsSchema = z.object({
  name_en: z.string().nullable(),
  name_he: z.string().nullable(),
  father_en: z.string().nullable(),
  father_he: z.string().nullable(),
  mother_en: z.string().nullable(),
  mother_he: z.string().nullable(),
  seminary_en: z.string().nullable(),
  seminary_he: z.string().nullable(),
  shul_en: z.string().nullable(),
  shul_he: z.string().nullable(),
  location_en: z.string().nullable(),
  location_he: z.string().nullable(),
  age: z.number().nullable(),
  height: z.string().nullable(),
  person_gender: z.string().nullable(),
  kohen_status: z.string().nullable(),
  marital_status: z.string().nullable(),
});

/**
 * The exact shape `POST /parse` returns on success — durably cached,
 * verbatim, in `ai_parse_attempts.result` so a `"replay"` outcome can return
 * it. Finding 12 closure: a replay is a value read back from the database,
 * not a value this Worker just computed, so it is re-validated against this
 * schema rather than cast with `as unknown as ParseResultPayload` —
 * `resolveParseClaim.ts` is what acts on a validation failure here (a
 * same-version corruption forces a free re-claim via
 * `force_reclaim_ai_parse_attempt()`, never a silently-trusted stale
 * result).
 */
export const ParseResultPayloadSchema = z.object({
  fields: ParseResultFieldsSchema,
  lowConfidenceFields: z.array(z.string()),
  sections: RawExtractionSchema.shape.sections,
  // Finding 14 (already landed in `resumeExtractor.ts`): the extractor's raw
  // response is no longer itself schema-validated on the way in —
  // `rawDraft` is whatever the model returned, retained for
  // reference/debugging only. Trusting it as `unknown` on replay matches
  // that; it was never `RawExtractionSchema`-validated even when this
  // Worker first computed it.
  rawDraft: z.unknown(),
});

export type ParseResultPayload = z.infer<typeof ParseResultPayloadSchema>;
