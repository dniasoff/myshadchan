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
  ExtractorTimeoutError,
  type ParseEnv,
  type ResumeExtractor,
} from "./resumeExtractor";

export const REREAD_FAILURE_MESSAGE =
  "Could not read this resume. Nothing was changed.";
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
  message = REREAD_FAILURE_MESSAGE,
  status: RereadResponse["status"] = REREAD_FAILURE_STATUS,
): RereadResponse {
  void dependencies;
  return response(status, fail(message));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const [contextResult, roleResult, memberResult] = await Promise.all([
    caller.rpc("current_context_id"),
    caller.rpc("current_member_role"),
    caller.rpc("current_member_id"),
  ]);
  const accountId = contextResult.data;
  const role = roleResult.data;
  const memberId = memberResult.data;
  if (
    contextResult.error ||
    roleResult.error ||
    memberResult.error ||
    typeof accountId !== "number" ||
    (role !== "parent_admin" && role !== "self_manager") ||
    typeof memberId !== "number"
  ) {
    return failure(dependencies, REREAD_FAILURE_MESSAGE, 403);
  }

  const accountRate = await checkRateLimit({
    binding: dependencies.env.PARSE_USER_RATE_LIMITER,
    key: `parse-account:${accountId}`,
    enforced: isRateLimitingEnforced(dependencies.env.RATE_LIMITING_ENFORCED),
    limiterName: "parse-account",
  });
  if (!accountRate.allowed) {
    if (accountRate.reason === "over_limit") {
      return response(
        429,
        fail("rate limit exceeded", { limiter: "parse-account" }),
      );
    }
    return failure(dependencies, REREAD_FAILURE_MESSAGE, 503);
  }

  const memberResultRow = await caller
    .from("members")
    .select("id,disabled")
    .eq("id", memberId)
    .maybeSingle();
  if (
    memberResultRow.error ||
    !memberResultRow.data ||
    memberResultRow.data.disabled === true
  ) {
    return failure(dependencies, REREAD_FAILURE_MESSAGE, 403);
  }

  const resumeResult = await caller
    .from("resumes")
    .select("id,account_id,shidduchim_id,single_id,files,sections")
    .eq("id", body.resume_id)
    .maybeSingle();
  const resume = readRereadResumeRow(resumeResult.data);
  if (resumeResult.error || !resume || resume.account_id !== accountId) {
    return failure(dependencies);
  }
  if (body.mode === "fill_empty" && !body.file_identity) {
    return failure(dependencies);
  }

  const selectedFile = selectRereadFile(resume, accountId, body.file_identity);
  if (!selectedFile) return failure(dependencies);

  const service = dependencies.service ?? getParseQuotaClient(dependencies.env);
  const claim = await claimRereadAttempt(
    dependencies.env,
    accountId,
    body.resume_id,
    body.request_id,
    CURRENT_PARSE_RESULT_SCHEMA_VERSION,
  );
  if (!claim.ok) return failure(dependencies, REREAD_FAILURE_MESSAGE, 503);

  if (claim.outcome.outcome === "replayed") {
    return response(REREAD_SUCCESS_STATUS, ok({ replayed: true }));
  }
  if (
    claim.outcome.outcome === "in_progress" ||
    claim.outcome.outcome === "busy"
  ) {
    return response(
      REREAD_RETRYABLE_STATUS,
      fail(ALREADY_READING_MESSAGE, { code: "already_reading" }),
    );
  }
  if (claim.outcome.outcome === "no_allowance") {
    return response(
      402,
      fail(REREAD_FAILURE_MESSAGE, { code: "no_allowance" }),
    );
  }
  if (claim.outcome.outcome === "not_entitled") {
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
        console.error("parse.reread.release.failed", {
          accountId,
          attemptId,
          generation,
        });
      }
    } catch (error) {
      console.error("parse.reread.release.threw", summarizeErrorForLog(error));
    }
  };

  try {
    if (
      !(await verifyStorageMetadata(
        service,
        selectedFile.file,
        selectedFile.dirPath,
        selectedFile.fileName,
      ))
    ) {
      return failure(dependencies);
    }

    const download = await service.storage
      .from(DOCUMENTS_BUCKET)
      .download(selectedFile.file.path);
    const fileData = download.data;
    if (download.error || !fileData || fileData.size > MAX_ATTACHMENT_BYTES) {
      return failure(dependencies);
    }
    const bytes = await fileData.arrayBuffer();
    if (!validateDownloadedRereadFile(bytes, selectedFile.file.mime_type)) {
      return failure(dependencies);
    }

    let raw: unknown;
    try {
      raw = await dependencies.extractor.extract(
        bytes,
        selectedFile.file.mime_type,
      );
    } catch (error) {
      console.error(
        error instanceof ExtractorTimeoutError
          ? "parse.reread.extract.timeout"
          : "parse.reread.extract.failed",
        summarizeErrorForLog(error),
      );
      return failure(dependencies);
    }

    const draft = toDraft(raw);
    const nextSections = buildRereadSections(
      resume.sections,
      draft.sections.additionalSections,
    );
    if (!nextSections) {
      return failure(dependencies);
    }

    const applied =
      body.mode === "fill_empty"
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
    if (applied.outcome === "stale_file") {
      return response(
        REREAD_RETRYABLE_STATUS,
        fail(REREAD_STALE_FILE_MESSAGE, { code: "stale_file" }),
      );
    }
    if (applied.outcome === "cas_failed") {
      return failure(dependencies, REREAD_FAILURE_MESSAGE, 409);
    }
    if (applied.outcome === "failed") {
      return failure(dependencies);
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
      body.mode === "fill_empty" &&
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
    return failure(dependencies);
  } finally {
    await releaseClaim();
  }
}
