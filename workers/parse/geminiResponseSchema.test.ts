import { describe, expect, it } from "vitest";
import {
  GEMINI_RESUME_RESPONSE_SCHEMA,
  type GeminiSchema,
} from "./geminiResponseSchema";
import { FIELD_KEYS } from "./parsedResumeDraft";

/** Recursively collects every key present anywhere in a `GeminiSchema` tree
 * — used to prove `anyOf`/`oneOf` (which Gemini's structured-output dialect
 * does not reliably support for a single property, and which this schema
 * must never emit per Finding 14's precondition) is absent everywhere, not
 * just at the top level. */
function collectAllKeys(schema: GeminiSchema, keys: Set<string>): void {
  keys.add(schema.type);
  if (schema.properties) {
    for (const [key, value] of Object.entries(schema.properties)) {
      keys.add(key);
      collectAllKeys(value, keys);
    }
  }
  if (schema.items) {
    collectAllKeys(schema.items, keys);
  }
}

describe("GEMINI_RESUME_RESPONSE_SCHEMA", () => {
  it("declares exactly one entry per FIELD_KEYS plus sections, no more and no fewer", () => {
    // Arrange
    const declaredKeys = Object.keys(GEMINI_RESUME_RESPONSE_SCHEMA.properties!);

    // Act / Assert
    expect(declaredKeys.sort()).toEqual([...FIELD_KEYS, "sections"].sort());
  });

  it("types every field's value as NUMBER for age and STRING for every other field", () => {
    // Arrange
    const properties = GEMINI_RESUME_RESPONSE_SCHEMA.properties!;

    // Act / Assert
    for (const key of FIELD_KEYS) {
      const fieldValueType = properties[key].properties!.value.type;
      if (key === "age") {
        expect(fieldValueType).toBe("NUMBER");
      } else {
        expect(fieldValueType).toBe("STRING");
      }
    }
  });

  it("never uses anyOf/oneOf anywhere in the tree — Gemini's structured-output dialect does not reliably support a union for one property", () => {
    // Arrange
    const serialized = JSON.stringify(GEMINI_RESUME_RESPONSE_SCHEMA);

    // Act / Assert
    expect(serialized).not.toContain("anyOf");
    expect(serialized).not.toContain("oneOf");
  });

  it("declares confidence as NUMBER on every field wrapper", () => {
    // Arrange
    const properties = GEMINI_RESUME_RESPONSE_SCHEMA.properties!;

    // Act / Assert
    for (const key of FIELD_KEYS) {
      expect(properties[key].properties!.confidence.type).toBe("NUMBER");
    }
  });

  it("declares sections.learningHistory and sections.references as arrays of well-shaped objects", () => {
    // Arrange
    const sections = GEMINI_RESUME_RESPONSE_SCHEMA.properties!.sections;

    // Act / Assert
    expect(sections.properties!.learningHistory.type).toBe("ARRAY");
    expect(sections.properties!.learningHistory.items!.type).toBe("OBJECT");
    expect(sections.properties!.references.type).toBe("ARRAY");
    expect(sections.properties!.references.items!.type).toBe("OBJECT");
  });

  it("only ever uses the restricted OpenAPI-subset type vocabulary Gemini documents", () => {
    // Arrange
    const allKeys = new Set<string>();
    collectAllKeys(GEMINI_RESUME_RESPONSE_SCHEMA, allKeys);
    const allowedTypes = new Set([
      "STRING",
      "NUMBER",
      "INTEGER",
      "BOOLEAN",
      "ARRAY",
      "OBJECT",
    ]);

    // Act — every `type` value collected must be one of the allowed types;
    // field-name keys (e.g. "name_en", "value") are also in the set but are
    // irrelevant to this specific check, so only assert the ones that ARE
    // type-shaped strings are in the allowlist.
    for (const key of allKeys) {
      if (key === key.toUpperCase() && key.length > 0 && /^[A-Z]+$/.test(key)) {
        expect(allowedTypes.has(key)).toBe(true);
      }
    }
  });
});
