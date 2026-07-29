/**
 * Commit only your own paths, on a tree other agents are writing.
 *
 * The hazard is structural, not a race you can be careful around: the index is
 * one process-global file for the whole clone. `git commit -m "…"` commits *the
 * index*, so if another agent runs `git add` at any point before your commit
 * builds its tree, their paths are in your commit — and no pre-commit hook can
 * take them out again, because unstaging them would break the other agent
 * instead. Measured: A stages labA1.ts, B stages labB1.ts, A runs `git commit
 * -m` and gets both, exit 0.
 *
 * `git commit -m "…" -- <paths>` closes it: git builds a *temporary* index from
 * HEAD plus those paths and commits that, leaving the real index alone.
 * Measured on the same setup: the commit contains only A's path, B's staged
 * entry survives, lint-staged's formatting still applies under the temporary
 * index, and no leftover diff.
 *
 * That was documented advice, and advice is what this whole rule file exists
 * because of. This script is the mechanism: it is the shortest way to commit
 * here (`make commit`), it cannot be invoked in the unsafe shape, and it
 * verifies afterwards that the commit really did contain only what you asked
 * for and that nobody else's staged work was consumed.
 *
 *   node scripts/safe-commit.mjs -m "message" <path>...
 *   make commit MSG="message" PATHS="path ..."
 *
 * One semantic difference to know: a pathspec commit takes the **working-tree**
 * content of the named paths, not what you staged. Staging a subset of a file's
 * changes and committing that subset is not possible this way — which is the
 * correct trade here, because "commit exactly the index" is the thing that
 * cannot be made safe.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** `--no-verify` disables the hook that keeps registry.json out of the commit. */
const REFUSED_FLAGS = new Set([
  "--no-verify",
  "-n",
  "--all",
  "-a",
  "--amend",
  "--include",
  "-i",
  "--only",
  "-o",
]);

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function lines(text) {
  return text.split("\n").filter(Boolean);
}

export function parseArgs(argv) {
  const paths = [];
  let message;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (REFUSED_FLAGS.has(arg)) {
      throw new Error(
        `${arg} is refused. This tool exists to make a commit contain exactly the ` +
          `paths you name; every flag above re-opens the index-is-global hole it ` +
          `closes (and --no-verify also disables the pre-commit guards).`,
      );
    }

    if (arg === "-m" || arg === "--message") {
      message = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--message=")) {
      message = arg.slice("--message=".length);
      continue;
    }
    if (arg === "--") continue;
    if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg} (usage: -m "message" <path>...)`);
    }
    paths.push(arg);
  }

  if (!message) throw new Error('no message (usage: -m "message" <path>...)');
  if (paths.length === 0) {
    throw new Error(
      "no paths. Name the files this commit owns:\n" +
        '  node scripts/safe-commit.mjs -m "message" <path>...\n' +
        "Deriving them from the index is exactly what is unsafe — the index holds " +
        "every agent's staged work, not just yours.\n" +
        `Yours are probably among:\n${changedPaths()
          .map((p) => `  ${p}`)
          .join("\n")}`,
    );
  }

  return { message, paths };
}

function changedPaths() {
  return lines(git(["status", "--porcelain", "--untracked-files=all"])).map(
    (line) => line.slice(3),
  );
}

/**
 * A pathspec can only match what git knows about, so a brand-new file has to be
 * added first. Scoped to the named path, which is safe: `git add -- <my path>`
 * touches one index entry, unlike `git add -u` / `git add .`.
 */
function trackNewFiles(paths) {
  const untracked = new Set(
    lines(git(["ls-files", "--others", "--exclude-standard", "--", ...paths])),
  );
  const toAdd = paths.filter(
    (p) => untracked.has(p) || isNewDirEntry(p, untracked),
  );
  if (toAdd.length > 0) git(["add", "--", ...toAdd]);
  return toAdd;
}

function isNewDirEntry(candidate, untracked) {
  if (!existsSync(candidate)) return false;
  const prefix = candidate.endsWith("/") ? candidate : `${candidate}/`;
  return [...untracked].some((file) => file.startsWith(prefix));
}

/** Every file the named pathspecs actually resolve to, as git sees them. */
function resolvePaths(paths) {
  const changed = lines(
    git(["status", "--porcelain", "--untracked-files=all", "--", ...paths]),
  ).map((line) => line.slice(3));
  return [...new Set(changed)];
}

export function run(argv) {
  const { message, paths } = parseArgs(argv);

  trackNewFiles(paths);

  const owned = resolvePaths(paths);
  if (owned.length === 0) {
    throw new Error(
      `nothing to commit under: ${paths.join(", ")} (no changes in the working tree)`,
    );
  }

  // Everything staged that this commit is *not* claiming. It must survive
  // untouched; that it does is the whole property being bought here.
  const foreignBefore = lines(git(["diff", "--cached", "--name-only"])).filter(
    (file) => !owned.includes(file),
  );

  console.log(`safe-commit: committing ${owned.length} path(s):`);
  for (const file of owned) console.log(`  ${file}`);
  if (foreignBefore.length > 0) {
    console.log(
      `safe-commit: ${foreignBefore.length} other staged path(s) in the index will be left alone.`,
    );
  }

  execFileSync("git", ["commit", "-m", message, "--", ...paths], {
    stdio: "inherit",
  });

  return verify(owned, foreignBefore);
}

/**
 * Post-conditions, checked rather than assumed. The failure this replaces was
 * silent and exited 0, so an unverified fix would be indistinguishable from it.
 */
function verify(owned, foreignBefore) {
  const committed = lines(git(["show", "--name-only", "--format=", "HEAD"]));
  const extra = committed.filter((file) => !owned.includes(file));
  const stagedNow = new Set(lines(git(["diff", "--cached", "--name-only"])));
  const lost = foreignBefore.filter((file) => !stagedNow.has(file));

  // registry.json is regenerated and staged by .husky/pre-commit, but only on a
  // quiet tree — so when it appears it is legitimately part of this commit.
  const unexplained = extra.filter((file) => file !== "registry.json");

  if (unexplained.length > 0) {
    console.error(
      "safe-commit: WARNING — the commit contains paths you did not name:\n" +
        unexplained.map((file) => `  ${file}`).join("\n"),
    );
  }
  if (lost.length > 0) {
    console.error(
      "safe-commit: WARNING — staged paths belonging to someone else are no longer staged:\n" +
        lost.map((file) => `  ${file}`).join("\n"),
    );
  }

  console.log(
    `safe-commit: ${git(["rev-parse", "--short", "HEAD"]).trim()} — ` +
      `${committed.length} file(s) committed, ` +
      `${foreignBefore.length - lost.length}/${foreignBefore.length} foreign staged path(s) intact.`,
  );

  return unexplained.length === 0 && lost.length === 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (!run(process.argv.slice(2))) process.exit(1);
  } catch (error) {
    console.error(`safe-commit: ${error.message}`);
    process.exit(1);
  }
}
