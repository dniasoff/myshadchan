import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { MemberRole, MyContext, ShidduchSummary, Task } from "../types";
import "./entityDescriptor";
import {
  buildTaskDueDate,
  formatTodoWhen,
  getQuickPickDate,
  isTodoBoxVisible,
} from "./shidduchTodo";
import { ShidduchTodoBox } from "./ShidduchTodoBox";
import { todoSummaryForTasks } from "./shidduchTodoSummary";

let nextTaskId = 1;

const buildTask = (overrides: Partial<Task> = {}): Task => ({
  id: nextTaskId++,
  type: "reminder",
  text: "Follow up",
  due_date: null,
  done_date: null,
  target_type: "shidduch",
  target_id: 42,
  ...overrides,
});

const buildShidduch = (): ShidduchSummary => ({
  id: 42,
  account_id: 1,
  single_id: 10,
  pipeline_state: "new",
  first_suggested_at: "2026-01-01T00:00:00Z",
  redt_date: "2026-01-02T00:00:00Z",
  origin: "manual",
  visibility: "shared",
  index: 0,
  created_at: "2026-01-01T00:00:00Z",
  name_en: "Chaim Cohen",
});

const contextFor = (role: MemberRole): MyContext => ({
  account_id: 1,
  kind: "household",
  name: "Fixture Household",
  role,
  is_active: true,
});

const renderTodoBox = async (
  role: MemberRole,
  tasks: Task[] = [],
  overrides: Partial<DataProvider> = {},
) => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [contextFor(role)]);
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: tasks, total: tasks.length }),
    getMyContexts: vi.fn().mockResolvedValue([contextFor(role)]),
    create: vi.fn().mockResolvedValue({ data: buildTask() }),
    update: vi.fn().mockResolvedValue({ data: buildTask() }),
    ...overrides,
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ShidduchTodoBox shidduch={buildShidduch()} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("ShidduchTodoBox role gate and quick add helpers", () => {
  afterEach(() => vi.useRealTimers());

  it("uses the Tasks tab role allow-list and fails closed while pending or undefined", () => {
    expect(isTodoBoxVisible("parent_admin", false)).toBe(true);
    expect(isTodoBoxVisible("self_manager", false)).toBe(true);
    expect(isTodoBoxVisible("helper", false)).toBe(true);
    expect(isTodoBoxVisible("shadchan", false)).toBe(true);
    expect(isTodoBoxVisible("single", false)).toBe(false);
    expect(isTodoBoxVisible(undefined, false)).toBe(false);
    expect(isTodoBoxVisible("parent_admin", true)).toBe(false);
  });

  it("calculates Today, Tomorrow, and the current Monday, including Monday itself", () => {
    const monday = new Date("2026-11-16T12:00:00");
    const tuesday = new Date("2026-11-17T12:00:00");

    expect(getQuickPickDate("today", monday)).toBe("2026-11-16");
    expect(getQuickPickDate("tomorrow", monday)).toBe("2026-11-17");
    expect(getQuickPickDate("monday", monday)).toBe("2026-11-16");
    expect(getQuickPickDate("monday", tuesday)).toBe("2026-11-23");
  });

  it("keeps an optional time in the same local-date-to-ISO conversion as reminder creation", () => {
    const due = buildTaskDueDate("2026-11-16", "15:30");
    expect(new Date(due).getHours()).toBe(15);
    expect(new Date(due).getMinutes()).toBe(30);
  });

  it("summarizes only open shidduch tasks, so completed tasks cannot inflate a marker", () => {
    const summary = todoSummaryForTasks([
      buildTask({ id: 1, due_date: "2026-11-16T09:00:00Z" }),
      buildTask({
        id: 2,
        due_date: "2026-11-17T09:00:00Z",
        done_date: "2026-11-15T09:00:00Z",
      }),
      buildTask({ id: 3, target_id: 99, due_date: "2026-11-18T09:00:00Z" }),
      buildTask({
        id: 4,
        target_type: "reference",
        due_date: "2026-11-18T09:00:00Z",
      }),
    ]);

    expect(summary.get("42")).toMatchObject({ count: 1 });
    expect(summary.get("99")).toMatchObject({ count: 1 });
  });

  it("uses a weekday for a due-soon marker and a neutral date for later work", () => {
    vi.setSystemTime(new Date("2026-11-16T12:00:00"));
    expect(formatTodoWhen("2026-11-16T18:00:00")).toBe("Today");
    expect(formatTodoWhen("2026-11-18T18:00:00")).toBe("Wednesday");
    expect(formatTodoWhen("2026-12-01T18:00:00")).toBe("1 Dec");
  });
});

describe("ShidduchTodoBox interactions", () => {
  it("blocks an empty quick add, trims text, and sends an optional timed due date", async () => {
    const create = vi.fn().mockResolvedValue({ data: buildTask() });
    const { screen } = await renderTodoBox("shadchan", [], { create });
    const textInput = screen.getByLabelText("What do I need to do?");
    const addButton = screen.getByRole("button", { name: "Add to do" });

    await expect.element(addButton).toBeDisabled();
    await textInput.fill("   ");
    await expect.element(addButton).toBeDisabled();

    await textInput.fill("  Call Monday to set up a meeting  ");
    await screen.getByRole("button", { name: "Monday" }).click();
    await screen.getByLabelText("Time (optional)").fill("15:30");
    await addButton.click();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith("tasks", {
      data: {
        target_type: "shidduch",
        target_id: 42,
        text: "Call Monday to set up a meeting",
        due_date: expect.any(String),
      },
    });
    const dueDate = create.mock.calls[0][1].data.due_date as string;
    expect(new Date(dueDate).getHours()).toBe(15);
    expect(new Date(dueDate).getMinutes()).toBe(30);
  });

  it("completes an open task through the shared tasks resource", async () => {
    const task = buildTask({
      id: 501,
      text: "Call Monday to set up a meeting",
      due_date: "2026-11-16T15:30:00Z",
    });
    const update = vi.fn().mockResolvedValue({ data: task });
    const { screen } = await renderTodoBox("parent_admin", [task], { update });

    await screen
      .getByRole("checkbox", {
        name: "Mark Call Monday to set up a meeting complete",
      })
      .click();

    expect(update).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({
        id: 501,
        data: { done_date: expect.any(String) },
      }),
    );
  });

  it("fails closed for a single-role viewer and does not query tasks", async () => {
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { screen } = await renderTodoBox("single", [], { getList });

    await expect.element(screen.getByText("To do")).not.toBeInTheDocument();
    expect(getList).not.toHaveBeenCalledWith("tasks", expect.anything());
  });
});
