import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { ShadchanDashboard } from "./ShadchanDashboard";

/**
 * Story 8.1 (AC-5): honest-about-nothing-yet empty state. No data fetching,
 * so — per UX-DR11's minimum bar — the empty state is the only state; there
 * is no loading/error branch to also cover.
 */
const renderShadchanDashboard = () =>
  render(
    <CoreAdminContext i18nProvider={testI18nProvider}>
      <ShadchanDashboard />
    </CoreAdminContext>,
  );

describe("ShadchanDashboard (Story 8.1, AC-5)", () => {
  it("renders the shadchanus workspace heading", async () => {
    // Arrange / Act
    const screen = await renderShadchanDashboard();

    // Assert
    await expect
      .element(screen.getByText("Your shadchanus workspace"))
      .toBeInTheDocument();
  });

  it("renders the calm empty state explaining nothing has arrived yet", async () => {
    // Arrange / Act
    const screen = await renderShadchanDashboard();

    // Assert — the exact AC-5 copy: no query, no "0 connections" count.
    await expect
      .element(
        screen.getByText(
          "Once you connect with a family, their conversations will appear here.",
        ),
      )
      .toBeInTheDocument();
  });

  it("never renders a household-only figure like a single or shidduch count", async () => {
    // Arrange / Act
    const screen = await renderShadchanDashboard();

    // Assert — this screen must never echo the household dashboard's own
    // vocabulary (Dev Notes: "would show nonsensical copy like '0 singles'").
    await expect.element(screen.getByText(/single/i)).not.toBeInTheDocument();
    await expect.element(screen.getByText(/shidduch/i)).not.toBeInTheDocument();
  });
});
