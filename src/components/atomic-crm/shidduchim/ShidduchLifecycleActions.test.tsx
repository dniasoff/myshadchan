import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { useState } from "react";
import { Route, Routes, useLocation } from "react-router";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { ShidduchSummary } from "../types";
import {
  readPendingShidduchActions,
  getPendingShidduchAction,
  SHIDDUCH_DELETE_MARKER_KEY,
  SHIDDUCH_ACTION_UNDO_MS,
  type ShidduchLifecycleAction,
} from "./shidduchLifecycle";
import {
  ShidduchLifecycleActions,
  ShidduchPendingActionBar,
} from "./ShidduchLifecycleActions";

const { useViewerRoleMock } = vi.hoisted(() => ({
  useViewerRoleMock: vi.fn(),
}));

vi.mock("../entity360/useViewerRole", () => ({
  useViewerRole: useViewerRoleMock,
}));

const record = {
  id: 42,
  account_id: 1,
  single_id: 7,
  name_en: "Chaya Cohen",
  pipeline_state: "new",
  archived_at: null,
} as ShidduchSummary;

const buildDataProvider = (serverArchivedAt: string | null) => {
  const archiveShidduch = vi
    .fn()
    .mockRejectedValue(new Error("network timeout"));
  const getOne = vi.fn().mockResolvedValue({
    data: { ...record, archived_at: serverArchivedAt },
  });
  const dataProvider = {
    archiveShidduch,
    getOne,
    getShidduchReadState: vi.fn().mockResolvedValue({ inProgress: false }),
    restoreShidduch: vi.fn(),
  } as unknown as CrmDataProvider;
  return { archiveShidduch, dataProvider, getOne };
};

const renderActions = async (dataProvider: CrmDataProvider) =>
  render(
    <TestMemoryRouter initialEntries={["/shidduchim/42"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ShidduchLifecycleActions record={record} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

const chooseArchive = async (screen: Awaited<ReturnType<typeof render>>) => {
  await screen.getByRole("button", { name: "More actions" }).click();
  await screen.getByRole("menuitem", { name: "Archive suggestion" }).click();
};

const chooseDelete = async (screen: Awaited<ReturnType<typeof render>>) => {
  await screen.getByRole("button", { name: "More actions" }).click();
  await screen.getByRole("menuitem", { name: "Delete suggestion" }).click();
  await screen.getByRole("button", { name: "Delete", exact: true }).click();
};

const PageActionDestination = () => {
  const location = useLocation();
  const action = getPendingShidduchAction(location.state);
  return action ? (
    <ShidduchPendingActionBar action={action} onDone={vi.fn()} />
  ) : null;
};

const renderPendingBars = async (
  actions: ShidduchLifecycleAction[],
  dataProvider: CrmDataProvider,
  onDone = vi.fn(),
) =>
  render(
    <TestMemoryRouter initialEntries={["/shidduchim"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <div>
          {actions.map((action) => (
            <ShidduchPendingActionBar
              key={`${String(action.id)}:${action.kind}`}
              action={action}
              focusOnMount={false}
              onDone={onDone}
            />
          ))}
        </div>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

const pendingAction = (
  overrides: Partial<ShidduchLifecycleAction> = {},
): ShidduchLifecycleAction => ({
  kind: "delete",
  id: 42,
  name: "Chaya Cohen",
  deadline: Date.now() + SHIDDUCH_ACTION_UNDO_MS,
  origin: "row",
  ...overrides,
});

const PendingActionWithRemovableRow = ({
  action,
  onDone,
}: {
  action: ShidduchLifecycleAction;
  onDone: (result: "restored" | "expired" | "failed") => void;
}) => {
  const [rowVisible, setRowVisible] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setRowVisible(false)}>
        Remove row
      </button>
      {rowVisible ? <div data-testid="originating-row" /> : null}
      <ShidduchPendingActionBar
        action={action}
        focusOnMount={false}
        onDone={onDone}
      />
    </>
  );
};

describe("ShidduchPendingActionBar — independent undo windows", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  it("restores an archived suggestion through Archive + Undo", async () => {
    const restoreShidduch = vi.fn().mockResolvedValue(undefined);
    const dataProvider = { restoreShidduch } as unknown as CrmDataProvider;
    const onDone = vi.fn();
    const screen = await renderPendingBars(
      [pendingAction({ kind: "archive" })],
      dataProvider,
      onDone,
    );

    await screen.getByRole("button", { name: "Undo" }).click();

    expect(restoreShidduch).toHaveBeenCalledWith(42);
    expect(onDone).toHaveBeenCalledWith("restored");
  });

  it("restores a deleted suggestion through Delete + Undo", async () => {
    const restoreShidduch = vi.fn().mockResolvedValue(undefined);
    const dataProvider = { restoreShidduch } as unknown as CrmDataProvider;
    const screen = await renderPendingBars(
      [pendingAction({ kind: "delete" })],
      dataProvider,
    );

    await screen.getByRole("button", { name: "Undo" }).click();

    expect(restoreShidduch).toHaveBeenCalledWith(42);
  });

  it("keeps two rows' pending deadlines and Undo controls independent", async () => {
    vi.useFakeTimers();
    const deleteShidduch = vi.fn().mockResolvedValue({ purgePending: false });
    const dataProvider = {
      deleteShidduch,
      restoreShidduch: vi.fn().mockResolvedValue(undefined),
    } as unknown as CrmDataProvider;
    const screen = await renderPendingBars(
      [pendingAction({ id: 42 }), pendingAction({ id: 43 })],
      dataProvider,
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await screen.getByRole("button", { name: "Undo" }).first().click();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect.poll(() => deleteShidduch.mock.calls.length).toBe(1);
    expect(deleteShidduch).toHaveBeenCalledWith(43);
  });

  it("keeps a pending timer alive when the originating row leaves the list", async () => {
    vi.useFakeTimers();
    const deleteShidduch = vi.fn().mockResolvedValue({ purgePending: false });
    const dataProvider = { deleteShidduch } as unknown as CrmDataProvider;
    const screen = await render(
      <TestMemoryRouter initialEntries={["/shidduchim"]}>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <PendingActionWithRemovableRow
            action={pendingAction({ id: 42 })}
            onDone={vi.fn()}
          />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await screen.getByRole("button", { name: "Remove row" }).click();
    await expect
      .element(screen.getByTestId("originating-row"))
      .not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect.poll(() => deleteShidduch.mock.calls.length).toBe(1);
  });
});

describe("ShidduchLifecycleActions mutation reconciliation", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("clears an archive marker after rejection when reload still sees the suggestion active", async () => {
    const { archiveShidduch, dataProvider, getOne } = buildDataProvider(null);
    const screen = await renderActions(dataProvider);

    await chooseArchive(screen);
    await expect.poll(() => archiveShidduch.mock.calls.length).toBe(1);
    await expect.poll(() => getOne.mock.calls.length).toBe(1);

    expect(readPendingShidduchActions()).toEqual([]);
    expect(
      window.sessionStorage.getItem(SHIDDUCH_DELETE_MARKER_KEY),
    ).toBeNull();
  });

  it("clears the delete marker when its archive step rejects and reload sees active state", async () => {
    const { archiveShidduch, dataProvider, getOne } = buildDataProvider(null);
    const screen = await renderActions(dataProvider);

    await chooseDelete(screen);
    await expect.poll(() => archiveShidduch.mock.calls.length).toBe(1);
    await expect.poll(() => getOne.mock.calls.length).toBe(1);

    expect(readPendingShidduchActions()).toEqual([]);
  });

  it("closes the delete dialog and returns focus when its archive step rejects", async () => {
    const { archiveShidduch, dataProvider, getOne } = buildDataProvider(null);
    const screen = await renderActions(dataProvider);

    await chooseDelete(screen);
    await expect.poll(() => archiveShidduch.mock.calls.length).toBe(1);
    await expect.poll(() => getOne.mock.calls.length).toBe(1);
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    await expect
      .poll(() => document.activeElement?.getAttribute("aria-label"))
      .toBe("More actions");
  });

  it("keeps the suggestion-page menu words, aria, and destructive variant unchanged", async () => {
    const { dataProvider } = buildDataProvider(null);
    const screen = await renderActions(dataProvider);

    await screen.getByRole("button", { name: "More actions" }).click();

    const archive = screen.getByRole("menuitem", {
      name: "Archive suggestion",
    });
    const del = screen.getByRole("menuitem", {
      name: "Delete suggestion",
    });
    await expect.element(archive).toHaveTextContent("Archive suggestion");
    await expect.element(del).toHaveTextContent("Delete suggestion");
    await expect.element(archive).not.toHaveTextContent("Keeps the file");
    await expect.element(del).not.toHaveTextContent("Removes the file");
    expect(archive.element()).not.toHaveAttribute("aria-label");
    expect(del.element()).not.toHaveAttribute("aria-label");
    await expect.element(del).toHaveAttribute("data-variant", "destructive");
  });

  it("disables Delete while the resume read is in progress", async () => {
    const getShidduchReadState = vi
      .fn()
      .mockResolvedValue({ inProgress: true });
    const dataProvider = {
      archiveShidduch: vi.fn(),
      getOne: vi.fn(),
      getShidduchReadState,
      restoreShidduch: vi.fn(),
    } as unknown as CrmDataProvider;
    const screen = await renderActions(dataProvider);

    await expect
      .poll(() => getShidduchReadState.mock.calls.length)
      .toBeGreaterThan(0);
    await screen.getByRole("button", { name: "More actions" }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: "Delete suggestion" }))
      .toBeDisabled();
    await expect
      .element(
        screen.getByText(
          "Please wait: this resume is being made easy to read.",
        ),
      )
      .toBeInTheDocument();
  });

  it("keeps the marker when reconciliation proves the server archived the suggestion", async () => {
    const { archiveShidduch, dataProvider, getOne } = buildDataProvider(
      "2026-11-17T15:00:00.000Z",
    );
    const screen = await renderActions(dataProvider);

    await chooseArchive(screen);
    await expect.poll(() => archiveShidduch.mock.calls.length).toBe(1);
    await expect.poll(() => getOne.mock.calls.length).toBe(1);

    expect(readPendingShidduchActions()).toEqual([
      expect.objectContaining({ id: record.id, kind: "archive" }),
    ]);
  });

  it("keeps page-origin Archive focus on Undo after navigating to the list", async () => {
    const archiveShidduch = vi.fn().mockResolvedValue(undefined);
    const dataProvider = {
      archiveShidduch,
      getOne: vi.fn(),
      getShidduchReadState: vi.fn().mockResolvedValue({ inProgress: false }),
      restoreShidduch: vi.fn(),
    } as unknown as CrmDataProvider;
    const screen = await render(
      <TestMemoryRouter initialEntries={["/shidduchim/42"]}>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <Routes>
            <Route
              path="/shidduchim/42"
              element={<ShidduchLifecycleActions record={record} />}
            />
            <Route path="/shidduchim" element={<PageActionDestination />} />
          </Routes>
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await chooseArchive(screen);
    await expect.poll(() => archiveShidduch.mock.calls.length).toBe(1);
    const undo = screen.getByRole("button", { name: "Undo" });
    await expect
      .poll(() => document.activeElement === undo.element())
      .toBe(true);
  });
});
