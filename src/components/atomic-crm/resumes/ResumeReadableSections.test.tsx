import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import type { Resume, ShidduchSummary } from "../types";
import { ResumeReadableSections } from "./ResumeReadableSections";
import { parseResumeSections } from "./resumeReadableSections";

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
};

function renderSections({
  canViewReferences = true,
  withLinks = true,
}: {
  canViewReferences?: boolean;
  withLinks?: boolean;
} = {}) {
  const db = generateData();
  db.resumes = [
    {
      id: 9001,
      account_id: 1,
      shidduchim_id: 1,
      files: [],
      sections: parsedSections,
      created_at: "2026-01-01T00:00:00.000Z",
    } satisfies Resume,
  ];
  if (!withLinks) db.reference_links = [];
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });

  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <RecordContextProvider value={record}>
          <ResumeReadableSections
            record={record}
            canViewReferences={canViewReferences}
          />
        </RecordContextProvider>
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
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
    });
  });
});

describe("ResumeReadableSections", () => {
  it("renders ordered cards, direction-aware Hebrew, and the pending/unlinked state", async () => {
    const screen = await renderSections({ withLinks: false });

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

  it("does not render parsed reference content when the viewer is a single", async () => {
    const screen = await renderSections({ canViewReferences: false });

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

  it("uses the canonical call-log path and clears a selected status on retap", async () => {
    const screen = await renderSections();
    const answered = screen.getByRole("button", {
      name: "Answered",
      exact: true,
    });
    await expect.element(answered).toBeInTheDocument();
    const statusGroup = await screen
      .getByRole("group", { name: "Call status for Chaim Feldman" })
      .element();
    const statusButtons = Array.from(statusGroup.querySelectorAll("button"));
    expect(statusButtons.map((button) => button.textContent)).toEqual([
      "Answered",
      "I will call back",
      "They will call back",
      "Did not answer",
    ]);
    expect(statusGroup.className).toContain("grid-cols-3");
    expect(
      statusButtons.every((button) => button.className.includes("min-h-11")),
    ).toBe(true);
    await expect
      .element(
        screen.getByRole("button", { name: "I will call back", exact: true }),
      )
      .toHaveAttribute("aria-pressed", "false");
    await expect
      .element(screen.getByRole("button", { name: "Not started", exact: true }))
      .not.toBeInTheDocument();

    await expect.element(answered).toHaveAttribute("aria-pressed", "true");
    await answered.click();
    await expect.element(answered).toHaveAttribute("aria-pressed", "false");
    await expect
      .element(screen.getByText("No choice selected yet."))
      .toBeInTheDocument();
  });

  it("opens a note editor with an accessible name and saves through log_reference_call", async () => {
    const screen = await renderSections();
    const noteButton = screen.getByRole("button", {
      name: "Open note for Chaim Feldman",
    });
    await noteButton.click();

    const note = screen.getByRole("textbox", {
      name: "What Chaim Feldman said",
    });
    await expect.element(note).toBeInTheDocument();
    await note.fill("Warmly recommends him.");
    await screen.getByRole("button", { name: "Save note" }).click();

    await expect
      .element(screen.getByText("Saved to the call log."))
      .toBeInTheDocument();
    await expect.element(note).not.toBeInTheDocument();
  });
});
