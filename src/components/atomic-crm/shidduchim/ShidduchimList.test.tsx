import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, Resource, TestMemoryRouter } from "ra-core";
import type { AuthProvider } from "ra-core";
import { Route, Routes } from "react-router";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";

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
 * `/shidduchim/new` renders the create page in place of the board — the
 * early return sits above `<List>` (`ShidduchimList.tsx`'s `matchNew`
 * check), so neither the board nor `ShidduchimLayout`'s own `isPending` gate
 * sits in front of the page, and the board's own heading never mounts. The
 * second `it` mounts the same harness at `/shidduchim` and asserts the board
 * heading *does* render there — proof the negative assertion above is
 * actually exercising the code under test, not an unreachable heading.
 */

const buildAuthProvider = (): AuthProvider =>
  ({
    getIdentity: vi.fn().mockResolvedValue({ id: 1, fullName: "Test User" }),
    checkAuth: vi.fn().mockResolvedValue(undefined),
    checkError: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  }) as unknown as AuthProvider;

const buildDataProvider = (): CrmDataProvider =>
  ({
    getList: vi.fn((resource: string) => {
      if (resource === "singles") {
        return Promise.resolve({
          data: [{ id: 1, first_name_en: "Chaya", status: "active" }],
          total: 1,
        });
      }
      return Promise.resolve({ data: [], total: 0 });
    }),
    getMany: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    createShidduch: vi.fn(),
  }) as unknown as CrmDataProvider;

const renderShidduchimResourceAt = async (initialEntries: string[]) =>
  render(
    <TestMemoryRouter initialEntries={initialEntries}>
      <CoreAdminContext
        dataProvider={buildDataProvider()}
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

describe("ShidduchimList — the create page sits above <List> (AC 1)", () => {
  it("renders the create heading and never the board heading at /shidduchim/new", async () => {
    // Arrange / Act
    const screen = await renderShidduchimResourceAt(["/shidduchim/new"]);

    // Assert
    await expect
      .element(screen.getByRole("heading", { name: "Add a suggestion" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("heading", { name: /^Pipeline/ }))
      .not.toBeInTheDocument();
  });

  it("renders the board heading at /shidduchim — the negative assertion above is discriminating", async () => {
    // Arrange / Act
    const screen = await renderShidduchimResourceAt(["/shidduchim"]);

    // Assert
    await expect
      .element(screen.getByRole("heading", { name: /^Pipeline/ }))
      .toBeInTheDocument();
  });
});
