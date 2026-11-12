import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  migrationVersion,
  remoteMigrationVersions,
  resolveRemoteMigrations,
} from "./resolve-remote-migrations.mjs";

const localFiles = [
  "20260823176000_first.sql",
  "20260823177000_second.sql",
  "20260826100000_pending.sql",
];

const capturedCliOutput = JSON.parse(
  readFileSync(
    new URL("./fixtures/supabase-migration-list-2.111.0.json", import.meta.url),
    "utf8",
  ),
);
const capturedDryRunOutput = JSON.parse(
  readFileSync(
    new URL("./fixtures/supabase-db-push-dry-run-2.111.0.json", import.meta.url),
    "utf8",
  ),
);
const capturedDriftOutput = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/supabase-migration-list-2.111.0-drift.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const capturedDriftDryRunOutput = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/supabase-db-push-dry-run-2.111.0-drift.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const row = (local, remote = local) => ({
  local,
  remote,
  time: `${local.slice(0, 4)}-${local.slice(4, 6)}-${local.slice(6, 8)} ${local.slice(8, 10)}:${local.slice(10, 12)}:${local.slice(12)}`,
});

describe("resolveRemoteMigrations", () => {
  test("accepts the captured Supabase CLI 2.111.0 migration-list shape", () => {
    expect(remoteMigrationVersions(capturedCliOutput)).toEqual([
      "20240730075029",
      "20240730075425",
      "20240806124555",
    ]);
  });

  test("cross-checks the captured 2.111.0 db push dry-run shape", () => {
    expect(
      resolveRemoteMigrations(
        {
          migrations: [
            row("20240730075029"),
            row("20240730075425"),
            row("20240806124555"),
          ],
        },
        [
          "20240730075029_first.sql",
          "20240730075425_second.sql",
          "20240806124555_third.sql",
        ],
        capturedDryRunOutput,
      ),
    ).toMatchObject({ baseline: "20240806124555", pending: [], heavy: false });
  });

  test("proves a captured 2.111.0 local-only row enables the heavy path", () => {
    const result = resolveRemoteMigrations(
      capturedDriftOutput,
      [
        "20260826090000_first.sql",
        "20260826100000_second.sql",
        "20261112000000_ci_transcript_probe.sql",
      ],
      capturedDriftDryRunOutput,
    );

    expect(result).toEqual({
      baseline: "20260826100000",
      pending: ["20261112000000"],
      heavy: true,
    });
  });

  test("uses only non-empty remote fields and marks a local-only row heavy", () => {
    const result = resolveRemoteMigrations(
      {
        migrations: [
          row("20260823176000"),
          row("20260823177000"),
          row("20260826100000", ""),
        ],
      },
      localFiles,
      { upToDate: false, migrations: ["20260826100000_pending.sql"] },
    );

    expect(result).toEqual({
      baseline: "20260823177000",
      pending: ["20260826100000"],
      heavy: true,
    });
  });

  test("returns light when both sources say every migration is applied", () => {
    const result = resolveRemoteMigrations(
      { migrations: [row("20260823176000"), row("20260823177000")] },
      ["20260823176000_first.sql", "20260823177000_second.sql"],
      { upToDate: true, migrations: [] },
    );
    expect(result.heavy).toBe(false);
    expect(result.pending).toEqual([]);
  });

  test("rejects a remote-only migration", () => {
    expect(() =>
      resolveRemoteMigrations(
        { migrations: [row("20260823176000"), row("20260823177000")] },
        ["20260823176000_first.sql"],
        { upToDate: false, migrations: ["20260823177000_second.sql"] },
      ),
    ).toThrow(/absent locally/);
  });

  test("rejects disagreement between migration list and db push dry-run", () => {
    expect(() =>
      resolveRemoteMigrations(
        {
          migrations: [
            row("20260823176000"),
            row("20260823177000"),
            row("20260826100000", ""),
          ],
        },
        localFiles,
        { upToDate: false, migrations: ["20260823177000_second.sql"] },
      ),
    ).toThrow(/disagree/);
  });

  test("rejects empty and malformed migration-list shapes", () => {
    expect(() => resolveRemoteMigrations({}, localFiles)).toThrow(/non-empty migrations/);
    expect(() =>
      resolveRemoteMigrations(
        { migrations: [{ version: "20260823176000" }] },
        localFiles,
      ),
    ).toThrow(/exactly local, remote, and time/);
    expect(() => remoteMigrationVersions({ migrations: [row("", "")] })).toThrow(
      /both local and remote empty/,
    );
  });

  test("rejects an unusable db push dry-run shape", () => {
    expect(() =>
      resolveRemoteMigrations(
        { migrations: [row("20260823176000"), row("20260823177000")] },
        ["20260823176000_first.sql", "20260823177000_second.sql"],
        { upToDate: "yes", migrations: [] },
      ),
    ).toThrow(/boolean upToDate/);
  });

  test("rejects a missing older migration instead of hiding it behind the latest baseline", () => {
    expect(() =>
      resolveRemoteMigrations(
        {
          migrations: [
            row("20260823176000", ""),
            row("20260823177000"),
          ],
        },
        [
          "20260823176000_pending-out-of-order.sql",
          "20260823177000_second.sql",
        ],
        { upToDate: false, migrations: ["20260823176000_pending-out-of-order.sql"] },
      ),
    ).toThrow(/timestamped before the last remotely applied/);
  });

  test("extracts only migration-shaped local filenames", () => {
    expect(migrationVersion("20260823176000_valid.sql")).toBe("20260823176000");
    expect(migrationVersion("README.md")).toBeNull();
  });
});
