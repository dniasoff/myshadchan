// Verify that the database produced by the migrations converges to the
// declarative schema. This intentionally runs `db diff --local` against a
// stack workdir: `--db-url` compares a migrations replay to the target and
// never reads supabase/schemas/.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CLEAN_MESSAGE = "No schema changes found";
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function parseArgs(argv) {
  const options = { workdir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== "--workdir") {
      throw new Error(`unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--workdir needs a value");
    }
    options.workdir = value;
    index += 1;
  }
  return options;
}

/**
 * The CLI prints this exact message when the local database matches the
 * declarative schema. Any other stdout is a diff and must fail the gate.
 */
export function isCleanSchemaDiff(stdout) {
  const ansiEscape = new RegExp(
    `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
    "g",
  );
  const trimmed = stdout.replace(ansiEscape, "").trim();
  if (trimmed === CLEAN_MESSAGE || trimmed === `${CLEAN_MESSAGE}.`) return true;

  // The CLI writes progress messages to stdout before its clean marker. Keep
  // accepting that real transcript, but never let a SQL statement hide behind
  // the marker. A diff is emitted as SQL; operational messages are not.
  const lines = trimmed.split("\n").map((line) => line.trim());
  const hasSql = lines.some((line) =>
    /^(?:alter|comment|create|delete|do|drop|grant|insert|revoke|set|truncate|update)\b/i.test(
      line,
    ),
  );
  const hasCleanMarker = lines.some(
    (line) => line === CLEAN_MESSAGE || line === `${CLEAN_MESSAGE}.`,
  );
  if (hasCleanMarker && !hasSql) return true;

  try {
    const result = JSON.parse(trimmed);
    return (
      typeof result.diff === "string" &&
      result.diff.trim() === "" &&
      Array.isArray(result.dropStatements) &&
      result.dropStatements.length === 0
    );
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: "/dev/null" },
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
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

export function checkSchemaDrift(workdir) {
  refreshStackWorkdir(workdir);
  const result = spawnSync(
    "npx",
    ["--no-install", "supabase", "db", "diff", "--workdir", workdir, "--local"],
    {
      encoding: "utf8",
      env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: "/dev/null" },
    },
  );

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    throw new Error(
      `supabase db diff failed (exit ${result.status ?? "unknown"}).\n${[
        stdout,
        stderr,
      ]
        .filter(Boolean)
        .join("\n")}`,
    );
  }

  const output = [stdout, stderr].filter(Boolean).join("\n");
  if (!isCleanSchemaDiff(output)) {
    throw new Error(
      "DECLARATIVE SCHEMA DRIFT DETECTED. The migrations do not converge to " +
        "supabase/schemas/. Review the diff below and fix the schema or add a " +
        "migration; do not accept a non-convergent diff.\n" +
        output,
    );
  }

  return { stdout, stderr };
}

function refreshStackWorkdir(workdir) {
  const target = path.join(REPO_ROOT, workdir, "supabase");
  if (!existsSync(path.join(target, "config.toml"))) {
    throw new Error(
      `no Supabase stack at ${workdir}; start one with make start-supabase-e2e`,
    );
  }

  for (const directory of ["migrations", "schemas", "functions"]) {
    rmSync(path.join(target, directory), { recursive: true, force: true });
    cpSync(
      path.join(REPO_ROOT, "supabase", directory),
      path.join(target, directory),
      {
        recursive: true,
      },
    );
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const workdir =
    options.workdir ?? process.env.STACK_WORKDIR ?? stackEnv().STACK_WORKDIR;
  if (!workdir) {
    throw new Error(
      "no Supabase stack workdir; start one with make start-supabase-e2e or pass --workdir",
    );
  }

  checkSchemaDrift(workdir);
  console.log(`schema drift guard PASSED (${workdir}).`);
}

if (process.argv[1] && process.argv[1].endsWith("check-schema-drift.mjs")) {
  try {
    main();
  } catch (error) {
    console.error(`schema drift guard: ${error.message}`);
    process.exit(1);
  }
}
