import { test, expect, APP_URL } from "./fixtures";

/**
 * Story 12.4, AC-8/AC-13. Stripe is NEVER contacted here — `page.route()`
 * fulfils the billing Worker's `/checkout` call directly, so this spec
 * proves the SPA's own behavior (posts once, disables while in flight,
 * surfaces a readable error on `success:false`) without depending on the
 * Worker's deployment or a real Stripe test-mode call. AC-14 (a real
 * delivered webhook event) is verified manually against the deployed
 * Worker, never here.
 */
test.describe("Billing — Subscribe checkout", () => {
  test("posts /checkout once, disables the control while in flight, and redirects on success", async ({
    page,
    createMember,
    createSingle,
    signIn,
  }) => {
    // Arrange
    const member = await createMember({
      first_name: "Checkout",
      last_name: "Tester",
      email: `e2e-billing-checkout-${Date.now()}@example.com`,
    });
    await createSingle({ member, first_name_en: "Chaya" });
    await signIn(page, member.email!);

    let checkoutCallCount = 0;
    await page.route("**/checkout", async (route) => {
      checkoutCallCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { url: `${APP_URL}/#/billing?checkout=success` },
        }),
      });
    });

    await page.goto(`${APP_URL}/#/billing`);
    // Matches the button in both its idle state ("Subscribe — $6 / 3
    // months") and its pending state ("Redirecting to Stripe…", which
    // SubscribeButton.tsx swaps in synchronously on click, in the same
    // render that sets `disabled`) — a locator scoped to the idle-only name
    // stops matching anything the instant the click lands, which is exactly
    // why the disabled-state assertion below used to time out with
    // "element(s) not found" instead of observing the disabled control.
    const subscribeButton = page.getByRole("button", {
      name: /Subscribe.*3 months|Redirecting to Stripe/,
    });
    await expect(subscribeButton).toBeVisible();

    // Act
    const checkoutResponse = page.waitForResponse("**/checkout");
    await subscribeButton.click();

    // Assert — disabled while the request is in flight.
    await expect(subscribeButton).toBeDisabled();
    await checkoutResponse;

    // The fulfilled URL points back at this same app, so the redirect
    // lands on the confirming notice — proof `window.location.assign` ran
    // with the Worker's own response, not a client-side grant.
    await expect(page.getByText("Confirming your payment…")).toBeVisible();
    expect(checkoutCallCount).toBe(1);
  });

  test("surfaces a readable error and re-enables the control when checkout fails", async ({
    page,
    createMember,
    createSingle,
    signIn,
  }) => {
    // Arrange
    const member = await createMember({
      first_name: "Checkout",
      last_name: "Failure",
      email: `e2e-billing-checkout-fail-${Date.now()}@example.com`,
    });
    await createSingle({ member, first_name_en: "Chaya" });
    await signIn(page, member.email!);

    await page.route("**/checkout", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: "billing not configured",
        }),
      });
    });

    await page.goto(`${APP_URL}/#/billing`);
    const subscribeButton = page.getByRole("button", {
      name: /Subscribe.*3 months/,
    });

    // Act
    const checkoutResponse = page.waitForResponse("**/checkout");
    await subscribeButton.click();
    await checkoutResponse;

    // Assert — a readable error, and the control is usable again (not
    // stuck disabled from a checkout that never redirected anywhere).
    await expect(page.getByText("billing not configured")).toBeVisible();
    await expect(subscribeButton).toBeEnabled();
  });
});
