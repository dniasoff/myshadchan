import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

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
 *
 * Review finding #2: `getMyContexts` is mocked as `mockResolvedValue`, never
 * a bare `vi.fn()` — react-query's default `refetchOnMount` calls it in the
 * background even though the cache is pre-seeded (below), and a `vi.fn()`
 * resolving to `undefined` left every test's `useMyContexts()` in a
 * silently-swallowed error state that happened to pass only on the seeded
 * cache. Every test now round-trips through the real hook/provider seam.
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
  contexts: MyContext[],
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getMyContexts: vi.fn().mockResolvedValue(contexts),
    switchActiveContext: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as CrmDataProvider;

// Seeds the query cache directly rather than waiting on a resolved
// getMyContexts() call, so every test renders with data present from the
// first paint — no loading-state flicker to race against. getMyContexts
// itself is still a genuine mockResolvedValue (finding #2): react-query's
// default refetchOnMount calls it in the background regardless of the seed.
const renderSwitcher = async (
  contexts: MyContext[],
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);
  const dataProvider = buildDataProvider(contexts, dataProviderOverrides);
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
        <Notification />
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

    // Assert (AC-2) — the accessible name CONTAINS the active row's name
    // and kind (per the story's own "Decided by" wording), inside a fuller
    // "Switch context: …" label (review finding #10) that disambiguates
    // this pill from TopBar's pre-existing SingleSwitcherPill sitting right
    // beside it.
    await expect
      .element(
        screen.getByRole("button", {
          name: "Switch context: The Klein Family · Household",
        }),
      )
      .toBeInTheDocument();
  });

  it("labels bundle contexts as a preview", async () => {
    const previewContext: MyContext = {
      ...household,
      is_demo: true,
    };

    const { screen } = await renderSwitcher([previewContext, shadchanus]);

    await expect
      .element(
        screen.getByRole("button", {
          name: "Switch context: The Klein Family · Household · Preview",
        }),
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

  it("marks the active context row with a check, and no other row", async () => {
    // Arrange — Task 4: rows are "name + kind + active check", shared by
    // both render surfaces via `ContextMenuItems`.
    const { screen } = await renderSwitcher([household, shadchanus]);

    // Act
    await screen.getByRole("button").click();

    // Assert
    const menuItems = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    );
    const activeRow = menuItems.find((item) =>
      item.textContent?.includes("The Klein Family · Household"),
    );
    const inactiveRow = menuItems.find((item) =>
      item.textContent?.includes("My Account · Shadchanus"),
    );
    expect(activeRow?.querySelector("svg")).not.toBeNull();
    expect(inactiveRow?.querySelector("svg")).toBeNull();
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

  it("does not switch, invalidate, or navigate when re-selecting the already-active context", async () => {
    // Arrange — review finding #9: selecting the pill's own current context
    // must be a true no-op, not a wasted full-cache invalidation + redirect
    // to "/" away from whatever the user was looking at.
    const switchActiveContext = vi.fn().mockResolvedValue(undefined);
    const { screen, queryClient, getPathname } = await renderSwitcher(
      [household, shadchanus],
      { switchActiveContext },
    );
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    // Act
    await screen.getByRole("button").click();
    await screen
      .getByRole("menuitem", { name: "The Klein Family · Household" })
      .click();

    // Assert
    expect(switchActiveContext).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(getPathname()).toBe("/shidduchim/1");
  });

  it("notifies (and still renders nothing) when getMyContexts fails to load", async () => {
    // Arrange — review finding #4: getMyContexts() is fail-loud
    // (dataProvider.ts), so a rejected query must surface visibly rather
    // than being indistinguishable from "only one context" (AC-1's own
    // empty-fragment render). No cache is pre-seeded here — the query must
    // genuinely reject.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const dataProvider = {
      getMyContexts: vi.fn().mockRejectedValue(new Error("network error")),
      switchActiveContext: vi.fn(),
    } as unknown as CrmDataProvider;

    const screen = await render(
      <TestMemoryRouter initialEntries={["/shidduchim/1"]}>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <ContextSwitcher />
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert
    await expect
      .element(screen.getByText("Couldn't load your contexts."))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
  });
});
