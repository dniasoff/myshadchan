import { describe, expect, test } from "vitest";

import {
  isUsableBaseRef,
  migrationVersion,
  migrationVersions,
  parseArgs,
  partitionMigrations,
} from "./check-migration-data-safety.mjs";

// The Docker half of this guard (reset -> seed -> migrate -> assert) is
// exercised by `make check-migration-safety`, which needs a running Supabase
// stack. What is unit-tested here is the part that decides WHICH migrations
// count as pending — get that wrong and the guard runs a perfectly green
// no-op while a destructive migration walks past it.

describe("migrationVersion", () => {
  test("extracts the 14-digit timestamp from a migration file name", () => {
    // Arrange
    const filename = "20260730011428_shidduch_overview_fields.sql";

    // Act
    const version = migrationVersion(filename);

    // Assert
    expect(version).toBe("20260730011428");
  });

  test("extracts the timestamp from a full path", () => {
    expect(
      migrationVersion(
        "supabase/migrations/20260729095558_backfill_member_state.sql",
      ),
    ).toBe("20260729095558");
  });

  test("returns null for a file that is not a migration", () => {
    expect(migrationVersion("README.md")).toBeNull();
    expect(migrationVersion("not_a_timestamp_migration.sql")).toBeNull();
  });
});

describe("migrationVersions", () => {
  test("returns sorted, de-duplicated versions and ignores non-sql files", () => {
    // Arrange
    const filenames = [
      "20260730011428_b.sql",
      "20260729095558_a.sql",
      ".gitkeep",
      "20260730011428_b.sql",
      "notes.md",
    ];

    // Act
    const versions = migrationVersions(filenames);

    // Assert
    expect(versions).toEqual(["20260729095558", "20260730011428"]);
  });

  test("returns an empty list when there are no migrations", () => {
    expect(migrationVersions([])).toEqual([]);
  });
});

describe("partitionMigrations", () => {
  test("reports every local migration absent from the baseline as pending", () => {
    // Arrange — the Epic 5 situation: production at the member_state
    // migration, ten Epic 5 migrations sitting locally undeployed.
    const baseline = [
      "20260729070301_entity_files.sql",
      "20260729095558_member_state.sql",
    ];
    const local = [
      ...baseline,
      "20260730011428_shidduch_overview_fields.sql",
      "20260730094101_shadchan_stats_overview.sql",
    ];

    // Act
    const partition = partitionMigrations(local, baseline);

    // Assert
    expect(partition.pending).toEqual(["20260730011428", "20260730094101"]);
    expect(partition.baselineVersion).toBe("20260729095558");
    expect(partition.removed).toEqual([]);
  });

  test("reports no pending migrations when local matches the baseline", () => {
    // Arrange — CI on a push whose commits contained no migration.
    const files = ["20260729095558_member_state.sql"];

    // Act
    const partition = partitionMigrations(files, files);

    // Assert
    expect(partition.pending).toEqual([]);
    expect(partition.baselineVersion).toBe("20260729095558");
  });

  test("flags a migration that exists at the baseline but not locally", () => {
    // Arrange — deleted applied history, a worse problem than a missing
    // backfill and one the guard must not silently swallow.
    const baseline = [
      "20260729070301_entity_files.sql",
      "20260729095558_member_state.sql",
    ];
    const local = ["20260729070301_entity_files.sql"];

    // Act
    const partition = partitionMigrations(local, baseline);

    // Assert
    expect(partition.removed).toEqual(["20260729095558"]);
  });

  test("treats an out-of-order timestamp as pending, not as already deployed", () => {
    // Arrange — a migration authored on a branch with an EARLIER timestamp
    // than the last deployed one. A "greater than the baseline version"
    // comparison would miss it; set difference does not.
    const baseline = ["20260729095558_member_state.sql"];
    const local = ["20260729000001_older_branch_migration.sql", ...baseline];

    // Act
    const partition = partitionMigrations(local, baseline);

    // Assert
    expect(partition.pending).toEqual(["20260729000001"]);
  });
});

describe("isUsableBaseRef", () => {
  test("rejects the all-zero SHA GitHub sends for a first push", () => {
    expect(isUsableBaseRef("0000000000000000000000000000000000000000")).toBe(
      false,
    );
  });

  test("rejects an empty ref", () => {
    expect(isUsableBaseRef("")).toBe(false);
    expect(isUsableBaseRef(undefined)).toBe(false);
  });

  test("accepts a branch name and a commit SHA", () => {
    expect(isUsableBaseRef("origin/main")).toBe(true);
    expect(isUsableBaseRef("a8c5e3d")).toBe(true);
  });
});

describe("parseArgs", () => {
  test("defaults to comparing against origin/main", () => {
    expect(parseArgs([])).toEqual({
      baseRef: "origin/main",
      baseline: null,
      keep: false,
    });
  });

  test("reads --base-ref, --baseline and --keep", () => {
    // Arrange
    const argv = [
      "--base-ref",
      "a8c5e3d",
      "--baseline",
      "20260729095558",
      "--keep",
    ];

    // Act
    const options = parseArgs(argv);

    // Assert
    expect(options).toEqual({
      baseRef: "a8c5e3d",
      baseline: "20260729095558",
      keep: true,
    });
  });

  test("throws when a flag is missing its value", () => {
    expect(() => parseArgs(["--base-ref"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--base-ref", "--keep"])).toThrow(/needs a value/);
  });

  test("throws on an unknown argument", () => {
    expect(() => parseArgs(["--wat"])).toThrow(/unknown argument/);
  });
});
