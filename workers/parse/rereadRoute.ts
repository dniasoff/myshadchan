import type { SupabaseClient } from "@supabase/supabase-js";

import { fail, ok, type Envelope } from "../shared/envelope";
import type { BaseEnv } from "../shared/env";
import { summarizeErrorForLog } from "../shared/safeLog";
import { getParseQuotaClient } from "./parseQuotaClient";
import {
  checkRateLimit,
  isRateLimitingEnforced,
  type RateLimitEnforcementEnv,
} from "../shared/rateLimit";
import {
  applyResumeRead,
  applyRereadSections,
  claimRereadAttempt,
  releaseRereadAttempt,
} from "./rereadQuota";
import {
  MAX_ATTACHMENT_BYTES,
  readRereadResumeRow,
  selectRereadFile,
  validateDownloadedRereadFile,
} from "./rereadFile";
import { CURRENT_PARSE_RESULT_SCHEMA_VERSION } from "./parseResultPayload";
import { toDraft } from "./parsedResumeDraft";
import {
  logRereadFailure,
  type RereadFailureReason,
} from "./rereadDiagnostics";
import {
  ExtractorProviderBusyError,
  ExtractorTimeoutError,
  type ParseEnv,
  type ResumeExtractor,
} from "./resumeExtractor";

export const REREAD_FAILURE_MESSAGE =
  "Could not make this resume easy to read. Nothing was changed.";
export const REREAD_STALE_FILE_MESSAGE =
  "This resume changed while it was being read. Please try again.";
const ALREADY_READING_MESSAGE =
  "This resume is already being read. Please try again shortly.";
const DOCUMENTS_BUCKET = "documents";
const REREAD_SUCCESS_STATUS = 200;
const REREAD_RETRYABLE_STATUS = 409;
const REREAD_FAILURE_STATUS = 422;

type RereadBody = {
  resume_id: number;
  request_id: string;
  mode?: "fill_empty";
  file_identity?: string;
};
type RereadResult = Envelope<unknown>;

export type RereadDependencies = {
  caller: SupabaseClient;
  service?: SupabaseClient;
  extractor: ResumeExtractor;
  userId: string | undefined;
  env: BaseEnv &
    ParseEnv &
    RateLimitEnforcementEnv & {
      PARSE_USER_RATE_LIMITER?: RateLimit;
    };
};

export type RereadResponse = {
  status: 200 | 402 | 403 | 409 | 422 | 429 | 503;
  body: RereadResult;
};

function response(
  status: RereadResponse["status"],
  body: RereadResult,
): RereadResponse {
  return { status, body };
}

function failure(
  dependencies: RereadDependencies,
  reason: RereadFailureReason,
  message = REREAD_FAILURE_MESSAGE,
  status: RereadResponse["status"] = REREAD_FAILURE_STATUS,
  meta?: Record<string, unknown>,
): RereadResponse {
  void dependencies;
  logRereadFailure(reason);
  return response(status, fail(message, meta));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAX_UNREAD_STRING_PROBE = 1_024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasNonWhitespaceString(value: string): boolean {
  const probeLength = Math.min(value.length, MAX_UNREAD_STRING_PROBE);
  for (let index = 0; index < probeLength; index += 1) {
    if (!/\s/u.test(value[index] ?? "")) return true;
  }

  // Do not scan an unbounded payload. A long unobserved suffix is treated as
  // non-empty so a malformed payload cannot accidentally unlock a paid read.
  return value.length > probeLength;
}

function hasNonEmptyRawValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return hasNonWhitespaceString(value);
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) {
    for (const _key in value) return true;
    return false;
  }
  return true;
}

/**
 * Keep the legacy request upgrade in one pure predicate. The browser mirrors
 * this definition in `resumeReadableSections.ts`; the route cannot trust a
 * client-provided mode when an old bundle omits `fill_empty`.
 */
export function isResumeUnread(resume: {
  sections: unknown;
  extracted: unknown;
}): boolean {
  const sections = resume.sections;
  if (!isPlainObject(sections)) return true;
  if (Object.prototype.hasOwnProperty.call(sections, "schemaVersion")) {
    return false;
  }

  const hasNonEmptySectionArray = [
    "learningHistory",
    "references",
    "additionalSections",
  ].some((key) => Array.isArray(sections[key]) && sections[key].length > 0);

  return !hasNonEmptySectionArray && !hasNonEmptyRawValue(resume.extracted);
}

function buildRereadSections(
  original: unknown,
  additionalSections: unknown,
): Record<string, unknown> | null {
  if (original != null && !isObject(original)) return null;
  return {
    ...(isObject(original) ? original : {}),
    additionalSections,
    schemaVersion: CURRENT_PARSE_RESULT_SCHEMA_VERSION,
  };
}

async function verifyStorageMetadata(
  service: SupabaseClient,
  file: { path: string; mime_type: string; size: number },
  dirPath: string,
  fileName: string,
): Promise<boolean> {
  const { data, error } = await service.storage
    .from(DOCUMENTS_BUCKET)
    .list(dirPath, { search: fileName, limit: 10 });
  if (error || !data) return false;
  const exact = data.find((entry) => entry.name === fileName);
  if (!exact || !exact.metadata || typeof exact.metadata !== "object") {
    return false;
  }
  const metadata = exact.metadata as {
    size?: unknown;
    mimetype?: unknown;
    contentType?: unknown;
  };
  const actualSize = metadata.size;
  const actualMime = metadata.mimetype ?? metadata.contentType;
  return (
    typeof actualSize === "number" &&
    actualSize === file.size &&
    actualSize <= MAX_ATTACHMENT_BYTES &&
    actualMime === file.mime_type
  );
}

/**
 * Re-read an existing resume. All caller-scoped authorization and file-path
 * checks happen before this function creates or uses the service-role client
 * for storage. The only resume write is the atomic sections CAS that changes
 * the generic extras and its schema marker while consuming the ledger unit.
 */
export async function rereadResume(
  body: RereadBody,
  dependencies: RereadDependencies,
): Promise<RereadResponse> {
  const { caller } = dependencies;
  let contextResult: { data: unknown; error: unknown };
  let roleResult: { data: unknown; error: unknown };
  try {
    [contextResult, roleResult] = await Promise.all([
      caller.rpc("current_context_id"),
      caller.rpc("current_member_role"),
    ]);
  } catch {
    return failure(dependencies, "authorization", REREAD_FAILURE_MESSAGE, 403);
  }
  const accountId = contextResult.data;
  const role = roleResult.data;
  if (
    contextResult.error ||
    roleResult.error ||
    typeof accountId !== "number" ||
    (role !== "parent_admin" && role !== "self_manager") ||
    typeof dependencies.userId !== "string" ||
    dependencies.userId.length === 0
  ) {
    return failure(dependencies, "authorization", REREAD_FAILURE_MESSAGE, 403);
  }

  const accountRate = await checkRateLimit({
    binding: dependencies.env.PARSE_USER_RATE_LIMITER,
    key: `parse-account:${accountId}`,
    enforced: isRateLimitingEnforced(dependencies.env.RATE_LIMITING_ENFORCED),
    limiterName: "parse-account",
  });
  if (!accountRate.allowed) {
    if (accountRate.reason === "over_limit") {
      logRereadFailure("rate_limit");
      return response(
        429,
        fail("rate limit exceeded", { limiter: "parse-account" }),
      );
    }
    return failure(
      dependencies,
      "rate_limit_unavailable",
      REREAD_FAILURE_MESSAGE,
      503,
    );
  }

  let memberResultRow: {
    data: { disabled?: unknown } | null;
    error: unknown;
  };
  try {
    memberResultRow = await caller
      .from("members")
      .select("id,disabled")
      .eq("user_id", dependencies.userId)
      .maybeSingle();
  } catch {
    return failure(dependencies, "member", REREAD_FAILURE_MESSAGE, 403);
  }
  if (
    memberResultRow.error ||
    !memberResultRow.data ||
    memberResultRow.data.disabled === true
  ) {
    return failure(dependencies, "member", REREAD_FAILURE_MESSAGE, 403);
  }

  let resumeResult: { data: unknown; error: unknown };
  try {
    resumeResult = await caller
      .from("resumes")
      .select("id,account_id,shidduchim_id,single_id,files,sections,extracted")
      .eq("id", body.resume_id)
      .maybeSingle();
  } catch {
    return failure(dependencies, "resume_row");
  }
  const resume = readRereadResumeRow(resumeResult.data);
  if (resumeResult.error || !resume || resume.account_id !== accountId) {
    return failure(dependencies, "resume_row");
  }
  if (body.mode === "fill_empty" && !body.file_identity) {
    return failure(dependencies, "request_shape");
  }

  const extracted = isObject(resumeResult.data)
    ? resumeResult.data.extracted
    : null;
  const shouldUpgradeLegacyRead =
    body.mode !== "fill_empty" &&
    isResumeUnread({ sections: resume.sections, extracted });
  const effectiveMode = shouldUpgradeLegacyRead ? "fill_empty" : body.mode;

  const selectedFile = selectRereadFile(
    resume,
    accountId,
    shouldUpgradeLegacyRead ? undefined : body.file_identity,
  );
  if (!selectedFile) return failure(dependencies, "file_selection");

  const service = dependencies.service ?? getParseQuotaClient(dependencies.env);
  let claim: Awaited<ReturnType<typeof claimRereadAttempt>>;
  try {
    claim = await claimRereadAttempt(
      dependencies.env,
      accountId,
      body.resume_id,
      body.request_id,
      CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    );
  } catch {
    return failure(dependencies, "claim", REREAD_FAILURE_MESSAGE, 503);
  }
  if (!claim.ok)
    return failure(dependencies, "claim", REREAD_FAILURE_MESSAGE, 503);

  if (claim.outcome.outcome === "replayed") {
    return response(REREAD_SUCCESS_STATUS, ok({ replayed: true }));
  }
  if (
    claim.outcome.outcome === "in_progress" ||
    claim.outcome.outcome === "busy"
  ) {
    logRereadFailure("claim");
    return response(
      REREAD_RETRYABLE_STATUS,
      fail(ALREADY_READING_MESSAGE, { code: "already_reading" }),
    );
  }
  if (claim.outcome.outcome === "no_allowance") {
    logRereadFailure("claim");
    return response(
      402,
      fail(REREAD_FAILURE_MESSAGE, { code: "no_allowance" }),
    );
  }
  if (claim.outcome.outcome === "not_entitled") {
    logRereadFailure("claim");
    return response(
      402,
      fail(REREAD_FAILURE_MESSAGE, { code: "not_entitled" }),
    );
  }

  const { attempt_id: attemptId, generation } = claim.outcome;
  let attemptFinalized = false;
  const releaseClaim = async (): Promise<void> => {
    if (attemptFinalized) return;
    attemptFinalized = true;
    try {
      const release = await releaseRereadAttempt(
        dependencies.env,
        accountId,
        attemptId,
        generation,
      );
      if (release.outcome === "failed") {
        logRereadFailure("release");
      }
    } catch {
      logRereadFailure("release");
    }
  };

  try {
    let storageMetadataValid = false;
    try {
      storageMetadataValid = await verifyStorageMetadata(
        service,
        selectedFile.file,
        selectedFile.dirPath,
        selectedFile.fileName,
      );
    } catch (error) {
      console.error(
        "parse.reread.storage_metadata.failed",
        summarizeErrorForLog(error),
      );
    }
    if (!storageMetadataValid) {
      return failure(dependencies, "storage_metadata");
    }

    let fileData: Blob | null = null;
    let downloadError: unknown = null;
    try {
      const download = await service.storage
        .from(DOCUMENTS_BUCKET)
        .download(selectedFile.file.path);
      fileData = download.data;
      downloadError = download.error;
    } catch {
      return failure(dependencies, "download");
    }
    if (downloadError || !fileData || fileData.size > MAX_ATTACHMENT_BYTES) {
      return failure(dependencies, "download");
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await fileData.arrayBuffer();
    } catch (error) {
      console.error(
        "parse.reread.download.failed",
        summarizeErrorForLog(error),
      );
      return failure(dependencies, "download");
    }
    if (!validateDownloadedRereadFile(bytes, selectedFile.file.mime_type)) {
      return failure(dependencies, "magic_validation");
    }

    let raw: unknown;
    try {
      raw = await dependencies.extractor.extract(
        bytes,
        selectedFile.file.mime_type,
      );
    } catch (error) {
      const timeout = error instanceof ExtractorTimeoutError;
      const providerBusy = error instanceof ExtractorProviderBusyError;
      return failure(
        dependencies,
        timeout ? "extractor_timeout" : "extractor",
        REREAD_FAILURE_MESSAGE,
        REREAD_FAILURE_STATUS,
        timeout
          ? { code: "timeout" }
          : providerBusy
            ? { code: "provider_busy" }
            : undefined,
      );
    }

    let draft: ReturnType<typeof toDraft>;
    try {
      draft = toDraft(raw);
    } catch (error) {
      console.error("parse.reread.draft.failed", summarizeErrorForLog(error));
      return failure(dependencies, "draft");
    }
    const nextSections = buildRereadSections(
      resume.sections,
      draft.sections.additionalSections,
    );
    if (!nextSections) {
      return failure(dependencies, "sections");
    }

    let applied:
      | Awaited<ReturnType<typeof applyResumeRead>>
      | Awaited<ReturnType<typeof applyRereadSections>>;
    try {
      applied =
        effectiveMode === "fill_empty"
          ? await applyResumeRead(
              dependencies.env,
              accountId,
              body.resume_id,
              attemptId,
              generation,
              selectedFile.file.path,
              draft.fields as unknown as Record<string, unknown>,
              raw,
              draft.sections,
              CURRENT_PARSE_RESULT_SCHEMA_VERSION,
            )
          : await applyRereadSections(
              dependencies.env,
              accountId,
              body.resume_id,
              attemptId,
              generation,
              resume.sections,
              nextSections,
              CURRENT_PARSE_RESULT_SCHEMA_VERSION,
            );
    } catch (error) {
      console.error("parse.reread.apply.failed", summarizeErrorForLog(error));
      return failure(dependencies, "apply_failed");
    }
    if (applied.outcome === "stale_file") {
      logRereadFailure("apply_failed");
      return response(
        REREAD_RETRYABLE_STATUS,
        fail(REREAD_STALE_FILE_MESSAGE, { code: "stale_file" }),
      );
    }
    if (applied.outcome === "cas_failed") {
      return failure(
        dependencies,
        "apply_cas_failed",
        REREAD_FAILURE_MESSAGE,
        409,
      );
    }
    if (applied.outcome === "failed") {
      return failure(dependencies, "apply_failed");
    }
    if (applied.outcome === "superseded") {
      // A superseded generation belongs to the newer claimant. Its fenced
      // release is intentionally skipped so it cannot release that claimant's
      // reservation.
      attemptFinalized = true;
      return response(
        REREAD_RETRYABLE_STATUS,
        fail(ALREADY_READING_MESSAGE, { code: "already_reading" }),
      );
    }

    attemptFinalized = true;
    const isEmptyRead =
      effectiveMode === "fill_empty" &&
      Object.values(draft.fields).every(
        (value) =>
          value == null || (typeof value === "string" && value.trim() === ""),
      ) &&
      draft.sections.learningHistory.length === 0 &&
      draft.sections.references.length === 0 &&
      draft.sections.additionalSections.length === 0;
    return response(
      REREAD_SUCCESS_STATUS,
      ok({ replayed: false, ...(isEmptyRead ? { empty: true } : {}) }),
    );
  } catch (error) {
    console.error("parse.reread.unexpected", summarizeErrorForLog(error));
    return failure(dependencies, "unexpected");
  } finally {
    await releaseClaim();
  }
}
