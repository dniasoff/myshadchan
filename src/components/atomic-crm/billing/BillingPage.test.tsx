import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter, type DataProvider } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { AiEntitlementInfo } from "../types";
import { BillingPage } from "./BillingPage";

const { useAiEntitlementInfo } = vi.hoisted(() => ({
  useAiEntitlementInfo: vi.fn(),
}));

vi.mock("../references/useAiEntitlement", () => ({
  useAiEntitlementInfo,
  AI_ENTITLEMENT_QUERY_KEY: ["aiEntitlement"],
}));

const entitlementInfo = (
  overrides: Partial<AiEntitlementInfo> = {},
): AiEntitlementInfo => ({
  is_entitled: false,
  plan: "free",
  status: "none",
  resumes_used: 0,
  resumes_limit: 0,
  ...overrides,
});

const renderPage = async (info: AiEntitlementInfo, url = "/billing") => {
  useAiEntitlementInfo.mockReturnValue({ info, isLoading: false });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const screen = await render(
    <TestMemoryRouter initialEntries={[url]}>
      <CoreAdminContext
        dataProvider={{} as unknown as DataProvider}
        i18nProvider={testI18nProvider}
        queryClient={queryClient}
      >
        <BillingPage />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen };
};

/**
 * Story 12.4. `BillingPage` derives everything it shows — which plan is
 * current, whether the AI card is highlighted, which cta renders — ONLY
 * from `info` (the server's `ai_entitlement()` read). AC-13's own failing
 * condition is the one this suite pins directly: a `?checkout=success`
 * return must never flip any of that on its own.
 */
describe("BillingPage", () => {
  it("shows the free plan as current and a SubscribeButton for a never-subscribed account", async () => {
    // Arrange / Act
    const { screen } = await renderPage(entitlementInfo());

    // Assert
    await expect
      .element(screen.getByRole("button", { name: /Subscribe.*3 months/ }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "You are on the AI tier. Thank you for supporting the running costs.",
        ),
      )
      .not.toBeInTheDocument();
  });

  it("shows the thank-you copy and Manage subscription for an entitled account", async () => {
    // Arrange / Act
    const { screen } = await renderPage(
      entitlementInfo({ is_entitled: true, status: "active", plan: "ai" }),
    );

    // Assert
    await expect
      .element(
        screen.getByText(
          "You are on the AI tier. Thank you for supporting the running costs.",
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Manage subscription" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /Subscribe/ }))
      .not.toBeInTheDocument();
  });

  it("shows the lapsed banner and Manage subscription (never Subscribe) for a lapsed account", async () => {
    // Arrange / Act
    const { screen } = await renderPage(
      entitlementInfo({ is_entitled: false, status: "lapsed", plan: "ai" }),
    );

    // Assert
    await expect
      .element(screen.getByText("Your AI tier has paused"))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Manage subscription" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /Subscribe/ }))
      .not.toBeInTheDocument();
  });

  it("AC-13 failing condition: ?checkout=success with entitlement stubbed unentitled still renders the free plan as current", async () => {
    // Arrange / Act
    const { screen } = await renderPage(
      entitlementInfo({ is_entitled: false }),
      "/billing?checkout=success",
    );

    // Assert — the return notice shows a hint...
    await expect
      .element(screen.getByText("Confirming your payment…"))
      .toBeVisible();

    // ...but the plan cards and cta are unmoved from the server's own read.
    await expect
      .element(screen.getByRole("button", { name: /Subscribe.*3 months/ }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "You are on the AI tier. Thank you for supporting the running costs.",
        ),
      )
      .not.toBeInTheDocument();
    // "Current plan" still marks Free forever, not the AI tier.
    await expect.element(screen.getByText("Current plan")).toBeVisible();
  });
});
