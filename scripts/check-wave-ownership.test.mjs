import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadManifest,
  patternsOverlap,
  runPostWaveCheck,
  runPreDispatchCheck,
} from "./check-wave-ownership.mjs";

let tempRoot;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "check-wave-ownership-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function writeManifestFixture(relPath, manifest) {
  const full = path.join(tempRoot, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(manifest), "utf8");
  return full;
}

describe("patternsOverlap", () => {
  it("matches two equal literal paths", () => {
    // Arrange / Act / Assert
    expect(patternsOverlap("src/foo/Bar.tsx", "src/foo/Bar.tsx")).toBe(true);
  });

  it("does not match two different literal paths", () => {
    expect(patternsOverlap("src/foo/Bar.tsx", "src/foo/Baz.tsx")).toBe(false);
  });

  it("matches a directory glob against a literal file inside it", () => {
    // Arrange
    const glob = "src/foo/**";
    const literal = "src/foo/bar.ts";

    // Act
    const result = patternsOverlap(glob, literal);

    // Assert
    expect(result).toBe(true);
  });

  it("does not match a directory glob against a literal file outside it", () => {
    expect(patternsOverlap("src/foo/**", "src/bar/baz.ts")).toBe(false);
  });

  it("matches a root glob against everything beneath that root", () => {
    // "src/**" must overlap arbitrarily deep paths under src, not just its
    // direct children.
    expect(patternsOverlap("src/**", "src/a/b/c/deep.ts")).toBe(true);
  });

  it("does not match a root glob against a sibling root", () => {
    expect(patternsOverlap("src/**", "docs/readme.md")).toBe(false);
  });

  it("matches two nested directory globs that share a subtree", () => {
    // Arrange — the wider glob wholly contains the narrower one.
    const wide = "src/**";
    const narrow = "src/foo/**";

    // Act / Assert
    expect(patternsOverlap(wide, narrow)).toBe(true);
  });

  it("does not match two nested-looking globs rooted in disjoint directories", () => {
    expect(patternsOverlap("src/foo/**", "src/bar/**")).toBe(false);
  });

  it("matches a mid-segment wildcard glob against a literal file it covers", () => {
    expect(patternsOverlap("src/*.test.ts", "src/foo.test.ts")).toBe(true);
  });

  it("does not match a mid-segment wildcard glob against a file with the wrong suffix", () => {
    expect(patternsOverlap("src/*.test.ts", "src/foo.spec.ts")).toBe(false);
  });
});

describe("runPreDispatchCheck", () => {
  it("returns no violations for a pairwise disjoint manifest", () => {
    // Arrange
    const manifest = {
      agentA: ["src/components/atomic-crm/shidduchim/**"],
      agentB: ["src/components/atomic-crm/references/**"],
    };

    // Act
    const violations = runPreDispatchCheck(manifest);

    // Assert
    expect(violations).toEqual([]);
  });

  it("reports a direct overlap when two agents declare the same literal file", () => {
    // Arrange
    const manifest = {
      agentA: ["src/lib/types.ts"],
      agentB: ["src/lib/types.ts"],
    };

    // Act
    const violations = runPreDispatchCheck(manifest);

    // Assert
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("agentA");
    expect(violations[0]).toContain("agentB");
    expect(violations[0]).toContain("src/lib/types.ts");
  });

  it("reports an overlap between a directory glob and a literal file inside it", () => {
    // Arrange
    const manifest = {
      agentA: ["src/components/atomic-crm/shidduchim/**"],
      agentB: ["src/components/atomic-crm/shidduchim/Kanban.tsx"],
    };

    // Act
    const violations = runPreDispatchCheck(manifest);

    // Assert
    expect(violations).toHaveLength(1);
  });

  it("reports an overlap between two nested directory globs", () => {
    // Arrange
    const manifest = {
      agentA: ["src/**"],
      agentB: ["src/components/atomic-crm/**"],
    };

    // Act
    const violations = runPreDispatchCheck(manifest);

    // Assert
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("src/**");
    expect(violations[0]).toContain("src/components/atomic-crm/**");
  });

  it("does not compare an agent's own declared paths against each other", () => {
    // Arrange — a single agent may legitimately declare overlapping globs
    // for itself; only cross-agent overlap is a violation.
    const manifest = {
      agentA: ["src/foo/**", "src/foo/Bar.tsx"],
    };

    // Act
    const violations = runPreDispatchCheck(manifest);

    // Assert
    expect(violations).toEqual([]);
  });
});

describe("runPostWaveCheck", () => {
  it("reports no excursions when touched files match the manifest exactly", () => {
    // Arrange
    const manifest = {
      agentA: ["src/foo/Bar.tsx"],
      agentB: ["src/baz/**"],
    };
    const touchedPaths = ["src/foo/Bar.tsx", "src/baz/Qux.tsx"];

    // Act
    const result = runPostWaveCheck(manifest, touchedPaths);

    // Assert
    expect(result).toEqual({ unowned: [], unclaimed: [] });
  });

  it("flags a touched file that no agent declared", () => {
    // Arrange
    const manifest = {
      agentA: ["src/foo/Bar.tsx"],
    };
    const touchedPaths = ["src/foo/Bar.tsx", "src/sneaky/Undeclared.ts"];

    // Act
    const result = runPostWaveCheck(manifest, touchedPaths);

    // Assert
    expect(result.unowned).toHaveLength(1);
    expect(result.unowned[0]).toContain("src/sneaky/Undeclared.ts");
    expect(result.unclaimed).toEqual([]);
  });

  it("flags a declared path that was never touched", () => {
    // Arrange
    const manifest = {
      agentA: ["src/foo/Bar.tsx", "src/foo/Baz.tsx"],
    };
    const touchedPaths = ["src/foo/Bar.tsx"];

    // Act
    const result = runPostWaveCheck(manifest, touchedPaths);

    // Assert
    expect(result.unclaimed).toHaveLength(1);
    expect(result.unclaimed[0]).toContain("agentA");
    expect(result.unclaimed[0]).toContain("src/foo/Baz.tsx");
    expect(result.unowned).toEqual([]);
  });

  it("resolves a touched file against a declared directory glob, not just literal paths", () => {
    // Arrange
    const manifest = {
      agentA: ["src/components/atomic-crm/shidduchim/**"],
    };
    const touchedPaths = ["src/components/atomic-crm/shidduchim/Kanban.tsx"];

    // Act
    const result = runPostWaveCheck(manifest, touchedPaths);

    // Assert
    expect(result).toEqual({ unowned: [], unclaimed: [] });
  });
});

describe("loadManifest", () => {
  it("parses a well-formed manifest file from disk", async () => {
    // Arrange
    const manifestPath = await writeManifestFixture("manifest.json", {
      agentA: ["src/foo/**"],
    });

    // Act
    const manifest = loadManifest(manifestPath);

    // Assert
    expect(manifest).toEqual({ agentA: ["src/foo/**"] });
  });

  it("throws a descriptive error when an entry is not an array of strings", async () => {
    // Arrange
    const manifestPath = await writeManifestFixture("bad-manifest.json", {
      agentA: "src/foo/**",
    });

    // Act / Assert
    expect(() => loadManifest(manifestPath)).toThrow(/agentA/);
  });

  it("throws a descriptive error when the manifest is not an object", async () => {
    // Arrange
    const manifestPath = await writeManifestFixture("array-manifest.json", [
      "src/foo/**",
    ]);

    // Act / Assert
    expect(() => loadManifest(manifestPath)).toThrow(/JSON object/);
  });
});
