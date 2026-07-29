import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "../../providers/commons/i18nProvider";
import { ENTITY_TARGET_TYPES, type Task } from "../../types";
import { TasksTab } from "./TasksTab";

/**
 * Story 3.8's falsifiable claims for the universal Tasks tab: one target
 * type per test for both the read filter and the create payload (AC 3a), the
 * done/undone toggle cycle (AC 3b), the create payload's exact four-field
 * shape (AC 3c), the "tasks" resource name the global list also reads
 * (AC 4b), and the UX-DR11 loading/empty/error/mutation-failure states
 * (AC 6).
 */

let nextId = 1;
const buildTask = (overrides: Partial<Task> = {}): Task => ({
  id: nextId++,
  type: "reminder",
  text: "Follow up",
  due_date: "2026-02-01T00:00:00Z",
  done_date: null,
  target_type: "shidduch",
  target_id: 1,
  ...overrides,
});

const renderTasksTab = async (
  props: { targetType?: Task["target_type"]; targetId?: number },
  dataProviderOverrides: Partial<DataProvider>,
) => {
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    create: vi.fn().mockResolvedValue({ data: buildTask() }),
    update: vi.fn().mockResolvedValue({ data: buildTask() }),
    ...dataProviderOverrides,
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <TasksTab
          targetType={props.targetType ?? "shidduch"}
          targetId={props.targetId ?? 1}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("TasksTab — one target type per test (AC 3a)", () => {
  it.each(ENTITY_TARGET_TYPES)(
    "reads and writes target type '%s' without hardcoding a different one",
    async (targetType) => {
      // Arrange
      const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });
      const create = vi.fn().mockResolvedValue({ data: buildTask() });

      // Act
      const { screen } = await renderTasksTab(
        { targetType, targetId: 42 },
        { getList, create },
      );
      await screen
        .getByPlaceholder("Add a task…")
        .fill(`a task about ${targetType}`);
      await screen.getByRole("button", { name: "Add task" }).click();

      // Assert — the read filter.
      expect(getList).toHaveBeenCalledWith(
        "tasks",
        expect.objectContaining({
          filter: { target_type: targetType, target_id: 42 },
          sort: { field: "due_date", order: "ASC" },
        }),
      );

      // Assert — the create payload. A copy-paste that renamed
      // `referenceId` to `targetId` while leaving `target_type: "reference"`
      // hardcoded fails three of these four rows.
      expect(create).toHaveBeenCalledTimes(1);
      const [resource, params] = create.mock.calls[0];
      expect(resource).toBe("tasks");
      expect(params.data.target_type).toBe(targetType);
      expect(params.data.target_id).toBe(42);
    },
  );
});

describe("TasksTab — create payload shape (AC 3c)", () => {
  it("sends only target_type, target_id, text and due_date — never member_id, account_id or delivery_channels", async () => {
    // Arrange
    const create = vi.fn().mockResolvedValue({ data: buildTask() });
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderTasksTab(
      { targetType: "reference", targetId: 7 },
      { create, getList },
    );
    await screen.getByPlaceholder("Add a task…").fill("Call back Sunday");
    await screen.getByRole("button", { name: "Add task" }).click();

    // Assert
    expect(create).toHaveBeenCalledTimes(1);
    const [, params] = create.mock.calls[0];
    expect(params.data).toEqual({
      target_type: "reference",
      target_id: 7,
      text: "Call back Sunday",
      due_date: null,
    });
  });

  it("does not submit an empty or whitespace-only task", async () => {
    // Arrange
    const create = vi.fn();
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderTasksTab({}, { create, getList });
    await screen.getByPlaceholder("Add a task…").fill("   ");

    // Assert — the button stays disabled for whitespace-only input.
    await expect
      .element(screen.getByRole("button", { name: "Add task" }))
      .toBeDisabled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("TasksTab — toggle cycle (AC 3b)", () => {
  it("marks an incomplete task done by writing a non-null ISO done_date", async () => {
    // Arrange
    const task = buildTask({ id: 501, text: "Pending task", done_date: null });
    const getList = vi.fn().mockResolvedValue({ data: [task], total: 1 });
    const update = vi.fn().mockResolvedValue({ data: task });

    // Act
    const { screen } = await renderTasksTab({}, { getList, update });
    await screen.getByRole("checkbox", { name: "Pending task" }).click();

    // Assert
    expect(update).toHaveBeenCalledTimes(1);
    const [resource, params] = update.mock.calls[0];
    expect(resource).toBe("tasks");
    expect(params.id).toBe(501);
    expect(typeof params.data.done_date).toBe("string");
    expect(Number.isNaN(Date.parse(params.data.done_date))).toBe(false);
  });

  it("marks a done task undone by writing done_date back to null", async () => {
    // Arrange
    const task = buildTask({
      id: 502,
      text: "Done task",
      done_date: "2026-01-15T00:00:00Z",
    });
    const getList = vi.fn().mockResolvedValue({ data: [task], total: 1 });
    const update = vi.fn().mockResolvedValue({ data: task });

    // Act
    const { screen } = await renderTasksTab({}, { getList, update });
    await screen.getByRole("checkbox", { name: "Done task" }).click();

    // Assert
    expect(update).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({
        id: 502,
        data: { done_date: null },
      }),
    );
  });
});

describe("TasksTab — the resource name matches the global Tasks list (AC 4b)", () => {
  it('creates against resource "tasks", the same resource the global list reads', async () => {
    // Arrange
    const create = vi.fn().mockResolvedValue({ data: buildTask() });
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderTasksTab({}, { create, getList });
    await screen.getByPlaceholder("Add a task…").fill("Something to do");
    await screen.getByRole("button", { name: "Add task" }).click();

    // Assert
    expect(create.mock.calls[0][0]).toBe("tasks");
  });
});

describe("TasksTab — loading, empty and error states (AC 6)", () => {
  it("shows a skeleton placeholder while the query is in flight, with no empty-state copy", async () => {
    // Arrange
    const getList = vi.fn().mockReturnValue(new Promise(() => {}));

    // Act
    const { screen } = await renderTasksTab({}, { getList });

    // Assert
    expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await expect
      .element(screen.getByText("No tasks yet."))
      .not.toBeInTheDocument();
  });

  it("shows a translated empty message when there are no tasks, and keeps the add form usable", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderTasksTab({}, { getList });

    // Assert
    await expect.element(screen.getByText("No tasks yet.")).toBeInTheDocument();
    await expect
      .element(screen.getByPlaceholder("Add a task…"))
      .toBeInTheDocument();
  });

  it("shows a translated error message, never a blank tab, and keeps the add form usable", async () => {
    // Arrange
    const getList = vi.fn().mockRejectedValue(new Error("boom"));

    // Act
    const { screen } = await renderTasksTab({}, { getList });

    // Assert
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Could not load the tasks."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByPlaceholder("Add a task…"))
      .toBeInTheDocument();
  });

  it("does not clear the text input when a create is rejected, so the user's typing is not lost", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const create = vi.fn().mockRejectedValue(new Error("network down"));

    // Act
    const { screen } = await renderTasksTab({}, { getList, create });
    const input = screen.getByPlaceholder("Add a task…");
    await input.fill("do not lose me");
    await screen.getByRole("button", { name: "Add task" }).click();

    // Assert
    await expect.element(input).toHaveValue("do not lose me");
  });
});
