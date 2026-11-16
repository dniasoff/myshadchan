export const REREAD_FAILURE_REASON_VALUES = [
  "authorization",
  "member",
  "rate_limit",
  "rate_limit_unavailable",
  "resume_row",
  "request_shape",
  "file_selection",
  "claim",
  "storage_metadata",
  "download",
  "magic_validation",
  "extractor",
  "extractor_timeout",
  "draft",
  "sections",
  "apply_cas_failed",
  "apply_failed",
  "release",
  "unexpected",
  "unknown",
] as const;

export type RereadFailureReason = (typeof REREAD_FAILURE_REASON_VALUES)[number];

const REREAD_FAILURE_REASONS = new Set<string>(REREAD_FAILURE_REASON_VALUES);

export function buildRereadFailureLog(reason: unknown): {
  reason: RereadFailureReason;
} {
  return {
    reason:
      typeof reason === "string" && REREAD_FAILURE_REASONS.has(reason)
        ? (reason as RereadFailureReason)
        : "unknown",
  };
}

export function logRereadFailure(reason: unknown): void {
  console.error("parse.reread.fail", buildRereadFailureLog(reason));
}

const EXTRACTOR_ERROR_CLASS_VALUES = [
  "ExtractorProviderError",
  "ExtractorTimeoutError",
  "DocxExtractionError",
  "DOMException",
  "SyntaxError",
  "TypeError",
  "Error",
  "UnknownError",
] as const;

type ExtractorErrorClass = (typeof EXTRACTOR_ERROR_CLASS_VALUES)[number];

const EXTRACTOR_ERROR_CLASSES = new Set<string>(EXTRACTOR_ERROR_CLASS_VALUES);

const GEMINI_FINISH_REASON_VALUES = [
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
] as const;

type GeminiFinishReason = (typeof GEMINI_FINISH_REASON_VALUES)[number];

const GEMINI_FINISH_REASONS = new Set<string>(GEMINI_FINISH_REASON_VALUES);

const DOCX_FAILURE_VALUES = [
  "empty",
  "password_protected",
  "malformed",
  "too_large",
] as const;

type DocxFailure = (typeof DOCX_FAILURE_VALUES)[number];

const DOCX_FAILURES = new Set<string>(DOCX_FAILURE_VALUES);
const MAX_DIAGNOSTIC_DURATION_MS = 24 * 60 * 60 * 1000;

export type ExtractorFailureLogOptions = {
  durationMs: unknown;
  attempt?: unknown;
  statusClass?: unknown;
  httpStatus?: unknown;
  finishReason?: unknown;
  usageMetadata?: unknown;
  docxFailure?: unknown;
};

export type ExtractorFailureLog = {
  errorClass: ExtractorErrorClass;
  durationMs: number;
  attempt?: number;
  statusClass?: ExtractorStatusClass;
  httpStatus?: number;
  finishReason?: GeminiFinishReason;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
  docxFailure?: DocxFailure;
};

const EXTRACTOR_STATUS_CLASS_VALUES = [
  "transient",
  "permanent",
  "timeout",
  "network",
  "validation",
] as const;

export type ExtractorStatusClass =
  (typeof EXTRACTOR_STATUS_CLASS_VALUES)[number];

const EXTRACTOR_STATUS_CLASSES = new Set<string>(EXTRACTOR_STATUS_CLASS_VALUES);

const GEMINI_MODEL_PATTERN = /^gemini-[a-z0-9.-]{1,60}$/;
const EXTRACTOR_FALLBACK_REASON_VALUES = [
  "transient_exhausted",
  "model_not_found",
] as const;

export type ExtractorFallbackReason =
  (typeof EXTRACTOR_FALLBACK_REASON_VALUES)[number];

const EXTRACTOR_FALLBACK_REASONS = new Set<string>(
  EXTRACTOR_FALLBACK_REASON_VALUES,
);

function safeErrorClass(error: unknown): ExtractorErrorClass {
  if (error instanceof Error) {
    const name = error.name;
    if (EXTRACTOR_ERROR_CLASSES.has(name)) {
      return name as ExtractorErrorClass;
    }
    return "Error";
  }
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return "DOMException";
  }
  return "UnknownError";
}

function safeDuration(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(MAX_DIAGNOSTIC_DURATION_MS, Math.max(0, Math.trunc(value)));
}

function safeAttempt(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 10
    ? value
    : undefined;
}

export type ExtractorAttemptLog = {
  model: string;
  attempt: number;
  fallbackReason?: ExtractorFallbackReason;
};

function safeModel(value: unknown): string {
  return typeof value === "string" && GEMINI_MODEL_PATTERN.test(value)
    ? value
    : "unknown";
}

function safeFallbackReason(
  value: unknown,
): ExtractorFallbackReason | undefined {
  return typeof value === "string" && EXTRACTOR_FALLBACK_REASONS.has(value)
    ? (value as ExtractorFallbackReason)
    : undefined;
}

export function buildExtractorAttemptLog(
  model: unknown,
  attempt: unknown,
  fallbackReason?: unknown,
): ExtractorAttemptLog {
  const log: ExtractorAttemptLog = {
    model: safeModel(model),
    attempt: safeAttempt(attempt) ?? 0,
  };
  const safeReason = safeFallbackReason(fallbackReason);
  if (safeReason !== undefined) log.fallbackReason = safeReason;
  return log;
}

export function logExtractorAttempt(
  model: unknown,
  attempt: unknown,
  fallbackReason?: unknown,
): void {
  console.warn(
    "parse.extract.attempt",
    buildExtractorAttemptLog(model, attempt, fallbackReason),
  );
}

function safeStatusClass(value: unknown): ExtractorStatusClass | undefined {
  if (typeof value !== "string" || !EXTRACTOR_STATUS_CLASSES.has(value)) {
    return undefined;
  }
  return value as ExtractorStatusClass;
}

function safeHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : undefined;
}

function safeCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function safeFinishReason(value: unknown): GeminiFinishReason | undefined {
  if (typeof value !== "string") return undefined;
  return GEMINI_FINISH_REASONS.has(value)
    ? (value as GeminiFinishReason)
    : "UNKNOWN";
}

function safeDocxFailure(value: unknown): DocxFailure | undefined {
  if (typeof value !== "string" || !DOCX_FAILURES.has(value)) return undefined;
  return value as DocxFailure;
}

function usageCount(usageMetadata: unknown, key: string): number | undefined {
  if (
    typeof usageMetadata !== "object" ||
    usageMetadata === null ||
    Array.isArray(usageMetadata)
  ) {
    return undefined;
  }
  return safeCount((usageMetadata as Record<string, unknown>)[key]);
}

export function buildExtractorFailureLog(
  error: unknown,
  options: ExtractorFailureLogOptions,
): ExtractorFailureLog {
  const log: ExtractorFailureLog = {
    errorClass: safeErrorClass(error),
    durationMs: safeDuration(options.durationMs),
  };
  const attempt = safeAttempt(options.attempt);
  if (attempt !== undefined) log.attempt = attempt;
  const statusClass = safeStatusClass(options.statusClass);
  if (statusClass !== undefined) log.statusClass = statusClass;
  const httpStatus = safeHttpStatus(options.httpStatus);
  if (httpStatus !== undefined) log.httpStatus = httpStatus;
  const finishReason = safeFinishReason(options.finishReason);
  if (finishReason !== undefined) log.finishReason = finishReason;
  const usageMetadata = options.usageMetadata;
  const usageKeys = [
    "promptTokenCount",
    "candidatesTokenCount",
    "thoughtsTokenCount",
    "totalTokenCount",
  ] as const;
  for (const key of usageKeys) {
    const count = usageCount(usageMetadata, key);
    if (count !== undefined) log[key] = count;
  }
  const docxFailure = safeDocxFailure(options.docxFailure);
  if (docxFailure !== undefined) log.docxFailure = docxFailure;
  return log;
}

export function logExtractorFailure(
  error: unknown,
  options: ExtractorFailureLogOptions,
): void {
  console.error(
    "parse.extract.failed",
    buildExtractorFailureLog(error, options),
  );
}
