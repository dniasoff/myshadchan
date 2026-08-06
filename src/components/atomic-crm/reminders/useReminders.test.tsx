import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { AuthProvider, DataProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { useReminders } from "./useReminders";

/**
 * AC-2: `/reminders` carries the SAME Everyone/Mine scope as `/tasks`, under
 * the same store key — this pins the filter `useReminders` sends to
 * `getList("tasks", …)` for each scope, mirroring
 * `tasks/TasksListByDueDate.test.tsx`.
 */

const buildAuthProvider = (): AuthProvider =>
  ({
    getIdentity: vi.fn().mockResolvedValue({ id: 7, fullName: "Test User" }),
  }) as unknown as AuthProvider;

const Probe = ({ scope }: { scope: "everyone" | "mine" }) => {
  useReminders(scope);
  return null;
};

const renderProbe = async (scope: "everyone" | "mine") => {
  const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });
  const getMany = vi.fn().mockResolvedValue({ data: [] });
  const dataProvider = { getList, getMany } as unknown as DataProvider;

  await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        authProvider={buildAuthProvider()}
        i18nProvider={testI18nProvider}
      >
        <Probe scope={scope} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { getList };
};

describe("useReminders — Everyone/Mine scope (AC-2)", () => {
  it("'everyone' sends no member_id term and does not wait on identity", async () => {
    // Arrange / Act
    const { getList } = await renderProbe("everyone");

    // Assert
    await vi.waitFor(() => {
      expect(getList).toHaveBeenCalledWith(
        "tasks",
        expect.objectContaining({ filter: { "done_date@is": null } }),
      );
    });
  });

  it("'mine' narrows to the caller's own member_id", async () => {
    // Arrange / Act
    const { getList } = await renderProbe("mine");

    // Assert
    await vi.waitFor(() => {
      expect(getList).toHaveBeenCalledWith(
        "tasks",
        expect.objectContaining({
          filter: { "done_date@is": null, member_id: 7 },
        }),
      );
    });
  });
});
