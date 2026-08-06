import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, memoryStore, TestMemoryRouter } from "ra-core";
import type { AuthProvider, DataProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { TasksListByDueDate } from "./TasksListByDueDate";

/**
 * AC-1/AC-2: the exact defect this story fixes was `TasksListByDueDate.tsx`
 * sending `filter: { member_id: identity?.id }` unconditionally. Each test
 * gets its OWN `memoryStore()` (the `misc/useEntityListViewMode.test.ts`
 * precedent) — `CoreAdminContext`'s default store is a module-level
 * singleton, so tests that shared it would leak the scope choice across
 * each other.
 */

const buildAuthProvider = (): AuthProvider =>
  ({
    getIdentity: vi.fn().mockResolvedValue({ id: 7, fullName: "Test User" }),
  }) as unknown as AuthProvider;

const renderList = async (
  getList = vi.fn().mockResolvedValue({ data: [], total: 0 }),
) => {
  const dataProvider = { getList } as unknown as DataProvider;
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        authProvider={buildAuthProvider()}
        i18nProvider={testI18nProvider}
        store={memoryStore()}
      >
        <TasksListByDueDate emptyPlaceholder={<p>Nothing here</p>} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, getList };
};

describe("TasksListByDueDate — Everyone/Mine scope (AC-1, AC-2)", () => {
  it("defaults to Everyone and sends no member_id filter", async () => {
    // Arrange / Act
    const { getList } = await renderList();

    // Assert
    await vi.waitFor(() => {
      expect(getList).toHaveBeenCalledWith(
        "tasks",
        expect.objectContaining({ filter: {} }),
      );
    });
  });

  it("switching to 'Assigned to me' filters by the caller's own member_id", async () => {
    // Arrange
    const { screen, getList } = await renderList();
    await vi.waitFor(() => {
      expect(getList).toHaveBeenCalledWith(
        "tasks",
        expect.objectContaining({ filter: {} }),
      );
    });

    // Act
    await screen.getByRole("button", { name: "Assigned to me" }).click();

    // Assert
    await vi.waitFor(() => {
      expect(getList).toHaveBeenCalledWith(
        "tasks",
        expect.objectContaining({ filter: { member_id: 7 } }),
      );
    });
  });

  it("keeps the scope toggle visible even when the scoped list is empty", async () => {
    // Arrange / Act
    const { screen } = await renderList();

    // Assert
    await expect.element(screen.getByText("Nothing here")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("group", { name: "Task scope" }))
      .toBeInTheDocument();
  });
});
