import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ListContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { DataProvider, ListControllerResult } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { MemberRole, MyContext, ShidduchSummary, Task } from "../types";
import { ShidduchTodoMarker } from "./ShidduchTodoMarker";
import { ShidduchTodoSummaryProvider } from "./ShidduchTodoSummary";
import { fetchAllOpenShidduchTasks } from "./shidduchTodoSummary";
import "./entityDescriptor";

const shidduch: ShidduchSummary = {
  id: 42,
  account_id: 1,
  single_id: 10,
  pipeline_state: "new",
  first_suggested_at: "2026-01-01T00:00:00Z",
  redt_date: "2026-01-02T00:00:00Z",
  origin: "manual",
  visibility: "shared",
  index: 0,
  created_at: "2026-01-01T00:00:00Z",
  name_en: "Chaim Cohen",
};

const listContext = {
  data: [shidduch],
  total: 1,
  isPending: false,
  isFetching: false,
  isLoading: false,
  error: null,
  page: 1,
  perPage: 25,
  sort: { field: "index", order: "ASC" as const },
  filterValues: {},
  displayedFilters: {},
  selectedIds: [],
  resource: "shidduchim",
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
} as unknown as ListControllerResult;

const contextFor = (role: MemberRole, isActive = true): MyContext => ({
  account_id: 1,
  kind: "household",
  name: "Fixture Household",
  role,
  is_active: isActive,
});

const renderSummary = async ({
  role,
  isPending = false,
}: {
  role: MemberRole | undefined;
  isPending?: boolean;
}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const contexts =
    role == null ? [contextFor("single", false)] : [contextFor(role)];
  if (!isPending) queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);

  const dataProvider = {
    getMyContexts: isPending
      ? vi.fn().mockReturnValue(new Promise(() => {}))
      : vi.fn().mockResolvedValue(contexts),
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ListContextProvider value={listContext}>
          <ShidduchTodoSummaryProvider>
            <ShidduchTodoMarker shidduchId={shidduch.id} />
          </ShidduchTodoSummaryProvider>
        </ListContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("ShidduchTodoSummaryProvider privacy gate", () => {
  it.each([
    { label: "single role", role: "single" as const },
    { label: "undefined role", role: undefined },
  ])(
    "hides the marker and skips its task query for $label",
    async ({ role }) => {
      const { screen, dataProvider } = await renderSummary({ role });

      await expect
        .element(screen.getByLabelText(/to do/))
        .not.toBeInTheDocument();
      expect(dataProvider.getList).not.toHaveBeenCalledWith(
        "tasks",
        expect.anything(),
      );
    },
  );

  it("hides the marker and skips its task query while the role is pending", async () => {
    const { screen, dataProvider } = await renderSummary({
      role: undefined,
      isPending: true,
    });

    await expect
      .element(screen.getByLabelText(/to do/))
      .not.toBeInTheDocument();
    expect(dataProvider.getList).not.toHaveBeenCalledWith(
      "tasks",
      expect.anything(),
    );
  });
});

describe("fetchAllOpenShidduchTasks", () => {
  it("fetches every page instead of truncating an open-task count at 500", async () => {
    const tasks: Task[] = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1,
      type: "reminder",
      text: `Task ${index + 1}`,
      due_date: null,
      done_date: null,
      target_type: "shidduch",
      target_id: 42,
    }));
    const getList = vi
      .fn()
      .mockImplementation(
        async (
          _resource: string,
          params: { pagination: { page: number; perPage: number } },
        ) => {
          const start =
            (params.pagination.page - 1) * params.pagination.perPage;
          return {
            data: tasks.slice(start, start + params.pagination.perPage),
            total: tasks.length,
          };
        },
      );

    const loaded = await fetchAllOpenShidduchTasks(
      { getList } as unknown as CrmDataProvider,
      ["42"],
    );

    expect(loaded).toHaveLength(501);
    expect(getList).toHaveBeenCalledTimes(2);
    expect(getList.mock.calls[1][1].pagination).toEqual({
      page: 2,
      perPage: 500,
    });
  });
});
