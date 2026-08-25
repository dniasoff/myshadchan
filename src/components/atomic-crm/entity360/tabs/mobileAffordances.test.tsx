import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "@vitest/browser/context";
import {
  CoreAdminContext,
  RecordContextProvider,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { DataProvider } from "ra-core";

// Every assertion here is a COMPUTED value — a hit-test, a bounding box, a
// resolved colour. None of it means anything without the real
// Tailwind-generated stylesheet actually applying to the rendered classes,
// and a class-name assertion would pass on all three of the defects below.
import "@/index.css";

import { testI18nProvider } from "../../providers/commons/i18nProvider";
import type { Task } from "../../types";
import type { EntityDescriptor } from "../entityDescriptor";
import type { EntityRelationshipDescriptor } from "../relationshipDescriptor";
import { registerEntityDescriptor } from "../registry";
import { OverviewFactGrid } from "./OverviewFactGrid";
import { RelatedRecordsTab } from "./RelatedRecordsTab";
import { TasksTab } from "./TasksTab";

/**
 * The three Record-360 tab surfaces whose mobile behaviour is a property of
 * rendered CSS rather than of any prop or handler, kept together because the
 * failure mode is shared: each one type-checks, lints and passes its own
 * behavioural suite while being unusable on the phone most of this product's
 * parents hold.
 *
 * - Tasks: the completion checkbox is `size-4`, ~16px, against a 44px thumb.
 * - Related records: a `RecordLink` with no `className` renders as plain
 *   text, because Tailwind preflight strips the anchor's colour and
 *   underline and `src/index.css` restores only `cursor: pointer`.
 * - Overview: a fact grid that started at two columns and only ever stepped
 *   UP, so a 360px phone got two ~152px columns of bilingual values.
 */

/** A 390px handset — below `sm` (640px), where the touch treatments apply. */
const PHONE_VIEWPORT = { width: 390, height: 780 } as const;

/** The viewport every other suite expects going in
 * (.claude/rules/testing.md#Test-isolation). */
const DESKTOP_VIEWPORT = { width: 1280, height: 720 } as const;

/**
 * Half of a 44px target, less a couple of pixels of rounding slack: probing
 * this far outside the control's own 16px box must still land ON the control
 * if the hit extension is real.
 */
const TOUCH_PROBE_PX = 12;

/** What the browser would actually deliver a tap at (x, y) to. */
const hitTestedAt = (x: number, y: number): Element | null =>
  document.elementFromPoint(Math.round(x), Math.round(y));

describe("TasksTab — the completion checkbox is a real touch target", () => {
  afterEach(async () => {
    await page.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
  });

  /** Three tasks with no due date and no assignee: the SHORTEST row this tab
   * can render, and therefore the one where enlarged hit areas are most at
   * risk of colliding with the neighbouring row's. */
  const renderThreeMinimalTasks = async () => {
    const tasks: Task[] = [1, 2, 3].map((id) => ({
      id,
      type: "reminder",
      text: `Task ${id}`,
      due_date: null,
      done_date: null,
      target_type: "shidduch",
      target_id: 1,
    }));
    const dataProvider = {
      getList: vi
        .fn()
        .mockImplementation(async (resource: string) =>
          resource === "tasks"
            ? { data: tasks, total: tasks.length }
            : { data: [], total: 0 },
        ),
      create: vi.fn(),
      update: vi.fn(),
    } as unknown as DataProvider;

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          {/* `MobileContent` gives the tab panel `px-4` (src/index.css), so
           * the checkbox never sits flush against x=0 in the real app.
           * Reproduced here because without it the left-hand probe below
           * lands at a negative coordinate, where `elementFromPoint` returns
           * null for being outside the viewport rather than for missing. */}
          <div className="px-4">
            <TasksTab targetType="shidduch" targetId={1} />
          </div>
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await expect.element(screen.getByText("Task 3")).toBeInTheDocument();
    const boxes = Array.from(
      screen.container.querySelectorAll<HTMLElement>('[role="checkbox"]'),
    );
    expect(boxes.length).toBe(3);
    return { screen, boxes };
  };

  it("answers a tap 12px outside its own 16px box, on all four sides", async () => {
    // Arrange
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    const { boxes } = await renderThreeMinimalTasks();
    const target = boxes[1];
    const rect = target.getBoundingClientRect();

    // Assert — the control itself must stay small (enlarging it would turn a
    // reading list into a form); it is the HIT area that grows.
    expect(rect.width).toBeLessThan(24);
    const midX = rect.left + rect.width / 2;
    const midY = rect.top + rect.height / 2;
    for (const [x, y] of [
      [midX, rect.top - TOUCH_PROBE_PX],
      [midX, rect.bottom + TOUCH_PROBE_PX],
      [rect.left - TOUCH_PROBE_PX, midY],
      [rect.right + TOUCH_PROBE_PX, midY],
    ] as const) {
      expect(hitTestedAt(x, y)).toBe(target);
    }
  });

  it("never lets one row's enlarged target steal a tap meant for its neighbour", async () => {
    // Arrange — the collision this fix has to avoid, and the reason the row's
    // `min-h-11` and the checkbox's hit extension are one decision: at
    // `gap-2` alone, two 28px rows put their checkboxes ~36px apart, closer
    // than the 44px targets are wide, and the LOWER row wins the seam.
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    const { boxes } = await renderThreeMinimalTasks();

    // Assert
    for (let index = 0; index < boxes.length - 1; index += 1) {
      const rect = boxes[index].getBoundingClientRect();
      const nextRect = boxes[index + 1].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      expect(hitTestedAt(midX, rect.bottom + TOUCH_PROBE_PX)).toBe(
        boxes[index],
      );
      expect(hitTestedAt(midX, nextRect.top - TOUCH_PROBE_PX)).toBe(
        boxes[index + 1],
      );
    }
  });
});

describe("RelatedRecordsTab — the rows look like the links they are", () => {
  const LINK_RESOURCE = "mobile-affordance-link-target";

  afterEach(async () => {
    await page.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
  });

  const renderTwoRelatedRows = async () => {
    registerEntityDescriptor(
      {
        name: LINK_RESOURCE,
        label: "Link target",
        buildRecordPath: (id) => `/${LINK_RESOURCE}/${id}`,
      } satisfies EntityDescriptor,
      { replace: true },
    );
    const relationship: EntityRelationshipDescriptor = {
      key: "shidduchim",
      resource: "reference_links_summary",
      getFilter: (record) => ({ reference_id: record.id }),
      linkResource: LINK_RESOURCE,
      linkId: (row) => row.shidduchim_id,
      linkLabel: (row) => row.shidduch_name_en,
    };
    const dataProvider = {
      getList: vi.fn().mockResolvedValue({
        data: [
          { id: 101, shidduchim_id: 1, shidduch_name_en: "Ari & Shira" },
          { id: 102, shidduchim_id: 2, shidduch_name_en: "Moshe & Rivka" },
        ],
        total: 2,
      }),
    } as unknown as DataProvider;

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <ResourceContextProvider value="mobile-affordance-subject">
            <RecordContextProvider value={{ id: 7 }}>
              <RelatedRecordsTab relationship={relationship} />
            </RecordContextProvider>
          </ResourceContextProvider>
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await expect.element(screen.getByText("Ari & Shira")).toBeInTheDocument();
    const anchors = Array.from(screen.container.querySelectorAll("a"));
    expect(anchors.length).toBe(2);
    return { screen, anchors };
  };

  it("underlines the row and colours it differently from surrounding text", async () => {
    // Arrange
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    const { screen, anchors } = await renderTwoRelatedRows();

    // Act
    const anchorStyle = getComputedStyle(anchors[0]);
    const bodyStyle = getComputedStyle(
      screen.container.querySelector("ul") as HTMLElement,
    );

    // Assert — a `RecordLink` with no `className` inherits both of these
    // from its parent, which is exactly how these rows read as static text.
    expect(anchorStyle.textDecorationLine).toContain("underline");
    expect(anchorStyle.color).not.toBe(bodyStyle.color);
  });

  it("gives each row a 44px height so two adjacent rows are not two 20px targets", async () => {
    // Arrange
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);

    // Act
    const { anchors } = await renderTwoRelatedRows();

    // Assert
    for (const anchor of anchors) {
      expect(anchor.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });
});

describe("OverviewFactGrid — one column on a phone, more when there is room", () => {
  afterEach(async () => {
    await page.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
  });

  /** Bilingual facts, since an English value beside its `dir="rtl"` Hebrew on
   * one baseline row is what a ~152px column was wrapping to four lines. */
  const renderFacts = async (containerWidthPx: number) => {
    const screen = await render(
      // No provider: `OverviewFactGrid` takes already-translated labels and
      // does no i18n of its own (see its own doc comment).
      <div style={{ width: `${containerWidthPx}px` }}>
        <OverviewFactGrid
          emptyLabel="Nothing recorded yet."
          facts={[
            { label: "Yeshiva", en: "Mir Yerushalayim", he: "מיר ירושלים" },
            { label: "Seminary", en: "Bnos Chava", he: "בנות חוה" },
            { label: "Age", plain: "23" },
          ]}
        />
      </div>,
    );
    const cells = Array.from(
      screen.container.querySelectorAll<HTMLElement>("dt"),
    );
    expect(cells.length).toBe(3);
    return cells;
  };

  /** Distinct rounded `left` offsets = rendered columns. */
  const columnCount = (cells: HTMLElement[]): number =>
    new Set(cells.map((cell) => Math.round(cell.getBoundingClientRect().left)))
      .size;

  it("stacks to a single full-width column at 360px", async () => {
    // Arrange
    await page.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);

    // Act
    const cells = await renderFacts(360);

    // Assert
    expect(columnCount(cells)).toBe(1);
  });

  it("still uses the wide layout when there is room for it", async () => {
    // Arrange
    await page.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);

    // Act
    const cells = await renderFacts(1024);

    // Assert — the mobile-first rewrite must not have cost the desktop
    // density it was meant to preserve.
    expect(columnCount(cells)).toBe(3);
  });
});
