import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SHARED_ARTIFACTS,
  loadManifest,
  patternsOverlap,
  runOrderingCheck,
  runPostWaveCheck,
  runPreDispatchCheck,
  runSharedArtifactCheck,
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

describe("runSharedArtifactCheck", () => {
  it("warns when two agents feed a generated artifact that nobody declared", () => {
    // Arrange — the replayed false-clean: pairwise disjoint by paths, but
    // registry.json indexes both directories and the pre-commit hook
    // regenerates it, so both agents' commits rewrite it.
    const manifest = {
      agentA: ["src/components/atomic-crm/singles/**"],
      agentB: ["src/components/atomic-crm/shadchanim/**"],
    };

    // Act
    const warnings = runSharedArtifactCheck(manifest);

    // Assert
    expect(runPreDispatchCheck(manifest)).toEqual([]);
    expect(warnings.some((w) => w.includes("registry.json"))).toBe(true);
    const registryWarning = warnings.find((w) => w.includes("registry.json"));
    expect(registryWarning).toContain("agentA");
    expect(registryWarning).toContain("agentB");
  });

  it("stays silent once exactly one agent declares the contended artifact", () => {
    // Arrange — the prescribed resolution: give the artifact one owner.
    const manifest = {
      agentA: ["src/components/atomic-crm/singles/**", "registry.json"],
      agentB: ["src/components/atomic-crm/shadchanim/**"],
    };

    // Act
    const warnings = runSharedArtifactCheck(manifest);

    // Assert
    expect(warnings.filter((w) => w.includes("registry.json"))).toEqual([]);
  });

  it("does not warn when only one agent feeds the artifact", () => {
    // Arrange
    const manifest = {
      agentA: ["src/components/atomic-crm/singles/**"],
      agentB: ["doc/**"],
    };

    // Act
    const warnings = runSharedArtifactCheck(manifest);

    // Assert
    expect(warnings).toEqual([]);
  });

  it("warns when two agents edit the declarative schema that generates migrations", () => {
    // Arrange — migration filenames are timestamped at generation time, so
    // neither agent can declare the file it is about to create.
    const manifest = {
      agentA: ["supabase/schemas/01_tables.sql"],
      agentB: ["supabase/schemas/03_views.sql"],
    };

    // Act
    const warnings = runSharedArtifactCheck(manifest);

    // Assert
    expect(warnings.some((w) => w.includes("supabase/migrations/**"))).toBe(
      true,
    );
  });

  it("treats a declared migrations glob as ownership of the timestamped file it will create", () => {
    // Arrange
    const manifest = {
      agentA: ["supabase/schemas/01_tables.sql", "supabase/migrations/**"],
      agentB: ["supabase/schemas/03_views.sql"],
    };

    // Act
    const warnings = runSharedArtifactCheck(manifest);

    // Assert
    expect(warnings.filter((w) => w.includes("supabase/migrations"))).toEqual(
      [],
    );
    expect(
      patternsOverlap(
        "supabase/migrations/**",
        "supabase/migrations/20260727122733_rename_sales_to_members.sql",
      ),
    ).toBe(true);
  });

  it("warns when two agents both add user-facing copy but nobody owns the i18n catalogues", () => {
    // Arrange
    const manifest = {
      agentA: ["src/components/atomic-crm/singles/**"],
      agentB: ["src/components/admin/list-guesser.tsx"],
    };

    // Act
    const warnings = runSharedArtifactCheck(manifest);

    // Assert
    expect(warnings.some((w) => w.includes("englishCrmMessages.ts"))).toBe(
      true,
    );
    expect(warnings.some((w) => w.includes("frenchCrmMessages.ts"))).toBe(true);
  });

  it("does not raise the i18n warning for agents editing non-component modules", () => {
    // Arrange — the catalogues are fed by user-facing surfaces (.tsx), so a
    // wave of plain .ts modules must not draw a warning it cannot act on.
    const manifest = {
      agentA: ["src/components/atomic-crm/root/routeManifest.ts"],
      agentB: ["src/components/atomic-crm/providers/commons/canAccess.ts"],
    };

    // Act
    const warnings = runSharedArtifactCheck(manifest);

    // Assert
    expect(warnings.filter((w) => w.includes("CrmMessages"))).toEqual([]);
  });

  it("accepts an injected artifact table so the check is not pinned to this repo's files", () => {
    // Arrange
    const artifacts = [
      {
        artifact: "build/output.json",
        regeneratedBy: "make build",
        feeders: ["src/a/**", "src/b/**"],
      },
    ];
    const manifest = { agentA: ["src/a/**"], agentB: ["src/b/**"] };

    // Act
    const warnings = runSharedArtifactCheck(manifest, artifacts);

    // Assert
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("build/output.json");
    expect(warnings[0]).toContain("make build");
  });

  it("names every tabled artifact with a non-empty feeder set", () => {
    // Arrange / Act / Assert — a table entry with no feeders can never fire.
    for (const entry of SHARED_ARTIFACTS) {
      expect(entry.artifact.length).toBeGreaterThan(0);
      expect(entry.feeders.length).toBeGreaterThan(0);
    }
  });
});

describe("runOrderingCheck", () => {
  it("reports an agent that declares it must run after another", () => {
    // Arrange — Epic 1's O1 blocker: path-disjoint, but 1.5 had to land first.
    const manifest = {
      "story-1.5": ["src/components/atomic-crm/root/routeManifest.ts"],
      "story-1.2": {
        paths: ["src/components/atomic-crm/sales/**"],
        after: ["story-1.5"],
      },
    };

    // Act
    const violations = runOrderingCheck(manifest);

    // Assert
    expect(runPreDispatchCheck(manifest)).toEqual([]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("story-1.2");
    expect(violations[0]).toContain("story-1.5");
  });

  it("returns nothing when no agent declares an ordering constraint", () => {
    // Arrange
    const manifest = {
      agentA: ["src/foo/**"],
      agentB: { paths: ["src/bar/**"], after: [] },
    };

    // Act / Assert
    expect(runOrderingCheck(manifest)).toEqual([]);
  });
});

describe("object-form manifest entries", () => {
  it("finds path overlaps across the array form and the object form alike", () => {
    // Arrange
    const manifest = {
      agentA: ["src/lib/types.ts"],
      agentB: { paths: ["src/lib/types.ts"] },
    };

    // Act
    const violations = runPreDispatchCheck(manifest);

    // Assert
    expect(violations).toHaveLength(1);
  });

  it("reconciles touched paths against object-form declarations", () => {
    // Arrange
    const manifest = {
      agentA: { paths: ["src/foo/**"], after: [] },
    };

    // Act
    const result = runPostWaveCheck(manifest, ["src/foo/Bar.tsx"]);

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

  it("parses an object-form entry carrying an ordering constraint", async () => {
    // Arrange
    const manifestPath = await writeManifestFixture("ordered-manifest.json", {
      agentA: ["src/foo/**"],
      agentB: { paths: ["src/bar/**"], after: ["agentA"] },
    });

    // Act
    const manifest = loadManifest(manifestPath);

    // Assert
    expect(runOrderingCheck(manifest)).toHaveLength(1);
  });

  it("throws when an object-form entry has no paths array", async () => {
    // Arrange
    const manifestPath = await writeManifestFixture("no-paths.json", {
      agentA: { after: [] },
    });

    // Act / Assert
    expect(() => loadManifest(manifestPath)).toThrow(/agentA/);
  });

  it("throws when after names an agent that is not in the manifest", async () => {
    // Arrange
    const manifestPath = await writeManifestFixture("unknown-after.json", {
      agentA: { paths: ["src/foo/**"], after: ["ghost"] },
    });

    // Act / Assert
    expect(() => loadManifest(manifestPath)).toThrow(/ghost/);
  });

  it("throws when an agent lists itself in after", async () => {
    // Arrange
    const manifestPath = await writeManifestFixture("self-after.json", {
      agentA: { paths: ["src/foo/**"], after: ["agentA"] },
    });

    // Act / Assert
    expect(() => loadManifest(manifestPath)).toThrow(/itself/);
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
