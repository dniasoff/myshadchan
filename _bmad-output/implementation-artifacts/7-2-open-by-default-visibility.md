# Story 7.2: Open-by-default visibility

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a family,
I want new conversations visible to everyone in my household by default,
so that transparency is the norm rather than something anyone has to ask for (FR96, FR99).

## Position in Epic 7

**2nd of 5. Depends on 7.1** (`threads`, `create_thread()`, `thread_is_readable()` must
already exist). Precedes 7.3 (privacy enforcement), 7.4 (connection scope) and 7.5
(notifications).

This story does two small, precise things: it makes the *default* posture a per-account
setting instead of a hardcoded literal, and it proves the shipped default is `open`.
It does **not** touch enforcement of `'private'` — that is 7.3.

## Acceptance Criteria

1. **A household can set its own default posture.** `public.accounts` carries
   `default_thread_visibility` ∈ `('open', 'private')`. It is a genuinely new column —
   not a reuse of `accounts.transparency_level` (see Dev Notes "Do not reuse
   `transparency_level`").

2. **The shipped default is open.** A newly created account has
   `default_thread_visibility = 'open'` (column default), and a thread created with no
   explicit visibility on such an account resolves to `visibility = 'open'`.

3. **`create_thread()` resolves the default from the account, not a literal.** Calling
   `create_thread()` with `p_visibility` omitted (`null`) sets the new thread's
   `visibility` to the caller's account's `default_thread_visibility` — changing the
   account setting changes what *new* threads get, and never rewrites existing threads
   (no backfill, no retroactive change — a setting, not a migration).

4. **A member can change the posture from Settings**, and the change is visible
   immediately in the create-thread flow (no cache staleness beyond normal
   React Query invalidation).

5. **Verification — the toolchain is green.** `make typecheck`, `npm run lint`,
   `make test` pass repo-wide with zero new warnings; `npm run test:unit:db` passes,
   including: (a) a fresh account defaults to `'open'`; (b) flipping the account to
   `'private'` and then calling `create_thread()` with no `p_visibility` yields a
   `'private'` thread; (c) an explicit `p_visibility` argument always wins over the
   account default, on either setting.

## Tasks / Subtasks

- [ ] **Task 1 — Schema: the new column** (AC: 1, 2)
  - [ ] `supabase/schemas/01_tables.sql`: add `default_thread_visibility text not null
        default 'open'` to `public.accounts` (next to `transparency_level`,
        `01_tables.sql:241`), with
        `accounts_default_thread_visibility_check check (default_thread_visibility in
        ('open', 'private'))`.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        account_default_thread_visibility` → should generate a single `ALTER TABLE
        public.accounts ADD COLUMN … ADD CONSTRAINT …` (no drop/recreate needed —
        adding a `NOT NULL` column with a `DEFAULT` backfills existing rows safely).
        Hand-check it's exactly that, not a table rewrite.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.

- [ ] **Task 2 — Grants** (AC: 4)
  - [ ] `supabase/schemas/06_grants.sql`: add `default_thread_visibility` to the
        existing column-grant list at `06_grants.sql:569`
        (`grant update (name, transparency_level, data_region) on public.accounts to
        authenticated;` → add the new column to the same list). Follow the existing
        precedent of **not** role-gating this to `parent_admin` only — `name` and
        `transparency_level` are updatable by any authenticated member of the account
        today, and this story does not introduce new field-level RBAC beyond what
        epics.md asks for (see Dev Notes "Who may change the default posture").

- [ ] **Task 3 — `create_thread()` reads the account default** (AC: 2, 3)
  - [ ] `supabase/schemas/02_functions.sql`: change the one line in `create_thread()`
        (added by Story 7.1) from `visibility := coalesce(p_visibility, 'open')` to
        `visibility := coalesce(p_visibility, (select default_thread_visibility from
        accounts where id = v_account_id))`. `CREATE OR REPLACE FUNCTION` — same
        signature, no callers need to change.

- [ ] **Task 4 — Types and provider** (AC: 1, 4)
  - [ ] `src/components/atomic-crm/types.ts`: add `default_thread_visibility:
        ThreadVisibility;` to the `Account` type (`types.ts:260-266`).
  - [ ] `providers/fakerest/dataGenerator/`: seed `default_thread_visibility: "open"`
        on generated accounts, mirroring how `transparency_level: "shared"` is already
        seeded (`dataGenerator/shidduchim.ts:254`).

- [ ] **Task 5 — Settings UI** (AC: 4)
  - [ ] Add a small, focused new file `src/components/atomic-crm/settings/
        CommunicationSection.tsx` (do not grow `PrivacySection.tsx` or
        `FamilySection.tsx` — this is a distinct concern from either, per
        `.claude/rules/coding-style.md`'s "grow the file count" rule) with an
        open/private radio or toggle bound to `accounts.default_thread_visibility` via
        a standard `dataProvider.update("accounts", …)` call (no RPC needed — it's a
        plain column write, already grant-covered by Task 2).
  - [ ] Wire it into the Settings page's section list; all copy through the
        `i18nProvider` (`crm.settings.communication.*` keys, English + French mirror,
        AD-18).

- [ ] **Task 6 — Tests** (AC: 5)
  - [ ] Extend `supabase/tests/threads_entity.sql` (created by 7.1) — do not create a
        second SQL test file for this story; append three assertion rows per AC-5(a-c).
  - [ ] Vitest for `CommunicationSection` (AAA, ≥80% new lines).
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`, plus
        prettier on this story's changed files only.

## Dev Notes

### Do not reuse `transparency_level`

`public.accounts.transparency_level` already exists (`01_tables.sql:241`,
`default 'shared'`) but is currently **dormant** — it is not read by any function or
RLS policy in the schema today (`grep -rn transparency_level supabase/ src/` finds only
the column declaration, its grant, the TS type field, and one FakeRest seed value). It
is reserved for a *different* concern: AD-3's "per-account `transparency_level`" for
**shidduch/suggestion** visibility to a single (Epic 6's territory), using the same
three-value vocabulary as `shidduchim.visibility` (`shared | private_parent |
private_single`). Repurposing it for thread default posture would silently collide
with whatever Epic 6 does with it. This story adds its own column,
`default_thread_visibility`, scoped only to threads, with its own two-value vocabulary
(`open | private`) matching `threads.visibility` exactly.

### Who may change the default posture

Epics.md's AC says only "the family may set a different default posture" — it does not
say *which* family member. The existing `accounts` RLS policy
(`05_policies.sql:100-103`, `for all … using (id = current_context_id())`) already lets
any current member of the account update `name`/`transparency_level`/`data_region`
today; this story extends the same column-grant list rather than inventing new
role-gating that nothing in Epic 7's ACs asks for. If the product wants this
`parent_admin`-only, that is a follow-up correct-course, not a gap in this story.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-22] — "Default is open (FR96); … a family may set
  the default posture; the shipped default is open (FR99)."
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md#A2.4]
  — FR96, FR99 verbatim.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-7.2-Open-by-default-visibility]
- `supabase/schemas/01_tables.sql:237-257` (`accounts` table, `transparency_level`
  precedent).
- `supabase/schemas/06_grants.sql:560-569` (the account column-grant block this story
  extends).
- Story `7-1-thread-model.md` — `create_thread()`'s one-line change point, and the
  `threads_entity.sql` test file this story appends to.

### Project Structure Notes

- One new file (`settings/CommunicationSection.tsx`); no directory changes.
- No new schema file — a single `ALTER TABLE` in `01_tables.sql`.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
