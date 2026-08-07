import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, type DataProvider } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { AiEntitlementInfo } from "../types";
import { ManageSubscriptionButton } from "./ManageSubscriptionButton";

const { callBillingWorker } = vi.hoisted(() => ({
  callBillingWorker: vi.fn(),
}));

vi.mock("../providers/commons/billingClient", () => ({
  callBillingWorker,
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

const renderButton = async (
  info: AiEntitlementInfo,
  redirectTo: (url: string) => void = vi.fn(),
) => {
  const screen = await render(
    <CoreAdminContext
      dataProvider={{} as unknown as DataProvider}
      i18nProvider={testI18nProvider}
    >
      <ManageSubscriptionButton info={info} redirectTo={redirectTo} />
      <Notification />
    </CoreAdminContext>,
  );
  return { screen };
};

/**
 * Story 12.4, AC-9. `ManageSubscriptionButton` is the ONLY upgrade /
 * downgrade / cancel / card-update surface — it only ever redirects to
 * Stripe's hosted Billing Portal, and only appears when there is plausibly
 * something to manage (entitled or lapsed).
 */
describe("ManageSubscriptionButton", () => {
  it("renders nothing for a free, never-subscribed account", async () => {
    // Arrange / Act
    const { screen } = await renderButton(
      entitlementInfo({ is_entitled: false, status: "none" }),
    );

    // Assert
    await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
  });

  it("renders for a currently entitled account", async () => {
    // Arrange / Act
    const { screen } = await renderButton(
      entitlementInfo({ is_entitled: true, status: "active", plan: "ai" }),
    );

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Manage subscription" }))
      .toBeVisible();
  });

  it("renders for a lapsed account even though it is not currently entitled", async () => {
    // Arrange / Act
    const { screen } = await renderButton(
      entitlementInfo({ is_entitled: false, status: "lapsed", plan: "ai" }),
    );

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Manage subscription" }))
      .toBeVisible();
  });

  it("posts /portal and redirects to the returned Billing Portal URL", async () => {
    // Arrange
    callBillingWorker.mockResolvedValue({
      url: "https://billing.stripe.com/session/abc",
    });
    const redirectTo = vi.fn();
    const { screen } = await renderButton(
      entitlementInfo({ is_entitled: true, status: "active", plan: "ai" }),
      redirectTo,
    );

    // Act
    await screen.getByRole("button", { name: "Manage subscription" }).click();

    // Assert
    await expect.poll(() => redirectTo.mock.calls.length).toBe(1);
    expect(callBillingWorker).toHaveBeenCalledWith(
      expect.stringContaining("/portal"),
      {},
    );
    expect(redirectTo).toHaveBeenCalledWith(
      "https://billing.stripe.com/session/abc",
    );
  });

  it("shows a readable error and re-enables the control when opening the portal fails", async () => {
    // Arrange
    callBillingWorker.mockRejectedValue(new Error("no subscription"));
    const { screen } = await renderButton(
      entitlementInfo({ is_entitled: true, status: "active", plan: "ai" }),
    );

    // Act
    await screen.getByRole("button", { name: "Manage subscription" }).click();

    // Assert
    await expect
      .element(screen.getByText("no subscription"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Manage subscription" }))
      .not.toBeDisabled();
  });
});
