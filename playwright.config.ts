import { defineConfig, devices } from "@playwright/test";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env.e2e") });

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
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    // baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
    actionTimeout: 5000,
  },

  /**
   * `e2e/**` hits fixed `http://localhost:5175` URLs (`e2e/fixtures.ts`)
   * against the e2e Supabase instance's health endpoint
   * (`http://127.0.0.1:54341`, `supabase/config.e2e.toml`). Without this
   * block, `npx playwright test` on its own fails with
   * `ERR_CONNECTION_REFUSED` on :5175 — an inherited oversight from the
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
   */
  webServer: [
    {
      command: "make start-supabase-e2e && tail -f /dev/null",
      url: "http://127.0.0.1:54341/auth/v1/health",
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: "npx vite --port 5175 --force --mode e2e",
      url: "http://localhost:5175",
      reuseExistingServer: true,
      timeout: 30_000,
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
