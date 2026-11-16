const HUGE_ARRAY = new Array(100_000).fill(null);
const HUGE_NON_WHITESPACE_STRING = `details${" ".repeat(100_000)}`;

export type ResumeUnreadParityFixture = {
  name: string;
  sections: unknown;
  extracted: unknown;
  expectedUnread: boolean;
};

/**
 * The same raw-shape cases are evaluated by the Worker and browser helpers.
 * Keep the large probes bounded: the helpers should inspect array length and
 * a short string prefix, never recursively walk an untrusted payload.
 */
export const RESUME_UNREAD_PARITY_FIXTURES: readonly ResumeUnreadParityFixture[] =
  [
    {
      name: "NULL sections and extracted",
      sections: null,
      extracted: null,
      expectedUnread: true,
    },
    {
      name: "empty object sections",
      sections: {},
      extracted: {},
      expectedUnread: true,
    },
    {
      name: "array sections",
      sections: [],
      extracted: null,
      expectedUnread: true,
    },
    {
      name: "string sections",
      sections: "resume",
      extracted: null,
      expectedUnread: true,
    },
    {
      name: "number sections",
      sections: 42,
      extracted: null,
      expectedUnread: true,
    },
    {
      name: "whitespace-only extracted value",
      sections: { learningHistory: [], references: [], additionalSections: [] },
      extracted: " \n\t",
      expectedUnread: true,
    },
    {
      name: "whitespace-only section entries",
      sections: {
        learningHistory: [{ label: " ", value: "\n\t" }],
        references: [],
        additionalSections: [],
      },
      extracted: null,
      expectedUnread: false,
    },
    {
      name: "partial section array",
      sections: { learningHistory: [{}] },
      extracted: null,
      expectedUnread: false,
    },
    {
      name: "marker-only sections",
      sections: { schemaVersion: 4 },
      extracted: null,
      expectedUnread: false,
    },
    {
      name: "marker with empty arrays",
      sections: {
        learningHistory: [],
        references: [],
        additionalSections: [],
        schemaVersion: 4,
      },
      extracted: {},
      expectedUnread: false,
    },
    {
      name: "numeric reference name",
      sections: { references: [{ name: 123 }] },
      extracted: null,
      expectedUnread: false,
    },
    {
      name: "invalid additional-section key and title",
      sections: {
        additionalSections: [{ key: "bad key", title: "", items: [] }],
      },
      extracted: null,
      expectedUnread: false,
    },
    {
      name: "contact-bearing additional item",
      sections: {
        additionalSections: [
          {
            key: "work",
            title: "Work",
            items: [{ label: "Phone", value: "054-222-3344" }],
          },
        ],
      },
      extracted: null,
      expectedUnread: false,
    },
    {
      name: "arrays holding junk",
      sections: { references: [null] },
      extracted: null,
      expectedUnread: false,
    },
    {
      name: "huge section array",
      sections: { learningHistory: HUGE_ARRAY },
      extracted: null,
      expectedUnread: false,
    },
    {
      name: "huge extracted string",
      sections: { learningHistory: [], references: [], additionalSections: [] },
      extracted: HUGE_NON_WHITESPACE_STRING,
      expectedUnread: false,
    },
    {
      name: "non-empty extracted object",
      sections: { learningHistory: [], references: [], additionalSections: [] },
      extracted: { fields: { name_en: "David" } },
      expectedUnread: false,
    },
  ];
