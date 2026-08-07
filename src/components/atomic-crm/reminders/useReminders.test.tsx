import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { AuthProvider, DataProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { Task } from "../types";
import { useReminders } from "./useReminders";
import type { UseRemindersResult } from "./useReminders";

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

describe("useReminders — snooze() with no due date (Epic 12 review fix, R6)", () => {
  it("bases the new due date on now, not on new Date(null)'s Unix-epoch coercion", async () => {
    // Arrange
    const update = vi.fn().mockResolvedValue({ data: {} });
    const dataProvider = {
      getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getMany: vi.fn().mockResolvedValue({ data: [] }),
      update,
    } as unknown as DataProvider;

    let hookResult: UseRemindersResult | undefined;
    const Probe = () => {
      hookResult = useReminders("everyone");
      return null;
    };

    await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          authProvider={buildAuthProvider()}
          i18nProvider={testI18nProvider}
        >
          <Probe />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await vi.waitFor(() => expect(hookResult).toBeDefined());

    const task: Task = {
      id: 1,
      type: "reminder",
      text: "No-date reminder",
      due_date: null,
    };
    const before = Date.now();

    // Act
    await hookResult!.snooze(task);

    // Assert — before this fix, isOverdue(null) was `true` only by the
    // accident of the old `due_date: string` contract; the honest fix makes
    // this deliberate, not accidental, so it must still base on "now".
    const after = Date.now();
    expect(update).toHaveBeenCalledTimes(1);
    const [, params] = update.mock.calls[0] as [
      string,
      { data: { due_date: string } },
    ];
    const newDueDateMs = new Date(params.data.due_date).getTime();
    expect(newDueDateMs).toBeGreaterThan(before);
    expect(newDueDateMs).toBeLessThan(after + 2 * 24 * 60 * 60 * 1000);
  });
});
