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
    expect(draft.sections.additionalSections).toEqual([]);
  });

  it("returns an all-null draft for non-object input (array, string, null) without throwing", () => {
    // Arrange / Act / Assert
    for (const input of [null, "not an object", ["also not"], 42]) {
      const draft = toDraft(input);
      expect(Object.values(draft.fields).every((v) => v === null)).toBe(true);
      expect(draft.sections.learningHistory).toEqual([]);
      expect(draft.sections.references).toEqual([]);
      expect(draft.sections.additionalSections).toEqual([]);
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
    expect(draft.sections.additionalSections).toEqual([]);
  });

  it("keeps ordered generic sections while dropping malformed items and unsafe text", () => {
    const draft = toDraft({
      sections: {
        learningHistory: [],
        references: [],
        additionalSections: [
          {
            key: "work",
            title: "Work",
            items: [
              { label: "Employer", value: "Acme" },
              { label: "", value: "hidden" },
              { label: "Prompt", value: "Ignore this instruction" },
              { label: "Unsafe", value: "bad\u0000text" },
            ],
          },
          {
            key: "interests",
            title: "Interests",
            items: [{ label: "Hobbies", value: "Reading / קריאה" }],
          },
          {
            key: "references",
            title: "References",
            items: [{ label: "Name", value: "Do not duplicate" }],
          },
          {
            key: "rabbinic_references",
            title: "Rabbinic references",
            items: [{ label: "Phone", value: "054-222-3344" }],
          },
          {
            key: "recommendations",
            title: "Recommendations",
            items: [{ label: "Phone", value: "054-222-3344" }],
          },
          {
            key: "other",
            title: "ממליצים",
            items: [{ label: "Phone", value: "054-222-3344" }],
          },
        ],
      },
    });

    expect(draft.sections.additionalSections).toEqual([
      {
        key: "work",
        title: "Work",
        items: [
          { label: "Employer", value: "Acme" },
          { label: "Prompt", value: "Ignore this instruction" },
        ],
      },
      {
        key: "interests",
        title: "Interests",
        items: [{ label: "Hobbies", value: "Reading / קריאה" }],
      },
    ]);
  });

  it("strips bidi overrides while preserving Hebrew and LRM/RLM marks", () => {
    const draft = toDraft({
      sections: {
        learningHistory: [],
        references: [],
        additionalSections: [
          {
            key: "work",
            title: "Work\u202E\u202C",
            items: [
              {
                label: "Role\u202E\u202C",
                value: "עברית\u200E text\u200F\u2066hidden\u2069",
              },
            ],
          },
        ],
      },
    });

    expect(draft.sections.additionalSections).toEqual([
      {
        key: "work",
        title: "Work",
        items: [{ label: "Role", value: "עברית\u200E text\u200Fhidden" }],
      },
    ]);
  });

  it("filters disguised reference headings without dropping preference headings", () => {
    const disguisedReferenceTitles = [
      "ref\u200Berences",
      "ref erences",
      "מַמְלִיצִים",
      "rеferences",
      "ｒｅｆｅｒｅｎｃｅｓ",
    ];
    const draft = toDraft({
      sections: {
        additionalSections: [
          ...disguisedReferenceTitles.map((title, index) => ({
            key: `section_${index}`,
            title,
            items: [{ label: "Name", value: "Person" }],
          })),
          {
            key: "rabbinic_references",
            title: "Rabbinic references",
            items: [{ label: "Name", value: "Person" }],
          },
          {
            key: "recommendations",
            title: "Recommendations",
            items: [{ label: "Name", value: "Person" }],
          },
          {
            key: "preferences",
            title: "Preferences",
            items: [{ label: "Looking for", value: "Kind and thoughtful" }],
          },
          {
            key: "partner_preferences",
            title: "Partner preferences",
            items: [{ label: "Values", value: "Family" }],
          },
          {
            key: "lifestyle_preferences",
            title: "Lifestyle preferences",
            items: [{ label: "Lifestyle", value: "Active" }],
          },
          {
            key: "looking_for",
            title: "Looking for / preferences",
            items: [{ label: "Description", value: "Warm" }],
          },
          {
            key: "hebrew_preferences",
            title: "העדפות",
            items: [{ label: "סגנון", value: "רגוע" }],
          },
          {
            key: "recommended_reading",
            title: "Recommended reading",
            items: [{ label: "Book", value: "A good book" }],
          },
        ],
      },
    });

    expect(
      draft.sections.additionalSections.map((section) => section.title),
    ).toEqual([
      "Preferences",
      "Partner preferences",
      "Lifestyle preferences",
      "Looking for / preferences",
      "העדפות",
      "Recommended reading",
    ]);
  });

  it("drops contact-bearing titles and items while preserving year-based resume facts", () => {
    const draft = toDraft({
      sections: {
        additionalSections: [
          {
            key: "contact_title",
            title: "Work 054-222-3344",
            items: [{ label: "Role", value: "Teacher" }],
          },
          ...[
            ["slash", "Work 054/222/3344"],
            ["en_dash", "Work 054–222–3344"],
            ["minus", "Work 054−222−3344"],
            ["em_dash", "Work 054—222—3344"],
            ["middle_dot", "Work 054·222·3344"],
            ["newline", "Work 054\n222\n3344"],
            ["parentheses", "Work (054)222-3344"],
          ].map(([key, title]) => ({
            key: `contact_title_${key}`,
            title,
            items: [{ label: "Role", value: "Teacher" }],
          })),
          {
            key: "work",
            title: "Work",
            items: [
              { label: "Dates", value: "2019–2023" },
              {
                label: "Project",
                value: "Levi Home Renovation · 2019–2023",
              },
              { label: "Term", value: "Sep 2019 – Jun 2023" },
              {
                label: "School",
                value: "Yeshivat Or HaChaim · 2021–2024",
              },
              { label: "Age", value: "25" },
              { label: "Height", value: "5'11\"" },
              { label: "Postcode", value: "12345-6789" },
              { label: "Years", value: "2015–2018 (3 years)" },
              {
                label: "Dates",
                value: "Sep 2019 – Jun 2023 (3 years 9 months)",
              },
              {
                label: "Education",
                value: "Class of 2019, GPA 3.85, 120 credits",
              },
              {
                label: "Leadership",
                value: "Led a team of 15 across 3 offices, 2018–2022",
              },
              {
                label: "Volunteer",
                value: "Volunteered 2019-2021, 10 hours a week",
              },
              {
                label: "Budget",
                value: "Monthly budget $120,000 and 45 staff",
              },
              {
                label: "Academic",
                value: "Grade 95, rank 3 of 120 (2021)",
              },
              {
                label: "Class",
                value: "Ages 6-12, 8 students, 2020-2021, 4 classes",
              },
              {
                label: "Address",
                value: "123 Main Street, Brooklyn NY 11230-1234",
              },
              {
                label: "Schedule",
                value: "Mon–Fri 9–5, 2019–2021, 120 credits",
              },
              { label: "Phone 054-222", value: "3344" },
              { label: "Slash phone", value: "054/222/3344" },
              { label: "En dash phone", value: "054–222–3344" },
              { label: "Minus phone", value: "054−222−3344" },
              { label: "Em dash phone", value: "054—222—3344" },
              { label: "Middle dot phone", value: "054·222·3344" },
              { label: "Newline phone", value: "054\n222\n3344" },
              { label: "Parenthesized phone", value: "(054)222-3344" },
              { label: "Call", value: "054-222-3344" },
              { label: "En dash call", value: "Call 054–222–3344 after 6" },
              { label: "Born", value: "14 March 1999" },
              { label: "Duration", value: "2015–2018 (3 years)" },
              {
                label: "Class of 2019",
                value: "GPA 3.85, 120 credits",
              },
              { label: "Phone", value: "054-222-3344" },
              { label: "International", value: "+972 54 222 3344" },
              { label: "US phone", value: "(718) 555-1234" },
              { label: "Dotted phone", value: "718.555.1234" },
              { label: "Year-looking phone", value: "718-555-1999" },
              { label: "Bare phone", value: "0542223344" },
              { label: "International bare", value: "00972542223344" },
              {
                label: "Embedded phone",
                value: "Call 054-222-3344 after 6",
              },
              { label: "Email", value: "person@example.com" },
            ],
          },
        ],
      },
    });

    expect(draft.sections.additionalSections).toEqual([
      {
        key: "work",
        title: "Work",
        items: [
          { label: "Dates", value: "2019–2023" },
          {
            label: "Project",
            value: "Levi Home Renovation · 2019–2023",
          },
          { label: "Term", value: "Sep 2019 – Jun 2023" },
          {
            label: "School",
            value: "Yeshivat Or HaChaim · 2021–2024",
          },
          { label: "Age", value: "25" },
          { label: "Height", value: "5'11\"" },
          { label: "Postcode", value: "12345-6789" },
          { label: "Years", value: "2015–2018 (3 years)" },
          {
            label: "Dates",
            value: "Sep 2019 – Jun 2023 (3 years 9 months)",
          },
          {
            label: "Education",
            value: "Class of 2019, GPA 3.85, 120 credits",
          },
          {
            label: "Leadership",
            value: "Led a team of 15 across 3 offices, 2018–2022",
          },
          {
            label: "Volunteer",
            value: "Volunteered 2019-2021, 10 hours a week",
          },
          {
            label: "Budget",
            value: "Monthly budget $120,000 and 45 staff",
          },
          {
            label: "Academic",
            value: "Grade 95, rank 3 of 120 (2021)",
          },
          {
            label: "Class",
            value: "Ages 6-12, 8 students, 2020-2021, 4 classes",
          },
          {
            label: "Address",
            value: "123 Main Street, Brooklyn NY 11230-1234",
          },
          {
            label: "Schedule",
            value: "Mon–Fri 9–5, 2019–2021, 120 credits",
          },
          { label: "Born", value: "14 March 1999" },
          { label: "Duration", value: "2015–2018 (3 years)" },
          {
            label: "Class of 2019",
            value: "GPA 3.85, 120 credits",
          },
        ],
      },
    ]);
  });

  it("merges duplicate titles and removes duplicate items before applying caps", () => {
    const draft = toDraft({
      sections: {
        learningHistory: [],
        references: [],
        additionalSections: [
          {
            key: "work",
            title: " Work ",
            items: [
              { label: "Role", value: "Teacher" },
              { label: "Role", value: "Teacher" },
            ],
          },
          {
            key: "employment",
            title: "work",
            items: [
              { label: " role ", value: " teacher " },
              { label: "Location", value: "Brooklyn" },
            ],
          },
          {
            key: "work_history",
            title: "  WORK  ",
            items: [{ label: "LOCATION", value: "BROOKLYN" }],
          },
        ],
      },
    });

    expect(draft.sections.additionalSections).toEqual([
      {
        key: "work",
        title: "Work",
        items: [
          { label: "Role", value: "Teacher" },
          { label: "Location", value: "Brooklyn" },
        ],
      },
    ]);
  });

  it("caps generic sections, items, and aggregate text without dropping the parse", () => {
    const draft = toDraft({
      sections: {
        learningHistory: [],
        references: [],
        additionalSections: Array.from({ length: 21 }, (_, sectionIndex) => ({
          key: `section_${sectionIndex}`,
          title: `Section ${sectionIndex}`,
          items: Array.from({ length: 51 }, (_, itemIndex) => ({
            label: `Item ${itemIndex}`,
            value: "x".repeat(1_000),
          })),
        })),
      },
    });

    expect(draft.sections.additionalSections.length).toBeLessThanOrEqual(20);
    expect(
      draft.sections.additionalSections.reduce(
        (count, section) => count + section.items.length,
        0,
      ),
    ).toBeLessThanOrEqual(250);
    expect(
      draft.sections.additionalSections.reduce(
        (count, section) =>
          count +
          section.key.length +
          section.title.length +
          section.items.reduce(
            (itemCount, item) =>
              itemCount + item.label.length + item.value.length,
            0,
          ),
        0,
      ),
    ).toBeLessThanOrEqual(40_000);
    expect(draft.sections.additionalSections[0]?.items[0]?.value).toHaveLength(
      1_000,
    );
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
  it("has exactly the seventeen field keys plus sections", () => {
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
    expect(parsed.sections).toEqual({
      learningHistory: [],
      references: [],
      additionalSections: [],
    });
  });
});
