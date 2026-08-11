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

/**
 * Fixed identifiers for Story 6.5's parity fixture
 * (`self_manager_parity.sql`) — two SEPARATE fresh households (never
 * siblings under one parent, unlike `SIBLING_FIXTURE` above): household S
 * (a self-manager, provisioned via the real `add_persona('single')` RPC as a
 * user with no existing membership at all — AC-2's own arrangement
 * requirement) and household P (a `parent_admin`, provisioned via
 * `add_persona('parent')` the same way, then given a managed `singles` row
 * with no login of its own — the ordinary "child with no account"
 * shape used throughout this directory, e.g. `medical_notes.sql`,
 * `resume_single_owner.sql`). A different literal prefix (`5182…`) than
 * `SIBLING_FIXTURE`'s `5181…` is not load-bearing (every suite here runs in
 * its own rolled-back transaction) — it just keeps the two fixtures visually
 * distinct in a failed assertion's `detail` column.
 */
export const PARITY_FIXTURE = {
  selfManagerUserId: "51820000-0000-0000-0000-000000000001",
  parentUserId: "51820000-0000-0000-0000-000000000002",
} as const;

/** The one piece of information `ownerHouseholdFixtureSql`/
 * `householdFixtureDataSql` need per household: which persona to provision
 * and which fixed user id (`PARITY_FIXTURE`) that provisioning runs as. */
type ParityHousehold = "s" | "p";

const PARITY_HOUSEHOLD_PERSONA: Record<ParityHousehold, "single" | "parent"> = {
  s: "single",
  p: "parent",
};

const PARITY_HOUSEHOLD_USER_ID: Record<ParityHousehold, string> = {
  s: PARITY_FIXTURE.selfManagerUserId,
  p: PARITY_FIXTURE.parentUserId,
};

/**
 * Provisions ONE of Story 6.5's two comparative households by calling the
 * REAL `add_persona()` RPC as a fresh, otherwise-unaffiliated user —
 * `household` is `"s"` for the self-manager (calls `add_persona('single')`)
 * or `"p"` for the parent (calls `add_persona('parent')`). This is the
 * "same code, seeded twice" the story's Task 2 requires: both households run
 * through this one function, differing only in which persona string and
 * which fixed user id (`PARITY_FIXTURE`) get passed in — there is no
 * household-specific branch a future edit could accidentally desync.
 *
 * `add_persona('single')` on a membership-less caller inserts the account,
 * the `account_members` row (`role = 'self_manager'`) AND the linked
 * `singles` row in one transaction (02_functions.sql, verified by Story
 * 6.5's Task 1) — household S needs nothing further. `add_persona('parent')`
 * only ever provisions the account + `parent_admin` membership; it never
 * attaches a `singles` row (that is Story 6.1's invite flow, out of scope
 * here), so household P gets one manually, `member_id` left NULL — the
 * ordinary "a household member with no login of their own" shape this
 * directory already uses elsewhere.
 *
 * Leaves `\gset` variables `<household>_member_id`, `<household>_account_id`
 * and `<household>_single_id` set for the caller's own script — the exact
 * inputs `householdFixtureDataSql()` below expects.
 *
 * Ends by clearing `request.jwt.claims` back to `{}` (`reset role` alone
 * reverts the ROLE but leaves that GUC's `set local` value in place for the
 * rest of the transaction) — so `householdFixtureDataSql()`'s own postgres-run
 * inserts see `auth.uid()` resolve to NULL, exactly like every OTHER suite's
 * "as postgres" arrange phase in this directory, rather than incidentally
 * inheriting this function's just-provisioned user as an authorship signal.
 */
export function ownerHouseholdFixtureSql(household: ParityHousehold): string {
  const persona = PARITY_HOUSEHOLD_PERSONA[household];
  const userId = PARITY_HOUSEHOLD_USER_ID[household];
  const email = `story65-household-${household}@test.local`;

  const attachManagedSingle =
    persona === "parent"
      ? `
-- Household P's managed single: an ordinary member-less \`singles\` row
-- (the "child with no login" shape), attached AFTER add_persona('parent')
-- rather than through it — add_persona() never creates one for the parent
-- branch (Task 1).
insert into public.singles (account_id, first_name_en, gender)
values (:${household}_account_id, 'Household P Managed Single', 'female')
returning id as ${household}_single_id \\gset
`
      : `
-- Household S: the singles row add_persona('single') already created,
-- linked by member_id — looked up, never re-inserted, so this stays a pure
-- READ of what the RPC produced (AC-2's own atomicity claim).
select s.id as ${household}_single_id
from public.singles s
where s.member_id = :${household}_member_id
\\gset
`;

  return `
-- ---------------------------------------------------------------------------
-- Household ${household.toUpperCase()} (dbSuiteHelpers.ts, ownerHouseholdFixtureSql):
-- provisioned via the REAL add_persona('${persona}') RPC as a fresh user
-- with NO existing membership at all.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email)
values ('${userId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';

select public.add_persona('${persona}');

reset role;
set local request.jwt.claims = '{}';

select am.id as ${household}_member_id, am.account_id as ${household}_account_id
from public.account_members am
where am.user_id = '${userId}' and am.status = 'active'
\\gset
${attachManagedSingle}`;
}

/**
 * Seeds ONE household (already provisioned by `ownerHouseholdFixtureSql`
 * above) with the exact data shape `single_row_scoping.sql` /
 * `single_field_scoping.sql` use for their own single-role fixtures — every
 * table Story 6.5's AC-3 names, plus the four storage keys AC-3 also names.
 * Called once per household (`"s"` then `"p"`) with the SAME literal SQL,
 * substituting only the `<household>_account_id`/`<household>_single_id`
 * variables `ownerHouseholdFixtureSql` left set — the "seeded by the same
 * code" guarantee Story 6.5's Task 2 requires, so household S and household
 * P cannot silently drift apart in shape.
 *
 * Includes one `kind = 'note'` row and one `kind = 'single_input'` row,
 * both inserted directly (bypassing RLS, as postgres/superuser, `auth.uid()`
 * NULL) rather than through any client path — `single_input` has exactly one
 * INSERT policy and it requires `current_member_role() = 'single'`, a role
 * neither a self-manager nor a parent_admin ever holds, so there is no
 * real-world route for either of them to author one. `actor_member_id` on
 * both rows is therefore NULL, a permanently legal state
 * (`can_moderate_note()`'s own Dev Notes, 02_functions.sql). Neither
 * assertion this fixture feeds needs an author: the single_input row exists
 * purely so the write-parity assertion (Story 6.4 AC-3: append-only, denies
 * EVERY role) has something to attempt updating, and the `note` row here is
 * a pure read-count fixture item, DISTINCT from the write-parity suite's own
 * LIVE insert-then-moderate-as-author check in self_manager_parity.sql
 * (`can_moderate_note()`'s AUTHOR branch needs a real, freshly-authored row,
 * not this one).
 *
 * Review fix: also seeds a SECOND, member-less `singles` row and a SECOND,
 * login-less `account_members` row per household. Without these, each
 * household held exactly one row in both tables, so "self_manager sees
 * every row" and "self_manager sees only their own row" produced the
 * IDENTICAL count (1) — equality could tell "all" from "none" but never
 * "all" from "the subset a Story 6.2-shaped narrowing would leave". Mutating
 * `public.singles`/`public.account_members` to add
 * `and (current_member_role() <> 'self_manager' or <own-row clause>)`
 * previously passed this suite's AC1/AC3/AC5 loop 44/44 green; with the
 * second row on each side, that narrowing now reads 1 (own row) against the
 * parent_admin's un-narrowed 2 and fails loudly. Both households get the
 * SAME shape (a second row each), so the un-mutated baseline stays
 * parity-equal (2 == 2) — only a real narrowing regression makes the two
 * sides diverge.
 */
export function householdFixtureDataSql(household: ParityHousehold): string {
  const h = household;
  const ownerUserId = PARITY_HOUSEHOLD_USER_ID[household];

  return `
-- ---------------------------------------------------------------------------
-- Household ${h.toUpperCase()} data (dbSuiteHelpers.ts, householdFixtureDataSql):
-- same shape as single_row_scoping.sql / single_field_scoping.sql's own
-- single-role fixtures, run once per household with an identical script.
-- ---------------------------------------------------------------------------
insert into public.shadchanim (account_id, name)
values (:${h}_account_id, 'Household ${h.toUpperCase()} Shadchan')
returning id as ${h}_shadchan_id \\gset

insert into public.shidduchim (account_id, single_id, shadchan_id, name_en, visibility, pipeline_state, close_reason)
values (
  :${h}_account_id, :${h}_single_id, :${h}_shadchan_id,
  'Household ${h.toUpperCase()} Visible Suggestion', 'shared', 'look_into',
  'Household ${h.toUpperCase()} candid decision rationale'
)
returning id as ${h}_visible_id \\gset

insert into public.shidduchim (account_id, single_id, name_en, visibility, pipeline_state)
values (:${h}_account_id, :${h}_single_id, 'Household ${h.toUpperCase()} New Suggestion', 'shared', 'new')
returning id as ${h}_new_id \\gset

insert into public.resumes (account_id, shidduchim_id)
values (:${h}_account_id, :${h}_visible_id)
returning id as ${h}_resume_id \\gset

insert into public.shidduch_education (account_id, shidduchim_id, kind, name_en)
values (:${h}_account_id, :${h}_visible_id, 'seminary', 'Household ${h.toUpperCase()} Seminary')
returning id as ${h}_education_id \\gset

insert into public.resume_photos (account_id, resume_id, path, visibility)
values (
  :${h}_account_id, :${h}_resume_id,
  :'${h}_account_id' || '/photos/shared/' || :'${h}_visible_id' || '/photo.jpg', 'shared'
)
returning id as ${h}_photo_id \\gset

insert into public."references" (account_id, name_en)
values (:${h}_account_id, 'Household ${h.toUpperCase()} Reference')
returning id as ${h}_reference_id \\gset

insert into public.reference_links (account_id, reference_id, shidduchim_id, call_status, what_they_said)
values (:${h}_account_id, :${h}_reference_id, :${h}_visible_id, 'answered', 'Household ${h.toUpperCase()} candid call content')
returning id as ${h}_reference_link_id \\gset

insert into public.entity_files (account_id, target_type, target_id, storage_path, file_name, mime_type, size_bytes)
values (
  :${h}_account_id, 'shidduch', :${h}_visible_id,
  :'${h}_account_id' || '/shidduch/' || :'${h}_visible_id' || '/diligence.pdf',
  'diligence.pdf', 'application/pdf', 1024
)
returning id as ${h}_entity_file_id \\gset

insert into public.shidduchim_external_links (account_id, shidduchim_id, url, label)
values (:${h}_account_id, :${h}_visible_id, 'https://example.test/household-${h}-diligence', 'Household ${h.toUpperCase()} link')
returning id as ${h}_external_link_id \\gset

insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
values (:${h}_account_id, 'shidduch', :${h}_visible_id, 'shidduch', 'note', 'Household ${h.toUpperCase()} candid note')
returning id as ${h}_note_id \\gset

-- Seeded directly (bypassing RLS, actor_member_id NULL): see this
-- function's own doc comment on why no client path can author this row for
-- either role, and why NULL is fine for what this row is used to assert.
insert into public.interactions (account_id, target_type, target_id, scope, kind, body)
values (:${h}_account_id, 'shidduch', :${h}_visible_id, 'shidduch', 'single_input', 'Household ${h.toUpperCase()} single_input row (seeded directly)')
returning id as ${h}_single_input_id \\gset

insert into public.tasks (account_id, target_type, target_id, text)
values (:${h}_account_id, 'shidduch', :${h}_visible_id, 'Household ${h.toUpperCase()} follow up')
returning id as ${h}_task_id \\gset

insert into public.invites (account_id, email, role)
values (:${h}_account_id, 'household-${h}-zero-row-invite@test.local', 'helper')
returning id as ${h}_invite_id \\gset

insert into public.date_records (account_id, single_id, person_name_en, outcome)
values (:${h}_account_id, :${h}_single_id, 'Household ${h.toUpperCase()} Prior Date', 'ended')
returning id as ${h}_date_record_id \\gset

insert into public.redts (account_id, shidduchim_id, note)
values (:${h}_account_id, :${h}_visible_id, 'Household ${h.toUpperCase()} redt note')
returning id as ${h}_redt_id \\gset

insert into public.inbox_items (account_id)
values (:${h}_account_id)
returning id as ${h}_inbox_item_id \\gset

insert into public.subscription (account_id)
values (:${h}_account_id)
returning id as ${h}_subscription_id \\gset

insert into public.ai_usage (account_id, period)
values (:${h}_account_id, '2026-07')
returning id as ${h}_ai_usage_id \\gset

insert into public.medical_notes (account_id, shidduchim_id, body)
values (:${h}_account_id, :${h}_visible_id, 'Household ${h.toUpperCase()} candid medical content')
returning id as ${h}_medical_note_id \\gset

insert into storage.objects (bucket_id, name, owner)
values (
  'entity-files',
  :'${h}_account_id' || '/shidduch/' || :'${h}_visible_id' || '/diligence-storage.pdf',
  '${ownerUserId}'
)
returning id as ${h}_entity_files_object_id \\gset

insert into storage.objects (bucket_id, name, owner)
values (
  'documents',
  :'${h}_account_id' || '/resumes/' || :'${h}_visible_id' || '/resume.pdf',
  '${ownerUserId}'
)
returning id as ${h}_resumes_object_id \\gset

insert into storage.objects (bucket_id, name, owner)
values (
  'documents',
  :'${h}_account_id' || '/photos/shared/' || :'${h}_visible_id' || '/shared.jpg',
  '${ownerUserId}'
)
returning id as ${h}_shared_photo_object_id \\gset

insert into storage.objects (bucket_id, name, owner)
values (
  'documents',
  :'${h}_account_id' || '/photos/private_parent/' || :'${h}_visible_id' || '/private.jpg',
  '${ownerUserId}'
)
returning id as ${h}_private_photo_object_id \\gset

-- Review fix: a second, member-less singles row and a second, login-less
-- account_members row — see this function's own doc comment above for why
-- a single row per table left "full access" and "own-row-only" arithmetically
-- indistinguishable. Neither row is referenced by any other insert in this
-- function or by self_manager_parity.sql's write-parity/invite-authority
-- blocks — they exist purely to be counted.
insert into public.singles (account_id, first_name_en, gender)
values (:${h}_account_id, 'Household ${h.toUpperCase()} Second Single (member-less)', 'female')
returning id as ${h}_second_single_id \\gset

insert into public.account_members (account_id, role, status)
values (:${h}_account_id, 'helper', 'active')
returning id as ${h}_second_member_id \\gset
`;
}
