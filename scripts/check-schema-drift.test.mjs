import { describe, expect, test } from "vitest";

import { isCleanSchemaDiff, parseArgs } from "./check-schema-drift.mjs";

describe("isCleanSchemaDiff", () => {
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
