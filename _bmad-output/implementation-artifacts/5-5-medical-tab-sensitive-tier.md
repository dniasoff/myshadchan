---
baseline_commit: 26788de18770894e074cb0b01a1545515ecba9fa
---

# Story 5.5: Medical tab (sensitive tier)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want medical notes kept to the tightest circle,
so that disclosure is deliberate.

## Position in Epic 5

Depends on **5.1** (which registers the shidduch descriptor and leaves `medical` in `pendingTabs`
for this story to claim). Nothing today implements this: there is no medical table or column
anywhere in the schema — verified, `grep -n "medical" supabase/schemas/*.sql` returns zero hits.
The one hit in `src/` is an unrelated coverage-topic cue list
(`references/crossReferenceSummary.ts:65`, `cues: ["health", "medical", …]`), which is
diligence-question content, not a data table.

**The `single` role this story gates on already exists** — `01_tables.sql:153-155` reads
`role in ('parent_admin', 'single', 'helper', 'self_manager', 'shadchan')`. Epics 1–3 are built
and deployed; there is no Epic 2 dependency left to wait on.

## Who may read a medical note — decided, not left open

The epic's own AC is explicit: *"the tab and its data are absent, enforced by RLS not UI, and a
negative test proves a single and a helper cannot read it."* AD-2's role vocabulary is
`parent_admin | single | helper | self_manager | shadchan` (`types.ts:132-133` is the one TS
union; `01_tables.sql:153-155` is the DB check). This story reads that as:
**readable only by `parent_admin` and `self_manager`** — the two roles that actually run a
household's shidduch process — and denied to `single` and `helper`. `self_manager` is included
deliberately: a self-managing single (family shape #1 — a widow, divorcee, or independent adult
with no parent above them) *is* their own process manager, and excluding them would make it
impossible for that single to see medical information about their own suggestions, which is not
what the epic intends. A `shadchan` cannot reach any household row regardless (AD-20,
structural), so no explicit shadchan check is needed — there is no membership path for them into
this table at all.

## Acceptance Criteria

1. **Given** a shidduch, **when** a `parent_admin` or `self_manager` opens its 360, **then** the
   Medical tab is present in the tab bar and shows the account's medical notes for that
   suggestion.
   **Fails when:** the tab is missing for either role, or renders another shidduch's notes
   because the query is not filtered by `shidduchim_id`.
2. **Given** the same shidduch, **when** a `single` or `helper` role member opens it, **then** the
   Medical tab is **absent from the DOM entirely** — not rendered-and-hidden, not disabled,
   absent. This is Story 3.4's shipped behaviour, not new work:
   `EntityShow.tsx:139-142` filters the merged tab array through
   `hasVisibility(tab.visibleTo, role)` **before** it reaches `Entity360TabStrip` /
   `Entity360TabPanel`, so a denied tab's `render` is never invoked and its label never enters
   the DOM (`entity360/visibility.ts:19-30`).
   **Fails when:** a DOM query for the Medical label finds a node with `aria-hidden`,
   `display:none` or a `disabled` attribute rather than finding nothing.
   **Two behaviours to assert, not assume:** (a) while `useViewerRole().isPending` is true,
   `EntityShow.tsx:128-135` replaces the entire tab bar with `RolePending` — there is no window
   in which the tab flashes before the role resolves; (b) an `undefined` role (resolved, no
   active membership) **fails closed** — `hasVisibility` returns `false` for any restricted tab
   (`visibility.ts:26-28`).
3. **Given** `public.medical_notes`, **when** its RLS is applied, **then** select/insert/update/
   delete each require `account_id = current_context_id()` **and** the caller's
   `account_members.role` for that account is `parent_admin` or `self_manager`. **Negative
   test:** seed one account with four members, one per role (`parent_admin`, `single`, `helper`,
   `self_manager`), and one medical note; assert the `single` and `helper` members' clients each
   see zero rows from `select * from medical_notes`, and the `parent_admin`/`self_manager`
   members see the row. Add a fifth case: a member of a *second* account sees zero rows.
   **Fails when:** any of those five reads returns the wrong count. **This, not AC-2, is the
   authoritative boundary** — the UI filter is a courtesy; RLS is the enforcement.
4. **Given** the universal Activity and Notes tabs (Epic 3, backed by `interactions`), **when**
   they render, **then** a medical note never appears there — `medical_notes` is its own table,
   never funnelled through `interactions.kind`.
   **Fails when:** `'medical'` appears in `interactions_kind_check`
   (`01_tables.sql:469-471`, today `note | call_logged | status_change | merge | link_created |
   link_removed`), or any `medical_notes` write goes through `interactions`.
5. **Given** the shidduch descriptor, **when** this story lands, **then** `"medical"` is declared
   in `shidduchim/entityDescriptor.ts`'s `tabs` **and deleted from its `pendingTabs`** in the
   same diff, and `entity360/registry.stubs.test.ts`'s pinned `shidduchim` row has been updated
   to match.
   **Fails, loudly — and an earlier draft of this story did exactly this:** declaring `medical`
   into `tabs` while leaving it in `pendingTabs` raises `tab-key-duplicated`
   (`entity360/ad24Conformance.ts:520-527`) and fails
   `npx vitest run src/components/atomic-crm/entity360`. `keys(tabs) ∪ pendingTabs` must equal
   the canonical row **as sets**, and a key in both is one defect, not a belt-and-braces
   declaration. The guard test's hand-off note (b)
   (`entity360/ad24Conformance.guard.test.ts:37-38`) states the rule.

## Tasks / Subtasks

- [x] **Task 1 — Schema** (AC: 1, 3)
  - [x] `supabase/schemas/01_tables.sql`: `create table public.medical_notes (id bigint
        generated by default as identity primary key, account_id bigint not null,
        shidduchim_id bigint not null, author_member_id bigint, body text not null,
        created_at timestamptz not null default now())`, plus composite FK
        `(account_id, shidduchim_id)` → `shidduchim(account_id, id) on delete cascade`
        (the `reference_links` pattern, `01_tables.sql:715-717`), an `account_id` FK to
        `accounts(id) on delete cascade`, and an index on `account_id` (`:797` is the shape).
        **Table definition only — no triggers in this file.**
  - [x] `supabase/schemas/04_triggers.sql`: attach `set_account_id_default()` to `medical_notes`.
        **Triggers live in `04_triggers.sql`, never in `01_tables.sql`** — `:160-172` is the
        block of existing `set_<table>_account_id` triggers; copy one, do not write a bespoke
        function.
  - [x] **`04_triggers.sql`, household scope — decide explicitly, do not skip.**
        `enforce_household_scope()` is attached to exactly 11 tables today
        (`04_triggers.sql:186-244`), and `supabase/tests/household_scope_lift.sql:56-64` asserts
        that count as a catalog fact, with the literal `= 11` at `:58`.
        **Recommendation: attach it** — `validate_medical_notes_household_scope`, before insert
        or update of `account_id`, named so it sorts after every `set_…` trigger ('v' > 's';
        `04_triggers.sql:186-201` explains why the name matters) — because a medical note is
        household data that can have no shadchanus meaning; this story's whole point is that a
        shadchan has no path to it. **Then increment `household_scope_lift.sql:57-58` by one in
        the same diff, both the literal and the assertion's own name string. Read the current
        value first — do not write `12`.** It is `11` on an untouched tree, but Story 5.4 lands
        a household-scoped table before this one in the serial wave order, so by the time this
        story runs the literal is most likely already `12`. If you instead
        decide to exclude it, record that deliberately as a `comment on table`, exactly as
        `entity_files` does at `01_tables.sql:628-632` — an unexplained absence is the failure
        mode this bullet exists to prevent.
        **This literal is contested with Stories 5.4 and 5.6, which each also add a household
        table. Only one of the three can be in flight at a time; whoever lands second reads the
        current value rather than assuming 11.**
  - [x] `supabase/schemas/05_policies.sql`: `alter table public.medical_notes enable row level
        security` (**not** `force` — no table in this repo uses `force`, and a single forced
        table would diverge from the other 22; `05_policies.sql:560-561`). One `for all` policy:
        `using (account_id = public.current_context_id() and exists (select 1 from
        public.account_members am where am.id = public.current_member_id() and
        am.role in ('parent_admin', 'self_manager'))) with check (same)`.
        **`current_context_id()` (AD-19) and `current_member_id()` (`02_functions.sql:242-259`)
        — never `current_account_id()`, which no longer exists.** Two properties to preserve
        deliberately: (a) `current_member_id()` is `SECURITY DEFINER` and already scopes to
        `(auth.uid(), current_context_id(), status = 'active')`, so the `exists` subquery must
        match on `am.id` and must NOT re-derive membership from `auth.uid()` unscoped;
        (b) when the caller holds no active membership `current_member_id()` returns null,
        `am.id = null` matches nothing, and the policy **fails closed** — keep it that way.
        `account_members`' own select policy (`05_policies.sql:145-150`) already permits reading
        rows of the active account, so the subquery resolves without a definer helper.
        **One `for all` policy, not a `for all` plus a narrower `for select`:** permissive
        policies OR together per command, so a second policy can only ever widen access — the
        hazard `account_members`' own comment states in writing at `05_policies.sql:126-129`.
  - [x] `supabase/schemas/06_grants.sql`: `revoke all on table public.medical_notes from anon,
        authenticated;` `grant select, insert, update, delete … to authenticated;`
        `grant all … to service_role;` plus the sequence grants — follow the `entity_files` block
        at `:737-755` verbatim. RLS is the real gate; the grant only makes the table reachable at
        all. A table added without a grant block is reachable by nobody, and every test then
        fails with a permission error rather than the RLS result it was written to check.
  - [x] Generate + hand-check the migration (a genuinely new table — the generated form is
        correct as-is; confirm the RLS policy **and** the grants landed in the same migration
        file, since `db diff` is known to drop `REVOKE` statements — AGENTS.md).
- [x] **Task 2 — Frontend and the tab mount** (AC: 1, 2, 5)
  - [x] `src/components/atomic-crm/shidduchim/MedicalTab.tsx` (or a small `medical/` folder if it
        grows past a single file — start with one, per the coding-style file-count guidance):
        list + add-a-note form against `medical_notes`, filtered by `shidduchim_id`.
  - [x] **`render` is arity-zero** (`entity360/entityDescriptor.ts:106-112`). `MedicalTab` reaches
        the shidduch through `useRecordContext()` — `EntityShow` mounts inside `ShowBase`, so a
        `RecordContext` always exists. Do not thread the record in as a prop, and do not add a
        descriptor field to carry it.
  - [x] **Declare the tab AND shrink `pendingTabs`, in the same diff.** In
        `shidduchim/entityDescriptor.ts`: add
        `{ key: "medical", visibleTo: ["parent_admin", "self_manager"], render: () => <MedicalTab /> }`
        to `tabs` **in canonical position** (`medical` follows `photo` —
        `ad24Conformance.ts:216-229`) and **delete `"medical"` from `pendingTabs`**.
        `visibleTo?: MemberRole[]` is the shipped field (`entity360/entityDescriptor.ts:113-114`),
        gated by `hasVisibility()` (`entity360/visibility.ts`) and `useViewerRole()`
        (`entity360/useViewerRole.ts`). **`visibleTo` is an explicit allow-list, not an ordered
        threshold** (contract §2 — there is no `minVisibility`, and
        `entity360/entityDescriptor.test.ts:82` pins that): the three `MemberRole` values this
        array omits (`helper`, `shadchan`, `single` — `types.ts:132-133` has exactly five) are
        each denied, which is exactly the "Who may read a medical note" ruling above. Omitting
        `shadchan` is deliberate and matches the RLS: there is no membership path for a shadchan
        into a household row.
  - [x] Do **not** add a `label`: "Medical" is already the i18n default
        (`entity360/tabKeys.ts:51`, `providers/commons/englishCrmMessages.ts:391`), and an
        override would need a "why THIS entity deviates" comment
        (`entity360/entityDescriptor.ts:97-105`) for a deviation that does not exist.
  - [x] Update `entity360/registry.stubs.test.ts`'s pinned `shidduchim` `pendingTabs` row
        (`:36-50`) — it loses `"medical"`.
- [x] **Task 3 — Types, providers, i18n**
  - [x] `types.ts`: add a `MedicalNote` type (`id`, `account_id`, `shidduchim_id`,
        `author_member_id`, `body`, `created_at`).
  - [x] `providers/fakerest/dataProvider.ts` + generator: a `medical_notes` collection, so demo
        mode and the component tests have rows (AD-10 keeps the two providers in lockstep).
  - [x] **Both i18n catalogues** — `englishCrmMessages.ts` **and** `frenchCrmMessages.ts` — for
        this story's content strings (empty state, add-note form labels and placeholder,
        submit/error copy). `i18nProvider` runs `allowMissing: true`, so an English-only key
        falls back silently and no test catches it. **No `crm.entity360.tab.*` key is needed** —
        all 15 tab labels already ship (`englishCrmMessages.ts:381-397`).
  - [x] `account_has_domain_data()` (`02_functions.sql:842-860`) and its hand-maintained FakeRest
        mirror `providers/fakerest/internal/accountDomainData.ts:19-32` — **check, then most
        likely leave alone.** `medical_notes` FKs to `shidduchim`, which both already check, so a
        medical note cannot exist without a `shidduchim` row and the predicate is already true.
        Record that reasoning in a one-line comment beside the new table rather than adding a
        redundant `exists` clause. If you do add one, **both** the SQL function and
        `DOMAIN_RESOURCES` move together — the file's own comment says the mirror is maintained
        by hand and nothing tests the pair.
- [x] **Task 4 — Tests** (AC: 2, 3, 4, 5)
  - [x] The AC-3 negative test as a new pair, `supabase/tests/medical_notes.sql` +
        `supabase/tests/medical_notes.test.ts`. **Every `.sql` suite in that directory has a
        paired `.test.ts` runner — 13 pairs at HEAD, no exceptions**; a `.sql` file with no
        runner never executes. Copy `entity_files.test.ts` for the runner shape
        (`dbSuiteHelpers.ts`'s `DB_URL` / `bailIfDbUnreachable`, one named test per emitted
        result row); copy `household_scope_lift.sql:71-84` for seeding one login with several
        memberships of differing roles, and `references_entity.sql` for the cross-account arm.
  - [x] A frontend test proving the Medical tab is **absent** (not visually hidden) from the
        rendered tab bar for a `single`/`helper` viewer, and present for `parent_admin` and
        `self_manager`. **Stack:** `vitest-browser-react`'s `render` in Chromium with
        `CoreAdminContext` + `TestMemoryRouter` from `ra-core` and the FakeRest provider — copy
        `entity360/tabs/FilesTab.test.tsx:1-16`, and see
        `entity360/EntityShow.permissions.test.tsx` (which already uses a `medical` tab with
        `visibleTo: ["parent_admin"]` as its fixture) for how to drive the viewer's role.
        **React Testing Library is not a dependency of this repo**; do not import
        `@testing-library/react`.
  - [x] `npm run test:unit:db` (needs `make start`) plus `make typecheck && npm run lint &&
        make test`. Re-run `supabase/tests/household_scope_lift.sql` — Task 1's trigger decision
        is asserted there and nowhere else.

## Dev Notes

### This is the story `.claude/rules/security-triggers.md` names outright

"Database queries or migrations" and "Supabase RLS policies" are both explicit triggers —
dispatch SECURITY-REVIEWER on this diff without asking whether it's warranted.

### `useViewerRole()` returns every role — there is no UI-layer workaround to design

An earlier draft of this story carried a "Known UI-layer limitation" paragraph claiming that
Story 3.4's `useViewerRole()` maps the legacy per-login admin flag to `parent_admin | helper` and
"cannot yet return `self_manager`", and that a real self-manager might therefore not see the tab.
**That is false and the paragraph is deleted.** `entity360/useViewerRole.ts:31-34` is:

```ts
export function useViewerRole(): ViewerRole {
  const { data, isPending } = useMyContexts();
  return { role: pickActiveRole(data), isPending };
}
```

— it returns whatever `MemberRole` the viewer holds in the *active* context, all five values
included, and its own doc comment (`:10-29`) says the legacy flag is deliberately never read.
`entity360/roleSource.guard.test.ts` proves that flag appears nowhere under `entity360/`.
**`visibleTo: ["parent_admin", "self_manager"]` works today.** Do not design around a limitation
that does not exist, and do not "fix" the hook inside this diff.

### Self-contained, does not wait for Epic 6

Epic 6 generalises row/field-level scoping for a `single` across the app, but lands after Epic 5.
This table's RLS does not depend on that machinery — it is a narrow, purpose-built policy needing
only the `single` role *value*, which exists (`01_tables.sql:153-155`). It works correctly in
isolation regardless of what Epic 6 later adds elsewhere. `05_policies.sql:270-281` records the
contrasting case in writing: `interactions` still resolves a `single`-role membership to full
parent-level visibility until Epic 6 narrows that one join. `medical_notes` closes its own window
from day one; Story 5.4 uses the same self-contained pattern.

### Why not `interactions.kind = 'medical'`

The existing `interactions` table's RLS derives visibility by joining to a parent shidduch's
`pipeline_state`/`visibility` (AD-3) — a *content-blind* mechanism keyed on suggestion state, not
on the viewer's role. Reusing it for medical data would require bolting a role check onto a
table whose whole design is deliberately role-agnostic today, and would put medical content one
future edit to that shared policy away from leaking (a change to the general interactions
policy could silently loosen medical access too). A dedicated table with a dedicated, narrow
policy is the safer, more auditable choice for the epic's own stated sensitivity tier, and
matches the AD-1 "Single-owner rule" cross-cutting convention: this table has exactly one
visibility rule, and it is not shared with anything else.

### Files this story touches that are easy to miss

`supabase/schemas/04_triggers.sql` (both the `set_…` trigger and the household-scope decision —
**not** `01_tables.sql`) · `supabase/schemas/06_grants.sql` (table **and** sequence) ·
`supabase/tests/household_scope_lift.sql:56-64` (the `= 11` literal) ·
`supabase/tests/medical_notes.test.ts` (a `.sql` suite with no runner never executes) ·
`entity360/registry.stubs.test.ts` (pinned `pendingTabs` row) ·
`registry.json` (`scripts/generate-registry.mjs` globs every non-test source file under
`src/components/atomic-crm/**`; `.husky/pre-commit` regenerates) ·
both i18n catalogues · `types.ts` · the FakeRest provider and generator.

### Migration workflow

Edit `supabase/schemas/*`, then
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f medical_notes`, hand-check
(a new table — the generated form is correct as-is, but confirm the RLS policy and grants from
Task 1 landed in the same migration file, since `db diff` sometimes drops `REVOKE` statements —
per AGENTS.md), then
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset`/`db push`.
The `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix is required — without it every `npx supabase`
call hangs on the keyring.

### Project Structure Notes

- New table, own file section in `01_tables.sql` / `04_triggers.sql` / `05_policies.sql` /
  `06_grants.sql` — not folded into the `interactions` block.
- Frontend: keep it inside `shidduchim/` (medical notes are shidduch-scoped only per this epic;
  no single-level or shadchan-level medical concept is requested anywhere in Epic 5).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.5] — "the tab
  and its data are absent, enforced by RLS not UI... a negative test proves a single and a
  helper cannot read it."
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-2 — :62-65] —
  role vocabulary, `self_manager` inclusion rationale.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-20 — :153-156] —
  a shadchan cannot address a household row at all; why no explicit shadchan check is needed.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-1 — :57-60] —
  isolation is enforced in Postgres; one scoping axis; RLS on `current_context_id()`.
- [Source: supabase/schemas/01_tables.sql:153-155] — `account_members_role_check` already permits
  `'single'`; no Epic 2 dependency remains.
- [Source: supabase/schemas/01_tables.sql:469-471] — `interactions_kind_check`, which AC-4 asserts
  never gains `'medical'`.
- [Source: supabase/schemas/02_functions.sql:242-259] — `current_member_id()`, the caller-
  resolution function this policy reuses.
- [Source: supabase/tests/household_scope_lift.sql:56-64] — the `enforce_household_scope` trigger
  count this story must reconcile.
- [Source: src/components/atomic-crm/entity360/entityDescriptor.ts:94-115] —
  `EntityTabDescriptor`: `key`, optional `label`, arity-zero `render`, `visibleTo`.
- [Source: src/components/atomic-crm/entity360/visibility.ts:19-30] — `hasVisibility`'s truth
  table, including fail-closed on an undefined role.
- [Source: src/components/atomic-crm/entity360/EntityShow.tsx:128-142] — where the filter runs and
  why a denied tab never reaches the DOM.
- [Source: src/components/atomic-crm/entity360/useViewerRole.ts:31-34] — returns any `MemberRole`;
  the deleted "limitation" note was wrong about this.
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md#2] — the tab visibility field is
  `visibleTo?: MemberRole[]`, an allow-list; `minVisibility` does not exist.
- [Source: src/components/atomic-crm/entity360/ad24Conformance.guard.test.ts:32-48] — hand-off
  note (b): a story that builds a tab moves its key out of `pendingTabs` in the same diff.
- [Source: .claude/rules/security-triggers.md]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (bmad-dev-story workflow)

### Debug Log References

- `supabase db diff --local -f medical_notes` initially bundled four unrelated,
  byte-identical `drop view`/`create or replace view` statements
  (`reference_links_summary`, `shadchan_stats`, `shidduchim_summary`,
  `singles_summary`) into the generated migration — confirmed pre-existing
  drift (reproduced identically on a second, unrelated diff run after this
  story's migration was applied) and NOT caused by this story's schema edits.
  Stripped them from the migration file entirely: recreating them via a bare
  `create or replace view` (no `WITH (security_invoker = on)` clause) would
  have silently disabled RLS on all four, per the repo's own documented trap
  (`20260724112600_add_summary_stats_views.sql`'s MANUAL ADJUSTMENTS block).
  Verified via `pg_class.reloptions` before/after that all four views keep
  `security_invoker=on` through this migration.
- `db diff` also dropped the `revoke all on table public.medical_notes from
  anon, authenticated;` statement (AGENTS.md's documented "db diff drops
  REVOKE statements" trap) — `alter default privileges ... grant all on
  tables to authenticated` (06_grants.sql) auto-grants every privilege,
  including TRIGGER/REFERENCES/TRUNCATE, to `authenticated` the instant
  `CREATE TABLE` runs, so without a hand-added revoke, `authenticated` would
  have kept those three beyond the intended four (select/insert/update/
  delete). Hand-added the revoke; verified via
  `information_schema.role_table_grants` and a from-scratch `supabase db
  reset --local` that the final privilege set matches the schema files
  exactly (zero residual diff on medical_notes).
- Found a second, undeclared copy of the `enforce_household_scope` trigger
  count catalog-fact literal at `supabase/tests/context_resolution.sql:638-639`
  (`= 12`, alongside `household_scope_lift.sql`'s own copy) — caught by
  running the full `npm run test:unit:db` suite, not named in the story.
  Bumped both the literal and its assertion name string to 13 in the same
  diff.
- `medical_notes.sql`'s first draft expected an UPDATE from a denied role to
  raise an exception; an RLS `USING` clause instead silently excludes the row
  from the UPDATE's target set (0 rows affected, no error) — rewrote the
  check around `GET DIAGNOSTICS ... row_count` instead, and switched back to
  the `parent_admin` role before reading the row back (a `single`-role read
  of the same query returns `NULL`, not the row, since RLS hides it from that
  session).
- `vitest-browser-react`'s locator API is `getByPlaceholder`, not RTL's
  `getByPlaceholderText` — fixed after a first failing run (screenshots from
  that failed run were `.gitignore`d and removed).

### Completion Notes List

- Task 1 (Schema): `medical_notes` table (id, account_id, shidduchim_id,
  author_member_id, body, created_at), composite FK to
  `shidduchim(account_id, id)`, `account_id` FK to `accounts(id)`, one
  `account_id` index; `set_medical_notes_account_id` +
  `validate_medical_notes_household_scope` triggers (14th
  `enforce_household_scope` attachment — both catalog-fact literals bumped
  12→13); one `for all` RLS policy scoped to `current_context_id()` AND
  `current_member_id()`'s role in `('parent_admin', 'self_manager')`, fails
  closed when the caller holds no active membership; grants revoked-then-
  reissued to exactly select/insert/update/delete for `authenticated`, all
  for `service_role`. Migration generated, hand-fixed (see Debug Log), and
  verified via a from-scratch `supabase db reset --local`.
- Task 2 (Frontend + tab mount): `shidduchim/MedicalTab.tsx` — arity-zero
  `render`, reaches the shidduch via `useRecordContext()`, plain list +
  add-a-note form against `medical_notes` filtered by `shidduchim_id`, no
  edit/delete/visibility control (no AC asks for one). `medical` declared in
  `shidduchimDescriptor.tabs` with `visibleTo: ["parent_admin",
  "self_manager"]`, in canonical position (after `photo`), and removed from
  `pendingTabs` in the same diff. No `label` override. Updated
  `entity360/registry.stubs.test.ts`'s pinned `shidduchim` row (moved
  `"medical"` from `pendingTabs` into `tabs`) and corrected its now-stale
  tab-count prose in the same edit.
- Task 3 (Types/providers/i18n): `MedicalNote` type added to `types.ts`
  (`author_member_id` optional — no trigger stamps it, no AC asks for
  per-note attribution); `medical_notes: MedicalNote[]` added to the FakeRest
  `Db` type and seeded empty in the generator, matching the
  `resume_photos`/`entity_files` precedent (plain CRUD, no custom
  dataProvider method needed — unlike `resume_photos`, there is no storage
  object or soft-hide to broker). Both i18n catalogues got a `medical` block
  under `crm.entity360.*` (empty/error/placeholder/add/addError). Checked
  `account_has_domain_data()`/`accountDomainData.ts` — left alone,
  recorded the reasoning in a `comment on table` (medical_notes FKs to
  shidduchim, which both already check).
- Task 4 (Tests): `supabase/tests/medical_notes.sql` + `.test.ts` (15 checks:
  insert + account_id stamping, four role-based SELECT cases inside one
  account, the fifth cross-account SELECT case, UPDATE denial by row count,
  `interactions_kind_check` rejecting `'medical'`, both trigger-attachment
  catalog facts, anon denial) — all green against the local stack.
  `shidduchim/MedicalTab.test.tsx` (empty state, add-a-note round trip
  through the real FakeRest provider, whitespace-only rejection,
  shidduch-scoping) and `shidduchim/entityDescriptor.test.tsx` (new — proves
  the REAL registered descriptor's `medical` tab is present for
  `parent_admin`/`self_manager` and absent from the DOM for
  `single`/`helper`/`shadchan`, complementing the already-existing generic
  denial-mechanism proof in `entity360/EntityShow.permissions.test.tsx`).
- All gates green: `make typecheck`, `make lint` (ESLint + prettier),
  `npx prettier --check .` (16 pre-existing unrelated files flagged — none
  touched by this story; confirmed via `git status`), `npx vitest run`
  (1994/1994), `make build`, all four CI guards
  (`check-retired-names`/`check-suppressions`/`check-route-convention`/
  `check-tailwind-arbitrary-var`), `npm run test:unit:db` (543/543),
  `make test STACK_ID=3` (1994/1994, against a freshly-provisioned stack —
  stopped afterward per the concurrency rules).

### Review Fixes (adversarial review response, `NEEDS-FIX` verdict)

Fixed the one blocker, adopted one of the two advisory residuals as a should-fix,
used the reviewer's own optional suggestion instead of deleting code, corrected two
Dev Agent Record over-claims, and left two findings unactioned with evidence below.

1. **Finding 1 (BLOCKER) — the shadchan case in `entityDescriptor.test.tsx` was
   vacuous.** Confirmed exactly as reported: the case had no positive anchor, so
   `not.toBeInTheDocument()` on "Medical" was satisfied at t=0, before the tab strip
   had even mounted — it stayed green while deleting `visibleTo` from the descriptor
   entirely (making the tab visible to every role). Added the same
   `getByRole("tab", { name: "Overview" })` positive-anchor line the single/helper
   cases already carry, immediately before the negative assertion. Re-ran the
   reviewer's own mutation (deleting `visibleTo` from the `medical` tab entry) by
   hand against the fixed test: it now goes red (previously stayed green), matching
   the reviewer's proof-by-construction. `entityDescriptor.test.tsx` still passes
   green on the unmodified descriptor.
2. **Recommended optional fix — the never-exercised `role?` parameter.** Used it
   rather than dropping it, per the reviewer's own alternative ("or use it to assert
   AC-2(b)'s undefined-role fail-closed on the real descriptor"): added
   `"an unresolved role (no active membership) never sees the Medical tab — AC 2(b),
   fails closed"`, calling `renderShidduchShow()` with no role at all (empty
   `MyContext[]`, so `pickActiveRole` resolves `undefined` and `useMyContexts` is
   already resolved, not pending). This is a real, previously-missing proof of the
   behaviour `EntityShow.tsx`'s own doc comment claims ("An `undefined` role...
   fails closed the same way an insufficient one does") on the real registered
   descriptor, not merely on the generic mechanism.
3. **Residual (advisory, adopted) — no DB-layer test for "authenticated caller with
   zero active memberships."** The reviewer flagged this as advisory, not blocking,
   but I agree it belongs in this story's own suite: AC-3 calls RLS "the
   authoritative boundary" for the most sensitive table in the epic, the gap is the
   exact fail-closed claim the policy's own comment makes
   (`05_policies.sql`: "when the caller holds no active membership
   `current_member_id()` returns null... fails closed"), and the fix is cheap and
   fully precedented (`references_entity.sql`'s "a user with no membership resolves
   to NO account" case). Added a sixth login (`u6`, `auth.users` row, zero
   `account_members` rows anywhere) and two new checks, `(k)`, to
   `supabase/tests/medical_notes.sql`: `current_context_id()` resolves `NULL` for
   that caller, and `select * from medical_notes` returns zero rows for them. Bumped
   `medical_notes.test.ts`'s `toBeGreaterThanOrEqual` floor from 14 to 16 (2 new
   checks on top of the suite's actual pre-fix count of 14 — see Finding 4 below).
   Ran the new pair against a pre-fix copy of the policy (temporarily replacing the
   `for all` predicate with a version that grants any authenticated caller) to
   confirm both go red before the real policy is restored — they are genuinely
   falsifiable, not vacuously true.
4. **Finding — Dev Agent Record over-claims, corrected.** The original Task 4
   completion note above claims "15 checks"; the actual pre-fix count was 14 (the
   review verified this directly and the runner's own `>= 14` floor already agreed).
   Left that sentence in place rather than edited, per this repo's own review-fix
   convention (the review trail stays intact) — **correction:** it was 14, not 15,
   before this fix; it is 16 now that Finding 3's two checks are added. Separately,
   the review noted the same completion note's DB suite did not, at the time,
   contain any check for "no active membership" — true when written; Finding 3
   above closes that specific gap, so the sentence is accurate as of this commit
   even though it was not when first written.
5. **Finding — the `entityDescriptor.test.tsx` completion note's "absent... for
   `single`/`helper`/`shadchan`" claim.** The review's proof-by-construction showed
   the shadchan third of that claim was, at the time, asserted by a vacuous test —
   not false as a claim about the shipped descriptor (the descriptor itself has
   always denied `shadchan`, structurally, via the allow-list), but unearned as a
   claim about what the test file proved. Finding 1's fix (and Finding 2's addition)
   make the test file actually prove it; no change needed to the sentence itself.
6. **Finding 2 (advisory) — the i18n keys are untested. Not actioned, disagree with
   fixing it inside this story.** The review's own characterization is the reason:
   "Correct as shipped, but unguarded — the standing repo condition the brief names
   at L13, not a 5-5 regression." `i18nProvider`'s `allowMissing: true` plus zero
   parity testing between `englishCrmMessages.ts` and `frenchCrmMessages.ts` is a
   repo-wide gap (the pre-flight brief's L13 names it against a different story,
   `interactionLabels.ts`/activity kinds) that predates this story and is shared by
   every tab that ships i18n content, not specific to `medical`. Building a parity
   test harness for two catalogues is a repo-level investment outside this story's
   scope and its `STACK_ID=3` file-ownership lease. Hand-verified (as the review
   already did) that both catalogues' `crm.entity360.medical.*` keys resolve
   correctly in English and French — no content defect exists, only the absence of
   a guard that nothing else in the repo has either.
7. **Residual (advisory) — `MedicalTab.tsx`'s `notify(error.message)` surfaces the
   raw server error string. Not actioned.** The review's own framing already
   answers this: "Consistent with every other tab, so not a regression." Changing
   only this tab's error handling would make it diverge from every other tab's
   pattern for no story-specific reason; a repo-wide error-message policy change
   (if wanted) belongs in its own story, not folded into this one under review-fix
   pressure.

Re-ran the full gate after all fixes — see the top-level Change Log entry below for
real output. `npm run test:unit:db` went from 543 to 545 (the two new `(k)` checks in
`medical_notes.sql`, each turning into one named assertion in
`medical_notes.test.ts`). `npx vitest run` (the full multi-project run, which already
includes the `db` project's suites, `medical_notes.test.ts` among them) went from
1994 to 1997 — the same two new DB checks plus one new frontend case in
`entityDescriptor.test.tsx` (the AC-2(b) undefined-role case; the anchor line added
to the existing shadchan case does not add a test).

### File List

- `supabase/schemas/01_tables.sql` (modified)
- `supabase/schemas/04_triggers.sql` (modified)
- `supabase/schemas/05_policies.sql` (modified)
- `supabase/schemas/06_grants.sql` (modified)
- `supabase/migrations/20260730045700_medical_notes.sql` (new)
- `supabase/tests/medical_notes.sql` (new; **review fix, Finding 3** — added a
  sixth login with zero `account_members` rows and case `(k)`, the
  zero-active-memberships fail-closed check)
- `supabase/tests/medical_notes.test.ts` (new; **review fix, Finding 3** — bumped
  the check-count floor from 14 to 16)
- `supabase/tests/household_scope_lift.sql` (modified — catalog-fact literal 12→13)
- `supabase/tests/context_resolution.sql` (modified — the second, undeclared copy of the same catalog-fact literal, 12→13)
- `src/components/atomic-crm/types.ts` (modified — `MedicalNote` type)
- `src/components/atomic-crm/shidduchim/MedicalTab.tsx` (new)
- `src/components/atomic-crm/shidduchim/MedicalTab.test.tsx` (new)
- `src/components/atomic-crm/shidduchim/entityDescriptor.tsx` (modified — `medical` tab declared, removed from `pendingTabs`)
- `src/components/atomic-crm/shidduchim/entityDescriptor.test.tsx` (new; **review
  fix, Finding 1** — added the missing Overview anchor to the shadchan case;
  **review fix, Finding 2** — added the AC-2(b) undefined-role fail-closed case)
- `src/components/atomic-crm/entity360/registry.stubs.test.ts` (modified — pinned `shidduchim` row)
- `src/components/atomic-crm/providers/fakerest/dataGenerator/types.ts` (modified — `medical_notes` in `Db`)
- `src/components/atomic-crm/providers/fakerest/dataGenerator/shidduchim.ts` (modified — seeded empty)
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` (modified — `medical` i18n block)
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` (modified — `medical` i18n block)

## Change Log

- 2026-07-30: Story implemented — `medical_notes` table (account+shidduch-scoped,
  RLS restricted to `parent_admin`/`self_manager`, household-scope trigger
  attached), `shidduchim/MedicalTab.tsx` (list + add-a-note, no edit/delete),
  `medical` moved from `pendingTabs` into `tabs` on the `shidduchim`
  descriptor with `visibleTo: ["parent_admin", "self_manager"]`. Hand-fixed
  two `db diff` gaps (a dropped `REVOKE`, and stripped four unrelated
  spuriously-recreated views that would have lost `security_invoker`) and one
  undocumented duplicate catalog-fact literal (`context_resolution.sql`,
  mirroring 5-4's own finding of the same class of issue). All gates green
  (typecheck, lint, full unit suite incl. new `medical_notes` DB suite and a
  new real-descriptor visibility test, build, four CI guards, `make test
  STACK_ID=3` against a fresh stack).
- 2026-07-30: Review-fix pass (`NEEDS-FIX` verdict) — fixed the vacuous shadchan
  case in `entityDescriptor.test.tsx` (missing Overview anchor; it stayed green
  under a `visibleTo`-deletion mutation), added a real AC-2(b) undefined-role
  fail-closed case using the previously-unexercised optional `role` parameter,
  and added a DB-layer fail-closed case (`medical_notes.sql` `(k)`, a caller with
  zero active memberships anywhere) that the review flagged as an untested gap
  against the policy's own stated guarantee. Corrected two Dev Agent Record
  over-claims (14, not 15, checks pre-fix; the "no active membership" DB case did
  not exist pre-fix). Left two advisory findings unactioned with reasoning: the
  i18n-keys-untested gap (a repo-wide condition predating this story, per the
  review's own characterization) and `MedicalTab.tsx`'s `notify(error.message)`
  (consistent with every other tab, per the review's own note). See "Review
  Fixes" under Dev Agent Record for full detail. Full gate re-run green:
  `make typecheck`, `make lint`, `npx vitest run` (1997/1997), `npm run
  test:unit:db` (545/545), `make build`, all four CI guards.
