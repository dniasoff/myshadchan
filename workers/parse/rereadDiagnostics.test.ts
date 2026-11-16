import { describe, expect, it, vi } from "vitest";

import {
  buildExtractorFailureLog,
  buildRereadFailureLog,
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

  it("logs only the sanitized payloads", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logRereadFailure("storage_metadata");
    logExtractorFailure(new TypeError("private resume text"), {
      durationMs: 3,
    });

    expect(error).toHaveBeenNthCalledWith(1, "parse.reread.fail", {
      reason: "storage_metadata",
    });
    expect(error).toHaveBeenNthCalledWith(2, "parse.extract.failed", {
      errorClass: "TypeError",
      durationMs: 3,
    });
    error.mockRestore();
  });
});
