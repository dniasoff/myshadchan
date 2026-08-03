import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { CaptureSection } from "./CaptureSection";

/**
 * Story 10.3 (Task 6, AC 5): the inbound-forwarding address must be
 * discoverable when configured, and the section must render nothing (not an
 * empty chip) when it isn't — the one branch a screenshot alone would miss.
 */

const renderSection = async () => {
  const dataProvider = {} as unknown as CrmDataProvider;
  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <CaptureSection />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("CaptureSection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the configured inbound address with a copy button", async () => {
    // Arrange
    vi.stubEnv("VITE_INBOUND_EMAIL", "you@in.myshadchan.space");

    // Act
    const screen = await renderSection();

    // Assert
    await expect
      .element(screen.getByRole("textbox"))
      .toHaveValue("you@in.myshadchan.space");
    await expect
      .element(screen.getByRole("button", { name: "Copy" }))
      .toBeInTheDocument();
  });

  it("renders nothing when VITE_INBOUND_EMAIL is unset — informational, never a blocking requirement", async () => {
    // Arrange
    vi.stubEnv("VITE_INBOUND_EMAIL", "");

    // Act
    const screen = await renderSection();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Copy" }))
      .not.toBeInTheDocument();
  });

  it("shows 'Copied' after the copy button is clicked", async () => {
    // Arrange
    vi.stubEnv("VITE_INBOUND_EMAIL", "you@in.myshadchan.space");
    // `navigator.clipboard` is a getter-only property in a real browser —
    // Object.assign silently no-ops on it, so the property must be
    // redefined outright.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const screen = await renderSection();

    // Act
    await screen.getByRole("button", { name: "Copy" }).click();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Copied" }))
      .toBeInTheDocument();
  });
});
