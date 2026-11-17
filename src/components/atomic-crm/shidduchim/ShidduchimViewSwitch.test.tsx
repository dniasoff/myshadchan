import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import {
  CoreAdminContext,
  ListContextProvider,
  memoryStore,
  TestMemoryRouter,
} from "ra-core";
import type { ListControllerResult, Store } from "ra-core";

// Real Tailwind, so the touch-target test below measures the rendered box
// rather than an unstyled one.
import "@/index.css";

// Side-effect import — registers the "shidduchim" entity descriptor
// (RecordLink / buildNewPath used deep inside the pipeline list).
import "./entityDescriptor";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { ShidduchSummary } from "../types";
import { PIPELINE_STATES } from "./pipelineStates";
import { ShidduchimViewSwitch } from "./ShidduchimViewSwitch";

const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const;
const PAGE_VIEW_STORE_KEY = "shidduchim.pageView.v2";
const LEGACY_PAGE_VIEW_STORE_KEY = "shidduchim.pageView";

/** At least one shidduch so the pipeline list actually renders sections
 * instead of its own "genuinely empty" EmptyState (ShidduchimPipelineList.tsx). */
const FIXTURE_DATA: ShidduchSummary[] = [
  {
    id: 1,
    account_id: 1,
    single_id: 10,
    pipeline_state: "new",
    first_suggested_at: "2026-01-01T00:00:00Z",
    redt_date: "2026-01-02T00:00:00Z",
    origin: "manual",
    visibility: "shared",
    index: 0,
    created_at: "2026-01-01T00:00:00Z",
    name_en: "Chaim Cohen",
  },
];

const buildListContextValue = (
  overrides: Partial<ListControllerResult>,
): ListControllerResult =>
  ({
    data: FIXTURE_DATA,
    total: FIXTURE_DATA.length,
    isPending: false,
    isFetching: false,
    isLoading: false,
    error: null,
    page: 1,
    perPage: 200,
    sort: { field: "index", order: "ASC" },
    filterValues: { single_id: 10 },
    displayedFilters: {},
    selectedIds: [],
    resource: "shidduchim",
    refetch: vi.fn(),
    setFilters: vi.fn(),
    setPage: vi.fn(),
    setPerPage: vi.fn(),
    setSort: vi.fn(),
    showFilter: vi.fn(),
    hideFilter: vi.fn(),
    onSelect: vi.fn(),
    onSelectAll: vi.fn(),
    onToggleItem: vi.fn(),
    onUnselectItems: vi.fn(),
    ...overrides,
  }) as unknown as ListControllerResult;

type SwitchTestAppProps = {
  overrides?: Partial<ListControllerResult>;
  store: Store;
  viewKey?: number;
};

const SwitchTestApp = ({
  overrides = {},
  store,
  viewKey = 0,
}: SwitchTestAppProps) => {
  const dataProvider = {
    transitionShidduch: vi.fn().mockResolvedValue({}),
  } as unknown as CrmDataProvider;

  return (
    <TestMemoryRouter>
      <CoreAdminContext
        store={store}
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ListContextProvider value={buildListContextValue(overrides)}>
          <ShidduchimViewSwitch key={viewKey} />
        </ListContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>
  );
};

const renderSwitch = (
  overrides: Partial<ListControllerResult> = {},
  store: Store = memoryStore(),
) => render(<SwitchTestApp overrides={overrides} store={store} />);

const mockMatchMedia = (matches: boolean) => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList,
  );
};

/**
 * Captures the DOM as of the FIRST commit: a layout effect runs during the
 * commit, before any passive effect — so it verifies the default position is
 * already the List on the first paint.
 */
const FirstCommitProbe = ({
  onCommit,
}: {
  onCommit: (html: string) => void;
}) => {
  useLayoutEffect(() => {
    onCommit(document.body.innerHTML);
  }, [onCommit]);
  return null;
};

describe("ShidduchimViewSwitch — one three-position control (AC-1, AC-2, AC-5, AC-6)", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
  });

  it("renders the pipeline list, not the Board, when the store is seeded 'list'", async () => {
    // Arrange / Act
    const screen = await renderSwitch(
      {},
      memoryStore({ [PAGE_VIEW_STORE_KEY]: "list" }),
    );

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("region", { name: "New", exact: true }))
      .toBeInTheDocument();
  });

  it("renders the pipeline list, not the Board, when the store is seeded 'cards'", async () => {
    // Arrange / Act
    const screen = await renderSwitch(
      {},
      memoryStore({ [PAGE_VIEW_STORE_KEY]: "cards" }),
    );

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Cards view" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("region", { name: "New", exact: true }))
      .toBeInTheDocument();
  });

  it("renders the Board, not the pipeline list, when the store is seeded 'board'", async () => {
    // Arrange / Act
    const screen = await renderSwitch(
      {},
      memoryStore({ [PAGE_VIEW_STORE_KEY]: "board" }),
    );

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Board view" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("region", { name: "New", exact: true }))
      .not.toBeInTheDocument();
  });

  it("ignores a legacy Board choice and defaults to List", async () => {
    // Arrange — the v2 key deliberately does not read the old persisted choice.
    mockMatchMedia(false);
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);

    // Act
    const screen = await renderSwitch(
      {},
      memoryStore({ [LEGACY_PAGE_VIEW_STORE_KEY]: "board" }),
    );

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("button", { name: "Board view" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("defaults to 'list' under a mobile viewport when nothing is stored yet", async () => {
    // Arrange
    mockMatchMedia(true);
    await page.viewport(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);

    // Act
    const screen = await renderSwitch();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("defaults to 'list' at a desktop viewport when nothing is stored yet", async () => {
    // Arrange
    mockMatchMedia(false);
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);

    // Act
    const screen = await renderSwitch();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("persists an explicit view choice under the new key and honors it after remount", async () => {
    // Arrange — an explicit Board pick is still available at every viewport.
    mockMatchMedia(false);
    const store = memoryStore();
    const firstScreen = await renderSwitch({}, store);

    // Act
    await firstScreen.getByRole("button", { name: "Board view" }).click();

    // Assert — all three controls retain their accessible labels and pressed state.
    await expect
      .element(firstScreen.getByRole("button", { name: "Board view" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(firstScreen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "false");
    await expect
      .element(firstScreen.getByRole("button", { name: "Cards view" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(store.getItem(PAGE_VIEW_STORE_KEY, undefined)).toBe("board");

    // Act — remount the switch with the same store and context.
    await firstScreen.rerender(<SwitchTestApp store={store} viewKey={1} />);

    // Assert
    await expect
      .element(firstScreen.getByRole("button", { name: "Board view" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("paints the list on its FIRST commit at a mobile viewport — never a frame of the Board", async () => {
    // Arrange — this pins the first-paint default at a phone viewport while
    // matchMedia reports the mobile branch.
    await page.viewport(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);
    mockMatchMedia(true);
    let firstCommitHtml: string | null = null;
    const capture = (html: string) => {
      firstCommitHtml ??= html;
    };

    // Act
    await render(
      <TestMemoryRouter>
        <CoreAdminContext
          store={memoryStore()}
          dataProvider={{} as unknown as CrmDataProvider}
          i18nProvider={testI18nProvider}
        >
          <ListContextProvider value={buildListContextValue({})}>
            <ShidduchimViewSwitch />
            <FirstCommitProbe onCommit={capture} />
          </ListContextProvider>
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert — the pipeline list's own sections were in the very first
    // commit, and the Board's drag-and-drop droppables never were.
    expect(firstCommitHtml).toContain('data-slot="pipeline-section"');
    expect(firstCommitHtml).not.toContain("data-rbd-droppable-id");
  });

  it("keeps the three view buttons at the 44px touch floor on a phone", async () => {
    // Arrange — one render per test: two mounted copies of the switch make
    // the role query ambiguous.
    await page.viewport(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);

    // Act
    const screen = await renderSwitch(
      {},
      memoryStore({ [PAGE_VIEW_STORE_KEY]: "list" }),
    );
    const box = screen
      .getByRole("button", { name: "List view" })
      .element()
      .getBoundingClientRect();

    // Assert — `size="icon"` is a flat 36px, so the floor `button.tsx` gives
    // its `default` size has to be re-applied at this call site.
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  });

  it("keeps the view buttons compact at a laptop width", async () => {
    // Arrange
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);

    // Act
    const screen = await renderSwitch(
      {},
      memoryStore({ [PAGE_VIEW_STORE_KEY]: "list" }),
    );
    const box = screen
      .getByRole("button", { name: "List view" })
      .element()
      .getBoundingClientRect();

    // Assert
    expect(box.height).toBeLessThan(44);
  });

  it("renders the shared error state — never Board or the pipeline list — regardless of the stored view", async () => {
    // Arrange
    const refetch = vi.fn();

    // Act
    const screen = await renderSwitch(
      { error: new Error("boom"), refetch },
      memoryStore({ [PAGE_VIEW_STORE_KEY]: "board" }),
    );

    // Assert
    const retry = screen.getByRole("button", { name: "Try again" });
    await expect.element(retry).toBeInTheDocument();
    await expect
      .element(screen.getByRole("region", { name: "New", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Board view" }))
      .not.toBeInTheDocument();

    // Act
    await retry.click();

    // Assert
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders the shared loading skeleton — never the toggle or a position — while the list is pending (review fix F4)", async () => {
    // Arrange / Act — `isPending: true` regardless of the stored view; the
    // "board" seed proves the loading gate wins over the position choice,
    // not merely that the pipeline list happens to show a skeleton too.
    const screen = await renderSwitch(
      { isPending: true, data: undefined },
      memoryStore({ [PAGE_VIEW_STORE_KEY]: "board" }),
    );

    // Assert
    const sections = screen.container.querySelectorAll(
      '[data-slot="pipeline-section"]',
    );
    expect(sections.length).toBe(PIPELINE_STATES.length);
    await expect
      .element(screen.getByRole("button", { name: "Board view" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("region", { name: "New", exact: true }))
      .not.toBeInTheDocument();
  });
});
