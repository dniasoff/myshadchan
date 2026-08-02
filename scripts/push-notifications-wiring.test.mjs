/**
 * Story 7.5 review fixes (F1, F3). Text assertions on the config files
 * themselves, same reasoning as stack-wiring.test.mjs: the things being
 * guarded are a key in a Vite `define` block and a glob in a tsconfig
 * `include` array, neither reachable by importing the module — importing
 * vite.config.ts pulls in the PWA plugin and its build-time work.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const read = (file) => fs.readFileSync(path.join(REPO_ROOT, file), "utf8");

describe("F1 — VITE_VAPID_PUBLIC_KEY reaches the client in a deployed build", () => {
  it("is in vite.config.ts's production define allow-list, alongside the other VITE_* client vars", () => {
    // Arrange
    const source = read("vite.config.ts");
    const defineBlock = source.slice(
      source.indexOf("define:"),
      source.indexOf("base:"),
    );

    // Assert — this `define` block, not `.env.*` files, is the only
    // channel by which a VITE_* value reaches the client in a deployed
    // build (see the sibling entries in this same block).
    expect(defineBlock).toMatch(
      /"import\.meta\.env\.VITE_VAPID_PUBLIC_KEY":\s*JSON\.stringify\(\s*process\.env\.VITE_VAPID_PUBLIC_KEY,?\s*\)/,
    );
  });
});

describe("F3 — make typecheck covers service-worker/", () => {
  it("tsconfig.node.json includes service-worker/**/*.ts", () => {
    // Arrange — tsconfig.node.json is JSONC (it carries `//` comments,
    // e.g. above "src/vite-env.d.ts" below), so this reads it as text
    // rather than JSON.parse-ing it.
    const source = read("tsconfig.node.json");
    const includeBlock = source.slice(
      source.indexOf('"include"'),
      source.indexOf("]", source.indexOf('"include"')) + 1,
    );

    // Assert
    expect(includeBlock).toContain('"service-worker/**/*.ts"');
  });
});
