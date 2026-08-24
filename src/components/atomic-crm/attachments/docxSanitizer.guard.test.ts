import { describe, expect, it } from "vitest";

/**
 * `mammoth` is 517KB of the built output and `dompurify` another 30KB, and
 * both exist for one case: a resume that happens to be a Word document rather
 * than a PDF. Reached through `await import()`, they are their own chunks and
 * cost nothing until someone opens such a file — measured on the production
 * build, where neither appears in the entry bundle nor is statically imported
 * by it.
 *
 * A top-level `import ... from "mammoth"` anywhere in the app would collapse
 * that: the bundler would fold half a megabyte into a chunk every visitor
 * downloads, for a feature most will never touch, and nothing else in the
 * repo would notice. This guard is cheaper than a bundle-size check and it
 * fails at the cause rather than at the symptom.
 *
 * The `?raw` + `import.meta.glob` idiom matches
 * `entity360/tabs/FilesTab.guard.test.ts` and its neighbours.
 */
const sources = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** A top-level `import`/`export ... from "<pkg>"`, but NOT `await import()`. */
function hasStaticImportOf(source: string, packageName: string): boolean {
  const pattern = new RegExp(
    // `import x from "pkg"` / `import "pkg"` / `export * from "pkg"`, with the
    // dynamic form excluded by requiring `import`/`export` at a line start.
    String.raw`^\s*(?:import|export)\s[^\n]*?["']${packageName}["']`,
    "m",
  );
  return pattern.test(source);
}

const HEAVY_PACKAGES = ["mammoth", "dompurify"];

describe("the docx libraries stay out of everyone else's bundle", () => {
  it("finds source files to check, so an empty glob cannot pass vacuously", () => {
    // Arrange / Act / Assert — the failure mode this whole file would
    // otherwise have: a glob that matches nothing reports every package clean.
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it.each(HEAVY_PACKAGES)(
    "reaches %s only through a dynamic import",
    (packageName) => {
      // Arrange / Act
      const offenders = Object.entries(sources)
        .filter(([, source]) => hasStaticImportOf(source, packageName))
        .map(([path]) => path);

      // Assert
      expect(offenders).toEqual([]);
    },
  );

  it("does reach both of them somewhere, so the feature is actually wired", () => {
    // Arrange / Act — the mirror of the assertions above: they would also
    // pass if the libraries had simply been removed.
    const all = Object.values(sources).join("\n");

    // Assert
    for (const packageName of HEAVY_PACKAGES) {
      expect(all).toContain(`import("${packageName}")`);
    }
  });
});
