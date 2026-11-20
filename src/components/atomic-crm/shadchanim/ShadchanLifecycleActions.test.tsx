import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient } from "@tanstack/react-query";
import {
  CoreAdminContext,
  RecordContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type * as RaCore from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { Shadchan } from "../types";
import {
  ShadchanLifecycleActions,
  ShadchanPendingActionBar,
} from "./ShadchanLifecycleActions";

const { notifyMock, useGetListMock, useViewerRoleMock } = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  useGetListMock: vi.fn(),
  useViewerRoleMock: vi.fn(),
}));

vi.mock("ra-core", async () => ({
  ...(await vi.importActual<typeof RaCore>("ra-core")),
  useGetList: (...args: unknown[]) => useGetListMock(...args),
  useNotify: () => notifyMock,
}));

vi.mock("../entity360/useViewerRole", () => ({
  useViewerRole: useViewerRoleMock,
}));

const record = {
  id: 42,
  account_id: 1,
  name: "Miriam Gold",
} as Shadchan;

const renderActions = async (dataProvider: CrmDataProvider) =>
  render(
    <TestMemoryRouter initialEntries={["/shadchanim/42"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={new QueryClient()}
        i18nProvider={testI18nProvider}
      >
        <RecordContextProvider value={record}>
          <ShadchanLifecycleActions />
        </RecordContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

const renderUndoBar = async (dataProvider: CrmDataProvider) =>
  render(
    <TestMemoryRouter initialEntries={["/shadchanim"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={new QueryClient()}
        i18nProvider={testI18nProvider}
      >
        <ShadchanPendingActionBar
          action={{
            id: 42,
            name: "Miriam Gold",
            deadline: Date.now() + 10_000,
          }}
          onDone={vi.fn()}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

const buildDataProvider = (linkedCount = 0) => {
  const archiveShadchan = vi.fn().mockResolvedValue(undefined);
  const restoreShadchan = vi.fn().mockResolvedValue(undefined);
  const getList = vi.fn().mockImplementation(async (resource: string) => {
    if (resource === "shidduchim") {
      return {
        data: Array.from({ length: linkedCount }, (_, index) => ({
          id: index + 1,
        })),
        total: linkedCount,
      };
    }
    return { data: [], total: 0 };
  });
  return {
    archiveShadchan,
    getList,
    restoreShadchan,
  } as unknown as CrmDataProvider;
};

describe("ShadchanLifecycleActions", () => {
  beforeEach(() => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    notifyMock.mockReset();
    useGetListMock.mockReset();
    useGetListMock.mockReturnValue({ data: [], isPending: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["single", "pending", undefined])(
    "hides the delete action and skips linked queries for denied role %s",
    async (role) => {
      useViewerRoleMock.mockReturnValue({ role, isPending: false });
      const dataProvider = buildDataProvider(2);

      const screen = await renderActions(dataProvider);

      await expect
        .element(screen.getByRole("button", { name: "Delete shadchan" }))
        .not.toBeInTheDocument();
      expect(useGetListMock).not.toHaveBeenCalled();
    },
  );

  it("shows the linked suggestion warning and archives immediately", async () => {
    const dataProvider = buildDataProvider(3);
    useGetListMock.mockImplementation((resource: string) =>
      resource === "shidduchim"
        ? {
            data: [{ id: 1 }, { id: 2 }, { id: 3 }],
            isPending: false,
            total: 3,
          }
        : { data: [], isPending: false, total: 0 },
    );
    const screen = await renderActions(dataProvider);

    await vi.waitFor(() => {
      expect(useGetListMock).toHaveBeenCalledWith(
        "shidduchim",
        expect.anything(),
      );
    });
    await screen.getByRole("button", { name: "Delete shadchan" }).click();
    await expect
      .element(
        screen.getByText(
          "3 suggestions use this shadchan. They will have no shadchan.",
        ),
      )
      .toBeInTheDocument();

    await screen.getByRole("button", { name: "Delete anyway" }).click();

    expect(dataProvider.archiveShadchan).toHaveBeenCalledWith(42);
    expect(notifyMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Undo is available"),
      expect.anything(),
    );
  });

  it("renders an accessible Undo bar and restores the same shadchan", async () => {
    const dataProvider = buildDataProvider();
    const screen = await renderUndoBar(dataProvider);

    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Undo is available for 10 seconds.");
    expect(screen.getByRole("button", { name: "Undo" })).toHaveClass(
      "min-h-11",
    );
    await screen.getByRole("button", { name: "Undo" }).click();

    await vi.waitFor(() => {
      expect(dataProvider.restoreShadchan).toHaveBeenCalledWith(42);
    });
  });
});
