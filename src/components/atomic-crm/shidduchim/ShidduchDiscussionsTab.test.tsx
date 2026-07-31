import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import { ShidduchDiscussionsTab } from "./ShidduchDiscussionsTab";

/**
 * Story 7.1 — the shidduch descriptor's `discussions` tab entry point.
 * `render` is arity-zero and reaches the shidduch via `useRecordContext()`
 * (contract §2 rule 4), exactly like `ExternalLinksTab`/`MedicalTab`: these
 * tests pin that it renders nothing without a record, and that it wires
 * `ThreadList` to `subject_type: 'shidduch'` and THIS record's own id — a
 * wrong-but-still-valid `subjectId` (e.g. a stray literal) would previously
 * leave `make typecheck` green.
 */

const renderTab = async (shidduchimId?: number) => {
  const db = generateData();
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <RecordContextProvider
          value={shidduchimId != null ? { id: shidduchimId } : undefined}
        >
          <ShidduchDiscussionsTab />
        </RecordContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, db, dataProvider };
};

describe("ShidduchDiscussionsTab", () => {
  it("renders nothing when no record is in context", async () => {
    // Act
    const { screen } = await renderTab(undefined);

    // Assert — no ThreadList chrome mounted at all.
    expect(
      screen.container.querySelector("button")?.textContent ?? null,
    ).toBeNull();
  });

  it("renders ThreadList scoped to this shidduch when a record exists", async () => {
    // Act
    const { screen } = await renderTab(1);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Start a discussion" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("No discussions yet."))
      .toBeInTheDocument();
  });

  it("starting a discussion creates a thread whose subject_id is THIS shidduch's own id, not a stray literal", async () => {
    // Arrange
    const shidduchimId = 2;

    // Act
    const { screen, dataProvider } = await renderTab(shidduchimId);
    await screen.getByRole("button", { name: "Start a discussion" }).click();

    // Assert — the real FakeRest round trip, scoped by the record's own id.
    await expect
      .element(screen.getByText("No messages yet."))
      .toBeInTheDocument();
    const { data: threads } = await dataProvider.getList("threads", {
      filter: {},
      pagination: { page: 1, perPage: 10 },
      sort: { field: "id", order: "ASC" },
    });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      subject_type: "shidduch",
      subject_id: shidduchimId,
    });
  });
});
