import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { ContextMember, Task as TaskRecord } from "../types";
import { Task } from "./Task";

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
) => {
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({
      data: contextMembers,
      total: contextMembers.length,
    }),
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
        <Task task={task} />
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
