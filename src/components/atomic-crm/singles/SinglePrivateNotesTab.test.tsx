import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { SinglePrivateNotesTab } from "./SinglePrivateNotesTab";

const renderPrivateNotesTab = async (
  dataProviderOverrides: Partial<DataProvider>,
) => {
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    create: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    ...dataProviderOverrides,
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <RecordContextProvider value={{ id: 1 }}>
          <SinglePrivateNotesTab />
        </RecordContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("SinglePrivateNotesTab", () => {
  it("reads single_notes filtered by the single in context", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    await renderPrivateNotesTab({ getList });

    // Assert
    expect(getList).toHaveBeenCalledWith(
      "single_notes",
      expect.objectContaining({
        filter: { single_id: 1 },
      }),
    );
  });

  it("does not send account_id when creating a note — the database sets it", async () => {
    // Arrange
    const create = vi.fn().mockResolvedValue({ data: { id: 1 } });
    const { screen } = await renderPrivateNotesTab({ create });

    // Act
    const textarea = screen.getByPlaceholder("Write a note…");
    await textarea.fill("My private note");
    const addButton = screen.getByRole("button", { name: "Add note" });
    await addButton.click();

    // Assert
    expect(create).toHaveBeenCalledWith("single_notes", {
      data: {
        single_id: 1,
        body: "My private note",
        visible_to_manager: false,
      },
    });
    expect(Object.keys(create.mock.calls[0][1].data)).not.toContain(
      "account_id",
    );
  });

  it("defaults a new note to private — visible_to_manager is false unless she opts in", async () => {
    // Arrange
    const create = vi.fn().mockResolvedValue({ data: { id: 1 } });
    const { screen } = await renderPrivateNotesTab({ create });

    // Act
    const textarea = screen.getByPlaceholder("Write a note…");
    await textarea.fill("Another private note");
    const addButton = screen.getByRole("button", { name: "Add note" });
    await addButton.click();

    // Assert
    expect(create).toHaveBeenCalledWith(
      "single_notes",
      expect.objectContaining({
        data: expect.objectContaining({ visible_to_manager: false }),
      }),
    );
  });

  it("shows the empty state when she has written nothing", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderPrivateNotesTab({ getList });

    // Assert
    await expect
      .element(screen.getByText("Nothing here yet. This space is yours."))
      .toBeInTheDocument();
  });
});
