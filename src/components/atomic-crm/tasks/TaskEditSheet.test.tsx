import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { Notification } from "@/components/admin/notification";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { Task } from "../types";
import { TaskEditSheet } from "./TaskEditSheet";

const task: Task = {
  id: 1,
  type: "none",
  text: "Call the reference",
  due_date: "2026-02-01T00:00:00Z",
  done_date: null,
};

describe("TaskEditSheet", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows only one provider update when Save is activated twice", async () => {
    let resolveUpdate: ((result: { data: Task }) => void) | undefined;
    const update = vi.fn(
      () =>
        new Promise<{ data: Task }>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
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
          <TaskEditSheet
            open
            onOpenChange={() => {}}
            taskId={task.id}
            mutationMode="pessimistic"
          />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    const save = screen.getByRole("button", { name: "Save" });
    await expect.element(save).toBeEnabled();
    await screen
      .getByLabelText("Description")
      .fill("Call the updated reference");
    await Promise.all([
      save.click({ force: true }),
      save.click({ force: true }),
    ]);
    await expect.poll(() => update.mock.calls.length).toBe(1);

    resolveUpdate?.({ data: task });
  });

  it("leaves the guard available after an invalid Save", async () => {
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
          <TaskEditSheet
            open
            onOpenChange={() => {}}
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

  it("asks before deleting and applies a confirmed delete once", async () => {
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
          <TaskEditSheet
            open
            onOpenChange={() => {}}
            taskId={task.id}
            mutationMode="pessimistic"
          />
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );
    vi.useFakeTimers();

    await screen.getByRole("button", { name: "Delete" }).click();
    await expect
      .element(screen.getByRole("heading", { name: "Delete this task?" }))
      .toBeInTheDocument();
    await screen
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel" })
      .click();
    expect(deleteTask).not.toHaveBeenCalled();

    await screen.getByRole("button", { name: "Delete" }).click();
    const confirm = screen
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" });
    await confirm.dblClick();
    await expect
      .element(screen.getByRole("button", { name: "Undo" }))
      .toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect.poll(() => deleteTask.mock.calls.length).toBe(1);
  });

  it("cancels the delete confirmation with Escape and restores Delete focus", async () => {
    const dataProvider = {
      getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getOne: vi.fn().mockResolvedValue({ data: task }),
      update: vi.fn().mockResolvedValue({ data: task }),
      delete: vi.fn().mockResolvedValue({ data: task }),
    } as unknown as DataProvider;

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <TaskEditSheet open onOpenChange={() => {}} taskId={task.id} />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    const deleteButton = screen.getByRole("button", { name: "Delete" });
    await deleteButton.click();
    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => document.activeElement === deleteButton.element())
      .toBe(true);
  });
});
