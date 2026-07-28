import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
  useGetOne,
  useRecordContext,
} from "ra-core";
import type { DataProvider, RaRecord } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { buildEntityRoutes } from "./buildEntityRoutes";
import type { EntityDescriptor } from "./entityDescriptor";
import entityShowSource from "./EntityShow.tsx?raw";
import { EntityShow } from "./EntityShow";
import { registerEntityDescriptor } from "./registry";
import type { EntityRelationshipDescriptor } from "./relationshipDescriptor";

/**
 * Story 3.3b — AC 7 (region composition + `actions` inside identityHeader),
 * AC 8 (two-fixture proof + lazy `render`), AC 9 (minimal-descriptor
 * degrade + the `?raw` boundary guard) and AC 10 (relationships become
 * tabs). `buildEntityRoutes` is reused as the harness so `EntityShow`
 * mounts exactly as it will in production — inside the real `ShowBase`
 * wiring, not a hand-rolled substitute.
 */

const FIXTURE_RESOURCE = "entity-show-fixture";
const FIXTURE_RECORD = { id: 1 };

const registerFixtureDescriptor = (
  overrides: Partial<EntityDescriptor> = {},
): void => {
  const descriptor: EntityDescriptor = {
    name: FIXTURE_RESOURCE,
    label: "Fixture",
    buildRecordPath: (id) => `/${FIXTURE_RESOURCE}/${id}`,
    ...overrides,
  };
  registerEntityDescriptor(descriptor, { replace: true });
};

const renderEntityShow = async (
  initialEntries: string[],
  dataProviderOverrides: Partial<DataProvider> = {},
) => {
  const dataProvider = {
    getOne: vi.fn().mockResolvedValue({ data: FIXTURE_RECORD }),
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    ...dataProviderOverrides,
  } as unknown as DataProvider;

  const screen = await render(
    <TestMemoryRouter initialEntries={initialEntries}>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResourceContextProvider value={FIXTURE_RESOURCE}>
          {buildEntityRoutes({ List: () => null, Show: EntityShow })}
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

const tabTriggerCount = (screen: { container: HTMLElement }): number =>
  screen.container.querySelectorAll('[role="tab"]').length;

describe("EntityShow — a 360 renders entirely from the declaration (AC 8)", () => {
  it("Fixture A: title, a hook-backed statBand, exactly two tabs, no edit to EntityShow.tsx", async () => {
    // Arrange
    let resolveStats: (value: {
      data: RaRecord & { nb: number };
    }) => void = () => {};
    const statsPromise = new Promise<{ data: RaRecord & { nb: number } }>(
      (resolve) => {
        resolveStats = resolve;
      },
    );
    const FixtureStatBand: ComponentType<{ record: RaRecord }> = ({
      record,
    }) => {
      const { data, isPending } = useGetOne<RaRecord & { nb: number }>(
        "fixture-a-stats",
        { id: record.id },
      );
      if (isPending) return <div>Loading stats...</div>;
      return <div>Stat value: {data?.nb}</div>;
    };
    registerFixtureDescriptor({
      title: () => "Fixture A Title",
      statBand: FixtureStatBand,
      tabs: [
        { key: "overview", render: () => <div>OVERVIEW_A</div> },
        { key: "notes", render: () => <div>NOTES_A</div> },
      ],
    });
    const getOne = vi.fn((resource: string, params: { id: unknown }) => {
      if (resource === "fixture-a-stats") {
        return statsPromise;
      }
      return Promise.resolve({ data: { id: params.id } as RaRecord });
    }) as unknown as DataProvider["getOne"];

    // Act
    const { screen } = await renderEntityShow(["/1"], { getOne });

    // Assert — exactly the declared title, the declared tab count, the
    // stat band's pending state, then its resolved value.
    await expect
      .element(screen.getByText("Fixture A Title"))
      .toBeInTheDocument();
    expect(tabTriggerCount(screen)).toBe(2);
    await expect
      .element(screen.getByText("Loading stats..."))
      .toBeInTheDocument();
    resolveStats({ data: { id: 1, nb: 4 } });
    await expect.element(screen.getByText("Stat value: 4")).toBeInTheDocument();

    // Root region count: identityHeader + statBand + tabBar, no rail/alert.
    const root = screen.container.children[0] as HTMLElement;
    expect(root.children.length).toBe(3);
  });

  it("Fixture B: a different title, three tabs, no statBand, a rightRail, and actions inside identityHeader", async () => {
    // Arrange
    const FixtureRightRail: ComponentType<{ record: RaRecord }> = () => (
      <div>RIGHT_RAIL_B</div>
    );
    const FixtureActions: ComponentType<{ record: RaRecord }> = () => (
      <button type="button">ACTIONS_B</button>
    );
    registerFixtureDescriptor({
      title: () => "Fixture B Title",
      rightRail: FixtureRightRail,
      actions: FixtureActions,
      tabs: [
        { key: "overview", render: () => <div>OVERVIEW_B</div> },
        { key: "notes", render: () => <div>NOTES_B</div> },
        { key: "tasks", render: () => <div>TASKS_B</div> },
      ],
    });

    // Act
    const { screen } = await renderEntityShow(["/1"]);

    // Assert
    await expect
      .element(screen.getByText("Fixture B Title"))
      .toBeInTheDocument();
    expect(tabTriggerCount(screen)).toBe(3);
    await expect.element(screen.getByText("RIGHT_RAIL_B")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "ACTIONS_B" }))
      .toBeInTheDocument();
    // The stat band region never renders at all — Fixture B's descriptor
    // declares no statBand.
    await expect
      .element(screen.getByText(/Stat value/))
      .not.toBeInTheDocument();

    // Actions renders INSIDE the identityHeader region (contract §2 rule
    // 2): the first root region carries both the title and the actions
    // button, not two separate regions.
    const root = screen.container.children[0] as HTMLElement;
    const identityRegion = root.children[0] as HTMLElement;
    expect(identityRegion.textContent).toContain("Fixture B Title");
    expect(identityRegion.textContent).toContain("ACTIONS_B");
    // identityHeader + tabBar + content/rail row — no statBand, no alertSlot.
    expect(root.children.length).toBe(3);
  });
});

describe("EntityShow — tab render is lazy (AC 8)", () => {
  it("never invokes a non-active tab's render, and the active tab reaches the record via useRecordContext", async () => {
    // Arrange
    const overviewRender = vi.fn(() => <div>OVERVIEW_PANEL</div>);
    const RecordAwareNotes = () => {
      const record = useRecordContext();
      return <div>NOTES_PANEL id={String(record?.id)}</div>;
    };
    const notesRender = vi.fn(() => <RecordAwareNotes />);
    registerFixtureDescriptor({
      title: () => "Lazy Fixture",
      tabs: [
        { key: "overview", render: overviewRender },
        { key: "notes", render: notesRender },
      ],
    });

    // Act — mount directly on the "notes" tab.
    const { screen } = await renderEntityShow(["/1/notes"]);

    // Assert
    await expect
      .element(screen.getByText("NOTES_PANEL id=1"))
      .toBeInTheDocument();
    expect(notesRender).toHaveBeenCalledTimes(1);
    expect(overviewRender).not.toHaveBeenCalled();
  });
});

describe("EntityShow — missing optional fields degrade, never throw (AC 9)", () => {
  it("a minimal descriptor (name, buildRecordPath, label only) renders with no stat band, tab bar, rail or alert slot", async () => {
    // Arrange
    registerFixtureDescriptor();

    // Act
    const { screen } = await renderEntityShow(["/1"]);

    // Assert — renders (no throw), with exactly one region: the default
    // identity composition. No tab strip, no rail, no alert.
    await expect.element(screen.getByText("?")).toBeInTheDocument();
    expect(tabTriggerCount(screen)).toBe(0);
    const root = screen.container.children[0] as HTMLElement;
    expect(root.children.length).toBe(1);
  });
});

describe("EntityShow — context guards", () => {
  it("throws when rendered outside a ResourceContextProvider", async () => {
    // Arrange
    registerFixtureDescriptor();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // Act — no resource context at all, so the explicit guard fires before
    // `requireEntityDescriptor` would ever be reached. Nothing here wraps
    // the tree in an ErrorBoundary, so vitest-browser-react's own default
    // one catches the throw and renders it instead of the promise
    // rejecting.
    const screen = await render(
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <EntityShow />
      </CoreAdminContext>,
    );

    // Assert
    expect(screen.container.textContent).toContain(
      "EntityShow must be rendered within a ResourceContextProvider",
    );

    consoleError.mockRestore();
  });

  it("renders nothing when the resource context exists but no record does yet", async () => {
    // Arrange
    registerFixtureDescriptor();

    // Act — mounted directly, bypassing ShowBase entirely, so no
    // RecordContext is ever established.
    const screen = await render(
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ResourceContextProvider value={FIXTURE_RESOURCE}>
          <EntityShow />
        </ResourceContextProvider>
      </CoreAdminContext>,
    );

    // Assert — no throw, and nothing rendered.
    expect(screen.container.textContent).toBe("");
  });
});

describe("EntityShow boundary (?raw) — AC 9", () => {
  const ESCAPING_IMPORT_RE = /from\s+["']\.\.\//;
  const ENTITY_NAMES = [
    "shidduchim",
    "singles",
    "inbox_items",
    "shadchanim",
    "references",
    "tasks",
    "members",
    "connections",
  ];

  function importsEscapeEntity360(source: string): boolean {
    return ESCAPING_IMPORT_RE.test(source);
  }

  function containsEntityNameLiteral(source: string): boolean {
    return ENTITY_NAMES.some((name) =>
      new RegExp(`["'\`]${name}["'\`]`).test(source),
    );
  }

  it("importsEscapeEntity360 is true for a fixture importing from a sibling directory of entity360/", () => {
    // Arrange — a plausible but forbidden import; note it names no
    // four-way alternation, matching ANY sibling directory (contract §4,
    // "not a four-name alternation, because connections/ arrives in 8.5").
    const fixture = `import { Whatever } from "../some-other-entity/Whatever";`;

    // Act / Assert
    expect(importsEscapeEntity360(fixture)).toBe(true);
  });

  it("importsEscapeEntity360 is false for the real EntityShow.tsx source", () => {
    expect(importsEscapeEntity360(entityShowSource)).toBe(false);
  });

  it("containsEntityNameLiteral is true for a fixture hardcoding a resource name", () => {
    // Arrange
    const fixture = `if (resource === "shidduchim") { /* ... */ }`;

    // Act / Assert
    expect(containsEntityNameLiteral(fixture)).toBe(true);
  });

  it("containsEntityNameLiteral is false for the real EntityShow.tsx source", () => {
    expect(containsEntityNameLiteral(entityShowSource)).toBe(false);
  });
});

describe("EntityShow — relationships become tabs (AC 10)", () => {
  const buildRelationship = (): EntityRelationshipDescriptor => ({
    key: "shidduchim",
    resource: FIXTURE_RESOURCE,
    getFilter: (record) => ({ parent_id: record.id }),
  });

  it("a relationships-only descriptor shows a Shidduchim tab whose content is RelatedRecordsTab", async () => {
    // Arrange
    registerFixtureDescriptor({ relationships: [buildRelationship()] });
    const getList = vi
      .fn()
      .mockResolvedValue({ data: [{ id: 55, name: "Related Row" }], total: 1 });

    // Act
    const { screen } = await renderEntityShow(["/1"], { getList });

    // Assert — one tab, labelled from the canonical TAB_LABELS entry, whose
    // panel is RelatedRecordsTab's own rendering (a RecordLink per row).
    // Wait for the record fetch (ShowBase's own `RecordPending` state) to
    // settle before taking the synchronous tab-count snapshot below.
    await expect
      .element(screen.getByRole("tab", { name: "Shidduchim" }))
      .toBeInTheDocument();
    expect(tabTriggerCount(screen)).toBe(1);
    await expect
      .element(screen.getByRole("link", { name: "Related Row" }))
      .toBeInTheDocument();
  });

  it("an explicit tabs entry for the same key overrides the relationship — one tab, the explicit content", async () => {
    // Arrange
    registerFixtureDescriptor({
      relationships: [buildRelationship()],
      tabs: [
        {
          key: "shidduchim",
          render: () => <div>EXPLICIT_SHIDDUCHIM_CONTENT</div>,
        },
      ],
    });
    const getList = vi
      .fn()
      .mockResolvedValue({ data: [{ id: 55, name: "Related Row" }], total: 1 });

    // Act
    const { screen } = await renderEntityShow(["/1"], { getList });

    // Assert — exactly one "Shidduchim" tab, rendering the explicit
    // content; RelatedRecordsTab is never mounted for this key.
    await expect
      .element(screen.getByText("EXPLICIT_SHIDDUCHIM_CONTENT"))
      .toBeInTheDocument();
    expect(tabTriggerCount(screen)).toBe(1);
    await expect
      .element(screen.getByRole("link", { name: "Related Row" }))
      .not.toBeInTheDocument();
    expect(getList).not.toHaveBeenCalled();
  });
});
