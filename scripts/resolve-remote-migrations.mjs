#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const VERSION_RE = /^\d{14}$/;
const MIGRATION_FILENAME_RE = /^(\d{14})_/;

export function migrationVersion(filename) {
  return MIGRATION_FILENAME_RE.exec(path.basename(filename))?.[1] ?? null;
}

function version(value, label) {
  if (typeof value !== "string" || (value !== "" && !VERSION_RE.test(value))) {
    throw new Error(`${label} must be an empty string or a 14-digit migration version`);
  }
  return value;
}

function migrationRows(remoteJson) {
  if (!remoteJson || typeof remoteJson !== "object" || Array.isArray(remoteJson)) {
    throw new Error("migration list JSON must be an object");
  }
  if (!Array.isArray(remoteJson.migrations) || remoteJson.migrations.length === 0) {
    throw new Error("migration list JSON must contain a non-empty migrations array");
  }

  return remoteJson.migrations.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`migration row ${index} has an invalid shape`);
    }
    const keys = Object.keys(row).sort();
    if (keys.join(",") !== "local,remote,time") {
      throw new Error(
        `migration row ${index} must have exactly local, remote, and time fields`,
      );
    }
    const local = version(row.local, `migration row ${index}.local`);
    const remote = version(row.remote, `migration row ${index}.remote`);
    if (typeof row.time !== "string" || row.time.length === 0) {
      throw new Error(`migration row ${index}.time must be a non-empty string`);
    }
    if (local === "" && remote === "") {
      throw new Error(`migration row ${index} cannot have both local and remote empty`);
    }
    return { local, remote, time: row.time };
  });
}

export function remoteMigrationVersions(remoteJson) {
  const rows = migrationRows(remoteJson);
  const remote = rows.map((row) => row.remote).filter(Boolean);
  if (new Set(remote).size !== remote.length) {
    throw new Error("migration list JSON contains duplicate remote versions");
  }
  return remote.sort();
}

function localMigrationVersions(remoteJson) {
  return migrationRows(remoteJson)
    .map((row) => row.local)
    .filter(Boolean)
    .sort();
}

function dryRunVersions(dryRunJson) {
  if (!dryRunJson || typeof dryRunJson !== "object" || Array.isArray(dryRunJson)) {
    throw new Error("db push dry-run JSON must be an object");
  }
  if (typeof dryRunJson.upToDate !== "boolean" || !Array.isArray(dryRunJson.migrations)) {
    throw new Error(
      "db push dry-run JSON must contain boolean upToDate and migrations array",
    );
  }
  const versions = dryRunJson.migrations.map((filename, index) => {
    if (typeof filename !== "string") {
      throw new Error(`db push dry-run migration ${index} must be a filename`);
    }
    const parsed = migrationVersion(filename);
    if (!parsed) {
      throw new Error(`db push dry-run migration ${index} has no migration version`);
    }
    return parsed;
  });
  if (new Set(versions).size !== versions.length) {
    throw new Error("db push dry-run JSON contains duplicate migration versions");
  }
  if (dryRunJson.upToDate !== (versions.length === 0)) {
    throw new Error("db push dry-run upToDate disagrees with its migrations array");
  }
  return versions.sort();
}

export function resolveRemoteMigrations(remoteJson, localFilenames, dryRunJson) {
  const rows = migrationRows(remoteJson);
  const remote = remoteMigrationVersions(remoteJson);
  const baseline = remote.at(-1) ?? null;
  const localFiles = localFilenames
    .map(migrationVersion)
    .filter((migration) => migration !== null)
    .sort();

  const remoteSet = new Set(remote);
  const pending = rows
    .map((row) => row.local)
    .filter((local) => local && !remoteSet.has(local))
    .sort();
  const remoteOnly = remote.filter((migration) => !localFiles.includes(migration));

  if (!baseline) {
    throw new Error(
      "the linked Supabase project returned no applied migration versions; refusing to deploy",
    );
  }
  if (remoteOnly.length > 0) {
    throw new Error(
      `the linked Supabase project has migration(s) absent locally: ${remoteOnly.join(", ")}`,
    );
  }
  const localFromRows = localMigrationVersions(remoteJson);
  if (localFromRows.join(",") !== [...new Set(localFiles)].join(",")) {
    throw new Error("migration list local rows do not match supabase/migrations");
  }
  const outOfOrder = pending.filter((migration) => migration < baseline);
  if (outOfOrder.length > 0) {
    throw new Error(
      `pending migration(s) ${outOfOrder.join(", ")} are timestamped before the last remotely applied ` +
        `migration (${baseline}); refusing to run a partial safety check`,
    );
  }

  if (dryRunJson !== undefined) {
    const dryRun = dryRunVersions(dryRunJson);
    if (dryRun.join(",") !== pending.join(",")) {
      throw new Error(
        `migration list and db push dry-run disagree: history=[${pending.join(",")}] ` +
          `dry-run=[${dryRun.join(",")}]`,
      );
    }
  }

  return { baseline, pending, heavy: pending.length > 0 };
}

function main() {
  const remoteJson = JSON.parse(readFileSync(0, "utf8"));
  const dryRunJson = process.argv[2]
    ? JSON.parse(readFileSync(process.argv[2], "utf8"))
    : undefined;
  const localFilenames = readdirSync(path.resolve("supabase/migrations"));
  console.log(
    JSON.stringify(resolveRemoteMigrations(remoteJson, localFilenames, dryRunJson)),
  );
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("resolve-remote-migrations.mjs")
) {
  try {
    main();
  } catch (error) {
    console.error(`remote migration baseline: ${error.message}`);
    process.exit(1);
  }
}
