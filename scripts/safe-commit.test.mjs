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

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(SCRIPTS_DIR, "safe-commit.mjs");
const MAKEFILE = path.resolve(SCRIPTS_DIR, "..", "makefile");

let repo;

function git(args, cwd = repo) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function safeCommit(args, env) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
}

/**
 * Runs the repo's *real* `commit` target — the makefile is copied in, not
 * re-derived here, because the layer that broke was the target and a
 * re-derived copy could not have failed the way the real one did.
 */
function makeCommit({ MSG, PATHS }) {
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(repo, "scripts", "safe-commit.mjs"));
  fs.copyFileSync(MAKEFILE, path.join(repo, "makefile"));

  const args = ["commit"];
  if (MSG !== undefined) args.push(`MSG=${MSG}`);
  if (PATHS !== undefined) args.push(`PATHS=${PATHS}`);

  return execFileSync("make", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commitMessage() {
  return git(["log", "-1", "--pretty=%B"]).replace(/\n+$/, "");
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

  it("takes the message from the environment with --message-env", () => {
    // Arrange
    write("a.txt", "a\n");

    // Act
    safeCommit(["--message-env", "MSG", "a.txt"], { MSG: "from the env" });

    // Assert
    expect(commitMessage()).toBe("from the env");
  });

  it("refuses --message-env when the named variable is unset or blank", () => {
    // Arrange
    write("a.txt", "a\n");

    // Act / Assert — never fall back to an empty message.
    expect(() =>
      safeCommit(["--message-env", "MSG", "a.txt"], { MSG: "  \n " }),
    ).toThrow(/no message: environment variable MSG is unset or empty/);
  });

  it("refuses a message given twice", () => {
    // Arrange
    write("a.txt", "a\n");

    // Act / Assert
    expect(() =>
      safeCommit(["-m", "one", "--message-env", "MSG", "a.txt"], {
        MSG: "two",
      }),
    ).toThrow(/conflicts with/);
  });
});

/**
 * The layer that actually broke. The script was always fine with a multi-line
 * message — argv carries bytes — while `make commit MSG="…"` pasted that text
 * into a shell recipe, where a newline ended the command (`sh: Unterminated
 * quoted string`), make ate every `$`, a leading `-` became an ignore-errors
 * prefix and sh executed backticks out of the message. Agents then routed
 * around the mandatory wrapper, which is how you end up back at `git commit -m`.
 */
describe("make commit (the wrapper agents are required to use)", () => {
  // Everything this repo's commit messages actually contain: blank lines, a
  // bullet list, backticks, an apostrophe, parentheses, `#`, `$VAR`, `$(…)`.
  const HOSTILE_MESSAGE = [
    "fix(commit): don't let make eat the message (#42)",
    "",
    "`make commit` choked on multi-line MSG — it's the wrapper the",
    "concurrency protocol depends on, so agents routed around it.",
    "",
    "- $HOME and $(pwd) stay literal",
    "- 100% of the message survives",
  ].join("\n");

  it("commits a realistic multi-line message byte for byte", () => {
    // Arrange
    write("a.txt", "a\n");

    // Act
    makeCommit({ MSG: HOSTILE_MESSAGE, PATHS: "a.txt" });

    // Assert
    expect(commitMessage()).toBe(HOSTILE_MESSAGE);
    expect(committedFiles()).toEqual(["a.txt"]);
  });

  it("never evaluates the message as shell", () => {
    // Arrange
    write("a.txt", "a\n");
    const message = "chore: `touch backtick.pwned` and $(touch subshell.pwned)";

    // Act
    makeCommit({ MSG: message, PATHS: "a.txt" });

    // Assert
    expect(commitMessage()).toBe(message);
    expect(fs.existsSync(path.join(repo, "backtick.pwned"))).toBe(false);
    expect(fs.existsSync(path.join(repo, "subshell.pwned"))).toBe(false);
  });

  it("still commits only the named paths and leaves a foreign staged entry intact", () => {
    // Arrange — the property the wrapper exists for, asserted through the
    // target rather than the script, since the target is what agents run.
    write("a.txt", "a\n");
    write("a2.txt", "a2\n");
    write("b.txt", "b\n");
    git(["add", "b.txt"]);

    // Act
    makeCommit({ MSG: HOSTILE_MESSAGE, PATHS: "a.txt a2.txt" });

    // Assert
    expect(committedFiles().sort()).toEqual(["a.txt", "a2.txt"]);
    expect(stagedFiles()).toEqual(["b.txt"]);
    expect(fs.readFileSync(path.join(repo, "b.txt"), "utf8")).toBe("b\n");
  });

  it("fails loudly instead of committing an empty message when MSG is missing", () => {
    // Arrange
    write("a.txt", "a\n");

    // Act / Assert
    expect(() => makeCommit({ PATHS: "a.txt" })).toThrow(/no message/);
    expect(commitMessage()).toBe("seed"); // HEAD is still the seed commit
  });

  it("fails loudly when PATHS is missing rather than committing the index", () => {
    // Arrange
    write("a.txt", "a\n");
    git(["add", "a.txt"]);

    // Act / Assert
    expect(() => makeCommit({ MSG: "no paths named" })).toThrow(/no paths/);
    expect(stagedFiles()).toEqual(["a.txt"]);
  });
});
