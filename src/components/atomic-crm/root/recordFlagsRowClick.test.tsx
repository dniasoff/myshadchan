import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ListContextProvider,
  ResourceContextProvider,
  ResourceDefinitionContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { ListControllerResult, ResourceDefinition } from "ra-core";

import { DataTable } from "@/components/admin/data-table";

import { testI18nProvider } from "../providers/commons/i18nProvider";

/**
 * Story 3.12 AC 7 — pins the exact `ra-core` mechanism `record-flags-missing`
 * exists to catch. `Resource.registerResource` computes
 * `hasEdit: !!edit || !!hasEdit`, `hasShow: !!show || !!hasShow`
 * (`ra-core/dist/core/Resource.js:28-34`): a resource registered `{ list }`
 * only leaves both flags `false`, `useGetPathForRecordCallback`'s inferred
 * link resolves nothing (`ra-core/dist/routing/useGetPathForRecordCallback.js`),
 * and `<DataTable>`'s row click silently does nothing
 * (`admin/data-table.tsx:232-235`). Adding `hasShow: true` — what an entity
 * without a `RECORD_FLAG_EXEMPTIONS` entry must do — restores it. This is
 * the artifact each Epic 5 migration copies to prove its own registration
 * before calling itself done.
 */

const FIXTURE_ROW = { id: 1, name: "Fixture row" };

const buildListContextValue = (): ListControllerResult =>
  ({
    data: [FIXTURE_ROW],
    total: 1,
    isPending: false,
    isFetching: false,
    isLoading: false,
    page: 1,
    perPage: 10,
    sort: { field: "id", order: "ASC" },
    filterValues: {},
    displayedFilters: {},
    selectedIds: [],
  }) as unknown as ListControllerResult;

const renderFixtureRow = async (
  resource: string,
  definitions: Record<string, ResourceDefinition>,
) => {
  let pathname: string | undefined;

  const screen = await render(
    <TestMemoryRouter
      locationCallback={(location) => {
        pathname = location.pathname;
      }}
    >
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ResourceDefinitionContextProvider definitions={definitions}>
          <ResourceContextProvider value={resource}>
            <ListContextProvider value={buildListContextValue()}>
              <DataTable bulkActionButtons={false}>
                <DataTable.Col source="name" />
              </DataTable>
            </ListContextProvider>
          </ResourceContextProvider>
        </ResourceDefinitionContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, getPathname: () => pathname };
};

describe("<DataTable> row click — record-flags-missing's mechanism (AC 7)", () => {
  it("does not navigate for a resource registered list-only, with no hasShow/hasEdit", async () => {
    // Arrange
    const { screen, getPathname } = await renderFixtureRow(
      "record-flags-row-click-none-fixture",
      {
        "record-flags-row-click-none-fixture": {
          name: "record-flags-row-click-none-fixture",
          hasList: true,
        },
      },
    );

    // Act
    await screen.getByText("Fixture row").click();

    // Assert — no navigation occurred; still on the initial "/".
    await expect.poll(() => getPathname()).toBe("/");
  });

  it("navigates once the resource declares hasShow: true", async () => {
    // Arrange
    const { screen, getPathname } = await renderFixtureRow(
      "record-flags-row-click-show-fixture",
      {
        "record-flags-row-click-show-fixture": {
          name: "record-flags-row-click-show-fixture",
          hasList: true,
          hasShow: true,
        },
      },
    );

    // Act
    await screen.getByText("Fixture row").click();

    // Assert
    await expect
      .poll(() => getPathname())
      .toBe("/record-flags-row-click-show-fixture/1/show");
  });
});
