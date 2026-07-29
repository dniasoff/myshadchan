import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, memoryStore, TestMemoryRouter } from "ra-core";
import type { Store } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { testI18nProvider } from "../providers/commons/i18nProvider";
// Side-effect import — registers the real `shadchanim` descriptor so
// ShadchanCard's RecordLink resolves a real href instead of degrading to a
// plain span (entity360/RecordLink.tsx).
import "./entityDescriptor";

import { ShadchanList } from "./ShadchanList";

const SHADCHANIM = [
  { id: 1, name: "Rivka Stern", responsiveness: "high" },
  { id: 2, name: "Moshe Adler", responsiveness: "medium" },
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
const renderShadchanList = (
  store: Store = memoryStore(),
  shidduchim: { id: number; shadchan_id: number }[] = [],
) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext
        store={store}
        dataProvider={fakeDataProvider({
          shadchanim: SHADCHANIM,
          shidduchim,
        })}
        i18nProvider={testI18nProvider}
      >
        <ShadchanList />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ShadchanList — retrofitted onto EntityList, search filters the book (AC 3, 4)", () => {
  it("shows every shadchan, then only the matching one once a search term is typed", async () => {
    // Arrange
    const screen = await renderShadchanList();
    await expect.element(screen.getByText("Rivka Stern")).toBeInTheDocument();
    await expect.element(screen.getByText("Moshe Adler")).toBeInTheDocument();

    // Act
    await screen.getByPlaceholder("Search by name").fill("Rivka");

    // Assert
    await expect.element(screen.getByText("Rivka Stern")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Moshe Adler"))
      .not.toBeInTheDocument();
  });

  // Review fix (F8): see SingleList.test.tsx's identical case — ShadchanList
  // also passes no `extraFilters`, so `<FilterButton/>` must never appear,
  // including once the search box has a value.
  it("never shows an 'Add filter' control — ShadchanList has no extraFilters (AC 1, F8)", async () => {
    // Arrange
    const screen = await renderShadchanList();
    await screen.getByPlaceholder("Search by name").fill("Rivka");
    await expect.element(screen.getByText("Rivka Stern")).toBeInTheDocument();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Add filter" }))
      .not.toBeInTheDocument();
  });

  // Review fix (F3): see SingleList.test.tsx's identical case.
  it("renders the page heading ahead of the search box and the create CTA (F3)", async () => {
    // Arrange
    const screen = await renderShadchanList();

    // Act
    const heading = screen
      .getByRole("heading", { name: "Shadchanim" })
      .element();
    const searchInput = screen.getByPlaceholder("Search by name").element();
    const createLink = screen
      .getByRole("link", { name: "Add a shadchan" })
      .element();

    // Assert
    expect(
      heading.compareDocumentPosition(searchInput) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      heading.compareDocumentPosition(createLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Adversarial-review fix (Story 4.2, AC 1, AC 5): `EntityList.test.tsx`
  // only ever exercised `renderList`/`renderCards` through throwaway
  // fixture renderers, so nothing in the tree noticed if `ShadchanList`
  // itself passed the same renderer to both props — swapping
  // `ShadchanRowList` for `ShadchanCardGrid` on both `renderList`/
  // `renderCards` left the whole suite green. `ShadchanCard` and
  // `ShadchanRow` render the count with deliberately different wording
  // ("suggestion(s)" vs "shidduch(im)", AC 5), which doubles as an
  // unambiguous, non-CSS-coupled signal that the real row renderer — not a
  // second copy of the card renderer — is what mounted.
  it("switching to List mode swaps in ShadchanRow's AD-23 wording, not the same card grid (AC 1, AC 5)", async () => {
    // Arrange
    const screen = await renderShadchanList(memoryStore(), [
      { id: 1, shadchan_id: 1 },
    ]);
    await expect.element(screen.getByText("Rivka Stern")).toBeInTheDocument();
    await expect.element(screen.getByText("1 suggestion")).toBeInTheDocument();

    // Act
    await screen.getByRole("button", { name: "List view" }).click();
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "true");

    // Assert — the card renderer's wording is gone, the row renderer's is
    // present. If `renderList` still pointed at `ShadchanCardGrid`, "1
    // suggestion" would still be on screen and "1 shidduch" would not.
    await expect
      .element(screen.getByText("1 suggestion"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("1 shidduch")).toBeInTheDocument();
  });

  // Adversarial-review fix (Story 4.2, AC 2): the toggle's position relative
  // to the create link was only ever eyeballed, never asserted — moving
  // `{viewToggle}` after the create link in `EntityListToolbar` left the
  // whole suite green. Same `compareDocumentPosition` pattern as the
  // heading-order test above.
  it("renders the List/Cards toggle immediately before the create link (AC 2)", async () => {
    // Arrange / Act
    const screen = await renderShadchanList();
    const toggleButton = screen
      .getByRole("button", { name: "Cards view" })
      .element();
    const createLink = screen
      .getByRole("link", { name: "Add a shadchan" })
      .element();

    // Assert
    expect(
      toggleButton.compareDocumentPosition(createLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Adversarial-review fix (Story 4.2, AC 1): the Dev Notes' claim that
  // Cards stays this book's first-visit default was never actually
  // asserted anywhere — flipping `defaultViewMode` to `"list"` left the
  // whole suite green.
  it("defaults to Cards mode on a fresh visit, never List (AC 1)", async () => {
    // Arrange / Act
    const screen = await renderShadchanList();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Cards view" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "false");
  });
});
