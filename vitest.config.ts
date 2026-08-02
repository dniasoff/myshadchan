import path from "node:path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { BrowserContext, CDPSession, Page } from "playwright";

import { resolveStack } from "./scripts/stack-env.mjs";

// Backs the "app" project's `setTimezone` browser command below. Chrome
// (verified empirically against 149.x) errors "Timezone override is already
// in effect" if a second CDP session tries to set an override while an
// earlier one on the same page is still open, and — separately — detaching a
// session that set the override reverts it immediately, before any test code
// gets to run. So exactly one session is opened per page, on first use, kept
// open (never detached) for the page's lifetime, and reused for every later
// call. Module-scoped: this config file is loaded once per worker process.
const timezoneSessionsByPage = new WeakMap<Page, Promise<CDPSession>>();

function getTimezoneSession(
  context: BrowserContext,
  page: Page,
): Promise<CDPSession> {
  let session = timezoneSessionsByPage.get(page);
  if (!session) {
    session = context.newCDPSession(page);
    timezoneSessionsByPage.set(page, session);
  }
  return session;
}

// Per-agent stack allocation (scripts/stack-env.mjs). Only the "app" project
// needs it here — it boots a real browser against a Vite server whose port and
// dependency cache are otherwise fixed host-globals (Vitest's default port
// 63315, Vite's default `node_modules/.vite`), which two concurrent runs on
// this checkout would contend for. The "db" project's connection is resolved
// inside supabase/tests/dbSuiteHelpers.ts instead, so that
// `npm run test:unit:db` is stack-scoped however it is invoked. Stack 0 (no
// STACK_ID) reproduces Vitest's own defaults exactly.
const stack = resolveStack(process.env.STACK_ID);

// Five test projects (https://vitest.dev/guide/projects.html):
//   - "app":       React/DOM unit tests, run in a real browser (Playwright/Chromium).
//   - "functions": Supabase Edge Function tests. Written for Deno with JSR imports;
//                  Node-only here, with the jsr:/npm: specifiers aliased to their
//                  installed npm equivalents. Aliases are scoped to this project.
//   - "workers":   Cloudflare Workers (Hono) unit tests, plain Node — Hono apps
//                  are tested via app.request()/app.fetch(), no Workers runtime needed.
//   - "db":        SQL-level tests (RLS, triggers, SECURITY DEFINER boundaries) run
//                  through psql against the local Supabase stack. Skips itself when
//                  the database is unreachable.
//   - "scripts":   Plain Node tests for the repo's own tooling under scripts/ (e.g.
//                  the suppression and retired-name CI guards) — no DOM, no browser.
// Run everything with `npm run test`, or a single suite with
// `npm run test:unit:app` / `npm run test:unit:functions` / `npm run test:unit:workers`
// / `npm run test:unit:db` / `npm run test:unit:scripts` (none of the latter four boot
// a browser).
export default defineConfig({
  test: {
    projects: [
      {
        // `tailwindcss()` mirrors vite.config.ts: it only transforms files
        // that actually get imported, so it is a no-op cost for the many
        // "app" tests that render without CSS — it only matters to a test
        // that imports "@/index.css" for real computed layout/colour
        // assertions (Entity360's 375px overflow guard, EntityAvatar's
        // `--avatar-{n}` colour assertions).
        plugins: [react(), tailwindcss()],
        // Same reason as vite.config.ts: this project boots a real Vite server
        // whose optimised deps would otherwise land in the one shared
        // `node_modules/.vite`, where a concurrent server's re-optimisation
        // deletes the chunks this one's browser is still requesting. Stack 0 is
        // Vite's own default path.
        cacheDir: stack.cacheDir,
        optimizeDeps: {
          exclude: ["playwright", "playwright-core"],
        },
        resolve: {
          preserveSymlinks: true,
          alias: {
            "@": path.resolve(__dirname, "./src"),
          },
        },
        test: {
          name: "app",
          globals: true,
          browser: {
            headless: true,
            provider: playwright(),
            enabled: true,
            api: { port: stack.ports.vitestBrowser },
            instances: [
              {
                browser: "chromium",
                ...(process.env.CI && {
                  launch: { channel: "chromium-headless-shell" },
                }),
              },
            ],
            commands: {
              // Uses Chrome DevTools Protocol to override the timezone at
              // runtime, since process.env.TZ has no effect in a real browser
              // environment. See getTimezoneSession above for why the session
              // is cached per page rather than opened (and detached) fresh on
              // every call.
              async setTimezone({ context, page }, timezoneId: string) {
                const session = await getTimezoneSession(context, page);
                await session.send("Emulation.setTimezoneOverride", {
                  timezoneId,
                });
              },
            },
          },
          exclude: [
            "**/node_modules/**",
            "doc/**",
            "supabase/**",
            ".supabase-e2e/**",
            ".supabase-e2e-*/**",
            "e2e/**/*.spec.{ts,tsx}",
            "workers/**",
            // Node-only tests for the repo's own tooling; run under the
            // "scripts" project below instead of the browser runner.
            "scripts/**",
            // Story 7.5: push-sw.js's own test reads it with Node `fs`
            // (Vite refuses to import a .js file FROM public/ into the
            // module graph, even with ?raw — "app" is a real-browser
            // project with no Node fs anyway) — runs under the
            // "service-worker" project below instead. No test file may
            // live INSIDE public/ itself: everything there is copied
            // verbatim into dist/ on build, which shipped one straight
            // into the production bundle the first time this was tried,
            // and made it reappear as a stray failing suite under dist/**
            // on the next `vitest run`.
            "public/**",
            "service-worker/**",
            // A `make build` run locally between test runs must never leak
            // its output back into test discovery.
            "dist/**",
          ],
          server: {
            deps: {
              external: [/playwright/],
            },
          },
        },
      },
      {
        // Map the Deno imports to the installed npm packages so Vitest can run
        // these Deno-targeted tests in Node without a Deno runtime. These aliases
        // only apply to this project.
        resolve: {
          alias: {
            "jsr:@supabase/supabase-js@2": path.resolve(
              __dirname,
              "node_modules/@supabase/supabase-js",
            ),
            "npm:tldts": path.resolve(__dirname, "node_modules/tldts"),
            "npm:pgsql-ast-parser@^12": "pgsql-ast-parser",
          },
        },
        test: {
          name: "functions",
          globals: true,
          environment: "node",
          include: ["supabase/functions/**/*.test.ts"],
          exclude: [
            "**/node_modules/**",
            ".supabase-e2e/**",
            ".supabase-e2e-*/**",
          ],
        },
      },
      {
        test: {
          name: "workers",
          globals: true,
          environment: "node",
          include: ["workers/**/*.test.ts"],
          exclude: ["**/node_modules/**"],
        },
      },
      {
        test: {
          name: "db",
          globals: true,
          environment: "node",
          include: ["supabase/tests/**/*.test.ts"],
          exclude: ["**/node_modules/**"],
          // These shell out to psql against the local stack.
          testTimeout: 120000,
          hookTimeout: 120000,
          /**
           * One db file at a time — the isolation boundary here is the *stack*,
           * and STACK_ID gives each agent one database, not one per test file.
           * Two of these suites running concurrently create and drop the same
           * fixture rows, roles and RLS state inside a single database, so they
           * fail each other non-deterministically no matter how the stacks are
           * partitioned. Vitest's `resolveConfig` reads this per project and
           * pins that project's `maxWorkers` to 1, so it holds by configuration
           * — `npm run test`, `npm run test:unit:db` and a bare `vitest` all get
           * it, without anyone remembering `--no-file-parallelism`.
           *
           * It does not slow the other projects down: "app", "functions",
           * "workers" and "scripts" keep their own parallelism.
           */
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
      {
        test: {
          name: "scripts",
          environment: "node",
          include: ["scripts/**/*.test.mjs"],
          exclude: ["**/node_modules/**"],
        },
      },
      {
        // Story 7.5 (Task 6, Task 7): public/push-sw.js is a plain
        // ServiceWorkerGlobalScope script served as a static asset — Vite
        // refuses to import a .js file living under public/ into the module
        // graph even with ?raw (only a non-JS/CSS asset or a `?url`
        // reference is allowed there), so its own test reads the source
        // with Node's `fs` instead of an import, same as "workers"/"scripts"
        // above need a real Node environment for their own reasons. The
        // TEST itself lives in the sibling service-worker/ directory, not
        // public/ — everything under public/ is copied verbatim into
        // dist/ on build, and a .test.ts file placed there would ship into
        // the production bundle.
        test: {
          name: "service-worker",
          globals: true,
          environment: "node",
          include: ["service-worker/**/*.test.ts"],
          exclude: ["**/node_modules/**"],
        },
      },
    ],
  },
});
