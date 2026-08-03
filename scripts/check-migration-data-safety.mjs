#!/usr/bin/env node
// ===========================================================================
// MIGRATION DATA-SAFETY GUARD — the driver.
//
// Answers the one question no other gate in this repo asks: do the migrations
// that have NOT been deployed yet destroy data that production already has?
//
//   1. reset the local stack to the LAST DEPLOYED migration (the production
//      schema), with no seed;
//   2. seed production-shaped rows and snapshot them
//      (supabase/tests/migration-data-safety/fixture.sql);
//   3. apply the pending migrations, exactly as `supabase db push` will;
//   4. load the author's declarations (declared-moves.sql) and assert every
//      seeded row, value and column survived (assert.sql);
//   5. put the stack back at head so the other suites are unaffected.
//
// Everything before step 3 is the part that makes this different from
// `supabase db reset`: that applies migrations to an EMPTY database and seeds
// afterwards, so a `drop column` never meets a row and a missing backfill is
// invisible. Both `20260729095558_backfill_member_state.sql` and
// `20260730011428_shidduch_overview_fields.sql` passed every other gate in
// this repo green.
//
//   node scripts/check-migration-data-safety.mjs                 # vs origin/main
//   node scripts/check-migration-data-safety.mjs --base-ref <ref>
//   node scripts/check-migration-data-safety.mjs --baseline <version>
//   STACK_ID=1 node scripts/check-migration-data-safety.mjs      # own stack
//
// `--base-ref` is how CI names "what production had before this push":
// `github.event.before` on a push, `origin/<base_ref>` on a pull request.
// ===========================================================================

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const GUARD_DIR = path.join(
  REPO_ROOT,
  "supabase",
  "tests",
  "migration-data-safety",
);
const DEFAULT_BASE_REF = "origin/main";

/** `20260730011428_shidduch_overview_fields.sql` -> `20260730011428`. */
export function migrationVersion(filename) {
  const match = /^(\d{14})_/.exec(path.basename(filename));
  return match ? match[1] : null;
}

/** Sorted, de-duplicated migration versions from a list of file names. */
export function migrationVersions(filenames) {
  return [
    ...new Set(
      filenames
        .filter((name) => name.endsWith(".sql"))
        .map(migrationVersion)
        .filter((version) => version !== null),
    ),
  ].sort();
}

/**
 * The versions present locally but not at the baseline — i.e. the ones a
 * `supabase db push` would apply to production right now.
 *
 * A version that exists at the baseline but NOT locally is a deleted applied
 * migration, which is a different (and worse) problem than this guard
 * checks; it is reported separately by the caller rather than silently
 * folded into "pending".
 */
export function partitionMigrations(localFilenames, baselineFilenames) {
  const local = migrationVersions(localFilenames);
  const baseline = new Set(migrationVersions(baselineFilenames));
  return {
    pending: local.filter((version) => !baseline.has(version)),
    removed: [...baseline].filter((version) => !local.includes(version)).sort(),
    baselineVersion: [...baseline].sort().at(-1) ?? null,
  };
}

export function parseArgs(argv) {
  const options = { baseRef: DEFAULT_BASE_REF, baseline: null, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--keep") {
      options.keep = true;
      continue;
    }
    const key =
      arg === "--base-ref"
        ? "baseRef"
        : arg === "--baseline"
          ? "baseline"
          : null;
    if (!key) {
      throw new Error(`unknown argument: ${arg}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${arg} needs a value`);
    }
    options[key] = value;
    i += 1;
  }
  return options;
}

/**
 * A ref GitHub can hand us that is not usable as a baseline: the all-zero SHA
 * it sends for a branch's first push or after a force-push that rewrote
 * history away.
 */
export function isUsableBaseRef(ref) {
  return Boolean(ref) && !/^0{40}$/.test(ref);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    // The Supabase CLI hangs on the D-Bus secret service in this environment
    // unless the address is dead-ended. See the project memory note.
    env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: "/dev/null" },
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function baselineMigrationFilenames(baseRef) {
  try {
    return run(
      "git",
      ["ls-tree", "--name-only", baseRef, "supabase/migrations/"],
      {
        capture: true,
      },
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => path.basename(line));
  } catch {
    throw new Error(
      `cannot read supabase/migrations at '${baseRef}'. Pass --base-ref <ref> or --baseline <version>.`,
    );
  }
}

function stackEnv() {
  const shell = run("node", ["scripts/stack-env.mjs", "--shell"], {
    capture: true,
  });
  return Object.fromEntries(
    shell
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key, rest.join("=").replace(/^'|'$/g, "")];
      }),
  );
}

/**
 * The stack workdir holds COPIES of supabase/migrations taken when the stack
 * was started (see `start-supabase-e2e` in the makefile). Refresh them, or
 * this guard would verify whatever the migrations looked like an hour ago.
 */
function refreshStackWorkdir(workdir) {
  const target = path.join(REPO_ROOT, workdir, "supabase");
  if (!existsSync(path.join(target, "config.toml"))) {
    throw new Error(
      `no Supabase stack at ${workdir}. Start one first: make start-supabase-e2e${
        process.env.STACK_ID ? ` STACK_ID=${process.env.STACK_ID}` : ""
      }`,
    );
  }
  for (const dir of ["migrations", "schemas", "functions"]) {
    rmSync(path.join(target, dir), { recursive: true, force: true });
    cpSync(path.join(REPO_ROOT, "supabase", dir), path.join(target, dir), {
      recursive: true,
    });
  }
}

function psql(dbUrl, file) {
  run("psql", ["-v", "ON_ERROR_STOP=1", "--quiet", "-d", dbUrl, "-f", file]);
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  let baselineVersion = options.baseline;
  let pending;

  const localFilenames = readdirSync(MIGRATIONS_DIR);

  if (baselineVersion) {
    const local = migrationVersions(localFilenames);
    if (!local.includes(baselineVersion)) {
      throw new Error(
        `--baseline ${baselineVersion} is not a migration in supabase/migrations/`,
      );
    }
    pending = local.filter((version) => version > baselineVersion);
  } else {
    if (!isUsableBaseRef(options.baseRef)) {
      console.log(
        `migration data-safety guard: skipped — '${options.baseRef}' is not a usable base ref ` +
          `(first push, or history was rewritten). Re-run with --baseline <version>.`,
      );
      return;
    }
    const partition = partitionMigrations(
      localFilenames,
      baselineMigrationFilenames(options.baseRef),
    );
    if (partition.removed.length > 0) {
      throw new Error(
        `migration(s) present at ${options.baseRef} but missing locally: ` +
          `${partition.removed.join(", ")}. Applied history cannot be deleted.`,
      );
    }
    baselineVersion = partition.baselineVersion;
    pending = partition.pending;

    // `db reset --version V` applies everything with a version <= V, so a
    // pending migration timestamped BEFORE the last deployed one cannot be
    // isolated: the reset would apply it as part of the baseline and the
    // guard would silently not test it. That ordering is a hazard for
    // `db push` too, so refuse rather than paper over it.
    const outOfOrder = pending.filter((version) => version < baselineVersion);
    if (outOfOrder.length > 0) {
      throw new Error(
        `pending migration(s) ${outOfOrder.join(", ")} are timestamped BEFORE the last deployed ` +
          `migration (${baselineVersion}). Rename them to a later timestamp — out-of-order ` +
          `migrations cannot be isolated from the baseline here, and apply out of order on the ` +
          `remote too.`,
      );
    }
  }

  if (!baselineVersion) {
    throw new Error("could not determine a baseline migration version");
  }

  if (pending.length === 0) {
    console.log(
      `migration data-safety guard: nothing to verify — no migration is pending against ` +
        `${options.baseline ? baselineVersion : options.baseRef}.`,
    );
    return;
  }

  const env = stackEnv();
  const workdir = env.STACK_WORKDIR;
  const dbUrl = env.SUPABASE_DB_URL;

  console.log(`migration data-safety guard`);
  console.log(`  stack     ${workdir} (${dbUrl})`);
  console.log(`  baseline  ${baselineVersion}`);
  console.log(`  pending   ${pending.length}: ${pending.join(", ")}`);

  refreshStackWorkdir(workdir);

  // Every step below mutates the stack's database, and every one of them can
  // fail. They used to be split across two error-handling paths: only the
  // final [4/4] step was wrapped in a try/catch, so a failure in [1/4]-[3/4]
  // — most importantly the fixture itself refusing to seed — threw straight
  // out of main(), skipped "restoring the stack to head" below, AND printed
  // the exact same generic "migration data-safety guard: <message>" text a
  // real [4/4] data-loss finding does. That is how this guard gave zero
  // signal for two epics (Story 8.2 broke the fixture's own INSERT; every
  // migration after it hit this same untagged, unrestored failure and
  // nobody could tell "the harness is broken" from "the harness ran and
  // passed" by looking at anything short of the raw psql error — see
  // .claude/rules/ for the incident). `phase` records which step failed so
  // the banner below can say so explicitly, and the single try/finally-shaped
  // block guarantees the restore runs on every exit path, not just [4/4]'s.
  let phase = "reset";
  try {
    console.log(
      `\n[1/4] resetting to the last deployed migration (${baselineVersion})`,
    );
    run("npx", [
      "supabase",
      "db",
      "reset",
      "--workdir",
      workdir,
      "--version",
      baselineVersion,
      "--no-seed",
    ]);

    phase = "seed";
    console.log(`\n[2/4] seeding production-shaped rows and snapshotting them`);
    psql(dbUrl, path.join(GUARD_DIR, "fixture.sql"));

    phase = "apply";
    console.log(`\n[3/4] applying the ${pending.length} pending migration(s)`);
    run("npx", [
      "supabase",
      "migration",
      "up",
      "--workdir",
      workdir,
      "--local",
    ]);

    phase = "assert";
    console.log(`\n[4/4] asserting the seeded data survived`);
    psql(dbUrl, path.join(GUARD_DIR, "declared-moves.sql"));
    psql(dbUrl, path.join(GUARD_DIR, "assert.sql"));
  } catch (error) {
    restoreStack(workdir, options.keep);
    reportFailure(phase, error);
    process.exit(1);
  }

  restoreStack(workdir, options.keep);
  console.log(`\nmigration data-safety guard PASSED.`);
}

/**
 * Leaves the stack at head, or every db suite that runs after this one hits
 * a half-migrated (or, before this fix, half-SEEDED — fixture.sql's own
 * `migration_guard` schema and its production-shaped rows still sitting on
 * top of the BASELINE schema) database. Runs on every exit path — success or
 * any failure phase — because a stack a failed setup step left dirty is
 * itself a silent hazard for whatever runs next, not merely this guard's
 * own problem.
 */
function restoreStack(workdir, keep) {
  if (keep) return;
  console.log(`\nrestoring the stack to head`);
  try {
    run("npx", ["supabase", "db", "reset", "--workdir", workdir]);
  } catch (error) {
    console.error(
      `WARNING: could not restore the stack to head: ${error.message}`,
    );
    console.error(`Run: npx supabase db reset --workdir ${workdir}`);
  }
}

// One banner per phase, deliberately worded so a setup failure cannot be
// mistaken for the one finding this guard actually exists to make ("the
// pending migrations destroy data"). `reset` and `apply` are tooling/
// migration-syntax problems this guard happens to surface first, not
// data-safety findings. `seed` is the phase this file's own header comment
// singles out as the one that went silently unnoticed: the message says, in
// as many words, that nothing downstream ever ran. Only `assert` is the
// guard doing its actual job and finding something real.
const FAILURE_BANNERS = {
  reset:
    "SETUP FAILED — could not reset the stack to the last deployed migration " +
    "(the baseline this run computed from --base-ref/--baseline). This is an " +
    "environment/tooling problem. It says nothing about whether the pending " +
    "migrations are safe — none of them has run yet.",
  seed:
    "SETUP FAILED — the fixture could not be seeded against the baseline schema. " +
    "supabase/tests/migration-data-safety/fixture.sql hit a hard SQL error before " +
    "any pending migration ever applied, which means NOTHING was verified this run. " +
    "This is NOT a statement about migration safety — it means the fixture itself is " +
    "out of sync with the baseline schema (the recurring shape: a deployed migration " +
    "changed a constraint — e.g. added NOT NULL to a column — and this file's own " +
    "INSERTs were never updated to match; see .claude/rules/migration-guard-" +
    "integrity.md for the incident that named this failure mode). Fix the fixture — " +
    "see its own header comment — then re-run.",
  apply:
    "SETUP FAILED — the pending migration(s) did not apply cleanly on top of the " +
    "seeded baseline. This is a broken migration (bad SQL, a failed constraint, a " +
    "missing dependency), not the data-destruction finding this guard exists to " +
    "make — assert.sql never ran.",
  assert:
    "MIGRATION DATA-SAFETY GUARD FAILED. The pending migrations destroy data that " +
    "production already has. Fix the migration — add the backfill BEFORE the drop " +
    "— or, if the loss is intended, declare it in " +
    "supabase/tests/migration-data-safety/declared-moves.sql.",
};

function reportFailure(phase, error) {
  const banner =
    FAILURE_BANNERS[phase] ?? `FAILED at an unrecognised phase (${phase}).`;
  const rule = "=".repeat(Math.min(78, Math.max(banner.length, 40)));
  console.error(`\n${rule}`);
  console.error(banner);
  console.error(rule);
  console.error(error.message);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(`migration data-safety guard: ${error.message}`);
    process.exit(1);
  }
}
