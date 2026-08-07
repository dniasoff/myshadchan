import { expect, test, type Page } from "@playwright/test";

import { resolveStack } from "../scripts/stack-env.mjs";

const APP_URL = resolveStack(process.env.STACK_ID).appUrl;
const PROBE_KEY = "__googleOAuthNavigationProbe";

type NavigationCounts = {
  historyMutations: number;
  sameOriginNavigations: number;
  oauthRequests: number;
};

/**
 * Regression for the double-navigation race on both Google auth entry points.
 * Supabase's `signInWithOAuth()` assigns the external `/authorize` URL itself;
 * wrapping that provider call in ra-core's `useLogin()` used to schedule a
 * second HashRouter navigation milliseconds later. One click then produced
 * hundreds of `/login` frame navigations before the external request won.
 *
 * The probe is installed before the app document loads. Its `/authorize`
 * route is deliberately aborted, keeping that document alive long enough for
 * any competing React Router microtask to run. This both reproduces the old
 * race reliably and lets the test read its synchronous history counter.
 */
async function installNavigationProbe(
  page: Page,
  onGoogleAuthorize?: (url: URL) => void,
) {
  let tracking = false;
  let sameOriginNavigations = 0;
  let oauthRequests = 0;
  let authorizeUrl: URL | undefined;
  let resolveOAuthRequest!: () => void;
  const oauthRequest = new Promise<void>((resolve) => {
    resolveOAuthRequest = resolve;
  });

  await page.addInitScript(
    ({ probeKey }) => {
      const browserGlobal = globalThis as unknown as {
        history: {
          pushState(data: unknown, unused: string, url?: string | null): void;
          replaceState(
            data: unknown,
            unused: string,
            url?: string | null,
          ): void;
        };
        [key: string]: unknown;
      };
      const state = { tracking: false, historyMutations: 0 };
      browserGlobal[probeKey] = state;
      const originalPushState = browserGlobal.history.pushState.bind(
        browserGlobal.history,
      );
      const originalReplaceState = browserGlobal.history.replaceState.bind(
        browserGlobal.history,
      );

      browserGlobal.history.pushState = (...args) => {
        if (state.tracking) state.historyMutations += 1;
        return originalPushState(...args);
      };
      browserGlobal.history.replaceState = (...args) => {
        if (state.tracking) state.historyMutations += 1;
        return originalReplaceState(...args);
      };
    },
    { probeKey: PROBE_KEY },
  );

  page.on("framenavigated", (frame) => {
    if (
      tracking &&
      frame === page.mainFrame() &&
      frame.url().startsWith(APP_URL)
    ) {
      sameOriginNavigations += 1;
    }
  });

  await page.route("**/auth/v1/authorize**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("provider") !== "google") {
      await route.continue();
      return;
    }

    oauthRequests += 1;
    authorizeUrl = url;
    onGoogleAuthorize?.(url);
    await route.abort("aborted");
    resolveOAuthRequest();
  });

  return {
    start: async () => {
      tracking = true;
      await page.evaluate(
        ({ probeKey }) => {
          const state = (
            globalThis as unknown as {
              [key: string]: { tracking: boolean; historyMutations: number };
            }
          )[probeKey];
          state.historyMutations = 0;
          state.tracking = true;
        },
        { probeKey: PROBE_KEY },
      );
    },
    waitForOAuthRequest: () => oauthRequest,
    authorizeUrl: () => authorizeUrl,
    result: async (): Promise<NavigationCounts> => {
      const historyMutations = await page.evaluate(
        ({ probeKey }) =>
          (
            globalThis as unknown as {
              [key: string]: { historyMutations: number };
            }
          )[probeKey].historyMutations,
        { probeKey: PROBE_KEY },
      );
      return { historyMutations, sameOriginNavigations, oauthRequests };
    },
  };
}

type NavigationProbe = Awaited<ReturnType<typeof installNavigationProbe>>;

async function expectCleanOAuthHandoff(page: Page, probe: NavigationProbe) {
  await probe.start();

  await Promise.all([
    probe.waitForOAuthRequest(),
    page.getByRole("button", { name: "Continue with Google" }).click(),
  ]);
  // A Playwright evaluation runs after the click's event task and its promise
  // microtasks. Two animation frames additionally cross React's scheduled
  // work boundary without relying on a timeout-based assertion.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const { requestAnimationFrame } = globalThis as unknown as {
          requestAnimationFrame: (callback: () => void) => number;
        };
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  expect(await probe.result()).toEqual({
    historyMutations: 0,
    sameOriginNavigations: 0,
    oauthRequests: 1,
  });
}

test("Google sign-in performs one clean external OAuth handoff", async ({
  page,
}) => {
  const probe = await installNavigationProbe(page);
  await page.goto(`${APP_URL}/#/login`);
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();

  await expectCleanOAuthHandoff(page, probe);
  expect(probe.authorizeUrl()?.searchParams.get("provider")).toBe("google");
});

test("Google signup records intent, then performs one clean OAuth handoff", async ({
  page,
}) => {
  const requestOrder: string[] = [];
  const probe = await installNavigationProbe(page, () => {
    requestOrder.push("authorize");
  });
  await page.route("**/rest/v1/signup_intents*", async (route) => {
    requestOrder.push("signup-intent:start");
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: "",
    });
    requestOrder.push("signup-intent:complete");
  });
  await page.goto(`${APP_URL}/#/register`);
  await page.getByLabel(/email/i).fill("ada@example.com");
  await page.getByRole("checkbox").check();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();

  await expectCleanOAuthHandoff(page, probe);

  expect(requestOrder).toEqual([
    "signup-intent:start",
    "signup-intent:complete",
    "authorize",
  ]);
  const authorizeUrl = probe.authorizeUrl();
  expect(authorizeUrl?.searchParams.get("provider")).toBe("google");
  expect(authorizeUrl?.searchParams.get("login_hint")).toBe("ada@example.com");
});
