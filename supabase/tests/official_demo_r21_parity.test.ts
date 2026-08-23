import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(
  path.join(testDirectory, "../schemas/02_functions.sql"),
  "utf8",
);
const migration = readFileSync(
  path.join(
    testDirectory,
    "../migrations/20260823190000_official_demo_r21_convergence.sql",
  ),
  "utf8",
);

const functions = [
  [
    "public.resolve_demo_listing_id(bigint,text,bigint,text,bigint,bigint)",
    "resolve_demo_listing_id",
  ],
  [
    "public.withdraw_demo_listing(bigint,text,bigint,bigint,bigint)",
    "withdraw_demo_listing",
  ],
  ["public.fence_demo_cleanup(bigint,text,text)", "fence_demo_cleanup"],
  [
    "public.delete_demo_cleanup_rows(bigint,text,text,text)",
    "delete_demo_cleanup_rows",
  ],
  [
    "public.delete_demo_actor_rows(bigint,text,text,uuid,text)",
    "delete_demo_actor_rows",
  ],
  [
    "public.delete_demo_resource(bigint,text,text,bigint,text)",
    "delete_demo_resource",
  ],
  [
    "public.finalize_demo_seed_cleanup(bigint,text)",
    "finalize_demo_seed_cleanup",
  ],
  [
    "public.assert_demo_resource_ownership(bigint,text,bigint,boolean)",
    "assert_demo_resource_ownership",
  ],
  [
    "public.assert_official_demo_inventory(bigint,boolean)",
    "assert_official_demo_inventory",
  ],
  ["public.activate_demo_run(bigint,text,text)", "activate_demo_run"],
] as const;

function sourceFunctionBlock(source: string, name: string): string {
  const marker = new RegExp(
    `CREATE OR REPLACE FUNCTION (?:public\\.|"public"\\.)"?${name}"?\\(`,
  );
  const match = marker.exec(source);
  if (!match) throw new Error(`missing declarative ${name}`);
  const asMatch = source.slice(match.index).match(/\n\s*AS\s+(\$\w*\$|\$\$)/i);
  if (!asMatch || asMatch.index === undefined) {
    throw new Error(`missing body for declarative ${name}`);
  }
  const bodyStart = match.index + asMatch.index + asMatch[0].length;
  const end = source.indexOf(asMatch[1], bodyStart);
  if (end < 0) throw new Error(`unterminated declarative ${name}`);
  return source.slice(match.index, end + asMatch[1].length);
}

const sql = `
select coalesce(json_agg(json_build_object(
  'signature', signature,
  'definition', pg_get_functiondef(signature::regprocedure),
  'service', has_function_privilege('service_role', signature, 'execute'),
  'anon', has_function_privilege('anon', signature, 'execute'),
  'authenticated', has_function_privilege('authenticated', signature, 'execute')
) order by signature), '[]'::json)
from (values
  ${functions.map(([signature]) => `('${signature}')`).join(",\n  ")}
) requested(signature);
`;

let deployed: Array<{
  signature: string;
  definition: string;
  service: boolean;
  anon: boolean;
  authenticated: boolean;
}> = [];
let databaseError: string | undefined;
try {
  deployed = JSON.parse(
    execFileSync("psql", ["-X", "-At", DB_URL, "-c", sql], {
      env: { ...process.env, PGPASSWORD: "postgres" },
      encoding: "utf8",
      timeout: 120_000,
    }).trim(),
  ) as typeof deployed;
} catch (error) {
  databaseError = error instanceof Error ? error.message : String(error);
}

describe("official demo r21 declarative/deployed parity", () => {
  if (bailIfDbUnreachable(databaseError)) return;

  it("has one canonical source definition and one deployed definition per signature", () => {
    expect(databaseError).toBeUndefined();
    expect(deployed).toHaveLength(functions.length);
    for (const [signature, name] of functions) {
      const row = deployed.find(
        (candidate) => candidate.signature === signature,
      );
      expect(row, signature).toBeDefined();
      expect(row?.definition.trim()).toBe(
        sourceFunctionBlock(schema, name).trim(),
      );
      expect(row?.service, signature).toBe(true);
      expect(row?.anon, signature).toBe(false);
      expect(row?.authenticated, signature).toBe(false);
      expect(
        schema.match(
          new RegExp(
            `CREATE OR REPLACE FUNCTION (?:public\\.|"public"\\.)"?${name}"?\\(`,
            "g",
          ),
        ),
        name,
      ).toHaveLength(1);
      expect(migration).toContain(`function public.${name}`);
    }
  });
});
