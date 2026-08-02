#!/usr/bin/env node
/**
 * Story 7.5 review fix (F4): vite-plugin-pwa's `workbox.importScripts`
 * option (vite.config.ts) makes the generated service worker call
 * `importScripts("push-sw.js")` INSIDE its async AMD factory
 * (`Promise.all([...]).then(factory)`), not at top level. A rejection in
 * there — a syntax error in push-sw.js, or a build pipeline change that
 * ever stops copying `public/` verbatim into `dist/` — does not fail the
 * build and does not stop the worker from installing: `dist/sw.js`
 * activates normally with no push listener at all, and the only trace is
 * an unhandled promise rejection nothing surfaces. Proven live: appending
 * broken syntax to a built `dist/push-sw.js` still left the worker
 * installed and activated.
 *
 * `service-worker/push-sw.test.ts` already proves push-sw.js's SOURCE is
 * syntactically valid and behaves correctly in isolation — by its own
 * header comment, it deliberately reads `public/push-sw.js`, not the
 * built artifact. This script is the complementary check: that the BUILT
 * `dist/push-sw.js` still matches that proven-good source byte-for-byte,
 * and that `dist/sw.js` actually references it. Runs after every
 * production build (`npm run build`) and fails loudly instead of shipping
 * a silently no-op push listener.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Pure check, exported for the unit test: takes the repo root and the dist
 * directory to verify (never the real `dist/` in tests, so a leftover or
 * absent build from a prior `make build` can never leak into this run) and
 * returns a list of failure strings — empty means the build is sound.
 */
export function verifyPushSwBuild(repoRoot, distDir) {
  const failures = [];

  const publicPath = path.join(repoRoot, "public", "push-sw.js");
  const distPushSwPath = path.join(distDir, "push-sw.js");
  const distSwPath = path.join(distDir, "sw.js");

  if (!existsSync(distPushSwPath)) {
    failures.push(
      `${path.relative(repoRoot, distPushSwPath)} is missing — public/push-sw.js was not copied into the build`,
    );
  }
  if (!existsSync(distSwPath)) {
    failures.push(
      `${path.relative(repoRoot, distSwPath)} is missing — the workbox service worker was not generated`,
    );
  }
  if (failures.length > 0) return failures;

  const publicSource = readFileSync(publicPath, "utf-8");
  const builtSource = readFileSync(distPushSwPath, "utf-8");
  if (publicSource !== builtSource) {
    failures.push(
      "dist/push-sw.js does not match public/push-sw.js byte-for-byte — the build pipeline altered it in transit",
    );
  }

  const swSource = readFileSync(distSwPath, "utf-8");
  if (!swSource.includes('importScripts("push-sw.js")')) {
    failures.push(
      'dist/sw.js does not call importScripts("push-sw.js") — the push listener did not ship wired in',
    );
  }

  return failures;
}

function main() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const distDir = path.join(repoRoot, "dist");
  const failures = verifyPushSwBuild(repoRoot, distDir);

  if (failures.length > 0) {
    console.error("verify-push-sw-build failed:\n");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("verify-push-sw-build: push-sw.js shipped and wired into sw.js");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
