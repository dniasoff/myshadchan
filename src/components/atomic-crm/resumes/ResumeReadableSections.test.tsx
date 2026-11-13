import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import {
  CoreAdminContext,
  RecordContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import type { ReferenceLinkSummary, Resume, ShidduchSummary } from "../types";
import { ResumeReadableSections } from "./ResumeReadableSections";
import {
  linkMatchesResumeReference,
  matchResumeReferenceLinks,
  normalizeResumeReferenceName,
  normalizeResumeReferencePhone,
  parseResumeSections,
  type ParsedAdditionalSection,
} from "./resumeReadableSections";

const record = {
  id: 1,
  account_id: 1,
  single_id: 1,
  name_en: "David Levi",
  name_he: null,
  father_en: "Yosef Levi",
  father_he: null,
  mother_en: null,
  mother_he: null,
  seminary_en: "Yeshivat Or HaChaim",
  seminary_he: null,
  shul_en: null,
  shul_he: "בית הכנסת שערי תפילה",
  location_en: "Brooklyn, NY",
  location_he: null,
  age: 24,
  height: "5'11\"",
  marital_status: "Never married",
  kohen_status: "no",
} as unknown as ShidduchSummary;

const parsedSections = {
  learningHistory: [
    { label: "Yeshiva", value: "Torah learning at Yeshivat Or HaChaim" },
    { label: "Learning program", value: "Advanced halacha study" },
  ],
  references: [
    {
      name: "Chaim Feldman",
      relationship: "Rebbi",
      phone: "054-222-3344",
    },
    { name: "Miriam Gold", relationship: "Neighbor", phone: "" },
  ],
  additionalSections: [] as ParsedAdditionalSection[],
};

function renderSections({
  canViewReferences = true,
  withLinks = true,
  sections = parsedSections,
  fixtureRecord = record,
  addManualLink = false,
  hebrewChaim = false,
  latency = 0,
}: {
  canViewReferences?: boolean;
  withLinks?: boolean;
  sections?: Omit<typeof parsedSections, "additionalSections"> &
    Partial<Pick<typeof parsedSections, "additionalSections">>;
  fixtureRecord?: ShidduchSummary;
  addManualLink?: boolean;
  hebrewChaim?: boolean;
  latency?: number;
} = {}) {
  const db = generateData();
  if (hebrewChaim) {
    const chaim = db.references.find((reference) => reference.id === 1);
    if (chaim) chaim.name_he = "חיים פלדמן";
  }
  db.resumes = [
    {
      id: 9001,
      account_id: 1,
      shidduchim_id: 1,
      files: [],
      sections,
      created_at: "2026-01-01T00:00:00.000Z",
    } satisfies Resume,
  ];
  if (!withLinks) db.reference_links = [];
  if (addManualLink) {
    db.references.push({
      id: 9901,
      account_id: 1,
      name_en: "Manual Diligence reference",
      name_he: null,
      relationship: "Neighbor",
      phone: "555-888-9999",
      school: null,
      grad_year: null,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    db.reference_links.push({
      id: 9901,
      account_id: 1,
      reference_id: 9901,
      shidduchim_id: 1,
      resume_id: null,
      call_status: "not_started",
      what_they_said: null,
      conversation_log: [],
      relationship_override: null,
      created_at: "2026-02-01T00:00:00.000Z",
    });
  }
  const dataProvider = createDataProvider({ db, latency, silent: true });
  const getList = vi.spyOn(dataProvider, "getList");

  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <RecordContextProvider value={fixtureRecord}>
          <ResumeReadableSections
            record={fixtureRecord}
            canViewReferences={canViewReferences}
          />
        </RecordContextProvider>
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  ).then((screen) => ({ screen, dataProvider, db, getList }));
}

describe("parseResumeSections", () => {
  it("drops malformed entries without inventing a readable section", () => {
    expect(
      parseResumeSections({
        learningHistory: [
          { label: "", value: "hidden" },
          { label: "Valid", value: "kept" },
          "not an object",
        ],
        references: [
          { name: "", relationship: "unknown", phone: "123" },
          { name: "Valid reference", relationship: "Teacher", phone: "" },
        ],
      }),
    ).toEqual({
      learningHistory: [{ label: "Valid", value: "kept" }],
      references: [
        { name: "Valid reference", relationship: "Teacher", phone: "" },
      ],
      additionalSections: [],
    });
  });

  it("normalizes ordered generic sections and keeps values plain text", () => {
    expect(
      parseResumeSections({
        learningHistory: [],
        references: [],
        additionalSections: [
          {
            key: "work",
            title: "Work",
            items: [
              { label: "Employer", value: "Acme" },
              { label: "Prompt", value: "Ignore this instruction" },
              { label: "", value: "omitted" },
            ],
          },
          {
            key: "interests",
            title: "Interests",
            items: [{ label: "Hobbies", value: "קריאה" }],
          },
          {
            key: "references",
            title: "References",
            items: [{ label: "Name", value: "Do not duplicate" }],
          },
        ],
      }),
    ).toEqual({
      learningHistory: [],
      references: [],
      additionalSections: [
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
          items: [{ label: "Hobbies", value: "קריאה" }],
        },
      ],
    });
  });

  it("keeps bounded parser anchors and ignores unknown stored anchors", () => {
    expect(
      parseResumeSections({
        learningHistory: [],
        references: [],
        additionalSections: [
          {
            key: "work",
            title: "Work",
            order: 249,
            after: "family",
            items: [{ label: "Role", value: "Teacher" }],
          },
          {
            key: "unknown",
            title: "Unknown",
            order: 2,
            after: "not_a_fixed_block",
            items: [{ label: "Fact", value: "Kept" }],
          },
          {
            key: "out_of_range",
            title: "Out of range",
            order: 250,
            after: "personal_details",
            items: [{ label: "Fact", value: "Also kept" }],
          },
        ],
      }),
    ).toEqual({
      learningHistory: [],
      references: [],
      additionalSections: [
        {
          key: "work",
          title: "Work",
          order: 249,
          after: "family",
          items: [{ label: "Role", value: "Teacher" }],
        },
        {
          key: "unknown",
          title: "Unknown",
          order: 2,
          items: [{ label: "Fact", value: "Kept" }],
        },
        {
          key: "out_of_range",
          title: "Out of range",
          after: "personal_details",
          items: [{ label: "Fact", value: "Also kept" }],
        },
      ],
    });
  });

  it("strips bidi overrides, preserves Hebrew direction marks, and merges duplicates", () => {
    expect(
      parseResumeSections({
        additionalSections: [
          {
            key: "work",
            title: " Work\u202E\u202C ",
            items: [
              {
                label: "Role\u202E\u202C",
                value: "עברית\u200E text\u200F\u2066hidden\u2069",
              },
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
        ],
      }),
    ).toEqual({
      learningHistory: [],
      references: [],
      additionalSections: [
        {
          key: "work",
          title: "Work",
          items: [
            { label: "Role", value: "עברית\u200E text\u200Fhidden" },
            { label: "Role", value: "Teacher" },
            { label: "Location", value: "Brooklyn" },
          ],
        },
      ],
    });
  });

  it("hides reference-like extras for viewers without reference access", () => {
    expect(
      parseResumeSections(
        {
          additionalSections: [
            {
              key: "rabbinic_references",
              title: "Rabbinic references",
              items: [{ label: "Phone", value: "054-222-3344" }],
            },
            {
              key: "other",
              title: "ממליצים",
              items: [{ label: "Phone", value: "054-222-3344" }],
            },
            {
              key: "work",
              title: "Work",
              items: [{ label: "Role", value: "Teacher" }],
            },
          ],
        },
        false,
      ).additionalSections,
    ).toEqual([
      {
        key: "work",
        title: "Work",
        items: [{ label: "Role", value: "Teacher" }],
      },
    ]);
  });
});

describe("resume reference matching", () => {
  const link = (overrides: Partial<ReferenceLinkSummary> = {}) =>
    ({
      id: 1,
      account_id: 1,
      reference_id: 1,
      shidduchim_id: 1,
      resume_id: null,
      call_status: "answered",
      what_they_said: null,
      conversation_log: [],
      relationship_override: null,
      created_at: "2026-01-01T00:00:00.000Z",
      effective_relationship: "Rebbi",
      conversation_log_count: 0,
      reference_name_en: "Chaim Cohen",
      reference_name_he: null,
      reference_phone: "054-222-3344",
      ...overrides,
    }) as ReferenceLinkSummary;

  it.each([
    ["054-222-3344", "542223344"],
    ["+972-54-222-3344", "542223344"],
    ["00972542223344", "542223344"],
    ["1-718-555-1234", "7185551234"],
    ["+44 20 7946 0958", "2079460958"],
    ["054-12", null],
  ])("ports SQL normalize_phone for %s", (input, expected) => {
    expect(normalizeResumeReferencePhone(input)).toBe(expected);
  });

  it("uses either canonical name column and rejects non-empty invalid phones", () => {
    expect(normalizeResumeReferenceName("Cohen, Chaim!")).toBe("cohen chaim");
    expect(
      linkMatchesResumeReference(link(), {
        name: "Chaim Cohen",
        relationship: "Rebbi",
        phone: "+972-54-222-3344",
      }),
    ).toBe(true);
    expect(
      linkMatchesResumeReference(
        link({
          reference_name_en: "Unrelated English name",
          reference_name_he: "חיים כהן",
        }),
        { name: "חיים כהן", relationship: "Rebbi", phone: "" },
      ),
    ).toBe(true);
    expect(
      linkMatchesResumeReference(link(), {
        name: "Chaim Cohen",
        relationship: "Rebbi",
        phone: "not a phone",
      }),
    ).toBe(false);
  });

  it("does not bind a phoneless name to the first of two candidate links", () => {
    const matches = matchResumeReferenceLinks(
      [{ name: "Chaim Cohen", relationship: "Rebbi", phone: "" }],
      [link(), link({ id: 2, reference_id: 2 })],
    );
    expect(matches).toEqual([null]);
  });
});

describe("ResumeReadableSections", () => {
  it("renders ordered cards, direction-aware Hebrew, and the pending/unlinked state", async () => {
    const { screen } = await renderSections({ withLinks: false });

    await expect
      .element(screen.getByRole("heading", { name: "Easy-to-read resume" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Personal details"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("Family")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Learning and community"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Learning history"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("heading", { name: "References" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("References are being prepared."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("No phone number saved"))
      .toBeInTheDocument();
    await expect
      .element(
        screen
          .getByText(
            "This reference is not linked yet; call details will appear when it is matched.",
          )
          .first(),
      )
      .toBeInTheDocument();

    const hebrew = screen.getByText("בית הכנסת שערי תפילה");
    await expect.element(hebrew).toHaveAttribute("dir", "auto");
    expect(
      (
        await screen
          .getByRole("heading", { name: "Personal details" })
          .element()
      ).textContent,
    ).toBe("Personal details");
  });

  it("renders generic cards in order and preserves unique Family extras", async () => {
    const { screen } = await renderSections({
      sections: {
        learningHistory: [],
        references: parsedSections.references,
        additionalSections: [
          {
            key: "work",
            title: "Work",
            items: [{ label: "Role", value: "Teacher" }],
          },
          {
            key: "interests",
            title: "Interests",
            items: [{ label: "Hobby", value: "קריאה" }],
          },
          {
            key: "volunteer",
            title: "Volunteer",
            items: [{ label: "Role", value: "Mentor" }],
          },
          {
            key: "family",
            title: "Family",
            items: [
              { label: "Father", value: "Yosef Levi" },
              { label: "Sibling", value: "Sister" },
            ],
          },
          {
            key: "learning_history",
            title: "Learning history",
            items: [{ label: "Duplicate", value: "Do not render" }],
          },
          {
            key: "references",
            title: "References",
            items: [{ label: "Name", value: "Do not duplicate" }],
          },
        ],
      },
    });

    await expect.element(screen.getByText("Work")).toBeInTheDocument();
    await expect.element(screen.getByText("Interests")).toBeInTheDocument();
    await expect.element(screen.getByText("Volunteer")).toBeInTheDocument();
    await expect.element(screen.getByText("Sister")).toBeInTheDocument();
    expect(
      (screen.container.textContent?.match(/Yosef Levi/gu) ?? []).length,
    ).toBe(1);
    await expect.element(screen.getByText("Teacher")).toBeInTheDocument();
    await expect
      .element(screen.getByText("קריאה"))
      .toHaveAttribute("dir", "auto");
    await expect
      .element(screen.getByRole("heading", { name: "Work" }))
      .toHaveAttribute("dir", "auto");
    await expect
      .element(screen.getByText("Role").first())
      .toHaveAttribute("dir", "auto");
    await expect
      .element(screen.getByText("Do not duplicate"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("heading", { name: "References" }))
      .toBeInTheDocument();
    const headings = Array.from(
      screen.container.querySelectorAll("h3"),
      (heading) => heading.textContent?.trim(),
    );
    expect(headings.indexOf("Work")).toBeLessThan(
      headings.indexOf("Interests"),
    );
    expect(headings.indexOf("Interests")).toBeLessThan(
      headings.indexOf("Volunteer"),
    );
  });

  it("interleaves anchored extras with fixed groups and keeps unanchored extras last", async () => {
    const { screen } = await renderSections({
      sections: {
        learningHistory: [{ label: "Study", value: "Halacha" }],
        references: [],
        additionalSections: [
          {
            key: "hobbies",
            title: "Hobbies",
            order: 0,
            after: "personal_details",
            items: [{ label: "Interest", value: "Reading" }],
          },
          {
            key: "family_extra",
            title: "Family notes",
            order: 1,
            after: "family",
            items: [{ label: "Note", value: "Close-knit" }],
          },
          {
            key: "volunteer",
            title: "Volunteer",
            order: 2,
            after: "learning_and_community",
            items: [{ label: "Role", value: "Mentor" }],
          },
          {
            key: "other",
            title: "Other",
            order: 3,
            items: [{ label: "Fact", value: "Unanchored" }],
          },
          {
            key: "learning_extra",
            title: "Learning detail",
            order: 4,
            after: "learning_history",
            items: [{ label: "Topic", value: "Mussar" }],
          },
        ],
      },
    });

    await expect
      .element(screen.getByText("Personal details"))
      .toBeInTheDocument();
    const headings = Array.from(
      screen.container.querySelectorAll("h3"),
      (heading) => heading.textContent?.trim(),
    );
    expect(headings).toEqual([
      "Personal details",
      "Hobbies",
      "Family",
      "Family notes",
      "Learning and community",
      "Volunteer",
      "Learning history",
      "Learning detail",
      "Other",
    ]);
  });

  it("does not render parsed reference content when the viewer is a single", async () => {
    const { screen } = await renderSections({ canViewReferences: false });

    await expect
      .element(screen.getByText("Easy-to-read resume"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Personal details"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("References"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Chaim Feldman"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Answered")).not.toBeInTheDocument();
  });

  it("hides reference-like generic cards and phone numbers from a single", async () => {
    const { screen } = await renderSections({
      canViewReferences: false,
      sections: {
        learningHistory: [],
        references: [],
        additionalSections: [
          {
            key: "rabbinic_references",
            title: "Rabbinic references",
            items: [{ label: "Phone", value: "054-222-3344" }],
          },
          {
            key: "other",
            title: "ממליצים",
            items: [{ label: "Phone", value: "054-333-4455" }],
          },
          {
            key: "other_disguised",
            title: "rеferences",
            items: [{ label: "Name", value: "Rabbi Cohen" }],
          },
          {
            key: "preferences",
            title: "Preferences",
            items: [{ label: "Values", value: "Kind" }],
          },
          {
            key: "work",
            title: "Work",
            items: [{ label: "Role", value: "Teacher" }],
          },
        ],
      },
    });

    await expect.element(screen.getByText("Work")).toBeInTheDocument();
    await expect.element(screen.getByText("Preferences")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Rabbinic references"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("ממליצים")).not.toBeInTheDocument();
    await expect
      .element(screen.getByText("rеferences"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("054-222-3344"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("054-333-4455"))
      .not.toBeInTheDocument();
  });

  it("filters contact-shaped stored extras while keeping ordinary years", async () => {
    const { screen } = await renderSections({
      canViewReferences: false,
      sections: {
        learningHistory: [],
        references: [],
        additionalSections: [
          {
            key: "work",
            title: "Work",
            items: [
              { label: "Dates", value: "2019–2023" },
              {
                label: "Term dates",
                value: "Sep 2019 – Jun 2023 (3 years 9 months)",
              },
              { label: "Born", value: "14 March 1999" },
              { label: "Duration", value: "2015–2018 (3 years)" },
              {
                label: "Class of 2019",
                value: "GPA 3.85, 120 credits",
              },
              {
                label: "Project",
                value: "Levi Home Renovation · 2019–2023",
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
              { label: "Ages", value: "Ages 6-12 (2020-2021)" },
              { label: "Employees", value: "Employees: 15 (2018-2022)" },
              { label: "Team", value: "Team of 12 (2018–2022)" },
              { label: "Phone 054-222", value: "3344" },
              { label: "Slash phone", value: "054/222/3344" },
              { label: "En dash phone", value: "054–222–3344" },
              { label: "Minus phone", value: "054−222−3344" },
              { label: "Em dash phone", value: "054—222—3344" },
              { label: "Middle dot phone", value: "054·222·3344" },
              { label: "Newline phone", value: "054\n222\n3344" },
              { label: "Parenthesized phone", value: "(054)222-3344" },
              { label: "Phone", value: "054-222-3344" },
              { label: "Call", value: "054-222-3344" },
              { label: "En dash call", value: "Call 054–222–3344 after 6" },
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
        ],
      },
    });

    await expect.element(screen.getByText("Work")).toBeInTheDocument();
    await expect
      .element(screen.getByText("2019–2023").first())
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("2015–2018 (3 years)"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Sep 2019 – Jun 2023 (3 years 9 months)"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("14 March 1999")).toBeInTheDocument();
    await expect
      .element(screen.getByText("GPA 3.85, 120 credits"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Levi Home Renovation · 2019–2023"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Led a team of 15 across 3 offices, 2018–2022"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Volunteered 2019-2021, 10 hours a week"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Monthly budget $120,000 and 45 staff"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Grade 95, rank 3 of 120 (2021)"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Ages 6-12, 8 students, 2020-2021, 4 classes"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("123 Main Street, Brooklyn NY 11230-1234"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Mon–Fri 9–5, 2019–2021, 120 credits"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Ages 6-12 (2020-2021)"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Employees: 15 (2018-2022)"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Team of 12 (2018–2022)"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("3344")).not.toBeInTheDocument();
    await expect
      .element(screen.getByText("054-222-3344"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("+972 54 222 3344"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("(718) 555-1234"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("718.555.1234"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("0542223344"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("00972542223344"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Call 054-222-3344 after 6"))
      .not.toBeInTheDocument();
    for (const value of [
      "054/222/3344",
      "054–222–3344",
      "054−222−3344",
      "054—222—3344",
      "054·222·3344",
      "054\n222\n3344",
      "(054)222-3344",
      "Call 054–222–3344 after 6",
      "718-555-1999",
    ]) {
      await expect.element(screen.getByText(value)).not.toBeInTheDocument();
    }
    for (const title of [
      "Work 054/222/3344",
      "Work 054–222–3344",
      "Work 054−222−3344",
      "Work 054—222—3344",
      "Work 054·222·3344",
      "Work 054\n222\n3344",
      "Work (054)222-3344",
    ]) {
      await expect.element(screen.getByText(title)).not.toBeInTheDocument();
    }
    await expect
      .element(screen.getByText("person@example.com"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Work 054-222-3344"))
      .not.toBeInTheDocument();
  });

  it("keeps extras-only resumes out of the empty state and omits empty entries", async () => {
    const { screen } = await renderSections({
      canViewReferences: false,
      fixtureRecord: { id: 1 } as ShidduchSummary,
      sections: {
        learningHistory: [],
        references: [],
        additionalSections: [
          { key: "empty", title: "No items", items: [] },
          {
            key: "empty_value",
            title: "Empty value",
            items: [{ label: "Label", value: "" }],
          },
          {
            key: "empty_title",
            title: "",
            items: [{ label: "Label", value: "Hidden" }],
          },
          {
            key: "work",
            title: "Work",
            items: [{ label: "Role", value: "Teacher" }],
          },
        ],
      },
    });

    await expect.element(screen.getByText("Work")).toBeInTheDocument();
    await expect.element(screen.getByText("Teacher")).toBeInTheDocument();
    await expect
      .element(screen.getByText("No sections were found in this resume."))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("No items")).not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Empty value"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Hidden")).not.toBeInTheDocument();
  });

  it("renders hostile markup as literal text without creating HTML nodes", async () => {
    const title = "Literal <script>alert(1)</script>";
    const value = "<img src=x onerror=alert(1)>";
    const { screen } = await renderSections({
      canViewReferences: false,
      fixtureRecord: { id: 1 } as ShidduchSummary,
      sections: {
        learningHistory: [],
        references: [],
        additionalSections: [
          { key: "about", title, items: [{ label: "Bio", value }] },
        ],
      },
    });

    await expect.element(screen.getByText(title)).toBeInTheDocument();
    await expect.element(screen.getByText(value)).toBeInTheDocument();
    expect(screen.container.querySelector("script, img")).toBeNull();
  });

  it("applies the twenty-section UI cap after normalization", async () => {
    const sections = Array.from({ length: 21 }, (_, index) => ({
      key: `section_${index}`,
      title: `Section ${index}`,
      items: [{ label: "Value", value: `Item ${index}` }],
    }));
    const { screen } = await renderSections({
      canViewReferences: false,
      fixtureRecord: { id: 1 } as ShidduchSummary,
      sections: {
        learningHistory: [],
        references: [],
        additionalSections: sections,
      },
    });

    await expect.element(screen.getByText("Section 19")).toBeInTheDocument();
    expect(screen.container.querySelectorAll("h3")).toHaveLength(20);
    await expect
      .element(screen.getByText("Section 20"))
      .not.toBeInTheDocument();
  });

  it("removes stale duplicate learning rows when the resume changes", async () => {
    const initialRecord = { id: 1 } as ShidduchSummary;
    const nextRecord = { id: 2 } as ShidduchSummary;
    const { screen, db } = await renderSections({
      canViewReferences: false,
      fixtureRecord: initialRecord,
      sections: {
        learningHistory: [
          { label: "Or HaChaim", value: "Or HaChaim" },
          { label: "Or HaChaim", value: "Or HaChaim" },
          { label: "Halacha", value: "Halacha" },
        ],
        references: [],
        additionalSections: [],
      },
    });
    db.resumes.push({
      id: 9002,
      account_id: 1,
      shidduchim_id: 2,
      files: [],
      sections: {
        learningHistory: [{ label: "Halacha", value: "Halacha" }],
        references: [],
      },
      created_at: "2026-01-02T00:00:00.000Z",
    } satisfies Resume);

    await screen.rerender(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={createDataProvider({ db, latency: 0, silent: true })}
          i18nProvider={testI18nProvider}
        >
          <RecordContextProvider value={nextRecord}>
            <ResumeReadableSections
              record={nextRecord}
              canViewReferences={false}
            />
          </RecordContextProvider>
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await expect
      .element(screen.getByText("Halacha").first())
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Or HaChaim"))
      .not.toBeInTheDocument();
    expect(screen.container.querySelectorAll("strong")).toHaveLength(1);
  });

  it("uses the canonical call-log path and clears a selected status on retap", async () => {
    const { screen, dataProvider, db, getList } = await renderSections();
    const logReferenceCall = vi.spyOn(dataProvider, "logReferenceCall");
    const chaimLink = db.reference_links.find(
      (candidate) =>
        candidate.reference_id === 1 && candidate.shidduchim_id === 1,
    );
    expect(chaimLink).toBeDefined();
    const statusGroupLocator = screen.getByRole("group", {
      name: /Call status for (Chaim Feldman|חיים פלדמן)/,
    });
    await expect.element(statusGroupLocator).toBeInTheDocument();
    const statusGroup = await statusGroupLocator.element();
    const answered = statusGroupLocator.getByRole("button", {
      name: "Answered",
      exact: true,
    });
    await expect.element(answered).toBeInTheDocument();
    const statusButtons = Array.from(statusGroup.querySelectorAll("button"));
    expect(statusButtons.map((button) => button.textContent)).toEqual([
      "Answered",
      "I will call back",
      "They will call back",
      "Did not answer",
    ]);
    expect(statusGroup.className).toContain("grid-cols-3");
    expect(
      statusButtons.every(
        (button) =>
          button.className.includes("h-12") &&
          button.className.includes("sm:h-11"),
      ),
    ).toBe(true);
    await expect
      .element(
        statusGroupLocator.getByRole("button", {
          name: "I will call back",
          exact: true,
        }),
      )
      .toHaveAttribute("aria-pressed", "false");
    await expect
      .element(screen.getByRole("button", { name: "Not started", exact: true }))
      .not.toBeInTheDocument();

    await expect.element(answered).toHaveAttribute("aria-pressed", "true");
    const referenceLinkReadsBeforeSave = getList.mock.calls.filter(
      ([resource]) => resource === "reference_links",
    ).length;
    await answered.click();
    await expect.element(answered).toHaveAttribute("aria-pressed", "false");
    expect(logReferenceCall).toHaveBeenLastCalledWith({
      reference_link_id: chaimLink?.id,
      call_status: "not_started",
      source: "manual",
    });
    await expect
      .poll(
        () =>
          getList.mock.calls.filter(
            ([resource]) => resource === "reference_links",
          ).length,
      )
      .toBeGreaterThan(referenceLinkReadsBeforeSave);
    await expect
      .element(screen.getByText("No choice selected yet."))
      .toBeInTheDocument();
  });

  it("opens a note editor with an accessible name and saves through log_reference_call", async () => {
    const { screen, dataProvider, db, getList } = await renderSections();
    const logReferenceCall = vi.spyOn(dataProvider, "logReferenceCall");
    const chaimLink = db.reference_links.find(
      (candidate) =>
        candidate.reference_id === 1 && candidate.shidduchim_id === 1,
    );
    expect(chaimLink).toBeDefined();
    const noteButton = screen.getByRole("button", {
      name: /Open note for Chaim Feldman; note saved/i,
    });
    await noteButton.click();

    const note = screen.getByRole("textbox", {
      name: "What Chaim Feldman said",
    });
    await expect.element(note).toBeInTheDocument();
    await note.fill("Warmly recommends him.");
    await screen.getByRole("button", { name: "Save note" }).click();

    expect(logReferenceCall).toHaveBeenLastCalledWith({
      reference_link_id: chaimLink?.id,
      what_they_said: "Warmly recommends him.",
      source: "manual",
    });
    await expect
      .poll(
        () =>
          getList.mock.calls.filter(
            ([resource]) => resource === "reference_links",
          ).length,
      )
      .toBeGreaterThan(1);
    await expect
      .element(screen.getByText("Saved to the call log."))
      .toBeInTheDocument();
    await expect.element(note).not.toBeInTheDocument();
  });

  it("uses linked rows as the source of truth and renders extra Diligence links", async () => {
    const { screen, getList } = await renderSections({
      addManualLink: true,
      hebrewChaim: true,
      sections: {
        learningHistory: [],
        references: [
          {
            name: "חיים פלדמן",
            relationship: "רבי",
            phone: "+972-54-222-3344",
          },
        ],
      },
    });

    await expect
      .element(screen.getByText("Manual Diligence reference"))
      .toBeInTheDocument();
    const linkQuery = getList.mock.calls.find(
      ([resource]) => resource === "reference_links",
    );
    expect(linkQuery?.[1]).toMatchObject({
      pagination: { page: 1, perPage: 50 },
    });
    await expect
      .element(
        screen
          .getByRole("group")
          .first()
          .getByRole("button", { name: "Answered", exact: true }),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("References are being prepared."))
      .not.toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          "This reference is not linked yet; call details will appear when it is matched.",
        ),
      )
      .not.toBeInTheDocument();
  });

  it("shows a neutral skeleton while links are loading", async () => {
    const { screen } = await renderSections({ latency: 100 });
    await expect
      .element(screen.getByRole("status", { name: "Loading references" }))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          "This reference is not linked yet; call details will appear when it is matched.",
        ),
      )
      .not.toBeInTheDocument();
  });

  it("keeps all status controls exactly the same height at every approved width", async () => {
    const { screen } = await renderSections();
    const widths = [320, 375, 430, 1280];
    for (const width of widths) {
      await page.viewport(width, 720);
      const group = await screen
        .getByRole("group", { name: "Call status for Chaim Feldman" })
        .element();
      const heights = Array.from(group.querySelectorAll("button")).map(
        (button) => button.getBoundingClientRect().height,
      );
      expect(new Set(heights).size, `width ${width}`).toBe(1);
    }
    await page.viewport(1280, 720);
  });

  it("pins the note marker, empty-field omission, clear prevention, and status rollback", async () => {
    const { screen, dataProvider } = await renderSections();
    const noteButton = screen.getByRole("button", {
      name: /Open note for Chaim Feldman; note saved/i,
    });
    await expect.element(noteButton).toBeInTheDocument();
    await noteButton.click();
    const note = screen.getByRole("textbox", {
      name: "What Chaim Feldman said",
    });
    await note.fill("");
    await expect
      .element(screen.getByRole("button", { name: "Save note" }))
      .toBeDisabled();
    await expect
      .element(screen.getByText("Write a note to save it."))
      .toBeInTheDocument();

    const logReferenceCall = vi
      .spyOn(dataProvider, "logReferenceCall")
      .mockRejectedValueOnce(new Error("status failed"));
    await screen.getByRole("button", { name: "Close" }).click();
    await expect.element(noteButton).toHaveFocus();
    const callBack = screen
      .getByRole("group", { name: "Call status for Chaim Feldman" })
      .getByRole("button", { name: "I will call back", exact: true });
    await callBack.click();
    await expect.element(callBack).toHaveAttribute("aria-pressed", "false");
    expect(logReferenceCall).toHaveBeenCalledWith(
      expect.objectContaining({
        call_status: "call_back",
        source: "manual",
      }),
    );
    await expect
      .element(
        screen.getByText(
          "We could not save this. Nothing was changed. Try again.",
        ),
      )
      .toBeInTheDocument();
  });

  it("keeps an unsaved note draft when the sheet is dismissed", async () => {
    const { screen } = await renderSections();
    const noteButton = screen.getByRole("button", {
      name: /Open note for Chaim Feldman; note saved/i,
    });
    await noteButton.click();
    const note = screen.getByRole("textbox", {
      name: "What Chaim Feldman said",
    });
    await note.fill("Keep this draft");
    await screen.getByRole("button", { name: "Close" }).click();
    await noteButton.click();
    await expect.element(note).toHaveValue("Keep this draft");
  });

  it("keeps the empty state wording and omits empty detail groups", async () => {
    const { screen } = await renderSections({
      fixtureRecord: { id: 1 } as ShidduchSummary,
      sections: { learningHistory: [], references: [] },
    });
    await expect
      .element(screen.getByText("No sections were found in this resume."))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          "You can still read or download the original file above.",
        ),
      )
      .toBeInTheDocument();
    await expect.element(screen.getByText("Family")).not.toBeInTheDocument();
  });
});
