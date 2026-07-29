import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, memoryStore, TestMemoryRouter } from "ra-core";
import type { Store } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { testI18nProvider } from "../providers/commons/i18nProvider";
// Side-effect import — registers the real `singles` descriptor so
// SingleCard's RecordLink resolves a real href instead of degrading to a
// plain span (entity360/RecordLink.tsx).
import "./entityDescriptor";

import { SingleList } from "./SingleList";

const SINGLES = [
  { id: 1, first_name_en: "Chaim", last_name_en: "Cohen", status: "active" },
  { id: 2, first_name_en: "Devorah", last_name_en: "Levi", status: "active" },
];

/**
 * `CoreAdminContext`'s own `store` prop defaults to a module-level
 * `memoryStore()` singleton (`ra-core/src/core/CoreAdminContext.tsx`) shared
 * by every instance that does not pass one explicitly — so two tests in this
 * file that both flip the persisted List/Cards mode would otherwise leak
 * state across each other (`.claude/rules/testing.md`'s test-isolation
 * rule). Every render below gets its own fresh store for exactly that
 * reason.
 */
const renderSingleList = (store: Store = memoryStore()) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext
        store={store}
        dataProvider={fakeDataProvider({
          singles: SINGLES,
          singles_summary: SINGLES.map((single) => ({
            ...single,
            total_shidduchim: 0,
            open_shidduchim: 0,
          })),
        })}
        i18nProvider={testI18nProvider}
      >
        <SingleList />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("SingleList — retrofitted onto EntityList, search filters the roster (AC 3, 4)", () => {
  it("shows every single, then only the matching one once a search term is typed", async () => {
    // Arrange
    const screen = await renderSingleList();
    await expect.element(screen.getByText("Chaim Cohen")).toBeInTheDocument();
    await expect.element(screen.getByText("Devorah Levi")).toBeInTheDocument();

    // Act
    await screen.getByPlaceholder("Search by name").fill("Devorah");

    // Assert
    await expect.element(screen.getByText("Devorah Levi")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Chaim Cohen"))
      .not.toBeInTheDocument();
  });

  // Review fix (F8): `EntityListToolbar` only renders `<FilterButton/>` when
  // `extraFilters` is non-empty (Task 3's literal instruction) — SingleList
  // passes none, so no "Add filter" control should ever appear, including
  // once the always-on search box has a value (`FilterButton`'s own guard
  // un-hides on any active filter value, `q` included, which is exactly
  // what used to pop an "Add filter" dropdown open mid-typing).
  it("never shows an 'Add filter' control — SingleList has no extraFilters (AC 1, F8)", async () => {
    // Arrange
    const screen = await renderSingleList();
    await screen.getByPlaceholder("Search by name").fill("Devorah");
    await expect.element(screen.getByText("Devorah Levi")).toBeInTheDocument();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Add filter" }))
      .not.toBeInTheDocument();
  });

  // Review fix (F3): `@/components/admin/list`'s `ListView` renders its
  // title/actions row and `<FilterForm/>` (the always-on search box) BEFORE
  // its `children` — a real render showed the page heading landing below
  // the search box and the create CTA. `EntityList` now renders
  // `EntityListHeader` ahead of `<List>` instead of inside it; assert the
  // DOM order directly rather than mere presence, since presence-only
  // assertions are exactly what let this regression through green.
  it("renders the page heading ahead of the search box and the create CTA (F3)", async () => {
    // Arrange
    const screen = await renderSingleList();

    // Act
    const heading = screen.getByRole("heading", { name: "Singles" }).element();
    const searchInput = screen.getByPlaceholder("Search by name").element();
    const createLink = screen
      .getByRole("link", { name: "Add a single" })
      .element();

    // Assert — DOCUMENT_POSITION_FOLLOWING means the compared node comes
    // AFTER the node compareDocumentPosition was called on.
    expect(
      heading.compareDocumentPosition(searchInput) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      heading.compareDocumentPosition(createLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Adversarial-review fix (Story 4.2, AC 1): `EntityList.test.tsx` only
  // ever exercised `renderList`/`renderCards` through throwaway fixture
  // renderers, so nothing in the tree noticed if `SingleList` itself passed
  // the same renderer to both props — swapping `SingleRowList` for
  // `SingleCardGrid` on both `renderList`/`renderCards` left the whole
  // suite green. `SingleCard` and `SingleRow` render identical wording (both
  // say "N in pipeline"), so — this project does not load Tailwind's
  // stylesheet (`vitest.config.ts`: only a test that imports `@/index.css`
  // gets real computed layout), so a height/layout measurement cannot tell
  // the two apart either — the one CSS-independent signal left is the class
  // *attribute string* itself: `SingleCardGrid`'s wrapper is literally
  // `grid grid-cols-1 ...`, `SingleRowList`'s is `flex flex-col gap-2`, and
  // `cn()`'s `twMerge` drops `SingleCard`'s inherited `flex-col` in favour of
  // `SingleRow`'s own `flex-row` override, so the two markers never overlap
  // on the same element.
  it("switching to List mode swaps in SingleRowList's markup, not the same card grid (AC 1)", async () => {
    // Arrange
    const screen = await renderSingleList();
    await expect.element(screen.getByText("Chaim Cohen")).toBeInTheDocument();
    expect(screen.container.querySelector(".grid.grid-cols-1")).not.toBeNull();
    expect(screen.container.querySelector(".flex-col.gap-2")).toBeNull();

    // Act
    await screen.getByRole("button", { name: "List view" }).click();
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "true");

    // Assert — the card grid's own marker is gone, the row list's is
    // present. If `renderList` still pointed at `SingleCardGrid`, this
    // would be unchanged.
    expect(screen.container.querySelector(".grid.grid-cols-1")).toBeNull();
    expect(screen.container.querySelector(".flex-col.gap-2")).not.toBeNull();
  });

  // Adversarial-review fix (Story 4.2, AC 2): the toggle's position relative
  // to the create link was only ever eyeballed, never asserted — moving
  // `{viewToggle}` after the create link in `EntityListToolbar` left the
  // whole suite green. Same `compareDocumentPosition` pattern as the
  // heading-order test above.
  it("renders the List/Cards toggle immediately before the create link (AC 2)", async () => {
    // Arrange / Act
    const screen = await renderSingleList();
    const toggleButton = screen
      .getByRole("button", { name: "Cards view" })
      .element();
    const createLink = screen
      .getByRole("link", { name: "Add a single" })
      .element();

    // Assert
    expect(
      toggleButton.compareDocumentPosition(createLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Adversarial-review fix (Story 4.2, AC 1): the Dev Notes' claim that
  // Cards stays this roster's first-visit default was never actually
  // asserted anywhere — flipping `defaultViewMode` to `"list"` left the
  // whole suite green.
  it("defaults to Cards mode on a fresh visit, never List (AC 1)", async () => {
    // Arrange / Act
    const screen = await renderSingleList();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Cards view" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "false");
  });
});
