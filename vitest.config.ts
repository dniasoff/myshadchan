import path from "node:path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";

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
        plugins: [react()],
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
            instances: [
              {
                browser: "chromium",
                ...(process.env.CI && {
                  launch: { channel: "chromium-headless-shell" },
                }),
              },
            ],
            commands: {
              // Uses Chrome DevTools Protocol to override the timezone at runtime,
              // since process.env.TZ has no effect in a real browser environment.
              async setTimezone({ context, page }, timezoneId: string) {
                const session = await context.newCDPSession(page);
                await session.send("Emulation.setTimezoneOverride", {
                  timezoneId,
                });
                await session.detach();
              },
            },
          },
          exclude: [
            "**/node_modules/**",
            "doc/**",
            "supabase/**",
            ".supabase-e2e/**",
            "e2e/**/*.spec.{ts,tsx}",
            "workers/**",
            // Node-only tests for the repo's own tooling; run under the
            // "scripts" project below instead of the browser runner.
            "scripts/**",
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
          exclude: ["**/node_modules/**", ".supabase-e2e/**"],
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
    ],
  },
});
