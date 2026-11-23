import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "@vitest/browser/context";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  memoryStore,
  Resource,
  TestMemoryRouter,
} from "ra-core";
import type { AuthProvider } from "ra-core";
import type { Store } from "ra-core";
import { Route, Routes } from "react-router";
import { QueryClient } from "@tanstack/react-query";

import { ThemeProvider } from "@/components/admin/theme-provider";
import "@/index.css";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MobileLayout } from "../layout/MobileLayout";
import { ACCOUNT_DEMO_QUERY_KEY } from "../root/useAccountDemo";
import { AGE_AFFIRMATION_QUERY_KEY } from "../root/useAgeAffirmation";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import { MY_PERSONAS_QUERY_KEY } from "../root/useMyPersonas";
import type { MyContext } from "../types";
import { PIPELINE_STATES } from "./pipelineStates";
import { SingleSwitcherPill } from "../layout/TopBar";

// The real, post-change `shidduchim` resource definition — the same object
// `<CRM>` spreads onto `<Resource>` (`root/routeManifest.ts`'s `RESOURCES`,
// `root/CRM.tsx`) — not a bare `<ShidduchimList />` mounted with no
// `ResourceContextProvider`. Mounting the bare component throws
// (`useListController requires a non-empty resource prop or context`) and
// that throw is swallowed by React Router's default `ErrorBoundary`, which
// made the board heading unreachable regardless of the code under test and
// left the "never the board heading" half of this file's one assertion
// unfalsifiable (Story 3.13 review finding #1). Routing through the real
// `<Resource>` — its `list` is `React.lazy`, hence the `<Suspense>` below —
// makes both halves discriminating.
import shidduchim from "../shidduchim";

/**
 * Pins Story 3.13 AC 1: mounting the real `shidduchim` resource at
 * `/shidduchim/new` renders the create page in place of the pipeline — the
 * early return sits above `<List>` (`ShidduchimList.tsx`'s `matchNew`
 * check), so neither the pipeline nor `ShidduchimBody`'s own list context
 * sits in front of the page, and the pipeline's own `{n} redts` heading
 * (Story 4.3, Task 7) never mounts. The second `it` mounts the same harness
 * at `/shidduchim` and asserts that heading *does* render there — proof the
 * negative assertion above is actually exercising the code under test, not
 * an unreachable heading.
 */

const buildAuthProvider = (): AuthProvider =>
  ({
    getIdentity: vi.fn().mockResolvedValue({ id: 1, fullName: "Test User" }),
    checkAuth: vi.fn().mockResolvedValue(undefined),
    checkError: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  }) as unknown as AuthProvider;

type ListRequest = {
  filter?: Record<string, unknown>;
  pagination?: { page: number; perPage: number };
};

type TestSingle = {
  id: number;
  first_name_en: string;
  last_name_en?: string;
  status: string;
};

const DEFAULT_SINGLES: TestSingle[] = [
  { id: 1, first_name_en: "Chaya", status: "active" },
];

const MOBILE_CONTEXTS: MyContext[] = [
  {
    account_id: 1,
    kind: "household",
    name: "Fixture Household",
    role: "parent_admin",
    is_active: true,
  },
];

const postDeleteEntry = () => ({
  pathname: "/shidduchim",
  state: {
    shidduchLifecycle: {
      kind: "delete",
      id: 42,
      name: "Deleted resume",
      deadline: Date.now() + 60_000,
      origin: "page",
    },
  },
});

const buildDataProvider = (
  onShidduchList?: (params: ListRequest) => void,
  singles: TestSingle[] = DEFAULT_SINGLES,
): CrmDataProvider =>
  ({
    getList: vi.fn((resource: string, params: ListRequest) => {
      if (resource === "singles") {
        return Promise.resolve({
          data: singles,
          total: singles.length,
        });
      }
      if (resource === "shidduchim") onShidduchList?.(params);
      return Promise.resolve({ data: [], total: 0 });
    }),
    getMany: vi.fn().mockResolvedValue({ data: [] }),
    getMyContexts: vi.fn().mockResolvedValue(MOBILE_CONTEXTS),
    getMyPersonas: vi.fn().mockResolvedValue([{}]),
    currentAccountDemo: vi.fn().mockResolvedValue(false),
    ageAffirmationPending: vi.fn().mockResolvedValue(false),
    getConfiguration: vi.fn().mockResolvedValue({}),
    create: vi.fn(),
    createShidduch: vi.fn(),
  }) as unknown as CrmDataProvider;

type TestInitialEntry =
  | string
  | {
      pathname: string;
      search?: string;
      hash?: string;
      state?: unknown;
      key?: string;
    };

const renderShidduchimResourceAt = async (
  initialEntries: TestInitialEntry[],
  options: {
    dataProvider?: CrmDataProvider;
    store?: Store;
    topBar?: boolean;
    mobileShell?: boolean;
  } = {},
) => {
  const queryClient = new QueryClient();
  if (options.mobileShell) {
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, MOBILE_CONTEXTS);
    queryClient.setQueryData(MY_PERSONAS_QUERY_KEY, [{}]);
    queryClient.setQueryData(ACCOUNT_DEMO_QUERY_KEY, false);
    queryClient.setQueryData(AGE_AFFIRMATION_QUERY_KEY, false);
  }

  const resourceRoutes = (
    <Suspense fallback={null}>
      <Routes>
        <Route
          path="shidduchim/*"
          element={<Resource name="shidduchim" {...shidduchim} />}
        />
      </Routes>
    </Suspense>
  );

  return render(
    <TestMemoryRouter initialEntries={initialEntries}>
      <CoreAdminContext
        dataProvider={options.dataProvider ?? buildDataProvider()}
        authProvider={buildAuthProvider()}
        store={options.store}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        {options.mobileShell ? (
          <ThemeProvider>
            <MobileLayout>{resourceRoutes}</MobileLayout>
          </ThemeProvider>
        ) : (
          <>
            {options.topBar ? <SingleSwitcherPill /> : null}
            {resourceRoutes}
          </>
        )}
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

afterEach(async () => {
  await page.viewport(1280, 720);
});

describe("ShidduchimList — shared child choice", () => {
  const singles: TestSingle[] = [
    {
      id: 1,
      first_name_en: "Chaya",
      last_name_en: "Cohen",
      status: "active",
    },
    {
      id: 2,
      first_name_en: "Rivka",
      last_name_en: "Levy",
      status: "active",
    },
  ];

  it("follows a child switched in the top-left pill", async () => {
    const requests: ListRequest[] = [];
    const store = memoryStore({ "single.selected": 1 });
    const screen = await renderShidduchimResourceAt(["/shidduchim"], {
      dataProvider: buildDataProvider(
        (params) => requests.push(params),
        singles,
      ),
      store,
      topBar: true,
    });

    await expect.element(screen.getByText("Showing Chaya Cohen")).toBeVisible();
    await screen
      .getByRole("button", { name: /Switch single: Chaya Cohen/ })
      .click();
    await screen.getByRole("menuitem", { name: "Rivka Levy" }).click();

    await expect
      .poll(() =>
        requests.some(
          (request) =>
            request.pagination?.perPage === 200 &&
            request.filter?.single_id === 2,
        ),
      )
      .toBe(true);
    await expect.element(screen.getByText("Showing Rivka Levy")).toBeVisible();
  });

  it("ignores a stale stored list child filter", async () => {
    const requests: ListRequest[] = [];
    const store = memoryStore({
      "single.selected": 2,
      "shidduchim.listParams": {
        filter: { single_id: 1 },
        page: 1,
        perPage: 200,
        sort: "index",
        order: "ASC",
        displayedFilters: {},
      },
    });
    const screen = await renderShidduchimResourceAt(["/shidduchim"], {
      dataProvider: buildDataProvider(
        (params) => requests.push(params),
        singles,
      ),
      store,
    });

    await expect.element(screen.getByText("Showing Rivka Levy")).toBeVisible();
    const mainRequest = requests.find(
      (request) => request.pagination?.perPage === 200,
    );
    expect(mainRequest?.filter).toMatchObject({ single_id: 2 });
  });

  it("lets an explicit link initialize the shared choice once", async () => {
    const requests: ListRequest[] = [];
    const store = memoryStore({ "single.selected": 1 });
    const filter = encodeURIComponent(JSON.stringify({ single_id: 2 }));
    const screen = await renderShidduchimResourceAt(
      [`/shidduchim?filter=${filter}`],
      {
        dataProvider: buildDataProvider(
          (params) => requests.push(params),
          singles,
        ),
        store,
        topBar: true,
      },
    );

    await expect.element(screen.getByText("Showing Rivka Levy")).toBeVisible();
    await expect
      .element(
        screen.getByRole("button", { name: /Switch single: Rivka Levy/ }),
      )
      .toBeVisible();
    expect(store.getItem("single.selected", null)).toBe(2);
    expect(
      requests.some(
        (request) =>
          request.pagination?.perPage === 200 &&
          request.filter?.single_id === 2,
      ),
    ).toBe(true);

    await screen
      .getByRole("button", { name: /Switch single: Rivka Levy/ })
      .click();
    await screen.getByRole("menuitem", { name: "Chaya Cohen" }).click();
    await expect.element(screen.getByText("Showing Chaya Cohen")).toBeVisible();
  });
});

describe("ShidduchimList — mobile shared child choice", () => {
  const singles: TestSingle[] = [
    {
      id: 1,
      first_name_en: "Chaya",
      last_name_en: "Cohen",
      status: "active",
    },
    {
      id: 2,
      first_name_en: "Rivka",
      last_name_en: "Levy",
      status: "active",
    },
  ];

  it("shows one picker in the real mobile shell and switches the list", async () => {
    await page.viewport(390, 844);
    const requests: ListRequest[] = [];
    const store = memoryStore({ "single.selected": 1 });
    const screen = await renderShidduchimResourceAt(["/shidduchim"], {
      dataProvider: buildDataProvider(
        (params) => requests.push(params),
        singles,
      ),
      store,
      mobileShell: true,
    });

    expect(
      screen.container.querySelectorAll('button[aria-label^="Switch single:"]'),
    ).toHaveLength(1);
    const picker = screen.getByRole("button", {
      name: /Switch single: Chaya Cohen/,
    });
    await expect.element(picker).toBeVisible();
    expect(
      picker.element().getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);

    await picker.click();
    await screen.getByRole("menuitem", { name: "Rivka Levy" }).click();

    await expect
      .poll(() =>
        requests.some(
          (request) =>
            request.pagination?.perPage === 200 &&
            request.filter?.single_id === 2,
        ),
      )
      .toBe(true);
    await expect.element(screen.getByText("Showing Rivka Levy")).toBeVisible();
  });

  it("does not add a page picker on desktop", async () => {
    const store = memoryStore({ "single.selected": 1 });
    const screen = await renderShidduchimResourceAt(["/shidduchim"], {
      dataProvider: buildDataProvider(undefined, singles),
      store,
    });

    await expect.element(screen.getByText("Showing Chaya Cohen")).toBeVisible();
    await expect
      .element(
        screen.getByRole("button", { name: /Switch single: Chaya Cohen/ }),
      )
      .not.toBeInTheDocument();
  });

  it("keeps the selected child after the delete redirect to /shidduchim", async () => {
    const store = memoryStore({ "single.selected": 2 });
    const screen = await renderShidduchimResourceAt([postDeleteEntry()], {
      dataProvider: buildDataProvider(undefined, singles),
      store,
    });

    await expect.element(screen.getByText("Showing Rivka Levy")).toBeVisible();
  });
});

describe("ShidduchimList — the create page sits above <List> (AC 1)", () => {
  it("renders the create heading and never the pipeline's '{n} redts' heading at /shidduchim/new", async () => {
    // Arrange / Act
    const screen = await renderShidduchimResourceAt(["/shidduchim/new"]);

    // Assert
    await expect
      .element(screen.getByRole("heading", { name: "Add a suggestion" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("heading", { name: /redts$/ }))
      .not.toBeInTheDocument();
  });

  it("renders the pipeline's '{n} redts' heading at /shidduchim — the negative assertion above is discriminating", async () => {
    // Arrange / Act
    const screen = await renderShidduchimResourceAt(["/shidduchim"]);

    // Assert
    await expect
      .element(screen.getByRole("heading", { name: /redts$/ }))
      .toBeInTheDocument();
  });
});

describe("ShidduchimList — archive filter defaults", () => {
  it.each(["Supabase", "FakeRest"])(
    "normalizes stored params without an archive key for the %s path",
    async () => {
      const requests: ListRequest[] = [];
      const dataProvider = buildDataProvider((params) => requests.push(params));
      const store = memoryStore({
        "shidduchim.listParams": {
          filter: { single_id: 1 },
          page: 1,
          perPage: 200,
          sort: "index",
          order: "ASC",
          displayedFilters: {},
        },
      });

      const screen = await renderShidduchimResourceAt(["/shidduchim"], {
        dataProvider,
        store,
      });

      await expect
        .element(screen.getByRole("heading", { name: /redts$/ }))
        .toBeInTheDocument();

      const mainRequest = requests.find(
        (request) => request.pagination?.perPage === 200,
      );
      expect(mainRequest?.filter).toMatchObject({
        single_id: 1,
        "archived_at@is": null,
      });
      expect(
        screen.container
          .querySelector('button[role="tab"]')
          ?.getAttribute("aria-selected"),
      ).toBe("true");
      expect(
        screen.getByRole("checkbox", { name: "Include archived" }),
      ).not.toBeChecked();
    },
  );

  it("keeps an explicit Include archived choice when the list reloads", async () => {
    const requests: ListRequest[] = [];
    const dataProvider = buildDataProvider((params) => requests.push(params));
    const store = memoryStore({
      "shidduchim.listParams": {
        filter: { single_id: 1 },
        page: 1,
        perPage: 200,
        sort: "index",
        order: "ASC",
        displayedFilters: { "shidduchim.archive.all": true },
      },
    });

    const screen = await renderShidduchimResourceAt(["/shidduchim"], {
      dataProvider,
      store,
    });

    await expect
      .element(screen.getByRole("heading", { name: /redts$/ }))
      .toBeInTheDocument();

    const mainRequest = requests.find(
      (request) => request.pagination?.perPage === 200,
    );
    expect(mainRequest?.filter).toEqual({ single_id: 1 });
    expect(
      screen.getByRole("checkbox", { name: "Include archived" }),
    ).toBeChecked();
    expect(
      screen.container
        .querySelector('button[role="tab"]')
        ?.getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("moves row-origin focus to the next visible row as soon as Archive removes row A", async () => {
    const rows = [
      {
        id: 42,
        account_id: 1,
        single_id: 1,
        pipeline_state: "new",
        first_suggested_at: "2026-01-01T00:00:00Z",
        redt_date: "2026-01-02",
        origin: "manual",
        visibility: "shared",
        index: 0,
        created_at: "2026-01-01T00:00:00Z",
        name_en: "Row A",
      },
      {
        id: 43,
        account_id: 1,
        single_id: 1,
        pipeline_state: "new",
        first_suggested_at: "2026-01-01T00:00:00Z",
        redt_date: "2026-01-02",
        origin: "manual",
        visibility: "shared",
        index: 1,
        created_at: "2026-01-01T00:00:00Z",
        name_en: "Row B",
      },
    ];
    const archiveShidduch = vi.fn().mockResolvedValue(undefined);
    const dataProvider = {
      getList: vi.fn((resource: string, params: ListRequest) => {
        if (resource === "singles") {
          return Promise.resolve({
            data: [{ id: 1, first_name_en: "Chaya", status: "active" }],
            total: 1,
          });
        }
        const filter = params.filter as Record<string, unknown> | undefined;
        const excluded = String(filter?.["id@not.in"] ?? "");
        const data = excluded.includes("42") ? rows.slice(1) : rows;
        return Promise.resolve({ data, total: data.length });
      }),
      getMany: vi.fn().mockResolvedValue({ data: [] }),
      getMyContexts: vi.fn().mockResolvedValue([
        {
          account_id: 1,
          kind: "household",
          name: "Test household",
          role: "parent_admin",
          is_active: true,
        },
      ]),
      getOne: vi.fn().mockResolvedValue({ data: null }),
      archiveShidduch,
      getShidduchReadState: vi.fn().mockResolvedValue({ inProgress: false }),
      restoreShidduch: vi.fn(),
    } as unknown as CrmDataProvider;

    const screen = await renderShidduchimResourceAt(["/shidduchim"], {
      dataProvider,
    });
    const rowA = screen.getByRole("button", {
      name: "More actions for Row A",
    });
    await rowA.click();
    await screen.getByRole("menuitem", { name: "Archive suggestion" }).click();

    await expect.poll(() => archiveShidduch.mock.calls.length).toBe(1);
    const rowB = screen.getByRole("link", { name: "Row B" });
    await expect
      .poll(() => document.activeElement === rowB.element())
      .toBe(true);
  });
});

/**
 * Review fix F4 (AC-5): `if (!identity || singlesPending) return null;` used
 * to be a bare `return null` — one of the audit's own "seven null loading
 * states". `<List>` (and `ShidduchimViewSwitch`'s shared loading gate) has
 * not mounted yet at this point, so the fix renders the same skeleton SHAPE
 * that gate uses once it does mount, rather than a second, differently-
 * shaped spinner. This deferred-promise probe is what makes the pending
 * window itself observable — the two tests above only ever assert the
 * settled state.
 */
describe("ShidduchimList — the pre-<List> pending state (AC-5, review fix F4)", () => {
  it("renders the pipeline skeleton, not a blank screen, while singles are still in flight", async () => {
    // Arrange
    let resolveSingles:
      ((value: { data: unknown[]; total: number }) => void) | undefined;
    const pendingSingles = new Promise<{ data: unknown[]; total: number }>(
      (resolve) => {
        resolveSingles = resolve;
      },
    );
    const dataProvider = {
      getList: vi.fn((resource: string) =>
        resource === "singles"
          ? pendingSingles
          : Promise.resolve({ data: [], total: 0 }),
      ),
      getMany: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      createShidduch: vi.fn(),
    } as unknown as CrmDataProvider;

    // Act
    const screen = await render(
      <TestMemoryRouter initialEntries={["/shidduchim"]}>
        <CoreAdminContext
          dataProvider={dataProvider}
          authProvider={buildAuthProvider()}
          i18nProvider={testI18nProvider}
        >
          <Suspense fallback={null}>
            <Routes>
              <Route
                path="shidduchim/*"
                element={<Resource name="shidduchim" {...shidduchim} />}
              />
            </Routes>
          </Suspense>
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert — never a blank screen: the same 7-section skeleton shape
    // `ShidduchimViewSwitch`'s own loading gate renders (AC-13).
    const sections = screen.container.querySelectorAll(
      '[data-slot="pipeline-section"]',
    );
    expect(sections.length).toBe(PIPELINE_STATES.length);
    await expect
      .element(screen.getByRole("heading", { name: /redts$/ }))
      .not.toBeInTheDocument();

    // Act — resolve the in-flight singles fetch.
    resolveSingles?.({
      data: [{ id: 1, first_name_en: "Chaya", status: "active" }],
      total: 1,
    });

    // Assert — the skeleton hands off to the real pipeline heading.
    await expect
      .element(screen.getByRole("heading", { name: /redts$/ }))
      .toBeInTheDocument();
  });
});

/**
 * Story 5.1 AC 1: mounting the real, migrated `shidduchim` resource at a
 * RECORD url (`/shidduchim/{id}`, `/shidduchim/{id}/{tab}`) renders
 * `Entity360` via `buildEntityRoutes`' `:id` / `:id/:tab` routes — never the
 * board's `/^Pipeline/`-style heading and never `RecordUnavailable`. A
 * separate data provider from the two describe blocks above: those never
 * define `getOne`, `getMyContexts` or `catchShidduch`, which a record route
 * needs (`ShowBase`, `useViewerRole`, `ShidduchOverviewTab`'s
 * `ShidduchCatchSection`) and the create/board tests above do not.
 */
const SHIDDUCH_RECORD = {
  id: 1,
  account_id: 1,
  single_id: 1,
  pipeline_state: "new",
  first_suggested_at: "2026-01-01T00:00:00Z",
  redt_date: "2026-01-02",
  origin: "manual",
  visibility: "shared",
  index: 0,
  created_at: "2026-01-01T00:00:00Z",
  name_en: "Chaim Cohen",
};

// Seeded so `useViewerRole()` resolves immediately (contract §6 rule 1). A
// resolved `parent_admin` context, not `[]`: Story 6.2 (AC 10) added
// `visibleTo` to the `tasks` tab, so an unresolved role now fails closed on
// it (`hasVisibility`'s own rule 2) exactly like Story 5.5 already did for
// `medical` — an empty-contexts seed would hide the very tab the "renders
// the Tasks tab's content" case below exercises. `parent_admin` keeps every
// tab visible, so `isPending` settling is still all this helper's other
// cases (which are not testing role-gating) need. Used for BOTH the seeded
// query-cache data and the `getMyContexts` mock below, so a background
// refetch (react-query's default `refetchOnMount`) cannot silently revert
// the viewer to unresolved mid-test.
const RECORD_VIEWER_CONTEXTS: MyContext[] = [
  {
    account_id: 1,
    kind: "household",
    name: "Fixture Household",
    role: "parent_admin",
    is_active: true,
  },
];

const buildRecordDataProvider = (): CrmDataProvider =>
  ({
    getOne: vi.fn((resource: string) =>
      resource === "shidduchim"
        ? Promise.resolve({ data: SHIDDUCH_RECORD })
        : Promise.reject(new Error(`unexpected getOne(${resource})`)),
    ),
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getMany: vi.fn().mockResolvedValue({ data: [] }),
    getMyContexts: vi.fn().mockResolvedValue(RECORD_VIEWER_CONTEXTS),
    catchShidduch: vi
      .fn()
      .mockResolvedValue({ has_catch: false, suggestions: [], dates: [] }),
  }) as unknown as CrmDataProvider;

const renderShidduchimRecordAt = async (initialEntries: string[]) => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, RECORD_VIEWER_CONTEXTS);

  return render(
    <TestMemoryRouter initialEntries={initialEntries}>
      <CoreAdminContext
        dataProvider={buildRecordDataProvider()}
        authProvider={buildAuthProvider()}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <Suspense fallback={null}>
          <Routes>
            <Route
              path="shidduchim/*"
              element={<Resource name="shidduchim" {...shidduchim} />}
            />
          </Routes>
        </Suspense>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("ShidduchimList — AC 1: a record URL renders Entity360, not the board", () => {
  it("renders the overview tab's content at /shidduchim/1 — never the board's '{n} redts' heading", async () => {
    // Arrange / Act
    const screen = await renderShidduchimRecordAt(["/shidduchim/1"]);

    // Assert — Entity360's overview tab (the default active tab) rendered.
    await expect
      .element(screen.getByRole("heading", { name: "Shidduch facts" }))
      .toBeInTheDocument();
    // Assert — failing looks like the board's heading appearing at a
    // record URL, or RecordUnavailable, per this AC's own falsifiable text.
    await expect
      .element(screen.getByRole("heading", { name: /redts$/ }))
      .not.toBeInTheDocument();
  });

  /**
   * Review fix F2 (AC-5): the pre-fix suite exercised no assertion that
   * would go red if `identityHeader`/`actions` were dropped from
   * `shidduchimDescriptor` entirely — `EntityShow` silently falls back to
   * `DefaultIdentityHeader` with no `actions` region, and the page still
   * "worked" by every other test's standard. These two assertions pin the
   * hero header (`ShidduchIdentityHeader` renders `ShidduchShowHeader`,
   * whose name heading is `SHIDDUCH_RECORD.name_en`) and the pipeline-
   * transition control (`ShidduchActions` renders `ShidduchStateControl`,
   * whose own heading is "Move through the pipeline") every tab shares.
   */
  it("renders the identity header's name and the state-transition control at /shidduchim/1", async () => {
    // Arrange / Act
    const screen = await renderShidduchimRecordAt(["/shidduchim/1"]);

    // Assert — identityHeader: ShidduchIdentityHeader -> ShidduchShowHeader.
    await expect
      .element(screen.getByRole("heading", { name: "Chaim Cohen" }))
      .toBeInTheDocument();
    // Assert — actions: ShidduchActions -> ShidduchStateControl.
    await expect
      .element(
        screen.getByRole("heading", { name: "Move through the pipeline" }),
      )
      .toBeInTheDocument();
  });

  it("renders the Notes tab's content at /shidduchim/1/notes", async () => {
    // Arrange / Act
    const screen = await renderShidduchimRecordAt(["/shidduchim/1/notes"]);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Add note" }))
      .toBeInTheDocument();
  });

  /**
   * Review gap (AC-5's own falsifiable clause, never written): "an RTL
   * render of /shidduchim/1/diligence shows the references section and
   * /shidduchim/1/tasks shows TasksTab". `ShidduchDiligenceTab` and
   * `ShidduchTasksTab` (both in `entityDescriptorRegions.tsx`) had zero
   * coverage before this fix.
   */
  it("renders the references section at /shidduchim/1/diligence", async () => {
    // Arrange / Act
    const screen = await renderShidduchimRecordAt(["/shidduchim/1/diligence"]);

    // Assert — ShidduchDiligenceTab -> ShidduchReferencesSection.
    await expect
      .element(screen.getByRole("heading", { name: "References" }))
      .toBeInTheDocument();
  });

  it("renders the Tasks tab's content at /shidduchim/1/tasks", async () => {
    // Arrange / Act
    const screen = await renderShidduchimRecordAt(["/shidduchim/1/tasks"]);

    // Assert — ShidduchTasksTab -> the universal TasksTab.
    await expect
      .element(screen.getByRole("button", { name: "Add task" }))
      .toBeInTheDocument();
  });

  it("renders the Activity tab's content at /shidduchim/1/activity", async () => {
    // Arrange / Act
    const screen = await renderShidduchimRecordAt(["/shidduchim/1/activity"]);

    // Assert — ShidduchActivityTab -> the universal ActivityTab's empty state
    // (the record data provider's default getList([]) applies to
    // "interactions" too, so this is the discriminating render, not a stub).
    await expect
      .element(screen.getByText("Nothing logged yet."))
      .toBeInTheDocument();
  });
});
