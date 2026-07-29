import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "@vitest/browser/context";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";
import type { DataProvider } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

// These assertions are about real, computed flexbox geometry (overflow,
// bounding rects) — meaningless without the real Tailwind-generated
// stylesheet actually applying to the rendered classes.
import "@/index.css";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import { buildEntityRoutes } from "./buildEntityRoutes";
import { Entity360 } from "./Entity360";
import type { EntityDescriptor } from "./entityDescriptor";
import { EntityShow } from "./EntityShow";
import { registerEntityDescriptor } from "./registry";

/** No whitespace at all — the only way a browser can avoid overflow with
 * this string is by breaking within it (AC 3 / UX-DR11). */
const unbroken = (label: string) => `${label}${"x".repeat(600)}`;

/** The viewport every other suite in this file expects going in — restored
 * in `afterEach` so no test here depends on another's viewport
 * (.claude/rules/testing.md#Test-isolation). */
const DEFAULT_VIEWPORT = { width: 1280, height: 720 } as const;

describe("Entity360 responsive layout", () => {
  afterEach(async () => {
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
  });

  it("keeps the shell root free of horizontal overflow at 375px with long unbroken content in every region", async () => {
    // Arrange
    await page.viewport(375, 720);

    // Act
    const screen = await render(
      <Entity360
        breadcrumb={<span>{unbroken("breadcrumb")}</span>}
        identityHeader={<span>{unbroken("identity")}</span>}
        statBand={<span>{unbroken("stat")}</span>}
        alertSlot={<span>{unbroken("alert")}</span>}
        tabBar={<span>{unbroken("tabs")}</span>}
        rightRail={<span>{unbroken("rail")}</span>}
      >
        <span>{unbroken("content")}</span>
      </Entity360>,
    );
    const root = screen.container.children[0] as HTMLElement;

    // Assert — no horizontal scrollbar would be needed to see all content.
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  });

  it("stacks the right rail below the content column at 375px", async () => {
    // Arrange
    await page.viewport(375, 720);

    // Act
    const screen = await render(
      <Entity360 rightRail={<div data-role="rail">RAIL</div>}>
        <div data-role="content">CONTENT</div>
      </Entity360>,
    );
    const content = screen.container.querySelector(
      '[data-role="content"]',
    ) as HTMLElement;
    const rail = screen.container.querySelector(
      '[data-role="rail"]',
    ) as HTMLElement;

    // Assert
    expect(rail.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      content.getBoundingClientRect().bottom,
    );
  });

  it("places the right rail beside the content column at 1280px", async () => {
    // Arrange
    await page.viewport(1280, 720);

    // Act
    const screen = await render(
      <Entity360 rightRail={<div data-role="rail">RAIL</div>}>
        <div data-role="content">CONTENT</div>
      </Entity360>,
    );
    const content = screen.container.querySelector(
      '[data-role="content"]',
    ) as HTMLElement;
    const rail = screen.container.querySelector(
      '[data-role="rail"]',
    ) as HTMLElement;

    // Assert
    expect(rail.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      content.getBoundingClientRect().right,
    );
  });
});

/**
 * Epic 3 part 1 verification gate, defect 1 — the test above proves only
 * that `Entity360` lays out a hand-supplied `children`/`rightRail` pair
 * correctly; it says nothing about whether `EntityShow` (the only real
 * caller) actually supplies them that way. Before the fix, `EntityShow` put
 * the whole tab UI — strip AND panel — into `Entity360`'s `tabBar` prop and
 * left `children` undefined, so the rail rendered alone in the content row,
 * below the tab UI, not beside its content. This suite exercises the real
 * `EntityShow` composition (`buildEntityRoutes` + `EntityShow`, the same
 * harness `EntityShow.test.tsx` uses) instead of hand-supplied props, so it
 * is falsifiable against that regression. Confirmed red against the
 * pre-fix `EntityShow` (`tabBar={<Entity360Tabs tabs={tabs}/>}`, no
 * `children`) and green after the fix (`tabBar={<Entity360TabStrip/>}`,
 * `children={<Entity360TabPanel/>}`) — see this story's final report for
 * the transcript.
 */
describe("EntityShow composition — the right rail lands beside the tab content, not hand-supplied children (defect 1 regression)", () => {
  const FIXTURE_RESOURCE = "entity360-responsive-fixture";

  const registerFixtureDescriptor = (): void => {
    const descriptor: EntityDescriptor = {
      name: FIXTURE_RESOURCE,
      label: "Fixture",
      buildRecordPath: (id) => `/${FIXTURE_RESOURCE}/${id}`,
      rightRail: () => <div data-role="rail">RAIL</div>,
      tabs: [
        {
          key: "overview",
          render: () => <div data-role="content">CONTENT</div>,
        },
      ],
    };
    registerEntityDescriptor(descriptor, { replace: true });
  };

  const renderEntityShow = async () => {
    // Story 3.4: `EntityShow` calls `useViewerRole()`; seeded empty (no
    // active context) so this fixture, which declares no `visibleTo`, keeps
    // rendering exactly as before.
    const queryClient = new QueryClient();
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, []);
    const dataProvider = {
      getOne: vi.fn().mockResolvedValue({ data: { id: 1 } }),
      getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getMyContexts: vi.fn().mockResolvedValue([]),
    } as unknown as DataProvider;

    return render(
      <TestMemoryRouter initialEntries={["/1"]}>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <ResourceContextProvider value={FIXTURE_RESOURCE}>
            {buildEntityRoutes({ List: () => null, Show: EntityShow })}
          </ResourceContextProvider>
        </CoreAdminContext>
      </TestMemoryRouter>,
    );
  };

  afterEach(async () => {
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
  });

  it("places the descriptor's active tab content beside the descriptor's right rail at 1280px", async () => {
    // Arrange
    registerFixtureDescriptor();
    await page.viewport(1280, 720);

    // Act
    const screen = await renderEntityShow();
    await expect.element(screen.getByText("CONTENT")).toBeInTheDocument();
    const content = screen.container.querySelector(
      '[data-role="content"]',
    ) as HTMLElement;
    const rail = screen.container.querySelector(
      '[data-role="rail"]',
    ) as HTMLElement;

    // Assert
    expect(rail.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      content.getBoundingClientRect().right,
    );
  });
});
