import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "../../providers/commons/i18nProvider";
import { createDataProvider } from "../../providers/fakerest/dataProvider";
import generateData from "../../providers/fakerest/dataGenerator";
import { ENTITY_TARGET_TYPES, type Interaction } from "../../types";
import type { EntityDescriptor } from "../entityDescriptor";
import { registerEntityDescriptor } from "../registry";
import { ActivityTab } from "./ActivityTab";

/**
 * Story 3.5's falsifiable claims for the first universal tab: one target
 * type per test (AC 8), loading/empty/error states (AC 12), newest-first
 * ordering and 20-per-page pagination (AC 8), the two recognised
 * `metadata` mention shapes and the malformed-metadata guard (AC 9), and the
 * `deleted_at@is: null` exclusion against the real FakeRest provider
 * (AC 11).
 */

// ActivityTab hardcodes the literal resource "shidduchim" for the
// {shidduchim_id} mention shape (AC 9) — the fixture descriptor MUST be
// registered under that exact name, not a test-namespaced alias, or the
// RecordLink it renders degrades (no descriptor found) instead of linking.
const SHIDDUCHIM_RESOURCE = "shidduchim";
const LINKED_RESOURCE = "activity-tab-linked-fixture";

const registerFixtureDescriptors = () => {
  const shidduchim: EntityDescriptor = {
    name: SHIDDUCHIM_RESOURCE,
    label: "Shidduchim",
    buildRecordPath: (id) => `/${SHIDDUCHIM_RESOURCE}/${id}`,
  };
  registerEntityDescriptor(shidduchim, { replace: true });

  const linked: EntityDescriptor = {
    name: LINKED_RESOURCE,
    label: "Linked",
    buildRecordPath: (id) => `/${LINKED_RESOURCE}/${id}`,
  };
  registerEntityDescriptor(linked, { replace: true });
};

let nextId = 1;
const buildInteraction = (
  overrides: Partial<Interaction> = {},
): Interaction => ({
  id: nextId++,
  account_id: 1,
  target_type: "shidduch",
  target_id: 1,
  scope: "shidduch",
  kind: "note",
  body: null,
  metadata: null,
  created_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  ...overrides,
});

const renderActivityTab = async (
  props: { targetType?: Interaction["target_type"]; targetId?: number },
  dataProviderOverrides: Partial<DataProvider>,
) => {
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    ...dataProviderOverrides,
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ActivityTab
          targetType={props.targetType ?? "shidduch"}
          targetId={props.targetId ?? 1}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("ActivityTab — one target type per test (AC 8)", () => {
  it.each(ENTITY_TARGET_TYPES)(
    "renders the feed for target type '%s' with the matching filter",
    async (targetType) => {
      // Arrange
      const row = buildInteraction({
        target_type: targetType,
        target_id: 42,
        kind: "note",
        body: `note about ${targetType}`,
      });
      const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });

      // Act
      const { screen } = await renderActivityTab(
        { targetType, targetId: 42 },
        { getList },
      );

      // Assert
      await expect
        .element(screen.getByText(`note about ${targetType}`))
        .toBeInTheDocument();
      expect(getList).toHaveBeenCalledWith(
        "interactions",
        expect.objectContaining({
          filter: {
            target_type: targetType,
            target_id: 42,
            "deleted_at@is": null,
          },
          sort: { field: "created_at", order: "DESC" },
        }),
      );
    },
  );
});

describe("ActivityTab — loading, empty and error states (AC 12)", () => {
  it("shows a skeleton placeholder while the query is in flight", async () => {
    // Arrange
    const getList = vi.fn().mockReturnValue(new Promise(() => {}));

    // Act
    const { screen } = await renderActivityTab({}, { getList });

    // Assert
    expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("shows a translated empty message when there are no interactions", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderActivityTab({}, { getList });

    // Assert
    await expect
      .element(screen.getByText("Nothing logged yet."))
      .toBeInTheDocument();
  });

  it("shows a translated error message, never a blank tab, on a fetch failure", async () => {
    // Arrange
    const getList = vi.fn().mockRejectedValue(new Error("boom"));

    // Act
    const { screen } = await renderActivityTab({}, { getList });

    // Assert
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Could not load the activity feed."))
      .toBeInTheDocument();
  });
});

describe("ActivityTab — newest-first ordering and pagination (AC 8)", () => {
  it("renders three interactions strictly newest-first", async () => {
    // Arrange — already newest-first, the shape a real backend sort returns.
    const rows = [
      buildInteraction({ body: "third", created_at: "2026-01-03T00:00:00Z" }),
      buildInteraction({ body: "second", created_at: "2026-01-02T00:00:00Z" }),
      buildInteraction({ body: "first", created_at: "2026-01-01T00:00:00Z" }),
    ];
    const getList = vi.fn().mockResolvedValue({ data: rows, total: 3 });

    // Act
    const { screen } = await renderActivityTab({}, { getList });
    await expect.element(screen.getByText("third")).toBeInTheDocument();

    // Assert — scoped to the feed's own <ul> (class "border-s"), not
    // ListPagination's page-number <ul>, which also renders <li> elements.
    const items = screen.container.querySelectorAll("ul.border-s > li");
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain("third");
    expect(items[1].textContent).toContain("second");
    expect(items[2].textContent).toContain("first");
    expect(getList).toHaveBeenCalledWith(
      "interactions",
      expect.objectContaining({
        sort: { field: "created_at", order: "DESC" },
      }),
    );
  });

  it("renders exactly 20 of 25 rows on page 1, and advances to the remaining 5", async () => {
    // Arrange
    const allRows = Array.from({ length: 25 }, (_, i) =>
      buildInteraction({
        body: `row ${i}`,
        created_at: new Date(2026, 0, 25 - i).toISOString(),
      }),
    );
    const getList = vi
      .fn()
      .mockImplementation((_resource: string, params: any) => {
        const { page, perPage } = params.pagination;
        const start = (page - 1) * perPage;
        return Promise.resolve({
          data: allRows.slice(start, start + perPage),
          total: allRows.length,
        });
      });

    // Act
    const { screen } = await renderActivityTab({}, { getList });
    await expect.element(screen.getByText("row 0")).toBeInTheDocument();

    // Assert — page 1 has exactly 20 rows (scoped to the feed's own <ul>,
    // not ListPagination's page-number <ul>, which also renders <li>s).
    expect(screen.container.querySelectorAll("ul.border-s > li").length).toBe(
      20,
    );
    await expect.element(screen.getByText("row 19")).toBeInTheDocument();
    await expect.element(screen.getByText("row 20")).not.toBeInTheDocument();

    // Act — advance to page 2.
    await screen.getByRole("link", { name: "Next" }).click();

    // Assert — the remaining 5 rows.
    await expect.element(screen.getByText("row 20")).toBeInTheDocument();
    expect(screen.container.querySelectorAll("ul.border-s > li").length).toBe(
      5,
    );
    await expect.element(screen.getByText("row 0")).not.toBeInTheDocument();
  });
});

describe("ActivityTab — disableSyncWithLocation (AC 8)", () => {
  it("keeps the tab's own paging out of the URL — UX-DR2, the 360's route owns the URL, not this tab", async () => {
    // Arrange — 25 rows so a real page transition is available to provoke a
    // URL sync if one existed; TestMemoryRouter's locationCallback reports
    // every location react-router settles on, mount included.
    const allRows = Array.from({ length: 25 }, (_, i) =>
      buildInteraction({
        body: `row ${i}`,
        created_at: new Date(2026, 0, 25 - i).toISOString(),
      }),
    );
    const getList = vi
      .fn()
      .mockImplementation((_resource: string, params: any) => {
        const { page, perPage } = params.pagination;
        const start = (page - 1) * perPage;
        return Promise.resolve({
          data: allRows.slice(start, start + perPage),
          total: allRows.length,
        });
      });
    const dataProvider = { getList } as unknown as DataProvider;
    let latestSearch: string | undefined;

    // Act
    const screen = await render(
      <TestMemoryRouter
        initialEntries={["/shidduchim/1"]}
        locationCallback={(location) => {
          latestSearch = location.search;
        }}
      >
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <ActivityTab targetType="shidduch" targetId={1} />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );
    await expect.element(screen.getByText("row 0")).toBeInTheDocument();
    const searchAfterMount = latestSearch;

    await screen.getByRole("link", { name: "Next" }).click();
    await expect.element(screen.getByText("row 20")).toBeInTheDocument();

    // Assert — with `disableSyncWithLocation` dropped, `ListBase` would push
    // `page`/`perPage` into this exact URL on mount and again on this exact
    // transition; the route's search string must never move at all.
    expect(searchAfterMount).toBe("");
    expect(latestSearch).toBe(searchAfterMount);
  });
});

describe("ActivityTab — the RecordLink mention branch (AC 9)", () => {
  it("renders a RecordLink for {linkedResource, linkedId}, preferred over {shidduchim_id} when both are present", async () => {
    // Arrange
    registerFixtureDescriptors();
    const row = buildInteraction({
      kind: "note",
      metadata: {
        linkedResource: LINKED_RESOURCE,
        linkedId: 9,
        shidduchim_id: 999,
      },
    });
    const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });

    // Act
    const { screen } = await renderActivityTab({}, { getList });

    // Assert
    const link = screen.getByRole("link", { name: "View record" });
    await expect.element(link).toBeInTheDocument();
    expect(link.element().getAttribute("href")).toBe(`/${LINKED_RESOURCE}/9`);
  });

  it("renders a RecordLink to shidduchim for {shidduchim_id} — the one shape a live writer produces today", async () => {
    // Arrange
    registerFixtureDescriptors();
    const row = buildInteraction({
      kind: "link_created",
      metadata: { shidduchim_id: 7 },
    });
    const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });

    // Act
    const { screen } = await renderActivityTab({}, { getList });

    // Assert
    const link = screen.getByRole("link", { name: "View record" });
    await expect.element(link).toBeInTheDocument();
    expect(link.element().getAttribute("href")).toBe(
      `/${SHIDDUCHIM_RESOURCE}/7`,
    );
  });

  it("renders no mention for merged_from_reference_id — its referent is deleted by the same function that writes it", async () => {
    // Arrange
    const row = buildInteraction({
      kind: "merge",
      body: "merge note",
      metadata: { merged_from_reference_id: 3 },
    });
    const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });

    // Act
    const { screen } = await renderActivityTab({}, { getList });

    // Assert — not "no link at all": ListPagination's own page-number <a>
    // renders regardless. What must be absent is a mention link.
    await expect.element(screen.getByText("merge note")).toBeInTheDocument();
    await expect
      .element(screen.getByText("View record"))
      .not.toBeInTheDocument();
  });

  it("leaves every other row rendered and the tab interactive when metadata is malformed", async () => {
    // Arrange
    registerFixtureDescriptors();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const rows = [
      buildInteraction({
        body: "unregistered resource",
        metadata: { linkedResource: "nope", linkedId: 1 },
      }),
      buildInteraction({
        body: "linkedResource is not a string",
        metadata: { linkedResource: 5 },
      }),
      buildInteraction({ body: "a perfectly ordinary note" }),
    ];
    const getList = vi.fn().mockResolvedValue({ data: rows, total: 3 });

    // Act
    const { screen } = await renderActivityTab({}, { getList });

    // Assert — all three rows still render.
    await expect
      .element(screen.getByText("unregistered resource"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("linkedResource is not a string"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("a perfectly ordinary note"))
      .toBeInTheDocument();

    consoleError.mockRestore();
  });
});

describe("ActivityTab — call_logged regression (AC 4, Story 5.11)", () => {
  it("renders a logged call on the reference's own Activity tab, with a working RecordLink to its shidduch", async () => {
    // Arrange — `log_reference_call` (02_functions.sql) always writes
    // target_type = 'reference', target_id = the reference's own id, with
    // metadata.shidduchim_id set — the identical shape already proven above
    // for link_created/link_removed, never target_type = 'shidduch'. A
    // target_type = 'shidduch' filter can therefore never return this row;
    // the reference's own Activity tab (targetType="reference", wired by
    // Story 5.10) is the tab that actually queries it, and it renders
    // through the same shidduchim_id mention branch (AC 9 above), now
    // proven for the call_logged kind too.
    registerFixtureDescriptors();
    const row = buildInteraction({
      target_type: "reference",
      target_id: 55,
      kind: "call_logged",
      body: "Warm, reliable, always on time.",
      metadata: {
        call_status: "answered",
        shidduchim_id: 7,
        source: "manual",
      },
    });
    const getList = vi.fn().mockResolvedValue({ data: [row], total: 1 });

    // Act
    const { screen } = await renderActivityTab(
      { targetType: "reference", targetId: 55 },
      { getList },
    );

    // Assert
    await expect
      .element(screen.getByText("Warm, reliable, always on time."))
      .toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View record" });
    await expect.element(link).toBeInTheDocument();
    expect(link.element().getAttribute("href")).toBe(
      `/${SHIDDUCHIM_RESOURCE}/7`,
    );
    // The claim this test exists to make: it is queried with
    // target_type = "reference", never "shidduch" — a target_type =
    // "shidduch" filter could never have returned this row.
    expect(getList).toHaveBeenCalledWith(
      "interactions",
      expect.objectContaining({
        filter: {
          target_type: "reference",
          target_id: 55,
          "deleted_at@is": null,
        },
      }),
    );
  });
});

describe("ActivityTab — deleted_at exclusion against the real FakeRest provider (AC 11)", () => {
  it("renders every other row and not a soft-deleted one", async () => {
    // Arrange — the real FakeRest data provider, not a mock, so the
    // `deleted_at@is: null` filter genuinely round-trips through
    // transformFilter.ts's `@is` -> `_eq` mapping. Starts from a full
    // generated db (FakeRest's shape assumptions elsewhere depend on every
    // resource key existing) with `interactions` replaced by a minimal,
    // controlled fixture.
    const db = generateData();
    db.interactions = [
      buildInteraction({
        id: 90001,
        target_type: "shidduch",
        target_id: 999,
        body: "still here",
        deleted_at: null,
      }),
      buildInteraction({
        id: 90002,
        target_type: "shidduch",
        target_id: 999,
        body: "soft deleted",
        deleted_at: "2026-01-01T00:00:00Z",
      }),
    ];
    const dataProvider = createDataProvider({ db, latency: 0, silent: true });

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <ActivityTab targetType="shidduch" targetId={999} />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert
    await expect.element(screen.getByText("still here")).toBeInTheDocument();
    await expect
      .element(screen.getByText("soft deleted"))
      .not.toBeInTheDocument();
  });
});
