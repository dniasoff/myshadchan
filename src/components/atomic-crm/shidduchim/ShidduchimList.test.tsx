import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, Resource, TestMemoryRouter } from "ra-core";
import type { AuthProvider } from "ra-core";
import { Route, Routes } from "react-router";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { PIPELINE_STATES } from "./pipelineStates";

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
