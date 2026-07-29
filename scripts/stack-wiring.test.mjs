/**
 * The per-stack allocation is only worth anything if the launch paths actually
 * consume it. These are text assertions on the config files themselves, because
 * the thing being guarded is a flag on a command line and a key in a Vite
 * config — neither is reachable by importing the module (playwright.config.ts
 * would start a web server; vite.config.ts pulls in the PWA plugin).
 *
 * Both regressions guarded here were real: the shared `node_modules/.vite`, and
 * `--force` on the two launch paths, which between them cost a whole stack's
 * test run on every 3-way concurrent attempt.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const read = (file) => fs.readFileSync(path.join(REPO_ROOT, file), "utf8");

/** The line that launches a Vite server, in each of the two launch paths. */
const VITE_LAUNCHERS = [
  { file: "playwright.config.ts", match: /command:\s*`npx vite [^`]*`/ },
  { file: "makefile", match: /npx vite --port \$\$STACK_APP_PORT[^\n]*/ },
];

describe("every Vite server is launched into its own stack's cache", () => {
  it.each(VITE_LAUNCHERS)(
    "does not pass --force in $file",
    ({ file, match }) => {
      // Arrange
      const source = read(file);

      // Act
      const launcher = match.exec(source)?.[0];

      // Assert — `--force` deletes and re-optimises the dependency cache on
      // every start. Measured with three concurrent stacks on the shared cache:
      // one stack failed in all 3 reps with
      // `The file does not exist at "node_modules/.vite/deps/chunk-*.js"`.
      expect(launcher).toBeTruthy();
      expect(launcher).not.toContain("--force");
    },
  );

  it.each(["vite.config.ts", "vitest.config.ts"])(
    "sets cacheDir from the stack allocation in %s",
    (file) => {
      // Arrange / Act
      const source = read(file);

      // Assert — Vite's default is one `node_modules/.vite` for the whole
      // checkout; sharing it across concurrent servers is the failure above.
      expect(source).toMatch(/cacheDir:\s*(stack\.cacheDir|resolveStack\()/);
    },
  );
});

describe("the db suites never run two files against one database", () => {
  it("pins the db project to a single worker in vitest.config.ts", () => {
    // Arrange / Act
    const source = read("vitest.config.ts");
    const dbProject = source.slice(source.indexOf('name: "db"'));

    // Assert — STACK_ID gives an agent one database, not one per test file, so
    // two db suites in parallel collide over the same fixture rows and roles.
    // By configuration, not by remembering `--no-file-parallelism`.
    expect(dbProject).toMatch(/fileParallelism:\s*false/);
    expect(dbProject).toMatch(/maxWorkers:\s*1/);
  });
});

describe("starting a stack goes through the lease", () => {
  it("acquires before start-supabase-e2e can destroy a database", () => {
    // Arrange
    const makefile = read("makefile");
    const recipe = makefile.slice(
      makefile.indexOf("start-supabase-e2e:"),
      makefile.indexOf("stop-supabase-e2e:"),
    );

    // Act
    const acquireAt = recipe.indexOf("stack-lease.mjs acquire");
    const destroyAt = recipe.indexOf("supabase stop");

    // Assert — the lease check has to come first, and has to be able to abort
    // the recipe (everything in it is one `;`-joined shell).
    expect(acquireAt).toBeGreaterThan(-1);
    expect(destroyAt).toBeGreaterThan(acquireAt);
    expect(recipe).toContain("stack-lease.mjs acquire || exit 1");
  });

  it("releases the lease when the stack is stopped", () => {
    // Arrange / Act
    const makefile = read("makefile");

    // Assert
    expect(makefile).toMatch(
      /stop-supabase-e2e:[\s\S]*?stack-lease\.mjs release/,
    );
    expect(makefile).toMatch(/stop-stacks:[\s\S]*?stack-lease\.mjs release/);
  });
});
