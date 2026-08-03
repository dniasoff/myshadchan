import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import App from "./App";

/**
 * Story 9.4 review finding F5: `publicSearchUrl.test.ts` proves
 * `isPublicSearchUrl`'s own predicate is correct in isolation, but nothing
 * proved it is actually WIRED into the real entry point — a mutation that
 * deleted the `/find` branch from `App.tsx` outright left every other test
 * in the suite green. This file closes that gap by rendering the real
 * `App` component (not a copy of its routing logic) and asserting the
 * public search page's own content is what mounts for `/find` (AC-1).
 */
describe("App — the public search route (Story 9.4, AC-1)", () => {
  it("renders PublicSearchPage directly for /find, before any authenticated route mounts", async () => {
    // Arrange / Act
    const screen = await render(
      <App url={{ pathname: "/find", search: "" }} />,
    );

    // Assert — PublicSearchPage's own distinctive content is on screen; a
    // mutation removing App.tsx's `isPublicSearchUrl` branch would instead
    // fall through to `<LandingGate><CRM /></LandingGate>`, which renders
    // neither a search box nor this heading.
    await expect.element(screen.getByRole("searchbox")).toBeVisible();
    await expect
      .element(
        screen.getByRole("heading", { name: /find a shadchan or a single/i }),
      )
      .toBeVisible();
  });
});
