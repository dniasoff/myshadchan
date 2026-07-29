/**
 * These run against a real throwaway git repository, not a mock. The bug being
 * closed is a property of git's index, so a fake index would only prove the
 * fake works: `git commit -m` really does absorb another writer's staged paths,
 * and the pathspec form really does not.
 *
 * The control case is asserted too — if plain `git commit -m` ever stopped
 * capturing B's file, this whole mechanism would be unnecessary and these tests
 * would be asserting nothing.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "safe-commit.mjs",
);

let repo;

function git(args, cwd = repo) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function safeCommit(args) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function write(file, content) {
  fs.writeFileSync(path.join(repo, file), content);
}

function committedFiles() {
  return git(["show", "--name-only", "--format=", "HEAD"])
    .split("\n")
    .filter(Boolean);
}

function stagedFiles() {
  return git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "safe-commit-"));
  git(["init", "--quiet", "--initial-branch=main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  // No hooks in a fresh `git init`, which is what we want: the property under
  // test is git's, and the repo's own hook is covered by its own reproduction.
  write("seed.txt", "seed\n");
  git(["add", "seed.txt"]);
  git(["commit", "--quiet", "-m", "seed"]);
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("the hazard this replaces", () => {
  it("plain `git commit -m` absorbs the other writer's staged file", () => {
    // Arrange — A and B each stage exactly their own new file.
    write("a.txt", "a\n");
    write("b.txt", "b\n");
    git(["add", "a.txt"]);
    git(["add", "b.txt"]);

    // Act — A commits, naming nothing.
    git(["commit", "--quiet", "-m", "A's commit"]);

    // Assert — B's file is in A's commit, and exit code was 0.
    expect(committedFiles()).toEqual(["a.txt", "b.txt"]);
  });
});

describe("safe-commit", () => {
  it("commits only the named path and leaves the other writer's staged entry alone", () => {
    // Arrange
    write("a.txt", "a\n");
    write("b.txt", "b\n");
    git(["add", "a.txt"]);
    git(["add", "b.txt"]);

    // Act
    safeCommit(["-m", "A's commit", "a.txt"]);

    // Assert
    expect(committedFiles()).toEqual(["a.txt"]);
    expect(stagedFiles()).toEqual(["b.txt"]);
    expect(fs.readFileSync(path.join(repo, "b.txt"), "utf8")).toBe("b\n");
  });

  it("stages a named file that git does not know about yet", () => {
    // Arrange — a pathspec can only match what is in the index, so an untracked
    // file would otherwise fail the commit outright.
    write("new.txt", "new\n");

    // Act
    safeCommit(["-m", "add new", "new.txt"]);

    // Assert
    expect(committedFiles()).toEqual(["new.txt"]);
  });

  it("commits every file under a named directory and nothing outside it", () => {
    // Arrange
    fs.mkdirSync(path.join(repo, "mine"));
    write("mine/one.txt", "1\n");
    write("mine/two.txt", "2\n");
    write("theirs.txt", "t\n");
    git(["add", "theirs.txt"]);

    // Act
    safeCommit(["-m", "mine", "mine"]);

    // Assert
    expect(committedFiles().sort()).toEqual(["mine/one.txt", "mine/two.txt"]);
    expect(stagedFiles()).toEqual(["theirs.txt"]);
  });

  it("commits a deletion of a path it names", () => {
    // Arrange
    fs.rmSync(path.join(repo, "seed.txt"));

    // Act
    safeCommit(["-m", "drop seed", "seed.txt"]);

    // Assert
    expect(committedFiles()).toEqual(["seed.txt"]);
    expect(git(["ls-files"]).trim()).toBe("");
  });

  it("takes the working-tree content, not a partially staged snapshot", () => {
    // Arrange — the documented semantic difference of a pathspec commit.
    write("seed.txt", "staged\n");
    git(["add", "seed.txt"]);
    write("seed.txt", "worktree\n");

    // Act
    safeCommit(["-m", "seed change", "seed.txt"]);

    // Assert
    expect(git(["show", "HEAD:seed.txt"])).toBe("worktree\n");
  });

  it("refuses --no-verify, which would disable the pre-commit guards", () => {
    // Arrange
    write("a.txt", "a\n");

    // Act / Assert
    expect(() => safeCommit(["-m", "x", "--no-verify", "a.txt"])).toThrow(
      /--no-verify is refused/,
    );
  });

  it("refuses -a, which is the index-wide commit in disguise", () => {
    // Arrange
    write("a.txt", "a\n");

    // Act / Assert
    expect(() => safeCommit(["-m", "x", "-a", "a.txt"])).toThrow(/refused/);
  });

  it("refuses to run with no paths, and shows what you have changed", () => {
    // Arrange
    write("a.txt", "a\n");

    // Act / Assert — deriving paths from the index is exactly what is unsafe.
    expect(() => safeCommit(["-m", "x"])).toThrow(/no paths[\s\S]*a\.txt/);
  });

  it("refuses to run with no message", () => {
    // Arrange / Act / Assert
    expect(() => safeCommit(["a.txt"])).toThrow(/no message/);
  });

  it("fails rather than creating an empty commit when the named path is clean", () => {
    // Arrange / Act / Assert
    expect(() => safeCommit(["-m", "x", "seed.txt"])).toThrow(
      /nothing to commit/,
    );
  });
});
