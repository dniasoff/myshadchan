import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ListContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { ListControllerResult } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { EntityListStatus } from "./useEntityListStatus";
import { useEntityListStatus } from "./useEntityListStatus";

/**
 * AC 6's five-branch decision table. No JSX in this file on purpose — the
 * story names this file `useEntityListStatus.test.ts`, not `.test.tsx` —
 * every element is built with `createElement`.
 */

const FIXTURE_ROW = { id: 1, name: "Fixture" };

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

async function captureStatus(
  overrides: Partial<ListControllerResult>,
): Promise<EntityListStatus> {
  let captured: EntityListStatus | undefined;

  function Probe() {
    captured = useEntityListStatus();
    return null;
  }

  await render(
    createElement(
      TestMemoryRouter,
      null,
      createElement(
        CoreAdminContext,
        { i18nProvider: testI18nProvider },
        createElement(ListContextProvider, {
          value: buildListContextValue(overrides),
          children: createElement(Probe),
        }),
      ),
    ),
  );

  if (!captured) {
    throw new Error("useEntityListStatus never rendered a result");
  }
  return captured;
}

describe("useEntityListStatus — the four-state decision (AC 6)", () => {
  it("returns loading while isPending", async () => {
    // Arrange / Act
    const status = await captureStatus({
      isPending: true,
      data: undefined,
      error: null,
    });

    // Assert
    expect(status).toEqual({ status: "loading" });
  });

  it("returns error with a callable refetch, even when stale data is present", async () => {
    // Arrange
    const refetch = vi.fn();

    // Act
    const status = await captureStatus({
      isPending: false,
      error: new Error("boom"),
      data: [FIXTURE_ROW],
      filterValues: {},
      refetch,
    });

    // Assert
    expect(status.status).toBe("error");
    if (status.status !== "error") {
      throw new Error("expected status to be 'error'");
    }
    expect(status.error).toBeInstanceOf(Error);
    status.refetch();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("returns empty when there is no data and no active filter", async () => {
    // Arrange / Act
    const status = await captureStatus({
      isPending: false,
      error: null,
      data: [],
      filterValues: {},
    });

    // Assert
    expect(status).toEqual({ status: "empty" });
  });

  it("returns no-matches when there is no data and a filter (e.g. search) is active", async () => {
    // Arrange / Act — `q` is a filterValues key like any other.
    const status = await captureStatus({
      isPending: false,
      error: null,
      data: [],
      filterValues: { q: "chaim" },
    });

    // Assert
    expect(status).toEqual({ status: "no-matches" });
  });

  it("returns ready with the data when records are present", async () => {
    // Arrange / Act
    const status = await captureStatus({
      isPending: false,
      error: null,
      data: [FIXTURE_ROW],
      filterValues: {},
    });

    // Assert
    expect(status).toEqual({ status: "ready", data: [FIXTURE_ROW] });
  });
});
