import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, memoryStore, TestMemoryRouter } from "ra-core";
import type { Store } from "ra-core";
import { QueryClient } from "@tanstack/react-query";
import fakeDataProvider from "ra-data-fakerest";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { MY_PERSONAS_QUERY_KEY } from "../root/useMyPersonas";
import type { MyPersona } from "../types";
// Side-effect import — registers the real `singles` descriptor so
// SingleCard's RecordLink resolves a real href instead of degrading to a
// plain span (entity360/RecordLink.tsx).
import "./entityDescriptor";

import { SingleList } from "./SingleList";

const SINGLES = [
  { id: 1, first_name_en: "Chaim", last_name_en: "Cohen", status: "active" },
  { id: 2, first_name_en: "Devorah", last_name_en: "Levi", status: "active" },
];

// Story 6.5 (AC 4): SingleList branches its subtitle/empty-state copy on
// `useMyPersonas()`. Every pre-existing test below renders under this
// PARENT persona (the pre-6.5 default reader), so none of them go red from
// the copy change — only the two dedicated persona-branching tests further
// down override it.
const PARENT_PERSONA: MyPersona = {
  persona: "parent",
  account_id: 1,
  account_kind: "household",
  role: "parent_admin",
};

/**
 * `CoreAdminContext`'s own `store` prop defaults to a module-level
 * `memoryStore()` singleton (`ra-core/src/core/CoreAdminContext.tsx`) shared
 * by every instance that does not pass one explicitly — so two tests in this
 * file that both flip the persisted List/Cards mode would otherwise leak
 * state across each other (`.claude/rules/testing.md`'s test-isolation
 * rule). Every render below gets its own fresh store for exactly that
 * reason.
 *
 * `personas`/`singles` are overridable (Story 6.5): the QueryClient is
 * pre-seeded with `MY_PERSONAS_QUERY_KEY` (PersonasSection.test.tsx's own
 * pattern) so `SingleList`'s persona branch resolves on the FIRST paint, and
 * `getMyPersonas` is also wired on the dataProvider so a react-query
 * background refetch (default `staleTime` 0) resolves to the same value
 * rather than erroring against `ra-data-fakerest`'s generic provider, which
 * has no such method.
 */
const renderSingleList = (
  store: Store = memoryStore(),
  { personas = [PARENT_PERSONA], singles = SINGLES } = {} as {
    personas?: MyPersona[];
    singles?: typeof SINGLES;
  },
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(MY_PERSONAS_QUERY_KEY, personas);

  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        store={store}
        queryClient={queryClient}
        dataProvider={{
          ...fakeDataProvider({
            singles,
            singles_summary: singles.map((single) => ({
              ...single,
              total_shidduchim: 0,
              open_shidduchim: 0,
            })),
          }),
          getMyPersonas: async () => personas,
        }}
        i18nProvider={testI18nProvider}
      >
        <SingleList />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

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

// Story 6.5 (AC 4): "Every string shown when the `single` persona is held
// without `parent` must not imply a second person is being managed." Both
// the subtitle (always visible) and the empty-state description (visible
// once the household's own singles list is empty) presumed a parent reading
// them on behalf of someone else — branched here on the personas HELD
// (`useMyPersonas()`), never on `useViewerRole()` alone.
describe("SingleList — self-manager copy branch (Story 6.5, AC 4)", () => {
  const SELF_MANAGER_PERSONA: MyPersona = {
    persona: "single",
    account_id: 1,
    account_kind: "household",
    role: "self_manager",
  };

  it("shows the self-referential subtitle/empty copy for a viewer who holds ONLY the single persona (a self-manager)", async () => {
    // Arrange / Act
    const screen = await renderSingleList(undefined, {
      personas: [SELF_MANAGER_PERSONA],
      singles: [],
    });

    // Assert — the self-managed subtitle renders, never the parent-shaped one.
    await expect
      .element(
        screen.getByText("Your own shidduchim pipeline, all in one place."),
      )
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          "Every single you are redting for, each with their own pipeline.",
        ),
      )
      .not.toBeInTheDocument();

    // Assert — the empty-state description is the self-referential one too,
    // never the "person you are redting for" phrasing.
    await expect
      .element(
        screen.getByText(
          "This is where your own shidduchim pipeline will live. Add your record to start tracking suggestions.",
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          "A shidduchim pipeline belongs to a single — the person you are redting for. Add a single to start tracking suggestions.",
        ),
      )
      .not.toBeInTheDocument();
  });

  it("keeps the parent-shaped copy for a self-manager who ALSO holds the parent persona (legitimately manages other singles too)", async () => {
    // Arrange / Act — Dev Notes: "a self-manager who is also a helper
    // elsewhere" generalizes to "also a parent" here — holding BOTH personas
    // must not flip to the self-referential copy, or a real parent reading
    // about their OTHER singles would see the wrong phrasing.
    const screen = await renderSingleList(undefined, {
      personas: [SELF_MANAGER_PERSONA, PARENT_PERSONA],
    });

    // Assert
    await expect
      .element(
        screen.getByText(
          "Every single you are redting for, each with their own pipeline.",
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByText("Your own shidduchim pipeline, all in one place."),
      )
      .not.toBeInTheDocument();
  });

  it("keeps the parent-shaped copy for a viewer holding NEITHER persona (e.g. a helper) — a future regression should fail toward the safer, already-shipped default", async () => {
    // Arrange / Act
    const screen = await renderSingleList(undefined, { personas: [] });

    // Assert
    await expect
      .element(
        screen.getByText(
          "Every single you are redting for, each with their own pipeline.",
        ),
      )
      .toBeInTheDocument();
  });
});
