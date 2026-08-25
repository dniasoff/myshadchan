import { render } from "vitest-browser-react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
afterEach(() => {
  vi.unstubAllEnvs();
});

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

/**
 * Placed last, in its own block, deliberately: this suite does not call
 * `cleanup()` between cases, so every render accumulates in the document. A
 * case inserted mid-file changes what the later, document-scoped queries can
 * match — which is exactly what happened when this was written in the middle
 * (the purge page's own "Back to MyShadchan" link became a second match for
 * the demo-preview case below it).
 */
describe("App — the public purge-request route", () => {
  it("renders a working purge-request form for /purge-request, not a blank page", async () => {
    // Arrange / Act — this is the regression guard for a bug that reached
    // production as a COMPLETELY BLANK page. `PurgeRequestPage` calls
    // `useDataProvider()`, and `App.tsx` renders it outside `<CRM>` (rightly —
    // it must work with no session), so it threw "No QueryClient set" during
    // render and nothing was displayed at all.
    //
    // Its own unit test never caught it because that test supplies the very
    // context the application was missing: `PurgeRequestPage.test.tsx`'s
    // `renderPage` wraps the page in `CoreAdminContext` with a `QueryClient`.
    // Only rendering the REAL entry point can catch this class, which is what
    // `AppProps.url` exists for.
    // The Supabase config a real deployment always has. `PublicRaShell` builds
    // the data provider from it, so without this the test would be measuring a
    // missing environment rather than the wiring under test.
    vi.stubEnv("VITE_SUPABASE_URL", "https://stub.supabase.co");
    vi.stubEnv("VITE_SB_PUBLISHABLE_KEY", "sb_publishable_stub");

    const screen = await render(
      <App url={{ pathname: "/purge-request", search: "", hash: "" }} />,
    );

    // Assert — the form is actually on screen and usable.
    await expect
      .element(
        screen.getByRole("heading", {
          name: /request removal of your information/i,
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /submit/i }))
      .toBeVisible();
  });
});
