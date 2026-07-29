import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { ThemeProvider } from "@/components/admin/theme-provider";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
// Side-effect import: the "Add a suggestion" CreateButton renders
// `buildNewPath("shidduchim")`, which requires the resource's descriptor to
// be registered first (`entity360/registry.ts`) — the same reason
// `shidduchim/index.ts` imports this file before its own component.
import "../shidduchim/entityDescriptor";
import type { MyContext } from "../types";
import { MobileNavigation } from "./MobileNavigation";

/**
 * Story 4.4: pins AC-5 (mobile "More" overflow holds Inbox, Tasks,
 * Reminders and Settings, and highlights "More" as active for both) and
 * AC-6 (the context switcher's mobile entry point lives here, gated the
 * same way `ContextSwitcher` gates the desktop pill — nothing for a
 * 1-context login, every context listed for 2+).
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

const buildDataProvider = (contexts: MyContext[]): CrmDataProvider =>
  ({
    getMyContexts: vi.fn().mockResolvedValue(contexts),
    switchActiveContext: vi.fn().mockResolvedValue(undefined),
  }) as unknown as CrmDataProvider;

const renderMobileNavigation = async (
  contexts: MyContext[],
  initialEntries: string[] = ["/"],
) => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);
  const dataProvider = buildDataProvider(contexts);

  return render(
    <TestMemoryRouter initialEntries={initialEntries}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ThemeProvider>
          <MobileNavigation />
        </ThemeProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("MobileNavigation — More menu contents (AC-5)", () => {
  it("lists Inbox, Tasks, Reminders and Settings, in that order", async () => {
    // Arrange / Act
    const screen = await renderMobileNavigation([household]);
    await screen.getByRole("button", { name: "More" }).click();

    // Assert — wait for the menu to be fully mounted before reading DOM
    // order directly (Radix portals the content to `document.body`, outside
    // the render root, so a document-wide read is required either way).
    await expect
      .element(screen.getByRole("menuitem", { name: "Settings" }))
      .toBeInTheDocument();

    const labels = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).map((item) => item.textContent?.trim());
    const orderedLabels = labels.filter((label): label is string =>
      ["Inbox", "Tasks", "Reminders", "Settings"].includes(label ?? ""),
    );
    expect(orderedLabels).toEqual(["Inbox", "Tasks", "Reminders", "Settings"]);
  });

  it("never renders a References item — RULING 7", async () => {
    // Arrange / Act
    const screen = await renderMobileNavigation([household]);
    await screen.getByRole("button", { name: "More" }).click();

    // Assert
    await expect
      .element(screen.getByRole("menuitem", { name: "References" }))
      .not.toBeInTheDocument();
  });

  it("renders no context section for a login with a single context", async () => {
    // Arrange / Act
    const screen = await renderMobileNavigation([household]);
    await screen.getByRole("button", { name: "More" }).click();

    // Assert — AC-1 semantics preserved: no visual trace at all.
    await expect
      .element(screen.getByText("The Klein Family", { exact: false }))
      .not.toBeInTheDocument();
  });

  it("lists every context, including the one not currently active, for a 2-context login", async () => {
    // Arrange / Act
    const screen = await renderMobileNavigation([household, shadchanus]);
    await screen.getByRole("button", { name: "More" }).click();

    // Assert
    await expect
      .element(screen.getByText("The Klein Family · Household"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("My Account · Shadchanus"))
      .toBeInTheDocument();
  });
});

describe("MobileNavigation — 'more' active-path matching (AC-5)", () => {
  it("highlights More when the current route is /inbox_items", async () => {
    // Arrange / Act
    const screen = await renderMobileNavigation([household], ["/inbox_items"]);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "More" }))
      .toHaveClass("text-primary");
  });

  it("highlights More when the current route is /tasks", async () => {
    // Arrange / Act
    const screen = await renderMobileNavigation([household], ["/tasks"]);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "More" }))
      .toHaveClass("text-primary");
  });

  it("does not highlight More on the dashboard route", async () => {
    // Arrange / Act
    const screen = await renderMobileNavigation([household], ["/"]);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "More" }))
      .not.toHaveClass("text-primary");
  });
});
