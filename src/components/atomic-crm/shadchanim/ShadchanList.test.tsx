import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  memoryStore,
  TestMemoryRouter,
  useLocation,
} from "ra-core";
import type { Store } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { testI18nProvider } from "../providers/commons/i18nProvider";
// Side-effect import — registers the real `shadchanim` descriptor so
// ShadchanCard's RecordLink resolves a real href instead of degrading to a
// plain span (entity360/RecordLink.tsx).
import "./entityDescriptor";

import { ShadchanList } from "./ShadchanList";

const SHADCHANIM = [
  {
    id: 1,
    name: "Rivka Stern",
    responsiveness: "high",
    contacts: { phone: "+44 7700 900123" },
  },
  {
    id: 2,
    name: "Moshe Adler",
    responsiveness: "medium",
    contacts: { whatsapp: "+1 555 9001234" },
  },
];

const NOTE = {
  id: 22,
  account_id: 1,
  target_type: "shadchan" as const,
  target_id: 1,
  scope: "account" as const,
  kind: "note" as const,
  body: "Private body",
  created_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
};

const SEARCH_PLACEHOLDER = "Search by name, location, or phone number";

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="list-location">{location.search}</output>;
};

const waitForFilterDebounce = () =>
  new Promise((resolve) => setTimeout(resolve, 650));

const getStorageSnapshot = () =>
  Array.from({ length: localStorage.length }, (_, index) => [
    localStorage.key(index),
    localStorage.key(index)
      ? localStorage.getItem(localStorage.key(index) as string)
      : null,
  ]);

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
  options: {
    initialEntries?: string[];
    dataProvider?: ReturnType<typeof fakeDataProvider>;
  } = {},
) =>
  render(
    <TestMemoryRouter initialEntries={options.initialEntries}>
      <CoreAdminContext
        store={store}
        dataProvider={
          options.dataProvider ??
          fakeDataProvider({
            shadchanim: SHADCHANIM,
            shidduchim,
          })
        }
        i18nProvider={testI18nProvider}
      >
        <ShadchanList />
        <LocationProbe />
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
    await screen.getByPlaceholder(SEARCH_PLACEHOLDER).fill("Rivka");

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
    await screen.getByPlaceholder(SEARCH_PLACEHOLDER).fill("Rivka");
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
    const searchInput = screen.getByPlaceholder(SEARCH_PLACEHOLDER).element();
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
  // `renderCards` left the whole suite green.
  //
  // Story 5.9 (AD-23 remediation) pointed `ShadchanCard`'s count label at
  // the same i18n key `ShadchanRow` already used, so the two now render
  // IDENTICAL wording ("1 shidduch") — the wording difference this test
  // used to rely on as its distinguishing signal is gone. Mirrors
  // `singles/SingleList.test.tsx`'s identical case (`SingleCard`/`SingleRow`
  // always rendered identical wording): this project does not load
  // Tailwind's stylesheet (`vitest.config.ts`), so a computed-layout
  // measurement cannot tell the two apart either — the one CSS-independent
  // signal left is the class *attribute string* itself: `ShadchanCardGrid`'s
  // wrapper is literally `grid grid-cols-1 ...`, `ShadchanRowList`'s is
  // `flex flex-col gap-2`.
  it("switching to List mode swaps in ShadchanRowList's markup, not the same card grid (AC 1, AC 5)", async () => {
    // Arrange
    const screen = await renderShadchanList(memoryStore(), [
      { id: 1, shadchan_id: 1 },
    ]);
    await expect.element(screen.getByText("Rivka Stern")).toBeInTheDocument();
    await expect.element(screen.getByText("1 shidduch")).toBeInTheDocument();
    expect(screen.container.querySelector(".grid.grid-cols-1")).not.toBeNull();
    expect(screen.container.querySelector(".flex-col.gap-2")).toBeNull();

    // Act
    await screen.getByRole("button", { name: "List view" }).click();
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "true");

    // Assert — the card grid's own marker is gone, the row list's is
    // present. If `renderList` still pointed at `ShadchanCardGrid`, this
    // would be unchanged.
    expect(screen.container.querySelector(".grid.grid-cols-1")).toBeNull();
    expect(screen.container.querySelector(".flex-col.gap-2")).not.toBeNull();
    await expect.element(screen.getByText("1 shidduch")).toBeInTheDocument();
  });

  it("passes the batched note through to the row renderer", async () => {
    const dataProvider = fakeDataProvider({
      shadchanim: SHADCHANIM,
      shidduchim: [],
    });
    const baseGetList = dataProvider.getList.bind(dataProvider);
    vi.spyOn(dataProvider, "getList").mockImplementation(
      async (resource, params) => {
        if (resource === "interactions_summary") {
          return { data: [NOTE], total: 1 };
        }
        return baseGetList(resource, params);
      },
    );

    const screen = await renderShadchanList(memoryStore(), [], {
      dataProvider,
    });
    await screen.getByRole("button", { name: "List view" }).click();

    await expect
      .element(
        screen.getByRole("button", { name: "Open note for Rivka Stern" }),
      )
      .toBeInTheDocument();
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

  it("finds a formatted phone number locally and exposes the masked ending", async () => {
    // Arrange
    const screen = await renderShadchanList();

    // Act
    await screen.getByPlaceholder(SEARCH_PLACEHOLDER).fill("07700-900-123");

    // Assert
    await expect.element(screen.getByText("Rivka Stern")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Phone ending 0123"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Moshe Adler"))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Phone search active"))
      .toBeInTheDocument();
  });

  it("masks the matched stored suffix, not the raw query text", async () => {
    const dataProvider = fakeDataProvider({
      shadchanim: [
        { ...SHADCHANIM[0], contacts: { phone: "555-123-4567" } },
        SHADCHANIM[1],
      ],
      shidduchim: [],
    });
    const screen = await renderShadchanList(memoryStore(), [], {
      dataProvider,
    });

    await screen
      .getByPlaceholder(SEARCH_PLACEHOLDER)
      .fill("555-123-4567 ext: 99");

    // The extension is stripped before matching; the visible suffix must come
    // from the stored number that matched, never from the raw query string.
    await expect
      .element(screen.getByText("Phone ending 4567"))
      .toBeInTheDocument();
  });

  it("lists WhatsApp matches and shows the exact phone empty state", async () => {
    // Arrange
    const screen = await renderShadchanList();

    // Act
    await screen.getByPlaceholder(SEARCH_PLACEHOLDER).fill("9001234");

    // Assert
    await expect.element(screen.getByText("Moshe Adler")).toBeInTheDocument();
    await expect
      .element(screen.getByText("WhatsApp ending 1234"))
      .toBeInTheDocument();

    // Act — use a phone-shaped query with no saved match.
    await screen.getByPlaceholder(SEARCH_PLACEHOLDER).fill("9999");

    // Assert
    await expect
      .element(screen.getByText("No shadchan with that number"))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          "Try the last 4 or more digits, or check the number you entered.",
        ),
      )
      .toBeInTheDocument();
  });

  it("keeps one-to-three-digit input out of phone mode", async () => {
    // Arrange / Act
    const screen = await renderShadchanList();
    await screen.getByPlaceholder(SEARCH_PLACEHOLDER).fill("123");

    // Assert
    await expect
      .element(
        screen.getByText("Enter at least 4 digits to search by phone number."),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Phone search active"))
      .not.toBeInTheDocument();
  });

  it("keeps number-like keystrokes out of URL filters and provider calls", async () => {
    const dataProvider = fakeDataProvider({
      shadchanim: SHADCHANIM,
      shidduchim: [],
    });
    const getList = vi.spyOn(dataProvider, "getList");
    const screen = await renderShadchanList(memoryStore(), [], {
      dataProvider,
    });

    const search = screen.getByPlaceholder(SEARCH_PLACEHOLDER);
    await search.fill("7");
    await search.fill("71");
    await search.fill("718");

    await waitForFilterDebounce();

    expect(
      screen.getByTestId("list-location").element().textContent,
    ).not.toContain('"q"');
    expect(
      getList.mock.calls.some(
        ([resource, params]) =>
          resource === "shadchanim" &&
          typeof params.filter?.q === "string" &&
          params.filter.q.length > 0,
      ),
    ).toBe(false);
  });

  it("keeps pure and mixed phone queries ephemeral after the debounce", async () => {
    const dataProvider = fakeDataProvider({
      shadchanim: SHADCHANIM,
      shidduchim: [],
    });
    const getList = vi.spyOn(dataProvider, "getList");
    const screen = await renderShadchanList(memoryStore(), [], {
      dataProvider,
    });
    const search = screen.getByPlaceholder(SEARCH_PLACEHOLDER);
    const initialHistoryLength = window.history.length;
    const initialStorage = getStorageSnapshot();

    for (const query of ["7", "718", "718-555-0102", "Klein 718-555-0102"]) {
      await search.fill(query);
      await waitForFilterDebounce();

      expect(
        screen.getByTestId("list-location").element().textContent,
      ).not.toContain('"q"');
      expect(
        getList.mock.calls.some(
          ([resource, params]) =>
            resource === "shadchanim" &&
            typeof params.filter?.q === "string" &&
            params.filter.q.length > 0,
        ),
      ).toBe(false);
      expect(window.history.length).toBe(initialHistoryLength);
      expect(getStorageSnapshot()).toEqual(initialStorage);
    }

    // A pending ordinary-text write must be cancelled when phone mode starts.
    await search.fill("Klein");
    await search.fill("7185550102");
    await waitForFilterDebounce();
    expect(
      screen.getByTestId("list-location").element().textContent,
    ).not.toContain("Klein");
    expect(getStorageSnapshot()).toEqual(initialStorage);
  });

  it("debounces ordinary text into URL filters and provider calls", async () => {
    const dataProvider = fakeDataProvider({
      shadchanim: SHADCHANIM,
      shidduchim: [],
    });
    const getList = vi.spyOn(dataProvider, "getList");
    const screen = await renderShadchanList(memoryStore(), [], {
      dataProvider,
    });

    await screen.getByPlaceholder(SEARCH_PLACEHOLDER).fill("Rivka");
    expect(
      screen.getByTestId("list-location").element().textContent,
    ).not.toContain("Rivka");

    await waitForFilterDebounce();

    expect(screen.getByTestId("list-location").element().textContent).toContain(
      "Rivka",
    );
    expect(
      getList.mock.calls.some(
        ([resource, params]) =>
          resource === "shadchanim" && params.filter?.q === "Rivka",
      ),
    ).toBe(true);
  });

  it("clears a legacy short numeric q before displaying or reusing it", async () => {
    const legacyFilter = encodeURIComponent(JSON.stringify({ q: "718" }));
    const screen = await renderShadchanList(memoryStore(), [], {
      initialEntries: [`/shadchanim?filter=${legacyFilter}`],
    });

    await expect
      .element(screen.getByPlaceholder(SEARCH_PLACEHOLDER))
      .toHaveValue("");
    expect(
      screen.getByTestId("list-location").element().textContent,
    ).not.toContain("718");
  });

  it("clears legacy mixed phone queries before displaying or reusing them", async () => {
    const legacyFilter = encodeURIComponent(
      JSON.stringify({ q: "Klein 718-555-0102" }),
    );
    const dataProvider = fakeDataProvider({
      shadchanim: SHADCHANIM,
      shidduchim: [],
    });
    const getList = vi.spyOn(dataProvider, "getList");
    const initialHistoryLength = window.history.length;
    const initialStorage = getStorageSnapshot();
    const screen = await renderShadchanList(memoryStore(), [], {
      initialEntries: [`/shadchanim?filter=${legacyFilter}`],
      dataProvider,
    });

    await expect
      .element(screen.getByPlaceholder(SEARCH_PLACEHOLDER))
      .toHaveValue("");
    // The initial List controller may observe the legacy URL before the
    // search controller's first effect removes it. Assertions below cover all
    // calls made after that cleanup boundary.
    getList.mockClear();
    await waitForFilterDebounce();
    expect(
      screen.getByTestId("list-location").element().textContent,
    ).not.toContain("Klein");
    expect(window.history.length).toBe(initialHistoryLength);
    expect(getStorageSnapshot()).toEqual(initialStorage);
    expect(
      getList.mock.calls.some(
        ([resource, params]) =>
          resource === "shadchanim" &&
          typeof params.filter?.q === "string" &&
          params.filter.q.length > 0,
      ),
    ).toBe(false);
  });
});
