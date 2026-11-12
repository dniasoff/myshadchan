import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the real migration-data-safety assertion SQL against a deliberately
 * bad migration: a populated column is dropped with no declared destination.
 * This is intentionally a small catalog fixture rather than the full business
 * fixture, so the test proves the guard's failure path without mutating any
 * application rows. The surrounding transaction is rolled back when psql
 * exits after the expected assertion error.
 */
function knownBadMigrationScript(): string {
  const assertSql = `${process.cwd()}/supabase/tests/migration-data-safety/assert.sql`;
  return [
    "\\set ON_ERROR_STOP on",
    "begin;",
    "drop schema if exists migration_guard cascade;",
    "drop table if exists public.migration_guard_known_bad;",
    "create schema migration_guard;",
    "create table migration_guard.snapshot (table_name text not null, row_key text not null, key_json jsonb not null, row_json jsonb not null, multiplicity integer not null default 1);",
    "create table migration_guard.table_renames (from_table text primary key, to_table text not null, reason text not null);",
    "create table migration_guard.discarded_tables (table_name text primary key, reason text not null);",
    "create table migration_guard.column_moves (table_name text not null, from_column text not null, recover_query text not null, compare_fn text not null, note text not null, primary key (table_name, from_column));",
    "create table migration_guard.discarded_columns (table_name text not null, column_name text not null, reason text not null, primary key (table_name, column_name));",
    "create table migration_guard.expected_rewrites (table_name text not null, column_name text not null, reason text not null, primary key (table_name, column_name));",
    "create table public.migration_guard_known_bad (id integer primary key, legacy_value text);",
    "insert into public.migration_guard_known_bad values (1, 'must-survive');",
    "insert into migration_guard.snapshot (table_name, row_key, key_json, row_json) values ('migration_guard_known_bad', 'id=1', '{\"id\": 1}', '{\"id\": 1, \"legacy_value\": \"must-survive\"}');",
    "-- Known-bad migration fixture: this destroys a populated value with no move declaration.",
    "alter table public.migration_guard_known_bad drop column legacy_value;",
    `\\i ${assertSql}`,
    "rollback;",
  ].join("\n");
}

function runKnownBadMigration(): { error?: string } {
  try {
    execFileSync("psql", [DB_URL, "-X", "-q", "-f", "-"], {
      input: knownBadMigrationScript(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function databaseConnectivityError(): string | undefined {
  try {
    execFileSync("psql", [DB_URL, "-X", "-q", "-c", "select 1"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const connectivityError = databaseConnectivityError();
const result = connectivityError
  ? { error: connectivityError }
  : runKnownBadMigration();

describe("migration data-safety known-bad fixture", () => {
  if (bailIfDbUnreachable(connectivityError)) return;

  it("fails on a populated column dropped without a declared destination", () => {
    expect(result.error).toMatch(/COLUMN DROPPED WITH DATA/);
    expect(result.error).toMatch(/migration data-safety guard FAILED/);
  });
});
