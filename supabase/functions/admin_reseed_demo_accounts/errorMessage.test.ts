import { describe, expect, it } from "vitest";
import { formatSupabaseError, getErrorMessage } from "./errorMessage.ts";

describe("getErrorMessage", () => {
  it("returns the message of an Error instance", () => {
    // Arrange
    const error = new Error("boom");

    // Act / Assert
    expect(getErrorMessage(error)).toBe("boom");
  });

  it("stringifies a non-Error catch value instead of throwing", () => {
    // Arrange
    const notAnError = "just a string";

    // Act / Assert
    expect(getErrorMessage(notAnError)).toBe("just a string");
  });
});

describe("formatSupabaseError", () => {
  it("returns the message unchanged when it is already informative", () => {
    // Arrange
    const error = { message: "row locked" };

    // Act
    const result = formatSupabaseError(error);

    // Assert
    expect(result).toBe("row locked");
  });

  it("falls back to name and status instead of the literal string '{}' — the exact production defect this exists to fix", () => {
    // Arrange: this is precisely what @supabase/auth-js produces for any
    // 5xx response — `.message` set to the JSON.stringify of the raw
    // Response object, which always serializes to "{}" because a
    // Response's fields are prototype getters, not own properties.
    const error = {
      message: "{}",
      name: "AuthRetryableFetchError",
      status: 500,
    };

    // Act
    const result = formatSupabaseError(error);

    // Assert
    expect(result).not.toContain("{}");
    expect(result).toContain("AuthRetryableFetchError");
    expect(result).toContain("status 500");
    expect(result).toContain("no message returned by the API");
  });

  it("treats '[object Object]' as equally uninformative as '{}'", () => {
    // Arrange
    const error = { message: "[object Object]", status: 500 };

    // Act
    const result = formatSupabaseError(error);

    // Assert
    expect(result).not.toContain("[object Object]");
    expect(result).toContain("no message returned by the API");
  });

  it("includes PostgREST code/details/hint alongside the message", () => {
    // Arrange
    const error = {
      message: "update or delete on table violates foreign key constraint",
      code: "23503",
      details: 'Key (id)=(42) is still referenced from table "members".',
      hint: "Remove the referencing row first.",
    };

    // Act
    const result = formatSupabaseError(error);

    // Assert
    expect(result).toContain("foreign key constraint");
    expect(result).toContain("code 23503");
    expect(result).toContain("details:");
    expect(result).toContain("hint:");
  });

  it("ignores inherited (non-own) name/status/code so a plain Error isn't padded with boilerplate", () => {
    // Arrange: Error.prototype.name = "Error" is inherited, not an own
    // property — it must not get prepended to every plain thrown Error.
    const error = new Error("boom");

    // Act
    const result = formatSupabaseError(error);

    // Assert
    expect(result).toBe("boom");
  });

  it("falls back to getErrorMessage for a non-object catch value", () => {
    // Arrange
    const notAnError = "just a string";

    // Act / Assert
    expect(formatSupabaseError(notAnError)).toBe("just a string");
  });

  it("falls back to getErrorMessage for null", () => {
    // Act / Assert
    expect(formatSupabaseError(null)).toBe("null");
  });
});
