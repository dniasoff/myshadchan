import type { RawExtraction } from "./resumeExtractor";
import { CURRENT_PARSE_RESULT_SCHEMA_VERSION } from "./parseResultPayload";

/**
 * Shared, side-effect-free fixtures for `workers/parse`'s test suite —
 * `index.test.ts`, `index.idempotency.test.ts`, `index.sizeGuard.test.ts`,
 * `index.quotaEnforcement.test.ts`, `resolveParseClaim.test.ts`,
 * `resolveConfirmOutcome.test.ts`. Deliberately holds NO `vi.mock(...)`
 * calls: those are per-file (Vitest hoists them within the file that
 * declares them), so each `*.test.ts` file still owns its own
 * `@supabase/supabase-js` / `./parseQuota` / `./parseQuotaRecovery` mocks —
 * only the plain data below is shared.
 */

export const TEST_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  RESEND_API_KEY: "re_test",
  RESEND_FROM: "test@example.com",
  APP_ORIGIN: "https://app.example.com",
  AI_GATEWAY_ACCOUNT_ID: "acct",
  AI_GATEWAY_ID: "gateway",
  GOOGLE_AI_STUDIO_API_KEY: "key",
};

export const ENTITLED_PAYLOAD = {
  is_entitled: true,
  plan: "ai_tier",
  status: "active",
  resumes_used: 0,
  resumes_limit: 50,
};

/**
 * `claimParseAttempt()`'s (`parseQuota.ts`) possible resolved shapes, shared
 * plain data for every `*.test.ts` file that mocks `./parseQuota` — each
 * still declares its own `vi.mock(...)` call (per-file, Vitest hoists
 * within the declaring file) and its own `attemptId` where it matters, but
 * the shape itself is common enough to be worth not re-typing per file.
 */
export const ATTEMPT_ID = 501;

// The fencing-token value (review Finding C2) a fresh claim carries. Every
// `*.test.ts` file that asserts a `confirmParseAttempt`/`releaseParseAttempt`
// call shape uses this same constant, matching what `CLAIMED_ATTEMPT` below
// hands the route.
export const GENERATION = 1;

export const CLAIMED_ATTEMPT = {
  ok: true as const,
  outcome: {
    outcome: "claimed" as const,
    attempt_id: ATTEMPT_ID,
    generation: GENERATION,
  },
};

export const CAP_REACHED_ATTEMPT = {
  ok: true as const,
  outcome: { outcome: "cap_reached" as const },
};

export const CONFLICT_ATTEMPT = {
  ok: true as const,
  outcome: { outcome: "conflict" as const, attempt_id: ATTEMPT_ID },
};

export const CLAIM_RPC_FAILED = { ok: false as const };

/**
 * Finding 12 closure: `claim_ai_parse_attempt()`'s "replay" outcome now
 * carries `result_schema_version` — defaults to the Worker's own CURRENT
 * constant so a plain `replayAttempt(payload)` call is a same-version
 * replay by default; pass an explicit version to build a stale-contract
 * fixture.
 */
export function replayAttempt(
  result: unknown,
  resultSchemaVersion: number = CURRENT_PARSE_RESULT_SCHEMA_VERSION,
) {
  return {
    ok: true as const,
    outcome: {
      outcome: "replay" as const,
      attempt_id: ATTEMPT_ID,
      result,
      result_schema_version: resultSchemaVersion,
    },
  };
}

/** Every `confirmParseAttempt`/`releaseParseAttempt` mock in this suite
 * defaults to the durable-success outcome; a test that needs a different
 * outcome (superseded, failed) overrides it explicitly. */
export const APPLIED_CONFIRM_OUTCOME = { outcome: "applied" as const };
export const APPLIED_RELEASE_OUTCOME = { outcome: "applied" as const };

export function makeExtract(
  overrides: Partial<RawExtraction> = {},
): RawExtraction {
  return {
    name_en: { value: "Rivky", confidence: 0.95 },
    name_he: { value: "רבקה", confidence: 0.9 },
    father_en: { value: null, confidence: 0 },
    father_he: { value: null, confidence: 0 },
    mother_en: { value: null, confidence: 0 },
    mother_he: { value: null, confidence: 0 },
    seminary_en: { value: "Bais Yaakov", confidence: 0.85 },
    seminary_he: { value: null, confidence: 0 },
    shul_en: { value: null, confidence: 0 },
    shul_he: { value: null, confidence: 0 },
    location_en: { value: "Lakewood, NJ", confidence: 0.88 },
    location_he: { value: null, confidence: 0 },
    age: { value: 24, confidence: 0.92 },
    height: { value: "5'6\"", confidence: 0.8 },
    sections: { learningHistory: [], references: [] },
    ...overrides,
  };
}

/**
 * Finding 12 closure: `ParseResultPayloadSchema` requires every one of the
 * fourteen fields to be present (each nullable, none optional) — a partial
 * `fields` object like the old `{ name_en: "Cached Rivky" }` fixture fails
 * validation and is treated as corruption by `resolveParseClaim.ts` /
 * `resolveConfirmOutcome.ts`. This builds a fully-shaped, schema-valid
 * fields object every replay/superseded-replay fixture can start from.
 */
export function makeParseResultFields(
  overrides: Partial<Record<string, string | number | null>> = {},
): Record<string, string | number | null> {
  return {
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
    ...overrides,
  };
}

/** A fully schema-valid `ParseResultPayload` — see `makeParseResultFields()`
 * above for why a partial `fields` object is not enough. */
export function makeParseResultPayload(
  overrides: {
    fields?: Partial<Record<string, string | number | null>>;
    lowConfidenceFields?: string[];
  } = {},
) {
  return {
    fields: makeParseResultFields(overrides.fields),
    lowConfidenceFields: overrides.lowConfidenceFields ?? [],
    sections: { learningHistory: [], references: [] },
    rawDraft: {},
  };
}
