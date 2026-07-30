# Story 5.4: Photo tab with explicit visibility

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want the photo handled carefully,
so that it is never exposed by accident.

## Position in Epic 5

Depends on **5.1** (which registers the shidduch descriptor and leaves `photo` in `pendingTabs`
for this story to claim) and **5.3** (the `documents` storage bucket and its path convention —
reuse the bucket; this story adds only its own `photos/`-prefix policies, which 5.3 deliberately
left undefined).

**This story is why the `documents` bucket exists.** 5.3's re-ratified argument turns entirely on
this story's AC-4: Postgres storage policies are *permissive* and OR together, so a bucket that
already carries an account-wide select policy — `attachments` (`07_storage.sql:25-30`) and
`entity-files` (`07_storage.sql:72-77`) both do — can never be narrowed to hide an object from a
`single`-role member of that same account. If this story's storage rules are ever softened to
plain account scope, say so out loud and delete `documents`; do not leave the bucket standing
with no reason.

## Design decision: photos are their own table, not a JSON blob

`resumes.photos jsonb` (`01_tables.sql:316`) is today a single, whole-row-visible blob. Postgres
RLS enforces at row granularity: a `jsonb` array cannot have per-element visibility enforced by
policy — the entire `resumes` row is either visible to a caller or it is not. AD-1 ("Isolation is
enforced in Postgres, never in the application") makes this decisive: **per-photo visibility that
must survive a client bug requires per-photo *rows*.** This story replaces `resumes.photos` with
a new table, `public.resume_photos`, one row per photo, each carrying its own `visibility`. This
is a genuine replacement, not an addition — `resumes.photos` is dropped in the same migration
(NFR-14).

**Blast radius of the drop, verified:** `photos` has exactly one definition
(`01_tables.sql:316`) and one consumer, `Resume.photos?: unknown` (`types.ts:428`). No view, no
edge function, no FakeRest generator and no component reads it. The `DROP COLUMN` is genuinely
free.

`visibility` reuses the **existing** three-value vocabulary
(`shidduchim_visibility_check` / `entity_files_visibility_check`, `01_tables.sql:304-306`, `:607-609`:
`shared | private_parent | private_single`) rather than inventing a new one — but constrained to
the **subset that means something for a photo of the suggested person**:
`('shared', 'private_parent')`. `private_single` ("only the single sees it") has no coherent
meaning here — the uploader is the process manager, and a photo hidden from the manager who
uploaded it is nonsense — so the check constraint excludes it rather than carrying a dead state.
Same vocabulary, no second one to reconcile; just fewer legal values. Story 3.7 set the precedent
for exactly this shape: `entity_files` carries the full three-value check plus a *narrowing*
second constraint, `entity_files_visibility_target_check` (`01_tables.sql:614-616`), which is the
house pattern for "same vocabulary, fewer legal values here".

**Explicit reveal is a UI affordance, not a permission tier.** It is a deliberate-friction,
click-to-view pattern (distinct from the `visibility` column, which *is* a permission tier). Do
not conflate the two: reveal state is ephemeral client state (resets on navigation); visibility
is a persisted, RLS-enforced fact.

## Acceptance Criteria

1. **Given** a suggestion with one or more photos, **when** I open Photo, **then** each photo is
   hidden behind an explicit "Reveal" affordance by default — clicking it displays that photo;
   the reveal state is local to the current page view and resets on navigating away and back.
   **Fails when:** an image `src` (or a signed URL) is fetched or placed in the DOM before the
   reveal click, or the revealed state survives a route change.
2. **Given** the Photo tab, **when** I upload a photo, **then** I choose its visibility (`shared`
   default, `private_parent` to exclude the single) at upload time; I can replace a photo
   (uploads a new row) or hide one (sets `hidden_at`, a soft-hide — a hidden photo never renders
   anywhere, including in any future share, and is excluded by a plain `hidden_at is null`
   filter, never deleted outright).
   **Fails when:** any code path issues a `DELETE` against `resume_photos`, or a row with
   `hidden_at is not null` appears in the grid.
3. **Given** a photo whose `visibility = 'private_parent'`, **when** a viewer whose
   `account_members.role = 'single'` reads `resume_photos`, **then** RLS returns zero rows for
   that photo. **Negative test:** seed one account with a `parent_admin` member and a `single`
   member, one `private_parent` photo and one `shared` photo; assert the `single` member's
   client sees only the `shared` row, and the `parent_admin` sees both.
   **Fails when:** the `single` member's `select * from resume_photos` returns 2 rows.
4. **Given** the storage objects themselves, **when** a `single`-role member queries the
   `documents` bucket directly (bypassing the table), **then** they still cannot reach a
   `private_parent` photo: the path embeds the visibility
   (`{account_id}/photos/{visibility}/{shidduchim_id}/{uuid}-{filename}`) and the `photos/`
   storage policies grant a `single`-role member select **only** under the `photos/shared/`
   prefix. Without this, the table RLS of AC-3 is decorative — Story 5.3's policies cover only
   the `resumes/` prefix precisely so this story can write stricter rules for its own.
   **Negative test (storage):** the `single` member's client cannot download or list the
   `private_parent` object but can download the `shared` one; a second account can reach
   neither. Asserted against the running local Supabase storage API, not mocked.
   **Fails when:** the `single` member can `list` `{account}/photos/private_parent/`, or a
   foreign account can read either object.
   Consequence, stated so nobody "fixes" it later: changing a photo's visibility after upload is
   not supported in this story — the visibility is in the object key, and there is no UPDATE
   policy to move it (AC-6). Hide it (AC-2) and re-upload.
5. **Given** the resume forward action (Story 5.7's rail), **when** it is built, **then**
   photos are structurally outside it: the forward action reads only `resumes.files`;
   `resume_photos` lives in its own table and storage prefix, never in `resumes.files`. The
   executable payload test lives in Story 5.7 (which builds the action after this story) — this
   story's contribution is the structural separation, asserted here by schema shape alone.
   **Fails when:** any column of `resume_photos` is written into `resumes.files`, or a photo path
   appears under the `resumes/` storage prefix.
6. **Given** the `photos/` storage policies, **when** they are written, **then** there are
   **exactly three — select, insert, delete. No UPDATE policy.**
   **Fails when:** `supabase/tests/context_rls_hardening.sql:141-146` reports
   `storage: no UPDATE-applicable policy exists on storage.objects` as failed. That assertion is
   **table-wide** on `storage.objects` and `:130-139` calls it *"a real, load-bearing
   invariant"*; `07_storage.sql:61-67` records the same reasoning for `entity-files`. A fourth
   policy "for symmetry" turns the suite red.
7. **Given** the shidduch descriptor, **when** this story lands, **then** `"photo"` has moved
   **out of `shidduchim/entityDescriptor.ts`'s `pendingTabs` and into its `tabs`** in the same
   diff, and `entity360/registry.stubs.test.ts`'s pinned `shidduchim` row has been updated to
   match.
   **This is the AC an earlier draft of this story had no task for at all** — it built
   `PhotoTab.tsx` and stopped, so the tab shipped built-and-unmounted.
   **Fails, loudly:** leaving `"photo"` in *both* arrays raises `tab-key-duplicated`
   (`entity360/ad24Conformance.ts:520-527`) and fails
   `npx vitest run src/components/atomic-crm/entity360`.
   **Fails, silently — the mistake this AC exists to prevent:** never touching the descriptor.
   `keys(tabs) ∪ pendingTabs` still equals the canonical row, so the validator says nothing
   (`ad24Conformance.ts:571-590`), the build is green, and the Photo tab simply never appears —
   AC-1 unsatisfiable. The guard test's hand-off note (b)
   (`entity360/ad24Conformance.guard.test.ts:37-38`) states the rule.

## Tasks / Subtasks

- [x] **Task 1 — Schema** (AC: 2, 3, 4, 6)
  - [x] `supabase/schemas/01_tables.sql`: drop `resumes.photos` (`:316`); add
        `public.resume_photos (id bigint generated by default as identity primary key,
        account_id bigint not null, resume_id bigint not null, path text not null,
        uploaded_at timestamptz not null default now(),
        visibility text not null default 'shared'
        check (visibility in ('shared','private_parent')), hidden_at timestamptz)`.
        FK `(account_id, resume_id)` → `resumes(account_id, id) on delete cascade`, matching the
        composite-FK pattern already used for `reference_links.resume_id`
        (`01_tables.sql:718-720`) — it is possible because of
        `resumes_account_id_id_key unique (account_id, id)` (`:653-654`).
        Add `alter table public.resume_photos add constraint resume_photos_account_id_fkey
        foreign key (account_id) references public.accounts(id) on delete cascade;` alongside it,
        and an index on `account_id` (`:797` is the shape).
  - [x] Consider the `entity_files_storage_path_scope_check` precedent (`:623-626`):
        `check (path like account_id::text || '/%')` makes the two-phase upload's consistency a
        database fact — if the caller switched context between the storage PUT and this INSERT,
        the row is rejected rather than written with a path into another account's folder. Add
        the equivalent here; it is one line and it is the whole reason that constraint exists.
  - [x] `supabase/schemas/04_triggers.sql`: attach the existing `set_account_id_default()`
        trigger to `resume_photos` (`:160-172` is the block of existing `set_<table>_account_id`
        triggers — copy one; do not write a bespoke function).
  - [x] **`supabase/schemas/04_triggers.sql`, household scope — decide explicitly, do not skip.**
        `enforce_household_scope()` is attached to exactly 11 tables today
        (`04_triggers.sql:182-244`), and `supabase/tests/household_scope_lift.sql:56-64` asserts
        that count as a catalog fact, with the literal `= 11` at `:58`.
        **Recommendation: attach it** — `validate_resume_photos_household_scope`, before insert
        or update of `account_id`, named so it sorts after every `set_…` trigger ('v' > 's';
        `04_triggers.sql:186-201` explains why the name matters) — because a photo of a suggested
        person is household data with no shadchanus meaning, unlike `entity_files`. **Then bump
        `household_scope_lift.sql:57-58` by one in the same diff, both the literal and the
        assertion's own name string — read the current value first rather than writing `12`
        from this sentence.** (5.4 is the first of the three, so on an untouched tree it is
        genuinely 11 → 12; 5.5 and 5.6 each add one after.) If you instead decide to exclude it, record that
        deliberately as a `comment on table` in `01_tables.sql`, exactly as `entity_files` does
        at `:628-632` — an unexplained absence is the failure mode this bullet exists to prevent.
        **This literal is contested with Stories 5.5 and 5.6, which each also add a household
        table. Only one of the three can be in flight at a time; whoever lands second reads the
        current value rather than assuming 11.**
  - [x] `supabase/schemas/05_policies.sql`: `alter table public.resume_photos enable row level
        security` (**not** `force` — no table in this repo uses `force`, and a single forced
        table would diverge from the other 22; `05_policies.sql:560-561`). One `for all` policy;
        the predicate, per AC-3, is **"exclude `private_parent` rows from a caller whose role is
        `single`"**:
        `account_id = public.current_context_id() and (visibility = 'shared' or exists
        (select 1 from public.account_members am where am.id = public.current_member_id() and
        am.role <> 'single'))`, `with check` the same.
        **`current_context_id()` (AD-19) and `current_member_id()` (`02_functions.sql:242-259`)
        — never `current_account_id()`, which no longer exists.** Two properties to preserve
        deliberately: (a) `current_member_id()` is `SECURITY DEFINER` and already scopes to
        `(auth.uid(), current_context_id(), status = 'active')`, so the `exists` subquery must
        match on `am.id` and must NOT re-derive the membership from `auth.uid()` unscoped;
        (b) when the caller has no active membership `current_member_id()` returns null,
        `am.id = null` matches nothing, and the policy **fails closed** — keep it that way.
        `account_members`' own select policy (`05_policies.sql:145-150`) already permits reading
        rows of the active account, so the subquery resolves without a definer helper.
  - [x] `supabase/schemas/06_grants.sql`: `revoke all on table public.resume_photos from anon,
        authenticated;` then `grant select, insert, update, delete … to authenticated;` and
        `grant all … to service_role;` plus the sequence grants — follow the `entity_files` block
        at `:737-755` verbatim, including the sequence. RLS is the real gate; the grant only
        makes the table reachable at all. A table added without a grant block is reachable by
        nobody and every test fails with a permission error rather than an RLS one.
  - [x] `supabase/schemas/07_storage.sql`: add the `photos/`-prefix policies on the `documents`
        bucket (AC-4, AC-6) — **exactly three**:
        select requires `bucket_id = 'documents' and [1] = current_context_id()::text and
        [2] = 'photos' and ([3] = 'shared' or <caller role is not 'single', same subquery as
        above>)`; insert and delete require `bucket_id = 'documents' and [1] = context and
        [2] = 'photos' and [3] in ('shared','private_parent')`. **The `bucket_id` guard is not
        optional** — without it the folder predicate applies to every other bucket's objects too
        (`07_storage.sql:56-59`). Story 5.3 deliberately left every non-`resumes/` prefix
        deny-by-default so these can be written from scratch; permissive policies OR together,
        so a broader account-wide grant could never be tightened after the fact.
  - [x] Generate + hand-check migration: this is a genuine `DROP COLUMN` + `CREATE TABLE`, not a
        rename, and the plain generated form is correct. Confirm the RLS policy, the grants and
        the storage policies all landed in the same migration file — `db diff` is known to drop
        `REVOKE` statements and to be incomplete over `storage.objects` (AGENTS.md).
- [x] **Task 2 — Server-side write path** (AC: 2)
  - [x] `add_resume_photo(p_shidduchim_id bigint, p_path text, p_visibility text default 'shared')`
        and `hide_resume_photo(p_photo_id bigint)` RPCs in `02_functions.sql`, following
        `add_resume_file`'s (Story 5.3) shape and doc-comment style: `search_path ''`,
        account-ownership check against `current_context_id()`, `raise exception` on a bad
        target. `hide_resume_photo` sets `hidden_at = now()`; it never deletes.
  - [x] **Grants for both functions go in `06_grants.sql`, not `02_functions.sql`** — see
        `:226-241` for the `revoke all … from public, anon` + `grant execute … to authenticated,
        service_role` triple. A function added without it is unreachable.
- [x] **Task 3 — Frontend and the tab mount** (AC: 1, 2, 7)
  - [x] `src/components/atomic-crm/resumes/PhotoTab.tsx` + `PhotoRevealCard.tsx` (the `resumes/`
        folder Story 5.3 creates): grid of photos filtered `hidden_at is null`, each behind a
        reveal click; upload control with a visibility selector — a plain two-option radio group
        (`shared` / `private_parent`), `shared` preselected.
  - [x] Upload targets the `documents` bucket at the AC-4 path
        (`{account_id}/photos/{visibility}/{shidduchim_id}/{uuid}-{filename}`) — the bucket
        exists from Story 5.3; only the `photos/` policies (Task 1) are new. Sign per reveal
        click, never on grid load: pre-signing every card would defeat AC-1's whole point.
  - [x] **Move the tab key.** In `shidduchim/entityDescriptor.ts`: add
        `{ key: "photo", render: () => <PhotoTab /> }` to `tabs` **in canonical position**
        (`photo` follows `resume` — `ad24Conformance.ts:216-229`) and **delete `"photo"` from
        `pendingTabs`**. Do **not** add a `label`: "Photo" is already the i18n default
        (`entity360/tabKeys.ts:50`, `providers/commons/englishCrmMessages.ts:390`), and an
        override would need a "why THIS entity deviates" comment
        (`entity360/entityDescriptor.ts:97-105`) for a deviation that does not exist.
  - [x] **`render` is arity-zero** (`entityDescriptor.ts:106-112`). `PhotoTab` reaches the
        shidduch through `useRecordContext()` — `EntityShow` mounts inside `ShowBase`, so a
        `RecordContext` always exists. Do not thread the record in as a prop.
  - [x] Update `entity360/registry.stubs.test.ts`'s pinned `shidduchim` `pendingTabs` row
        (`:36-50`) — it loses `"photo"`.
- [x] **Task 4 — Types, providers, i18n**
  - [x] `types.ts`: add `ResumePhoto` (`id`, `account_id`, `resume_id`, `path`, `uploaded_at`,
        `visibility`, `hidden_at`) and **remove `photos?: unknown` from `Resume`** (`:428`) — the
        column no longer exists.
  - [x] `providers/supabase/dataProvider.ts` (custom methods for the two RPCs) **and**
        `providers/fakerest/dataProvider.ts` (AD-10 lockstep — every custom method exists in both
        providers; `:808-880` shows the three existing ones), plus a FakeRest generator entry so
        the demo mode has photos to render.
  - [x] **Both i18n catalogues** — `englishCrmMessages.ts` **and** `frenchCrmMessages.ts` — for
        this story's content strings (Reveal / Hide affordances, the visibility radio labels and
        their explanatory copy, empty state, upload errors). `i18nProvider` runs
        `allowMissing: true`, so an English-only key falls back silently and no test catches it.
        **No `crm.entity360.tab.*` key is needed** — all 15 tab labels already ship
        (`englishCrmMessages.ts:381-397`).
  - [x] `account_has_domain_data()` (`02_functions.sql:842-860`) and its hand-maintained FakeRest
        mirror `providers/fakerest/internal/accountDomainData.ts:19-32` — **check, then most
        likely leave alone.** `resume_photos` FKs to `resumes`, which both already check, so a
        photo cannot exist without a `resumes` row and the predicate is already true. Record that
        reasoning in a one-line comment beside the new table rather than adding a redundant
        `exists` clause. If you do add one, **both** the SQL function and `DOMAIN_RESOURCES` move
        together — the file's own comment says the mirror is maintained by hand and nothing tests
        the pair.
- [x] **Task 5 — Tests** (AC: 3, 4, 6)
  - [x] The negative RLS test from AC-3 and the storage-level negative test from AC-4, as a new
        pair `supabase/tests/resume_photos.{sql,test.ts}` (or added to 5.3's
        `documents_storage` pair). **Every `.sql` suite in that directory has a paired `.test.ts`
        runner — 13 pairs at HEAD, no exceptions.** A `.sql` file with no runner never executes.
        Copy `entity_files.test.ts`'s shape (`dbSuiteHelpers.ts`'s `DB_URL` /
        `bailIfDbUnreachable`, one named test per emitted result row).
  - [x] Re-run `supabase/tests/household_scope_lift.sql` and
        `supabase/tests/context_rls_hardening.sql` — AC-6 and Task 1's trigger decision are both
        asserted there and nowhere else.
  - [x] Component tests for `PhotoTab` / `PhotoRevealCard`: reveal-on-click, no image request
        before the click, hidden rows absent, visibility selector defaults to `shared`.
        **Stack:** `vitest-browser-react`'s `render` in Chromium with `CoreAdminContext` +
        `TestMemoryRouter` from `ra-core` and the FakeRest provider — copy
        `entity360/tabs/FilesTab.test.tsx:1-16`. **React Testing Library is not a dependency of
        this repo**; do not import `@testing-library/react`.
  - [x] `make typecheck && npm run lint && make test`, plus `npm run test:unit:db` (needs
        `make start`).

## Dev Notes

### The `single` role already exists — this story is not gated on Epic 2

An earlier draft of this story carried a "Dependency on Epic 2's role vocabulary" note asserting
that `account_members.role` checks only `('parent_admin','helper','self_manager','shadchan')` and
that **"no `'single'` value exists yet"**, so this story's RLS could not pass its negative test
until Epic 2 landed. **That is false at HEAD.** `01_tables.sql:153-155` reads:

```sql
constraint account_members_role_check check (
    role in ('parent_admin', 'single', 'helper', 'self_manager', 'shadchan')
),
```

Epics 1–3 are built and deployed. `single` is a real, invitable role — Story 2.7's
`create_invite()` / `handle_new_user()` can bind one. Write the negative test against a genuine
`single`-role membership, today, and delete any "blocked on Epic 2" reasoning you find.

### This does not wait for Epic 6 either

Epic 6 ("The Single's Access") generalises row/field-level scoping for a single across the whole
app (Stories 6.2, 6.3) and lands **after** Epic 5. This story does not depend on it: it adds a
narrow, self-contained role check directly on `resume_photos`. Epic 6's general work is a
different surface — `05_policies.sql:270-281` records, in writing, the still-open window on
`interactions` (a `single`-role membership reads the full candid timeline until Epic 6 narrows
that one join). `resume_photos` closes its own window from day one and is unaffected either way.
Story 5.5 (Medical) uses the same self-contained pattern.

### Why the visibility is in the object key

Putting `{visibility}` at path segment 3 is what makes AC-4 expressible at all: storage policies
can only reason about the object key (`storage.foldername(name)`), never about a row in
`resume_photos`. The cost is AC-4's stated consequence — a visibility change means hide +
re-upload, because moving the object would require an UPDATE policy that AC-6 forbids. That trade
is deliberate; the alternative (an UPDATE policy) is the exact shape
`context_rls_hardening.sql:130-139` calls out as letting a tenant move an object across the
account boundary.

### Files this story touches that are easy to miss

`supabase/schemas/04_triggers.sql` (both the `set_…` trigger and the household-scope decision) ·
`supabase/schemas/06_grants.sql` (table, sequence, and two functions) ·
`supabase/tests/household_scope_lift.sql:56-64` (the `= 11` literal) ·
`supabase/tests/resume_photos.test.ts` (a `.sql` suite with no runner never executes) ·
`entity360/registry.stubs.test.ts` (pinned `pendingTabs` row) ·
`registry.json` (`scripts/generate-registry.mjs` globs every non-test source file under
`src/components/atomic-crm/**`; `.husky/pre-commit` regenerates) ·
both i18n catalogues · `types.ts` · both dataProviders + the FakeRest generator.

### Migration workflow

Edit `supabase/schemas/*` (source of truth), then
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f resume_photos`, hand-check
the generated file, then `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
Never `db reset` or `db push`. The `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix is required —
without it every `npx supabase` call hangs on the keyring.

### Project Structure Notes

- `resume_photos` lives beside `resumes` in the schema files (same section), not as a new
  top-level concept.
- Frontend components live in the `resumes/` folder Story 5.3 creates.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.4]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-1 — :57-60] —
  RLS row-granularity reasoning behind the table split.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-2 — :62-65] —
  role vocabulary; `single` is one of the five and exists at HEAD.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-9 — :98-101] —
  "Photo inclusion is the sharer's choice" (AC-5); no raw URL to a recipient.
- [Source: supabase/schemas/01_tables.sql:153-155] — `account_members_role_check` already permits
  `'single'`.
- [Source: supabase/schemas/01_tables.sql:584-632] — `entity_files`: the precedent for a narrowing
  visibility constraint, the storage-path scope check, and a documented household-scope exclusion.
- [Source: supabase/schemas/07_storage.sql:46-91] — the `entity-files` bucket and its
  "deliberately no UPDATE policy" comment (`:61-67`).
- [Source: supabase/tests/context_rls_hardening.sql:130-146] — the table-wide no-UPDATE-policy
  invariant on `storage.objects` (AC-6).
- [Source: supabase/tests/household_scope_lift.sql:56-64] — the `enforce_household_scope` trigger
  count this story must reconcile.
- [Source: supabase/schemas/02_functions.sql:242-259] — `current_member_id()`, the caller-
  resolution function these policies reuse.
- [Source: _bmad-output/implementation-artifacts/1-3-rename-children-to-singles.md#AC-5] —
  `private_child` → `private_single`, the vocabulary whose subset this story reuses.
- [Source: src/components/atomic-crm/entity360/ad24Conformance.guard.test.ts:32-48] — hand-off
  note (b): a story that builds a tab moves its key in the same diff.
- [Source: .claude/rules/security-triggers.md] — RLS policies, migrations and file-system
  operations are all explicit triggers; dispatch SECURITY-REVIEWER on this diff.

## Dev Agent Record

### Agent Model Used

Claude (bmad-dev-story workflow), STACK_ID=3 / STACK_OWNER=5-4.

### Debug Log References

- `npx supabase db diff --local` was run three times (before applying, once to check the truncated
  policy name, once to verify after applying) to isolate a pre-existing, unrelated diff artifact:
  even with a zero-change tree, `db diff` re-emits a drop+recreate of `reference_links_summary` /
  `shadchan_stats` / `shidduchim_summary` / `singles_summary` (`security_invoker` stripped, per the
  repo's known `db diff`-and-views quirk, already hand-fixed once in 5.2's and once in 5.3's
  migrations). Confirmed via `pg_get_viewdef`/`pg_class.reloptions` that the live views already
  match `03_views.sql` exactly (byte-identical semantics, `security_invoker=on` intact) — the
  generated migration excludes those four statements entirely.
- The RLS policy name `"Resume photos scoped to account, private_parent hidden from single"` is 68
  bytes — over Postgres's 63-byte identifier limit — and got silently truncated
  (`NOTICE (42622): ... will be truncated to "... from sin"`). Renamed to
  `"Resume photos scoped to account, single sees only shared"` (56 bytes) in `05_policies.sql`
  before regenerating the migration, so the declared name and the applied name match exactly.
- `db diff` emitted no grant/revoke statements at all for the two new RPCs
  (`add_resume_photo`/`hide_resume_photo`) and dropped the table-level `REVOKE` for
  `resume_photos` (AGENTS.md's documented gap) — unlike 5.3's `add_resume_file`, whose function
  grant WAS captured, so this diff tool's function-ACL coverage is inconsistent, not a blanket
  miss. Verified live before hand-fixing: `authenticated` held TRUNCATE/TRIGGER/REFERENCES on
  `resume_photos` (TRUNCATE bypasses RLS), the identity sequence had no grant for
  `authenticated`/`service_role` at all (blocking every INSERT), and `anon` could EXECUTE both new
  functions. Hand-added the exact `06_grants.sql` block (table + sequence + both functions) to the
  migration; re-verified via `information_schema.role_table_grants` / `has_sequence_privilege` /
  `has_function_privilege` that the live grants now match the declared schema exactly.
- A second, undocumented `enforce_household_scope`-count literal was found by test failure, not by
  the story text: `supabase/tests/context_resolution.sql:638-639` also asserted "exactly 11
  tables" — bumped to 12 alongside `household_scope_lift.sql`'s own literal.
- `supabase migration up --local` applied the new migration cleanly; `npm run test:unit:db` (17
  files, 523 tests) passed afterward, including `context_rls_hardening`/`household_scope_lift`
  (the invariants this story's trigger/storage decisions could have broken) and the new
  `resume_photos` suite (22 checks). Also ran `make start-supabase-e2e STACK_ID=3` +
  `make test STACK_ID=3` (1965 tests, full suite incl. DB) against a **freshly migrated** stack
  built from `supabase/migrations/**` from scratch, confirming the hand-fixed grants are correct
  from a cold apply, not just after my manual live-DB patch — then `make stop-supabase-e2e
  STACK_ID=3`.

### Completion Notes List

- Schema: `resumes.photos jsonb` dropped; new `public.resume_photos` table (one row per photo,
  `visibility` narrowed to `shared`/`private_parent` — `private_single` excluded by CHECK, the
  uploader is the process manager), `resume_photos_storage_path_scope_check` (entity_files
  precedent), `set_resume_photos_account_id` + `validate_resume_photos_household_scope` triggers
  (attached — a photo of the suggested person is household data, unlike `entity_files`). Bumped
  `enforce_household_scope`'s catalog-fact literal 11 → 12 in **both**
  `household_scope_lift.sql` (named by the story) **and** `context_resolution.sql` (found by test
  failure, not named by the story). Deliberately NOT added to `account_has_domain_data()` /
  `accountDomainData.ts` — recorded as a `comment on table` (FKs to `resumes`, which both already
  check).
- RLS: one `for all` policy on `resume_photos` — `account_id = current_context_id() and
  (visibility = 'shared' or exists(... am.id = current_member_id() and am.role <> 'single'))` —
  fails closed when the caller has no active membership. Self-contained per-table role check, not
  a dependency on Epic 6.
- Storage: three new `photos/`-prefix policies (select/insert/delete, no update — AC-6) on the
  existing `documents` bucket (Story 5.3), select narrowed by the same role check as the table
  policy, insert/delete narrowed only to a legal visibility value (matches the story's literal AC-4
  spec verbatim — no role check on insert/delete, symmetric with the `resumes/` prefix's own
  shape). Updated `documents_storage.sql`'s deny-by-default fixture from a `photos/…` path (no
  longer deny-by-default now that this story defines it) to a `sections/…` path, preserving the
  same "undefined prefix" invariant without touching photos-specific behavior.
- DB functions: `add_resume_photo(p_shidduchim_id, p_path, p_visibility default 'shared')` —
  upserts the parent `resumes` row (a shidduch may get its first photo before its first resume
  file) via an `ON CONFLICT ... DO UPDATE ... RETURNING` no-op-update idiom, then inserts the photo
  row; `hide_resume_photo(p_photo_id)` — sets `hidden_at = now()`, never deletes. Both SECURITY
  INVOKER, account-ownership guarded, grants in `06_grants.sql`.
- New `resume_photos.{sql,test.ts}` pair (22 checks): AC-3's exact negative test (one account, a
  `parent_admin` + a `single` member, one `shared` + one `private_parent` photo — `single` sees
  only the shared row), AC-4's storage negative test (single reaches the shared object, not the
  private_parent one; a third, fully unrelated account reaches neither), a policy-shape check
  (exactly 3 `Documents photos …` policies), the two CHECK constraints, `add_resume_photo`'s
  upsert-not-duplicate behaviour and account-ownership guard, `hide_resume_photo`'s soft-hide
  contract, and the `anon`-has-nothing posture.
- Frontend: `resumes/PhotoTab.tsx` (upload control with a `shared`/`private_parent` radio group,
  `shared` preselected; two-step lookup — `resumes` by `shidduchim_id` to resolve `resume_id`,
  then `resume_photos` filtered `resume_id` + `hidden_at@is: null`, the second query `enabled`
  only once `resume_id` resolves) + `resumes/PhotoRevealCard.tsx` (hidden behind "Reveal" by
  default; the signed URL is minted only on click via `signResumePhotoUrl`, never on mount — no
  `<img>` in the DOM and no signed-URL request before the click; "Hide" calls `hideResumePhoto`).
  `PhotoTab`'s `render` is arity-zero, reaching the shidduch via `useRecordContext()`, exactly like
  `ResumeTab`.
- Provider: `providers/supabase/resumePhotos.ts` (`uploadResumePhoto`, `signResumePhotoUrl`,
  `hideResumePhoto`, modelled on `resumes.ts`) wired into `dataProvider.ts`'s custom-methods
  overlay; mirrored in `providers/fakerest/internal/resumePhotos.ts` +
  `providers/fakerest/dataProvider.ts` (AD-10) with its own blob-URL map. FakeRest generator seeds
  `db.resume_photos = []` (matches `entity_files`' own "seeded empty, the demo build must not
  crash" precedent) — no fabricated demo photo binary content, since nothing in the ACs requires
  pre-seeded demo images and inventing one would add untested complexity for a cosmetic nicety.
- Descriptor: `shidduchim/entityDescriptor.tsx` — `{ key: "photo", render: () => <PhotoTab /> }`
  added to `tabs` in canonical position (after `resume`), `"photo"` removed from `pendingTabs`, in
  the same diff. `entity360/registry.stubs.test.ts`'s pinned `shidduchim` row updated to match. No
  `label` override (already the i18n default).
- Types: `ResumePhoto`, `ResumePhotoVisibility` added; `Resume.photos?: unknown` removed (its sole
  definition and sole consumer, both go together — grepped clean, zero other references).
- i18n: `crm.entity360.photo.*` (empty/error/upload/uploadError/reveal/revealError/hide/hideError/
  alt/visibilityOption.{shared,private_parent}) added to both `englishCrmMessages.ts` and
  `frenchCrmMessages.ts`. No `crm.entity360.tab.*` key needed ("Photo" was already the shipped
  default).
- Tests: `PhotoRevealCard.test.tsx` (hidden-by-default with zero signed-URL calls before reveal,
  reveal mints and shows the image, hide calls the sole write path, error states) and
  `PhotoTab.test.tsx` (a real FakeRest round trip: empty state, visibility default, upload-then-
  reveal with no `<img>`/no sign call before the click, uploading with `private_parent` selected,
  hide removes the card from the grid while the row survives with `hidden_at` set).
- Gates run and green: `make typecheck`, `npm run lint` (0 warnings), `npx vitest run` (190 files /
  1965 tests), `make build`, `npx prettier --check .`, `check-retired-names`,
  `check-suppressions`, `check-route-convention`, `check-tailwind-arbitrary-var` (all `EXIT=0`),
  `npm run test:unit:db` (17 files / 523 tests, including the new suite), `supabase db diff
  --local` (hand-verified, see Debug Log), `make test STACK_ID=3` against a fresh
  `start-supabase-e2e STACK_ID=3` stack (1965 tests), stack stopped afterward.
- Not done / deferred, by design: no demo-mode seeded photo (see Provider note above); no
  role-based visibility filtering added to the FakeRest mirror (matches `entity_files`' own
  precedent — FakeRest does not replicate this RLS nuance; only the real backend enforces it,
  consistent with the Epic 6 carve-out already recorded for `interactions`).

### File List

- `supabase/schemas/01_tables.sql` (`resumes.photos` dropped; new `resume_photos` table + FKs +
  index + `comment on table`)
- `supabase/schemas/02_functions.sql` (`add_resume_photo`, `hide_resume_photo`)
- `supabase/schemas/04_triggers.sql` (`set_resume_photos_account_id`,
  `validate_resume_photos_household_scope`)
- `supabase/schemas/05_policies.sql` (`resume_photos` RLS enable + policy)
- `supabase/schemas/06_grants.sql` (table + sequence + both function grants)
- `supabase/schemas/07_storage.sql` (three `photos/`-prefix policies on `documents`)
- `supabase/migrations/20260730041150_resume_photos.sql` (new; hand-adjusted per Debug Log)
- `supabase/tests/resume_photos.sql` (new)
- `supabase/tests/resume_photos.test.ts` (new)
- `supabase/tests/documents_storage.sql` (deny-by-default fixture moved off the now-defined
  `photos/` prefix onto `sections/`)
- `supabase/tests/household_scope_lift.sql` (catalog-fact literal 11 → 12)
- `supabase/tests/context_resolution.sql` (the same literal, a second, undocumented occurrence —
  found by test failure)
- `src/components/atomic-crm/types.ts` (`ResumePhoto`, `ResumePhotoVisibility`; `Resume.photos`
  removed)
- `src/components/atomic-crm/resumes/PhotoTab.tsx` (new)
- `src/components/atomic-crm/resumes/PhotoTab.test.tsx` (new)
- `src/components/atomic-crm/resumes/PhotoRevealCard.tsx` (new)
- `src/components/atomic-crm/resumes/PhotoRevealCard.test.tsx` (new)
- `src/components/atomic-crm/providers/supabase/resumePhotos.ts` (new)
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` (wires `uploadResumePhoto` /
  `signResumePhotoUrl` / `hideResumePhoto`)
- `src/components/atomic-crm/providers/fakerest/internal/resumePhotos.ts` (new)
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` (AD-10 mirror wiring)
- `src/components/atomic-crm/providers/fakerest/dataGenerator/types.ts` (`Db.resume_photos`)
- `src/components/atomic-crm/providers/fakerest/dataGenerator/shidduchim.ts` (seeds
  `db.resume_photos = []`)
- `src/components/atomic-crm/shidduchim/entityDescriptor.tsx` (`photo` moved into `tabs`)
- `src/components/atomic-crm/entity360/registry.stubs.test.ts` (pinned `shidduchim` row updated)
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` (`crm.entity360.photo.*`)
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` (`crm.entity360.photo.*`)
- `registry.json` (regenerated — 4 new source files)

## Change Log

- 2026-07-30: Story implemented — `resume_photos` table (per-photo RLS, role-narrowed to exclude
  `single` from `private_parent`), `photos/`-prefix storage policies on the `documents` bucket
  (select role-narrowed, insert/delete visibility-only, no update), `add_resume_photo()` /
  `hide_resume_photo()` server-side functions, `resumes/PhotoTab.tsx` + `PhotoRevealCard.tsx`
  frontend (reveal-on-click, visibility radio group), `photo` moved from `pendingTabs` into `tabs`
  on the `shidduchim` descriptor. Hand-fixed two `db diff` gaps (dropped table/sequence/function
  grants; a truncated policy name) and one undocumented duplicate catalog-fact literal
  (`context_resolution.sql`). All gates green (typecheck, lint, full unit suite incl. new
  `resume_photos` DB suite, build, prettier, four CI guards, `make test STACK_ID=3` against a
  fresh stack). Status -> review.
