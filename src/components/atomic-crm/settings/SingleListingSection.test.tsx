import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, memoryStore, TestMemoryRouter } from "ra-core";
import type { Store } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { SingleListingShapeHint } from "../root/singleListingShapeHint";
import type { Listing, MyContext, Single } from "../types";
import { SingleListingSection } from "./SingleListingSection";

/**
 * Story 9.2 — the Settings wiring's own gate: a household-only surface
 * (mirrors `ShadchanListingSection.test.tsx`'s household/shadchanus split),
 * and the per-row "who may act" gate FR103 requires — `parent_admin` acts
 * on every single, `self_manager` acts only on the single record that is
 * themselves, and neither `helper` nor a plain `single` ever gets an
 * action at all. The RLS policies (Task 1) are the real boundary; this is
 * UX only.
 */

const householdContext = (role: MyContext["role"]): MyContext => ({
  account_id: 1,
  kind: "household",
  name: "The Klein Family",
  role,
  is_active: true,
});

const shadchanContext: MyContext = {
  account_id: 9,
  kind: "shadchanus",
  name: "Rivka the Shadchan",
  role: "shadchan",
  is_active: true,
};

const buildSingle = (overrides: Partial<Single> = {}): Single => ({
  id: 1,
  account_id: 1,
  first_name_en: "Rivky",
  last_name_en: "Klein",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

type ListByResource = Record<string, { data: unknown[]; total: number }>;

/** `vitest-browser-react`'s `screen` has no `getAllByRole` — the codebase's
 * own convention for "how many of these" is a plain `querySelectorAll` over
 * `screen.container` (e.g. `EntityShow.test.tsx`, `StatStrip.test.tsx`). */
const buttonsNamed = (
  screen: { container: HTMLElement },
  text: string,
): HTMLButtonElement[] =>
  Array.from(screen.container.querySelectorAll("button")).filter(
    (button) => button.textContent?.trim() === text,
  );

/** localStorage key `root/singleListingShapeHint.ts` reads/writes — not
 * exported from there (the module's own consumers never need the raw key,
 * only its hooks), so tests target it by the same literal string
 * `layout/DemoBanner.test.tsx` uses for its own hint key. */
const SHAPE_HINT_KEY = "settings.singleListing.lastShape";

/**
 * `store` defaults to a FRESH `memoryStore()` per call rather than
 * `CoreAdminContext`'s own module-level singleton default — `CoreAdminContext
 * .tsx` shares one `memoryStore()` across every render that doesn't pass its
 * own, so two tests in this file would otherwise leak the shape hint one
 * wrote into the other's render (`layout/DemoBanner.test.tsx` established
 * this same explicit-store convention for the identical reason).
 */
const renderSection = async (
  context: MyContext,
  lists: ListByResource,
  {
    currentMemberId = null,
    store = memoryStore(),
    pendingForever = false,
  }: {
    currentMemberId?: number | null;
    store?: Store;
    /** Never resolves `getList`/`getCurrentMemberId` — the exact window
     * `layout/DemoBanner.test.tsx`'s `buildPendingDataProvider` isolates,
     * here for asserting what the FIRST paint looks like before anything
     * settles. */
    pendingForever?: boolean;
  } = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [context]);
  const dataProvider = {
    getList: vi.fn((resource: string) =>
      pendingForever
        ? new Promise(() => {})
        : Promise.resolve(lists[resource] ?? { data: [], total: 0 }),
    ),
    getCurrentMemberId: vi.fn(() =>
      pendingForever ? new Promise(() => {}) : Promise.resolve(currentMemberId),
    ),
  } as unknown as CrmDataProvider;

  const screen = await render(
    <TestMemoryRouter initialEntries={["/settings"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
        store={store}
      >
        <SingleListingSection />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider, store };
};

describe("SingleListingSection — active-context gate", () => {
  it("renders nothing for a shadchanus active context", async () => {
    // Arrange / Act
    const { screen, dataProvider } = await renderSection(shadchanContext, {});

    // Assert
    expect(screen.container.textContent ?? "").not.toContain("Single listings");
    expect(dataProvider.getList).not.toHaveBeenCalled();
  });
});

describe("SingleListingSection — parent_admin", () => {
  it("lists every single in the household with a Publish action on each row", async () => {
    // Arrange
    const rivky = buildSingle({ id: 1, first_name_en: "Rivky" });
    const yaakov = buildSingle({ id: 2, first_name_en: "Yaakov" });
    const { screen } = await renderSection(householdContext("parent_admin"), {
      singles: { data: [rivky, yaakov], total: 2 },
      listings: { data: [], total: 0 },
    });

    // Assert
    await expect.element(screen.getByText("Rivky Klein")).toBeInTheDocument();
    expect(buttonsNamed(screen, "Publish").length).toBe(2);
    // Story 9.5 (Task 6): the Share action is manager-scoped the same way
    // as Publish, so it appears on every row a parent_admin manages too.
    expect(buttonsNamed(screen, "Share").length).toBe(2);
  });

  it("shows 'Manage listing' instead of 'Publish' for a single that already has one", async () => {
    // Arrange
    const rivky = buildSingle({ id: 1, first_name_en: "Rivky" });
    const existing: Listing = {
      id: 500,
      account_id: 1,
      listing_type: "single",
      single_id: 1,
      created_at: "2026-01-01T00:00:00Z",
    };
    const { screen } = await renderSection(householdContext("parent_admin"), {
      singles: { data: [rivky], total: 1 },
      listings: { data: [existing], total: 1 },
    });

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Manage listing" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Publish" }))
      .not.toBeInTheDocument();
  });
});

describe("SingleListingSection — self_manager (FR103's narrower authority)", () => {
  it("shows the action only on the self-manager's own row, not a sibling's", async () => {
    // Arrange — Rivky (member_id 55) is the self-manager; Yaakov is a sibling.
    const rivky = buildSingle({ id: 1, first_name_en: "Rivky", member_id: 55 });
    const yaakov = buildSingle({
      id: 2,
      first_name_en: "Yaakov",
      member_id: 56,
    });
    const { screen } = await renderSection(
      householdContext("self_manager"),
      {
        singles: { data: [rivky, yaakov], total: 2 },
        listings: { data: [], total: 0 },
      },
      { currentMemberId: 55 },
    );

    // Assert — waits for useCurrentMemberId()'s own async resolution
    // (getCurrentMemberId() returns a Promise) before the row-gating result
    // is stable.
    await expect.poll(() => buttonsNamed(screen, "Publish").length).toBe(1);
    // Story 9.5 (Task 6): the Share action follows the exact same
    // self-manager row gate as Publish.
    await expect.poll(() => buttonsNamed(screen, "Share").length).toBe(1);
    await expect.element(screen.getByText("Rivky Klein")).toBeInTheDocument();
    await expect.element(screen.getByText("Yaakov Klein")).toBeInTheDocument();
  });
});

describe("SingleListingSection — non-managing roles (AC-3)", () => {
  it.each(["helper", "single"] as const)(
    "shows the roster but no action at all for role=%s",
    async (role) => {
      // Arrange
      const rivky = buildSingle({ id: 1, first_name_en: "Rivky" });
      const { screen } = await renderSection(householdContext(role), {
        singles: { data: [rivky], total: 1 },
        listings: { data: [], total: 0 },
      });

      // Assert
      await expect.element(screen.getByText("Rivky Klein")).toBeInTheDocument();
      await expect
        .element(screen.getByRole("button", { name: "Publish" }))
        .not.toBeInTheDocument();
      await expect
        .element(screen.getByRole("button", { name: "Manage listing" }))
        .not.toBeInTheDocument();
      // Story 9.5 (Task 6): a helper or a plain single gets no Share
      // action either — the same manager-only authority FR103 already
      // draws for Publish (Dev Notes "Why share links are manager-scoped,
      // not household-scoped").
      await expect
        .element(screen.getByRole("button", { name: "Share" }))
        .not.toBeInTheDocument();
    },
  );
});

/**
 * CLS fix (Epic 9 layout-shift regression — `e2e/demo-banner-cls.spec.ts`,
 * `e2e/single-listing-section-cls.spec.ts`). Every assertion here is
 * deliberately synchronous against `container` with a `pendingForever`
 * dataProvider: `expect.element(...)` retries, so it would pass just as
 * happily on a skeleton that only appeared three renders late — i.e. it
 * could not fail on the bug being fixed. Mirrors
 * `layout/DemoBanner.test.tsx`'s own "reserved height on first paint"
 * structure, generalised from a boolean to a row count.
 */
describe("SingleListingSection — CLS fix (reserved height on first paint)", () => {
  const seedHint = (hint: SingleListingShapeHint) =>
    memoryStore({ [SHAPE_HINT_KEY]: hint });

  it("renders N skeleton rows on the first paint when the hint says household with N rows", async () => {
    // Arrange — queries never resolve; only the hint is available.
    const store = seedHint({ isHousehold: true, rowCount: 2 });

    // Act
    const { screen } = await renderSection(
      householdContext("parent_admin"),
      {},
      { store, pendingForever: true },
    );

    // Assert — synchronously two rows, i.e. the card is already at its
    // final height. This is the assertion that is RED on the pre-fix code
    // (which rendered a fixed 2-row skeleton regardless of the hint, or —
    // before that — `null` outright).
    expect(screen.container.querySelectorAll('[data-slot="item"]').length).toBe(
      2,
    );
    expect(screen.container.textContent ?? "").toContain("Single listings");
  });

  it("renders the empty state on the first paint when the hint says household with zero rows", async () => {
    // Arrange — the sparse case: a skeleton sized for rows the real answer
    // doesn't have would itself be a shift.
    const store = seedHint({ isHousehold: true, rowCount: 0 });

    // Act
    const { screen } = await renderSection(
      householdContext("parent_admin"),
      {},
      { store, pendingForever: true },
    );

    // Assert
    expect(screen.container.querySelectorAll('[data-slot="item"]').length).toBe(
      0,
    );
    expect(screen.container.textContent ?? "").toContain(
      "No singles in this household yet.",
    );
  });

  it("renders nothing on the first paint when the hint says shadchanus", async () => {
    // Arrange
    const store = seedHint({ isHousehold: false, rowCount: 0 });

    // Act
    const { screen } = await renderSection(
      shadchanContext,
      {},
      { store, pendingForever: true },
    );

    // Assert — a hint of "not household" must not reserve space nobody
    // needs, mirroring `DemoBanner.test.tsx`'s identical assertion for its
    // own boolean.
    expect(screen.container.textContent ?? "").not.toContain("Single listings");
  });

  it("renders nothing on the first paint when there is no hint", async () => {
    // Arrange — first-ever visit to the app: no hint has ever been
    // written. Fails TOWARD nothing, never toward a guess.
    const { screen } = await renderSection(
      householdContext("parent_admin"),
      {},
      { pendingForever: true },
    );

    // Assert
    expect(screen.container.textContent ?? "").not.toContain("Single listings");
  });

  it("the live read replaces a stale hint's row count once it resolves", async () => {
    // Arrange — hint says 2 rows; the real household only ever had 1.
    const store = seedHint({ isHousehold: true, rowCount: 2 });
    const rivky = buildSingle({ id: 1, first_name_en: "Rivky" });

    // Act
    const { screen } = await renderSection(
      householdContext("parent_admin"),
      {
        singles: { data: [rivky], total: 1 },
        listings: { data: [], total: 0 },
      },
      { store },
    );

    // Assert — the live answer wins once it lands, exactly like
    // `DemoBanner.test.tsx`'s "the live read is always authoritative".
    await expect.element(screen.getByText("Rivky Klein")).toBeInTheDocument();
    expect(screen.container.querySelectorAll('[data-slot="item"]').length).toBe(
      1,
    );
  });
});
