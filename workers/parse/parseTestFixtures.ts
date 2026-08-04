import type { RawExtraction } from "./resumeExtractor";

/**
 * Shared, side-effect-free fixtures for `workers/parse`'s test suite —
 * `index.test.ts`, `index.idempotency.test.ts`, `index.sizeGuard.test.ts`.
 * Deliberately holds NO `vi.mock(...)` calls: those are per-file (Vitest
 * hoists them within the file that declares them), so each `*.test.ts` file
 * still owns its own `@supabase/supabase-js` / `../shared/forAccount` mocks —
 * only the plain data below is shared.
 */

export const TEST_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
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
