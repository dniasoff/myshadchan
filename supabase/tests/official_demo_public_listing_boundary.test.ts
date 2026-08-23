import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

const readProjectFile = (...parts: string[]) =>
  readFileSync(path.join(testDirectory, "..", ...parts), "utf8");

const listingCheckBlocks = (source: string) =>
  [
    "anonymous public listings contain no activated demo listing",
    "anon excludes active demo listing",
    "anon excludes failed demo listing",
  ]
    .map((name) => source.indexOf(`select '${name}'`))
    .filter((start) => start >= 0)
    .map((start) => {
      const ends = [
        source.indexOf("set local role postgres;", start),
        source.indexOf("reset role;", start),
      ].filter((end) => end >= 0);
      return source.slice(start, Math.min(...ends));
    });

describe("official demo public listing boundary", () => {
  it("reconciles the old table grant with the public projection contract", () => {
    const migration = readProjectFile(
      "migrations",
      "20260823200000_official_demo_public_listing_boundary.sql",
    );
    const grants = readProjectFile("schemas", "06_grants.sql");

    for (const source of [migration, grants]) {
      expect(source).toContain(
        "revoke all on table public.listings from anon, authenticated",
      );
      expect(source).toMatch(
        /grant select\s*\(\s*id,\s*created_at,\s*listing_type,/s,
      );
      expect(source).toContain("shadchan_contact_info");
      expect(source).toContain("single_summary");
    }

    const anonGrant = migration.match(
      /grant select \(([\s\S]*?)\) on table public\.listings to anon;/,
    )?.[1];
    expect(anonGrant).toBeDefined();
    expect(anonGrant).not.toMatch(/\baccount_id\b|\bsingle_id\b/);
  });

  it("keeps anonymous demo exclusion checks on public fields only", () => {
    const activation = readProjectFile(
      "tests",
      "official_demo_r21_activation.sql",
    );
    const bundle = readProjectFile("tests", "official_demo_bundle.sql");

    for (const source of [activation, bundle]) {
      const checks = listingCheckBlocks(source);
      expect(checks.length).toBeGreaterThan(0);
      for (const section of checks) {
        expect(section).toContain("shadchan_name");
        expect(section).toContain("shadchan_contact_info");
        expect(section).not.toMatch(/\baccount_id\b|\bsingle_id\b/);
      }
    }
  });
});
