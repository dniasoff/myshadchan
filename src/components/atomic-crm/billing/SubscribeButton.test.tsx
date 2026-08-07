import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, type DataProvider } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { SubscribeButton } from "./SubscribeButton";

const { callBillingWorker } = vi.hoisted(() => ({
  callBillingWorker: vi.fn(),
}));

vi.mock("../providers/commons/billingClient", () => ({
  callBillingWorker,
}));

const renderButton = async (redirectTo: (url: string) => void = vi.fn()) => {
  const screen = await render(
    <CoreAdminContext
      dataProvider={{} as unknown as DataProvider}
      i18nProvider={testI18nProvider}
    >
      <SubscribeButton redirectTo={redirectTo} />
      <Notification />
    </CoreAdminContext>,
  );
  return { screen };
};

/**
 * Story 12.4, AC-8. `SubscribeButton` does exactly one thing on success:
 * POST /checkout and hand the returned URL to `redirectTo` — it never
 * writes or asserts entitlement itself (that stays the webhook's job, see
 * BillingReturnNotice.tsx).
 */
describe("SubscribeButton", () => {
  it("posts the quarterly cadence and redirects to the returned Checkout URL", async () => {
    // Arrange
    callBillingWorker.mockResolvedValue({
      url: "https://checkout.stripe.com/session/quarterly",
    });
    const redirectTo = vi.fn();
    const { screen } = await renderButton(redirectTo);

    // Act
    await screen.getByRole("button", { name: /Subscribe.*3 months/ }).click();

    // Assert
    await expect.poll(() => redirectTo.mock.calls.length).toBe(1);
    expect(callBillingWorker).toHaveBeenCalledWith(
      expect.stringContaining("/checkout"),
      { cadence: "quarterly" },
    );
    expect(redirectTo).toHaveBeenCalledWith(
      "https://checkout.stripe.com/session/quarterly",
    );
  });

  it("posts the yearly cadence when the yearly control is used", async () => {
    // Arrange
    callBillingWorker.mockResolvedValue({
      url: "https://checkout.stripe.com/session/yearly",
    });
    const redirectTo = vi.fn();
    const { screen } = await renderButton(redirectTo);

    // Act
    await screen.getByRole("button", { name: /pay yearly/ }).click();

    // Assert
    await expect.poll(() => redirectTo.mock.calls.length).toBe(1);
    expect(callBillingWorker).toHaveBeenCalledWith(
      expect.stringContaining("/checkout"),
      { cadence: "yearly" },
    );
  });

  it("disables both controls while a checkout request is in flight", async () => {
    // Arrange — a promise this test controls the resolution of.
    let resolveCheckout: (value: { url: string }) => void = () => {};
    callBillingWorker.mockReturnValue(
      new Promise((resolve) => {
        resolveCheckout = resolve;
      }),
    );
    const { screen } = await renderButton();

    // Act
    await screen.getByRole("button", { name: /Subscribe.*3 months/ }).click();

    // Assert — both controls disable, not just the one clicked. The
    // clicked button's own accessible name changes to the pending label,
    // so it is re-located by that new text rather than its stale locator.
    await expect
      .element(screen.getByText("Redirecting to Stripe…"))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: /pay yearly/ }))
      .toBeDisabled();

    resolveCheckout({ url: "https://checkout.stripe.com/session/quarterly" });
  });

  it("shows a readable error and re-enables the controls when checkout fails", async () => {
    // Arrange
    callBillingWorker.mockRejectedValue(new Error("billing not configured"));
    const { screen } = await renderButton();

    // Act
    await screen.getByRole("button", { name: /Subscribe.*3 months/ }).click();

    // Assert
    await expect
      .element(screen.getByText("billing not configured"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /Subscribe.*3 months/ }))
      .not.toBeDisabled();
  });
});
