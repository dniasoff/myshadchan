import { describe, expect, it, vi } from "vitest";

import {
  buildExtractorFailureLog,
  buildExtractorAttemptLog,
  buildRereadFailureLog,
  logExtractorAttempt,
  logExtractorFailure,
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
  });

  it("logs only the sanitized payloads", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logRereadFailure("storage_metadata");
    logExtractorFailure(new TypeError("private resume text"), {
      durationMs: 3,
    });
    logExtractorAttempt("gemini-3.6-flash", 1);

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
    error.mockRestore();
    warn.mockRestore();
  });
});
