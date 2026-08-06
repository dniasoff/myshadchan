import { GEMINI_RESUME_RESPONSE_SCHEMA } from "./geminiResponseSchema";

// Kept re-exported for backward compatibility with existing importers
// (`index.ts`, `parseTestFixtures.ts`) even though `extract()` no longer
// returns this type — see the interface comment below. `RawExtraction`
// remains a valid, still-useful shape (a fake extractor may still choose to
// return one; `parsedResumeDraft.ts`'s own conformance test uses it too).
export type { RawExtraction } from "./parsedResumeDraft";

/**
 * Finding 14 (Epic 11 adversarial review): `extract()` returns `unknown`,
 * not a validated `RawExtraction`. The extractor no longer gates success —
 * `parsedResumeDraft.ts`'s `toDraft()` validates the result PER TOP-LEVEL
 * FIELD, so one malformed field costs only that field, never the other
 * ~13 good, already-paid-for ones. See that module's header comment.
 */
export interface ResumeExtractor {
  extract(fileBytes: ArrayBuffer, mimeType: string): Promise<unknown>;
}

export type ParseEnv = {
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  GOOGLE_AI_STUDIO_API_KEY: string;
};

/**
 * Finding 7 (Epic 11 adversarial review, P2): `claim_ai_parse_attempt()`
 * (`supabase/schemas/02_functions.sql`) reclaims an `in_progress`
 * reservation after `c_stale_after` (5 minutes) — a still-genuinely-live
 * extraction reclaimed underneath itself is exactly how "concurrent retries
 * cannot duplicate inference" (`parseQuota.ts`) stopped being true. Without
 * a bound on this `fetch`, a slow-but-live Gemini call could run past that
 * window.
 *
 * 60s leaves roughly 4 minutes of margin under the 5-minute staleness
 * window for the latency this timeout does NOT cover: the pre-fetch
 * attachment `list()` + `download()` (`index.ts` steps 6-7) and the
 * post-fetch Zod validation + `confirm_ai_parse_attempt()` round trip
 * (`index.ts` step 10) both run outside this function and add real time on
 * top of it. Keep this a NAMED constant, never a magic number inline, and
 * keep it meaningfully shorter than `c_stale_after` — do not let the two
 * drift toward each other.
 */
export const GEMINI_EXTRACT_TIMEOUT_MS = 60_000;

/**
 * Finding 5 (Epic 11 adversarial review, P1): thrown when Gemini responds
 * with a non-2xx status. Carries ONLY the HTTP status — never the response
 * body. The body can echo back flagged/rejected request content (which may
 * include resume fragments), so it must never enter an Error's own
 * `.message`, where a downstream `console.error(label, error)` would log it
 * verbatim (this is precisely how the pre-fix version of this file leaked).
 * Cloudflare AI Gateway's own request/response analytics (already in front
 * of every call, AD-8) is the correct place to inspect a provider body for
 * debugging — Worker logs stay content-free.
 */
export class ExtractorProviderError extends Error {
  constructor(public readonly status: number) {
    super("Gemini extraction failed");
    this.name = "ExtractorProviderError";
  }
}

/**
 * Finding 7: thrown when the Gemini call does not complete within
 * `GEMINI_EXTRACT_TIMEOUT_MS`. Distinguishable from `ExtractorProviderError`
 * and from a generic network failure so the route (`index.ts`) can react —
 * today that reaction is the same as any other extractor throw
 * (`releaseAndFail`: the reservation is released, never left charged for a
 * parse the caller never received).
 */
export class ExtractorTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super("Gemini extraction timed out");
    this.name = "ExtractorTimeoutError";
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Floating alias, not a pinned version: Google retires dated/numbered model
// names (gemini-1.5-flash was retired outright — absent from the live model
// list, not just deprecated) and a pin then fails at inference time, past the
// auth gate, on the one call that consumes paid inference. `gemini-flash-latest`
// always resolves to Google's current flash model, so a future retirement
// cannot silently reintroduce this failure.
const GEMINI_MODEL = "gemini-flash-latest";

function isTimeoutAbort(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/**
 * Production resume extractor. Calls Google's Gemini API **only through the
 * Cloudflare AI Gateway** (AD-8). The prompt is narrow and grounded: it may
 * extract the listed bilingual fields, but nothing else.
 *
 * Finding 14 (Epic 11 adversarial review, P2): the request now sends an
 * explicit `generationConfig.responseSchema`
 * (`geminiResponseSchema.ts`'s `GEMINI_RESUME_RESPONSE_SCHEMA`) — Gemini's
 * own structured-output mechanism
 * (https://ai.google.dev/gemini-api/docs/generate-content/structured-output),
 * not merely `responseMimeType` plus a prose field list. The previous
 * comment here claimed the response was "constrained to the
 * RawExtractionSchema shape" while the request carried no schema at all —
 * a guarantee the code did not provide, which is worse than no comment.
 * `responseSchema` constrains the model's own output shape; Zod
 * (`parsedResumeDraft.ts`) remains the actual validation authority — the
 * schema reduces how often Zod ever needs to reject anything, it is not a
 * replacement for it.
 */
export function geminiExtractor(env: ParseEnv): ResumeExtractor {
  return {
    async extract(fileBytes: ArrayBuffer, mimeType: string): Promise<unknown> {
      const baseUrl = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/google-ai-studio/v1beta/models/${GEMINI_MODEL}:generateContent`;

      const requestBody = {
        contents: [
          {
            parts: [
              {
                text:
                  "Extract the following fields from this resume as JSON. " +
                  "Return confidence 0-1 per field. If a field is absent or unclear, return null for its value and confidence 0. " +
                  // Review fix (Finding 3): father and mother are SEPARATE
                  // fields in the target form (ShidduchInputs.tsx) and in
                  // public.shidduchim — a combined "parents" field had
                  // nothing downstream that read it, so extract them split.
                  "Fields: name_en, name_he, father_en, father_he, mother_en, mother_he, seminary_en, seminary_he, shul_en, shul_he, location_en, location_he, age, height. " +
                  "Also include sections.learningHistory as [{label, value}] and sections.references as [{name, relationship, phone}]. " +
                  "Do not invent information. Return only valid JSON.",
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: arrayBufferToBase64(fileBytes),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: GEMINI_RESUME_RESPONSE_SCHEMA,
        },
      };

      let response: Response;
      try {
        response = await fetch(baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GOOGLE_AI_STUDIO_API_KEY,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(GEMINI_EXTRACT_TIMEOUT_MS),
        });
      } catch (error) {
        if (isTimeoutAbort(error)) {
          throw new ExtractorTimeoutError(GEMINI_EXTRACT_TIMEOUT_MS);
        }
        throw error;
      }

      if (!response.ok) {
        // Finding 5: deliberately do NOT read/log response.text() here —
        // see ExtractorProviderError's own comment above.
        throw new ExtractorProviderError(response.status);
      }

      const json = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

      // Finding 14: no `.parse()`/`.safeParse()` here — this function stops
      // being a validation gate. `toDraft()` (parsedResumeDraft.ts)
      // validates per field, so one malformed field never discards the
      // other good ones. `JSON.parse` can still throw on genuinely
      // malformed JSON; that throw propagates to `index.ts`'s existing
      // extractor try/catch, which releases the reservation — unchanged
      // behavior for that (rare, since `responseSchema` now constrains the
      // model's own output) edge case.
      return JSON.parse(text) as unknown;
    },
  };
}
