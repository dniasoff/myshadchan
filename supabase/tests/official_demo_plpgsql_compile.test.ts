import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaFile = path.join(testDirectory, "../schemas/02_functions.sql");
const migrationFile = path.join(
  testDirectory,
  "../migrations/20260823180000_official_demo_plpgsql_repairs.sql",
);
const staleRunError = "demo run -1 lease is stale or fenced";
const repairedFunctions = [
  "register_demo_auth_cleanup",
  "restore_demo_member_state",
  "delete_demo_companion_contexts",
] as const;

function functionBody(definition: string, functionName: string): string {
  const starts = [
    `CREATE OR REPLACE FUNCTION "public"."${functionName}"`,
    `CREATE OR REPLACE FUNCTION public.${functionName}`,
  ].map((marker) => definition.indexOf(marker));
  const start = Math.max(...starts);
  if (start < 0) throw new Error(`missing ${functionName}`);
  const asMatch = definition.slice(start).match(/\n\s*AS\s+(\$\w*\$|\$\$)\n/);
  if (!asMatch || asMatch.index === undefined) {
    throw new Error(`missing body for ${functionName}`);
  }
  const bodyStart = start + asMatch.index + asMatch[0].length;
  const bodyEnd = definition.indexOf(`\n${asMatch[1]}`, bodyStart);
  if (bodyEnd < 0) throw new Error(`unterminated body for ${functionName}`);
  return definition.slice(bodyStart, bodyEnd).trimEnd();
}

const compileInput = `begin;
\\i '${migrationFile}'
do $$
begin
  begin
    perform public.register_demo_auth_cleanup(
      -1,
      'x',
      'actor',
      '00000000-0000-0000-0000-000000000000',
      'x@example.invalid',
      'seed'
    );
  exception when others then
    if sqlerrm <> '${staleRunError}' then raise; end if;
  end;

  begin
    perform public.restore_demo_member_state(-1, 'x', 'seed');
  exception when others then
    if sqlerrm <> '${staleRunError}' then raise; end if;
  end;

  begin
    perform public.delete_demo_companion_contexts(-1, 'x', 'seed');
  exception when others then
    if sqlerrm <> '${staleRunError}' then raise; end if;
  end;
end;
$$;
rollback;
`;

let executionError: string | undefined;
try {
  execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", DB_URL], {
    env: { ...process.env, PGPASSWORD: "postgres" },
    input: compileInput,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
  });
} catch (error) {
  executionError = error instanceof Error ? error.message : String(error);
}

describe("official demo PL/pgSQL repairs", () => {
  it("keeps each forward-migration body identical to declarative SQL", () => {
    const source = readFileSync(schemaFile, "utf8");
    const migration = readFileSync(migrationFile, "utf8");
    for (const functionName of repairedFunctions) {
      expect(functionBody(migration, functionName)).toBe(
        functionBody(source, functionName),
      );
    }
  });

  it("keeps every repaired operation guard explicit in the declarative source", () => {
    const source = readFileSync(schemaFile, "utf8");
    expect(source).not.toContain(
      "v_run.status <> case when p_operation = 'seed'",
    );
    expect(
      source.match(/p_operation = 'seed' and v_run\.status <> 'seeding'/g),
    ).toHaveLength(3);
    expect(
      source.match(/p_operation = 'clear' and v_run\.status <> 'clearing'/g),
    ).toHaveLength(3);
  });

  if (bailIfDbUnreachable(executionError)) return;

  it("forces PostgreSQL compilation and execution of all repaired guards", () => {
    expect(executionError).toBeUndefined();
  });
});
