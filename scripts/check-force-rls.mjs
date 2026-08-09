#!/usr/bin/env node
// AD-1 CI assertion: every table with RLS must have FORCE ROW LEVEL SECURITY.
// Scans supabase/schemas/01_tables.sql for CREATE TABLE blocks and
// supabase/schemas/05_policies.sql for RLS/force-RLS declarations.
// Fails if any table has `enable row level security` without `force row level security`.
import { readFileSync } from "node:fs";
import path from "node:path";

const SCHEMAS_DIR = "supabase/schemas";
const TABLES_FILE = path.join(SCHEMAS_DIR, "01_tables.sql");
const POLICIES_FILE = path.join(SCHEMAS_DIR, "05_policies.sql");

/**
 * Extracts all table names from CREATE TABLE statements in 01_tables.sql.
 * Handles both `create table public.name` and `create table public."name"`.
 */
export function extractDeclaredTables(sql) {
  const tables = [];
  const re = /create table\s+public\.("?[\w_]+"?)\s*\(/gi;
  for (const match of sql.matchAll(re)) {
    let name = match[1];
    if (name.startsWith('"') && name.endsWith('"')) {
      name = name.slice(1, -1);
    }
    tables.push(name);
  }
  return tables;
}

/**
 * Extracts tables that have `enable row level security` from 05_policies.sql.
 */
export function extractRlsEnabledTables(sql) {
  const tables = new Set();
  const re =
    /alter table\s+public\.("?[\w_]+"?)\s+enable\s+row\s+level\s+security/gi;
  for (const match of sql.matchAll(re)) {
    let name = match[1];
    if (name.startsWith('"') && name.endsWith('"')) {
      name = name.slice(1, -1);
    }
    tables.add(name);
  }
  return tables;
}

/**
 * Extracts tables that have `force row level security` from 05_policies.sql.
 */
export function extractForceRlsTables(sql) {
  const tables = new Set();
  const re =
    /alter table\s+public\.("?[\w_]+"?)\s+force\s+row\s+level\s+security/gi;
  for (const match of sql.matchAll(re)) {
    let name = match[1];
    if (name.startsWith('"') && name.endsWith('"')) {
      name = name.slice(1, -1);
    }
    tables.add(name);
  }
  return tables;
}

/**
 * Runs the check and returns a list of failure messages.
 * Empty list means all tables with RLS have FORCE RLS.
 */
export function runForceRlsCheck(repoRoot) {
  const failures = [];
  const tablesSql = readFileSync(path.join(repoRoot, TABLES_FILE), "utf8");
  const policiesSql = readFileSync(path.join(repoRoot, POLICIES_FILE), "utf8");

  const declaredTables = extractDeclaredTables(tablesSql);
  const rlsEnabledTables = extractRlsEnabledTables(policiesSql);
  const forceRlsTables = extractForceRlsTables(policiesSql);

  // Find tables that have RLS enabled but NOT force RLS
  const missingForceRls = [];
  for (const table of rlsEnabledTables) {
    if (!forceRlsTables.has(table)) {
      missingForceRls.push(table);
    }
  }

  if (missingForceRls.length > 0) {
    failures.push(
      `The following tables have RLS enabled but are missing FORCE ROW LEVEL SECURITY:\n  ${missingForceRls.sort().join("\n  ")}\n` +
        `Add 'alter table public.<table> force row level security;' to ${POLICIES_FILE} for each.`,
    );
  }

  // Also verify that every declared table that should have RLS actually does
  // (this is a sanity check - tables without RLS are not flagged here)
  const tablesWithRls = Array.from(rlsEnabledTables).sort();
  const tablesWithForceRls = Array.from(forceRlsTables).sort();

  return {
    failures,
    declaredTables,
    tablesWithRls,
    tablesWithForceRls,
    missingForceRls: missingForceRls.sort(),
  };
}

function main() {
  const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
  const result = runForceRlsCheck(repoRoot);

  if (result.failures.length > 0) {
    console.error("FORCE RLS check failed:\n");
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("FORCE RLS check OK.");
  console.log(
    `  Tables declared in 01_tables.sql: ${result.declaredTables.length}`,
  );
  console.log(`  Tables with RLS enabled: ${result.tablesWithRls.length}`);
  console.log(`  Tables with FORCE RLS: ${result.tablesWithForceRls.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
