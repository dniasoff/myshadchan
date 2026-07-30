import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { Interaction } from "../types";
import { SingleInputPanel } from "./SingleInputPanel";

/**
 * Story 5.7, AC 2: the right rail's read-only "single's input" panel — a
 * feed of `kind = 'single_input'` interactions, newest-first, with an
 * explaining (not blank, not an error) empty state until Epic 6 wires up
 * the write path.
 */

let nextId = 1;
const buildInteraction = (
  overrides: Partial<Interaction> = {},
): Interaction => ({
  id: nextId++,
  account_id: 1,
  target_type: "shidduch",
  target_id: 1,
  scope: "shidduch",
  kind: "single_input",
  body: "Something the single shared",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const renderPanel = async (getList: DataProvider["getList"]) => {
  const dataProvider = { getList } as unknown as DataProvider;

  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <SingleInputPanel shidduchimId={1} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("SingleInputPanel — loading, empty and error states (AC 2)", () => {
  it("shows a translated empty message, not blank and not an error, when nothing has been shared yet", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const screen = await renderPanel(getList);

    // Assert
    await expect
      .element(screen.getByText("Nothing has been shared yet."))
      .toBeInTheDocument();
    expect(screen.container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows a translated error message, never a blank panel, when the read fails", async () => {
    // Arrange
    const getList = vi.fn().mockRejectedValue(new Error("boom"));

    // Act
    const screen = await renderPanel(getList);

    // Assert
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Could not load the single's input."))
      .toBeInTheDocument();
  });

  it("filters on target_type/target_id/kind and reads newest-first", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    await renderPanel(getList);

    // Assert
    expect(getList).toHaveBeenCalledWith(
      "interactions",
      expect.objectContaining({
        filter: expect.objectContaining({
          target_type: "shidduch",
          target_id: 1,
          kind: "single_input",
        }),
        sort: { field: "created_at", order: "DESC" },
      }),
    );
  });
});

describe("SingleInputPanel — rendered rows (AC 2)", () => {
  it("renders every row the provider returns, newest-first as the provider ordered them", async () => {
    // Arrange
    const newer = buildInteraction({
      body: "Newer share",
      created_at: "2026-02-01T00:00:00Z",
    });
    const older = buildInteraction({
      body: "Older share",
      created_at: "2026-01-01T00:00:00Z",
    });
    const getList = vi
      .fn()
      .mockResolvedValue({ data: [newer, older], total: 2 });

    // Act
    const screen = await renderPanel(getList);

    // Assert
    await expect.element(screen.getByText("Newer share")).toBeInTheDocument();
    const items = screen.container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Newer share");
    expect(items[1].textContent).toContain("Older share");
  });
});
