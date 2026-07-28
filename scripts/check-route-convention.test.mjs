import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runRouteConventionCheck,
  loadConfig,
} from "./check-route-convention.mjs";

// This guard's own proof-that-it-bites artifact (Story 3.12 AC 6). Every
// fixture is built fresh under a temp directory, and every pattern is
// proven red against a deliberately-offending fixture before this file
// trusts it to be green on the real tree
// (_bmad-output/planning-artifacts/epic3-api-contract.md §13 rule 2).

const config = loadConfig();

function patternById(id) {
  const pattern = config.patterns.find((p) => p.id === id);
  if (!pattern) {
    throw new Error(`No pattern named ${id} in route-convention.json`);
  }
  return pattern;
}

let tempRoot;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "check-route-convention-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function writeFixture(relPath, content) {
  const full = path.join(tempRoot, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

describe("runRouteConventionCheck — create-path-literal", () => {
  it("fails on a hardcoded /{resource}/create path string", async () => {
    // Arrange — built from parts so this source file does not itself trip
    // the pattern once scripts/ grows a route-convention-aware reviewer.
    const offendingPath = ["/singles", "create"].join("/");
    await writeFixture(
      "src/example.tsx",
      `export const link = "${offendingPath}";\n`,
    );

    // Act
    const violations = runRouteConventionCheck(tempRoot, config);

    // Assert
    expect(violations.some((v) => v.includes("create-path-literal"))).toBe(
      true,
    );
  });

  it("does not fire on the AD-24 new-route segment, which has no leading slash or resource name", async () => {
    await writeFixture(
      "src/example.tsx",
      '<Route path="create/*" element={<LegacyCreatePathRedirect />} />;\n',
    );

    const violations = runRouteConventionCheck(tempRoot, config);

    expect(violations.some((v) => v.includes("create-path-literal"))).toBe(
      false,
    );
  });
});

describe("runRouteConventionCheck — create-path-hook-type", () => {
  it("fails on ra-core's hardcoded create/edit/show hook type outside the allowlisted buttons", async () => {
    await writeFixture(
      "src/example.tsx",
      'createPath({ resource, type: "edit" });\n',
    );

    const violations = runRouteConventionCheck(tempRoot, config);

    expect(violations.some((v) => v.includes("create-path-hook-type"))).toBe(
      true,
    );
  });

  it("passes for each of the three allowlisted button files", async () => {
    const { allowlistedFiles } = patternById("create-path-hook-type");

    for (const allowlistedFile of allowlistedFiles) {
      await writeFixture(
        allowlistedFile,
        'createPath({ resource, type: "create" });\n',
      );
    }

    const violations = runRouteConventionCheck(tempRoot, config);

    expect(violations.some((v) => v.includes("create-path-hook-type"))).toBe(
      false,
    );
  });
});

describe("runRouteConventionCheck — redirect-to-show", () => {
  it('fails on redirect="show"', async () => {
    await writeFixture(
      "src/example.tsx",
      '<Edit redirect="show"><SimpleForm /></Edit>;\n',
    );

    const violations = runRouteConventionCheck(tempRoot, config);

    expect(violations.some((v) => v.includes("redirect-to-show"))).toBe(true);
  });

  it("does not fire on redirect={redirectToRecord}", async () => {
    await writeFixture(
      "src/example.tsx",
      "<Edit redirect={redirectToRecord}><SimpleForm /></Edit>;\n",
    );

    const violations = runRouteConventionCheck(tempRoot, config);

    expect(violations.some((v) => v.includes("redirect-to-show"))).toBe(false);
  });
});

describe("runRouteConventionCheck — excludeDirs", () => {
  it("never scans src/components/ui, for any pattern", async () => {
    const offendingPath = ["/singles", "create"].join("/");
    await writeFixture(
      "src/components/ui/example.tsx",
      `export const link = "${offendingPath}";\n`,
    );

    const violations = runRouteConventionCheck(tempRoot, config);

    expect(violations).toEqual([]);
  });
});

describe("runRouteConventionCheck — the real repository", () => {
  it("scans clean", () => {
    const repoRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );

    const violations = runRouteConventionCheck(repoRoot, config);

    expect(violations).toEqual([]);
  });
});
