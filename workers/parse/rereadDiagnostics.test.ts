import { describe, expect, it, vi } from "vitest";

import {
  buildExtractorFailureLog,
  buildExtractorAttemptLog,
  buildExtractorShapeLog,
  buildRereadFailureLog,
  logExtractorAttempt,
  logExtractorFailure,
  logExtractorShape,
  logRereadFailure,
  REREAD_FAILURE_REASON_VALUES,
} from "./rereadDiagnostics";

describe("re-read diagnostics", () => {
  it.each(REREAD_FAILURE_REASON_VALUES)(
    "emits the static %s reason code",
    (reason) => {
      expect(buildRereadFailureLog(reason)).toEqual({ reason });
    },
  );

  it("reduces hostile route reasons to the static reason vocabulary", () => {
    const hostile =
      "resume text <script>alert('name@example.com')</script> path=10/resumes/22/key";

    expect(buildRereadFailureLog(hostile)).toEqual({ reason: "unknown" });
    expect(JSON.stringify(buildRereadFailureLog(hostile))).not.toContain(
      hostile,
    );
  });

  it("keeps extractor diagnostics to classes, enums and bounded counts", () => {
    const hostile =
      "resume text <script>alert('name@example.com')</script> api-key";

    const log = buildExtractorFailureLog(new Error(hostile), {
      durationMs: 42,
      httpStatus: 502,
      finishReason: hostile,
      usageMetadata: {
        promptTokenCount: 11,
        candidatesTokenCount: 7,
        thoughtsTokenCount: 3,
        totalTokenCount: 21,
        leakedText: hostile,
      },
    });

    expect(log).toEqual({
      errorClass: "Error",
      durationMs: 42,
      httpStatus: 502,
      finishReason: "UNKNOWN",
      promptTokenCount: 11,
      candidatesTokenCount: 7,
      thoughtsTokenCount: 3,
      totalTokenCount: 21,
    });
    expect(JSON.stringify(log)).not.toContain(hostile);
  });

  it("allow-lists retry attempt metadata without admitting hostile values", () => {
    const hostile = "resume text api-key=secret";

    expect(
      buildExtractorFailureLog(new Error(hostile), {
        durationMs: 7,
        attempt: 2,
        statusClass: "transient",
      }),
    ).toEqual({
      errorClass: "Error",
      durationMs: 7,
      attempt: 2,
      statusClass: "transient",
    });
    expect(
      buildExtractorFailureLog(new Error(hostile), {
        durationMs: hostile,
        attempt: hostile,
        statusClass: hostile,
      }),
    ).toEqual({
      errorClass: "Error",
      durationMs: 0,
    });
  });

  it("allow-lists the configured model name in per-attempt diagnostics", () => {
    expect(buildExtractorAttemptLog("gemini-2.5-flash-lite", 1)).toEqual({
      model: "gemini-2.5-flash-lite",
      attempt: 1,
    });
    expect(
      buildExtractorAttemptLog("https://private.invalid/model", "resume"),
    ).toEqual({
      model: "unknown",
      attempt: 0,
    });
    expect(
      buildExtractorAttemptLog("gemini-3.6-flash", 1, "model_not_found"),
    ).toEqual({
      model: "gemini-3.6-flash",
      attempt: 1,
      fallbackReason: "model_not_found",
    });
    expect(
      buildExtractorAttemptLog("gemini-3.6-flash", 1, "transient_exhausted"),
    ).toEqual({
      model: "gemini-3.6-flash",
      attempt: 1,
      fallbackReason: "transient_exhausted",
    });
    expect(
      buildExtractorAttemptLog("gemini-3.6-flash", 1, "private detail"),
    ).toEqual({
      model: "gemini-3.6-flash",
      attempt: 1,
    });
    expect(
      buildExtractorAttemptLog("gemini-3.6-flash", 1, undefined, "low"),
    ).toEqual({
      model: "gemini-3.6-flash",
      attempt: 1,
      thinkingLevel: "low",
    });
    expect(
      buildExtractorAttemptLog(
        "gemini-3.6-flash",
        1,
        undefined,
        "resume text api-key=secret",
      ),
    ).toEqual({
      model: "gemini-3.6-flash",
      attempt: 1,
    });
  });

  it("allow-lists the static bad-request failure reason", () => {
    expect(
      buildExtractorFailureLog(new Error("private detail"), {
        durationMs: 4,
        statusClass: "permanent",
        reason: "bad_request",
      }),
    ).toEqual({
      errorClass: "Error",
      durationMs: 4,
      statusClass: "permanent",
      reason: "bad_request",
    });
    expect(
      buildExtractorFailureLog(new Error("private detail"), {
        durationMs: 4,
        reason: "private detail",
      }),
    ).toEqual({
      errorClass: "Error",
      durationMs: 4,
    });
  });

  it("emits numeric-only shape diagnostics with allow-listed provider metadata", () => {
    const hostile = "resume text <script>name@example.com</script>";
    const log = buildExtractorShapeLog(
      {
        rawFieldsNonNull: 17,
        keptFields: 16,
        rawReferences: 10,
        keptReferences: 10,
        rawLearning: 4,
        keptLearning: 4,
        rawAdditionalSections: 3,
        keptAdditionalSections: 2,
        droppedByPrivacyFilter: 1,
      },
      {
        model: "gemini-3.6-flash",
        finishReason: "MAX_TOKENS",
        usageMetadata: {
          promptTokenCount: 1214,
          candidatesTokenCount: 512,
          thoughtsTokenCount: 2048,
          privateText: hostile,
        },
      },
    );

    expect(log).toEqual({
      rawFieldsNonNull: 17,
      keptFields: 16,
      rawReferences: 10,
      keptReferences: 10,
      rawLearning: 4,
      keptLearning: 4,
      rawAdditionalSections: 3,
      keptAdditionalSections: 2,
      droppedByPrivacyFilter: 1,
      finishReason: "MAX_TOKENS",
      promptTokens: 1214,
      candidateTokens: 512,
      thoughtTokens: 2048,
      model: "gemini-3.6-flash",
    });
    expect(JSON.stringify(log)).not.toContain(hostile);
    expect(
      Object.values(log).every(
        (value) => typeof value === "number" || typeof value === "string",
      ),
    ).toBe(true);
  });

  it("keeps allow-listed Cloudflare metadata in actual sanitized log output", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const counts = {
      rawFieldsNonNull: 1,
      keptFields: 1,
      rawReferences: 8,
      keptReferences: 8,
      rawLearning: 1,
      keptLearning: 1,
      rawAdditionalSections: 0,
      keptAdditionalSections: 0,
      droppedByPrivacyFilter: 0,
    };

    logExtractorAttempt("openai/gpt-6-luna", 1);
    logExtractorShape(counts, {
      model: "openai/gpt-6-luna",
      finishReason: "completed",
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 8,
        thoughtsTokenCount: 0,
      },
    });
    logExtractorAttempt("openai/gpt-9-luna", 1);
    logExtractorShape(counts, {
      model: "openai/gpt-9-luna",
      finishReason: "provider leaked resume text",
      usageMetadata: {},
    });

    expect(warn).toHaveBeenNthCalledWith(1, "parse.extract.attempt", {
      model: "openai/gpt-6-luna",
      attempt: 1,
    });
    expect(warn).toHaveBeenNthCalledWith(2, "parse.extract.shape", {
      ...counts,
      finishReason: "completed",
      promptTokens: 12,
      candidateTokens: 8,
      thoughtTokens: 0,
      model: "openai/gpt-6-luna",
    });
    expect(warn).toHaveBeenNthCalledWith(3, "parse.extract.attempt", {
      model: "unknown",
      attempt: 1,
    });
    expect(warn).toHaveBeenNthCalledWith(4, "parse.extract.shape", {
      ...counts,
      finishReason: "UNKNOWN",
      promptTokens: 0,
      candidateTokens: 0,
      thoughtTokens: 0,
      model: "unknown",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "provider leaked resume text",
    );
    warn.mockRestore();
  });

  it("rejects prototype names in Cloudflare model and status diagnostics", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const counts = {
      rawFieldsNonNull: 0,
      keptFields: 0,
      rawReferences: 0,
      keptReferences: 0,
      rawLearning: 0,
      keptLearning: 0,
      rawAdditionalSections: 0,
      keptAdditionalSections: 0,
      droppedByPrivacyFilter: 0,
    };
    const prototypeNames = [
      "toString",
      "constructor",
      "__proto__",
      "hasOwnProperty",
      "valueOf",
    ];

    for (const name of prototypeNames) {
      logExtractorAttempt(name, 1);
      logExtractorShape(counts, {
        model: name,
        finishReason: name,
        usageMetadata: {},
      });
    }

    for (const [index] of prototypeNames.entries()) {
      expect(warn).toHaveBeenNthCalledWith(
        index * 2 + 1,
        "parse.extract.attempt",
        { model: "unknown", attempt: 1 },
      );
      expect(warn).toHaveBeenNthCalledWith(
        index * 2 + 2,
        "parse.extract.shape",
        {
          ...counts,
          finishReason: "UNKNOWN",
          promptTokens: 0,
          candidateTokens: 0,
          thoughtTokens: 0,
          model: "unknown",
        },
      );
    }
    warn.mockRestore();
  });

  it("defaults missing shape metadata to static enums and zero counts", () => {
    expect(
      buildExtractorShapeLog({
        rawFieldsNonNull: "private",
        keptFields: undefined,
        rawReferences: -1,
        keptReferences: 0,
        rawLearning: 0,
        keptLearning: 0,
        rawAdditionalSections: 0,
        keptAdditionalSections: 0,
        droppedByPrivacyFilter: 0,
      }),
    ).toEqual({
      rawFieldsNonNull: 0,
      keptFields: 0,
      rawReferences: 0,
      keptReferences: 0,
      rawLearning: 0,
      keptLearning: 0,
      rawAdditionalSections: 0,
      keptAdditionalSections: 0,
      droppedByPrivacyFilter: 0,
      finishReason: "UNKNOWN",
      promptTokens: 0,
      candidateTokens: 0,
      thoughtTokens: 0,
      model: "unknown",
    });
  });

  it("logs only the sanitized payloads", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logRereadFailure("storage_metadata");
    logExtractorFailure(new TypeError("private resume text"), {
      durationMs: 3,
    });
    logExtractorAttempt("gemini-3.6-flash", 1);
    logExtractorShape({
      rawFieldsNonNull: 1,
      keptFields: 1,
      rawReferences: 0,
      keptReferences: 0,
      rawLearning: 0,
      keptLearning: 0,
      rawAdditionalSections: 0,
      keptAdditionalSections: 0,
      droppedByPrivacyFilter: 0,
    });

    expect(error).toHaveBeenNthCalledWith(1, "parse.reread.fail", {
      reason: "storage_metadata",
    });
    expect(error).toHaveBeenNthCalledWith(2, "parse.extract.failed", {
      errorClass: "TypeError",
      durationMs: 3,
    });
    expect(warn).toHaveBeenCalledWith("parse.extract.attempt", {
      model: "gemini-3.6-flash",
      attempt: 1,
    });
    expect(warn).toHaveBeenCalledWith("parse.extract.shape", {
      rawFieldsNonNull: 1,
      keptFields: 1,
      rawReferences: 0,
      keptReferences: 0,
      rawLearning: 0,
      keptLearning: 0,
      rawAdditionalSections: 0,
      keptAdditionalSections: 0,
      droppedByPrivacyFilter: 0,
      finishReason: "UNKNOWN",
      promptTokens: 0,
      candidateTokens: 0,
      thoughtTokens: 0,
      model: "unknown",
    });
    error.mockRestore();
    warn.mockRestore();
  });
});
