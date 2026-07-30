import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  ResourceContextProvider,
  TestMemoryRouter,
} from "ra-core";
import { QueryClient } from "@tanstack/react-query";
import { Route, Routes } from "react-router";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { MemberRole, MyContext } from "../types";
import { buildEntityRoutes } from "../entity360/buildEntityRoutes";
import { EntityShow } from "../entity360/EntityShow";
// Side-effect import — registers the REAL shidduchimDescriptor, exactly like
// `<entity>/index.ts` does at boot. This file proves the real registered
// object's `medical` tab wiring, not a synthetic fixture — the generic
// denial mechanism itself (a viewer without the allowed role never sees a
// restricted tab or triggers its render) is already proven once, in general,
// by `entity360/EntityShow.permissions.test.tsx`.
import "./entityDescriptor";

/**
 * Story 5.5, AC 2 / AC 5: `shidduchimDescriptor`'s real `medical` tab entry
 * carries `visibleTo: ["parent_admin", "self_manager"]`. Mounted through the
 * real FakeRest data provider (not a mock) because the shidduch's Overview
 * tab — the default landing tab — performs several of its own fetches
 * (`ShidduchOverviewTab.tsx`: redts, shadchanim, shidduch_schools), the same
 * "real provider, not a mock" reasoning `PhotoTab.test.tsx` and
 * `MedicalTab.test.tsx` use for their own deep component trees.
 */

const contextFor = (role: MemberRole): MyContext => ({
  account_id: 1,
  kind: "household",
  name: "Fixture Household",
  role,
  is_active: true,
});

const renderShidduchShow = async (role?: MemberRole) => {
  const db = generateData();
  const shidduchId = db.shidduchim[0].id;
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });
  const contexts = role ? [contextFor(role)] : [];
  dataProvider.getMyContexts = vi.fn().mockResolvedValue(contexts);
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);

  const screen = await render(
    <TestMemoryRouter initialEntries={[`/shidduchim/${shidduchId}`]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <Routes>
          <Route
            path="/shidduchim/*"
            element={
              <ResourceContextProvider value="shidduchim">
                {buildEntityRoutes({ List: () => null, Show: EntityShow })}
              </ResourceContextProvider>
            }
          />
        </Routes>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen };
};

describe("shidduchimDescriptor — the real medical tab's visibleTo (Story 5.5, AC 2)", () => {
  it.each(["parent_admin", "self_manager"] as const)(
    "shows the Medical tab to a %s viewer",
    async (role) => {
      // Act
      const { screen } = await renderShidduchShow(role);

      // Assert
      await expect
        .element(screen.getByRole("tab", { name: "Medical" }))
        .toBeInTheDocument();
    },
  );

  it.each(["single", "helper"] as const)(
    "never renders the Medical tab (or its label anywhere) for a %s viewer",
    async (role) => {
      // Act
      const { screen } = await renderShidduchShow(role);

      // Assert — absent from the DOM entirely (AC 2), not merely un-selected.
      await expect
        .element(screen.getByRole("tab", { name: "Overview" }))
        .toBeInTheDocument();
      await expect
        .element(screen.getByRole("tab", { name: "Medical" }))
        .not.toBeInTheDocument();
      expect(screen.container.textContent ?? "").not.toContain("Medical");
    },
  );

  it("a shadchan viewer never sees the Medical tab (no membership path into a household row, AD-20)", async () => {
    // Act
    const { screen } = await renderShidduchShow("shadchan");

    // Assert — the Overview anchor proves the tab strip has actually
    // mounted before the negative assertion runs; without it, `not
    // .toBeInTheDocument()` on "Medical" is satisfied trivially at t=0
    // (before render), so this case would stay green even if `visibleTo`
    // were deleted from the descriptor entirely.
    await expect
      .element(screen.getByRole("tab", { name: "Overview" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("tab", { name: "Medical" }))
      .not.toBeInTheDocument();
  });

  it("an unresolved role (no active membership) never sees the Medical tab — AC 2(b), fails closed", async () => {
    // Act — no role at all, mirroring a caller whose active context resolved
    // but who holds no active membership in it (`useViewerRole()` returns
    // `role: undefined`, `isPending: false`). `EntityShow.tsx`'s own doc
    // comment states this must fail closed exactly like an insufficient
    // role; this is that behaviour asserted on the real registered
    // descriptor rather than assumed.
    const { screen } = await renderShidduchShow();

    // Assert
    await expect
      .element(screen.getByRole("tab", { name: "Overview" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("tab", { name: "Medical" }))
      .not.toBeInTheDocument();
  });
});

describe("shidduchimDescriptor — tab strip order (Story 5.6, AC 1 / AC 2)", () => {
  it("renders all ten canonical tabs, Files after Medical and External links after Diligence", async () => {
    // Act — the rendered strip, not the descriptor literal (Task 5's own
    // instruction): a parent_admin sees every tab, including the
    // parent_admin/self_manager-gated Medical tab.
    const { screen } = await renderShidduchShow("parent_admin");
    await expect
      .element(screen.getByRole("tab", { name: "Overview" }))
      .toBeInTheDocument();

    // Assert
    const names = screen
      .getByRole("tab")
      .elements()
      .map((element) => element.textContent?.trim());
    expect(names).toEqual([
      "Overview",
      "Resume",
      "Photo",
      "Medical",
      "Files",
      "Diligence",
      "External links",
      "Notes",
      "Tasks",
      "Activity",
    ]);
  });
});
