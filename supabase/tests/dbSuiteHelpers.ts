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
 * Patterns that only appear when psql could not reach a server at all — a
 * missing/stopped local stack — as opposed to a server that answered and
 * then reported a real error (a syntax error, a raised exception, an RLS
 * denial the suite's own `\set ON_ERROR_STOP on` turned into a non-zero
 * exit). Deliberately narrow: matching too broadly here is exactly the
 * defect this list exists to close (see bailIfDbUnreachable's own comment).
 */
const UNREACHABLE_PATTERNS: RegExp[] = [
  /could not connect to server/i,
  /connection to server .* failed/i,
  /connection refused/i,
  /econnrefused/i,
  /is the server running/i,
  /server closed the connection unexpectedly/i,
  /the database system is starting up/i,
  /timeout expired/i,
];

/**
 * Shared escape hatch for the database test suites (billing_entitlement,
 * references_entity, shidduch_catch, members_rename): each shells out to
 * `psql` against the local Supabase stack and, when it's unreachable, would
 * rather report one skipped test than fail outright during local
 * development. In CI that escape hatch must not fire — an unreachable
 * database has to fail loudly instead of silently skipping the RLS /
 * SECURITY DEFINER suite AD-1 leans on (see .claude rules / AC-9).
 *
 * Story 6.2 review fix: `error` used to gate the WHOLE decision on "is this
 * string non-empty", not on what it says. Node's execFileSync appends the
 * child's real stderr to `error.message` on ANY non-zero exit — a missing
 * stack and a genuine SQL regression inside the suite (a mutated policy that
 * now lets something through un-denied, a typo, a raised exception) both
 * produce a non-empty `error`, and only the first is "unreachable". Gating
 * on presence alone meant a real regression skipped silently in local dev
 * (reported as one green-ish "skipped" test) and only failed in CI — a
 * developer running the suite locally after breaking something would see
 * green. Now: only a message matching UNREACHABLE_PATTERNS above is treated
 * as "no local stack"; every other error throws unconditionally, dev or CI,
 * because it means the server answered and the suite itself failed.
 *
 * Returns true when the caller's `describe()` block should return early
 * (the local-dev skip was registered); throws instead for a genuine suite
 * failure (always) or an unreachable stack in CI.
 */
export function bailIfDbUnreachable(error: string | undefined): boolean {
  if (!error) return false;

  const firstLine = error.split("\n")[0];
  const isUnreachable = UNREACHABLE_PATTERNS.some((pattern) =>
    pattern.test(error),
  );

  if (!isUnreachable) {
    throw new Error(
      `Database suite failed (not a missing local stack — see the full error): ${firstLine}`,
    );
  }

  if (process.env.CI) {
    throw new Error(`Local Supabase unreachable in CI: ${firstLine}`);
  }

  it.skip(`skipped — local Supabase unreachable: ${firstLine}`, () => {});
  return true;
}

/**
 * Fixed identifiers for the "two siblings, one household" fixture below —
 * not parameterised, because every suite in this directory runs its own
 * script inside a single `begin; ... rollback;` transaction (the universal
 * shape here — see `references_entity.sql` et al.), so no two suites, and no
 * two runs of the same suite, ever see these rows at the same time. A fixed,
 * memorable literal is also easier to read back out of a failed assertion's
 * `detail` column than a freshly generated one would be.
 */
export const SIBLING_FIXTURE = {
  parentUserId: "51810000-0000-0000-0000-000000000001",
  leahUserId: "51810000-0000-0000-0000-000000000002",
  rivkaUserId: "51810000-0000-0000-0000-000000000003",
  accountName: "Sibling Fixture Household",
} as const;

/**
 * The "two siblings, one household" fixture shared across Epic 6's
 * single-access suites (Story 6.2, `single_row_scoping.sql`, is the first
 * caller; 6.1's real-invite flow, 6.3's field-level scoping, 6.4's single
 * input and 6.5's parity guard all build directly on top of the SAME two
 * logins and two `singles` rows rather than each hand-rolling a slightly
 * different copy that could silently drift from this one — deciding the
 * shape once, here, is the point).
 *
 * Produces one `household`-kind account, one `parent_admin` member, and two
 * `single`-role members ("Leah" and "Rivka" — named for readable failure
 * output, never used as a matching signal), each linked via `member_id` to
 * its own `singles` row. `activate_first_context_trigger` (04_triggers.sql)
 * fires on each of the three `account_members` inserts below and activates
 * that login's context automatically — no caller needs to call
 * `set_active_context()` itself before switching identity with `set local
 * request.jwt.claims`.
 *
 * Returned as raw SQL text, meant to be spliced into a suite's own script
 * BEFORE its `\i <suite>.sql` (see `single_row_scoping.test.ts`'s
 * `isolatedScript()`), never as a file some other `.sql` suite tries to
 * `\i` directly — psql has no notion of importing a TypeScript module. The
 * `delete from public.account_members` here is the same defensive clear
 * every suite in this directory already does before seeding its own rows
 * (a long-running local dev stack can hold real, manually-created
 * membership rows that a fresh migration/seed pass never touches); it runs
 * AFTER the `auth.users` inserts, not before, in case any of them ever grows
 * a login-time trigger that touches this table.
 *
 * `\gset` variables it leaves set for the caller's own script:
 * `sibling_fixture_account_id`, `sibling_fixture_parent_member_id`,
 * `sibling_fixture_leah_member_id`, `sibling_fixture_rivka_member_id`,
 * `sibling_fixture_leah_single_id`, `sibling_fixture_rivka_single_id`.
 */
export function siblingHouseholdFixtureSql(): string {
  const { parentUserId, leahUserId, rivkaUserId, accountName } =
    SIBLING_FIXTURE;

  return `
-- ---------------------------------------------------------------------------
-- Shared fixture (dbSuiteHelpers.ts, siblingHouseholdFixtureSql): one
-- household, one parent_admin, two single-role siblings each linked to their
-- own singles row.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values
  ('${parentUserId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sibling-fixture-parent@test.local'),
  ('${leahUserId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sibling-fixture-leah@test.local'),
  ('${rivkaUserId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sibling-fixture-rivka@test.local');

delete from public.account_members;

insert into public.accounts (name, kind) values ('${accountName}', 'household')
returning id as sibling_fixture_account_id \\gset

insert into public.account_members (account_id, user_id, role, status)
values (:sibling_fixture_account_id, '${parentUserId}', 'parent_admin', 'active')
returning id as sibling_fixture_parent_member_id \\gset

insert into public.account_members (account_id, user_id, role, status)
values (:sibling_fixture_account_id, '${leahUserId}', 'single', 'active')
returning id as sibling_fixture_leah_member_id \\gset

insert into public.account_members (account_id, user_id, role, status)
values (:sibling_fixture_account_id, '${rivkaUserId}', 'single', 'active')
returning id as sibling_fixture_rivka_member_id \\gset

insert into public.singles (account_id, first_name_en, gender, member_id)
values (:sibling_fixture_account_id, 'Leah', 'female', :sibling_fixture_leah_member_id)
returning id as sibling_fixture_leah_single_id \\gset

insert into public.singles (account_id, first_name_en, gender, member_id)
values (:sibling_fixture_account_id, 'Rivka', 'female', :sibling_fixture_rivka_member_id)
returning id as sibling_fixture_rivka_single_id \\gset
`;
}
