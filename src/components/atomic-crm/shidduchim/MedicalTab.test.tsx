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
import type { MedicalNote } from "../types";
import { MedicalTab } from "./MedicalTab";

/**
 * Story 5.5's AD-10 mirror check (the `PhotoTab.test.tsx` / `ResumeTab.test.tsx`
 * pattern): a real FakeRest provider, not a mock, exercising the plain
 * `medical_notes` list + create round trip. Role gating (AC 2, AC 3 in the
 * database, AC 7 for the real descriptor) is covered separately —
 * `entityDescriptor.test.tsx` proves the tab's `visibleTo` wiring, and
 * `entity360/EntityShow.permissions.test.tsx` already proves the framework's
 * generic denial mechanism. This file only proves MedicalTab's own content.
 */

const renderTab = async (shidduchimId: number) => {
  const db = generateData();
  db.medical_notes = [] as MedicalNote[];
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <RecordContextProvider value={{ id: shidduchimId }}>
          <MedicalTab />
        </RecordContextProvider>
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("MedicalTab — empty state (AC 1)", () => {
  it("shows the empty state when no medical note has been added yet", async () => {
    // Act
    const { screen } = await renderTab(1);

    // Assert
    await expect
      .element(screen.getByText("No medical notes yet."))
      .toBeInTheDocument();
  });
});

describe("MedicalTab — add a note (AC 1)", () => {
  it("adds a note scoped to this shidduch and clears the form", async () => {
    // Act
    const { screen, dataProvider } = await renderTab(7);
    await screen
      .getByPlaceholder("Add a medical note…")
      .fill("Allergic to penicillin.");
    await screen.getByRole("button", { name: "Add note" }).click();

    // Assert — the note renders in the list.
    await expect
      .element(screen.getByText("Allergic to penicillin."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByPlaceholder("Add a medical note…"))
      .toHaveValue("");

    // Assert — the row persisted through the real dataProvider, scoped to
    // this shidduch (AC 1's "Fails when ... not filtered by shidduchim_id").
    const { data } = await dataProvider.getList<MedicalNote>("medical_notes", {
      filter: {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(data).toHaveLength(1);
    expect(data[0].shidduchim_id).toBe(7);
    expect(data[0].body).toBe("Allergic to penicillin.");
  });

  it("does not submit an empty or whitespace-only note", async () => {
    // Act
    const { screen, dataProvider } = await renderTab(3);
    await screen.getByPlaceholder("Add a medical note…").fill("   ");

    // Assert — the button stays disabled for whitespace-only input.
    await expect
      .element(screen.getByRole("button", { name: "Add note" }))
      .toBeDisabled();

    const { data } = await dataProvider.getList<MedicalNote>("medical_notes", {
      filter: {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(data).toHaveLength(0);
  });
});

describe("MedicalTab — the note field's accessible name", () => {
  it("names the textarea with a label that survives typing, not a placeholder alone", async () => {
    // Arrange / Act
    const { screen } = await renderTab(1);
    const field = screen.getByLabelText("Add a medical note");

    // Assert
    await expect.element(field).toBeVisible();

    // Act — a placeholder is gone at the first keystroke; a label is not.
    await field.fill("Peanut allergy");

    // Assert
    await expect
      .element(screen.getByLabelText("Add a medical note"))
      .toHaveValue("Peanut allergy");
  });
});

describe("MedicalTab — lists only this shidduch's notes (AC 1)", () => {
  it("does not render a note belonging to a different shidduch", async () => {
    // Arrange
    const db = generateData();
    db.medical_notes = [
      {
        id: 1,
        account_id: 1,
        shidduchim_id: 999,
        body: "Someone else's note.",
        created_at: "2026-01-01T00:00:00Z",
      },
    ] as MedicalNote[];
    const dataProvider = createDataProvider({ db, latency: 0, silent: true });

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <RecordContextProvider value={{ id: 1 }}>
            <MedicalTab />
          </RecordContextProvider>
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert
    await expect
      .element(screen.getByText("No medical notes yet."))
      .toBeInTheDocument();
    expect(screen.container.textContent ?? "").not.toContain(
      "Someone else's note.",
    );
  });
});
