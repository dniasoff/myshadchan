import { it } from "vitest";

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
