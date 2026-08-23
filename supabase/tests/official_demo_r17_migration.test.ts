import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationFile = path.join(
  testDirectory,
  "../migrations/20260823177000_official_demo_r17_convergence_repairs.sql",
);
const stack2Only = process.env.STACK_ID === "2";
const stack2DbUrl =
  "postgresql://postgres@127.0.0.1:54362/postgres?sslmode=disable";
const schemaFile = path.join(testDirectory, "../schemas/02_functions.sql");
const canonicalFunctions = [
  ["begin_demo_seed", "bigint,text"],
  ["claim_demo_ingest", "bigint,text,integer"],
  ["demo_assert_empty_account", "bigint"],
  ["demo_storage_write_fence", "bigint"],
  ["heartbeat_demo_ingest_claim", "bigint,text,integer"],
  ["release_demo_ingest_claim", "bigint,text"],
  ["wait_for_demo_ingest_account_claims", "bigint,integer"],
  ["wait_for_demo_ingest_claims", "bigint,text,integer"],
] as const;

function functionBody(definition: string, functionName: string): string {
  const quotedStart = `CREATE OR REPLACE FUNCTION "public"."${functionName}"`;
  const canonicalStart = `CREATE OR REPLACE FUNCTION public.${functionName}`;
  const start = Math.max(
    definition.indexOf(quotedStart),
    definition.indexOf(canonicalStart),
  );
  if (start < 0) {
    throw new Error(`function ${functionName} is missing from definition`);
  }
  const asMatch = definition.slice(start).match(/\n\s*AS\s+(\$\w*\$|\$\$)\n/);
  if (!asMatch || asMatch.index === undefined) {
    throw new Error(`function ${functionName} has no SQL body`);
  }
  const bodyStart = start + asMatch.index + asMatch[0].length;
  const bodyEnd = definition.indexOf(`\n${asMatch[1]}`, bodyStart);
  if (bodyEnd < 0) {
    throw new Error(`function ${functionName} has an unterminated SQL body`);
  }
  return definition.slice(bodyStart, bodyEnd).trimEnd();
}

let applicationError: string | undefined;
let parityError: string | undefined;
if (stack2Only) {
  try {
    execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", stack2DbUrl], {
      env: { ...process.env, PGPASSWORD: "postgres" },
      input: `begin;\n\\i '${migrationFile}'\nrollback;\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (error) {
    applicationError = error instanceof Error ? error.message : String(error);
  }

  try {
    const source = readFileSync(schemaFile, "utf8");
    for (const [functionName, argumentTypes] of canonicalFunctions) {
      const signature = `public.${functionName}(${argumentTypes})`;
      const deployed = execFileSync(
        "psql",
        [
          "-X",
          "-At",
          "-v",
          "ON_ERROR_STOP=1",
          stack2DbUrl,
          "-c",
          `select pg_get_functiondef('${signature}'::regprocedure);`,
        ],
        {
          env: { ...process.env, PGPASSWORD: "postgres" },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 120_000,
        },
      );
      expect(functionBody(source, functionName)).toBe(
        functionBody(deployed, functionName),
      );
    }
  } catch (error) {
    parityError = error instanceof Error ? error.message : String(error);
  }
}

describe("official demo r17 migration application", () => {
  if (!stack2Only) {
    it.skipIf(!stack2Only)(
      "requires explicit STACK_ID=2 / PostgreSQL port 54362",
      () => {},
    );
    return;
  }

  it("parses and applies both repaired functions in PostgreSQL", () => {
    expect(stack2DbUrl).toContain(":54362/");
    expect(applicationError).toBeUndefined();
  });

  it("keeps the eight r17 function bodies canonical with Stack 2", () => {
    expect(stack2DbUrl).toContain(":54362/");
    expect(parityError).toBeUndefined();
  });
});
