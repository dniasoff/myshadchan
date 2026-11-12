import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { isCleanSchemaDiff, parseArgs } from "./check-schema-drift.mjs";

describe("isCleanSchemaDiff", () => {
  test("accepts the captured Supabase 2.111.0 clean transcript", () => {
    const transcript = readFileSync(
      path.join(
        process.cwd(),
        "scripts/fixtures/supabase-db-diff-clean-2.111.0.txt",
      ),
      "utf8",
    );
    expect(isCleanSchemaDiff(transcript)).toBe(true);
  });

  test("rejects the captured drift transcript even with a clean marker", () => {
    const transcript = readFileSync(
      path.join(
        process.cwd(),
        "scripts/fixtures/supabase-db-diff-drift-2.111.0.txt",
      ),
      "utf8",
    );
    expect(isCleanSchemaDiff(transcript)).toBe(false);
  });

  test("accepts the CLI's clean result", () => {
    expect(isCleanSchemaDiff("No schema changes found")).toBe(true);
    expect(isCleanSchemaDiff("No schema changes found.\n")).toBe(true);
    expect(
      isCleanSchemaDiff(
        JSON.stringify({
          diff: "",
          dropStatements: [],
          message: "Diff complete.",
        }),
      ),
    ).toBe(true);
    expect(
      isCleanSchemaDiff(
        "Creating shadow database...\nDiffing schemas...\nNo schema changes found\nFinished supabase db diff.",
      ),
    ).toBe(true);
  });

  test("rejects a migration-shaped diff", () => {
    expect(
      isCleanSchemaDiff(
        'alter table "public"."members" drop column "legacy_name";',
      ),
    ).toBe(false);
    expect(
      isCleanSchemaDiff(
        JSON.stringify({
          diff: 'alter table "public"."members" drop column "legacy_name";',
          dropStatements: [
            'alter table "public"."members" drop column "legacy_name";',
          ],
        }),
      ),
    ).toBe(false);
  });

  test("rejects an empty or mixed result instead of assuming clean", () => {
    expect(isCleanSchemaDiff("")).toBe(false);
    expect(
      isCleanSchemaDiff(
        'alter table "public"."members" drop column "legacy_name";\nNo schema changes found',
      ),
    ).toBe(false);
    expect(
      isCleanSchemaDiff(
        'Diffing schemas...\nalter table "public"."members" drop column "legacy_name";\nNo schema changes found',
      ),
    ).toBe(false);
  });
});

describe("parseArgs", () => {
  test("reads an explicit stack workdir", () => {
    expect(parseArgs(["--workdir", ".supabase-e2e-8"])).toEqual({
      workdir: ".supabase-e2e-8",
    });
  });

  test("requires a workdir value", () => {
    expect(() => parseArgs(["--workdir"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--wat"])).toThrow(/unknown argument/);
  });
});
