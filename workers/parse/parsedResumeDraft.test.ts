import { describe, expect, it } from "vitest";
import { LOW_CONFIDENCE_THRESHOLD, toDraft } from "./parsedResumeDraft";

describe("toDraft", () => {
  it("flags a field whose confidence is below the threshold", () => {
    // Arrange
    const raw = {
      name_en: { value: "Rivky", confidence: 0.95 },
      age: { value: 24, confidence: 0.5 },
    };

    // Act
    const draft = toDraft(raw);

    // Assert
    expect(draft.fields.name_en).toBe("Rivky");
    expect(draft.lowConfidenceFields).toContain("age");
    expect(draft.lowConfidenceFields).not.toContain("name_en");
  });

  it("nullifies a field that fails schema validation", () => {
    // Arrange
    const raw = {
      name_en: { value: "Rivky", confidence: 1.2 }, // invalid confidence
      location_en: "not an object",
    };

    // Act
    const draft = toDraft(raw);

    // Assert
    expect(draft.fields.name_en).toBeNull();
    expect(draft.fields.location_en).toBeNull();
    expect(draft.lowConfidenceFields).toHaveLength(0);
  });

  it("returns an all-null draft for empty/garbage input without throwing", () => {
    // Arrange / Act
    const draft = toDraft({ garbage: true });

    // Assert
    expect(Object.values(draft.fields).every((v) => v === null)).toBe(true);
    expect(draft.lowConfidenceFields).toHaveLength(0);
    expect(draft.sections.learningHistory).toEqual([]);
    expect(draft.sections.references).toEqual([]);
  });

  it("preserves sections and coerces empty defaults", () => {
    // Arrange
    const raw = {
      name_en: { value: "Rivky", confidence: 0.9 },
      sections: {
        learningHistory: [{ label: "Seminary", value: "Bais Yaakov" }],
        references: [
          { name: "Leah", relationship: "teacher", phone: "555-0100" },
        ],
      },
    };

    // Act
    const draft = toDraft(raw);

    // Assert
    expect(draft.fields.name_en).toBe("Rivky");
    expect(draft.sections.learningHistory).toEqual([
      { label: "Seminary", value: "Bais Yaakov" },
    ]);
    expect(draft.sections.references).toEqual([
      { name: "Leah", relationship: "teacher", phone: "555-0100" },
    ]);
  });

  it("flags exactly at the threshold boundary", () => {
    // Arrange
    const raw = {
      name_en: { value: "Rivky", confidence: LOW_CONFIDENCE_THRESHOLD },
      age: { value: 24, confidence: LOW_CONFIDENCE_THRESHOLD - 0.01 },
    };

    // Act
    const draft = toDraft(raw);

    // Assert
    expect(draft.lowConfidenceFields).not.toContain("name_en");
    expect(draft.lowConfidenceFields).toContain("age");
  });
});
