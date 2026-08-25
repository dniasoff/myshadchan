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

async function writeBuild(root, entrySource, extra = {}) {
  const dist = path.join(root, "dist");
  const assets = path.join(dist, "assets");
  await mkdir(assets, { recursive: true });
  for (const [name, source] of Object.entries(LAZY_FILES)) {
    await writeFile(path.join(assets, name), source, "utf-8");
  }
  await writeFile(path.join(assets, "index-dddddddd.js"), entrySource, "utf-8");
  // The eager-bytes check needs a real entry point and a CRM chunk to seed
  // from, plus a home for each forbidden library's marker.
  await writeFile(
    path.join(assets, "CRM-eeeeeeee.js"),
    extra.crm ?? "export const crm=1;\n",
    "utf-8",
  );
  await writeFile(
    path.join(assets, "ShidduchimList-ffffffff.js"),
    extra.board ?? 'export const b="dragHandleUsageInstructions";\n',
    "utf-8",
  );
  await writeFile(
    path.join(assets, "ImageEditorDialog-gggggggg.js"),
    extra.cropper ?? 'export const c="cropper-crop-box";\n',
    "utf-8",
  );
  await writeFile(
    path.join(dist, "index.html"),
    '<script type="module" src="./assets/index-dddddddd.js"></script>',
    "utf-8",
  );
  return dist;
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

/**
 * The second check: a library that must never reach the login path.
 *
 * These exist because the FIRST version of this check was a false green on
 * both regressions it was written for. It seeded the eager set from the entry
 * chunk alone — but `CRM` is loaded through `React.lazy`, so it was not in
 * that set, and both libraries had landed inside `CRM`. Seeding from the CRM
 * chunk as well is what makes it real, and the vacuity cases below are what
 * keep it that way.
 */
describe("verifyLazyChunks — libraries kept off the login path", () => {
  it("passes when each library sits in a chunk outside the eager set", async () => {
    // Arrange / Act
    const distDir = await writeBuild(tempRoot, DYNAMIC_ENTRY);

    // Assert
    expect(verifyLazyChunks(distDir)).toEqual([]);
  });

  it("fails when a library lands in the CRM chunk, which the login screen waits for", async () => {
    // Arrange — the exact shape that shipped: `@hello-pangea/dnd` inside
    // `CRM`, reached from an eagerly-registered 360 header that imported one
    // small icon out of the board's card module.
    const distDir = await writeBuild(tempRoot, DYNAMIC_ENTRY, {
      crm: 'export const x="dragHandleUsageInstructions";\n',
    });

    // Act
    const failures = verifyLazyChunks(distDir);

    // Assert — names the library and the chunk, so the message is actionable.
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("@hello-pangea/dnd");
    expect(failures[0]).toContain("CRM-eeeeeeee.js");
  });

  it("fails when a library reaches the eager set indirectly", async () => {
    // Arrange — CRM statically imports a shared chunk that carries the marker.
    // A check that only looked at the seed chunks themselves would miss this.
    await writeBuild(tempRoot, DYNAMIC_ENTRY, {
      crm: 'import"./shared-hhhhhhhh.js";\nexport const crm=1;\n',
    });
    await writeFile(
      path.join(tempRoot, "dist", "assets", "shared-hhhhhhhh.js"),
      'export const c="cropper-crop-box";\n',
      "utf-8",
    );

    // Act
    const failures = verifyLazyChunks(path.join(tempRoot, "dist"));

    // Assert
    expect(failures.join(" ")).toContain("cropperjs");
    expect(failures.join(" ")).toContain("shared-hhhhhhhh.js");
  });

  it("fails loudly when a marker matches nothing, rather than passing vacuously", async () => {
    // Arrange — the library removed, or its marker minified away. Either way
    // the check is verifying nothing and must say so.
    const distDir = await writeBuild(tempRoot, DYNAMIC_ENTRY, {
      board: "export const b=1;\n",
    });

    // Act
    const failures = verifyLazyChunks(distDir);

    // Assert
    expect(failures.join(" ")).toContain("appears in no chunk");
    expect(failures.join(" ")).toContain("verified nothing");
  });

  it("fails when the eager set cannot be resolved at all", async () => {
    // Arrange — an index.html naming no entry chunk. This is the failure the
    // first version of the check had silently: an eager set too small to
    // cover the login path, reported as success.
    const distDir = await writeBuild(tempRoot, DYNAMIC_ENTRY);
    await writeFile(
      path.join(distDir, "index.html"),
      "<html><body>no entry here</body></html>",
      "utf-8",
    );

    // Act
    const failures = verifyLazyChunks(distDir);

    // Assert
    expect(failures.join(" ")).toContain("verified nothing");
  });
});
