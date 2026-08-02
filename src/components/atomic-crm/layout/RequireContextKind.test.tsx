import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";
import { Route, Routes } from "react-router";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { MyContext } from "../types";
import {
  RequireContextKind,
  type RequireContextKindProps,
} from "./RequireContextKind";

/**
 * Story 8.1 (AC-3/AC-7): the route guard primitive. Mirrors
 * `entity360/routeConvention.routes.test.tsx`'s `TestMemoryRouter` +
 * `locationCallback` pattern to observe whether a `<Navigate>` actually
 * fired, and `MobileNavigation.test.tsx`'s pattern for seeding
 * `useMyContexts()` via a pre-populated `QueryClient` (no `waitFor` needed).
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

const GUARDED_CONTENT = "Household-only content";

const renderGuarded = async (
  contexts: MyContext[],
  guardProps: Pick<RequireContextKindProps, "kind" | "redirectTo">,
  initialEntries: string[],
) => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);
  const dataProvider = {
    getMyContexts: vi.fn().mockResolvedValue(contexts),
  } as unknown as CrmDataProvider;

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
          <Route
            path="/guarded"
            element={
              <RequireContextKind {...guardProps}>
                <div>{GUARDED_CONTENT}</div>
              </RequireContextKind>
            }
          />
          <Route path="/" element={<div>Home</div>} />
        </Routes>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, getPathname: () => pathname };
};

describe("RequireContextKind (Story 8.1, AC-3/AC-7)", () => {
  it("redirects to redirectTo when the active context is shadchanus but the route requires household", async () => {
    // Arrange / Act
    const { screen, getPathname } = await renderGuarded(
      [shadchanus],
      { kind: "household", redirectTo: "/" },
      ["/guarded"],
    );

    // Assert — the guarded content never renders, and the location moved.
    await expect
      .element(screen.getByText(GUARDED_CONTENT))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Home")).toBeInTheDocument();
    expect(getPathname()).toBe("/");
  });

  it("redirects the mirror case: a household context against a kind='shadchanus' guard", async () => {
    // Arrange / Act
    const { screen, getPathname } = await renderGuarded(
      [household],
      { kind: "shadchanus", redirectTo: "/" },
      ["/guarded"],
    );

    // Assert
    await expect
      .element(screen.getByText(GUARDED_CONTENT))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Home")).toBeInTheDocument();
    expect(getPathname()).toBe("/");
  });

  it("renders children when the active context's kind matches the guard", async () => {
    // Arrange / Act
    const { screen, getPathname } = await renderGuarded(
      [household],
      { kind: "household", redirectTo: "/" },
      ["/guarded"],
    );

    // Assert
    await expect.element(screen.getByText(GUARDED_CONTENT)).toBeInTheDocument();
    expect(getPathname()).toBe("/guarded");
  });

  it("renders children (never redirects) while useMyContexts() has no data yet", async () => {
    // Arrange / Act — an empty contexts array is the same shape
    // `useActiveContextKind()` treats as "still resolving" (AD-2 defense in
    // depth, not the primary guarantee, so a load-flicker false negative is
    // preferable to a redirect loop on every cold load).
    const { screen, getPathname } = await renderGuarded(
      [],
      { kind: "shadchanus", redirectTo: "/" },
      ["/guarded"],
    );

    // Assert
    await expect.element(screen.getByText(GUARDED_CONTENT)).toBeInTheDocument();
    expect(getPathname()).toBe("/guarded");
  });
});
