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
  // Deliberately NOT `` `/${FIXTURE_RESOURCE}/${id}` `` — that shape is
  // byte-identical to what a stray template literal would also produce, so
  // an assertion built from it can never distinguish "routed through
  // buildTabPath" from "hand-built the URL" (review finding F1). `/legacy/…`
  // is the real pre-Epic-5 descriptor shape the contract documents
  // (buildTabPath.ts's own header comment: "before an entity migrates onto
  // Entity360, its descriptor's buildRecordPath returns `/{name}/{id}/show`"),
  // so a template-literal regression here yields a visibly wrong href
  // instead of an accidentally-correct one.
  const descriptor: EntityDescriptor = {
    name: FIXTURE_RESOURCE,
    label: "Fixture",
    buildRecordPath: (id) => `/legacy/${id}/show`,
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
    // Arrange — AC 5(b)'s literal fixture: seven tasks, five incomplete and
    // two complete, fed to the component UNFILTERED, unsorted and
    // untruncated (review finding F4). Naming a mocked data provider "the
    // boundary" cannot prove AC 5(b) — a provider that ignored
    // `done_date@is` or shipped rows out of order would render identically
    // to a correct one under the old, pre-filtered fixture. The two soonest
    // incomplete rows carry earlier due dates than the two completed rows,
    // so passing this also proves completion — not just position — decides
    // what is excluded.
    const rows = [
      buildTask({
        text: "furthest incomplete",
        due_date: "2026-01-05T00:00:00Z",
      }),
      buildTask({ text: "third", due_date: "2026-01-03T00:00:00Z" }),
      buildTask({
        text: "done one",
        due_date: "2026-01-01T06:00:00Z",
        done_date: "2026-01-10T00:00:00Z",
      }),
      buildTask({ text: "soonest", due_date: "2026-01-01T00:00:00Z" }),
      buildTask({ text: "next", due_date: "2026-01-02T00:00:00Z" }),
      buildTask({
        text: "done two",
        due_date: "2026-01-02T06:00:00Z",
        done_date: "2026-01-11T00:00:00Z",
      }),
      buildTask({
        text: "next-furthest incomplete",
        due_date: "2026-01-04T00:00:00Z",
      }),
    ];
    const getList = vi.fn().mockResolvedValue({ data: rows, total: 7 });

    // Act
    const { screen } = await renderRailSummary({}, { getList });
    await expect.element(screen.getByText("soonest")).toBeInTheDocument();

    // Assert — three rows, in order, none of them a completed task.
    const items = screen.container.querySelectorAll("ul > li");
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain("soonest");
    expect(items[1].textContent).toContain("next");
    expect(items[1].textContent).not.toContain("next-furthest");
    expect(items[2].textContent).toContain("third");
    for (const item of items) {
      expect(item.textContent).not.toContain("done");
    }

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
    expect(link.element().getAttribute("href")).toBe("/legacy/77/show/tasks");
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

  it("renders the same empty state for a single viewer, whose tasks read RLS denies entirely (Story 6.2, AC 10) — no client-side role guard added here, Ruling 2 keeps the rail read-only", async () => {
    // Arrange — Story 6.2 denies the `single` role every row of `tasks` at
    // the database layer (05_policies.sql); a real single's getList('tasks')
    // resolves empty exactly like this mock, so this component needs no role
    // branching of its own. This test names that intent explicitly rather
    // than leaving it as an unstated implication of the empty-state test
    // above.
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
    expect(link.element().getAttribute("href")).toBe("/legacy/3/show/tasks");
  });
});
