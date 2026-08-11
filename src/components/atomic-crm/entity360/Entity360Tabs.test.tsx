import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { NavigateFunction } from "react-router";
import { Route, Routes } from "react-router";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { Entity360 } from "./Entity360";
import type { EntityDescriptor } from "./entityDescriptor";
import { Entity360Tabs, type Entity360TabsProps } from "./Entity360Tabs";
import { registerEntityDescriptor } from "./registry";

/**
 * Story AC 4, 5, 6, 7, plus Task 6's shell-integration check. Fixtures wrap
 * `Entity360Tabs` in a real `<Routes>`/`<Route>` pair matching
 * `buildEntityRoutes`'s own `:id` / `:id/:tab` shape, so `useParams()`
 * resolves for real — `ResourceContextProvider` + `RecordContextProvider`
 * from `ra-core` inside a `TestMemoryRouter`, per the story's Dev Notes.
 */

const FIXTURE_RESOURCE = "entity-tabs-fixture";
const recordPath = (id: number) => `/${FIXTURE_RESOURCE}/${id}`;

beforeEach(() => {
  const descriptor: EntityDescriptor = {
    name: FIXTURE_RESOURCE,
    label: "Fixture",
    buildRecordPath: (id) => `/${FIXTURE_RESOURCE}/${id}`,
  };
  registerEntityDescriptor(descriptor, { replace: true });
});

const renderEntityTabs = async (
  initialEntries: string[],
  tabs: Entity360TabsProps["tabs"],
  navigateCallback?: (navigate: NavigateFunction) => void,
) => {
  let pathname: string | undefined;

  const screen = await render(
    <TestMemoryRouter
      initialEntries={initialEntries}
      locationCallback={(location) => {
        pathname = location.pathname;
      }}
      navigateCallback={navigateCallback}
    >
      <CoreAdminContext i18nProvider={testI18nProvider}>
        <ResourceContextProvider value={FIXTURE_RESOURCE}>
          <RecordContextProvider value={{ id: 1 }}>
            <Routes>
              <Route
                path={`${recordPath(1)}`}
                element={<Entity360Tabs tabs={tabs} />}
              />
              <Route
                path={`${recordPath(1)}/:tab`}
                element={<Entity360Tabs tabs={tabs} />}
              />
            </Routes>
          </RecordContextProvider>
        </ResourceContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, getPathname: () => pathname };
};

describe("Entity360Tabs — triggers are real links (AC 4)", () => {
  it("gives each trigger an href equal to buildTabPath, and never invokes the inactive tab's render", async () => {
    // Arrange
    const overviewRender = vi.fn(() => <div>OVERVIEW_PANEL</div>);
    const notesRender = vi.fn(() => <div>NOTES_PANEL</div>);
    const tabs: Entity360TabsProps["tabs"] = [
      { key: "overview", render: overviewRender },
      { key: "notes", render: notesRender },
    ];

    // Act
    const { screen } = await renderEntityTabs(
      [`${recordPath(1)}/overview`],
      tabs,
    );
    const overviewTrigger = screen.getByRole("tab", {
      name: "Overview",
      exact: true,
    });
    const notesTrigger = screen.getByRole("tab", {
      name: "Notes",
      exact: true,
    });
    await expect.element(overviewTrigger).toBeInTheDocument();
    await expect.element(notesTrigger).toBeInTheDocument();

    // Assert (a) — href equals buildTabPath's value for each trigger.
    expect(overviewTrigger.element().getAttribute("href")).toBe(
      `${recordPath(1)}/overview`,
    );
    expect(notesTrigger.element().getAttribute("href")).toBe(
      `${recordPath(1)}/notes`,
    );

    // Assert (d) — the inactive tab's render is never invoked; the active
    // tab's render was invoked exactly once for the initial paint.
    expect(overviewRender).toHaveBeenCalledTimes(1);
    expect(notesRender).not.toHaveBeenCalled();
  });

  it("pushes on a tab click, and browser back returns to the previous tab's panel", async () => {
    // Arrange
    const tabs: Entity360TabsProps["tabs"] = [
      { key: "overview", render: () => <div>OVERVIEW_PANEL</div> },
      { key: "notes", render: () => <div>NOTES_PANEL</div> },
    ];
    let navigate: NavigateFunction | undefined;

    // Act — mount at /overview, then click the Notes trigger.
    const { screen, getPathname } = await renderEntityTabs(
      [`${recordPath(1)}/overview`],
      tabs,
      (nav) => {
        navigate = nav;
      },
    );
    await screen.getByRole("tab", { name: "Notes", exact: true }).click();

    // Assert (b)
    await expect.element(screen.getByText("NOTES_PANEL")).toBeInTheDocument();
    expect(getPathname()).toBe(`${recordPath(1)}/notes`);

    // Act — browser back.
    navigate?.(-1);

    // Assert (c) — back lands on /overview, with the first tab's panel.
    await expect
      .element(screen.getByText("OVERVIEW_PANEL"))
      .toBeInTheDocument();
    expect(getPathname()).toBe(`${recordPath(1)}/overview`);
  });
});

describe("Entity360Tabs — bare /{entity}/{id} is valid, no navigation (AC 5)", () => {
  it("renders the first tab's panel without pushing a new history entry", async () => {
    // Arrange
    const tabs: Entity360TabsProps["tabs"] = [
      { key: "overview", render: () => <div>OVERVIEW_PANEL</div> },
      { key: "notes", render: () => <div>NOTES_PANEL</div> },
    ];
    let navigate: NavigateFunction | undefined;

    // Act — an entry BEFORE the fixture route, so "back" lands outside it.
    const { screen, getPathname } = await renderEntityTabs(
      ["/", recordPath(1)],
      tabs,
      (nav) => {
        navigate = nav;
      },
    );

    // Assert — first tab renders, URL unchanged.
    await expect
      .element(screen.getByText("OVERVIEW_PANEL"))
      .toBeInTheDocument();
    expect(getPathname()).toBe(recordPath(1));

    // Act — one back step.
    navigate?.(-1);

    // Assert — no extra history entry was pushed for the bare-id case: back
    // lands outside the fixture route entirely, at "/".
    await expect.poll(() => getPathname()).toBe("/");
  });
});

describe("Entity360Tabs — unknown :tab replaces to the first tab (AC 6)", () => {
  it("mounting at an unknown tab ends at the first tab, with the first panel on screen", async () => {
    // Arrange
    const tabs: Entity360TabsProps["tabs"] = [
      { key: "overview", render: () => <div>OVERVIEW_PANEL</div> },
      { key: "notes", render: () => <div>NOTES_PANEL</div> },
    ];

    // Act
    const { screen, getPathname } = await renderEntityTabs(
      [`${recordPath(1)}/nonsense`],
      tabs,
    );

    // Assert (a)
    await expect
      .element(screen.getByText("OVERVIEW_PANEL"))
      .toBeInTheDocument();
    await expect.poll(() => getPathname()).toBe(`${recordPath(1)}/overview`);
  });

  it("re-evaluates on every location change, and back from the fallback skips the unknown tab", async () => {
    // Arrange — a mount-only effect would pass (a) above but fail here: the
    // fallback must fire again on the SECOND visit to an unknown tab, after
    // a legitimate visit to a real tab in between.
    const tabs: Entity360TabsProps["tabs"] = [
      { key: "overview", render: () => <div>OVERVIEW_PANEL</div> },
      { key: "notes", render: () => <div>NOTES_PANEL</div> },
    ];
    let navigate: NavigateFunction | undefined;

    // Act — start on the unknown tab (replaced to /overview on mount).
    const { screen, getPathname } = await renderEntityTabs(
      [`${recordPath(1)}/nonsense`],
      tabs,
      (nav) => {
        navigate = nav;
      },
    );
    await expect.poll(() => getPathname()).toBe(`${recordPath(1)}/overview`);

    // A legitimate push to a real tab.
    navigate?.(`${recordPath(1)}/notes`);
    await expect.element(screen.getByText("NOTES_PANEL")).toBeInTheDocument();

    // Programmatically revisit the unknown tab.
    navigate?.(`${recordPath(1)}/nonsense`);

    // Assert (b) — re-evaluation fires again, landing back on /overview.
    await expect
      .element(screen.getByText("OVERVIEW_PANEL"))
      .toBeInTheDocument();
    await expect.poll(() => getPathname()).toBe(`${recordPath(1)}/overview`);

    // Act — browser back.
    navigate?.(-1);

    // Assert (c) — the replaced /nonsense entry never existed in history;
    // back lands on the real /notes visit, not on /nonsense.
    await expect.element(screen.getByText("NOTES_PANEL")).toBeInTheDocument();
    await expect.poll(() => getPathname()).toBe(`${recordPath(1)}/notes`);
  });
});

describe("Entity360Tabs — an empty tabs array is inert (AC 7)", () => {
  it("renders nothing and never navigates", async () => {
    // Act
    const { screen, getPathname } = await renderEntityTabs(
      [`${recordPath(1)}/medical`],
      [],
    );

    // Assert — no tab strip, no panel, no navigation away from the deep link.
    await expect.element(screen.getByRole("tablist")).not.toBeInTheDocument();
    expect(getPathname()).toBe(`${recordPath(1)}/medical`);
    expect(screen.container.textContent ?? "").toBe("");
  });
});

describe("Entity360Tabs — shell integration (Task 6)", () => {
  it("renders inside Entity360's tabBar region, leaving the children region absent", async () => {
    // Arrange
    const tabs: Entity360TabsProps["tabs"] = [
      { key: "overview", render: () => <div>SHELL_OVERVIEW_PANEL</div> },
    ];

    // Act — mounted as Entity360's tabBar prop, no children/rightRail.
    const screen = await render(
      <TestMemoryRouter initialEntries={[recordPath(1)]}>
        <CoreAdminContext i18nProvider={testI18nProvider}>
          <ResourceContextProvider value={FIXTURE_RESOURCE}>
            <RecordContextProvider value={{ id: 1 }}>
              <Routes>
                <Route
                  path={recordPath(1)}
                  element={
                    <Entity360
                      identityHeader={<span>IDENTITY_HEADER</span>}
                      tabBar={<Entity360Tabs tabs={tabs} />}
                    />
                  }
                />
              </Routes>
            </RecordContextProvider>
          </ResourceContextProvider>
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert — identityHeader precedes the tabBar region's content (AD-24
    // order), and no content/rail wrapper is emitted (children absent).
    const root = screen.container.children[0] as HTMLElement;
    const text = root.textContent ?? "";
    expect(text.indexOf("IDENTITY_HEADER")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("SHELL_OVERVIEW_PANEL")).toBeGreaterThan(
      text.indexOf("IDENTITY_HEADER"),
    );
    // identityHeader + tabBar only — no third (content/rail) child.
    expect(root.children.length).toBe(2);
  });
});
