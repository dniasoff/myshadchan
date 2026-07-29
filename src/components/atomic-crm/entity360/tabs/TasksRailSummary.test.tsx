import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "../../providers/commons/i18nProvider";
import type { Task } from "../../types";
import type { EntityDescriptor } from "../entityDescriptor";
import { registerEntityDescriptor } from "../registry";
import { TasksRailSummary } from "./TasksRailSummary";

/**
 * Story 3.8's falsifiable claims for the read-only rail summary (contract
 * §11 Ruling 2, AC 5): the `limit`/order/no-mutation-controls behaviour, the
 * `buildTabPath` link target built through `useResourceContext()` (never a
 * template literal), and the UX-DR11 loading/empty/error states (AC 6). The
 * "stays read-only forever" half of Ruling 2 is
 * `TasksRailSummary.guard.test.ts`'s job, not this file's.
 */

const FIXTURE_RESOURCE = "tasks-rail-fixture";

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

const renderRailSummary = async (
  props: {
    targetType?: Task["target_type"];
    targetId?: number;
    limit?: number;
  },
  dataProviderOverrides: Partial<DataProvider>,
) => {
  const descriptor: EntityDescriptor = {
    name: FIXTURE_RESOURCE,
    label: "Fixture",
    buildRecordPath: (id) => `/${FIXTURE_RESOURCE}/${id}`,
  };
  registerEntityDescriptor(descriptor, { replace: true });

  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    ...dataProviderOverrides,
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResourceContextProvider value={FIXTURE_RESOURCE}>
          <TasksRailSummary
            targetType={props.targetType ?? "shidduch"}
            targetId={props.targetId ?? 1}
            limit={props.limit}
          />
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("TasksRailSummary — the incomplete-tasks filter and default limit (AC 5)", () => {
  it("reads only incomplete tasks, sorted by due date ascending, defaulting to 3 per page", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    await renderRailSummary(
      { targetType: "reference", targetId: 9 },
      { getList },
    );

    // Assert
    expect(getList).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({
        filter: {
          target_type: "reference",
          target_id: 9,
          "done_date@is": null,
        },
        sort: { field: "due_date", order: "ASC" },
        pagination: { page: 1, perPage: 3 },
      }),
    );
  });

  it("honours an explicit limit override", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    await renderRailSummary({ limit: 5 }, { getList });

    // Assert
    expect(getList).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({ pagination: { page: 1, perPage: 5 } }),
    );
  });
});

describe("TasksRailSummary — seven tasks, three shown, no mutation controls (AC 5)", () => {
  it("renders exactly three rows, all incomplete, ordered by due_date ASC, with no checkbox, submit button or text input", async () => {
    // Arrange — the data provider is the one boundary a rail summary trusts
    // to have already applied the filter/sort/limit; this fixture returns
    // exactly what a real "done_date@is: null, due_date ASC, perPage 3"
    // query would, so the assertion is about rendering, not re-filtering.
    const rows = [
      buildTask({ text: "soonest", due_date: "2026-01-01T00:00:00Z" }),
      buildTask({ text: "next", due_date: "2026-01-02T00:00:00Z" }),
      buildTask({ text: "third", due_date: "2026-01-03T00:00:00Z" }),
    ];
    const getList = vi.fn().mockResolvedValue({ data: rows, total: 5 });

    // Act
    const { screen } = await renderRailSummary({}, { getList });
    await expect.element(screen.getByText("soonest")).toBeInTheDocument();

    // Assert — three rows, in order.
    const items = screen.container.querySelectorAll("ul > li");
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain("soonest");
    expect(items[1].textContent).toContain("next");
    expect(items[2].textContent).toContain("third");

    // Assert — no mutation surface anywhere in the rendered DOM.
    expect(screen.container.querySelector('[role="checkbox"]')).toBeNull();
    expect(screen.container.querySelector('button[type="submit"]')).toBeNull();
    expect(screen.container.querySelector("input")).toBeNull();
    expect(screen.container.querySelector("textarea")).toBeNull();
  });

  it("builds the 'see all' link with buildTabPath, not a template literal", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderRailSummary({ targetId: 77 }, { getList });

    // Assert
    const link = screen.getByRole("link");
    await expect.element(link).toBeInTheDocument();
    expect(link.element().getAttribute("href")).toBe(
      `/${FIXTURE_RESOURCE}/77/tasks`,
    );
  });
});

describe("TasksRailSummary — loading, empty and error states (AC 6)", () => {
  it("shows a skeleton placeholder while the query is in flight", async () => {
    // Arrange
    const getList = vi.fn().mockReturnValue(new Promise(() => {}));

    // Act
    const { screen } = await renderRailSummary({}, { getList });

    // Assert
    expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await expect
      .element(screen.getByText("No tasks yet."))
      .not.toBeInTheDocument();
  });

  it("shows a translated empty message when there are no open tasks", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderRailSummary({}, { getList });

    // Assert
    await expect.element(screen.getByText("No tasks yet.")).toBeInTheDocument();
  });

  it("shows a translated error message and still renders the link into the tab", async () => {
    // Arrange
    const getList = vi.fn().mockRejectedValue(new Error("boom"));

    // Act
    const { screen } = await renderRailSummary({ targetId: 3 }, { getList });

    // Assert
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Could not load the tasks."))
      .toBeInTheDocument();
    const link = screen.getByRole("link");
    await expect.element(link).toBeInTheDocument();
    expect(link.element().getAttribute("href")).toBe(
      `/${FIXTURE_RESOURCE}/3/tasks`,
    );
  });
});
