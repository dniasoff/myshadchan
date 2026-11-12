#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const MIGRATION_VERSION_RE = /(?:^|[^0-9])([0-9]{14})(?=[^0-9]|$)/g;

export function migrationVersion(filename) {
  const match = /^(\d{14})_/.exec(path.basename(filename));
  return match?.[1] ?? null;
}

function collectStrings(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, output));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, output));
  }
  return output;
}

export function remoteMigrationVersions(remoteJson) {
  const strings = collectStrings(remoteJson);
  return [
    ...new Set(
      strings.flatMap((value) =>
        [...value.matchAll(MIGRATION_VERSION_RE)].map((match) => match[1]),
      ),
    ),
  ].sort();
}

export function resolveRemoteMigrations(remoteJson, localFilenames) {
  const remote = remoteMigrationVersions(remoteJson);
  const baseline = remote.at(-1) ?? null;
  const local = localFilenames
    .map(migrationVersion)
    .filter((version) => version !== null)
    .sort();
  const remoteSet = new Set(remote);
  const pending = [...new Set(local)].filter(
    (version) => !remoteSet.has(version),
  );
  const remoteOnly = remote.filter((version) => !local.includes(version));

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

  return { baseline, pending };
}

function main() {
  const remoteJson = JSON.parse(awaitInput());
  const localFilenames = readdirSync(path.resolve("supabase/migrations"));
  console.log(
    JSON.stringify(resolveRemoteMigrations(remoteJson, localFilenames)),
  );
}

function awaitInput() {
  return readFileSync(0, "utf8");
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
