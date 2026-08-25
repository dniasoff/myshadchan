/**
 * What the production build ships, and what it must never ship again.
 *
 * Text assertions on the config files themselves, for the same reason
 * `stack-wiring.test.mjs` uses them: the things guarded here are keys in a
 * Vite config and a Vercel config, and importing `vite.config.ts` would pull
 * in the PWA plugin.
 *
 * Every regression below was real and measured against the deployed site:
 *
 * - `stats.html`, the bundle-analysis report, was served publicly (HTTP 200,
 *   1.55 MB) and precached onto every first-time visitor's phone — the single
 *   largest precache entry, for a file nobody outside a perf session opens.
 * - pdfjs, mammoth and DOMPurify are lazy BY DESIGN
 *   (`attachments/docxSanitizer.guard.test.ts` fails the build if they become
 *   static imports) and were being precached anyway, undoing the split.
 * - ~14 MB of source maps were built and uploaded per deploy, served to
 *   nobody (Vercel 403s every `.map`) and consumed by nothing.
 *
 * Together: 69 precache entries / 5.59 MB -> 39 / 2.63 MB.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const viteConfig = fs.readFileSync(
  path.join(REPO_ROOT, "vite.config.ts"),
  "utf8",
);
const vercelConfig = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "vercel.json"), "utf8"),
);

describe("the service-worker precache stays an app shell", () => {
  it("read a real config, so the assertions below cannot pass vacuously", () => {
    // Arrange / Act / Assert
    expect(viteConfig).toContain("VitePWA(");
    expect(viteConfig.length).toBeGreaterThan(2000);
  });

  it("never precaches the deliberately-lazy library chunks", () => {
    // Arrange / Act / Assert — each is reached only through `await import()`.
    for (const pattern of [
      "**/pdf-*.js",
      "**/mammoth-*.js",
      "**/purify.es-*.js",
      "**/pdf.worker*",
    ]) {
      expect(viteConfig).toContain(pattern);
    }
  });

  it("keeps `mjs` out of globPatterns", () => {
    // Arrange — `pdf.worker.min-*.mjs` is 1.26 MB and escapes the precache
    // ONLY because that extension is absent from the glob. Adding it looks
    // like a tidy-up and is a 1.26 MB regression on every first visit.
    const glob = /globPatterns:\s*\[([^\]]*)\]/.exec(viteConfig);

    // Act / Assert
    expect(glob).not.toBeNull();
    expect(glob[1]).not.toContain("mjs");
  });

  it("gives mammoth a stable chunk name, which the exclusion depends on", () => {
    // Arrange / Act / Assert — without this, Rollup names the docx renderer
    // after mammoth's own entry file (`index.js`), making it indistinguishable
    // from the app entry chunk. A `**/index-*.js` exclusion would then drop
    // the application itself and break the PWA.
    expect(viteConfig).toContain("node_modules/mammoth");
    expect(viteConfig).toContain('return "mammoth"');
  });

  it("does not write the bundle report into the deployed output by default", () => {
    // Arrange / Act / Assert — the visualizer must be opt-in.
    expect(viteConfig).toContain("process.env.ANALYZE");
    const unguarded = /^\s*visualizer\(\{/m.test(viteConfig);
    expect(unguarded).toBe(false);
  });

  it("ships no source maps", () => {
    // Arrange / Act / Assert
    expect(viteConfig).toMatch(/sourcemap:\s*false/);
    expect(viteConfig).not.toMatch(/sourcemap:\s*true/);
  });
});

describe("Vercel response headers", () => {
  it("scopes immutable caching to /assets/ only", () => {
    // Arrange — index.html, sw.js, registerSW.js and manifest.json MUST keep
    // revalidating; an immutable rule over `/(.*)` means an installed PWA
    // never sees another deploy.
    const rules = vercelConfig.headers ?? [];
    const immutable = rules.filter((rule) =>
      (rule.headers ?? []).some((header) =>
        String(header.value).includes("immutable"),
      ),
    );

    // Act / Assert
    expect(immutable).toHaveLength(1);
    expect(immutable[0].source).toBe("/assets/(.*)");
  });

  it("sets the headers a session-bearing app over family records needs", () => {
    // Arrange / Act
    const present = new Set(
      (vercelConfig.headers ?? []).flatMap((rule) =>
        (rule.headers ?? []).map((header) => header.key),
      ),
    );

    // Assert
    for (const key of [
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
    ]) {
      expect([...present]).toContain(key);
    }
  });
});
