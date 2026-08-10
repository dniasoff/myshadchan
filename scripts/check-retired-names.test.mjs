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

/**
 * A pattern's exempt terms that match the pattern themselves — the ones the
 * exemption actually exists for. Read from retired-names.json at runtime for
 * the same reason exampleFor() is: this file lives under scripts/, which the
 * real guard scans, so it may never spell a retired term out.
 *
 * (The inert remainder — the four CSS pseudo-class entries under
 * 1.3-children-contextual — cannot mask anything under either rule, so
 * asserting on them would prove nothing.)
 */
function selfMatchingExemptsFor(id) {
  const pattern = patternById(id);
  const compiled = new RegExp(pattern.regex, pattern.flags ?? "");
  const terms = (pattern.exempt ?? []).filter((term) => compiled.test(term));
  if (terms.length === 0)
    throw new Error(`No self-matching exempt term for ${id}`);
  return terms;
}

/**
 * Builds the one line on which a naive exemption strip would fabricate a
 * violation: `head + exemptTerm + tail`, where head and tail are the two
 * halves of the very substring the pattern matches inside that exempt term.
 * Deleting the term joins them back into a match nobody wrote; blanking it
 * to a separator leaves `head + " " + tail`, which matches nothing.
 *
 * Derived from the live config rather than hand-written so it stays literal
 * free (this file is scanned by the guard it tests) and so a newly added
 * exemption is covered the moment it lands.
 */
function spliceHazardFor(id) {
  const pattern = patternById(id);
  const compiled = new RegExp(pattern.regex, pattern.flags ?? "");
  const [exemptTerm] = selfMatchingExemptsFor(id);
  const [matched] = compiled.exec(exemptTerm);
  if (matched.length < 2)
    throw new Error(`Cannot split a ${matched.length}-char match for ${id}`);
  const split = Math.ceil(matched.length / 2);
  return `${matched.slice(0, split)}${exemptTerm}${matched.slice(split)}`;
}

/** The pattern ids whose exemptions are load-bearing, for table-driven cases. */
const EXEMPT_BEARING_PATTERN_IDS = config.patterns
  .filter((p) => p.exempt?.length)
  .map((p) => p.id);

/**
 * A pattern's FILE-SCOPED (`{ file, term }`) exempt entries that match the
 * pattern themselves — read from retired-names.json at runtime for the same
 * reason selfMatchingExemptsFor() is: this file lives under scripts/, which
 * the real guard scans, so it may never spell a retired term out.
 */
function selfMatchingFileScopedExemptsFor(id) {
  const pattern = patternById(id);
  const compiled = new RegExp(pattern.regex, pattern.flags ?? "");
  const entries = (pattern.exempt ?? []).filter(
    (entry) => typeof entry === "object" && compiled.test(entry.term),
  );
  if (entries.length === 0)
    throw new Error(`No self-matching file-scoped exempt entry for ${id}`);
  return entries;
}

/** The pattern ids carrying at least one file-scoped exempt entry. */
const FILE_SCOPED_EXEMPT_PATTERN_IDS = config.patterns
  .filter((p) => (p.exempt ?? []).some((entry) => typeof entry === "object"))
  .map((p) => p.id);

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

  // An exemption excuses its own term and nothing else. Before this, the
  // exemption test was a whole-line `includes()`, so any line carrying an
  // exempt term became a blind spot for the entire pattern — an unlimited
  // number of real fossils could hide behind one `asChild`. Nothing in the
  // tree exploited that (measured: re-scanning main under the strict rule
  // reported zero extra lines), but the recent additions to the exempt lists
  // made a latent hole load-bearing.
  describe("per-term exemptions cannot mask a co-located fossil", () => {
    it.each(EXEMPT_BEARING_PATTERN_IDS)(
      "reports a fossil sharing a line with an exempt term (%s)",
      async (patternId) => {
        const [exemptTerm] = selfMatchingExemptsFor(patternId);
        const fossil = exampleFor(patternId);

        await writeFixture(
          "src/example.ts",
          `// ${exemptTerm} — and, on the very same line: ${fossil}\n`,
        );

        const violations = runRetiredNameCheck(tempRoot, config);

        expect(violations).toEqual([
          `src/example.ts:1: matches "${patternId}"`,
        ]);
      },
    );

    it.each(EXEMPT_BEARING_PATTERN_IDS)(
      "still exempts every legitimate exempt term on a line of its own (%s)",
      async (patternId) => {
        const terms = selfMatchingExemptsFor(patternId);

        await writeFixture("src/example.ts", `${terms.join("\n")}\n`);

        expect(runRetiredNameCheck(tempRoot, config)).toEqual([]);
      },
    );

    it("still exempts a line where two exempt terms overlap", async () => {
      // Real React: the two exempt terms share the word between them, so
      // whichever is blanked first destroys the other. Neither order may
      // leave a residue the pattern still matches (the implementation blanks
      // longest-first so the most specific term always wins).
      const terms = selfMatchingExemptsFor("1.3-children-camelcase");
      const namespaced = terms.find((t) => t.startsWith("React."));
      const method = terms.find(
        (t) => t.startsWith("React.") === false && t.endsWith(".map"),
      );
      const overlap = namespaced.split(".")[1];

      await writeFixture(
        "src/example.tsx",
        `${namespaced}${method.slice(overlap.length)}(items, render);\n`,
      );

      expect(runRetiredNameCheck(tempRoot, config)).toEqual([]);
    });

    // Guards the implementation rather than the old behaviour. Blanking an
    // exempt term to the empty string splices its neighbours together, and
    // spliceHazardFor() builds precisely the line where that splice would
    // fabricate a match nobody wrote. A guard that invents violations gets
    // switched off, so this is as important as the masking cases above.
    it.each(EXEMPT_BEARING_PATTERN_IDS)(
      "blanks an exempt term to a separator, never splicing a new match (%s)",
      async (patternId) => {
        await writeFixture(
          "src/example.ts",
          `const x = "${spliceHazardFor(patternId)}";\n`,
        );

        expect(runRetiredNameCheck(tempRoot, config)).toEqual([]);
      },
    );
  });

  // Story 8.1 review fix (9cf8e13) collided with this pattern via two real,
  // unrelated third-party identifiers quoted in adminRouteBuilders.tsx (one
  // bare import from "react", one named in a doc comment from
  // "react-router") — nothing to do with the retired resource this pattern
  // exists to catch. Deliberately not spelled out contiguously here: this
  // file lives under scripts/, which the real guard scans (see the file
  // header), and both terms are read from config below instead. A GLOBAL
  // exempt term would have blinded this pattern to a genuine future fossil
  // sharing the same substring anywhere in the repo; file-scoping — the
  // same "keyed by file + fragment" shape check-tailwind-arbitrary-var.mjs
  // already uses — narrows the exemption to the one file that needs it.
  describe("file-scoped exemptions ({ file, term })", () => {
    it.each(FILE_SCOPED_EXEMPT_PATTERN_IDS)(
      "exempts a file-scoped term inside its own file but nowhere else (%s)",
      async (patternId) => {
        for (const { file, term } of selfMatchingFileScopedExemptsFor(
          patternId,
        )) {
          await writeFixture(file, `${term}\n`);
          const inOwnFile = runRetiredNameCheck(tempRoot, config);
          expect(inOwnFile.some((v) => v.startsWith(`${file}:`))).toBe(false);

          await writeFixture("src/elsewhere.ts", `${term}\n`);
          const elsewhere = runRetiredNameCheck(tempRoot, config);
          expect(elsewhere.some((v) => v.startsWith("src/elsewhere.ts:"))).toBe(
            true,
          );
        }
      },
    );

    it.each(FILE_SCOPED_EXEMPT_PATTERN_IDS)(
      "still reports a fossil sharing a line with a file-scoped exempt term, in its own file (%s)",
      async (patternId) => {
        const fossil = exampleFor(patternId);

        for (const { file, term } of selfMatchingFileScopedExemptsFor(
          patternId,
        )) {
          await writeFixture(
            file,
            `// ${term} — and, on the very same line: ${fossil}\n`,
          );

          const violations = runRetiredNameCheck(tempRoot, config);

          expect(violations).toEqual([`${file}:1: matches "${patternId}"`]);

          // Each iteration must start clean. `writeFixture` accumulates, so a
          // pattern with more than one file-scoped exempt file would otherwise
          // still see the previous iteration's fossil and fail the strict
          // equality above. Blanking the file keeps that equality — which is
          // what proves no OTHER file is reported — rather than weakening it.
          await writeFixture(file, "\n");
        }
      },
    );
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
