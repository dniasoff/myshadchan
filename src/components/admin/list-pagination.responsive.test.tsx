import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "@vitest/browser/context";
import { CoreAdminContext, ListBase, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

// Real flexbox geometry (wrapping, bounding rects) — meaningless without the
// Tailwind-generated stylesheet actually applying to the rendered classes.
// Deliberately a separate file from list-pagination.test.tsx: with the real
// stylesheet loaded, the rows-per-page block's `hidden md:flex` genuinely
// disappears below 768px, which that suite's text assertions do not expect.
import "@/index.css";

import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import { ListPagination } from "./list-pagination";

/**
 * The failure this pins is the one TopToolbar.tsx already wrote up: a
 * `justify-end` row that cannot wrap pushes its overflow off the LEFT edge,
 * where the page cannot be scrolled to reach it. The control is rendered,
 * visible and enabled — and untappable. On a list of any length that is the
 * "previous page" link, so a parent on a phone can page forward and never
 * back.
 */
const ROW_COUNT_PER_PAGE = 20;
const TOTAL_ROWS = 240; // twelve pages — enough links to overflow a phone

/** 44px is the floor the `min-h-11 md:min-h-<desktop>` idiom exists to hold. */
const MIN_TOUCH_TARGET_PX = 44;

const PHONE = { width: 375, height: 720 } as const;

/** What the rest of the browser suite expects going in — restored after every
 * test so none of these depends on another's viewport
 * (.claude/rules/testing.md#Test-isolation). */
const DESKTOP = { width: 1280, height: 720 } as const;

function providerFor(total: number): DataProvider {
  const rows = Array.from({ length: total }, (_, index) => ({
    id: index + 1,
    body: `row ${index}`,
  }));

  return {
    getList: vi.fn(
      (
        _resource: string,
        params: { pagination: { page: number; perPage: number } },
      ) => {
        const { page: pageNumber, perPage } = params.pagination;
        const start = (pageNumber - 1) * perPage;
        return Promise.resolve({
          data: rows.slice(start, start + perPage),
          total,
        });
      },
    ),
  } as unknown as DataProvider;
}

const renderPagination = () =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={providerFor(TOTAL_ROWS)}
        i18nProvider={testI18nProvider}
      >
        <ListBase
          resource="interactions"
          disableSyncWithLocation
          perPage={ROW_COUNT_PER_PAGE}
        >
          <ListPagination rowsPerPageOptions={[20, 50]} />
        </ListBase>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

/** The row ListPagination renders: the pagination nav's own parent. */
const paginationRow = (container: HTMLElement) => {
  const nav = container.querySelector(
    'nav[aria-label="pagination"]',
  ) as HTMLElement;
  return { nav, row: nav.parentElement as HTMLElement };
};

describe("ListPagination on a narrow viewport", () => {
  afterEach(async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
  });

  it("keeps every pager control inside the viewport at 375px", async () => {
    // Arrange
    await page.viewport(PHONE.width, PHONE.height);

    // Act
    const screen = await renderPagination();
    await expect
      .element(screen.getByRole("link", { name: "Next" }))
      .toBeVisible();
    const { nav, row } = paginationRow(screen.container);

    // Assert — every item, not only the anchors: on page 1 the leftmost item
    // is the inert "previous" placeholder, and it is exactly the slot that
    // holds a real, tappable Previous link on every later page. Measured
    // pre-fix, that item sat at x=-45..-1. `left >= 0` is the load-bearing
    // half of this: overflow to the right can at least be scrolled to.
    const items = Array.from(nav.querySelectorAll<HTMLElement>("li"));
    expect(items.length).toBeGreaterThan(1);
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(PHONE.width);
    }
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);

    // …and the row itself wrapped, giving the pager the full width instead of
    // squeezing it into whatever the range text left over.
    const rangeText = nav.previousElementSibling as HTMLElement;
    expect(nav.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      rangeText.getBoundingClientRect().bottom,
    );
  });

  it("gives each page link a 44px touch target at 375px", async () => {
    // Arrange
    await page.viewport(PHONE.width, PHONE.height);

    // Act
    const screen = await renderPagination();
    await expect
      .element(screen.getByRole("link", { name: "Next" }))
      .toBeVisible();
    const { row } = paginationRow(screen.container);

    // Assert — the links are `buttonVariants({ size: "icon" })`, so this is
    // the ui/button.tsx floor arriving through PaginationLink.
    const links = Array.from(
      row.querySelectorAll<HTMLElement>('a[data-slot="pagination-link"]'),
    );
    for (const link of links) {
      const rect = link.getBoundingClientRect();
      expect(rect.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
      expect(rect.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    }
  });

  it("still lays the whole row out on one line at 1280px", async () => {
    // Arrange — the pair that keeps the wrap honest: `flex-wrap` must be what
    // narrow viewports need, not a permanent second row on the desktop list.
    await page.viewport(DESKTOP.width, DESKTOP.height);

    // Act
    const screen = await renderPagination();
    await expect
      .element(screen.getByRole("link", { name: "Next" }))
      .toBeVisible();
    const { nav, row } = paginationRow(screen.container);

    // Assert — one row's worth of height, and the nav sits at the right-hand
    // end of it, as `justify-end` intends.
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(48);
    expect(nav.getBoundingClientRect().right).toBeCloseTo(
      row.getBoundingClientRect().right,
      0,
    );
  });
});
