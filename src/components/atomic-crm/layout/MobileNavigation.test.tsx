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
import { SHADCHANUS_NAV } from "./navItems";

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

    // Assert — AC-1 semantics preserved: no visual trace at all, and no
    // orphaned section label either.
    await expect
      .element(screen.getByText("The Klein Family", { exact: false }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Context")).not.toBeInTheDocument();

    // Review finding F1: a 1-context user must still see exactly the one
    // separator dividing the nav items from the theme items — not two
    // adjacent separators either side of an empty context section. Radix
    // portals menu content to `document.body`, outside the render root, so
    // a document-wide read is required (same reason the order test above
    // reads `document.querySelectorAll` directly).
    const separators = document.querySelectorAll('[role="separator"]');
    expect(separators).toHaveLength(1);
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

  it("labels the context section and brackets it with exactly two separators for a 2-context login", async () => {
    // Arrange / Act
    const screen = await renderMobileNavigation([household, shadchanus]);
    await screen.getByRole("button", { name: "More" }).click();

    // Assert — F2: the mobile section has no trigger naming the active
    // context (unlike the desktop pill), so it needs its own heading.
    await expect.element(screen.getByText("Context")).toBeInTheDocument();

    // One separator ahead of the section (dividing it from the nav items),
    // one behind it (dividing it from the theme items) — never adjacent.
    const separators = document.querySelectorAll('[role="separator"]');
    expect(separators).toHaveLength(2);
  });

  it("marks the active context row with a check, and no other row", async () => {
    // Arrange / Act
    const screen = await renderMobileNavigation([household, shadchanus]);
    await screen.getByRole("button", { name: "More" }).click();

    // Assert — Task 4: rows are "name + kind + active check". The mobile
    // section has no trigger naming the active context, so the check is the
    // only in-menu indicator of which one is live.
    const menuItems = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    );
    const activeContextRow = menuItems.find((item) =>
      item.textContent?.includes("The Klein Family · Household"),
    );
    const inactiveContextRow = menuItems.find((item) =>
      item.textContent?.includes("My Account · Shadchanus"),
    );
    expect(activeContextRow?.querySelector("svg")).not.toBeNull();
    expect(inactiveContextRow?.querySelector("svg")).toBeNull();
  });
});

describe("MobileNavigation — shadchanus context (Story 8.1, AC-1/AC-2/AC-7)", () => {
  it("renders no household-only path", async () => {
    // Arrange / Act — a single-context login always has that context active
    // (review F4: useActiveContextKind() no longer falls back to
    // contexts[0] when none is marked active, so a fixture must say so
    // explicitly rather than relying on that removed fallback).
    const screen = await renderMobileNavigation([
      { ...shadchanus, is_active: true },
    ]);
    await screen.getByRole("button", { name: "More" }).click();

    // Assert — AC-7. The guarded set is exactly `navItems.test.ts`'s
    // GUARDED_HOUSEHOLD_PATHS: /shidduchim, /singles and /shadchanim are NOT
    // household-only — a shadchanus account owns its own suggestions,
    // singles and shadchan book (see SHADCHANUS_NAV's docstring), and the
    // next test pins that they are reachable here.
    const links = Array.from(document.querySelectorAll("a[href]")).map((link) =>
      link.getAttribute("href"),
    );
    for (const guardedPath of [
      "/references",
      "/inbox_items",
      "/tasks",
      "/reminders",
    ]) {
      expect(links).not.toContain(guardedPath);
    }
  });

  it("reaches every SHADCHANUS_NAV destination — bar slots plus the More menu", async () => {
    // Arrange / Act — the bug this pins: the bar hardcoded 3 slots and an
    // EMPTY More menu, so the three destinations SHADCHANUS_NAV grew after
    // it was written (/shidduchim, /singles, /shadchanim) had no link
    // anywhere on a phone even though their routes and sidebar links exist.
    const screen = await renderMobileNavigation([
      { ...shadchanus, is_active: true },
    ]);

    // Assert — the first three are the bar itself...
    const barLinks = Array.from(document.querySelectorAll("a[href]")).map(
      (link) => link.getAttribute("href"),
    );
    expect(barLinks).toEqual(["/", "/connections", "/shidduchim"]);

    // ...and every remaining one is in the overflow menu.
    await screen.getByRole("button", { name: "More" }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: "Settings" }))
      .toBeInTheDocument();

    const allLinks = Array.from(document.querySelectorAll("a[href]")).map(
      (link) => link.getAttribute("href"),
    );
    for (const item of SHADCHANUS_NAV) {
      expect(allLinks).toContain(item.to);
    }
  });

  it("never renders the raised center create button", async () => {
    // Arrange / Act — no taskable target exists in a shadchanus account yet
    // (Dev Notes: "Why no Tasks or Reminders"). A single-context login
    // always has that context active (review F4 — see the previous test).
    const screen = await renderMobileNavigation([
      { ...shadchanus, is_active: true },
    ]);

    // Assert — the household bar's create button carries this aria-label
    // (translate("ra.action.create") -> ra-language-english's "Create").
    await expect
      .element(screen.getByRole("button", { name: "Create" }))
      .not.toBeInTheDocument();
  });

  it("still exposes the context switcher and theme toggle through the More menu", async () => {
    // Arrange / Act — a shadchan who also holds a household context must
    // not lose mobile's only entry point for switching (Story 4.4 NFR-14).
    // The shadchanus context must be the ACTIVE one here so the shadchanus
    // bar (not the household one) is what's rendered.
    const screen = await renderMobileNavigation([
      { ...household, is_active: false },
      { ...shadchanus, is_active: true },
    ]);
    await screen.getByRole("button", { name: "More" }).click();

    // Assert
    await expect
      .element(screen.getByText("The Klein Family · Household"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("menuitem", { name: /light/i }))
      .toBeInTheDocument();
  });

  it("never lists Inbox, Tasks or Reminders in the More menu", async () => {
    // Arrange / Act — a single-context login always has that context
    // active (review F4 — see the first test in this describe block).
    const screen = await renderMobileNavigation([
      { ...shadchanus, is_active: true },
    ]);
    await screen.getByRole("button", { name: "More" }).click();

    // Assert
    for (const label of ["Inbox", "Tasks", "Reminders"]) {
      await expect
        .element(screen.getByRole("menuitem", { name: label }))
        .not.toBeInTheDocument();
    }
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

describe("MobileNavigation — active-state semantics", () => {
  it("marks the current bar destination with aria-current, and no other", async () => {
    // Arrange / Act — the active state was carried only by `text-primary`
    // and an `aria-hidden` dot, so nothing announced it.
    const screen = await renderMobileNavigation([household], ["/shidduchim"]);

    // Assert
    await expect
      .element(screen.getByRole("link", { name: /shidduchim/i }))
      .toHaveAttribute("aria-current", "page");

    const current = Array.from(document.querySelectorAll("[aria-current]")).map(
      (node) => node.getAttribute("href"),
    );
    expect(current).toEqual(["/shidduchim"]);
  });

  it("marks the More trigger with aria-current when the route lives in its menu", async () => {
    // Arrange / Act
    const screen = await renderMobileNavigation([household], ["/tasks"]);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "More" }))
      .toHaveAttribute("aria-current", "true");
  });

  it("leaves aria-current off every item on a route that is in no slot", async () => {
    // Arrange / Act
    await renderMobileNavigation([household], ["/references/7"]);

    // Assert — RULING 7: references has no nav slot at all, so nothing is
    // current. An `aria-current` that never clears is worse than none.
    expect(document.querySelectorAll("[aria-current]")).toHaveLength(0);
  });
});

describe("MobileNavigation — More menu touch targets", () => {
  it("gives every row of the menu the 44px mobile hit area", async () => {
    // Arrange / Act — the More menu is mobile's only route to Inbox, Tasks,
    // Reminders, Settings, search, context and theme, and a plain
    // `<DropdownMenuItem>` is a 32px row with no gap to its neighbour.
    const screen = await renderMobileNavigation([household, shadchanus]);
    await screen.getByRole("button", { name: "More" }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: "Settings" }))
      .toBeInTheDocument();

    // Assert — asserted on the class rather than the measured box because
    // this suite renders without `@/index.css`; the class carries the
    // `md:` reset that keeps desktop density.
    const rows = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.className).toContain("min-h-11");
    }
  });
});
