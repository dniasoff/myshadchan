import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { ConnectionsPlaceholder } from "./ConnectionsPlaceholder";

/**
 * Story 8.1 (AC-4): `/connections` renders a real screen from day one —
 * never a 404, never a dead nav target. No data fetching (8.2/8.5 own
 * `connections`/`connection_invites`), so the empty state is the only state.
 */
const renderConnectionsPlaceholder = () =>
  render(
    <CoreAdminContext i18nProvider={testI18nProvider}>
      <ConnectionsPlaceholder />
    </CoreAdminContext>,
  );

describe("ConnectionsPlaceholder (Story 8.1, AC-4)", () => {
  it("renders the Connections heading", async () => {
    // Arrange / Act
    const screen = await renderConnectionsPlaceholder();

    // Assert — `level: 1` disambiguates from the EmptyState's own
    // "Connections are coming soon" `<h2>`, which also matches a
    // non-exact "Connections" name.
    await expect
      .element(screen.getByRole("heading", { name: "Connections", level: 1 }))
      .toBeInTheDocument();
  });

  it("renders a calm empty state explaining the release boundary, not an invite action that doesn't exist yet", async () => {
    // Arrange / Act
    const screen = await renderConnectionsPlaceholder();

    // Assert — this story ships before 8.2's invite/accept RPCs exist, so
    // the copy must not promise "Share your invite link" (that's 8.2's).
    await expect
      .element(screen.getByText("Connections are coming soon"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/lays the groundwork/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/share your invite link/i))
      .not.toBeInTheDocument();
  });

  it("registers /connections as its static route path", () => {
    // Assert — root/routeManifest.ts's CUSTOM_ROUTES entry depends on this.
    expect(ConnectionsPlaceholder.path).toBe("/connections");
  });
});
