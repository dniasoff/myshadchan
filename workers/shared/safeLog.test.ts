import { describe, expect, it } from "vitest";
import { z } from "zod";
import { summarizeErrorForLog } from "./safeLog";

/**
 * Finding 5: the pre-fix test suites across this tree only ever threw
 * `new Error("kaboom")` — a literal, author-controlled string that cannot
 * leak anything by construction. Every case here injects something that
 * COULD leak (an email inside a Postgrest `.details`, an API key inside a
 * ZodError issue) and asserts it is absent from the summary's serialized
 * form, not merely that the summary "looks fine".
 */
describe("summarizeErrorForLog", () => {
  it("reduces a Postgrest-error-shaped object to category/errorClass/postgresCode only, never .details/.hint/.message", () => {
    // Arrange — a real Postgres unique-violation error, shaped exactly as
    // supabase-js's PostgrestError, echoing an applicant's email in .details
    // (this is genuinely how Postgres reports a constraint violation).
    const pgError = {
      message: "duplicate key value violates unique constraint",
      details: "Key (email)=(chana.friedman@example.com) already exists.",
      hint: "Applicant email chana.friedman@example.com already on file.",
      code: "23505",
    };

    // Act
    const summary = summarizeErrorForLog(pgError);
    const serialized = JSON.stringify(summary);

    // Assert
    expect(summary).toEqual({
      category: "database",
      errorClass: "Object",
      postgresCode: "23505",
    });
    expect(serialized).not.toContain("chana.friedman@example.com");
    expect(serialized).not.toContain("details");
    expect(serialized).not.toContain("hint");
    expect(serialized).not.toContain("duplicate key");
  });

  it("reduces a real ZodError to category/errorClass/issueCount only, never .issues content", () => {
    // Arrange — fail a real schema on an object carrying a fake API key in
    // an unexpected field, proving the issue's own received-value content
    // (which Zod records) never survives into the summary.
    const schema = z.object({ apiKey: z.number() });
    const result = schema.safeParse({ apiKey: "sk-fake-abc123secret" });
    if (result.success) {
      throw new Error("test setup invariant violated: expected a ZodError");
    }

    // Act
    const summary = summarizeErrorForLog(result.error);
    const serialized = JSON.stringify(summary);

    // Assert
    expect(summary).toEqual({
      category: "validation",
      errorClass: "ZodError",
      issueCount: 1,
    });
    expect(serialized).not.toContain("sk-fake-abc123secret");
    expect(serialized).not.toContain("issues");
  });

  it("never crashes on a non-Error thrown value and reports category unknown", () => {
    // Act / Assert
    expect(summarizeErrorForLog("a bare string throw")).toEqual({
      category: "unknown",
      errorClass: "string",
    });
    expect(summarizeErrorForLog(42)).toEqual({
      category: "unknown",
      errorClass: "number",
    });
    expect(summarizeErrorForLog(undefined)).toEqual({
      category: "unknown",
      errorClass: "undefined",
    });
    expect(summarizeErrorForLog(null)).toEqual({
      category: "unknown",
      errorClass: "object",
    });
  });

  it("classifies a plain Error by its constructor name only, dropping the message", () => {
    // Arrange
    const error = new Error("this message contains rivky@example.com");

    // Act
    const summary = summarizeErrorForLog(error);

    // Assert
    expect(summary).toEqual({ category: "unknown", errorClass: "Error" });
    expect(JSON.stringify(summary)).not.toContain("rivky@example.com");
  });

  it("classifies a subclassed Error by its own class name", () => {
    // Arrange
    class ExtractorProviderError extends Error {
      constructor(public readonly status: number) {
        super("Gemini extraction failed");
        this.name = "ExtractorProviderError";
      }
    }
    const error = new ExtractorProviderError(502);

    // Act
    const summary = summarizeErrorForLog(error);

    // Assert — a numeric `status` property routes this through the
    // http_status branch (checked ahead of the generic Error fallback),
    // carrying the bounded status code, never the message.
    expect(summary).toEqual({
      category: "http_status",
      errorClass: "ExtractorProviderError",
      httpStatus: 502,
    });
  });

  it("classifies a timeout-shaped error distinctly from a generic failure", () => {
    // Arrange — the shape `AbortSignal.timeout()` produces on abort.
    const error = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );

    // Act
    const summary = summarizeErrorForLog(error);

    // Assert
    expect(summary).toEqual({
      category: "timeout",
      errorClass: "TimeoutError",
    });
    expect(JSON.stringify(summary)).not.toContain("aborted due to timeout");
  });

  it("omits postgresCode when the shape has a code but it is not SQLSTATE-shaped", () => {
    // Arrange — some other library's error object that happens to carry an
    // arbitrary string `code`, not a real 5-char SQLSTATE.
    const error = { code: "ECONNRESET-with-a-leaked-hostname.internal" };

    // Act
    const summary = summarizeErrorForLog(error);

    // Assert
    expect(summary.category).toBe("database");
    expect(summary.postgresCode).toBeUndefined();
    expect(JSON.stringify(summary)).not.toContain("leaked-hostname");
  });
});
