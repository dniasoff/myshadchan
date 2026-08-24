import { describe, expect, it } from "vitest";

// `?raw` rather than `node:fs`: the `app` vitest project runs in Chromium,
// where `node:fs` is externalized. Vite inlines these as strings at build
// time, so the assertions below read the real files.
import desktopDashboard from "./Dashboard.tsx?raw";
import mobileDashboard from "./MobileDashboard.tsx?raw";
import shadchanDashboard from "./ShadchanDashboard.tsx?raw";
import settingsPage from "../settings/SettingsPage.tsx?raw";
import platformSection from "../settings/PlatformMetricsSection.tsx?raw";

/**
 * Where Story 15.2's platform metrics may and may not appear.
 *
 * This is a placement rule, so it is checked at the source: rendering a whole
 * dashboard would need the entire data-provider surface stubbed, and the
 * thing worth pinning is which file mounts which component — exactly what a
 * regression here would change.
 *
 * Gating by ROLE is what failed the first time, and is why this guard exists
 * at all. `handle_new_user()` makes the first login in a fresh database
 * `administrator = true`, so on a small deployment the operator and the
 * parent are the same person: an admin gate on the dashboard let precisely
 * the wrong viewer keep seeing operator metrics on the family page. The rule
 * has to be about the PAGE, not the viewer.
 */
describe("platform metrics placement", () => {
  it("keeps operator metrics off every family dashboard", () => {
    for (const [name, source] of [
      ["Dashboard.tsx", desktopDashboard],
      ["MobileDashboard.tsx", mobileDashboard],
      ["ShadchanDashboard.tsx", shadchanDashboard],
    ] as const) {
      expect(source, `${name} must not mount MetricsCards`).not.toContain(
        "MetricsCards",
      );
    }
  });

  it("keeps them reachable to an operator, in Settings, behind the admin gate", () => {
    expect(settingsPage).toContain("PlatformMetricsSection");
    expect(platformSection).toContain("MetricsCards");
    expect(platformSection).toContain('CanAccess resource="members"');
  });

  it("says out loud that these are not the family's own numbers", () => {
    // The copy is the whole point of the move: an operator opening Settings
    // must not mistake a cross-account aggregate for their own household.
    expect(platformSection).toContain("Nothing here is about your own");
  });
});
