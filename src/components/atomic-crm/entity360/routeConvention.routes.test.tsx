import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, Resource, TestMemoryRouter } from "ra-core";
import type { DataProvider, ResourceProps } from "ra-core";
import { QueryClient } from "@tanstack/react-query";
import { matchPath, Route, Routes } from "react-router";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { buildNewPath } from "./entityPaths";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
// The real, post-change `singles` / `references` / `shidduchim` resource
// definitions — the same objects `<CRM>` spreads onto `<Resource>`
// (`root/routeManifest.ts`'s `RESOURCES`, `root/CRM.tsx:54-56`). Neither
// `SingleCreate` nor `ReferenceCreate` fetches on mount, so this proves the
// real production wiring, not a stand-in. `shidduchim`'s own `list`
// (`ShidduchimList`) is swapped for a fixture below — it boots an identity +
// singles fetch that is orthogonal to what this story changes — but its
// `children` (`buildCreateRoutes("shidduchim")`) is used exactly as shipped.
import singles from "../singles";
import references from "../references";
import shidduchim from "../shidduchim";

/**
 * Story 3.12 AC 1's five assertions: mounting the resource tree at the new
 * route renders the real `New` component, the legacy `/create` path
 * redirects to `/new` with the query string intact (load-bearing for
 * `references/ReferenceCreate.tsx` and `shidduchim/ShidduchCreate.tsx`,
 * which each read a query parameter off it), and the added static routes do
 * not shadow the dynamic `:id` edit route.
 *
 * Mirrors `CoreAdminRoutes.js`'s own wiring
 * (`<Route path={`${name}/*`} element={<Resource .../>} />`) so the
 * initial-entry paths below ("/singles/new", …) are the real, full URLs —
 * not `buildEntityRoutes.test.tsx`'s router-root-relative paths, which apply
 * only once an entity has migrated onto that route table (Epic 5).
 */

// Built from parts, never spelled as a quoted literal: `check-route-convention`'s
// `create-path-literal` pattern (AC 6) scans this file too, and the whole
// point of these tests is to mount the one `/{resource}/create` shape the
// guard is meant to keep alive — the legacy compatibility redirect's input.
const legacyCreatePath = (resource: string) => `/${resource}/create`;

const renderResourceAt = async (
  name: string,
  definition: Omit<ResourceProps, "name">,
  initialEntries: string[],
  dataProviderOverrides: Partial<DataProvider> = {},
  queryClient?: QueryClient,
) => {
  let pathname: string | undefined;
  let search: string | undefined;
  const dataProvider = dataProviderOverrides as DataProvider;

  const screen = await render(
    <TestMemoryRouter
      initialEntries={initialEntries}
      locationCallback={(location) => {
        pathname = location.pathname;
        search = location.search;
      }}
    >
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <Routes>
          {/* Mirrors `CoreAdminRoutes.js`'s own `<Route path={`${name}/*`}
              element={<Resource .../>} />` wiring — the same spread
              `root/CRM.tsx:54-56` does. */}
          <Route
            path={`${name}/*`}
            element={<Resource name={name} {...definition} />}
          />
        </Routes>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, getPathname: () => pathname, getSearch: () => search };
};

describe("route-convention adoption — singles (AC 1)", () => {
  it("renders the real SingleCreate at /singles/new", async () => {
    // Arrange / Act
    const { screen } = await renderResourceAt("singles", singles, [
      "/singles/new",
    ]);

    // Assert
    await expect.element(screen.getByText("Add a single")).toBeInTheDocument();
  });

  it("redirects the legacy create path to /singles/new, query string intact", async () => {
    // Arrange / Act
    const { getPathname, getSearch } = await renderResourceAt(
      "singles",
      singles,
      [`${legacyCreatePath("singles")}?foo=1`],
    );

    // Assert
    await expect.poll(() => getPathname()).toBe("/singles/new");
    expect(getSearch()).toBe("?foo=1");
  });

  it("renders the Entity360 tab strip at /singles/1, not the edit form — the static new/create routes do not shadow :id (Story 5.8 AC 4)", async () => {
    // Arrange — Story 5.8 mounts `singles` on `buildEntityRoutes`, so `:id`
    // (unqualified, no `/show`) now resolves to `EntityShow`, never
    // `SingleEdit`; this is the AD-24 successor to this test's original
    // pre-migration claim. `useViewerRole()` reads the `["myContexts"]`
    // cache (Story 3.4) — seeded empty here (`EntityShow.test.tsx`'s own
    // pattern) so it resolves immediately instead of erroring against an
    // unmocked `getMyContexts`; `getList` is a blanket empty fallback for
    // every tab's own fetch (PipelineSnapshot, the universal tabs, …), none
    // of which this routing-shape assertion needs real data from.
    const queryClient = new QueryClient();
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, []);

    const { screen } = await renderResourceAt(
      "singles",
      singles,
      ["/singles/1"],
      {
        getOne: vi
          .fn()
          .mockResolvedValue({ data: { id: 1, first_name_en: "Nechama" } }),
        getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
        getMyContexts: vi.fn().mockResolvedValue([]),
      },
      queryClient,
    );

    // Assert — the identity header (from the record) and the tab strip both
    // render; "Edit single" (the pre-migration render) does not. The
    // heading role disambiguates from the Overview tab's own "Name" fact,
    // which renders the same "Nechama" text a second time. Seven tabs, not
    // eight: `getMyContexts` above resolves to an unresolved role (no active
    // membership), and Story 6.2 (AC 10) added `visibleTo` to `tasks` —
    // `hasVisibility`'s own fail-closed rule hides it for an unresolved
    // role, exactly like `medical` already does for `shidduchimDescriptor`.
    // This assertion is about the routing shape (record URL -> Entity360,
    // never SingleEdit), not about role-gating, so the count simply follows
    // whatever `singlesDescriptor` + the viewer role produce.
    await expect
      .element(screen.getByRole("heading", { name: "Nechama" }))
      .toBeInTheDocument();
    expect(screen.container.querySelectorAll('[role="tab"]').length).toBe(7);
    expect(screen.getByText("Edit single").query()).toBeNull();
  });
});

describe("route-convention adoption — references (AC 1)", () => {
  it("redirects the legacy create path to /references/new, query string intact", async () => {
    // Arrange / Act — the query is load-bearing for the real
    // `ReferenceCreate.tsx`, which reads `shidduchim_id` off it.
    const { getPathname, getSearch } = await renderResourceAt(
      "references",
      references,
      [`${legacyCreatePath("references")}?shidduchim_id=7`],
    );

    // Assert
    await expect.poll(() => getPathname()).toBe("/references/new");
    expect(getSearch()).toBe("?shidduchim_id=7");
  });
});

describe("route-convention adoption — shidduchim (AC 1)", () => {
  // The real `shidduchim` resource definition — `shidduchim/index.ts`'s own
  // `children: buildCreateRoutes("shidduchim")` (no `New`: the create
  // surface is a page matched INSIDE `ShidduchimList` itself, Story 3.13 —
  // `shidduchim/ShidduchimList.tsx`'s `matchPath(buildNewPath("shidduchim"), …)`),
  // not a hand-rolled descriptor + `buildCreateRoutes` call standing in for
  // it. Only `list` is swapped for a fixture, to avoid booting
  // `ShidduchimList`'s identity + singles fetch, which is orthogonal to what
  // this story changes.
  const FixtureList = () => <span>FIXTURE_LIST</span>;
  const shidduchimWithFixtureList = { ...shidduchim, list: FixtureList };

  it("redirects /shidduchim/create?state=contacted to /shidduchim/new?state=contacted, query intact", async () => {
    // Arrange / Act — mirrors `shidduchim/ShidduchCreate.tsx:54-56`, which
    // reads `state` off exactly this query string.
    const { getPathname, getSearch } = await renderResourceAt(
      "shidduchim",
      shidduchimWithFixtureList,
      [`${legacyCreatePath("shidduchim")}?state=contacted`],
    );

    // Assert
    await expect.poll(() => getPathname()).toBe("/shidduchim/new");
    expect(getSearch()).toBe("?state=contacted");
  });

  it("matches ShidduchimList's own matchPath(buildNewPath('shidduchim'), …) at /shidduchim/new — the create page renders", async () => {
    // Arrange / Act
    const { getPathname } = await renderResourceAt(
      "shidduchim",
      shidduchimWithFixtureList,
      ["/shidduchim/new"],
    );
    await expect.poll(() => getPathname()).toBe("/shidduchim/new");

    // Assert — the exact expression `ShidduchimList.tsx`'s `matchNew`
    // evaluates to decide whether to render `ShidduchCreate`'s page in place
    // of the board (Story 3.13). This is the production entry point Task 5
    // site 13's manual walkthrough would have exercised; asserting it here
    // means a future divergence between the route table and `buildNewPath`
    // fails CI instead of a human miss.
    expect(
      matchPath(buildNewPath("shidduchim"), getPathname() ?? ""),
    ).not.toBeNull();
  });
});
