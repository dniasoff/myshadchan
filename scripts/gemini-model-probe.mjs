import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GEMINI_MAX_OUTPUT_TOKENS,
  GEMINI_RESUME_RESPONSE_SCHEMA,
  FULL_RESUME_PROMPT,
  SAFETY_PROMPT,
} from "../workers/parse/geminiModelProbeFixture.mjs";

export const DIRECT_BASE_URL = "https://generativelanguage.googleapis.com";
export const CLOUDFLARE_RESPONSES_BASE_URL =
  "https://api.cloudflare.com/client/v4";
export const PER_CALL_TIMEOUT_MS = 90_000;
export const MAX_CALLS = 40;
export const MODEL_LIST_MAX_PAGES = 5;
export const REQUEST_DELAY_MS = 250;

export const DEFAULT_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
];

export const CF_UNIFIED_MODELS = ["openai/gpt-6-luna", "openai/gpt-5.6-luna"];
export const CF_UNIFIED_INPUT_VARIANTS = ["text", "pdf"];
export const CF_ENV_FILE = `${homedir()}/.env_cloudflare`;

const FIXED_FIELD_KEYS = [
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

const FINISH_REASONS = new Set([
  "FINISH_REASON_UNSPECIFIED",
  "STOP",
  "MAX_TOKENS",
  "SAFETY",
  "RECITATION",
  "LANGUAGE",
  "OTHER",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "MALFORMED_FUNCTION_CALL",
  "UNEXPECTED_TOOL_CALL",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "IMAGE_RECITATION",
  "NO_IMAGE",
  "IMAGE_OTHER",
  "UNKNOWN",
]);

const MODEL_NAME_PATTERN = /^(?:models\/)?[a-z0-9][a-z0-9._-]{0,80}$/;

export const SYNTHETIC_RESUME_TEXT = `FICTIONAL SAMPLE RESUME — NOT A REAL PERSON

Personal Details
Name: Ari Feldman
Hebrew name: ארי פלדמן
Father: Daniel Feldman
Mother: Miriam Feldman
Date of birth: 14 March 2001
Age: 25
Height: 5'10"
Gender: Male
Kohen status: No
Marital status: Single
Location: Lakewood, New Jersey

Education and Learning History
Studied at fictional Cedar Academy from 2017 to 2019.
Completed the fictional Beit Or learning program in 2023.
Current learning: morning seder at Beit Talmud and evening chavruta with Isaac.

Work
Worked as an assistant at Fictional Oak Books from 2021 to 2023.
Now manages inventory for an invented family business, North Star Supplies.

Family and Community
The fictional Feldman family is active in a local community and volunteers at
an invented food pantry. Ari enjoys cycling, cooking, and helping with youth
programs. He is described here as kind, organized, and dependable.

References
David Kaplan — teacher — 054-000-1001
Rivka Stein — mentor — +972 54 000 1002
Moshe Green — employer — (718) 555-0103
Leah Cohen — family friend — 054-000-1004
Yosef Adler — program director — +972 54 000 1005
Sarah Blum — neighbor — (718) 555-0106
Eliyahu Weiss — chavruta — 054-000-1007
Naomi Gold — volunteer coordinator — +972 54 000 1008
Benjamin Katz — supervisor — (718) 555-0109
Chana Rubin — teacher — 054-000-1010`;

const USAGE_KEYS = {
  promptTokens: "promptTokenCount",
  candidateTokens: "candidatesTokenCount",
  thoughtTokens: "thoughtsTokenCount",
};

const HELP_TEXT = `Usage: node scripts/gemini-model-probe.mjs [--provider google-key|cf-unified] [--dry-run] [MODEL ...]

Reads GOOGLE_AI_STUDIO_API_KEY and optionally GATEWAY_BASE_URL from the
environment in google-key mode. cf-unified mode reads
CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from ~/.env_cloudflare only.
MODEL arguments replace the default candidate list. --dry-run prints the
bounded plan without reading credentials or making network requests.

The google-key probe lists served generateContent models. The cf-unified probe
tries text and inline-PDF Responses API inputs with strict json_schema output,
then falls back to JSON-in-prompt only when the schema form is rejected. Both
make at most ${MAX_CALLS} total network calls. Each request has a
${PER_CALL_TIMEOUT_MS / 1000}s timeout. It never prints credentials or provider
response bodies.`;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOpenAiJsonSchema(schema) {
  const typeMap = {
    STRING: "string",
    NUMBER: "number",
    INTEGER: "integer",
    BOOLEAN: "boolean",
    ARRAY: "array",
    OBJECT: "object",
  };
  const result = { type: typeMap[schema.type] ?? "string" };
  if (Array.isArray(schema.enum)) result.enum = [...schema.enum];
  if (schema.items) result.items = toOpenAiJsonSchema(schema.items);
  if (schema.type === "OBJECT") {
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    result.properties = {};
    for (const [key, property] of Object.entries(properties)) {
      const mapped = toOpenAiJsonSchema(property);
      if (!required.has(key)) {
        mapped.type = [mapped.type, "null"];
        if (Array.isArray(mapped.enum) && !mapped.enum.includes(null)) {
          mapped.enum.push(null);
        }
      }
      result.properties[key] = mapped;
    }
    result.required = Object.keys(properties);
    result.additionalProperties = false;
  }
  if (schema.nullable) {
    result.type = [result.type, "null"];
    if (Array.isArray(result.enum) && !result.enum.includes(null)) {
      result.enum.push(null);
    }
  }
  return result;
}

function matchesSchema(value, schema) {
  if (value === null) return schema.nullable === true;
  if (
    Array.isArray(schema.enum) &&
    typeof value === "string" &&
    !schema.enum.includes(value)
  ) {
    return false;
  }
  if (schema.type === "STRING") return typeof value === "string";
  if (schema.type === "NUMBER") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (schema.type === "INTEGER") return Number.isInteger(value);
  if (schema.type === "BOOLEAN") return typeof value === "boolean";
  if (schema.type === "ARRAY") {
    return (
      Array.isArray(value) &&
      (!schema.items ||
        value.every((item) => matchesSchema(item, schema.items)))
    );
  }
  if (schema.type !== "OBJECT" || !isRecord(value)) return false;
  const properties = schema.properties ?? {};
  for (const required of schema.required ?? []) {
    if (
      !(required in value) ||
      !matchesSchema(value[required], properties[required])
    ) {
      return false;
    }
  }
  return Object.entries(value).every(
    ([key, property]) =>
      key in properties &&
      (property === null && !(schema.required ?? []).includes(key)
        ? true
        : matchesSchema(property, properties[key])),
  );
}

function nonEmpty(value) {
  if (value === null || value === undefined) return false;
  return typeof value === "string" ? value.trim() !== "" : true;
}

function safeTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeFinishReason(value) {
  return typeof value === "string" && FINISH_REASONS.has(value)
    ? value
    : "UNKNOWN";
}

export function safeModelName(value) {
  return typeof value === "string" && MODEL_NAME_PATTERN.test(value)
    ? value
    : "<redacted>";
}

export function createCallBudget(maxCalls = MAX_CALLS) {
  return { maxCalls, used: 0 };
}

function reserveCall(budget) {
  if (budget.used >= budget.maxCalls) return false;
  budget.used += 1;
  return true;
}

export function createEmitter({
  apiKey,
  writeLine = (line) => console.log(line),
  writeError = (line) => console.error(line),
} = {}) {
  return (line, stream = "stdout") => {
    const output = scrubSecrets(line, apiKey);
    if (stream === "stderr") writeError(output);
    else writeLine(output);
  };
}

export function scrubSecrets(value, apiKey) {
  let result = String(value);
  if (typeof apiKey !== "string" || apiKey.length === 0) return result;
  for (const secret of new Set([apiKey, encodeURIComponent(apiKey)])) {
    result = result.split(secret).join("<key>");
  }
  return result;
}

function containsSecret(value, apiKey) {
  return (
    typeof value === "string" &&
    typeof apiKey === "string" &&
    apiKey.length > 0 &&
    (value.includes(apiKey) || value.includes(encodeURIComponent(apiKey)))
  );
}

function normalizeModelId(value) {
  const model = value.startsWith("models/") ? value.slice(7) : value;
  if (!/^[a-z0-9][a-z0-9./_-]{0,100}$/.test(model)) {
    throw new Error("invalid model id");
  }
  return model;
}

function isGemini3Model(model) {
  return /^gemini-3(?:[.-]|$)/.test(model);
}

function isGemini25Model(model) {
  return /^gemini-2\.5(?:[.-]|$)/.test(model);
}

export function thinkingModesForModel(model) {
  if (isGemini3Model(model)) return ["unset", "minimal", "low"];
  if (isGemini25Model(model)) return ["unset", "minimal"];
  return ["unset"];
}

export function parseArgs(argv) {
  let dryRun = false;
  let help = false;
  let provider = "google-key";
  const models = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--provider") {
      provider = argv[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--provider=")) {
      provider = arg.slice("--provider=".length);
    } else if (arg.startsWith("-")) {
      throw new Error("unknown option");
    } else {
      models.push(arg);
    }
  }

  if (provider !== "google-key" && provider !== "cf-unified") {
    throw new Error("unknown provider");
  }
  const normalizedModels = models.map((model) => normalizeModelId(model));

  return {
    dryRun,
    help,
    provider,
    models:
      normalizedModels.length > 0
        ? [...new Set(normalizedModels)]
        : [...(provider === "cf-unified" ? CF_UNIFIED_MODELS : DEFAULT_MODELS)],
  };
}

export function buildProbePlan(models, provider = "google-key") {
  if (provider === "cf-unified") {
    if (
      models.some(
        (model) =>
          !/^openai\/[a-z0-9.-]{1,80}$/u.test(model) ||
          !CF_UNIFIED_MODELS.includes(model),
      )
    ) {
      throw new Error("model is not allow-listed for cf-unified");
    }
    const plan = models.flatMap((model) =>
      CF_UNIFIED_INPUT_VARIANTS.map((inputVariant) => ({
        model,
        inputVariant,
        jsonMode: "json_schema",
      })),
    );
    if (plan.length > MAX_CALLS) throw new Error("probe plan exceeds call cap");
    return plan;
  }
  const plan = models.flatMap((model) =>
    thinkingModesForModel(model).map((thinkingMode) => ({
      model,
      thinkingMode,
    })),
  );
  if (plan.length > MAX_CALLS) throw new Error("probe plan exceeds call cap");
  return plan;
}

function buildThinkingConfig(model, thinkingMode) {
  if (thinkingMode === "unset") return undefined;
  if (isGemini3Model(model)) {
    return { thinkingLevel: thinkingMode };
  }
  if (isGemini25Model(model) && thinkingMode === "minimal") {
    return { thinkingBudget: 0 };
  }
  return undefined;
}

export function buildRequestBody(model, thinkingMode) {
  const generationConfig = {
    responseMimeType: "application/json",
    responseSchema: GEMINI_RESUME_RESPONSE_SCHEMA,
    maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
  };
  const thinkingConfig = buildThinkingConfig(model, thinkingMode);
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;

  return {
    contents: [
      {
        parts: [
          { text: `${FULL_RESUME_PROMPT}${SAFETY_PROMPT}` },
          { text: SYNTHETIC_RESUME_TEXT },
        ],
      },
    ],
    generationConfig,
  };
}

const OPENAI_RESUME_RESPONSE_SCHEMA = toOpenAiJsonSchema(
  GEMINI_RESUME_RESPONSE_SCHEMA,
);
function syntheticPdfBase64() {
  const streamText = SYNTHETIC_RESUME_TEXT.replace(/[\\()]/gu, "\\$&").replace(
    /\r?\n/gu,
    "\\n",
  );
  const stream = `BT /F1 8 Tf 36 756 Td (${streamText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf).toString("base64");
}

const SYNTHETIC_PDF_BASE64 = syntheticPdfBase64();

export function buildCloudflareRequestBody(
  model,
  inputVariant,
  jsonMode = "json_schema",
) {
  const inputPart =
    inputVariant === "pdf"
      ? {
          type: "input_file",
          filename: "synthetic-resume.pdf",
          file_data: `data:application/pdf;base64,${SYNTHETIC_PDF_BASE64}`,
        }
      : { type: "input_text", text: SYNTHETIC_RESUME_TEXT };
  const prompt = `${FULL_RESUME_PROMPT}${SAFETY_PROMPT}`;
  const promptWithFallbackSchema =
    jsonMode === "json_prompt"
      ? `${prompt} Return JSON matching this schema exactly: ${JSON.stringify(OPENAI_RESUME_RESPONSE_SCHEMA)}`
      : prompt;
  const body = {
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: promptWithFallbackSchema },
          inputPart,
        ],
      },
    ],
    max_output_tokens: GEMINI_MAX_OUTPUT_TOKENS,
  };
  if (jsonMode === "json_schema") {
    body.text = {
      format: {
        type: "json_schema",
        name: "resume_extraction",
        strict: true,
        schema: OPENAI_RESUME_RESPONSE_SCHEMA,
      },
    };
  }
  return body;
}

function usageCount(usageMetadata, key) {
  return isRecord(usageMetadata) ? safeTokenCount(usageMetadata[key]) : 0;
}

function fieldCount(body) {
  return FIXED_FIELD_KEYS.filter((key) => {
    const field = body?.[key];
    return isRecord(field) && nonEmpty(field.value);
  }).length;
}

function arrayCount(body, key) {
  return Array.isArray(body?.sections?.[key]) ? body.sections[key].length : 0;
}

export function summarizeResponse({ body, httpStatus, wallMs }) {
  const candidate = isRecord(body) ? body.candidates?.[0] : undefined;
  const contentText = candidate?.content?.parts?.[0]?.text;
  let extraction = {};
  let jsonValid = false;
  if (typeof contentText === "string") {
    try {
      extraction = JSON.parse(contentText);
      jsonValid = matchesSchema(extraction, GEMINI_RESUME_RESPONSE_SCHEMA);
    } catch {
      extraction = {};
    }
  }
  const usageMetadata = isRecord(body) ? body.usageMetadata : undefined;
  const successfulHttp =
    Number.isInteger(httpStatus) && httpStatus >= 200 && httpStatus < 300;
  return {
    httpStatus: httpStatus ?? "ERROR",
    wallMs: safeTokenCount(wallMs),
    finishReason: safeFinishReason(candidate?.finishReason),
    promptTokens: usageCount(usageMetadata, USAGE_KEYS.promptTokens),
    candidateTokens: usageCount(usageMetadata, USAGE_KEYS.candidateTokens),
    thoughtTokens: usageCount(usageMetadata, USAGE_KEYS.thoughtTokens),
    fields: fieldCount(extraction),
    references: arrayCount(extraction, "references"),
    learningHistory: arrayCount(extraction, "learningHistory"),
    additionalSections: arrayCount(extraction, "additionalSections"),
    jsonValid,
    pass:
      successfulHttp && jsonValid && arrayCount(extraction, "references") >= 8,
  };
}

function responsesOutputText(body) {
  if (!isRecord(body) || !Array.isArray(body.output)) return undefined;
  for (const item of body.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
    }
  }
  return undefined;
}

function responseFinishReason(value) {
  return typeof value === "string" && /^[a-z_]{1,40}$/u.test(value)
    ? value
    : "UNKNOWN";
}

export function summarizeCloudflareResponse({ body, httpStatus, wallMs }) {
  const contentText = responsesOutputText(body);
  let extraction = {};
  let jsonValid = false;
  if (typeof contentText === "string") {
    try {
      extraction = JSON.parse(contentText);
      jsonValid = matchesSchema(extraction, GEMINI_RESUME_RESPONSE_SCHEMA);
    } catch {
      extraction = {};
    }
  }
  const usage = isRecord(body) && isRecord(body.usage) ? body.usage : {};
  const successfulHttp =
    Number.isInteger(httpStatus) && httpStatus >= 200 && httpStatus < 300;
  return {
    httpStatus: httpStatus ?? "ERROR",
    wallMs: safeTokenCount(wallMs),
    finishReason: responseFinishReason(body?.status),
    promptTokens: safeTokenCount(usage.input_tokens),
    candidateTokens: safeTokenCount(usage.output_tokens),
    thoughtTokens: 0,
    fields: fieldCount(extraction),
    references: arrayCount(extraction, "references"),
    learningHistory: arrayCount(extraction, "learningHistory"),
    additionalSections: arrayCount(extraction, "additionalSections"),
    jsonValid,
    pass:
      successfulHttp && jsonValid && arrayCount(extraction, "references") >= 8,
  };
}

export function formatResult(result) {
  return [
    `model=${result.model}`,
    `thinking=${result.thinkingMode ?? "n/a"}`,
    `input=${result.inputVariant ?? "n/a"}`,
    `jsonMode=${result.jsonMode ?? "gemini-schema"}`,
    `httpStatus=${result.httpStatus}`,
    `wallMs=${result.wallMs}`,
    `finishReason=${result.finishReason}`,
    `promptTokens=${result.promptTokens}`,
    `candidateTokens=${result.candidateTokens}`,
    `thoughtTokens=${result.thoughtTokens}`,
    `fixedFieldsNonNull=${result.fields}`,
    `references=${result.references}`,
    `learningHistory=${result.learningHistory}`,
    `additionalSections=${result.additionalSections}`,
    `jsonValid=${result.jsonValid}`,
    `pass=${result.pass}`,
  ].join(" ");
}

function requireApiKey(env) {
  if (
    typeof env.GOOGLE_AI_STUDIO_API_KEY !== "string" ||
    env.GOOGLE_AI_STUDIO_API_KEY.length < 20
  ) {
    throw new Error("API key missing or implausibly short");
  }
  return env.GOOGLE_AI_STUDIO_API_KEY;
}

export function parseCloudflareEnvFile(contents) {
  const values = {};
  for (const line of String(contents).split(/\r?\n/u)) {
    const match = line.match(
      /^(?:export\s+)?(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID)\s*=\s*(.*)$/u,
    );
    if (!match) continue;
    const raw = match[2].trim();
    values[match[1]] =
      raw.startsWith('"') && raw.endsWith('"')
        ? raw.slice(1, -1)
        : raw.startsWith("'") && raw.endsWith("'")
          ? raw.slice(1, -1)
          : raw;
  }
  return values;
}

export function readCloudflareCredentials(filePath = CF_ENV_FILE) {
  let contents;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    throw new Error("Cloudflare credential file missing or implausibly short");
  }
  const values = parseCloudflareEnvFile(contents);
  if (
    typeof values.CLOUDFLARE_API_TOKEN !== "string" ||
    values.CLOUDFLARE_API_TOKEN.length < 20 ||
    typeof values.CLOUDFLARE_ACCOUNT_ID !== "string" ||
    values.CLOUDFLARE_ACCOUNT_ID.length < 8
  ) {
    throw new Error("Cloudflare credential file missing or implausibly short");
  }
  return {
    apiToken: values.CLOUDFLARE_API_TOKEN,
    accountId: values.CLOUDFLARE_ACCOUNT_ID,
  };
}

function resolveBaseUrl(env) {
  const raw = env.GATEWAY_BASE_URL?.trim() || DIRECT_BASE_URL;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("invalid gateway URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("invalid gateway URL");
  }
  return raw.replace(/\/+$/, "");
}

function endpoint(baseUrl, model) {
  return `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function cloudflareEndpoint(accountId) {
  return `${CLOUDFLARE_RESPONSES_BASE_URL}/accounts/${encodeURIComponent(accountId)}/ai/v1/responses`;
}

function modelsEndpoint(baseUrl, pageToken) {
  const url = `${baseUrl}/v1beta/models`;
  return pageToken ? `${url}?pageToken=${encodeURIComponent(pageToken)}` : url;
}

async function fetchJsonWithTimeout(fetchImpl, url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    let body;
    if (response.ok) {
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
    }
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

export async function listSupportedModelNames({
  baseUrl,
  apiKey,
  fetchImpl = fetch,
  budget = createCallBudget(),
  maxPages = MODEL_LIST_MAX_PAGES,
}) {
  const names = [];
  const seenPageTokens = new Set();
  let pageToken;
  let pages = 0;
  do {
    if (pages >= maxPages) {
      return { names, pages, stoppedReason: "page_cap" };
    }
    if (!reserveCall(budget)) {
      return { names, pages, stoppedReason: "call_budget_exhausted" };
    }
    pages += 1;
    let response;
    let body;
    try {
      ({ response, body } = await fetchJsonWithTimeout(
        fetchImpl,
        modelsEndpoint(baseUrl, pageToken),
        {
          method: "GET",
          headers: { "x-goog-api-key": apiKey },
        },
      ));
    } catch {
      throw new Error("model list request failed");
    }
    if (!response.ok) throw new Error("model list request failed");
    const page = body;
    if (!isRecord(page)) throw new Error("model list response invalid");
    for (const model of Array.isArray(page.models) ? page.models : []) {
      if (
        isRecord(model) &&
        typeof model.name === "string" &&
        Array.isArray(model.supportedGenerationMethods) &&
        model.supportedGenerationMethods.includes("generateContent")
      ) {
        names.push(model.name);
      }
    }
    pageToken =
      typeof page.nextPageToken === "string" ? page.nextPageToken : undefined;
    if (pageToken && containsSecret(pageToken, apiKey)) {
      return { names, pages, stoppedReason: "unsafe_page_token" };
    }
    if (pageToken && seenPageTokens.has(pageToken)) {
      return { names, pages, stoppedReason: "repeated_page_token" };
    }
    if (pageToken) seenPageTokens.add(pageToken);
  } while (pageToken);
  return { names, pages };
}

async function probeOne({
  provider,
  plan,
  baseUrl,
  apiKey,
  credentials,
  fetchImpl,
  now = Date.now,
}) {
  const startedAt = now();
  try {
    const isCloudflare = provider === "cf-unified";
    const { response, body } = await fetchJsonWithTimeout(
      fetchImpl,
      isCloudflare
        ? cloudflareEndpoint(credentials.accountId)
        : endpoint(baseUrl, plan.model),
      {
        method: "POST",
        headers: isCloudflare
          ? {
              Authorization: `Bearer ${credentials.apiToken}`,
              "Content-Type": "application/json",
            }
          : {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
        body: JSON.stringify(
          isCloudflare
            ? buildCloudflareRequestBody(
                plan.model,
                plan.inputVariant,
                plan.jsonMode,
              )
            : buildRequestBody(plan.model, plan.thinkingMode),
        ),
      },
    );
    const wallMs = safeTokenCount(now() - startedAt);
    if (!response.ok) {
      return {
        model: plan.model,
        thinkingMode: plan.thinkingMode,
        inputVariant: plan.inputVariant,
        jsonMode: plan.jsonMode,
        ...(isCloudflare
          ? summarizeCloudflareResponse({
              body: {},
              httpStatus: response.status,
              wallMs,
            })
          : summarizeResponse({
              body: {},
              httpStatus: response.status,
              wallMs,
            })),
        schemaUnsupported:
          isCloudflare &&
          plan.jsonMode === "json_schema" &&
          [400, 404, 422].includes(response.status),
      };
    }
    return {
      model: plan.model,
      thinkingMode: plan.thinkingMode,
      inputVariant: plan.inputVariant,
      jsonMode: plan.jsonMode,
      ...(isCloudflare
        ? summarizeCloudflareResponse({
            body,
            httpStatus: response.status,
            wallMs,
          })
        : summarizeResponse({ body, httpStatus: response.status, wallMs })),
    };
  } catch (error) {
    return {
      model: plan.model,
      thinkingMode: plan.thinkingMode,
      inputVariant: plan.inputVariant,
      jsonMode: plan.jsonMode,
      httpStatus: error?.name === "AbortError" ? "TIMEOUT" : "ERROR",
      wallMs: safeTokenCount(now() - startedAt),
      finishReason: "UNKNOWN",
      promptTokens: 0,
      candidateTokens: 0,
      thoughtTokens: 0,
      fields: 0,
      references: 0,
      learningHistory: 0,
      additionalSections: 0,
      jsonValid: false,
      pass: false,
    };
  }
}

export async function runProbe({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  writeLine,
  writeError,
  delayMs = REQUEST_DELAY_MS,
  cloudflareCredentials,
  readCredentials = readCloudflareCredentials,
} = {}) {
  const apiKeyForScrub =
    typeof env.GOOGLE_AI_STUDIO_API_KEY === "string"
      ? env.GOOGLE_AI_STUDIO_API_KEY
      : undefined;
  let emit = createEmitter({
    apiKey: apiKeyForScrub,
    writeLine,
    writeError,
  });
  const budget = createCallBudget();
  const emitBudgetSummary = ({
    listPages = "unknown",
    candidateCalls = 0,
    listStop = "not_started",
  } = {}) => {
    emit(
      `calls=${budget.used} maxCalls=${budget.maxCalls} listPages=${listPages} candidateCalls=${candidateCalls} listStop=${listStop}`,
    );
  };

  let options;
  try {
    options = parseArgs(argv);
  } catch {
    emit("probe failed: invalid arguments", "stderr");
    emitBudgetSummary();
    return { exitCode: 2 };
  }
  if (options.help) {
    emit(HELP_TEXT);
    emitBudgetSummary();
    return { exitCode: 0 };
  }

  let plan;
  try {
    plan = buildProbePlan(options.models, options.provider);
  } catch {
    emit("probe failed: plan exceeds call cap", "stderr");
    emitBudgetSummary();
    return { exitCode: 2 };
  }
  if (options.dryRun) {
    emit(
      `plan maxCalls=${MAX_CALLS} listPageCap=${MODEL_LIST_MAX_PAGES} candidateCalls=${plan.length}`,
    );
    for (const item of plan) {
      emit(
        options.provider === "cf-unified"
          ? `plan model=${item.model} input=${item.inputVariant} jsonMode=${item.jsonMode}`
          : `plan model=${item.model} thinking=${item.thinkingMode}`,
      );
    }
    emitBudgetSummary({ candidateCalls: 0, listPages: 0 });
    return { exitCode: 0, plan, calls: budget.used };
  }

  let apiKey;
  let baseUrl;
  let credentials;
  if (options.provider === "cf-unified") {
    try {
      credentials = cloudflareCredentials ?? readCredentials(CF_ENV_FILE);
      emit = createEmitter({
        apiKey: credentials.apiToken,
        writeLine,
        writeError,
      });
    } catch {
      emit("Cloudflare credential file missing or implausibly short", "stderr");
      emitBudgetSummary({ listPages: 0, listStop: "not_started" });
      return { exitCode: 2, calls: budget.used };
    }
  } else {
    try {
      apiKey = requireApiKey(env);
    } catch {
      emit("API key missing or implausibly short", "stderr");
      emitBudgetSummary();
      return { exitCode: 2, calls: budget.used };
    }
    try {
      baseUrl = resolveBaseUrl(env);
    } catch {
      emit("probe failed: invalid environment", "stderr");
      emitBudgetSummary();
      return { exitCode: 2, calls: budget.used };
    }
  }

  let listing;
  if (options.provider === "google-key") {
    try {
      listing = await listSupportedModelNames({
        baseUrl,
        apiKey,
        fetchImpl,
        budget,
      });
    } catch {
      emit("probe failed: model listing", "stderr");
      emitBudgetSummary({ listPages: "unknown" });
      return { exitCode: 1, plan, calls: budget.used };
    }
    for (const name of listing.names) emit(safeModelName(name));
  } else {
    listing = { pages: 0, stoppedReason: "not_applicable" };
  }

  const results = [];
  let candidateProbesSkipped = false;
  for (const item of plan) {
    if (!reserveCall(budget)) {
      candidateProbesSkipped = true;
      emit("candidate probes skipped: call_budget_exhausted", "stderr");
      break;
    }
    if (results.length > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const result = await probeOne({
      provider: options.provider,
      plan: item,
      baseUrl,
      apiKey,
      credentials,
      fetchImpl,
    });
    results.push(result);
    emit(formatResult(result));
    if (result.schemaUnsupported) {
      result.fallbackAttempted = false;
      if (reserveCall(budget)) {
        const fallbackPlan = { ...item, jsonMode: "json_prompt" };
        const fallbackResult = await probeOne({
          provider: options.provider,
          plan: fallbackPlan,
          baseUrl,
          apiKey,
          credentials,
          fetchImpl,
        });
        result.fallbackAttempted = true;
        results.push(fallbackResult);
        emit(formatResult(fallbackResult));
      } else {
        candidateProbesSkipped = true;
        emit("json prompt fallback skipped: call_budget_exhausted", "stderr");
      }
    }
  }
  emitBudgetSummary({
    listPages: listing.pages,
    candidateCalls: results.length,
    listStop: listing.stoppedReason ?? "complete",
  });
  return {
    exitCode:
      !candidateProbesSkipped &&
      results.every(
        (result) =>
          result.pass ||
          (result.schemaUnsupported && result.fallbackAttempted === true),
      )
        ? 0
        : 1,
    plan,
    results,
    calls: budget.used,
    candidateProbesSkipped,
  };
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const result = await runProbe();
  process.exitCode = result.exitCode;
}
