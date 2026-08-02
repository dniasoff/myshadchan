import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { MyContext } from "../types";
import {
  PRIMARY_NAV,
  SHADCHANUS_NAV,
  useActiveContextKind,
  useActiveNav,
} from "./navItems";

describe("PRIMARY_NAV", () => {
  it("contains exactly the 7 foundation nav items in order", () => {
    expect(PRIMARY_NAV.map((item) => item.to)).toEqual([
      "/",
      "/inbox_items",
      "/shidduchim",
      "/shadchanim",
      "/tasks",
      "/reminders",
      "/settings",
    ]);
  });

  it("gives every item a non-empty label default and a valid icon", () => {
    for (const item of PRIMARY_NAV) {
      expect(item.labelDefault.length).toBeGreaterThan(0);
      expect(item.icon).toBeDefined();
    }
  });

  it("labels the shidduchim destination 'Shidduchim', not 'Pipeline'", () => {
    const shidduchim = PRIMARY_NAV.find((item) => item.to === "/shidduchim");
    expect(shidduchim?.labelDefault).toBe("Shidduchim");
    expect(shidduchim?.labelKey).toBe("crm.navigation.shidduchim");
  });

  it("never links to /references — RULING 7, no browse surface for a scoped entity", () => {
    // An absence test that survives a future re-add, unlike the ordered
    // array assertion above (which would only fail if /references replaced
    // one of the seven existing slots, not if it were appended as an
    // eighth).
    for (const item of PRIMARY_NAV) {
      expect(item.to).not.toBe("/references");
      expect(item.to.startsWith("/references/")).toBe(false);
    }
  });
});

/** The 7 household-only paths Story 8.1's route guard covers (AC-3) — a
 * shadchanus-context nav must never surface any of them. */
const GUARDED_HOUSEHOLD_PATHS = [
  "/shidduchim",
  "/singles",
  "/shadchanim",
  "/references",
  "/inbox_items",
  "/tasks",
  "/reminders",
];

describe("SHADCHANUS_NAV (Story 8.1, AC-1)", () => {
  it("contains exactly Dashboard, Connections and Settings, in that order", () => {
    expect(SHADCHANUS_NAV.map((item) => item.to)).toEqual([
      "/",
      "/connections",
      "/settings",
    ]);
  });

  it("gives every item a non-empty label default and a valid icon", () => {
    for (const item of SHADCHANUS_NAV) {
      expect(item.labelDefault.length).toBeGreaterThan(0);
      expect(item.icon).toBeDefined();
    }
  });

  it("never contains any of the 7 guarded household-only paths", () => {
    for (const guardedPath of GUARDED_HOUSEHOLD_PATHS) {
      expect(SHADCHANUS_NAV.map((item) => item.to)).not.toContain(guardedPath);
    }
  });

  it("labels the connections destination with the new i18n key", () => {
    const connections = SHADCHANUS_NAV.find(
      (item) => item.to === "/connections",
    );
    expect(connections?.labelKey).toBe("crm.navigation.connections");
    expect(connections?.labelDefault).toBe("Connections");
  });
});

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

/** Mirrors `useGlobalSearch.test.ts`'s all-`createElement` hook-probe
 * convention (`.ts`, not `.tsx`): a `Probe` component captures both hooks'
 * results, seeded via a `QueryClient` pre-populated with `MY_CONTEXTS_QUERY_KEY`
 * (`MobileNavigation.test.tsx`'s own pattern) so no `waitFor` is needed. */
async function renderNavProbe(contexts: MyContext[]) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);
  const dataProvider = {
    getMyContexts: vi.fn().mockResolvedValue(contexts),
  } as unknown as CrmDataProvider;

  let capturedKind: ReturnType<typeof useActiveContextKind>;
  let capturedNav: ReturnType<typeof useActiveNav> | undefined;

  function Probe() {
    capturedKind = useActiveContextKind();
    capturedNav = useActiveNav();
    return null;
  }

  await render(
    createElement(
      CoreAdminContext,
      { dataProvider, queryClient, i18nProvider: testI18nProvider },
      createElement(Probe),
    ),
  );

  return {
    getKind: () => capturedKind,
    getNav: () => capturedNav,
  };
}

describe("useActiveContextKind (Story 8.1, AC-2)", () => {
  it("returns 'household' when the active context is a household", async () => {
    // Arrange / Act
    const { getKind } = await renderNavProbe([household]);

    // Assert
    expect(getKind()).toBe("household");
  });

  it("returns 'shadchanus' when the active context is a shadchanus account", async () => {
    // Arrange / Act
    const { getKind } = await renderNavProbe([shadchanus]);

    // Assert
    expect(getKind()).toBe("shadchanus");
  });

  it("returns undefined for a login with no contexts", async () => {
    // Arrange / Act
    const { getKind } = await renderNavProbe([]);

    // Assert
    expect(getKind()).toBeUndefined();
  });

  it("returns undefined when contexts are loaded but none is marked active (review F4)", async () => {
    // Arrange — a real state `my_contexts()` can produce
    // (`current_context_id()` returns NULL when `member_state
    // .active_account_id` no longer names a currently-active membership):
    // this must fail closed, exactly like the server, never fall back to
    // `contexts[0]` (that fallback belongs only to
    // `ContextSwitcher.tsx`'s display pill, per `roleAuthority.ts`'s own
    // written invariant — it is not an authority decision).
    const { getKind } = await renderNavProbe([
      { ...household, is_active: false },
      { ...shadchanus, is_active: false },
    ]);

    // Assert
    expect(getKind()).toBeUndefined();
  });
});

describe("useActiveNav (Story 8.1, AC-2)", () => {
  it("returns PRIMARY_NAV when the active context is a household", async () => {
    // Arrange / Act
    const { getNav } = await renderNavProbe([household]);

    // Assert
    expect(getNav()).toBe(PRIMARY_NAV);
  });

  it("returns SHADCHANUS_NAV when the active context is a shadchanus account", async () => {
    // Arrange / Act
    const { getNav } = await renderNavProbe([shadchanus]);

    // Assert
    expect(getNav()).toBe(SHADCHANUS_NAV);
  });

  it("returns PRIMARY_NAV for a household login even amongst multiple contexts", async () => {
    // Arrange / Act
    const { getNav } = await renderNavProbe([
      household,
      { ...shadchanus, is_active: false },
    ]);

    // Assert
    expect(getNav()).toBe(PRIMARY_NAV);
  });

  it("returns PRIMARY_NAV (the safe default) when no context is marked active (review F4)", async () => {
    // Arrange / Act
    const { getNav } = await renderNavProbe([
      { ...household, is_active: false },
      { ...shadchanus, is_active: false },
    ]);

    // Assert
    expect(getNav()).toBe(PRIMARY_NAV);
  });
});
