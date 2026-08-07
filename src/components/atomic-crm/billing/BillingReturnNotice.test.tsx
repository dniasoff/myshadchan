import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter, type DataProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { BillingReturnNotice } from "./BillingReturnNotice";

const renderNotice = async (
  url: string,
  props: Partial<{
    isEntitled: boolean;
    onNeedsRefresh: ReturnType<typeof vi.fn<() => void>>;
    maxAttempts: number;
    intervalMs: number;
  }> = {},
) => {
  const onNeedsRefresh: ReturnType<typeof vi.fn<() => void>> =
    props.onNeedsRefresh ?? vi.fn();
  const screen = await render(
    <TestMemoryRouter initialEntries={[url]}>
      <CoreAdminContext
        dataProvider={{} as unknown as DataProvider}
        i18nProvider={testI18nProvider}
      >
        <BillingReturnNotice
          isEntitled={props.isEntitled ?? false}
          onNeedsRefresh={onNeedsRefresh}
          maxAttempts={props.maxAttempts}
          intervalMs={props.intervalMs}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, onNeedsRefresh };
};

/**
 * Story 12.4, AC-13's highest-risk component. `BillingReturnNotice` must
 * render a HINT about the Stripe Checkout return and must NEVER grant,
 * assert, or optimistically display entitlement — entitlement always comes
 * from `isEntitled`, a prop this component only ever reflects, never
 * decides.
 */
describe("BillingReturnNotice", () => {
  it("renders nothing when the URL carries no checkout query param", async () => {
    // Arrange / Act
    const { screen, onNeedsRefresh } = await renderNotice("/billing");

    // Assert
    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
    expect(onNeedsRefresh).not.toHaveBeenCalled();
  });

  it("renders a neutral 'no charge was made' notice for ?checkout=cancelled and never schedules a refresh", async () => {
    // Arrange / Act
    const { screen, onNeedsRefresh } = await renderNotice(
      "/billing?checkout=cancelled",
      { intervalMs: 10 },
    );

    // Assert
    await expect
      .element(screen.getByText("No charge was made."))
      .toBeInTheDocument();
    // Give the (absent) schedule a chance to have fired if it wrongly exists.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onNeedsRefresh).not.toHaveBeenCalled();
  });

  it("renders a confirming notice for ?checkout=success while unentitled, and calls onNeedsRefresh on a bounded schedule", async () => {
    // Arrange / Act — small interval/attempts so the test does not wait
    // out the production 5×2s schedule.
    const { screen, onNeedsRefresh } = await renderNotice(
      "/billing?checkout=success",
      { isEntitled: false, maxAttempts: 2, intervalMs: 10 },
    );

    // Assert — confirming copy first.
    await expect
      .element(screen.getByText("Confirming your payment…"))
      .toBeInTheDocument();

    // The schedule fires exactly maxAttempts times, then stops.
    await expect.poll(() => onNeedsRefresh.mock.calls.length).toBe(2);
    await expect
      .element(screen.getByText("This is taking longer than usual"))
      .toBeInTheDocument();

    // No further calls after the bound is reached.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onNeedsRefresh).toHaveBeenCalledTimes(2);
  });

  it("AC-13's failing condition: stays unentitled copy, never entitled copy, while the server says unentitled", async () => {
    // Arrange / Act
    const { screen } = await renderNotice("/billing?checkout=success", {
      isEntitled: false,
      maxAttempts: 1,
      intervalMs: 10,
    });

    // Assert — this component never renders any entitled-state claim; the
    // only two strings it can ever show for checkout=success are the
    // confirming and timed-out copy.
    await expect
      .element(screen.getByText(/Confirming your payment|taking longer/))
      .toBeInTheDocument();
    expect(screen.container.textContent).not.toMatch(/entitled|AI tier/i);
  });

  it("stops rendering once isEntitled is already true — reflects the parent's server read, never asserts it", async () => {
    // Arrange / Act
    const { screen, onNeedsRefresh } = await renderNotice(
      "/billing?checkout=success",
      { isEntitled: true, intervalMs: 10 },
    );

    // Assert — nothing rendered, and no refresh is scheduled for an
    // already-confirmed account.
    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onNeedsRefresh).not.toHaveBeenCalled();
  });
});
