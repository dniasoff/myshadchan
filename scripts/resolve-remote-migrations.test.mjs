import { describe, expect, test } from "vitest";

import {
  migrationVersion,
  remoteMigrationVersions,
  resolveRemoteMigrations,
} from "./resolve-remote-migrations.mjs";

describe("resolveRemoteMigrations", () => {
  test("uses the latest hosted version and finds pending local migrations", () => {
    const result = resolveRemoteMigrations(
      {
        migrations: [
          { version: "20260823176000", name: "first" },
          { version: "20260823177000", name: "second" },
        ],
      },
      [
        "20260823176000_first.sql",
        "20260823177000_second.sql",
        "20260826100000_pending.sql",
      ],
    );

    expect(result).toEqual({
      baseline: "20260823177000",
      pending: ["20260826100000"],
    });
  });

  test("rejects a hosted migration that is absent locally", () => {
    expect(() =>
      resolveRemoteMigrations(
        { migrations: [{ version: "20260823176000" }] },
        [],
      ),
    ).toThrow(/absent locally/);
  });

  test("rejects a missing older migration instead of hiding it behind the latest baseline", () => {
    expect(() =>
      resolveRemoteMigrations({ migrations: [{ version: "20260823177000" }] }, [
        "20260823176000_pending-out-of-order.sql",
        "20260823177000_second.sql",
      ]),
    ).toThrow(/timestamped before the last remotely applied/);
  });

  test("rejects an empty or malformed hosted history", () => {
    expect(() => resolveRemoteMigrations({}, [])).toThrow(
      /no applied migration/,
    );
    expect(
      remoteMigrationVersions({ migrations: [{ version: "nope" }] }),
    ).toEqual([]);
  });

  test("extracts only migration-shaped local filenames", () => {
    expect(migrationVersion("20260823176000_valid.sql")).toBe("20260823176000");
    expect(migrationVersion("README.md")).toBeNull();
  });
});
