import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ResourceContextProvider,
  ResourceDefinitionContextProvider,
  RecordContextProvider,
  TestMemoryRouter,
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

    const { screen } = await renderEntityRoutes(["/1"], {
      navigateCallback: (nav) => {
        navigate = nav;
      },
    });
    await expect
      .element(screen.getByText(FIXTURE_SHOW_MARKER))
      .toBeInTheDocument();
    expect(scrollToSpy).toHaveBeenCalledTimes(1);

    navigate?.("/1/overview");

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
