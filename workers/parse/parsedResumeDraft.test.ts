import { describe, expect, it } from "vitest";
import {
  FIELD_KEYS,
  LOW_CONFIDENCE_THRESHOLD,
  RawExtractionSchema,
  toDraft,
} from "./parsedResumeDraft";

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

  it("returns an all-null draft for non-object input (array, string, null) without throwing", () => {
    // Arrange / Act / Assert
    for (const input of [null, "not an object", ["also not"], 42]) {
      const draft = toDraft(input);
      expect(Object.values(draft.fields).every((v) => v === null)).toBe(true);
      expect(draft.sections.learningHistory).toEqual([]);
      expect(draft.sections.references).toEqual([]);
    }
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

  // Finding 13 (Epic 11 adversarial review): exactly one numeric field
  // (age) — every other field, height included, is text. Coercion happens
  // at the validation boundary so a stray cross-typed value costs nothing.
  describe("Finding 13 — field-specific types and boundary coercion", () => {
    it("coerces a numeric-looking string into a real number for age", () => {
      // Arrange
      const raw = { age: { value: "27", confidence: 0.9 } };

      // Act
      const draft = toDraft(raw);

      // Assert
      expect(draft.fields.age).toBe(27);
      expect(typeof draft.fields.age).toBe("number");
    });

    it("nulls age alone (never the rest of the draft) when it cannot be coerced to a number", () => {
      // Arrange
      const raw = {
        name_en: { value: "Rivky", confidence: 0.9 },
        age: { value: "twenties", confidence: 0.9 },
      };

      // Act
      const draft = toDraft(raw);

      // Assert
      expect(draft.fields.age).toBeNull();
      expect(draft.fields.name_en).toBe("Rivky");
    });

    it("coerces a bare number into a string for every text field, including height", () => {
      // Arrange
      const raw = {
        name_en: { value: 42, confidence: 0.9 },
        height: { value: 510, confidence: 0.8 },
      };

      // Act
      const draft = toDraft(raw);

      // Assert
      expect(draft.fields.name_en).toBe("42");
      expect(typeof draft.fields.name_en).toBe("string");
      expect(draft.fields.height).toBe("510");
      expect(typeof draft.fields.height).toBe("string");
    });

    it("keeps height as freeform text, not a parsed dimension", () => {
      // Arrange
      const raw = { height: { value: "5'10\"", confidence: 0.9 } };

      // Act
      const draft = toDraft(raw);

      // Assert
      expect(draft.fields.height).toBe("5'10\"");
    });

    it("every ParsedResumeFields key is typed string|null except age, which is number|null", () => {
      // Arrange
      const raw = Object.fromEntries(
        FIELD_KEYS.map((key) => [
          key,
          { value: key === "age" ? 30 : "x", confidence: 0.9 },
        ]),
      );

      // Act
      const draft = toDraft(raw);

      // Assert
      for (const key of FIELD_KEYS) {
        if (key === "age") {
          expect(typeof draft.fields[key]).toBe("number");
        } else {
          expect(typeof draft.fields[key]).toBe("string");
        }
      }
    });
  });

  // Finding 14 (Epic 11 adversarial review): validation is now PER FIELD —
  // one malformed field must never cost the other good fields, unlike the
  // old whole-object `RawExtractionSchema.safeParse` which discarded the
  // entire draft the moment any single field failed.
  describe("Finding 14 — per-field-tolerant validation (no more all-or-nothing)", () => {
    it("keeps every other well-formed field when exactly one field is malformed", () => {
      // Arrange — age is given a shape Zod would reject entirely (not an
      // object at all), while every other field is well-formed.
      const raw = {
        name_en: { value: "Rivky", confidence: 0.9 },
        name_he: { value: "רבקה", confidence: 0.9 },
        father_en: { value: "Yaakov", confidence: 0.8 },
        age: "not an object",
        height: { value: "5'6\"", confidence: 0.8 },
      };

      // Act
      const draft = toDraft(raw);

      // Assert — the malformed field alone is null; nothing else pays for it.
      expect(draft.fields.age).toBeNull();
      expect(draft.fields.name_en).toBe("Rivky");
      expect(draft.fields.name_he).toBe("רבקה");
      expect(draft.fields.father_en).toBe("Yaakov");
      expect(draft.fields.height).toBe("5'6\"");
    });

    it("drops only the malformed entry in a section array, keeping well-formed siblings", () => {
      // Arrange — the middle reference is missing its required `phone`.
      const raw = {
        sections: {
          learningHistory: [],
          references: [
            { name: "Leah", relationship: "teacher", phone: "555-0100" },
            { name: "Malformed", relationship: "friend" }, // missing phone
            { name: "Sara", relationship: "aunt", phone: "555-0199" },
          ],
        },
      };

      // Act
      const draft = toDraft(raw);

      // Assert
      expect(draft.sections.references).toEqual([
        { name: "Leah", relationship: "teacher", phone: "555-0100" },
        { name: "Sara", relationship: "aunt", phone: "555-0199" },
      ]);
    });
  });

  // Review fix (Finding 10, SMALL scope): bounds on string length and array
  // size so a pathological model response cannot blow up the client. Under
  // Finding 14's per-field tolerance, exceeding a bound now costs only the
  // offending field/entry — never the whole draft.
  describe("Finding 10 — pathological response bounds (now per-field, per Finding 14)", () => {
    it("nulls only the oversized field, keeping every other field intact", () => {
      // Arrange
      const raw = {
        name_en: { value: "Rivky", confidence: 0.9 },
        location_en: { value: "x".repeat(10_000), confidence: 0.9 },
      };

      // Act
      const draft = toDraft(raw);

      // Assert
      expect(draft.fields.location_en).toBeNull();
      expect(draft.fields.name_en).toBe("Rivky");
    });

    it("caps a section array at MAX_SECTION_ARRAY_LENGTH instead of dropping it entirely", () => {
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

      // Assert — capped at 50, not zeroed, and the rest of the draft is
      // unaffected.
      expect(draft.sections.references).toHaveLength(50);
      expect(draft.fields.name_en).toBe("Rivky");
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

describe("RawExtractionSchema (shape reference for GEMINI_RESUME_RESPONSE_SCHEMA's conformance test)", () => {
  it("has exactly the fourteen field keys plus sections", () => {
    // Act
    const keys = Object.keys(RawExtractionSchema.shape);

    // Assert
    expect(keys.sort()).toEqual([...FIELD_KEYS, "sections"].sort());
  });

  it("defaults to an all-null shape when parsing an empty object", () => {
    // Act
    const parsed = RawExtractionSchema.parse({});

    // Assert
    for (const key of FIELD_KEYS) {
      expect(parsed[key]).toEqual({ value: null, confidence: 0 });
    }
    expect(parsed.sections).toEqual({ learningHistory: [], references: [] });
  });
});
