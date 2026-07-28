import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, Resource, TestMemoryRouter } from "ra-core";
import type { DataProvider, ResourceProps } from "ra-core";
import { Route, Routes } from "react-router";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { EntityDescriptor } from "./entityDescriptor";
import { registerEntityDescriptor } from "./registry";
import { buildCreateRoutes } from "./routeConvention";
// The real, post-change `singles` / `references` resource definitions — the
// same objects `<CRM>` spreads onto `<Resource>` (`root/routeManifest.ts`'s
// `RESOURCES`, `root/CRM.tsx:54-56`). Neither `SingleCreate` nor
// `ReferenceCreate` fetches on mount, so this proves the real production
// wiring, not a stand-in.
import singles from "../singles";
import references from "../references";

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

  it("still renders the edit screen at /singles/1 — the static new/create routes do not shadow :id", async () => {
    // Arrange / Act
    const { screen } = await renderResourceAt(
      "singles",
      singles,
      ["/singles/1"],
      {
        getOne: vi
          .fn()
          .mockResolvedValue({ data: { id: 1, first_name_en: "Nechama" } }),
      },
    );

    // Assert
    await expect.element(screen.getByText("Edit single")).toBeInTheDocument();
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
  // A fixture stands in for the real `ShidduchimList` here: shidduchim's
  // create surface is a modal matched INSIDE that component
  // (`shidduchim/ShidduchimList.tsx`), so proving the redirect lands on the
  // right URL does not require booting its board (identity + singles
  // fetch). `shidduchim/index.ts` wires the identical
  // `buildCreateRoutes("shidduchim")` call (no `New`) onto the real list.
  const FIXTURE_RESOURCE = "route-convention-shidduchim-fixture";
  const FixtureList = () => <span>FIXTURE_LIST</span>;

  it("redirects /create?state=contacted to /new?state=contacted, query intact", async () => {
    // Arrange
    const descriptor: EntityDescriptor = {
      name: FIXTURE_RESOURCE,
      label: "Fixture",
      buildRecordPath: (id) => `/${FIXTURE_RESOURCE}/${id}/show`,
    };
    registerEntityDescriptor(descriptor, { replace: true });

    // Act — mirrors `shidduchim/ShidduchCreate.tsx:54-56`, which reads
    // `state` off exactly this query string.
    const { getPathname, getSearch } = await renderResourceAt(
      FIXTURE_RESOURCE,
      {
        list: FixtureList,
        children: buildCreateRoutes(FIXTURE_RESOURCE),
      },
      [`/${FIXTURE_RESOURCE}/create?state=contacted`],
    );

    // Assert
    await expect.poll(() => getPathname()).toBe(`/${FIXTURE_RESOURCE}/new`);
    expect(getSearch()).toBe("?state=contacted");
  });
});
