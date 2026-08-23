import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter, memoryStore } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import type { CrmDataProvider } from "../providers/types";
import { DemoBanner } from "./DemoBanner";

/**
 * Loose-end D. The banner is the first element of both shells, so whether it
 * is present on the FIRST committed render decides whether `<main>` is placed
 * at its final position or gets pushed down a paint later (0.122 CLS,
 * measured — see `e2e/demo-banner-cls.spec.ts`).
 *
 * Every assertion about first paint here is deliberately synchronous against
 * `container`: an `expect.element(...)` retries, so it would pass just as
 * happily on a banner that appeared three frames late — i.e. it could not
 * fail on the bug being fixed.
 */

const BANNER_SELECTOR = '[data-tour="demo-banner"]';

/**
 * `currentAccountDemo` that never settles, so the component stays in the
 * `isPending` branch for the whole test — the exact window in which the old
 * code rendered `null`.
 */
const buildPendingDataProvider = (): CrmDataProvider =>
  ({
    currentAccountDemo: vi.fn().mockReturnValue(new Promise(() => {})),
  }) as unknown as CrmDataProvider;

const buildResolvedDataProvider = (isDemo: boolean): CrmDataProvider =>
  ({
    currentAccountDemo: vi.fn().mockResolvedValue(isDemo),
  }) as unknown as CrmDataProvider;

const renderBanner = async (
  dataProvider: CrmDataProvider,
  lastKnownDemo: boolean | undefined,
) => {
  const store = memoryStore(
    lastKnownDemo === undefined ? {} : { "demo.lastKnown": lastKnownDemo },
  );

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={new QueryClient()}
        store={store}
      >
        <DemoBanner />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, store };
};

describe("DemoBanner — reserved height on first paint", () => {
  it("renders the banner on the first paint when the previous answer was demo", async () => {
    // Arrange — the live read is still in flight.
    const dataProvider = buildPendingDataProvider();

    // Act
    const { screen } = await renderBanner(dataProvider, true);

    // Assert — synchronously present, i.e. `<main>` below it is already at
    // its final y. This is the assertion that is RED on the pre-fix code.
    expect(screen.container.querySelector(BANNER_SELECTOR)).not.toBeNull();
  });

  it("renders nothing on the first paint when the previous answer was not demo", async () => {
    // Arrange
    const dataProvider = buildPendingDataProvider();

    // Act
    const { screen } = await renderBanner(dataProvider, false);

    // Assert — a hint of "not demo" must not reserve space nobody needs.
    expect(screen.container.querySelector(BANNER_SELECTOR)).toBeNull();
  });

  it("renders nothing on the first paint when there is no previous answer", async () => {
    // Arrange — first ever load on this device.
    const dataProvider = buildPendingDataProvider();

    // Act
    const { screen } = await renderBanner(dataProvider, undefined);

    // Assert — fails toward "no banner", never toward a banner an account
    // may not be entitled to.
    expect(screen.container.querySelector(BANNER_SELECTOR)).toBeNull();
  });
});

describe("DemoBanner — the live read is always authoritative", () => {
  it("removes the banner when the live read contradicts a stale demo hint", async () => {
    // Arrange — hint says demo, server says the demo was cleared.
    const dataProvider = buildResolvedDataProvider(false);

    // Act
    const { screen } = await renderBanner(dataProvider, true);

    // Assert
    await expect
      .element(screen.getByText(/exploring demo data/))
      .not.toBeInTheDocument();
  });

  it("shows the banner when the live read contradicts a stale non-demo hint", async () => {
    // Arrange
    const dataProvider = buildResolvedDataProvider(true);

    // Act
    const { screen } = await renderBanner(dataProvider, false);

    // Assert
    await expect
      .element(screen.getByText(/exploring demo data/))
      .toBeInTheDocument();
  });

  it("records the live answer so the next paint starts from it", async () => {
    // Arrange
    const dataProvider = buildResolvedDataProvider(true);

    // Act
    const { screen, store } = await renderBanner(dataProvider, false);
    await expect
      .element(screen.getByText(/exploring demo data/))
      .toBeInTheDocument();

    // Assert — this write is the whole mechanism; without it the hint never
    // becomes true and the first paint never reserves anything.
    expect(store.getItem("demo.lastKnown", false)).toBe(true);
  });

  it("publishes the banner height as --banner-h for the chrome to offset against", async () => {
    // Arrange
    const dataProvider = buildResolvedDataProvider(true);

    // Act
    const { screen } = await renderBanner(dataProvider, true);
    await expect
      .element(screen.getByText(/exploring demo data/))
      .toBeInTheDocument();

    // Assert — a reserved slot that never reported its height would simply
    // move the shift into Sidebar/TopBar.
    const bannerHeight = parseFloat(
      document.documentElement.style.getPropertyValue("--banner-h"),
    );
    expect(bannerHeight).toBeGreaterThan(0);
  });

  it("guides demo customers to the contained listing and outcome scenarios", async () => {
    const dataProvider = buildResolvedDataProvider(true);

    const { screen } = await renderBanner(dataProvider, true);

    await expect
      .element(screen.getByRole("link", { name: "Preview listings" }))
      .toHaveAttribute("href", "/find?demo=1");
    await expect
      .element(screen.getByText(/Feldman or Gross.*Sharing and Reminders/i))
      .toBeInTheDocument();
  });
});
