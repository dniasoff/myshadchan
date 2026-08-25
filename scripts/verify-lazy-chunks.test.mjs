import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyLazyChunks } from "./verify-lazy-chunks.mjs";

/**
 * Fixtures live under a fresh temp directory, never the repo's real `dist/` —
 * which may not exist (no build has run) or be stale — so this suite is
 * deterministic regardless of build state, matching
 * `verify-push-sw-build.test.mjs`.
 *
 * The shapes below are taken from real build output. The "static import"
 * fixture is the exact form that shipped a 141 KB Word renderer onto the login
 * page; the "dynamic" fixture is Vite's `__vite__mapDeps` array, which names
 * the same chunk as a bare string and is CORRECT — telling those two apart is
 * the whole job of this check.
 */

let tempRoot;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "verify-lazy-chunks-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

const LAZY_FILES = {
  "pdf-aaaaaaaa.js": "export const pdf=1;\n",
  "mammoth-bbbbbbbb.js": "export const g=1,c=2;\n",
  "purify.es-cccccccc.js": "export const purify=1;\n",
};

async function writeBuild(root, entrySource) {
  const assets = path.join(root, "dist", "assets");
  await mkdir(assets, { recursive: true });
  for (const [name, source] of Object.entries(LAZY_FILES)) {
    await writeFile(path.join(assets, name), source, "utf-8");
  }
  await writeFile(path.join(assets, "index-dddddddd.js"), entrySource, "utf-8");
  return path.join(root, "dist");
}

/** Vite's dynamic form: the chunk is named as a bare string in the dep map. */
const DYNAMIC_ENTRY = `const __vite__mapDeps=(i,m=m.f||(m.f=["./mammoth-bbbbbbbb.js","./pdf-aaaaaaaa.js","./purify.es-cccccccc.js"]))=>i.map(i=>d[i]);\nexport const app=1;\n`;

/** The regression: a real static import of the lazy chunk. */
const STATIC_ENTRY = `import{g as Kl,c as vl}from"./mammoth-bbbbbbbb.js";\nexport const app=1;\n`;

describe("verifyLazyChunks", () => {
  it("passes when the lazy chunks are only named in a dynamic dep map", async () => {
    // Arrange
    const distDir = await writeBuild(tempRoot, DYNAMIC_ENTRY);

    // Act
    const failures = verifyLazyChunks(distDir);

    // Assert
    expect(failures).toEqual([]);
  });

  it("fails on the exact form that shipped: a static import of the chunk", async () => {
    // Arrange
    const distDir = await writeBuild(tempRoot, STATIC_ENTRY);

    // Act
    const failures = verifyLazyChunks(distDir);

    // Assert — names both the chunk and who pulled it in, so the message is
    // actionable without re-running a bundle analysis.
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("mammoth-bbbbbbbb.js");
    expect(failures[0]).toContain("index-dddddddd.js");
    expect(failures[0]).toContain("manualChunks");
  });

  it("fails loudly when a lazy chunk is missing, rather than passing vacuously", async () => {
    // Arrange — the failure mode this whole check would otherwise have: a
    // renamed or removed chunk makes every assertion trivially true.
    const assets = path.join(tempRoot, "dist", "assets");
    await mkdir(assets, { recursive: true });
    await writeFile(path.join(assets, "index-dddddddd.js"), "e=1;\n", "utf-8");

    // Act
    const failures = verifyLazyChunks(path.join(tempRoot, "dist"));

    // Assert
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join(" ")).toContain("is not in the build");
  });

  it("reports a missing build rather than throwing", async () => {
    // Arrange / Act
    const failures = verifyLazyChunks(path.join(tempRoot, "no-such-dist"));

    // Assert
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("no build output");
  });
});
