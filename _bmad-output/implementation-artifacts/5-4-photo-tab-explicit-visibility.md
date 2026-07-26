# Story 5.4: Photo tab with explicit visibility

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want the photo handled carefully,
so that it is never exposed by accident.

## Position in Epic 5

Depends on **5.1** (the `photo` tab slot) and **5.3** (the `documents` storage bucket and its
path convention — reuse the bucket; this story adds only its own `photos/`-prefix policies,
which 5.3 deliberately left undefined).

## Design decision: photos are their own table, not a JSON blob

`resumes.photos jsonb` today is a single, whole-row-visible blob. Postgres RLS enforces at row
granularity: a `jsonb` array cannot have per-element visibility enforced by policy — the entire
`resumes` row is either visible to a caller or it is not. AD-1 ("Isolation is enforced in
Postgres, never in the application") makes this decisive: **per-photo visibility that must
survive a client bug requires per-photo *rows*.** This story replaces `resumes.photos jsonb`
with a new table, `public.resume_photos`, one row per photo, each carrying its own `visibility`.
This is a genuine replacement, not an addition — `resumes.photos` is dropped in the same
migration (NFR-14).

`visibility` reuses the **existing** `shidduchim.visibility` vocabulary (`shared |
private_parent | private_single`, already `private_single` post Epic 1 Story 1.3) rather than
inventing a new one — but constrained to the **subset that means something for a photo of the
suggested person**: `('shared', 'private_parent')`. `private_single` ("only the single sees
it") has no coherent meaning here — the uploader is the process manager, and a photo hidden
from the manager who uploaded it is nonsense — so the check constraint excludes it rather than
carrying a dead state. Same vocabulary, no second one to reconcile; just fewer legal values.

**Explicit reveal is a UI affordance, not a permission tier.** It is a deliberate-friction,
click-to-view pattern (distinct from the `visibility` column, which *is* a permission tier). Do
not conflate the two: reveal state is ephemeral client state (resets on navigation); visibility
is a persisted, RLS-enforced fact.

## Acceptance Criteria

1. **Given** a suggestion with one or more photos, **when** I open Photo, **then** each photo is
   hidden behind an explicit "Reveal" affordance by default — clicking it displays that photo;
   the reveal state is local to the current page view and resets on navigating away and back.
2. **Given** the Photo tab, **when** I upload a photo, **then** I choose its visibility (`shared`
   default, `private_parent` to exclude the single) at upload time; I can replace a photo
   (uploads a new row) or hide one (sets `hidden_at`, a soft-hide — a hidden photo never renders
   anywhere, including in any future share, and is excluded by a plain `hidden_at is null`
   filter, never deleted outright).
3. **Given** a photo whose `visibility = 'private_parent'`, **when** a viewer whose
   `account_members.role = 'single'` reads `resume_photos`, **then** RLS returns zero rows for
   that photo. **Negative test:** seed one account with a `parent_admin` member and a `single`
   member, one `private_parent` photo and one `shared` photo; assert the `single` member's
   client sees only the `shared` row.
4. **Given** the storage objects themselves, **when** a `single`-role member queries the
   `documents` bucket directly (bypassing the table), **then** they still cannot reach a
   `private_parent` photo: the path embeds the visibility
   (`{account_id}/photos/{visibility}/{shidduchim_id}/{uuid}-{filename}`) and the `photos/`
   storage policies grant a `single`-role member select **only** under the `photos/shared/`
   prefix. Without this, the table RLS of AC-3 is decorative — Story 5.3's policies cover only
   the `resumes/` prefix precisely so this story can write stricter rules for its own.
   **Negative test (storage):** the `single` member's client cannot download or list the
   `private_parent` object but can download the `shared` one; a second account can reach
   neither. Consequence, stated so nobody "fixes" it later: changing a photo's visibility after
   upload is not supported in this story — hide it (AC-2) and re-upload.
5. **Given** the resume forward action (Story 5.7's rail), **when** it is built, **then**
   photos are structurally outside it: the forward action reads only `resumes.files`;
   `resume_photos` lives in its own table and storage prefix, never in `resumes.files`. The
   executable payload test lives in Story 5.7 (which builds the action after this story) — this
   story's contribution is the structural separation, asserted here by schema shape alone.

## Tasks / Subtasks

- [ ] **Task 1 — Schema** (AC: 2, 3, 4)
  - [ ] `supabase/schemas/01_tables.sql`: drop `resumes.photos`; add
        `public.resume_photos (id, account_id, resume_id, path, uploaded_at, visibility text
        check (visibility in ('shared','private_parent')) default 'shared',
        hidden_at timestamptz)`. FK `resume_id` → `resumes(account_id, id)`, matching the
        composite-FK pattern already used for `reference_links.resume_id`
        (`01_tables.sql:722-723`).
  - [ ] `supabase/schemas/04_triggers.sql`: reuse the existing `set_account_id_default()` trigger
        pattern for `resume_photos.account_id` (do not write a bespoke one — every other
        account-scoped table uses the same trigger; find it and attach it).
  - [ ] `supabase/schemas/05_policies.sql`: `alter table public.resume_photos enable row level
        security`; policy `for all` — the predicate, per AC-3, is **"exclude `private_parent`
        rows from a caller whose role is `single`"**:
        `account_id = public.current_context_id() and (visibility = 'shared' or exists
        (select 1 from public.account_members am where am.id = public.current_member_id() and
        am.role <> 'single'))`, `with check` the same. **`current_context_id()` (AD-19) and
        `current_member_id()` (Story 3.5) — never `current_account_id()`, which Epic 2 Story
        2.1 deletes outright.** This also depends on Epic 2 having added `'single'` to
        `account_members_role_check` — verify with
        `grep -n "account_members_role_check" supabase/schemas/01_tables.sql` before writing the
        policy; if `'single'` is not yet a valid role, Epic 2 has not landed and this story
        cannot proceed.
  - [ ] `supabase/schemas/07_storage.sql`: add the `photos/`-prefix policies on the `documents`
        bucket (AC-4): select requires `[1] = current_context_id()::text and [2] = 'photos' and
        ([3] = 'shared' or <caller role is not 'single', same subquery as above>)`;
        insert/delete require `[1] = context and [2] = 'photos' and [3] in
        ('shared','private_parent')`. Story 5.3 deliberately left every non-`resumes/` prefix
        deny-by-default so these can be written from scratch — permissive policies OR together,
        so a broader account-wide grant could never be tightened after the fact.
  - [ ] Generate + hand-check migration: this is a genuine `DROP COLUMN` + `CREATE TABLE`, not a
        rename.
- [ ] **Task 2 — Server-side write path** (AC: 2)
  - [ ] `add_resume_photo(p_shidduchim_id, p_path, p_visibility default 'shared')` and
        `hide_resume_photo(p_photo_id)` RPCs in `02_functions.sql`, following `add_resume_file`'s
        (Story 5.3) shape and doc-comment style.
- [ ] **Task 3 — Frontend** (AC: 1, 2)
  - [ ] `src/components/atomic-crm/resumes/PhotoTab.tsx` + `PhotoRevealCard.tsx`: grid of
        photos, each behind a reveal click; upload control with a visibility selector — a plain
        two-option radio group (`shared` / `private_parent`), `shared` preselected.
  - [ ] Upload targets the `documents` bucket at the AC-4 path
        (`{account_id}/photos/{visibility}/{shidduchim_id}/{uuid}-{filename}`) — the bucket
        exists from Story 5.3; only the `photos/` policies (Task 1) are new.
- [ ] **Task 4 — Tests** (AC: 3, 4)
  - [ ] The negative RLS test from AC-3 in `supabase/tests/` (new or alongside the resume tests
        from 5.3).
  - [ ] The storage-level negative test from AC-4 (single-role member: `private_parent` object
        unreadable/unlistable, `shared` object readable; foreign account: neither), asserted
        against the running local Supabase storage API, not mocked.

## Dev Notes

### Dependency on Epic 2's role vocabulary

`account_members.role` today (pre-Epic-2) checks `('parent_admin', 'helper', 'self_manager',
'shadchan')` — **no `'single'` value exists yet.** AD-2's target vocabulary is `parent_admin |
single | helper | self_manager | shadchan`; adding `'single'` is Epic 2's job (Story 2.2), not
this story's. This story's RLS policy is written against the AD-2 target vocabulary and will not
compile/pass its negative test until Epic 2 has landed — stated here as a hard dependency, not
discovered mid-implementation.

### This does not wait for Epic 6

Epic 6 ("The Single's Access") generalises row/field-level scoping for a single across the whole
app (Stories 6.2, 6.3) and lands **after** Epic 5. This story does not depend on Epic 6: it adds
a narrow, self-contained role check directly on `resume_photos`, exactly as `account_members.role`
already permits today, independent of whatever general dignity-floor plumbing Epic 6 later adds
to `shidduchim` itself. The same self-contained pattern is used again in Story 5.5 (Medical).

### Migration workflow

Edit `supabase/schemas/*` (source of truth), then
`DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f resume_photos`, hand-check
the generated file (a `DROP COLUMN` + `CREATE TABLE` here, not a rename — the plain generated
form is correct), then `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
Never `db reset` or `db push`.

### Project Structure Notes

- `resume_photos` lives beside `resumes` in the schema files (same section), not as a new
  top-level concept.
- Frontend components live in the `resumes/` folder Story 5.3 creates.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.4]
- [Source: ARCHITECTURE-SPINE.md#AD-1] — RLS row-granularity reasoning behind the table split.
- [Source: ARCHITECTURE-SPINE.md#AD-2] — target role vocabulary this story's RLS depends on.
- [Source: ARCHITECTURE-SPINE.md#AD-9] — "Photo inclusion is the sharer's choice" (AC-5).
- [Source: _bmad-output/implementation-artifacts/1-3-rename-children-to-singles.md#AC-5] —
  `private_child` → `private_single`, the vocabulary whose subset this story reuses.
- [Source: _bmad-output/implementation-artifacts/3-5-universal-activity-tab.md] —
  `current_member_id()`, the caller-resolution function this story's policies reuse.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
