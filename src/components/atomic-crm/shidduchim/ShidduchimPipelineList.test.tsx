import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

// Real Tailwind, so the touch-target test below measures the rendered box
// rather than an unstyled one.
import "@/index.css";
import {
  CoreAdminContext,
  ListContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { ListControllerResult } from "ra-core";

// Side-effect import — registers the "shidduchim" entity descriptor, exactly
// as `shidduchim/index.ts` does at boot (RecordLink / buildNewPath).
import "./entityDescriptor";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { ShidduchSummary } from "../types";
import {
  PipelineListSkeleton,
  ShidduchimPipelineList,
} from "./ShidduchimPipelineList";
import { INITIAL_PIPELINE_STATES, PIPELINE_STATES } from "./pipelineStates";

const buildShidduch = (
  overrides: Partial<ShidduchSummary>,
): ShidduchSummary => ({
  id: overrides.id ?? 1,
  account_id: 1,
  single_id: 10,
  pipeline_state: "new",
  first_suggested_at: "2026-01-01T00:00:00Z",
  redt_date: "2026-01-02T00:00:00Z",
  origin: "manual",
  visibility: "shared",
  index: 0,
  created_at: "2026-01-01T00:00:00Z",
  name_en: `Shidduch ${overrides.id ?? 1}`,
  ...overrides,
});

const buildListContextValue = (
  overrides: Partial<ListControllerResult>,
): ListControllerResult =>
  ({
    data: undefined,
    total: undefined,
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

/** Exact match: e.g. bare "No" would otherwise substring-match "Not-sure"
 * and "For-sure-not" too (Playwright/testing-library role-name matching is
 * case-insensitive substring by default). */
const regionFor = (screen: Awaited<ReturnType<typeof render>>, label: string) =>
  screen.getByRole("region", { name: label, exact: true });

const renderPipelineList = (
  overrides: Partial<ListControllerResult>,
  view: "list" | "cards" = "list",
) => {
  const dataProvider = {
    transitionShidduch: vi.fn().mockResolvedValue({}),
  } as unknown as CrmDataProvider;

  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ListContextProvider value={buildListContextValue(overrides)}>
          <ShidduchimPipelineList view={view} />
        </ListContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("ShidduchimPipelineList — state-grouped pipeline (AC-7)", () => {
  afterEach(async () => {
    await page.viewport(1280, 720);
  });

  it("renders one section per PIPELINE_STATES entry, in canonical order, with correct counts", async () => {
    // Arrange
    const data = [
      buildShidduch({ id: 1, pipeline_state: "new" }),
      buildShidduch({ id: 2, pipeline_state: "new" }),
      buildShidduch({ id: 3, pipeline_state: "look_into" }),
    ];

    // Act
    const screen = await renderPipelineList({ data });

    // Assert — all 7 states are present as regions.
    for (const state of PIPELINE_STATES) {
      await expect.element(regionFor(screen, state.label)).toBeInTheDocument();
    }
    // Review fix F6: the title alone asserted "in canonical order" while the
    // body only checked presence — a mutation reversing the render order
    // stayed green. Reading the DOM in document order and comparing against
    // PIPELINE_STATES is what actually pins the order the title names.
    const sections = Array.from(
      screen.container.querySelectorAll('[data-slot="pipeline-section"]'),
    );
    expect(
      sections.map((section) => section.getAttribute("aria-label")),
    ).toEqual(PIPELINE_STATES.map((state) => state.label));
    await expect.element(regionFor(screen, "New")).toHaveTextContent("2");
    await expect.element(regionFor(screen, "Look-into")).toHaveTextContent("1");
    await expect.element(regionFor(screen, "Yes")).toHaveTextContent("0");
  });

  it("renders a zero-count section's header even with no rows in it", async () => {
    // Arrange
    const data = [buildShidduch({ id: 1, pipeline_state: "new" })];

    // Act
    const screen = await renderPipelineList({ data });

    // Assert — "Yes" has zero shidduchim but its region still renders.
    await expect.element(regionFor(screen, "Yes")).toBeInTheDocument();
  });

  it("renders '＋ Add here' for exactly the four INITIAL_PIPELINE_STATES", async () => {
    // Arrange
    const data = [buildShidduch({ id: 1, pipeline_state: "new" })];

    // Act
    const screen = await renderPipelineList({ data });

    // Assert
    for (const state of PIPELINE_STATES) {
      const region = regionFor(screen, state.label);
      const addHere = region.getByRole("link", { name: /Add here/ });
      if (INITIAL_PIPELINE_STATES.includes(state.value)) {
        await expect.element(addHere).toBeInTheDocument();
      } else {
        await expect.element(addHere).not.toBeInTheDocument();
      }
    }
  });

  it("keeps each section's 'Add here' at the 44px touch floor on a phone", async () => {
    // Arrange — List is the view a phone lands on, so this is the primary
    // create affordance there; it used to be a 32px target.
    await page.viewport(390, 844);
    const data = [buildShidduch({ id: 1, pipeline_state: "new" })];

    // Act
    const screen = await renderPipelineList({ data });
    const addHere = regionFor(screen, "New").getByRole("link", {
      name: /Add here/,
    });

    // Assert
    await expect.element(addHere).toBeInTheDocument();
    expect(
      addHere.element().getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);
  });

  it("renders no sections at all — one EmptyState with the action — when the pipeline is genuinely empty", async () => {
    // Arrange / Act
    const screen = await renderPipelineList({
      data: [],
      filterValues: { single_id: 10 },
    });

    // Assert
    await expect.element(regionFor(screen, "New")).not.toBeInTheDocument();
    await expect.element(screen.getByText("No redts yet")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "Add a redt" }))
      .toBeInTheDocument();
  });

  it("shows the generic no-matches text (not the empty-state CTA) for a zero-result search", async () => {
    // Arrange / Act
    const screen = await renderPipelineList({
      data: [],
      filterValues: { single_id: 10, q: "zzz-nomatch" },
    });

    // Assert
    await expect
      .element(screen.getByText("No shidduchim match this search."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("No redts yet"))
      .not.toBeInTheDocument();
  });
});

describe("PipelineListSkeleton — same shape as the loaded content (AC-13)", () => {
  it("renders 7 section slots, each with 2 row slots — matching the loaded primitives' shape", async () => {
    // Arrange / Act
    const screen = await render(<PipelineListSkeleton />);

    // Assert
    const sections = screen.container.querySelectorAll(
      '[data-slot="pipeline-section"]',
    );
    expect(sections.length).toBe(PIPELINE_STATES.length);
    sections.forEach((section) => {
      expect(
        section.querySelectorAll('[data-slot="pipeline-row"]').length,
      ).toBe(2);
    });
  });
});
