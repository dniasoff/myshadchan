import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ListContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { ListControllerResult, RaRecord } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { EntityListView } from "./EntityListView";

const FIXTURE_ROW = { id: 1, name: "Fixture single" };

const buildListContextValue = (
  overrides: Partial<ListControllerResult>,
): ListControllerResult =>
  ({
    data: undefined,
    total: undefined,
    isPending: true,
    isFetching: true,
    isLoading: true,
    error: null,
    page: 1,
    perPage: 10,
    sort: { field: "id", order: "ASC" },
    filterValues: {},
    displayedFilters: {},
    selectedIds: [],
    resource: "fixture",
    refetch: vi.fn(),
    setFilters: vi.fn(),
    setPage: vi.fn(),
    setPerPage: vi.fn(),
    setSort: vi.fn(),
    showFilter: vi.fn(),
    hideFilter: vi.fn(),
    onSelect: vi.fn(),
    onSelectAll: vi.fn(),
    onToggleItem: vi.fn(),
    onUnselectItems: vi.fn(),
    ...overrides,
  }) as unknown as ListControllerResult;

const renderView = (overrides: Partial<ListControllerResult>) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ListContextProvider value={buildListContextValue(overrides)}>
          <EntityListView
            resource="fixture"
            skeleton={<div>Loading skeleton</div>}
            emptyState={{
              title: "Nothing here",
              description: "Add the first one.",
            }}
            noMatchesMessage="No fixtures match this search."
            renderItems={(data: RaRecord[]) => (
              <ul>
                {data.map((row) => (
                  <li key={String(row.id)}>{String(row.name)}</li>
                ))}
              </ul>
            )}
          />
        </ListContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("EntityListView — exactly one of four states renders (AC 6)", () => {
  it("renders the given skeleton while loading", async () => {
    // Arrange / Act
    const screen = await renderView({
      isPending: true,
      data: undefined,
      error: null,
    });

    // Assert
    await expect
      .element(screen.getByText("Loading skeleton"))
      .toBeInTheDocument();
  });

  it("renders a retry-capable error block — never the empty state — even with data: []", async () => {
    // Arrange
    const refetch = vi.fn();

    // Act
    const screen = await renderView({
      isPending: false,
      error: new Error("boom"),
      data: [],
      filterValues: {},
      refetch,
    });

    // Assert
    const retry = screen.getByRole("button", { name: "Try again" });
    await expect.element(retry).toBeInTheDocument();
    await expect
      .element(screen.getByText("Nothing here"))
      .not.toBeInTheDocument();

    await retry.click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders the entity's EmptyState when there is no data and no active filter", async () => {
    // Arrange / Act
    const screen = await renderView({
      isPending: false,
      error: null,
      data: [],
      filterValues: {},
    });

    // Assert
    await expect.element(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("renders the no-matches message when there is no data but a filter is active", async () => {
    // Arrange / Act
    const screen = await renderView({
      isPending: false,
      error: null,
      data: [],
      filterValues: { q: "chaim" },
    });

    // Assert
    await expect
      .element(screen.getByText("No fixtures match this search."))
      .toBeInTheDocument();
  });

  it("renders renderItems(data) when records are present", async () => {
    // Arrange / Act
    const screen = await renderView({
      isPending: false,
      error: null,
      data: [FIXTURE_ROW],
      filterValues: {},
    });

    // Assert
    await expect
      .element(screen.getByText("Fixture single"))
      .toBeInTheDocument();
  });
});
