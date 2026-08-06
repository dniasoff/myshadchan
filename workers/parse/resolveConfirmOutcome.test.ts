import { describe, expect, it } from "vitest";
import { resolveConfirmOutcome } from "./resolveConfirmOutcome";
import { CURRENT_PARSE_RESULT_SCHEMA_VERSION } from "./parseResultPayload";
import { makeParseResultPayload } from "./parseTestFixtures";

/**
 * Findings 8/9/12 (Epic 11 adversarial review) closure — unit coverage for
 * `resolveConfirmOutcome()` in isolation. `index.test.ts` /
 * `index.idempotency.test.ts` / `index.quotaEnforcement.test.ts` cover the
 * HTTP-level consequence of each `ConfirmResolution`; this file covers the
 * decision logic itself.
 */
describe("resolveConfirmOutcome", () => {
  it("resolves to applied on a durable write", () => {
    // Arrange
    const outcome = { outcome: "applied" as const };

    // Act
    const resolution = resolveConfirmOutcome(outcome);

    // Assert
    expect(resolution).toEqual({ kind: "applied" });
  });

  it("resolves to superseded_replay with the winner's validated payload when it already completed at the current schema version (Finding 8)", () => {
    // Arrange
    const payload = makeParseResultPayload({ fields: { name_en: "Winner" } });
    const outcome = {
      outcome: "superseded" as const,
      status: "completed" as const,
      result: payload,
      resultSchemaVersion: CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    };

    // Act
    const resolution = resolveConfirmOutcome(outcome);

    // Assert
    expect(resolution).toEqual({ kind: "superseded_replay", payload });
  });

  it("resolves to superseded_conflict when the winner completed but its cached result fails re-validation (Finding 12 defense-in-depth)", () => {
    // Arrange
    const outcome = {
      outcome: "superseded" as const,
      status: "completed" as const,
      result: { not: "a valid payload" },
      resultSchemaVersion: CURRENT_PARSE_RESULT_SCHEMA_VERSION,
    };

    // Act
    const resolution = resolveConfirmOutcome(outcome);

    // Assert
    expect(resolution).toEqual({ kind: "superseded_conflict" });
  });

  it("resolves to superseded_conflict when the winner completed at an older, non-current schema version", () => {
    // Arrange
    const payload = makeParseResultPayload();
    const outcome = {
      outcome: "superseded" as const,
      status: "completed" as const,
      result: payload,
      resultSchemaVersion: CURRENT_PARSE_RESULT_SCHEMA_VERSION - 1,
    };

    // Act
    const resolution = resolveConfirmOutcome(outcome);

    // Assert
    expect(resolution).toEqual({ kind: "superseded_conflict" });
  });

  it("resolves to superseded_conflict when the winner is still in progress", () => {
    // Arrange
    const outcome = {
      outcome: "superseded" as const,
      status: "in_progress" as const,
    };

    // Act
    const resolution = resolveConfirmOutcome(outcome);

    // Assert
    expect(resolution).toEqual({ kind: "superseded_conflict" });
  });

  it("resolves to superseded_conflict when the winner failed", () => {
    // Arrange
    const outcome = {
      outcome: "superseded" as const,
      status: "failed" as const,
    };

    // Act
    const resolution = resolveConfirmOutcome(outcome);

    // Assert
    expect(resolution).toEqual({ kind: "superseded_conflict" });
  });

  it("resolves to unconfirmed when every retry was exhausted without a durable answer (Finding 9)", () => {
    // Arrange
    const outcome = { outcome: "failed" as const };

    // Act
    const resolution = resolveConfirmOutcome(outcome);

    // Assert
    expect(resolution).toEqual({ kind: "unconfirmed" });
  });
});
