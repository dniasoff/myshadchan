# Story 7.2: Open-by-default visibility

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a family,
I want new conversations visible to everyone in my household by default,
so that transparency is the norm rather than something anyone has to ask for (FR96, FR99).

## Position in Epic 7

**2nd of 5. Depends on 7.1** (`threads`, `create_thread()`, `thread_is_readable()` must
already exist). Precedes 7.3 (privacy enforcement), 7.4 (the connection axis becoming
reachable) and 7.5 (notifications).

This story does two small, precise things: it makes the *default* posture a per-account
setting instead of a hardcoded literal, and it proves the shipped default is `open`. It does
**not** touch enforcement of `'private'` — that is 7.3.

**Scope boundary with 7.4.** 7.1 ships `threads` dual-axis but `create_thread()` has no
`p_connection_id` parameter, so every thread this story can observe is account-scoped. The
default-posture resolution for a **connection-scoped** thread (which must read the
connection's `household_account_id`, because FR99 gives the *family* the posture and the
household is the only family in the pair) belongs to **7.4**, in the same diff that adds the
parameter. Do not pre-emptively write it here against a code path nothing can reach.

### Already in the tree (verified against `main` @ `11904a1`)

- `public.accounts` is at `supabase/schemas/01_tables.sql:162-190`. Its columns, in physical
  order, end `… demo, kind` — `kind` was appended by Story 2.2 and sits at the **tail**.
- `accounts.transparency_level` (`:166`, `not null default 'shared'`) is still **dormant**:
  the only references in the tree are the column declaration, the column grant
  (`06_grants.sql:835`), the TS field (`types.ts:162`), and six FakeRest seed/fixture sites.
  No function, view or RLS policy reads it. See Dev Notes.
- The `accounts` write policy is `"Accounts writable by non-single members"`
  (`05_policies.sql:129-…`) — Story 6.2 already excludes the `single` role from every
  account write. The column-grant line is
  `grant update (name, transparency_level, data_region) on public.accounts to authenticated;`
  at `06_grants.sql:835`, immediately after a table-level `revoke update`.
- Settings renders **two** section lists that must both be edited:
  `settings/SettingsPage.tsx:60-73` and `settings/SettingsPageMobile.tsx:56-62`. Existing
  sections: `ProfileSection`, `FamilySection`, `PersonasSection`, `InvitesSection`,
  `PreferencesSection`, `PrivacySection` (+ a local `BillingSection` on mobile).
- `Account` in `src/components/atomic-crm/types.ts:160-170`.

## Acceptance Criteria

1. **A household can set its own default posture.** `public.accounts` carries
   `default_thread_visibility` ∈ `('open', 'private')`, `not null default 'open'`. It is a
   genuinely new column — not a reuse of `accounts.transparency_level` (see Dev Notes "Do
   not reuse `transparency_level`").

2. **The shipped default is open.** A newly created account has
   `default_thread_visibility = 'open'` (column default), **and every account that already
   existed before this migration has it too** — an `ADD COLUMN … NOT NULL DEFAULT 'open'`
   backfills every existing row in the same statement, which is what makes this migration
   safe under the rule that broke `member_state`. **Falsifiable:** immediately after
   `supabase migration up --local` against the production-shaped fixture,
   `select count(*) from public.accounts where default_thread_visibility is distinct from
   'open'` is `0`.

3. **`create_thread()` resolves the default from the account, not a literal.** Calling
   `create_thread()` with `p_visibility` omitted (`null`) sets the new thread's `visibility`
   to the caller's active account's `default_thread_visibility`. Changing the account
   setting changes what *new* threads get and never rewrites existing threads — no backfill,
   no retroactive change. It is a setting, not a migration.

4. **An explicit argument always wins.** `create_thread(p_visibility => 'open')` on an
   account set to `'private'` yields an `open` thread, and the reverse. The account default
   is a default, never a ceiling and never a floor.

5. **A member can change the posture from Settings**, on both the desktop and mobile
   settings surfaces, and the change is visible immediately in the create-thread flow (no
   staleness beyond normal React Query invalidation). A `single`-role member cannot: the
   shipped `"Accounts writable by non-single members"` policy already denies every account
   write to that role, so the control must not render for them either — an enabled control
   whose save always fails is a worse outcome than an absent one.

6. **Verification — the toolchain is green.** `make typecheck`, `npm run lint`, `make test`
   pass repo-wide with zero new warnings; `npm run test:unit:db` passes, including, appended
   to `supabase/tests/threads_entity.sql`: (a) a fresh account defaults to `'open'`;
   (b) flipping the account to `'private'` then calling `create_thread()` with no
   `p_visibility` yields a `'private'` thread; (c) an explicit `p_visibility` wins over the
   account default, asserted on **both** settings; (d) a `single`-role member's UPDATE of
   `default_thread_visibility` affects zero rows. `make check-migration-safety` passes —
   `accounts` is already seeded and captured by the fixture
   (`supabase/tests/migration-data-safety/fixture.sql:210,488`), so this column add is
   genuinely covered without extending it.

## Tasks / Subtasks

- [x] **Task 1 — Schema: the new column** (AC: 1, 2)
  - [x] `supabase/schemas/01_tables.sql`: add `default_thread_visibility text not null
        default 'open'` to `public.accounts` — **at the tail of the `create table` block,
        after `kind`**, not "next to `transparency_level`". `alter table … add column`
        always appends to the physical tail; declaring it mid-table puts this file out of
        step with `pg_attribute` and, per the COLUMN-ORDER TRAP at `01_tables.sql:1-60`,
        makes `db diff` emit a permanent, non-convergent set of view drops that silently
        strip `security_invoker` and grants. Add
        `accounts_default_thread_visibility_check check (default_thread_visibility in
        ('open','private'))` after the existing `accounts_kind_check`.
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        account_default_thread_visibility`. Hand-check the output is exactly one
        `ALTER TABLE public.accounts ADD COLUMN …` plus one `ADD CONSTRAINT …` — **not** a
        drop/recreate, and **not** accompanied by any `drop view` (a view drop is the
        column-order symptom, not a normal artefact; if you see one, the column went in the
        wrong place — fix `01_tables.sql`, delete the generated migration, and re-diff).
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`, then
        `db diff` twice more to prove convergence.
  - [x] `make check-migration-safety`.

- [x] **Task 2 — Grants** (AC: 5)
  - [x] `supabase/schemas/06_grants.sql:835`: extend the existing column list to
        `grant update (name, transparency_level, data_region, default_thread_visibility) on
        public.accounts to authenticated;`. A column-level *revoke* cannot subtract from a
        table-level grant, which is why this file revokes table UPDATE and re-grants
        column-by-column — keep that idiom intact and do not add a table-level grant.
  - [x] Do **not** invent new role-gating. The shipped `accounts` policies already handle it
        (Dev Notes "Who may change the default posture"), and `name`/`transparency_level`
        set the precedent for this column list.

- [x] **Task 3 — `create_thread()` reads the account default** (AC: 3, 4)
  - [x] `supabase/schemas/02_functions.sql`: change the one expression in `create_thread()`
        (added by 7.1) from `coalesce(p_visibility, 'open')` to
        `coalesce(p_visibility, (select a.default_thread_visibility from public.accounts a
        where a.id = v_account_id))`. `CREATE OR REPLACE FUNCTION`, same signature, in exact
        `pg_dump` form (contract §8 rule 6) — no caller changes.
  - [x] Keep 7.1's `p_visibility in ('open','private')` validation ahead of the coalesce, so
        an invalid explicit argument still raises rather than falling through to the
        default.
  - [x] Hand-check the generated migration actually contains the `CREATE OR REPLACE
        FUNCTION` — a `plpgsql` body change with an unchanged signature is sometimes missed
        by `db diff`. If the generated file is empty, write the statement into it by hand.

- [x] **Task 4 — Types and fixtures** (AC: 1, 5)
  - [x] `src/components/atomic-crm/types.ts`: add `default_thread_visibility:
        ThreadVisibility;` to `Account` (`:160-170`; `ThreadVisibility` is 7.1's type in the
        same file).
  - [x] **Adding a required field to `Account` breaks every site that constructs one.** Six
        files build `Account` literals today and all six must gain the field:
        `providers/fakerest/dataGenerator/shidduchim.ts:257`,
        `providers/fakerest/internal/personas.ts:156,240`,
        `providers/fakerest/internal/contexts.test.ts:62`,
        `providers/fakerest/internal/personas.test.ts:101`,
        `providers/fakerest/internal/invites.test.ts:99`,
        `providers/fakerest/internal/removePersona.test.ts:98`. Seed `"open"`, mirroring how
        `transparency_level: "shared"` is already seeded beside each of them. `make
        typecheck` is what catches a missed one — run it before assuming the list is
        complete.
  - [x] `providers/fakerest/dataProvider.ts`: the FakeRest `createThread` emulation (7.1)
        resolves the default from `db.accounts` the same way, so AC-3/AC-4 hold in the demo
        build too (AD-10).

- [x] **Task 5 — Settings UI** (AC: 5)
  - [x] New file `src/components/atomic-crm/settings/CommunicationSection.tsx`. Do **not**
        grow `PrivacySection.tsx` or `FamilySection.tsx` — this is a distinct concern from
        either, per `.claude/rules/coding-style.md`'s "grow the file count, not the file".
        An open/private radio bound to `accounts.default_thread_visibility` through a plain
        `dataProvider.update("accounts", …)` (no RPC — it is a column write, grant-covered
        by Task 2).
  - [x] Gate rendering on `useViewerRole()` (`entity360/useViewerRole.ts`) — hide the
        section for `role === "single"`, and render nothing while `isPending` rather than
        rendering an enabled control that fails on save (AC-5). Use `hasVisibility` /
        `useViewerRole` as shipped; do not re-derive a role from `members.administrator`.
  - [x] Wire it into **both** section lists: `settings/SettingsPage.tsx:60-73` and
        `settings/SettingsPageMobile.tsx:56-62`. They render their sections independently;
        editing one is the standard way this repo half-ships a settings control.
  - [x] All copy through the `i18nProvider` under `crm.settings.communication.*`, added to
        **both** `providers/commons/englishCrmMessages.ts` and `frenchCrmMessages.ts` — the
        French catalogue is genuinely translated (see `:379-396`), not an English mirror, so
        supply real French strings.

- [x] **Task 6 — Tests** (AC: 6)
  - [x] Extend `supabase/tests/threads_entity.sql` (created by 7.1) — do not create a second
        SQL test file. Append one assertion row per AC-6(a)-(d). **No
        `exception when others then … PASS`**: AC-6(d)'s zero-row outcome is asserted by row
        count in the `db` project via psql, since "zero rows affected" is not observable
        through PostgREST (contract §13 rule 4).
  - [x] Vitest (browser mode, `vitest-browser-react` + `TestMemoryRouter`; RTL is not a
        dependency) for `CommunicationSection`: renders for `parent_admin`, does not render
        for `single`, renders nothing while the role is pending, and a change issues the
        expected update. AAA, ≥80% of new lines.
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus prettier
        on this story's changed files only.

## Dev Notes

### Do not reuse `transparency_level`

`public.accounts.transparency_level` exists (`01_tables.sql:166`, `default 'shared'`) and is
**still dormant** after six epics: `grep -rn transparency_level supabase/schemas/ src/` finds
only the column declaration, its grant (`06_grants.sql:835`), the TS field (`types.ts:162`)
and six FakeRest seed sites — no function, view or policy reads it. It is reserved for a
different concern: AD-3's per-account transparency posture for **shidduch** visibility to a
single, whose vocabulary is `ShidduchVisibility` (`shared | private_parent | private_single`,
`types.ts:149`) — a three-value union that does not match a thread's two. Epic 6 shipped the
single's row and field scoping without consuming it, so it remains live scope for a later
story. Repurposing it here would collide with that and would force a two-vocabulary column.
This story adds its own column with its own two-value vocabulary, matching
`threads.visibility` exactly.

### Who may change the default posture

`epics.md`'s AC says only "the family may set a different default posture" — not *which*
member. Two shipped facts settle it without inventing new RBAC:

1. `"Accounts writable by non-single members"` (`05_policies.sql:129`) already denies every
   `accounts` write to the `single` role (Story 6.2, AC 5).
2. `name` and `transparency_level` are already updatable by any other authenticated member
   of the account (`06_grants.sql:835`).

So: every role except `single`, by extending the existing column list. If the product later
wants this `parent_admin`-only, that is a correct-course with its own review surface, not a
gap in this story — and it would belong on the *grant*, not on a client-side check.

### Why no backfill step is needed, and why AC-2 asserts it anyway

`ADD COLUMN … NOT NULL DEFAULT 'open'` writes the default into every existing row as part of
the same statement — the failure mode that blanked `member_state` in production was a
migration that added a *fail-closed mechanism* without backfilling rows already in the table,
not a defaulted column add. AC-2 asserts the outcome rather than trusting the reasoning,
because that is the cheaper of the two ways to find out.

### References

- [Source: `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-22`]
  — "Default is open (FR96); … a family may set the default posture; the shipped default is
  open (FR99)."
- [Source: `_bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md#A2.4`]
  — FR96, FR99 verbatim.
- [Source: `_bmad-output/planning-artifacts/epics.md#Epic-7-Communication`, Story 7.2]
- [Source: `_bmad-output/planning-artifacts/epic3-api-contract.md` §13 rules 1, 4, 5] —
  browser-mode vitest; zero-rows-affected is asserted in the `db` project, not through
  PostgREST; ≥80% coverage.
- `supabase/schemas/01_tables.sql:1-60` (COLUMN-ORDER TRAP — the reason Task 1 appends),
  `:162-190` (`accounts`, `kind` at the tail).
- `supabase/schemas/05_policies.sql:110-140` (the two `accounts` policies, incl. the
  non-single write gate).
- `supabase/schemas/06_grants.sql:820-835` (the revoke-then-column-grant idiom this story
  extends, with its own comment explaining why a column-level revoke would be a no-op).
- `supabase/tests/migration-data-safety/fixture.sql:210,488` (`accounts` already seeded and
  captured).
- `src/components/atomic-crm/types.ts:149` (`ShidduchVisibility`), `:160-170` (`Account`).
- `src/components/atomic-crm/settings/SettingsPage.tsx:60-73`,
  `settings/SettingsPageMobile.tsx:56-62`.
- `src/components/atomic-crm/entity360/useViewerRole.ts`, `entity360/visibility.ts`.
- Story `7-1-thread-model.md` — `create_thread()`'s one-expression change point, and the
  `threads_entity.sql` suite this story appends to.

## Dependencies

- **7.1** (blocking): `threads`, `create_thread()`, `ThreadVisibility`, `threads_entity.sql`.
- **Blocks nothing structurally**, but 7.4 extends this story's resolution to the connection
  axis and 7.5's `CommunicationSection.tsx` is created here — 7.5 adds its push opt-in to the
  same file, so **7.2 and 7.5 must not share a wave**.
- **Deploy coupling:** ships with 7.1 and 7.3 (7.1's Dev Notes — `private` is not enforced
  until 7.3).

## Declared file set

**Schema / DB**
`supabase/schemas/01_tables.sql`, `02_functions.sql`, `06_grants.sql`, one new
`supabase/migrations/<ts>_account_default_thread_visibility.sql`,
`supabase/tests/threads_entity.sql`.

**Types / providers / i18n**
`src/components/atomic-crm/types.ts`,
`providers/fakerest/dataProvider.ts`,
`providers/fakerest/dataGenerator/shidduchim.ts`,
`providers/fakerest/internal/personas.ts`,
`providers/fakerest/internal/contexts.test.ts`,
`providers/fakerest/internal/personas.test.ts`,
`providers/fakerest/internal/invites.test.ts`,
`providers/fakerest/internal/removePersona.test.ts`,
`providers/commons/englishCrmMessages.ts`, `providers/commons/frenchCrmMessages.ts`.

**UI**
`src/components/atomic-crm/settings/CommunicationSection.tsx` (+ `.test.tsx`),
`settings/SettingsPage.tsx`, `settings/SettingsPageMobile.tsx`.

**Generated**
`registry.json` (pre-commit `make registry-gen`).

No `types.ts` `MemberRole` change, no `TabKey` change, no descriptor change, no
`CANONICAL_TAB_SETS` change — this story adds no tab.

## Dev Agent Record

### Agent Model Used

Claude (bmad-dev-story workflow), STACK_ID=2 / STACK_OWNER=7-2.

### Debug Log References

- A prior agent session left the full story implementation in the working tree
  (uncommitted) before this session started — schema/migration, `types.ts`, the
  FakeRest mirror, `CommunicationSection.tsx` + tests, both Settings pages, and
  the extended `threads_entity.sql` — with two narrow gaps: four FakeRest fixture
  test files (`internal/{contexts,personas,invites,removePersona}.test.ts`) not
  yet updated for the new required `Account` field (invisible to `make typecheck`
  because every site uses `as Account`, a type assertion, not an annotated
  literal), and the `crm.settings.communication.*` i18n keys missing from both
  catalogues (component was running on inline `_:` fallback strings only). Both
  gaps were closed before this session began (verified by re-reading every file
  against the story's ACs and Dev Notes) and are reflected in the File List below.
- `supabase db diff --local` and `migration up --local` were run against this
  story's own stack (`--workdir .supabase-e2e-2`), not the shared dev instance on
  54321-54324 (also running, used by other concurrent agents in this session) —
  avoids any risk of racing another agent's schema state. `db diff` reported "No
  schema changes found" twice in a row.
- `make check-migration-safety STACK_ID=2`: PASSED — 51 seeded rows across 22
  tables survived intact; the guard restored the stack to head afterward.
- `make test STACK_ID=2`: 2569/2569 passed, 226 files. `npm run test:unit:db`
  (STACK_ID=2): 914/914 passed, 27 files, including the 9 new Story 7.2
  assertions in `threads_entity.sql` (AC-1/2, AC-3(a)/(b), AC-4 both settings,
  the invalid-explicit-argument denial, AC-6(d) plus its positive control, and
  the no-retroactive-rewrite check) — verified individually with
  `vitest --project db -t "Story 7.2"`, all 9 green.
- `make typecheck`, `make lint` (ESLint + prettier), `make build`, and all four
  CI guards (`check-retired-names`, `check-suppressions`, `check-route-convention`,
  `check-tailwind-arbitrary-var`) ran clean. A bare `npx prettier --check .`
  (wider glob than `make lint`'s prettier, which is scoped to
  `**/*.{mjs,js,json,ts,tsx,css,md,html}`) flags 16 pre-existing files outside
  this story's scope (`.github/workflows/*.yml`, `.lintstagedrc`,
  `doc/**/*.mdx`) — none touched by 7.2, none touched by this session.

### Completion Notes List

- `accounts.default_thread_visibility text not null default 'open'` added at
  the physical tail of the `create table` block (after `kind`), with its own
  `accounts_default_thread_visibility_check`. Confirmed NOT a reuse of the
  still-dormant `transparency_level` column (different, three-value AD-3
  concern per Dev Notes).
- `create_thread()` validates an explicit `p_visibility` *before* the coalesce
  (so an invalid explicit argument still raises `check_violation`, never
  silently falls back to the account default, which is always valid by its own
  CHECK), then resolves an omitted one from `accounts.default_thread_visibility`
  for the caller's own account. No caller changes; exact `pg_dump` form.
- `06_grants.sql`'s column-level UPDATE grant extended to include
  `default_thread_visibility`, preserving the revoke-then-column-grant idiom.
  No new role-gating invented — the shipped "Accounts writable by non-single
  members" RLS policy already excludes `single` from every account write.
- FakeRest `createThread` (`dataProvider.ts`) resolves the same default from
  `db.accounts` before delegating to `internal/threads.ts`, for AD-10 parity;
  `internal/threads.ts`'s own `?? "open"` literal fallback is now unreachable
  (confirmed by call-graph — it is the sole caller) but left as a defensive
  default rather than removed, since it is out of this story's declared scope.
- `CommunicationSection.tsx` (new): an open/private radio bound to
  `accounts.default_thread_visibility` via plain `dataProvider.update`, gated
  on `useViewerRole()` / `hasVisibility()` against every role except `single`,
  rendering nothing while the role or account data is not yet available. Wired
  into both `SettingsPage.tsx` and `SettingsPageMobile.tsx`. Full i18n coverage
  added to both English and French catalogues (genuine French strings, not a
  mirror).
- `threads_entity.sql` extended with a dedicated account + two members
  (independent of the sibling-household fixture already in the file),
  asserting AC-1/2 (fresh default), AC-3(a)/(b) (both defaults resolved, and a
  flip does not retroactively rewrite an existing thread), AC-4 on both
  settings, the invalid-explicit-argument denial (no
  `exception when others then … PASS`; matched by SQLSTATE via
  `pg_temp.denied`), and AC-6(d) with a positive control on the same row/column.
- All six `Account`-construction sites updated with
  `default_thread_visibility: "open"`.
- Toolchain green: `make typecheck`, `make lint`, `make test STACK_ID=2`
  (2569/2569), `npm run test:unit:db` (914/914, incl. the 9 new SQL
  assertions), `make build`, `npx prettier --check .` (clean on every file this
  story touches), all four CI guards, `supabase db diff --local` clean twice
  against this story's own stack, `make check-migration-safety STACK_ID=2`
  (51 seeded rows across 22 tables survived).

### File List

**Schema / DB**
- `supabase/schemas/01_tables.sql`
- `supabase/schemas/02_functions.sql`
- `supabase/schemas/06_grants.sql`
- `supabase/migrations/20260731200828_account_default_thread_visibility.sql`
- `supabase/tests/threads_entity.sql`

**Types / providers / i18n**
- `src/components/atomic-crm/types.ts`
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts`
- `src/components/atomic-crm/providers/fakerest/dataGenerator/shidduchim.ts`
- `src/components/atomic-crm/providers/fakerest/internal/personas.ts`
- `src/components/atomic-crm/providers/fakerest/internal/contexts.test.ts`
- `src/components/atomic-crm/providers/fakerest/internal/personas.test.ts`
- `src/components/atomic-crm/providers/fakerest/internal/invites.test.ts`
- `src/components/atomic-crm/providers/fakerest/internal/removePersona.test.ts`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`

**UI**
- `src/components/atomic-crm/settings/CommunicationSection.tsx` (new)
- `src/components/atomic-crm/settings/CommunicationSection.test.tsx` (new)
- `src/components/atomic-crm/settings/SettingsPage.tsx`
- `src/components/atomic-crm/settings/SettingsPageMobile.tsx`

**Tests (JS/TS)**
- `src/components/atomic-crm/providers/fakerest/dataProvider.createThread.test.ts` (new)

## Change Log

- 2026-08-02: Story 7.2 implemented — `accounts.default_thread_visibility`
  column + check constraint (physical tail), `create_thread()` resolving the
  default from the account with explicit-argument-wins semantics, the
  column-level grant extension, `Account` type + six construction sites, the
  FakeRest mirror, `CommunicationSection.tsx` wired into both Settings
  surfaces (hidden for `single`), i18n in both catalogues, and 9 new
  `threads_entity.sql` assertions covering AC-1 through AC-6(d). Full
  toolchain green; `db diff` converged twice; `check-migration-safety` passed.
  Status → review.
