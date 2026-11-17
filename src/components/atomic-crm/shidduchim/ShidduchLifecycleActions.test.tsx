import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { ShidduchSummary } from "../types";
import {
  readPendingShidduchActions,
  SHIDDUCH_DELETE_MARKER_KEY,
} from "./shidduchLifecycle";
import { ShidduchLifecycleActions } from "./ShidduchLifecycleActions";

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
});
