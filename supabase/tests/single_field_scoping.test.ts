import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DB_URL,
  bailIfDbUnreachable,
  siblingHouseholdFixtureSql,
} from "./dbSuiteHelpers";

/**
 * Runs the field-level single-scoping database suite (Story 6.3, AC 1-8)
 * against the local Supabase stack.
 *
 * The assertions live in single_field_scoping.sql, because what they check —
 * RLS denying `single` outright on reference_links/"references"/entity_files/
 * shidduchim_external_links/interactions/medical_notes, the shadchanim
 * row-readable/write-denied split and its shadchan_stats aggregate-leak
 * guard, the shidduchim_summary.close_reason CASE redaction, and the
 * two-sided storage.objects assertion — only exists inside Postgres and
 * cannot be meaningfully exercised through a mock. The SQL emits one JSON
 * row per check; this file turns each into a named test so a failure names
 * the invariant that broke.
 *
 * Needs `make start` (or `supabase start`). If the database is unreachable
 * the suite reports a single skipped test rather than failing the whole run.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "single_field_scoping.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

// single_field_scoping.sql wraps its own checks in `begin; ... rollback;` and
// clears public.account_members inside that transaction before setting up
// its own fixtures — the same isolation shape as every other suite in this
// directory. The shared sibling fixture (dbSuiteHelpers.ts) is spliced in
// HERE, before `\i`, exactly like single_row_scoping.test.ts does for
// Story 6.2 — 6.1/6.4/6.5 each assemble their own script the same way,
// splicing the identical fixture text ahead of their own suite-specific
// file.
function isolatedScript(): string {
  return [
    "\\set ON_ERROR_STOP on",
    "begin;",
    "delete from public.account_members;",
    siblingHouseholdFixtureSql(),
    `\\i ${SQL_FILE}`,
  ].join("\n");
}

function runSuite(): { checks: Check[]; error?: string } {
  let stdout: string;
  try {
    stdout = execFileSync("psql", [DB_URL, "-X", "-q", "-f", "-"], {
      input: isolatedScript(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { checks: [], error: message };
  }

  const reportLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.startsWith("[") && line.endsWith("]"));

  if (!reportLine) {
    return { checks: [], error: `no report emitted:\n${stdout.slice(-2000)}` };
  }

  return { checks: JSON.parse(reportLine) as Check[] };
}

const { checks, error } = runSuite();

describe("single_field_scoping (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // Review should-fix #5: a `>=` floor lets any check silently vanish (an
  // `insert into results (...) select ... from <view> where id = ...` with
  // no matching row inserts nothing at all, rather than a named failure) as
  // long as the total stays above the threshold — exactly what happened to
  // the shadchan_stats checks before they were rewritten with `select ...
  // into` + `found`. An exact count catches any check disappearing, not just
  // a large drop. Update this number in the same diff as any change to the
  // number of `insert into results` statements in single_field_scoping.sql.
  //
  // 47 -> 51 in the Story 6.3/6.4 adjudication: AC-2's single INSERT-denied
  // check and AC-7's blanket interactions_summary check were each replaced
  // by a pair that keeps the blanket claim for every kind other than
  // `single_input` and covers the dignity-floor carve-out positively (see
  // single_field_scoping.sql's own AC-2 comment), plus one arrange control
  // pinning the three fixture interaction rows into existence so the
  // remaining "sees zero" claims cannot pass vacuously. Net: -2, +6.
  it("runs every AC 1 / AC 2 / AC 3 / AC 4 / AC 5 / AC 6 / AC 7 / AC 8 check group", () => {
    expect(checks.length).toBe(51);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
