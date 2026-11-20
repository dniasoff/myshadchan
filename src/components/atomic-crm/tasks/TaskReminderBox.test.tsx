import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient } from "@tanstack/react-query";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { Task } from "../types";
import { TaskReminderBox } from "./TaskReminderBox";

const buildTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  type: "reminder",
  text: "Call the family",
  due_date: "2026-11-20T15:30:00",
  done_date: null,
  target_type: "shadchan",
  target_id: 7,
  ...overrides,
});

const renderBox = async (
  tasks: Task[] = [],
  overrides: Partial<DataProvider> = {},
) => {
  const queryClient = new QueryClient();
  const context = {
    account_id: 1,
    kind: "household" as const,
    name: "Fixture Household",
    role: "parent_admin" as const,
    is_active: true,
  };
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [context]);
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: tasks, total: tasks.length }),
    getMyContexts: vi.fn().mockResolvedValue([context]),
    create: vi.fn().mockResolvedValue({ data: buildTask() }),
    update: vi.fn().mockResolvedValue({ data: buildTask() }),
    delete: vi.fn().mockResolvedValue({ data: buildTask() }),
    ...overrides,
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <TaskReminderBox targetType="shadchan" targetId={7} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("TaskReminderBox", () => {
  it("uses the Reminders copy and creates a local-time reminder from typed 12-hour input", async () => {
    const create = vi.fn().mockResolvedValue({ data: buildTask() });
    const { screen } = await renderBox([], { create });

    await screen.getByLabelText("What do I need to do?").fill("Call at dinner");
    await screen.getByRole("button", { name: "Tomorrow" }).click();
    const time = screen.getByLabelText("Time (optional)");
    await time.fill("934 pm");
    await screen.getByLabelText("What do I need to do?").click();

    await expect.element(time).toHaveValue("9:34 PM");
    await screen.getByRole("button", { name: "Add reminder" }).click();

    expect(create).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({
        data: expect.objectContaining({
          target_type: "shadchan",
          target_id: 7,
          text: "Call at dinner",
          due_date: expect.any(String),
        }),
      }),
    );
    expect(create.mock.calls[0][1].data.due_date).toBe(
      new Date(2026, 10, 21, 21, 34).toISOString(),
    );
  });

  it("rejects an invalid typed time instead of submitting a wrong due date", async () => {
    const create = vi.fn();
    const { screen } = await renderBox([], { create });

    await screen.getByLabelText("What do I need to do?").fill("Bad time");
    await screen.getByRole("button", { name: "Today" }).click();
    const time = screen.getByLabelText("Time (optional)");
    await time.fill("24:00");
    await screen.getByLabelText("What do I need to do?").click();

    await expect
      .element(screen.getByText("We couldn't read that time. Try 9:34 PM."))
      .toBeInTheDocument();
    await screen.getByRole("button", { name: "Add reminder" }).click();
    expect(create).not.toHaveBeenCalled();
  });

  it("shows overdue reminders in red and edit re-arms the task with the typed time", async () => {
    vi.setSystemTime(new Date("2026-11-21T12:00:00"));
    const task = buildTask({
      id: 9,
      text: "Call the family",
      due_date: "2026-11-20T15:30:00",
    });
    const update = vi.fn().mockResolvedValue({ data: task });
    const { screen } = await renderBox([task], { update });

    await expect
      .element(screen.getByText(/Overdue/))
      .toHaveClass("text-destructive");
    await screen.getByRole("button", { name: "Edit" }).click();
    await screen.getByLabelText("Edit time (optional)").fill("9 pm");
    await screen.getByRole("button", { name: "Save" }).click();

    expect(update).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({
        id: 9,
        data: expect.objectContaining({
          text: "Call the family",
          due_date: expect.any(String),
        }),
      }),
    );
    const updatedDueDate = update.mock.calls[0][1].data.due_date as string;
    expect(updatedDueDate).toBe(new Date(2026, 10, 20, 21, 0).toISOString());
    vi.useRealTimers();
  });

  it("asks for confirmation before deleting and keeps the action word-labelled", async () => {
    const task = buildTask({ id: 12 });
    const { screen } = await renderBox([task]);

    await screen.getByRole("button", { name: "Delete" }).click();
    await expect
      .element(screen.getByRole("heading", { name: "Delete this task?" }))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("dialog").getByRole("button", { name: "Cancel" }),
      )
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("dialog").getByRole("button", { name: "Delete" }),
      )
      .toBeInTheDocument();
  });
});
