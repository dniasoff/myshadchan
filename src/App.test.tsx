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
      <App url={{ pathname: "/find", search: "", hash: "" }} />,
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

  it("renders the explicit authenticated demo preview mode for /find?demo=1", async () => {
    const screen = await render(
      <App url={{ pathname: "/find", search: "?demo=1", hash: "" }} />,
    );

    await expect
      .element(screen.getByTestId("demo-preview-label"))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: /back to myshadchan/i }))
      .toBeVisible();
  });
});

/**
 * Story 9.5's own copy of the same F5 precedent: `shareToken.test.ts`
 * proves `isShareUrl`'s own predicate in isolation, but nothing proves it
 * is actually wired into the real entry point — a mutation deleting the
 * `/share` branch from `App.tsx` would leave every other test in the suite
 * green. This renders the real `App` component for a `/share#<token>` URL
 * and asserts `SharedProfilePage`'s own loading shell mounts (an inactive
 * link with no configured loader still shows the loading spinner for one
 * tick before resolving to the inactive notice — both are content only
 * `SharedProfilePage` renders, never `<LandingGate>`/`<CRM>`).
 */
describe("App — the share-link recipient route (Story 9.5)", () => {
  it("renders SharedProfilePage directly for /share, before any authenticated route mounts", async () => {
    // Arrange / Act
    const screen = await render(
      <App url={{ pathname: "/share", search: "", hash: "#sometoken" }} />,
    );

    // Assert — the MyShadchan wordmark from SharedProfilePage's own shell
    // is on screen; a mutation removing App.tsx's `isShareUrl` branch would
    // instead fall through to `<LandingGate><CRM /></LandingGate>`, which
    // renders neither this shell nor its loading state.
    await expect.element(screen.getByText("MyShadchan")).toBeVisible();
  });
});
