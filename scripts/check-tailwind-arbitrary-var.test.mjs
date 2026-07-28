import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTailwindArbitraryVarCheck } from "./check-tailwind-arbitrary-var.mjs";

let tempRoot;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "check-tw-arbitrary-var-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function writeFixture(relPath, content) {
  const full = path.join(tempRoot, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

describe("runTailwindArbitraryVarCheck", () => {
  it("fails on a bracket utility referencing a bare CSS variable", async () => {
    // Arrange
    await writeFixture(
      "src/Example.tsx",
      'export const Example = () => <div className="bg-[--glass-bg]" />;\n',
    );

    // Act
    const violations = runTailwindArbitraryVarCheck(tempRoot, new Map());

    // Assert
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("src/Example.tsx:1");
    expect(violations[0]).toContain("-[--glass-bg]");
  });

  it("reports every bare-variable match on a line with more than one", async () => {
    // Arrange
    await writeFixture(
      "src/Example.tsx",
      'export const Example = () => <div className="border-[--glass-border] bg-[--glass-bg]" />;\n',
    );

    // Act
    const violations = runTailwindArbitraryVarCheck(tempRoot, new Map());

    // Assert
    expect(violations).toHaveLength(2);
  });

  it("explains the v4 fix in the failure message", async () => {
    // Arrange
    await writeFixture(
      "src/Example.tsx",
      'export const Example = () => <div className="ease-[--ease-spring]" />;\n',
    );

    // Act
    const [violation] = runTailwindArbitraryVarCheck(tempRoot, new Map());

    // Assert
    expect(violation).toContain("-(--ease-spring)");
    expect(violation).toContain("-[var(--ease-spring)]");
  });

  it("passes on the v4 parenthesis shorthand", async () => {
    // Arrange
    await writeFixture(
      "src/Example.tsx",
      'export const Example = () => <div className="bg-(--glass-bg)" />;\n',
    );

    // Act & Assert
    expect(runTailwindArbitraryVarCheck(tempRoot, new Map())).toEqual([]);
  });

  it("passes on an explicit var() wrapper", async () => {
    // Arrange
    await writeFixture(
      "src/Example.tsx",
      'export const Example = () => <div className="bg-[var(--glass-bg)]" />;\n',
    );

    // Act & Assert
    expect(runTailwindArbitraryVarCheck(tempRoot, new Map())).toEqual([]);
  });

  it("passes on a genuine v4 theme function call, not a bare variable", async () => {
    // Arrange — the real ui/toggle-group.tsx shape: `--spacing(...)` is a
    // CSS function invocation, not a bare custom-property reference.
    await writeFixture(
      "src/Example.tsx",
      'export const Example = () => <div className="gap-[--spacing(var(--gap))]" />;\n',
    );

    // Act & Assert
    expect(runTailwindArbitraryVarCheck(tempRoot, new Map())).toEqual([]);
  });

  it("does not flag a fragment covered by the known-violations allowlist", async () => {
    // Arrange
    await writeFixture(
      "src/Example.tsx",
      'export const Example = () => <div className="bg-[--glass-bg]" />;\n',
    );

    // Act
    const violations = runTailwindArbitraryVarCheck(
      tempRoot,
      new Map([["src/Example.tsx::-[--glass-bg]", 1]]),
    );

    // Assert
    expect(violations).toEqual([]);
  });

  it("still flags a different fragment in a file that has an allowlisted one", async () => {
    // Arrange
    await writeFixture(
      "src/Example.tsx",
      [
        'export const A = () => <div className="bg-[--glass-bg]" />;',
        'export const B = () => <div className="bg-[--other-var]" />;',
        "",
      ].join("\n"),
    );

    // Act
    const violations = runTailwindArbitraryVarCheck(
      tempRoot,
      new Map([["src/Example.tsx::-[--glass-bg]", 1]]),
    );

    // Assert
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("-[--other-var]");
  });

  it("keeps flagging the allowlisted fragment once it moves to a new line", async () => {
    // Arrange — simulates an unrelated edit shifting line numbers in a file
    // under active rewrite elsewhere: a line-keyed allowlist would silently
    // stop matching here and this would wrongly report as new.
    await writeFixture(
      "src/Example.tsx",
      [
        "// an unrelated line inserted above by someone else's edit",
        'export const Example = () => <div className="bg-[--glass-bg]" />;',
        "",
      ].join("\n"),
    );

    // Act
    const violations = runTailwindArbitraryVarCheck(
      tempRoot,
      new Map([["src/Example.tsx::-[--glass-bg]", 1]]),
    );

    // Assert
    expect(violations).toEqual([]);
  });

  it("flags a known-violation fragment once it is duplicated past its allowed count", async () => {
    // Arrange — a frozen file may still be edited by its own owning story;
    // if that edit copy-pastes the already-allowlisted violation instead of
    // introducing a distinct one, a count-unbounded allowlist would let all
    // copies through silently. Two occurrences against an allowance of one
    // must surface exactly the second as new.
    await writeFixture(
      "src/Example.tsx",
      [
        'export const A = () => <div className="bg-[--glass-bg]" />;',
        'export const B = () => <div className="bg-[--glass-bg]" />;',
        "",
      ].join("\n"),
    );

    // Act
    const violations = runTailwindArbitraryVarCheck(
      tempRoot,
      new Map([["src/Example.tsx::-[--glass-bg]", 1]]),
    );

    // Assert
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("src/Example.tsx:2");
    expect(violations[0]).toContain("-[--glass-bg]");
  });

  it("allows exactly as many duplicates as the allowlisted count records", async () => {
    // Arrange — the mirror of the previous case: an allowance of two must
    // exempt both occurrences, not just the first.
    await writeFixture(
      "src/Example.tsx",
      [
        'export const A = () => <div className="bg-[--glass-bg]" />;',
        'export const B = () => <div className="bg-[--glass-bg]" />;',
        "",
      ].join("\n"),
    );

    // Act
    const violations = runTailwindArbitraryVarCheck(
      tempRoot,
      new Map([["src/Example.tsx::-[--glass-bg]", 2]]),
    );

    // Assert
    expect(violations).toEqual([]);
  });

  it("ignores files outside the scanned extensions", async () => {
    // Arrange
    await writeFixture("src/example.json", '{ "note": "bg-[--glass-bg]" }\n');

    // Act & Assert
    expect(runTailwindArbitraryVarCheck(tempRoot, new Map())).toEqual([]);
  });

  it("scans .css files for the same bare-variable bug", async () => {
    // Arrange — an `@apply bg-[--glass-bg]` in a stylesheet is just as
    // broken as the JSX form and was previously invisible to this guard.
    await writeFixture("src/example.css", ".foo { @apply bg-[--glass-bg]; }\n");

    // Act
    const violations = runTailwindArbitraryVarCheck(tempRoot, new Map());

    // Assert
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("src/example.css:1");
  });
});
