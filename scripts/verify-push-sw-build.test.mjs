import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyPushSwBuild } from "./verify-push-sw-build.mjs";

/**
 * Story 7.5 review fix (F4). Every fixture lives under a fresh temp
 * directory — never the repo's real `dist/`, which may not exist (no
 * build has run yet) or may be stale from an unrelated prior `make
 * build` — so this suite is deterministic regardless of build state.
 */

let tempRoot;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "verify-push-sw-build-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

const PUSH_SW_SOURCE = `self.addEventListener("push", () => {});\n`;
const WIRED_SW_SOURCE = `importScripts("push-sw.js");\n`;

async function writeGoodFixture(root) {
  await mkdir(path.join(root, "public"), { recursive: true });
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(
    path.join(root, "public", "push-sw.js"),
    PUSH_SW_SOURCE,
    "utf-8",
  );
  await writeFile(
    path.join(root, "dist", "push-sw.js"),
    PUSH_SW_SOURCE,
    "utf-8",
  );
  await writeFile(path.join(root, "dist", "sw.js"), WIRED_SW_SOURCE, "utf-8");
}

describe("verifyPushSwBuild — the build actually shipped and wired the push listener", () => {
  it("passes when dist/push-sw.js matches the source and dist/sw.js imports it", async () => {
    // Arrange
    await writeGoodFixture(tempRoot);

    // Act
    const failures = verifyPushSwBuild(tempRoot, path.join(tempRoot, "dist"));

    // Assert
    expect(failures).toEqual([]);
  });

  it("fails when dist/push-sw.js is missing", async () => {
    // Arrange
    await writeGoodFixture(tempRoot);
    await rm(path.join(tempRoot, "dist", "push-sw.js"));

    // Act
    const failures = verifyPushSwBuild(tempRoot, path.join(tempRoot, "dist"));

    // Assert
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/push-sw\.js is missing/);
  });

  it("fails when dist/sw.js is missing", async () => {
    // Arrange
    await writeGoodFixture(tempRoot);
    await rm(path.join(tempRoot, "dist", "sw.js"));

    // Act
    const failures = verifyPushSwBuild(tempRoot, path.join(tempRoot, "dist"));

    // Assert
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/sw\.js is missing/);
  });

  it("fails when the build pipeline altered push-sw.js in transit (the F4 failure mode)", async () => {
    // Arrange — proves the exact live-verified regression: a built
    // push-sw.js that diverges from its source.
    await writeGoodFixture(tempRoot);
    await writeFile(
      path.join(tempRoot, "dist", "push-sw.js"),
      `${PUSH_SW_SOURCE}this is not valid javascript ((((`,
      "utf-8",
    );

    // Act
    const failures = verifyPushSwBuild(tempRoot, path.join(tempRoot, "dist"));

    // Assert
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/does not match public\/push-sw\.js/);
  });

  it("fails when dist/sw.js never imports push-sw.js", async () => {
    // Arrange — e.g. the vite.config.ts `workbox.importScripts` wiring
    // regressed or was removed.
    await writeGoodFixture(tempRoot);
    await writeFile(
      path.join(tempRoot, "dist", "sw.js"),
      "// no importScripts here\n",
      "utf-8",
    );

    // Act
    const failures = verifyPushSwBuild(tempRoot, path.join(tempRoot, "dist"));

    // Assert
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/does not call importScripts/);
  });
});
