import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CoreAdminContext, ListBase, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { ContextMember, Task as TaskRecord } from "../types";
import { Task } from "./Task";
import { TasksIterator } from "./TasksIterator";

const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const;

const buildTask = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 1,
  type: "none",
  text: "Call the reference",
  due_date: "2026-02-01T00:00:00Z",
  done_date: null,
  ...overrides,
});

const buildMember = (
  overrides: Partial<ContextMember> = {},
): ContextMember => ({
  id: 1,
  account_id: 1,
  user_id: "1",
  role: "parent_admin",
  full_name: "Chani Klein",
  is_self: true,
  ...overrides,
});

const renderTask = async (
  task: TaskRecord,
  contextMembers: ContextMember[],
  overrides: Partial<DataProvider> = {},
) => {
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({
      data: contextMembers,
      total: contextMembers.length,
    }),
    getOne: vi.fn().mockResolvedValue({ data: task }),
    update: vi.fn().mockResolvedValue({ data: task }),
    delete: vi.fn().mockResolvedValue({ data: task }),
    ...overrides,
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <Task task={task} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

const renderStatefulTaskList = async (tasks: TaskRecord[]) => {
  const dataProvider = {
    getList: vi.fn().mockImplementation((resource: string) =>
      resource === "tasks"
        ? Promise.resolve({ data: tasks, total: tasks.length })
        : Promise.resolve({
            data: [buildMember({ id: 1, is_self: true })],
            total: 1,
          }),
    ),
    getOne: vi.fn().mockResolvedValue({ data: tasks[0] }),
    update: vi.fn().mockResolvedValue({ data: tasks[0] }),
    delete: vi.fn().mockResolvedValue({ data: tasks[0] }),
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ListBase resource="tasks" disableAuthentication>
          <h2 data-tasks-list-heading tabIndex={-1}>
            Tasks
          </h2>
          <TasksIterator />
        </ListBase>
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("Task — assignee chip on the row (AC-10)", () => {
  it("shows the other member's name and role for a two-member household", async () => {
    // Arrange / Act
    const task = buildTask({ member_id: 2 });
    const { screen } = await renderTask(task, [
      buildMember({ id: 1, is_self: true }),
      buildMember({
        id: 2,
        user_id: "2",
        full_name: "Yaakov Klein",
        role: "helper",
        is_self: false,
      }),
    ]);

    // Assert
    await expect
      .element(screen.getByText("Yaakov Klein · Helper"))
      .toBeInTheDocument();
  });

  it("renders no chip for a null assignee in a single-member household", async () => {
    // Arrange / Act — `Task.member_id` (types.ts) is typed
    // `Identifier | undefined`, not `| null`; omitting the override leaves
    // it `undefined`, which `TaskAssigneeChip`'s `memberId == null` check
    // treats identically to an explicit null.
    const task = buildTask();
    const { screen } = await renderTask(task, [
      buildMember({ id: 1, is_self: true }),
    ]);

    // Assert — the task text still renders; there's simply no chip.
    await expect
      .element(screen.getByText("Call the reference"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Unassigned"))
      .not.toBeInTheDocument();
  });
});

describe("Task — archived-assignee state offers Reassign (AC-7)", () => {
  it("shows the unresolved state and a Reassign affordance for an assignee no longer in the household", async () => {
    // Arrange / Act — member_id 99 resolves to nobody in context_members.
    const task = buildTask({ member_id: 99 });
    const { screen } = await renderTask(task, [
      buildMember({ id: 1, is_self: true }),
      buildMember({ id: 2, user_id: "2", is_self: false }),
    ]);

    // Assert
    await expect
      .element(screen.getByText("No longer in this household"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Reassign" }))
      .toBeInTheDocument();
  });

  it("does not offer Reassign when the assignee resolves normally", async () => {
    // Arrange / Act
    const task = buildTask({ member_id: 1 });
    const { screen } = await renderTask(task, [
      buildMember({ id: 1, is_self: true }),
      buildMember({ id: 2, user_id: "2", is_self: false }),
    ]);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Reassign" }))
      .not.toBeInTheDocument();
  });
});

describe("Task — a tap on a nested control never completes the task", () => {
  afterEach(async () => {
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
  });

  it("tapping Reassign on a phone opens the editor without marking the task done", async () => {
    // Arrange — a phone. The row's content wrapper used to carry an onClick
    // that toggled the task done on mobile, and every interactive child
    // inside it bubbled into that handler, so this correct tap fired the
    // wrong mutation as well as the right one.
    await page.viewport(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);
    const task = buildTask({ member_id: 99 });
    const { screen, dataProvider } = await renderTask(task, [
      buildMember({ id: 1, is_self: true }),
      buildMember({ id: 2, user_id: "2", is_self: false }),
    ]);

    // Act
    await screen.getByRole("button", { name: "Reassign" }).click();

    // Assert — no completion write of any kind.
    expect(dataProvider.update).not.toHaveBeenCalled();
  });
});

describe("Task — destructive actions are confirmed", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks before deleting a task from the Tasks page", async () => {
    const task = buildTask();
    const { screen, dataProvider } = await renderTask(task, [
      buildMember({ id: 1, is_self: true }),
    ]);

    await screen.getByRole("button", { name: "Delete" }).click();

    await expect
      .element(screen.getByRole("heading", { name: "Delete this task?" }))
      .toBeInTheDocument();
    await screen
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel" })
      .click();
    expect(dataProvider.delete).not.toHaveBeenCalled();
  });

  it("applies a double-confirm delete exactly once", async () => {
    const task = buildTask({ id: 2 });
    const deleteTask = vi.fn().mockResolvedValue({ data: task });
    const { screen } = await renderTask(
      task,
      [buildMember({ id: 1, is_self: true })],
      { delete: deleteTask },
    );
    vi.useFakeTimers();

    await screen.getByRole("button", { name: "Delete" }).click();
    const confirmDelete = screen
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" });

    await confirmDelete.dblClick();
    await expect
      .element(screen.getByRole("button", { name: "Undo" }))
      .toBeInTheDocument();
    const undoStatus = screen.getByRole("status");
    await expect.element(undoStatus).toBeInTheDocument();
    expect(
      undoStatus.getByRole("button", { name: "Undo" }).element(),
    ).toHaveClass("min-h-11", "min-w-11");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(deleteTask).toHaveBeenCalledTimes(1);
  });
});

describe("Task — keyboard and focus behavior", () => {
  afterEach(async () => {
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
  });

  it("focuses the editor and returns focus to Edit when Escape cancels", async () => {
    const task = buildTask();
    const { screen } = await renderTask(task, [
      buildMember({ id: 1, is_self: true }),
    ]);
    const edit = screen.getByRole("button", { name: "Edit" });

    await edit.click();
    await expect
      .poll(
        () =>
          document.activeElement ===
          screen.getByLabelText("Description").element(),
      )
      .toBe(true);

    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => document.activeElement === edit.element())
      .toBe(true);
  });

  it("returns focus to Edit when the mobile sheet is dismissed", async () => {
    await page.viewport(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);
    const task = buildTask();
    const { screen } = await renderTask(task, [
      buildMember({ id: 1, is_self: true }),
    ]);
    const edit = screen.getByRole("button", { name: "Edit" });

    await edit.click();
    await expect
      .poll(
        () =>
          document.activeElement ===
          screen.getByLabelText("Description").element(),
      )
      .toBe(true);

    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => document.activeElement === edit.element())
      .toBe(true);
  });

  it("cancels the delete confirmation with Escape and restores Delete focus", async () => {
    const task = buildTask();
    const { screen } = await renderTask(task, [
      buildMember({ id: 1, is_self: true }),
    ]);
    const deleteButton = screen.getByRole("button", { name: "Delete" });

    await deleteButton.click();
    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => document.activeElement === deleteButton.element())
      .toBe(true);
  });

  it("focuses the next visible row after a confirmed delete", async () => {
    const first = buildTask({ id: 1, text: "First task" });
    const second = buildTask({ id: 2, text: "Second task" });
    const dataProvider = {
      getList: vi.fn().mockResolvedValue({
        data: [buildMember({ id: 1, is_self: true })],
        total: 1,
      }),
      getOne: vi.fn().mockResolvedValue({ data: first }),
      update: vi.fn().mockResolvedValue({ data: first }),
      delete: vi.fn().mockResolvedValue({ data: first }),
    } as unknown as DataProvider;
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <h2 data-tasks-list-heading tabIndex={-1}>
            Tasks
          </h2>
          <Task task={first} />
          <Task task={second} />
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await screen.getByRole("button", { name: "Delete" }).nth(0).click();
    const confirm = screen.getByRole("dialog").getByRole("button", {
      name: "Delete",
    });
    await confirm.click();
    const secondEdit = screen.getByRole("button", { name: "Edit" }).nth(1);
    await expect
      .poll(() => document.activeElement === secondEdit.element())
      .toBe(true);
  });

  it("returns focus to the deleted row after Undo", async () => {
    const task = buildTask();
    const { screen } = await renderTask(task, [
      buildMember({ id: 1, is_self: true }),
    ]);
    const edit = screen.getByRole("button", { name: "Edit" });

    await screen.getByRole("button", { name: "Delete" }).click();
    await screen
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();
    await screen.getByRole("button", { name: "Undo" }).click();
    await expect
      .poll(() => document.activeElement === edit.element())
      .toBe(true);
  });

  it("uses the next task after a middle row is really removed", async () => {
    const tasks = [
      buildTask({ id: 1, text: "First task" }),
      buildTask({ id: 2, text: "Middle task" }),
      buildTask({ id: 3, text: "Last task" }),
    ];
    const { screen } = await renderStatefulTaskList(tasks);

    await screen.getByRole("button", { name: "Delete" }).nth(1).click();
    await screen
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();

    await expect
      .poll(() => document.querySelector('[data-task-id="2"]'))
      .toBe(null);
    await expect
      .poll(
        () =>
          document.activeElement ===
          document.querySelector('[data-task-id="3"] [data-task-edit]'),
      )
      .toBe(true);
  });

  it("uses the previous task after the last row is really removed", async () => {
    const tasks = [
      buildTask({ id: 1, text: "First task" }),
      buildTask({ id: 2, text: "Middle task" }),
      buildTask({ id: 3, text: "Last task" }),
    ];
    const { screen } = await renderStatefulTaskList(tasks);

    await screen.getByRole("button", { name: "Delete" }).nth(2).click();
    await screen
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();

    await expect
      .poll(() => document.querySelector('[data-task-id="3"]'))
      .toBe(null);
    await expect
      .poll(
        () =>
          document.activeElement ===
          document.querySelector('[data-task-id="2"] [data-task-edit]'),
      )
      .toBe(true);
  });

  it("focuses the restored row after Undo really remounts it", async () => {
    const task = buildTask({ id: 1, text: "Restored task" });
    const { screen } = await renderStatefulTaskList([task]);

    await screen.getByRole("button", { name: "Delete" }).click();
    await screen
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();
    await expect
      .poll(() => document.querySelector('[data-task-id="1"]'))
      .toBe(null);

    await screen.getByRole("button", { name: "Undo" }).click();
    await expect
      .poll(() => document.querySelector('[data-task-id="1"]'))
      .not.toBe(null);
    await expect
      .poll(
        () =>
          document.activeElement ===
          document.querySelector('[data-task-id="1"] [data-task-edit]'),
      )
      .toBe(true);
  });
});
