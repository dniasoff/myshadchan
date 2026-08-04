import { RawExtractionSchema, type RawExtraction } from "./parsedResumeDraft";

export type { RawExtraction } from "./parsedResumeDraft";

export interface ResumeExtractor {
  extract(fileBytes: ArrayBuffer, mimeType: string): Promise<RawExtraction>;
}

export type ParseEnv = {
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  GOOGLE_AI_STUDIO_API_KEY: string;
};

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

/**
 * Production resume extractor. Calls Google's Gemini API **only through the
 * Cloudflare AI Gateway** (AD-8), requesting a JSON response constrained to the
 * `RawExtractionSchema` shape. The prompt is narrow and grounded: it may extract
 * the listed bilingual fields, but nothing else.
 */
export function geminiExtractor(env: ParseEnv): ResumeExtractor {
  return {
    async extract(
      fileBytes: ArrayBuffer,
      mimeType: string,
    ): Promise<RawExtraction> {
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
        },
      };

      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GOOGLE_AI_STUDIO_API_KEY,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(
          `Gemini extraction failed: ${response.status} ${await response.text()}`,
        );
      }

      const json = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      const raw = JSON.parse(text) as unknown;

      return RawExtractionSchema.parse(raw);
    },
  };
}
