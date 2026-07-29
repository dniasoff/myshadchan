import { it } from "vitest";

import { dbUrlFromEnv } from "../../scripts/stack-env.mjs";

/**
 * The database every suite in this directory shells `psql` out to.
 *
 * It used to be a literal repeated in all eight suites
 * (`process.env.SUPABASE_DB_URL ?? "postgresql://…:54322/postgres"`), which
 * made the whole directory a host-global singleton: two agents running
 * `npm run test:unit:db` on the same checkout drove the same database, and
 * these suites `delete from public.account_members` inside their transactions.
 *
 * `dbUrlFromEnv` keeps that exact behaviour when `STACK_ID` is unset, and
 * points at the agent's own stack when it is set — where STACK_ID outranks an
 * inherited `SUPABASE_DB_URL`, so a leaked env var cannot re-point one agent's
 * psql at another agent's database. See scripts/stack-env.mjs.
 */
export const DB_URL: string = dbUrlFromEnv();

/**
 * Shared escape hatch for the database test suites (billing_entitlement,
 * references_entity, shidduch_catch, members_rename): each shells out to
 * `psql` against the local Supabase stack and, when it's unreachable, would
 * rather report one skipped test than fail outright during local
 * development. In CI that escape hatch must not fire — an unreachable
 * database has to fail loudly instead of silently skipping the RLS /
 * SECURITY DEFINER suite AD-1 leans on (see .claude rules / AC-9).
 *
 * Returns true when the caller's `describe()` block should return early
 * (the local-dev skip was registered); throws instead when `CI` is set.
 */
export function bailIfDbUnreachable(error: string | undefined): boolean {
  if (!error) return false;

  const firstLine = error.split("\n")[0];

  if (process.env.CI) {
    throw new Error(`Local Supabase unreachable in CI: ${firstLine}`);
  }

  it.skip(`skipped — local Supabase unreachable: ${firstLine}`, () => {});
  return true;
}
