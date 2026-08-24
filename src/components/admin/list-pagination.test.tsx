import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, ListBase, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import { ListPagination } from "./list-pagination";

/**
 * The pagination furniture is three separate controls — a rows-per-page
 * select, an "N-M of T" range, and prev/page/next links — and every one of
 * them is inert when the whole result set fits on one page. It used to
 * render anyway: a shidduch's Activity tab with a single note printed
 * "Rows per page: 20 · 1-1 of 1 · ‹ 1 ›" beneath it, three dead controls
 * taking more vertical space than the note they belonged to.
 *
 * These tests pin both directions, because only the pair is evidence: a
 * component that returned `null` unconditionally would satisfy the hiding
 * test alone.
 */
const ROW_COUNT_PER_PAGE = 20;

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
        const { page, perPage } = params.pagination;
        const start = (page - 1) * perPage;
        return Promise.resolve({
          data: rows.slice(start, start + perPage),
          total,
        });
      },
    ),
  } as unknown as DataProvider;
}

const renderList = (total: number) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={providerFor(total)}
        i18nProvider={testI18nProvider}
      >
        <ListBase
          resource="interactions"
          disableSyncWithLocation
          perPage={ROW_COUNT_PER_PAGE}
        >
          <p>rendered</p>
          <ListPagination rowsPerPageOptions={[20, 50]} />
        </ListBase>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ListPagination", () => {
  it("renders nothing when every row already fits on one page", async () => {
    // Arrange / Act — one row, twenty per page: no previous, no next.
    const screen = await renderList(1);
    await expect.element(screen.getByText("rendered")).toBeVisible();

    // Assert — all three controls gone, not merely the arrows.
    expect(screen.getByText("Rows per page").query()).toBeNull();
    expect(screen.getByText("1-1 of 1").query()).toBeNull();
    expect(screen.getByRole("link", { name: "Next" }).query()).toBeNull();
  });

  it("renders nothing when the row count exactly fills the single page", async () => {
    // Arrange / Act — the boundary: 20 rows at 20 per page is still one page,
    // and an off-by-one here would put an inert "Next" on every full list.
    const screen = await renderList(ROW_COUNT_PER_PAGE);
    await expect.element(screen.getByText("rendered")).toBeVisible();

    // Assert
    expect(screen.getByRole("link", { name: "Next" }).query()).toBeNull();
    expect(screen.getByText("Rows per page").query()).toBeNull();
  });

  it("still renders the full controls as soon as a second page exists", async () => {
    // Arrange / Act — 21 rows at 20 per page.
    const screen = await renderList(ROW_COUNT_PER_PAGE + 1);

    // Assert — the hiding above is a condition, not an unconditional null.
    await expect
      .element(screen.getByRole("link", { name: "Next" }))
      .toBeVisible();
    await expect.element(screen.getByText("Rows per page")).toBeVisible();
    await expect.element(screen.getByText("1-20 of 21")).toBeVisible();
  });

  it("keeps the controls on the last page, where only 'previous' is available", async () => {
    // Arrange — page 2 of 2. `hasNextPage` is false there, so a guard written
    // as `!hasNextPage` alone would strand the reader with no way back.
    const screen = await renderList(ROW_COUNT_PER_PAGE + 1);
    await expect
      .element(screen.getByRole("link", { name: "Next" }))
      .toBeVisible();

    // Act
    await screen.getByRole("link", { name: "Next" }).click();

    // Assert
    await expect
      .element(screen.getByRole("link", { name: "Previous" }))
      .toBeVisible();
  });
});
