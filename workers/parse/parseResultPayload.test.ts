import { describe, expect, it } from "vitest";
import { ParseResultPayloadSchema } from "./parseResultPayload";
import { makeParseResultPayload } from "./parseTestFixtures";

/**
 * Finding 12 (Epic 11 adversarial review) closure: `ParseResultPayloadSchema`
 * is what stands between a replayed `ai_parse_attempts.result` row and a
 * silently-trusted `as` cast. This file exercises the schema directly,
 * independent of the claim/confirm resolvers that consume it.
 */
describe("ParseResultPayloadSchema", () => {
  it("accepts a fully-shaped, current-contract payload", () => {
    // Arrange
    const payload = makeParseResultPayload({
      fields: { name_en: "Rivky", age: 24 },
    });

    // Act
    const result = ParseResultPayloadSchema.safeParse(payload);

    // Assert
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing one of the fourteen required fields (Finding 12 — a corrupted or partial cached row must not pass)", () => {
    // Arrange — the pre-fix shape: a partial `fields` object.
    const partial = {
      fields: { name_en: "Rivky" },
      lowConfidenceFields: [],
      sections: { learningHistory: [], references: [] },
      rawDraft: {},
    };

    // Act
    const result = ParseResultPayloadSchema.safeParse(partial);

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects a numeric value on a text-shaped field (Finding 13 — the narrowed, not uniform, field contract)", () => {
    // Arrange
    const payload = makeParseResultPayload({
      fields: { name_en: 5 as unknown as string },
    });

    // Act
    const result = ParseResultPayloadSchema.safeParse(payload);

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects a string value on the numeric age field", () => {
    // Arrange
    const payload = makeParseResultPayload({
      fields: { age: "24" as unknown as number },
    });

    // Act
    const result = ParseResultPayloadSchema.safeParse(payload);

    // Assert
    expect(result.success).toBe(false);
  });

  it("rejects an entirely unrelated shape", () => {
    // Act
    const result = ParseResultPayloadSchema.safeParse({ not: "a payload" });

    // Assert
    expect(result.success).toBe(false);
  });
});
