import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";
import { Route, Routes } from "react-router";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { MyContext } from "../types";
import { MY_CONTEXTS_QUERY_KEY } from "./useMyContexts";
import {
  buildDashboardRoute,
  renderCustomRoutes,
  renderResources,
} from "./adminRouteBuilders";
import {
  resourcesFor,
  routesFor,
  type CustomRouteEntry,
  type ResourceEntry,
} from "./routeManifest";

/**
 * Story 8.1 review fix (F1/F2/F3): before this file existed, nothing
 * imported `root/CRM.tsx` — or the route/resource-wiring functions it
 * calls — at all. `RequireContextKind.test.tsx` only mounted a synthetic
 * `/guarded` route the app never registers, `routeManifest.test.ts` only
 * asserted the manifest's `contextKind` *data*, and
 * `ShadchanDashboard.test.tsx` only rendered that component in isolation —
 * so deleting or misconfiguring `root/CRM.tsx`'s own guard wiring
 * (`renderCustomRoutes`, `renderResources`, `buildDashboardRoute` —
 * extracted to `root/adminRouteBuilders.tsx` so `CRM.tsx` stays
 * component-only for `react-refresh/only-export-components`, but still the
 * exact functions `CRM.tsx`'s `DesktopAdmin`/`MobileAdmin` call) left every
 * test in the repo green. This file exercises those functions directly,
 * the same way `root/CRM.tsx` itself calls them.
 */

const household: MyContext = {
  account_id: 1,
  kind: "household",
  name: "The Klein Family",
  role: "parent_admin",
  is_active: true,
};

const shadchanus: MyContext = {
  account_id: 2,
  kind: "shadchanus",
  name: "My Account",
  role: "shadchan",
  is_active: true,
};

const HOME = "Home screen";
const GUARDED_CONTENT = "Guarded content";
const Dummy = () => <div>{GUARDED_CONTENT}</div>;

/**
 * Mirrors `node_modules/ra-core/src/core/CoreAdminRoutes.tsx`'s own
 * `${resource.props.name}/*` wrapping of each `<Resource>` element — the
 * exact shape `CRM.tsx`'s real `<Admin>` tree produces — without pulling in
 * the rest of `<Admin>` (auth, telemetry, the real Supabase-backed
 * providers). `customRoutes` and `resources` are passed straight through
 * `renderCustomRoutes`/`renderResources`, so this harness proves those two
 * functions' real output, never a reimplementation of their wrapping logic.
 */
const renderRoutes = async (
  contexts: MyContext[],
  customRoutes: CustomRouteEntry[],
  resources: ResourceEntry[],
  initialEntries: string[],
) => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);
  const dataProvider = {
    getMyContexts: vi.fn().mockResolvedValue(contexts),
  } as unknown as CrmDataProvider;

  const resourceElements = renderResources(resources);

  let pathname: string | undefined;

  const screen = await render(
    <TestMemoryRouter
      initialEntries={initialEntries}
      locationCallback={(location) => {
        pathname = location.pathname;
      }}
    >
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <Routes>
          {renderCustomRoutes(customRoutes)}
          {resources.map((resource, index) => (
            <Route
              key={resource.name}
              path={`${resource.name}/*`}
              element={resourceElements[index]}
            />
          ))}
          <Route path="/" element={<div>{HOME}</div>} />
        </Routes>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, getPathname: () => pathname };
};

describe("renderResources / renderCustomRoutes wiring (Story 8.1 review F1) — mechanism proof", () => {
  it("wraps a household-tagged resource's list with the guard: shadchanus is redirected", async () => {
    // Arrange
    const resources: ResourceEntry[] = [
      {
        name: "widget",
        surface: "both",
        definition: { list: Dummy, hasShow: true },
        contextKind: "household",
      },
    ];

    // Act
    const { screen, getPathname } = await renderRoutes(
      [shadchanus],
      [],
      resources,
      ["/widget"],
    );

    // Assert
    await expect
      .element(screen.getByText(GUARDED_CONTENT))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText(HOME)).toBeInTheDocument();
    expect(getPathname()).toBe("/");
  });

  it("leaves a household-tagged resource reachable when the active context matches", async () => {
    // Arrange — catches a guard hardcoded to the wrong kind (e.g.
    // `kind="shadchanus"` instead of the entry's own `contextKind`), which
    // would redirect every household user off every household resource.
    const resources: ResourceEntry[] = [
      {
        name: "widget",
        surface: "both",
        definition: { list: Dummy, hasShow: true },
        contextKind: "household",
      },
    ];

    // Act
    const { screen, getPathname } = await renderRoutes(
      [household],
      [],
      resources,
      ["/widget"],
    );

    // Assert
    await expect.element(screen.getByText(GUARDED_CONTENT)).toBeInTheDocument();
    expect(getPathname()).toBe("/widget");
  });

  it("wraps a household-tagged custom route with the guard: shadchanus is redirected", async () => {
    // Arrange
    const customRoutes: CustomRouteEntry[] = [
      {
        path: "/widget",
        Component: Dummy,
        surface: "both",
        chrome: "shell",
        contextKind: "household",
      },
    ];

    // Act
    const { screen, getPathname } = await renderRoutes(
      [shadchanus],
      customRoutes,
      [],
      ["/widget"],
    );

    // Assert
    await expect
      .element(screen.getByText(GUARDED_CONTENT))
      .not.toBeInTheDocument();
    expect(getPathname()).toBe("/");
  });

  it("leaves an ungated custom route reachable regardless of context", async () => {
    // Arrange
    const customRoutes: CustomRouteEntry[] = [
      { path: "/widget", Component: Dummy, surface: "both", chrome: "shell" },
    ];

    // Act
    const { screen } = await renderRoutes(
      [shadchanus],
      customRoutes,
      [],
      ["/widget"],
    );

    // Assert
    await expect.element(screen.getByText(GUARDED_CONTENT)).toBeInTheDocument();
  });
});

describe("renderResources — children guard (Story 8.1 review F2) — mechanism proof", () => {
  /** The exact shape `entity360/routeConvention.tsx`'s `buildCreateRoutes`
   * returns: a `<React.Fragment>` wrapping a `new/*` `<Route>`. Built
   * in-line (not imported) — `routeConvention.tsx` is out of this fix's
   * declared file ownership; the real singles/shadchanim/references
   * manifest entries are exercised separately below. */
  const resourceWithCreateRoute: ResourceEntry = {
    name: "widget",
    surface: "both",
    definition: {
      list: () => <div>List</div>,
      hasShow: true,
      children: (
        <>
          <Route path="new/*" element={<div>{GUARDED_CONTENT}</div>} />
        </>
      ),
    },
    contextKind: "household",
  };

  it("wraps the children slot's new/* route: shadchanus is redirected off /widget/new", async () => {
    // Act
    const { screen, getPathname } = await renderRoutes(
      [shadchanus],
      [],
      [resourceWithCreateRoute],
      ["/widget/new"],
    );

    // Assert
    await expect
      .element(screen.getByText(GUARDED_CONTENT))
      .not.toBeInTheDocument();
    expect(getPathname()).toBe("/");
  });

  it("leaves /widget/new reachable when the active context matches", async () => {
    // Act
    const { screen, getPathname } = await renderRoutes(
      [household],
      [],
      [resourceWithCreateRoute],
      ["/widget/new"],
    );

    // Assert
    await expect.element(screen.getByText(GUARDED_CONTENT)).toBeInTheDocument();
    expect(getPathname()).toBe("/widget/new");
  });
});

describe("CRM route wiring — real manifest (Story 8.1 review F1/AC-7), redirect direction", () => {
  it.each(["/inbox_items", "/tasks"])(
    "redirects %s to / when the active context is shadchanus",
    async (path) => {
      // Act — the real routeManifest.ts entries, exactly as root/CRM.tsx's
      // DesktopAdmin registers them. The guard fires before the real
      // (heavy) household screen ever mounts, so this is safe to run against
      // production components, not stand-ins.
      const { screen, getPathname } = await renderRoutes(
        [shadchanus],
        routesFor("desktop", "shell"),
        resourcesFor("desktop"),
        [path],
      );

      // Assert
      await expect.element(screen.getByText(HOME)).toBeInTheDocument();
      expect(getPathname()).toBe("/");
    },
  );

  it.each(["/reminders", "/share"])(
    "redirects the %s custom route to / when the active context is shadchanus",
    async (path) => {
      // Act
      const { screen, getPathname } = await renderRoutes(
        [shadchanus],
        routesFor("desktop", "shell"),
        resourcesFor("desktop"),
        [path],
      );

      // Assert
      await expect.element(screen.getByText(HOME)).toBeInTheDocument();
      expect(getPathname()).toBe("/");
    },
  );

  // The singles, shadchanim, references, and shidduchim create/list routes
  // are intentionally reachable from a standalone shadchanus context. Their
  // context arrays are asserted in routeManifest.test.ts; this suite keeps
  // the redirect-direction assertion for household-only routes only.

  // Story 8.5 (AC-8): the mirror direction of every case above — 8.1 left
  // `/connections` unguarded (a rendered placeholder, no `contextKind`
  // yet); this story's real `connections` resource sets
  // `contextKind: "shadchanus"`, so a household-active session must now be
  // redirected off it the same way a shadchanus session is redirected off
  // every household-only resource above. Runs against the real manifest —
  // the actual `ConnectionList` component never mounts if the guard is
  // wired correctly.
  it("redirects /connections to / when the active context is household", async () => {
    // Act — the real routeManifest.ts "connections" entry, exactly as
    // root/CRM.tsx's DesktopAdmin registers it. The guard fires before the
    // real ConnectionList ever mounts (this harness's stub dataProvider
    // only implements getMyContexts, so a real render would crash — the
    // reachable/positive direction, with a real working dataProvider, is
    // proven instead in connections/entityDescriptor.test.tsx and
    // connections/ConnectionList.test.tsx).
    const { screen, getPathname } = await renderRoutes(
      [household],
      routesFor("desktop", "shell"),
      resourcesFor("desktop"),
      ["/connections"],
    );

    // Assert
    await expect.element(screen.getByText(HOME)).toBeInTheDocument();
    expect(getPathname()).toBe("/");
  });
});

describe("buildDashboardRoute (Story 8.1 review F3, AC-5)", () => {
  const HOUSEHOLD_DASHBOARD_TEXT = "Household dashboard";
  const HouseholdDashboard = () => <div>{HOUSEHOLD_DASHBOARD_TEXT}</div>;

  const renderDashboard = async (contexts: MyContext[]) => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);
    const dataProvider = {
      getMyContexts: vi.fn().mockResolvedValue(contexts),
    } as unknown as CrmDataProvider;

    const DashboardRoute = buildDashboardRoute(HouseholdDashboard);

    return render(
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <DashboardRoute permissions={undefined} />
      </CoreAdminContext>,
    );
  };

  it("renders ShadchanDashboard, not the household dashboard, when the active context is shadchanus", async () => {
    // Act
    const screen = await renderDashboard([shadchanus]);

    // Assert
    await expect
      .element(screen.getByText("Your shadchanus workspace"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(HOUSEHOLD_DASHBOARD_TEXT))
      .not.toBeInTheDocument();
  });

  it("renders the household dashboard when the active context is household", async () => {
    // Act
    const screen = await renderDashboard([household]);

    // Assert
    await expect
      .element(screen.getByText(HOUSEHOLD_DASHBOARD_TEXT))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Your shadchanus workspace"))
      .not.toBeInTheDocument();
  });

  it("falls back to the household dashboard while the active context is still resolving", async () => {
    // Act — an empty contexts array, the same shape a cold-load login is
    // in before useMyContexts() resolves (mirrors RequireContextKind's own
    // fail-toward-the-shell posture: never flash the shadchanus empty
    // state before the real context is known).
    const screen = await renderDashboard([]);

    // Assert
    await expect
      .element(screen.getByText(HOUSEHOLD_DASHBOARD_TEXT))
      .toBeInTheDocument();
  });
});
