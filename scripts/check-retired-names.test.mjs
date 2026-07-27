import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRetiredNameCheck, loadConfig } from "./check-retired-names.mjs";

// This guard's own proof-that-it-bites artifact (Story 1.6 AC-12e). Every
// fixture is built fresh under a temp directory, and every offending
// identifier is derived from the real retired-names.json's exampleFragments
// at runtime — never typed contiguously into this source file — because
// this test file also lives under scripts/, which the real guard scans.

const config = loadConfig();

function patternById(id) {
  const pattern = config.patterns.find((p) => p.id === id);
  if (!pattern) throw new Error(`No pattern named ${id} in retired-names.json`);
  return pattern;
}

/** Joins a pattern's own exampleFragments into a live-matching string. */
function exampleFor(id) {
  return patternById(id).exampleFragments.join("");
}

let tempRoot;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "check-retired-names-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function writeFixture(relPath, content) {
  const full = path.join(tempRoot, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

describe("runRetiredNameCheck", () => {
  it("fails on a retired snake_case identifier", async () => {
    const value = exampleFor("1.3-children-contextual");
    await writeFixture("src/example.ts", `const x = "${value}";\n`);

    const violations = runRetiredNameCheck(tempRoot, config);

    expect(violations.some((v) => v.includes("example.ts"))).toBe(true);
  });

  it("fails on a camelCase compound of a retired identifier", async () => {
    const value = exampleFor("1.3-children-camelcase");
    await writeFixture("src/example.ts", `const ${value} = 1;\n`);

    const violations = runRetiredNameCheck(tempRoot, config);

    expect(violations.some((v) => v.includes("example.ts"))).toBe(true);
  });

  it("passes on the exact-path allowlist (the live jsonb column)", async () => {
    const value = exampleFor("1.1-fossil-words");
    const [allowlistedPath] = config.exactFileAllowlist;
    await writeFixture(allowlistedPath, `const x = "${value}";\n`);

    expect(runRetiredNameCheck(tempRoot, config)).toEqual([]);
  });

  it("passes on a React children prop", async () => {
    await writeFixture(
      "src/example.tsx",
      "export const Example = ({ children }) => children;\n",
    );

    expect(runRetiredNameCheck(tempRoot, config)).toEqual([]);
  });

  it("passes on the live 'references' / 'reference' domain vocabulary", async () => {
    await writeFixture(
      "src/example.ts",
      'const references = useGetList("references");\n',
    );

    expect(runRetiredNameCheck(tempRoot, config)).toEqual([]);
  });

  it("exempts the guard's own data file by exact path, not by directory", async () => {
    const everyExample = config.patterns
      .map((p) => p.exampleFragments.join(""))
      .join(" ");

    await writeFixture("scripts/retired-names.json", everyExample);
    await writeFixture("scripts/anything-else.json", everyExample);

    const violations = runRetiredNameCheck(tempRoot, config);

    expect(violations.some((v) => v.includes("retired-names.json"))).toBe(
      false,
    );
    expect(violations.some((v) => v.includes("anything-else.json"))).toBe(true);
  });
});
