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

const renderSwitch = (
  overrides: Partial<ListControllerResult> = {},
  store: Store = memoryStore(),
) => {
  const dataProvider = {
    transitionShidduch: vi.fn().mockResolvedValue({}),
  } as unknown as CrmDataProvider;

  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        store={store}
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ListContextProvider value={buildListContextValue(overrides)}>
          <ShidduchimViewSwitch />
        </ListContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

/**
 * Captures the DOM as of the FIRST commit: a layout effect runs during the
 * commit, before any passive effect — so it sees exactly what a phone would
 * paint for one frame. Once passive effects have flushed, an effect-resolved
 * viewport hook and a synchronous one agree, which is why every other test in
 * this file passed while the Board still flashed.
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
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
  });

  it("renders the pipeline list, not the Board, when the store is seeded 'list'", async () => {
    // Arrange / Act
    const screen = await renderSwitch(
      {},
      memoryStore({ "shidduchim.pageView": "list" }),
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
      memoryStore({ "shidduchim.pageView": "cards" }),
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
      memoryStore({ "shidduchim.pageView": "board" }),
    );

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Board view" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(screen.getByRole("region", { name: "New", exact: true }))
      .not.toBeInTheDocument();
  });

  it("defaults to 'list' under a mobile viewport when nothing is stored yet (AC-1, AC-2)", async () => {
    // Arrange
    await page.viewport(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);

    // Act
    const screen = await renderSwitch();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "List view" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("defaults to 'board' at a desktop viewport when nothing is stored yet (AC-1, AC-2)", async () => {
    // Arrange
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);

    // Act
    const screen = await renderSwitch();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Board view" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("paints the list on its FIRST commit at a mobile viewport — never a frame of the Board", async () => {
    // Arrange — the defect this pins: `useIsMobile()` starts `undefined` and
    // resolves in an effect, so the first paint chose "board" and a phone
    // rendered the 7-column, ~1850px-wide horizontal scroller for one frame.
    await page.viewport(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);
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
      memoryStore({ "shidduchim.pageView": "list" }),
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
      memoryStore({ "shidduchim.pageView": "list" }),
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
      memoryStore({ "shidduchim.pageView": "board" }),
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
      memoryStore({ "shidduchim.pageView": "board" }),
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
