import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { MyContext } from "../types";
import { ContextSwitcher } from "./ContextSwitcher";

/**
 * Pins Story 2.4's contract: AC-1 (empty for fewer than 2 contexts), AC-2
 * (the pill always names the active context and its kind), AC-3 (switch ->
 * invalidate everything -> navigate home, in that order) and AC-4 (every
 * context is listed, including the one not currently active).
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
  is_active: false,
};

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getMyContexts: vi.fn(),
    switchActiveContext: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as CrmDataProvider;

// Seeds the query cache directly rather than waiting on a resolved
// getMyContexts() call, so every test renders with data present from the
// first paint — no loading-state flicker to race against.
const renderSwitcher = async (
  contexts: MyContext[],
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);
  const dataProvider = buildDataProvider(dataProviderOverrides);
  let pathname: string | undefined;

  const screen = await render(
    <TestMemoryRouter
      initialEntries={["/shidduchim/1"]}
      locationCallback={(location) => {
        pathname = location.pathname;
      }}
    >
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ContextSwitcher />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, queryClient, dataProvider, getPathname: () => pathname };
};

describe("ContextSwitcher", () => {
  it("renders nothing for a login with a single context", async () => {
    // Arrange / Act
    const { screen } = await renderSwitcher([household]);

    // Assert — no pill, no disabled control, no visual trace (AC-1).
    await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
  });

  it("shows a labelled pill naming the active context and its kind", async () => {
    // Arrange / Act
    const { screen } = await renderSwitcher([household, shadchanus]);

    // Assert (AC-2)
    await expect
      .element(
        screen.getByRole("button", { name: "The Klein Family · Household" }),
      )
      .toBeInTheDocument();
  });

  it("lists every context, including the one not currently active", async () => {
    // Arrange
    const { screen } = await renderSwitcher([household, shadchanus]);

    // Act
    await screen.getByRole("button").click();

    // Assert (AC-4)
    await expect
      .element(screen.getByText("My Account · Shadchanus"))
      .toBeInTheDocument();
  });

  it("switches context, invalidates every query, then navigates home, in that order", async () => {
    // Arrange
    const callOrder: string[] = [];
    const switchActiveContext = vi.fn(async () => {
      callOrder.push("switchActiveContext");
    });
    const { screen, queryClient, getPathname } = await renderSwitcher(
      [household, shadchanus],
      { switchActiveContext },
    );
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async () => {
      callOrder.push("invalidateQueries");
    });

    // Act
    await screen.getByRole("button").click();
    await screen.getByText("My Account · Shadchanus").click();

    // Assert (AC-3) — navigate("/") can only run once the two prior awaits
    // in ContextSwitcher's handleSelect resolve, so the pathname flipping
    // to "/" is itself proof navigate ran last.
    await expect.poll(() => getPathname()).toBe("/");
    expect(callOrder).toEqual(["switchActiveContext", "invalidateQueries"]);
    expect(switchActiveContext).toHaveBeenCalledWith(2);
    expect(switchActiveContext).toHaveBeenCalledTimes(1);
  });
});
