import { defineConfig, devices } from "@playwright/test";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { resolveStack } from "./scripts/stack-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env.e2e") });

/**
 * The stack this run owns, selected by `STACK_ID` (unset === stack 0, i.e.
 * exactly the ports this file used to hard-code). See scripts/stack-env.mjs.
 *
 * `.env.e2e` pins `VITE_SUPABASE_URL` to stack 0's API port, and `dotenv`
 * above has just put it in `process.env`, from where the Vite child process
 * would inherit it. Overwrite it here so the app under test talks to *this*
 * stack's Supabase — otherwise a `STACK_ID=2` run would serve a UI pointed at
 * stack 0's database while its fixtures seeded stack 2's.
 */
const stack = resolveStack(process.env.STACK_ID);
if (stack.isExplicit) {
  process.env.VITE_SUPABASE_URL = stack.supabaseUrl;
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./e2e",
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* No parallel tests on CI as we depends on the same db. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "list",
  /**
   * Traces and screenshots land here. Playwright's default is a fixed
   * `test-results/`, which two concurrent runs would overwrite for each other;
   * stack 0 resolves to that same default, so nothing changes without
   * STACK_ID.
   */
  outputDir: stack.outputDir,
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    // baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
    actionTimeout: 5000,
  },

  /**
   * `e2e/**` hits this stack's app origin (`APP_URL` in `e2e/fixtures.ts`,
   * `http://localhost:5175` on stack 0) against this stack's Supabase health
   * endpoint (`http://127.0.0.1:54341` on stack 0). Without this
   * block, `npx playwright test` on its own fails with
   * `ERR_CONNECTION_REFUSED` on the app port — an inherited oversight from the
   * upstream template (nothing has touched this file since the bootstrap
   * commit), not a deliberate omission. `make test-e2e` / `test-e2e-ci`
   * remain the normal entry points and still work unchanged: both start
   * this same stack via `make` *before* invoking Playwright, so by the time
   * Playwright checks these URLs they are already up and `reuseExistingServer`
   * (unconditional, not `!process.env.CI`) makes it reuse them instead of
   * relaunching — CI's `start-e2e-ci` would otherwise collide with a second,
   * Playwright-managed launch attempt on the same ports.
   *
   * Neither command below can be the bare `make start-*-e2e` target: both
   * background or detach (`start-app-e2e` runs vite with a trailing `&`;
   * `supabase start` exits once its Docker containers are healthy), and
   * Playwright treats an early process exit as a hard launch failure
   * regardless of exit code (`WebServerPlugin` races the exit event against
   * the URL health check). `make start-supabase-e2e && tail -f /dev/null`
   * keeps the process alive for Playwright to manage/kill after setup
   * finishes; teardown does not stop the detached Supabase Docker
   * containers, same as today — a manual `make stop-e2e` is still required
   * between runs for a guaranteed-fresh database.
   *
   * `reuseExistingServer: true` is what let two agents silently share one
   * app: it reuses whatever is already listening on the URL, whoever started
   * it. It stays `true` — `make test-e2e` starts this same stack before
   * calling Playwright, so turning it off would make the normal entry point
   * fail on "port already used" — but the URLs are now stack-scoped, so the
   * only server it can possibly reuse is this stack's own. STACK_ID is the
   * exclusive allocation; reuse within it is the intended behaviour, reuse
   * across agents is now unreachable because no two stacks share a port.
   *
   * Both children get STACK_ID explicitly rather than by inheritance, so the
   * `make` target below provisions the same workdir and project id this
   * config is pointing at.
   */
  webServer: [
    {
      command: "make start-supabase-e2e && tail -f /dev/null",
      url: `${stack.supabaseUrl}/auth/v1/health`,
      reuseExistingServer: true,
      timeout: 180_000,
      env: { STACK_ID: String(stack.index) },
    },
    {
      command: `npx vite --port ${stack.ports.app} --force --mode e2e`,
      url: stack.appUrl,
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        STACK_ID: String(stack.index),
        // Beats `.env.e2e`'s pinned value: Vite gives an inline VITE_* env var
        // precedence over any .env file (loadEnv applies process.env last).
        VITE_SUPABASE_URL: stack.supabaseUrl,
      },
    },
  ],

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.CI && { channel: "chromium-headless-shell" }),
      },
    },

    /* Test against mobile viewports. */
    {
      name: "Mobile Chrome",
      use: {
        ...devices["Pixel 5"],
        ...(process.env.CI && { channel: "chromium-headless-shell" }),
      },
    },
    // Uncomment to test against additional devices

    /* Test against desktop browsers. */
    // {
    //   name: "chromium",
    //   use: { ...devices["Desktop Chrome"] },
    // },

    /* Test against additional mobile browsers. */
    // {
    //   name: "firefox",
    //   use: { ...devices["Desktop Firefox"] },
    // },
    // {
    //   name: "Mobile Safari",
    //   use: { ...devices["iPhone 12"] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],
});
