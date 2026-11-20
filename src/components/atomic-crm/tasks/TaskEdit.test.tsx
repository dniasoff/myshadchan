import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { Notification } from "@/components/admin/notification";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { Task } from "../types";
import { TaskEdit } from "./TaskEdit";

const task: Task = {
  id: 1,
  type: "none",
  text: "Call the reference",
  due_date: "2026-02-01T00:00:00Z",
  done_date: null,
};

describe("TaskEdit", () => {
  it("allows a corrected Save after an invalid attempt", async () => {
    const update = vi.fn().mockResolvedValue({ data: task });
    const dataProvider = {
      getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getOne: vi.fn().mockResolvedValue({ data: task }),
      update,
    } as unknown as DataProvider;

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <TaskEdit
            open
            close={() => {}}
            taskId={task.id}
            mutationMode="pessimistic"
          />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    const description = screen.getByLabelText("Description");
    const save = screen.getByRole("button", { name: "Save" });

    await description.fill("");
    await save.click();
    expect(update).not.toHaveBeenCalled();

    await description.fill("Call the corrected reference");
    await save.click();
    await expect.poll(() => update.mock.calls.length).toBe(1);
  });

  it("asks for confirmation before deleting from the editor", async () => {
    const deleteTask = vi.fn().mockResolvedValue({ data: task });
    const dataProvider = {
      getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getOne: vi.fn().mockResolvedValue({ data: task }),
      update: vi.fn().mockResolvedValue({ data: task }),
      delete: deleteTask,
    } as unknown as DataProvider;

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <TaskEdit
            open
            close={() => {}}
            taskId={task.id}
            mutationMode="pessimistic"
          />
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await screen.getByRole("button", { name: "Delete" }).click();
    await expect
      .element(screen.getByRole("heading", { name: "Delete this task?" }))
      .toBeInTheDocument();

    await screen
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel" })
      .click();
    expect(deleteTask).not.toHaveBeenCalled();
  });
});
