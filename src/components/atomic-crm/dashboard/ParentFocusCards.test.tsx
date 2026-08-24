import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { DataProvider } from "ra-core";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import "@/index.css";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { ShidduchSummary } from "../types";
import { ParentFocusCards } from "./ParentFocusCards";

const NOW = new Date("2026-08-24T12:00:00.000Z");

const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

let nextId = 1;

const suggestion = (
  overrides: Partial<ShidduchSummary> = {},
): ShidduchSummary =>
  ({
    id: nextId++,
    account_id: 1,
    single_id: 7,
    pipeline_state: "new",
    redt_date: daysAgo(1),
    nb_references: 1,
    ...overrides,
  }) as ShidduchSummary;

/**
 * Serves one fixed list. The row reads a single `shidduchim` list and derives
 * every card from it, so a stub is enough — `parentFocus.test.ts` owns the
 * counting rules, and this file owns "does a parent actually see them".
 */
function providerFor(rows: ShidduchSummary[]): DataProvider {
  const unused = () => Promise.reject(new Error("not used in this test"));
  return {
    getList: (resource: string) =>
      resource === "shidduchim"
        ? Promise.resolve({ data: rows, total: rows.length })
        : unused(),
    getOne: unused,
    getMany: unused,
    getManyReference: unused,
    create: unused,
    update: unused,
    updateMany: unused,
    delete: unused,
    deleteMany: unused,
  } as unknown as DataProvider;
}

const renderRow = (rows: ShidduchSummary[]) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={providerFor(rows)}
        i18nProvider={testI18nProvider}
      >
        <ParentFocusCards singleId={7} now={NOW} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ParentFocusCards", () => {
  it("shows a parent the four things that need them", async () => {
    // Arrange / Act — one of each situation the row exists to surface.
    const screen = await renderRow([
      suggestion({ pipeline_state: "new" }),
      suggestion({ pipeline_state: "look_into", nb_references: 0 }),
      suggestion({
        pipeline_state: "not_sure",
        redt_date: daysAgo(40),
        nb_references: 2,
      }),
      suggestion({ pipeline_state: "yes" }),
    ]);

    // Assert
    for (const label of [
      "Needs your answer",
      "No references called",
      "Waiting a while",
      "Moving forward",
    ]) {
      await expect.element(screen.getByText(label)).toBeVisible();
    }
  });

  it("does not render the platform metrics it replaced", async () => {
    // Arrange / Act
    const screen = await renderRow([suggestion({ pipeline_state: "new" })]);
    await expect.element(screen.getByText("Needs your answer")).toBeVisible();

    // Assert — these measure whether the product is working, not whether this
    // family's shidduchim are. They belong to whoever runs the product.
    for (const platformMetric of [
      "Cross-Account Leaks",
      "Mis-routed Items",
      "Trial → Paid Conversion",
      "AI Cost per Active Family",
    ]) {
      expect(screen.getByText(platformMetric).query()).toBeNull();
    }
  });

  it("reads as an all-clear when nothing needs the parent", async () => {
    // Arrange / Act — a settled pipeline: decided, and researched.
    const screen = await renderRow([
      suggestion({ pipeline_state: "no", nb_references: 4 }),
      suggestion({ pipeline_state: "for_sure_not", redt_date: daysAgo(400) }),
    ]);

    // Assert — the zero state has to feel finished, not broken.
    await expect
      .element(screen.getByText("Nobody is waiting on you"))
      .toBeVisible();
    await expect
      .element(screen.getByText("Nothing has gone quiet"))
      .toBeVisible();
  });

  it("renders every card even when the single has no suggestions at all", async () => {
    // Arrange / Act
    const screen = await renderRow([]);

    // Assert — a stable four-card row, so the page never jumps as data lands.
    await expect.element(screen.getByText("Needs your answer")).toBeVisible();
    await expect.element(screen.getByText("Moving forward")).toBeVisible();
  });
});
