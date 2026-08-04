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

  // Review fix (Finding 3): father/mother must come back as four SEPARATE
  // fields — ShidduchInputs.tsx has no input for a combined "parents" value,
  // so that shape was silently discarded on every auto-fill.
  it("emits split father/mother fields, never a combined parents field", () => {
    // Arrange
    const raw = {
      father_en: { value: "Yaakov Cohen", confidence: 0.9 },
      father_he: { value: "יעקב כהן", confidence: 0.9 },
      mother_en: { value: "Rivka Cohen", confidence: 0.85 },
      mother_he: { value: "רבקה כהן", confidence: 0.85 },
    };

    // Act
    const draft = toDraft(raw);

    // Assert
    expect(draft.fields.father_en).toBe("Yaakov Cohen");
    expect(draft.fields.father_he).toBe("יעקב כהן");
    expect(draft.fields.mother_en).toBe("Rivka Cohen");
    expect(draft.fields.mother_he).toBe("רבקה כהן");
    expect(draft.fields).not.toHaveProperty("parents_en");
    expect(draft.fields).not.toHaveProperty("parents_he");
  });

  // Review fix (Finding 10, SMALL scope): bounds on string length and array
  // size so a pathological model response cannot blow up the client.
  describe("Finding 10 — pathological response bounds", () => {
    it("falls back to an all-null draft when a field value exceeds the max length", () => {
      // Arrange
      const raw = {
        name_en: { value: "Rivky", confidence: 0.9 },
        location_en: { value: "x".repeat(10_000), confidence: 0.9 },
      };

      // Act
      const draft = toDraft(raw);

      // Assert — the whole-object schema rejects the oversized field, so
      // `toDraft` falls back to its existing all-null default rather than
      // ever handing a 10,000-char string to the client.
      expect(Object.values(draft.fields).every((v) => v === null)).toBe(true);
    });

    it("falls back to an all-null draft when a section array exceeds the max length", () => {
      // Arrange
      const oversizedReferences = Array.from({ length: 51 }, (_, i) => ({
        name: `Ref ${i}`,
        relationship: "friend",
        phone: "555-0100",
      }));
      const raw = {
        name_en: { value: "Rivky", confidence: 0.9 },
        sections: { learningHistory: [], references: oversizedReferences },
      };

      // Act
      const draft = toDraft(raw);

      // Assert
      expect(draft.sections.references).toEqual([]);
      expect(Object.values(draft.fields).every((v) => v === null)).toBe(true);
    });

    it("accepts a section array right at the max length", () => {
      // Arrange
      const references = Array.from({ length: 50 }, (_, i) => ({
        name: `Ref ${i}`,
        relationship: "friend",
        phone: "555-0100",
      }));
      const raw = {
        name_en: { value: "Rivky", confidence: 0.9 },
        sections: { learningHistory: [], references },
      };

      // Act
      const draft = toDraft(raw);

      // Assert
      expect(draft.sections.references).toHaveLength(50);
      expect(draft.fields.name_en).toBe("Rivky");
    });
  });
});
