import {
  GEMINI_LEGACY_RESUME_RESPONSE_SCHEMA,
  GEMINI_RESUME_RESPONSE_SCHEMA,
} from "./geminiResponseSchema";
import { DocxExtractionError, extractDocxText } from "./docxExtractor";
import {
  type ExtractorThinkingLevel,
  type ExtractorFallbackReason,
  rememberExtractorShapeMetadata,
  logExtractorAttempt,
  logExtractorFailure,
} from "./rereadDiagnostics";
import {
  FULL_RESUME_PROMPT,
  GEMINI_MAX_OUTPUT_TOKENS,
  LEGACY_RECOVERY_PROMPT,
  SAFETY_PROMPT,
} from "./geminiModelProbeFixture.mjs";

export { GEMINI_MAX_OUTPUT_TOKENS } from "./geminiModelProbeFixture.mjs";

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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
  /** Optional Cloudflare AI Gateway token for the unified-billing provider. */
  CF_AI_TOKEN?: string;
  /** `google-key` preserves the existing path; `cf-unified` opts into Responses API. */
  EXTRACT_PROVIDER?: string;
  /** Allow-listed Cloudflare model used when EXTRACT_PROVIDER is cf-unified. */
  EXTRACT_MODEL?: string;
  /** Optional Cloudflare or explicitly Google fallback model. */
  EXTRACT_FALLBACK_MODEL?: string;
  /** Optional model override; invalid values fall back to the default. */
  GEMINI_MODEL?: string;
  /** Optional one-shot fallback after primary transient exhaustion or 404. */
  GEMINI_FALLBACK_MODEL?: string;
  /** Optional integer string: -1 or 0..24576; unset sends no thinking config. */
  GEMINI_THINKING_BUDGET?: string;
  /** Optional Gemini 3.x thinking level for the primary model. */
  GEMINI_THINKING_LEVEL?: string;
  /** Optional Gemini 3.x thinking level for the fallback model. */
  GEMINI_FALLBACK_THINKING_LEVEL?: string;
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
 * `GEMINI_EXTRACT_TIMEOUT_MS` is the timeout for one provider attempt. The
 * retry budget below leaves roughly 4 minutes of margin under the 5-minute
 * staleness window for the latency this timeout does NOT cover: the pre-fetch
 * attachment `list()` + `download()` (`index.ts` steps 6-7) and the
 * post-fetch Zod validation + `confirm_ai_parse_attempt()` round trip
 * (`index.ts` step 10) both run outside this function and add real time on
 * top of it. Keep this a NAMED constant, never a magic number inline, and
 * keep it meaningfully shorter than `c_stale_after` — do not let the two
 * drift toward each other.
 */
export const GEMINI_EXTRACT_TIMEOUT_MS = 30_000;

/** The total primary-plus-fallback provider budget, below the browser's 90s deadline. */
export const GEMINI_RETRY_OVERALL_BUDGET_MS = 80_000;
export const GEMINI_RETRY_MAX_ATTEMPTS = 3;
/** Primary provider requests, including at most one legacy JSON recovery. */
export const GEMINI_PRIMARY_MAX_PROVIDER_REQUESTS = GEMINI_RETRY_MAX_ATTEMPTS;
/** Fallback is deliberately one provider request with no JSON recovery. */
export const GEMINI_FALLBACK_MAX_PROVIDER_REQUESTS = 1;
/** Time reserved for the one-shot fallback whenever a fallback is configured. */
export const GEMINI_FALLBACK_RESERVE_MS = 25_000;
/** The fallback may use a longer single attempt than the primary. */
export const GEMINI_FALLBACK_MAX_ATTEMPT_TIMEOUT_MS = 45_000;
/** Keep one second of the overall budget outside the fallback fetch itself. */
export const GEMINI_FALLBACK_DEADLINE_MARGIN_MS = 1_000;
export const GEMINI_MAX_TOTAL_PROVIDER_REQUESTS =
  GEMINI_PRIMARY_MAX_PROVIDER_REQUESTS + GEMINI_FALLBACK_MAX_PROVIDER_REQUESTS;
export const GEMINI_RETRY_INITIAL_BACKOFF_MS = 1_000;
export const GEMINI_RETRY_MAX_BACKOFF_MS = 2_000;
export const GEMINI_RETRY_AFTER_CAP_MS = 5_000;
export const GEMINI_MIN_ATTEMPT_TIMEOUT_MS = 5_000;

export const DEFAULT_CF_MODEL = "openai/gpt-6-luna";
const CF_MODEL_ALLOWLIST = new Set([
  "openai/gpt-6-luna",
  "openai/gpt-5.6-luna",
]);
const CF_MODEL_PATTERN = /^openai\/[a-z0-9.-]{1,80}$/u;
const CLOUDFLARE_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9]{16,64}$/u;
const EXTRACT_PROVIDER_VALUES = new Set(["google-key", "cf-unified"]);
type ExtractProvider = "google-key" | "cf-unified";

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
  constructor(
    public readonly status: number,
    public readonly retryAfterMs?: number,
  ) {
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

/** Thrown only after all allowed transient attempts have been exhausted. */
export class ExtractorProviderBusyError extends Error {
  constructor(public readonly includedTimeout = false) {
    super("Gemini extraction provider is busy");
    this.name = "ExtractorProviderBusyError";
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

// Floating alias, not a pinned version by default. Operators can change the
// model without a code release, but only to a Gemini-shaped identifier so a
// secret or URL cannot enter the request path or logs.
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_MODEL_PATTERN = /^gemini-[a-z0-9.-]{1,60}$/;

function isTimeoutAbort(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function configuredModel(
  value: unknown,
  variable: "GEMINI_MODEL" | "GEMINI_FALLBACK_MODEL" | "EXTRACT_FALLBACK_MODEL",
  defaultValue: string | undefined,
): string | undefined {
  if (value === undefined || value === "") return defaultValue;
  if (typeof value === "string" && GEMINI_MODEL_PATTERN.test(value)) {
    return value;
  }
  // Keep configuration diagnostics static: never echo the invalid value.
  console.error("parse.extract.config.invalid", { variable });
  return defaultValue;
}

function configuredProvider(value: unknown): ExtractProvider {
  if (value === undefined || value === "") return "google-key";
  if (typeof value === "string" && EXTRACT_PROVIDER_VALUES.has(value)) {
    return value as ExtractProvider;
  }
  console.error("parse.extract.config.invalid", {
    variable: "EXTRACT_PROVIDER",
  });
  return "google-key";
}

function configuredCloudflareModel(
  value: unknown,
  variable: "EXTRACT_MODEL" | "EXTRACT_FALLBACK_MODEL",
  defaultValue: string | undefined,
): string | undefined {
  if (value === undefined || value === "") return defaultValue;
  if (
    typeof value === "string" &&
    CF_MODEL_PATTERN.test(value) &&
    CF_MODEL_ALLOWLIST.has(value)
  ) {
    return value;
  }
  console.error("parse.extract.config.invalid", { variable });
  return undefined;
}

function isGeminiModel(value: string): boolean {
  return GEMINI_MODEL_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type JsonSchema = {
  type: string;
  nullable?: boolean;
  enum?: string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};

function toOpenAiJsonSchema(schema: JsonSchema): Record<string, unknown> {
  const typeMap: Record<string, string> = {
    STRING: "string",
    NUMBER: "number",
    INTEGER: "integer",
    BOOLEAN: "boolean",
    ARRAY: "array",
    OBJECT: "object",
  };
  const mappedType = typeMap[schema.type] ?? "string";
  const result: Record<string, unknown> = { type: mappedType };
  if (schema.enum) result.enum = [...schema.enum];
  if (schema.items) result.items = toOpenAiJsonSchema(schema.items);
  if (schema.type === "OBJECT") {
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const mappedProperties: Record<string, Record<string, unknown>> = {};
    for (const [key, property] of Object.entries(properties)) {
      const mapped = toOpenAiJsonSchema(property);
      if (!required.has(key)) {
        const propertyType = mapped.type;
        mapped.type = [propertyType, "null"];
        if (Array.isArray(mapped.enum) && !mapped.enum.includes(null)) {
          mapped.enum.push(null);
        }
      }
      mappedProperties[key] = mapped;
    }
    result.properties = mappedProperties;
    result.required = Object.keys(properties);
    result.additionalProperties = false;
  }
  if (schema.nullable) {
    const propertyType = result.type;
    result.type = [propertyType, "null"];
    if (Array.isArray(result.enum) && !result.enum.includes(null)) {
      result.enum.push(null);
    }
  }
  return result;
}

const OPENAI_RESUME_RESPONSE_SCHEMA = toOpenAiJsonSchema(
  GEMINI_RESUME_RESPONSE_SCHEMA as JsonSchema,
);

function configuredThinkingBudget(value: unknown): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (parsed === -1) return undefined;
  if (Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 24_576) {
    return parsed;
  }
  // Keep configuration diagnostics static: never echo the invalid value.
  console.error("parse.extract.config.invalid", {
    variable: "GEMINI_THINKING_BUDGET",
  });
  return undefined;
}

function configuredThinkingLevel(
  value: unknown,
  variable: "GEMINI_THINKING_LEVEL" | "GEMINI_FALLBACK_THINKING_LEVEL",
): ExtractorThinkingLevel | undefined {
  if (value === undefined || value === "") return undefined;
  if (
    typeof value === "string" &&
    ["minimal", "low", "medium", "high"].includes(value)
  ) {
    return value as ExtractorThinkingLevel;
  }
  // Keep configuration diagnostics static: never echo the invalid value.
  console.error("parse.extract.config.invalid", { variable });
  return undefined;
}

function isGemini3Model(model: string): boolean {
  return /^gemini-3[.-]/u.test(model);
}

function isTransientFailure(error: unknown): boolean {
  if (error instanceof ExtractorTimeoutError) return true;
  if (!(error instanceof ExtractorProviderError)) return false;
  return [429, 500, 502, 503, 504].includes(error.status);
}

function providerStatusClass(status: number): "transient" | "permanent" {
  return [429, 500, 502, 503, 504].includes(status) ? "transient" : "permanent";
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(GEMINI_RETRY_AFTER_CAP_MS, Math.round(seconds * 1000));
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(
    GEMINI_RETRY_AFTER_CAP_MS,
    Math.max(0, timestamp - Date.now()),
  );
}

function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return retryAfterMs;
  const exponential = Math.min(
    GEMINI_RETRY_MAX_BACKOFF_MS,
    GEMINI_RETRY_INITIAL_BACKOFF_MS * 2 ** (attempt - 1),
  );
  // Full jitter keeps a burst of overloaded requests from synchronizing.
  return Math.floor(exponential * (0.5 + Math.random() * 0.5));
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function cloudflareResponsesEndpoint(accountId: string): string {
  if (!CLOUDFLARE_ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new ExtractorProviderError(400);
  }
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/responses`;
}

function cloudflareInputPart(
  contentPart:
    { text: string } | { inline_data: { mime_type: string; data: string } },
  mimeType: string,
): Record<string, unknown> {
  if ("text" in contentPart) {
    return { type: "input_text", text: contentPart.text };
  }
  return {
    type: "input_file",
    filename: mimeType === "application/pdf" ? "resume.pdf" : "resume",
    file_data: `data:${mimeType};base64,${contentPart.inline_data.data}`,
  };
}

function buildCloudflareRequestBody(
  model: string,
  prompt: string,
  contentPart:
    { text: string } | { inline_data: { mime_type: string; data: string } },
  mimeType: string,
): Record<string, unknown> {
  return {
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: `${prompt}${SAFETY_PROMPT}` },
          cloudflareInputPart(contentPart, mimeType),
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "resume_extraction",
        strict: true,
        schema: OPENAI_RESUME_RESPONSE_SCHEMA,
      },
    },
    max_output_tokens: GEMINI_MAX_OUTPUT_TOKENS,
  };
}

function cloudflareOutputText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.output)) return "{}";
  for (const outputItem of value.output) {
    if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) continue;
    for (const content of outputItem.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
    }
  }
  return "{}";
}

function cloudflareUsageMetadata(value: unknown): Record<string, number> {
  const usage = isRecord(value) && isRecord(value.usage) ? value.usage : {};
  return {
    promptTokenCount:
      typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
    candidatesTokenCount:
      typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
    thoughtsTokenCount: 0,
  };
}

type ProviderRequestBudget = {
  max: number;
  used: number;
};

/**
 * Production resume extractor. The default path calls Google's Gemini API
 * through the Cloudflare AI Gateway (AD-8); `cf-unified` opts into the
 * Cloudflare Responses API with unified billing. The prompt is narrow and
 * grounded: it may extract the listed bilingual fields, but nothing else.
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
      let contentPart:
        { text: string } | { inline_data: { mime_type: string; data: string } };
      const extractProvider = configuredProvider(env.EXTRACT_PROVIDER);
      if (
        extractProvider === "cf-unified" &&
        !CLOUDFLARE_ACCOUNT_ID_PATTERN.test(env.AI_GATEWAY_ACCOUNT_ID)
      ) {
        throw new ExtractorProviderError(400);
      }
      const contentStartedAt = Date.now();
      try {
        contentPart =
          mimeType === "text/plain"
            ? { text: new TextDecoder().decode(fileBytes) }
            : mimeType === DOCX_MIME_TYPE
              ? { text: await extractDocxText(fileBytes) }
              : {
                  inline_data: {
                    mime_type: mimeType,
                    data: arrayBufferToBase64(fileBytes),
                  },
                };
      } catch (error) {
        if (error instanceof DocxExtractionError) {
          logExtractorFailure(error, {
            durationMs: Date.now() - contentStartedAt,
            docxFailure: error.failure,
          });
        } else {
          logExtractorFailure(error, {
            durationMs: Date.now() - contentStartedAt,
          });
        }
        throw error;
      }

      const deadline = Date.now() + GEMINI_RETRY_OVERALL_BUDGET_MS;
      const thinkingBudget = configuredThinkingBudget(
        env.GEMINI_THINKING_BUDGET,
      );
      const thinkingLevel = configuredThinkingLevel(
        env.GEMINI_THINKING_LEVEL,
        "GEMINI_THINKING_LEVEL",
      );
      const fallbackThinkingLevel = configuredThinkingLevel(
        env.GEMINI_FALLBACK_THINKING_LEVEL,
        "GEMINI_FALLBACK_THINKING_LEVEL",
      );
      let sawTimeout = false;
      let lastTimeoutMs: number | undefined;
      const requestOnce = async (
        provider: ExtractProvider,
        model: string,
        prompt: string,
        responseSchema: typeof GEMINI_RESUME_RESPONSE_SCHEMA,
        attempt: number,
        budget: ProviderRequestBudget,
        modelDeadline: number,
        modelThinkingLevel?: ExtractorThinkingLevel,
        isFallback = false,
        fallbackReason?: ExtractorFallbackReason,
      ): Promise<unknown> => {
        const requestStartedAt = Date.now();
        const remainingMs = modelDeadline - requestStartedAt;
        const availableAttemptMs = isFallback
          ? remainingMs - GEMINI_FALLBACK_DEADLINE_MARGIN_MS
          : remainingMs;
        if (availableAttemptMs < GEMINI_MIN_ATTEMPT_TIMEOUT_MS) {
          throw new ExtractorProviderBusyError();
        }
        budget.used += 1;
        const attemptTimeoutMs = isFallback
          ? Math.min(GEMINI_FALLBACK_MAX_ATTEMPT_TIMEOUT_MS, availableAttemptMs)
          : Math.min(GEMINI_EXTRACT_TIMEOUT_MS, availableAttemptMs);
        const modelUsesThinkingLevel =
          modelThinkingLevel !== undefined && isGemini3Model(model);
        logExtractorAttempt(
          model,
          attempt,
          fallbackReason,
          modelUsesThinkingLevel ? modelThinkingLevel : undefined,
        );
        if (provider === "cf-unified" && !env.CF_AI_TOKEN) {
          const missingToken = new ExtractorProviderError(401);
          logExtractorFailure(missingToken, {
            durationMs: Date.now() - requestStartedAt,
            attempt,
            statusClass: "permanent",
            reason: "bad_request",
            httpStatus: 401,
          });
          throw missingToken;
        }
        const baseUrl =
          provider === "cf-unified"
            ? cloudflareResponsesEndpoint(env.AI_GATEWAY_ACCOUNT_ID)
            : `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/google-ai-studio/v1beta/models/${model}:generateContent`;
        let httpStatus: number | undefined;
        let finishReason: unknown;
        let usageMetadata: unknown;
        const requestBody =
          provider === "cf-unified"
            ? buildCloudflareRequestBody(model, prompt, contentPart, mimeType)
            : {
                contents: [
                  {
                    parts: [{ text: `${prompt}${SAFETY_PROMPT}` }, contentPart],
                  },
                ],
                generationConfig: {
                  responseMimeType: "application/json",
                  responseSchema,
                  maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
                  ...(modelUsesThinkingLevel
                    ? { thinkingConfig: { thinkingLevel: modelThinkingLevel } }
                    : !isGemini3Model(model) &&
                        thinkingBudget !== undefined &&
                        model.includes("flash")
                      ? { thinkingConfig: { thinkingBudget } }
                      : {}),
                },
              };
        const headers: Record<string, string> =
          provider === "cf-unified"
            ? {
                Authorization: `Bearer ${env.CF_AI_TOKEN}`,
                "Content-Type": "application/json",
              }
            : {
                "Content-Type": "application/json",
                "x-goog-api-key": env.GOOGLE_AI_STUDIO_API_KEY,
              };

        let response: Response;
        try {
          response = await fetch(baseUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(attemptTimeoutMs),
          });
          httpStatus = response.status;
        } catch (error) {
          if (isTimeoutAbort(error)) {
            const timeout = new ExtractorTimeoutError(attemptTimeoutMs);
            sawTimeout = true;
            lastTimeoutMs = attemptTimeoutMs;
            logExtractorFailure(timeout, {
              durationMs: Date.now() - requestStartedAt,
              attempt,
              statusClass: "timeout",
            });
            throw timeout;
          }
          logExtractorFailure(error, {
            durationMs: Date.now() - requestStartedAt,
            attempt,
            statusClass: "network",
          });
          throw error;
        }

        if (!response.ok) {
          // Finding 5: deliberately do NOT read/log response.text() here —
          // see ExtractorProviderError's own comment above.
          const providerError = new ExtractorProviderError(
            response.status,
            parseRetryAfter(response.headers.get("Retry-After")),
          );
          logExtractorFailure(providerError, {
            durationMs: Date.now() - requestStartedAt,
            attempt,
            statusClass: providerStatusClass(response.status),
            ...(response.status === 400 ? { reason: "bad_request" } : {}),
            httpStatus,
          });
          throw providerError;
        }

        try {
          const json = (await response.json()) as unknown;
          finishReason =
            provider === "cf-unified"
              ? isRecord(json) && typeof json.status === "string"
                ? json.status
                : "UNKNOWN"
              : isRecord(json) &&
                  Array.isArray(json.candidates) &&
                  isRecord(json.candidates[0])
                ? json.candidates[0].finishReason
                : undefined;
          usageMetadata =
            provider === "cf-unified"
              ? cloudflareUsageMetadata(json)
              : isRecord(json)
                ? json.usageMetadata
                : undefined;
          const text =
            provider === "cf-unified"
              ? cloudflareOutputText(json)
              : isRecord(json) &&
                  Array.isArray(json.candidates) &&
                  isRecord(json.candidates[0]) &&
                  isRecord(json.candidates[0].content) &&
                  Array.isArray(json.candidates[0].content.parts) &&
                  isRecord(json.candidates[0].content.parts[0]) &&
                  typeof json.candidates[0].content.parts[0].text === "string"
                ? json.candidates[0].content.parts[0].text
                : "{}";

          // Finding 14: no `.parse()`/`.safeParse()` here — this function stops
          // being a validation gate. `toDraft()` (parsedResumeDraft.ts)
          // validates per field, so one malformed field never discards the
          // other good ones. A SyntaxError is handled by the one legacy-shape
          // recovery request below; any second failure propagates to index.ts's
          // existing extractor catch, which releases the reservation.
          const raw = JSON.parse(text) as unknown;
          rememberExtractorShapeMetadata(raw, {
            model,
            finishReason,
            usageMetadata,
          });
          return raw;
        } catch (error) {
          logExtractorFailure(error, {
            durationMs: Date.now() - requestStartedAt,
            attempt,
            statusClass: "validation",
            httpStatus,
            finishReason,
            usageMetadata,
          });
          throw error;
        }
      };

      const requestWithRetries = async (
        provider: ExtractProvider,
        model: string,
        prompt: string,
        responseSchema: typeof GEMINI_RESUME_RESPONSE_SCHEMA,
        maxAttempts: number,
        budget: ProviderRequestBudget,
        modelDeadline: number,
        modelThinkingLevel?: ExtractorThinkingLevel,
        isFallback = false,
        fallbackReason?: ExtractorFallbackReason,
      ): Promise<unknown> => {
        let lastError: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (Date.now() >= modelDeadline || budget.used >= budget.max) break;
          try {
            return await requestOnce(
              provider,
              model,
              prompt,
              responseSchema,
              attempt,
              budget,
              modelDeadline,
              modelThinkingLevel,
              isFallback,
              fallbackReason,
            );
          } catch (error) {
            lastError = error;
            if (!isTransientFailure(error) || attempt === maxAttempts) break;
            const retryAfterMs =
              error instanceof ExtractorProviderError
                ? error.retryAfterMs
                : undefined;
            const delayMs = retryDelayMs(attempt, retryAfterMs);
            if (Date.now() + delayMs > modelDeadline) break;
            await sleep(delayMs);
          }
        }
        if (lastError && isTransientFailure(lastError)) {
          throw new ExtractorProviderBusyError(sawTimeout);
        }
        throw lastError ?? new ExtractorProviderBusyError(sawTimeout);
      };

      const runModel = async (
        provider: ExtractProvider,
        model: string,
        budget: ProviderRequestBudget,
        modelDeadline: number,
        maxAttempts = GEMINI_RETRY_MAX_ATTEMPTS,
        allowLegacyRecovery = true,
        modelThinkingLevel?: ExtractorThinkingLevel,
        isFallback = false,
        fallbackReason?: ExtractorFallbackReason,
      ): Promise<unknown> => {
        try {
          return await requestWithRetries(
            provider,
            model,
            FULL_RESUME_PROMPT,
            GEMINI_RESUME_RESPONSE_SCHEMA,
            maxAttempts,
            budget,
            modelDeadline,
            modelThinkingLevel,
            isFallback,
            fallbackReason,
          );
        } catch (error) {
          if (
            !(error instanceof SyntaxError) ||
            !allowLegacyRecovery ||
            budget.used >= budget.max ||
            Date.now() >= modelDeadline
          ) {
            throw error;
          }
          // A successful response with invalid JSON gets the existing one-shot
          // legacy recovery. It is validation recovery, not a retry.
          return requestWithRetries(
            provider,
            model,
            LEGACY_RECOVERY_PROMPT,
            GEMINI_LEGACY_RESUME_RESPONSE_SCHEMA,
            1,
            budget,
            modelDeadline,
            modelThinkingLevel,
            isFallback,
            fallbackReason,
          );
        }
      };

      let primaryProvider = extractProvider;
      let primaryModel: string;
      let fallbackProvider = extractProvider;
      let fallbackModel: string | undefined;
      if (extractProvider === "cf-unified") {
        const configuredPrimaryModel = configuredCloudflareModel(
          env.EXTRACT_MODEL,
          "EXTRACT_MODEL",
          DEFAULT_CF_MODEL,
        );
        if (configuredPrimaryModel === undefined) {
          throw new ExtractorProviderError(400);
        }
        primaryModel = configuredPrimaryModel;
        const configuredFallback = env.EXTRACT_FALLBACK_MODEL;
        if (
          typeof configuredFallback === "string" &&
          isGeminiModel(configuredFallback)
        ) {
          if (env.GOOGLE_AI_STUDIO_API_KEY) {
            fallbackProvider = "google-key";
            fallbackModel = configuredFallback;
          }
        } else {
          fallbackModel = configuredCloudflareModel(
            configuredFallback,
            "EXTRACT_FALLBACK_MODEL",
            undefined,
          );
        }
      } else {
        primaryProvider = "google-key";
        primaryModel = configuredModel(
          env.GEMINI_MODEL,
          "GEMINI_MODEL",
          DEFAULT_GEMINI_MODEL,
        ) as string;
        fallbackModel = configuredModel(
          env.GEMINI_FALLBACK_MODEL,
          "GEMINI_FALLBACK_MODEL",
          undefined,
        );
      }
      const hasFallbackModel =
        fallbackModel !== undefined &&
        (fallbackProvider !== primaryProvider ||
          fallbackModel !== primaryModel);
      const primaryDeadline = hasFallbackModel
        ? deadline - GEMINI_FALLBACK_RESERVE_MS
        : deadline;
      const primaryMaxAttempts = hasFallbackModel
        ? Math.min(
            GEMINI_RETRY_MAX_ATTEMPTS,
            Math.ceil(
              (GEMINI_RETRY_OVERALL_BUDGET_MS - GEMINI_FALLBACK_RESERVE_MS) /
                GEMINI_EXTRACT_TIMEOUT_MS,
            ),
          )
        : GEMINI_RETRY_MAX_ATTEMPTS;
      const timeoutFailure = (): ExtractorTimeoutError =>
        new ExtractorTimeoutError(lastTimeoutMs ?? GEMINI_EXTRACT_TIMEOUT_MS);
      const primaryBudget: ProviderRequestBudget = {
        max: GEMINI_PRIMARY_MAX_PROVIDER_REQUESTS,
        used: 0,
      };
      try {
        return await runModel(
          primaryProvider,
          primaryModel,
          primaryBudget,
          primaryDeadline,
          primaryMaxAttempts,
          true,
          thinkingLevel,
        );
      } catch (error) {
        const fallbackReason: ExtractorFallbackReason | undefined =
          error instanceof ExtractorProviderBusyError
            ? "transient_exhausted"
            : error instanceof ExtractorProviderError && error.status === 404
              ? "model_not_found"
              : undefined;
        if (
          fallbackReason !== undefined &&
          hasFallbackModel &&
          fallbackModel !== undefined
        ) {
          const fallbackBudget: ProviderRequestBudget = {
            max: GEMINI_FALLBACK_MAX_PROVIDER_REQUESTS,
            used: 0,
          };
          try {
            // The fallback is a single bounded rescue attempt, not a second
            // full retry or legacy-recovery sequence. It shares the primary's
            // overall deadline.
            return await runModel(
              fallbackProvider,
              fallbackModel,
              fallbackBudget,
              deadline,
              1,
              false,
              fallbackThinkingLevel,
              true,
              fallbackReason,
            );
          } catch (fallbackError) {
            if (sawTimeout) throw timeoutFailure();
            throw fallbackError;
          }
        }
        if (!(error instanceof ExtractorProviderBusyError)) {
          // A later permanent provider response does not erase an earlier
          // timeout. The permanent status remains in its attempt diagnostic,
          // while the user gets the retryable timeout outcome.
          if (sawTimeout) throw timeoutFailure();
          throw error;
        }
        if (sawTimeout) throw timeoutFailure();
        throw error;
      }
    },
  };
}
