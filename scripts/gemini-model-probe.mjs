import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GEMINI_MAX_OUTPUT_TOKENS,
  GEMINI_RESUME_RESPONSE_SCHEMA,
  FULL_RESUME_PROMPT,
  SAFETY_PROMPT,
} from "../workers/parse/geminiModelProbeFixture.mjs";

export const DIRECT_BASE_URL = "https://generativelanguage.googleapis.com";
export const PER_CALL_TIMEOUT_MS = 90_000;
export const MAX_CALLS = 40;
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

const HELP_TEXT = `Usage: node scripts/gemini-model-probe.mjs [--dry-run] [MODEL ...]

Reads GOOGLE_AI_STUDIO_API_KEY and optionally GATEWAY_BASE_URL from the
environment. MODEL arguments replace the default candidate list. --dry-run
prints the bounded model/thinking plan without making network requests.

The probe lists served generateContent models, then makes at most ${MAX_CALLS}
sequential synthetic-resume requests with a ${PER_CALL_TIMEOUT_MS / 1000}s
per-call timeout. It never prints the API key or provider response body.`;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function normalizeModelId(value) {
  const model = value.startsWith("models/") ? value.slice(7) : value;
  if (!/^[a-z0-9][a-z0-9.-]{0,80}$/.test(model)) {
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
  const models = [];

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg.startsWith("-")) {
      throw new Error("unknown option");
    } else {
      models.push(normalizeModelId(arg));
    }
  }

  return {
    dryRun,
    help,
    models: models.length > 0 ? [...new Set(models)] : [...DEFAULT_MODELS],
  };
}

export function buildProbePlan(models) {
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
  if (typeof contentText === "string") {
    try {
      extraction = JSON.parse(contentText);
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
    pass: successfulHttp && arrayCount(extraction, "references") >= 8,
  };
}

export function formatResult(result) {
  return [
    `model=${result.model}`,
    `thinking=${result.thinkingMode}`,
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
    `pass=${result.pass}`,
  ].join(" ");
}

function requireApiKey(env) {
  if (
    typeof env.GOOGLE_AI_STUDIO_API_KEY !== "string" ||
    !env.GOOGLE_AI_STUDIO_API_KEY
  ) {
    throw new Error("missing API key");
  }
  return env.GOOGLE_AI_STUDIO_API_KEY;
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
}) {
  const names = [];
  const seenPageTokens = new Set();
  let pageToken;
  do {
    const { response, body } = await fetchJsonWithTimeout(
      fetchImpl,
      modelsEndpoint(baseUrl, pageToken),
      {
        method: "GET",
        headers: { "x-goog-api-key": apiKey },
      },
    );
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
    if (pageToken && seenPageTokens.has(pageToken))
      throw new Error("model list pagination repeated");
    if (pageToken) seenPageTokens.add(pageToken);
  } while (pageToken);
  return names;
}

async function probeOne({ plan, baseUrl, apiKey, fetchImpl, now = Date.now }) {
  const startedAt = now();
  try {
    const { response, body } = await fetchJsonWithTimeout(
      fetchImpl,
      endpoint(baseUrl, plan.model),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(buildRequestBody(plan.model, plan.thinkingMode)),
      },
    );
    const wallMs = safeTokenCount(now() - startedAt);
    if (!response.ok) {
      return {
        model: plan.model,
        thinkingMode: plan.thinkingMode,
        ...summarizeResponse({ body: {}, httpStatus: response.status, wallMs }),
      };
    }
    return {
      model: plan.model,
      thinkingMode: plan.thinkingMode,
      ...summarizeResponse({ body, httpStatus: response.status, wallMs }),
    };
  } catch (error) {
    return {
      model: plan.model,
      thinkingMode: plan.thinkingMode,
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
      pass: false,
    };
  }
}

export async function runProbe({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
  writeLine = (line) => console.log(line),
  writeError = (line) => console.error(line),
  delayMs = REQUEST_DELAY_MS,
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch {
    writeError("probe failed: invalid arguments");
    return { exitCode: 2 };
  }
  if (options.help) {
    writeLine(HELP_TEXT);
    return { exitCode: 0 };
  }

  let plan;
  try {
    plan = buildProbePlan(options.models);
  } catch {
    writeError("probe failed: plan exceeds call cap");
    return { exitCode: 2 };
  }
  if (options.dryRun) {
    for (const item of plan) {
      writeLine(`plan model=${item.model} thinking=${item.thinkingMode}`);
    }
    return { exitCode: 0, plan };
  }

  let apiKey;
  let baseUrl;
  try {
    apiKey = requireApiKey(env);
    baseUrl = resolveBaseUrl(env);
  } catch {
    writeError("probe failed: invalid environment");
    return { exitCode: 2 };
  }

  let servedNames;
  try {
    servedNames = await listSupportedModelNames({ baseUrl, apiKey, fetchImpl });
  } catch {
    writeError("probe failed: model listing");
    return { exitCode: 1, plan };
  }
  for (const name of servedNames) writeLine(name);

  const results = [];
  for (const item of plan) {
    if (results.length > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const result = await probeOne({
      plan: item,
      baseUrl,
      apiKey,
      fetchImpl,
    });
    results.push(result);
    writeLine(formatResult(result));
  }
  return {
    exitCode: results.every((result) => result.pass) ? 0 : 1,
    plan,
    results,
  };
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const result = await runProbe();
  process.exitCode = result.exitCode;
}
