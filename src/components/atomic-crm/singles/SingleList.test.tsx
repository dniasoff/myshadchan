import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
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

const renderSingleList = () =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext
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
});
