import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DB_URL, bailIfDbUnreachable } from "./dbSuiteHelpers";

/**
 * Runs the child_grants resume_photos-read-across guard against the local
 * Supabase stack.
 *
 * The assertions live in child_grant_resume_photos_access.sql because they
 * can only be expressed by reading `public.resume_photos` as five different
 * callers — an unrelated household, a grantee through a pending and then the
 * accepted status, a sibling single inside the PROPOSER household, and
 * finally a single-role member inside the GRANTEE household — which no mock
 * reproduces: the grant, the RLS policy, current_context_id() and
 * current_member_role() all have to be simultaneously right for the positive
 * case to pass and for every negative case to stay closed.
 *
 * The sibling-leak assertion ((c) in the SQL) is the reason this increment
 * exists. THIS table already leaked a sibling's photo once (real incident):
 * the household policy "Resume photos scoped to account, single sees only
 * own shared" used to check visibility account-WIDE, so a `single`-role
 * caller could read ANY shared photo in the household, including a
 * sibling's. It was fixed by re-deriving `resumes`' own "is this resume
 * mine" join. Assertion (c) proves the NEW grant-consuming policy does not
 * reintroduce that exact bug mirrored onto the grantee axis: an accepted
 * grantee whose grant names only the granted single must still see zero rows
 * for a DIFFERENT single in the SAME proposer household — same account_id,
 * different single_id. A household-wide (account_id) widening would return
 * that sibling's photo, and this suite would fail.
 *
 * Needs a running stack (`make start`, or `make start-supabase-e2e STACK_ID=n`).
 * If the database is unreachable the suite reports a single skipped test rather
 * than failing the whole run, matching the other db suites.
 */

const SQL_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "child_grant_resume_photos_access.sql",
);

type Check = { name: string; passed: boolean; detail: string | null };

function isolatedScript(): string {
  return [
    "\\set ON_ERROR_STOP on",
    "begin;",
    "delete from public.account_members;",
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

describe("child_grants resume_photos read access (database)", () => {
  if (bailIfDbUnreachable(error)) return;

  // A vacuous run — the SQL erroring early and emitting a short report — must
  // fail here rather than look like a pass, which is the failure mode this
  // whole suite exists to catch one level down.
  it("runs the full set of checks", () => {
    expect(checks.length).toBe(7);
  });

  for (const check of checks) {
    it(check.name, () => {
      expect(check.passed, check.detail ?? "assertion returned false").toBe(
        true,
      );
    });
  }
});
