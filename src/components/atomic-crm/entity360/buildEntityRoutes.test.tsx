import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ResourceContextProvider,
  ResourceDefinitionContextProvider,
  RecordContextProvider,
  RestoreScrollPosition,
  TestMemoryRouter,
  memoryStore,
  useGetPathForRecord,
  useRecordContext,
} from "ra-core";
import type { DataProvider, ResourceDefinition } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { EntityDescriptor } from "./entityDescriptor";
import { buildEntityRoutes } from "./buildEntityRoutes";
import { registerEntityDescriptor } from "./registry";

/**
 * Story AC 1, 2, 8, 11 (route table + `ShowBase` wiring), plus AC 10 (the
 * `hasShow`/`hasEdit` mechanism this story documents but does not enforce —
 * enforcement is Story 3.12's). `TestMemoryRouter` + `CoreAdminContext` +
 * a hand-rolled `dataProvider` is the `ContextSwitcher.test.tsx:55-86`
 * shape, so `ShowBase`'s `useGetOne` resolves for real.
 */

const FIXTURE_RESOURCE = "build-entity-routes-fixture";

const FIXTURE_LIST_MARKER = "FIXTURE_LIST_MARKER";
const FIXTURE_NEW_MARKER = "FIXTURE_NEW_MARKER";
const FIXTURE_EDIT_MARKER = "FIXTURE_EDIT_MARKER";
const FIXTURE_SHOW_MARKER = "FIXTURE_SHOW_MARKER";
const ALL_MARKERS = [
  FIXTURE_LIST_MARKER,
  FIXTURE_NEW_MARKER,
  FIXTURE_EDIT_MARKER,
  FIXTURE_SHOW_MARKER,
];

const FixtureList = () => <span>{FIXTURE_LIST_MARKER}</span>;
const FixtureNew = () => <span>{FIXTURE_NEW_MARKER}</span>;
const FixtureEdit = () => <span>{FIXTURE_EDIT_MARKER}</span>;
const FixtureShow = () => {
  const record = useRecordContext();
  return (
    <span>
      {FIXTURE_SHOW_MARKER} {String(record?.id)}
    </span>
  );
};

beforeEach(() => {
  const descriptor: EntityDescriptor = {
    name: FIXTURE_RESOURCE,
    label: "Fixture",
    buildRecordPath: (id) => `/${FIXTURE_RESOURCE}/${id}`,
  };
  registerEntityDescriptor(descriptor, { replace: true });
});

// `window` is the real, shared browser global across every test in this
// file (vitest-browser-react runs in real Chromium) — a `vi.spyOn(window,
// "scrollTo")` left in place would keep accumulating calls into the next
// test's `it` (AC 11's call-count assertions need a clean slate each time).
afterEach(() => {
  vi.restoreAllMocks();
});

/** Echoes back whatever `id` is requested — `useShowController` throws if a
 * resolved record's `id` doesn't match the requested one, so a fixed
 * fixture record would break the AC 11 "navigate to a different id" case. */
const buildEchoDataProvider = (
  overrides: Partial<DataProvider> = {},
): DataProvider =>
  ({
    getOne: vi.fn((_resource: string, params: { id: unknown }) =>
      Promise.resolve({ data: { id: params.id, name: `Record ${params.id}` } }),
    ),
    ...overrides,
  }) as unknown as DataProvider;

const renderEntityRoutes = async (
  initialEntries: string[],
  options: {
    dataProviderOverrides?: Partial<DataProvider>;
    navigateCallback?: (navigate: (to: string) => void) => void;
  } = {},
) => {
  const dataProvider = buildEchoDataProvider(options.dataProviderOverrides);
  let pathname: string | undefined;

  const screen = await render(
    <TestMemoryRouter
      initialEntries={initialEntries}
      locationCallback={(location) => {
        pathname = location.pathname;
      }}
      navigateCallback={options.navigateCallback}
    >
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResourceContextProvider value={FIXTURE_RESOURCE}>
          {buildEntityRoutes({
            List: FixtureList,
            New: FixtureNew,
            Edit: FixtureEdit,
            Show: FixtureShow,
          })}
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider, getPathname: () => pathname };
};

const STALE_LIST_SCROLL_POSITION = 500;

/**
 * Contract §5 rule 9 / AC 11 — reproduces exactly how `<Resource>` wires
 * `buildEntityRoutes`'s return value in production
 * (`ra-core/dist/core/Resource.js:14`): a single `<RestoreScrollPosition
 * storeKey={`${name}.list.scrollPosition`}>` wrapping the WHOLE route tree
 * (index included), backed by a real store seeded with a stale offset —
 * standing in for "the user previously scrolled the list, then a deep link
 * lands directly on a non-index route." Callers still spy on
 * `window.scrollTo`, exactly like `renderEntityRoutes` above — but here the
 * REAL `<RestoreScrollPosition>` is in the tree too, so what gets asserted
 * against is its own restore effect, not a test fixture's.
 */
const renderEntityRoutesUnderRestoreScrollPosition = async (
  initialEntries: string[],
) => {
  const dataProvider = buildEchoDataProvider();
  const store = memoryStore({
    [`${FIXTURE_RESOURCE}.list.scrollPosition`]: STALE_LIST_SCROLL_POSITION,
  });

  const screen = await render(
    <TestMemoryRouter initialEntries={initialEntries}>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
        store={store}
      >
        <ResourceContextProvider value={FIXTURE_RESOURCE}>
          <RestoreScrollPosition
            storeKey={`${FIXTURE_RESOURCE}.list.scrollPosition`}
          >
            {buildEntityRoutes({
              List: FixtureList,
              New: FixtureNew,
              Edit: FixtureEdit,
              Show: FixtureShow,
            })}
          </RestoreScrollPosition>
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen };
};

const expectOnlyMarkerVisible = async (
  screen: Awaited<ReturnType<typeof renderEntityRoutes>>["screen"],
  marker: string,
) => {
  await expect.element(screen.getByText(marker)).toBeInTheDocument();
  for (const other of ALL_MARKERS) {
    if (other === marker) continue;
    await expect.element(screen.getByText(other)).not.toBeInTheDocument();
  }
};

describe("buildEntityRoutes — the AD-24 route table (AC 1)", () => {
  it("index (`/`) renders List, and nothing else", async () => {
    const { screen } = await renderEntityRoutes(["/"]);
    await expectOnlyMarkerVisible(screen, FIXTURE_LIST_MARKER);
  });

  it("`/new` renders New, and nothing else (AC 1, AC 8)", async () => {
    const { screen } = await renderEntityRoutes(["/new"]);
    await expectOnlyMarkerVisible(screen, FIXTURE_NEW_MARKER);
  });

  it("`/1/edit` renders Edit, and nothing else", async () => {
    const { screen } = await renderEntityRoutes(["/1/edit"]);
    await expectOnlyMarkerVisible(screen, FIXTURE_EDIT_MARKER);
  });

  it("`/1` renders Show inside ShowBase, and nothing else", async () => {
    const { screen } = await renderEntityRoutes(["/1"]);
    await expectOnlyMarkerVisible(screen, FIXTURE_SHOW_MARKER);
  });

  it("`/1/overview` (an arbitrary :tab) renders Show inside ShowBase, and nothing else", async () => {
    const { screen } = await renderEntityRoutes(["/1/overview"]);
    await expectOnlyMarkerVisible(screen, FIXTURE_SHOW_MARKER);
  });
});

describe("buildEntityRoutes — record pending / unavailable (AC 2)", () => {
  it("shows RecordUnavailable when the record fetch rejects", async () => {
    const { screen } = await renderEntityRoutes(["/1"], {
      dataProviderOverrides: {
        getOne: vi.fn().mockRejectedValue(new Error("not found")),
      },
    });

    await expect
      .element(screen.getByText("This record is unavailable."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(FIXTURE_SHOW_MARKER))
      .not.toBeInTheDocument();
  });

  it("leaves location.pathname unchanged after a fetch failure — no silent redirect to the list", async () => {
    const { screen, getPathname } = await renderEntityRoutes(["/1"], {
      dataProviderOverrides: {
        getOne: vi.fn().mockRejectedValue(new Error("not found")),
      },
    });

    await expect
      .element(screen.getByText("This record is unavailable."))
      .toBeInTheDocument();
    expect(getPathname()).toBe("/1");
  });
});

describe("buildEntityRoutes — scroll reset (AC 11)", () => {
  it("calls window.scrollTo(0, 0) once on mounting a record route", async () => {
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});

    const { screen } = await renderEntityRoutes(["/1"]);
    await expect
      .element(screen.getByText(FIXTURE_SHOW_MARKER))
      .toBeInTheDocument();

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
  });

  it("does not scroll again when only the :tab segment changes", async () => {
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});
    let navigate: ((to: string) => void) | undefined;

    const { screen, getPathname } = await renderEntityRoutes(["/1"], {
      navigateCallback: (nav) => {
        navigate = nav;
      },
    });
    await expect
      .element(screen.getByText(FIXTURE_SHOW_MARKER))
      .toBeInTheDocument();
    expect(scrollToSpy).toHaveBeenCalledTimes(1);

    navigate?.("/1/overview");

    // Guard against a false-green race: `${FIXTURE_SHOW_MARKER} 1` is
    // already on screen from the initial `/1` render, so a bare
    // `expect.element(...).toBeInTheDocument()` here resolves on its first
    // poll — before the navigation to `/1/overview` has actually committed
    // — and the call-count assertion below would then run too early to
    // catch a regression. Waiting for the pathname itself to change first
    // makes this a real assertion: breaking `RecordRoute`'s dependency list
    // to `[id, tab]` (scrolling on every tab switch) reliably turns this
    // red once the wait is in place.
    await expect.poll(() => getPathname()).toBe("/1/overview");
    await expect
      .element(screen.getByText(`${FIXTURE_SHOW_MARKER} 1`))
      .toBeInTheDocument();
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
  });

  it("scrolls again when the :id segment changes", async () => {
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});
    let navigate: ((to: string) => void) | undefined;

    const { screen } = await renderEntityRoutes(["/1"], {
      navigateCallback: (nav) => {
        navigate = nav;
      },
    });
    await expect
      .element(screen.getByText(`${FIXTURE_SHOW_MARKER} 1`))
      .toBeInTheDocument();

    navigate?.("/2");

    await expect
      .element(screen.getByText(`${FIXTURE_SHOW_MARKER} 2`))
      .toBeInTheDocument();
    expect(scrollToSpy).toHaveBeenCalledTimes(2);
  });
});

describe("buildEntityRoutes — the inherited list scroll offset is suppressed (contract §5 rule 9)", () => {
  const expectFinalScrollIsZero = async (
    scrollToSpy: ReturnType<typeof vi.spyOn>,
  ) => {
    // `RestoreScrollPosition`'s own restore is itself a passive effect that
    // fires on the SAME mount — a plain, non-deferred reset loses this race
    // (the sequence would be `[[0, 0], [0, 500]]`; see `resetScrollToTop.ts`'s
    // doc comment). The LAST call — not merely "some call" — has to be
    // `(0, 0)`, so `expect.poll` waits out the deferred `queueMicrotask`.
    await expect.poll(() => scrollToSpy.mock.calls.at(-1)).toEqual([0, 0]);
  };

  it("`:id` does not open scrolled to the list's stale offset", async () => {
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});

    const { screen } = await renderEntityRoutesUnderRestoreScrollPosition([
      "/1",
    ]);
    await expect
      .element(screen.getByText(`${FIXTURE_SHOW_MARKER} 1`))
      .toBeInTheDocument();

    await expectFinalScrollIsZero(scrollToSpy);
  });

  it("`:id/:tab` does not open scrolled to the list's stale offset", async () => {
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});

    const { screen } = await renderEntityRoutesUnderRestoreScrollPosition([
      "/1/overview",
    ]);
    await expect
      .element(screen.getByText(`${FIXTURE_SHOW_MARKER} 1`))
      .toBeInTheDocument();

    await expectFinalScrollIsZero(scrollToSpy);
  });

  it("`new` does not open scrolled to the list's stale offset", async () => {
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});

    const { screen } = await renderEntityRoutesUnderRestoreScrollPosition([
      "/new",
    ]);
    await expect
      .element(screen.getByText(FIXTURE_NEW_MARKER))
      .toBeInTheDocument();

    await expectFinalScrollIsZero(scrollToSpy);
  });

  it("`:id/edit` does not open scrolled to the list's stale offset", async () => {
    const scrollToSpy = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});

    const { screen } = await renderEntityRoutesUnderRestoreScrollPosition([
      "/1/edit",
    ]);
    await expect
      .element(screen.getByText(FIXTURE_EDIT_MARKER))
      .toBeInTheDocument();

    await expectFinalScrollIsZero(scrollToSpy);
  });
});

describe("buildEntityRoutes — RecordPending (AC 2)", () => {
  it("renders the pending state while the record fetch is in flight, then the record once it resolves", async () => {
    let resolveGetOne: ((value: { data: { id: string } }) => void) | undefined;
    const pending = new Promise<{ data: { id: string } }>((resolve) => {
      resolveGetOne = resolve;
    });

    const { screen } = await renderEntityRoutes(["/1"], {
      dataProviderOverrides: {
        getOne: vi.fn().mockImplementation(() => pending),
      },
    });

    await expect.element(screen.getByRole("status")).toBeInTheDocument();
    await expect.element(screen.getByText("Loading…")).toBeInTheDocument();
    await expect
      .element(screen.getByText(FIXTURE_SHOW_MARKER))
      .not.toBeInTheDocument();

    resolveGetOne?.({ data: { id: "1" } });

    await expect
      .element(screen.getByText(`${FIXTURE_SHOW_MARKER} 1`))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  });
});

describe("buildEntityRoutes — New/Edit-absent branches", () => {
  it('`/new` falls through to `:id` (id `"new"`) and shows RecordUnavailable when New is not supplied', async () => {
    const screen = await render(
      <TestMemoryRouter initialEntries={["/new"]}>
        <CoreAdminContext
          dataProvider={buildEchoDataProvider({
            getOne: vi.fn().mockRejectedValue(new Error("not found")),
          })}
          i18nProvider={testI18nProvider}
        >
          <ResourceContextProvider value={FIXTURE_RESOURCE}>
            {buildEntityRoutes({ List: FixtureList, Show: FixtureShow })}
          </ResourceContextProvider>
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await expect
      .element(screen.getByText("This record is unavailable."))
      .toBeInTheDocument();
  });
});

describe("the hasShow/hasEdit registration rule buildEntityRoutes documents (AC 10)", () => {
  const PathProbe = (): ReactElement => {
    const path = useGetPathForRecord();
    return <span>{path === false ? "NONE" : path}</span>;
  };

  const renderProbe = (definitions: Record<string, ResourceDefinition>) =>
    render(
      <TestMemoryRouter>
        <CoreAdminContext i18nProvider={testI18nProvider}>
          <ResourceDefinitionContextProvider definitions={definitions}>
            <ResourceContextProvider value="fixtures">
              <RecordContextProvider value={{ id: 1 }}>
                <PathProbe />
              </RecordContextProvider>
            </ResourceContextProvider>
          </ResourceDefinitionContextProvider>
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

  it("resolves a path when the resource definition carries hasShow and hasEdit", async () => {
    const screen = await renderProbe({
      fixtures: {
        name: "fixtures",
        hasList: true,
        hasShow: true,
        hasEdit: true,
      },
    });

    await expect
      .element(screen.getByText("/fixtures/1/show"))
      .toBeInTheDocument();
  });

  it("resolves to false — the row is unclickable — with hasList alone", async () => {
    const screen = await renderProbe({
      fixtures: { name: "fixtures", hasList: true },
    });

    await expect.element(screen.getByText("NONE")).toBeInTheDocument();
  });
});
