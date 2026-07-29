# Story 5.6: Files and External links tabs

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want other documents and profile links kept separately,
so that the resume stays canonical.

## Position in Epic 5

Depends on **5.1** (which creates the real `shidduchim/entityDescriptor.ts` — the full descriptor
this story adds two tabs to — and mounts `shidduchim` on `buildEntityRoutes`) and on **Epic 3
Story 3.7** (the universal Files tab and its polymorphic `entity_files` storage) for the Files
half only.

The two keys this story owns are non-adjacent in the shidduch canonical row
(`entity360/ad24Conformance.ts:217-228`):
`overview, resume, photo, medical, **files**, diligence, **external-links**, notes, tasks, activity`.
Each is inserted at its own position; `diligence` sits between them and is **already declared by
5.1** (which puts `ShidduchReferencesSection.tsx` under it) — 5.10 later enriches that tab's
contents but does not own the key. Do not touch the `diligence` entry here.

**This is the only story in Epic 5 that moves *two* keys in one `entityDescriptor.ts` diff.**

## Two unrelated pieces of work, deliberately not merged

**Files** — Epic 3 Story 3.7 already shipped the generic, cross-entity Files tab:
`entity360/tabs/FilesTab.tsx` taking exactly `UniversalTabProps` (`{ targetType, targetId }` —
`entity360/tabs/types.ts:11-14`), the polymorphic `entity_files` table with per-file visibility,
and its own private `entity-files` bucket keyed
`{account_id}/{target_type}/{target_id}/{uuid}_{file_name}` — a keyspace that cannot collide with
Story 5.3's `documents` bucket. This story's job for Files is **wiring only**: declare the shidduch
descriptor's `files` tab as `FilesTab` with `targetType: "shidduch"`. It does **not** re-derive
file storage, a bucket, or RLS.

**Gate — verified green at HEAD, not a conditional.** `entity360/tabs/FilesTab.tsx` and
`public.entity_files` both exist; `entity_files_target_type_check` shipped at full four-value
parity (`'reference','shidduch','shadchan','single'`) from creation, and
`entity360/pendingDbWidenings.ts` is `[] as const`. **This story ships no DB widening for
`entity_files`** — if a generated migration contains an `entity_files_target_type_check` line,
something else went wrong; stop and read it. Re-confirm in one command before Task 2:
`grep -rn "FilesTab\|entity_files" src/components/atomic-crm/entity360/`.

**External links** — a genuinely new, narrow concept: a bookmark to an external profile (a
shidduch site, a social profile) with no file behind it. Scoped to `shidduchim` only, matching
the epic's own AC ("Given a suggestion…") — not made polymorphic across every entity, since no
other Epic 5 story asks for it on a single, shadchan or reference. This is a deliberate YAGNI
call: generalise it later if a future story actually needs it elsewhere.

## Acceptance Criteria

1. **Given** the shidduch descriptor, **when** this story lands, **then**
   `shidduchim/entityDescriptor.ts` declares a `files` tab rendering Story 3.7's `FilesTab` with
   `targetType: "shidduch"` and `targetId` = the record id — camelCase, both props, never
   `target_type` (`entity360/tabs/types.ts:11-14`) — **and** `"files"` is deleted from that
   descriptor's `pendingTabs` in the **same diff**. No shidduch-specific file storage or upload
   code is written in this story.
   *Failing looks like:* `"files"` present in both `tabs` and `pendingTabs` fires AD-24
   `tab-key-duplicated`; present in neither fires `tab-set-incomplete`. Either fails
   `npx vitest run src/components/atomic-crm/entity360` (`ad24Conformance.guard.test.ts`).
   Writing `target_type=` is an excess-property `tsc` error plus a missing required prop.
2. **Given** the shidduch descriptor, **when** this story lands, **then** it likewise declares an
   `external-links` tab rendering `ExternalLinksTab` at its canonical position (after
   `diligence`, before `notes`) **and** deletes `"external-links"` from `pendingTabs` in the same
   diff. **Building `ExternalLinksTab.tsx` without touching the descriptor is the defect this AC
   exists to prevent** — the tab would ship built and unmounted, reachable from nowhere.
   *Failing looks like:* the same two AD-24 codes as AC-1; and, if the entry is declared out of
   canonical relative order, `tab-order-drift`.
3. **Given** `entity360/registry.stubs.test.ts`, **when** the two keys move, **then** its pinned
   `shidduchim` row (`:36-50`, asserted at `:94-95` as `tabs toEqual []` plus the full 10-key
   `pendingTabs`) is updated in the **same diff**. That pin is *meant* to go red — it is the
   mechanism, not an obstacle. 5.1 and any tab story landing before this one will already have
   edited the same row; re-read it rather than assuming its Epic-3 shape.
4. **Given** a suggestion, **when** I add an external link (a URL + a short label), **then** it
   appears under the `external-links` tab, separate from Files and from the Resume; **and** a URL
   that does not parse is rejected before insert with a visible message, never silently dropped.
5. **Given** an external link, **when** it renders, **then** it opens in a new tab via
   `<a target="_blank" rel="noopener noreferrer">` — `noopener noreferrer` is non-negotiable
   here: it is what makes "share nothing back" true (no `window.opener` handoff, no referrer
   leaked to the linked site).
   *Failing looks like:* a rendered anchor whose `rel` omits either token; assert on the rendered
   attribute, not on the source string.
6. **Given** `shidduchim_external_links`, **when** its RLS is applied, **then** it is scoped to
   `account_id = public.current_context_id()` exactly like `shidduch_schools`
   (`05_policies.sql:223-226` — mirror the post-Epic-2 text, never the deleted
   `current_account_id()`) — no sensitivity tier, no role check (a URL bookmark is not sensitive
   data).
   *Failing looks like:* the cross-account negative test in Task 5 reading a row it does not own.
7. **Given** the new table, **when** the migration lands, **then** it carries **both** triggers
   `shidduch_schools` carries (`04_triggers.sql:89-91` `set_…_account_id`, `:234-236`
   `validate_…_household_scope`), **and** `supabase/tests/household_scope_lift.sql`'s
   `enforce_household_scope` trigger-count assertion is incremented by one — **in both the count
   and the assertion's own name string**, which repeats the number
   (`household_scope_lift.sql:56-64` — name string `:57`, literal `:58`). **Do not assume the
   literal is `11`.** It is `11` at HEAD;
   Stories 5.4 and 5.5 each add a household-scoped table before this one runs, so read the current
   value and add one. **And** the table is added to `public.account_has_domain_data()`
   (`02_functions.sql:842`) and to its hand-kept FakeRest mirror
   `providers/fakerest/internal/accountDomainData.ts`'s `DOMAIN_RESOURCES` (`:19-32`) — the SQL
   test goes red when they drift, the FakeRest mirror does not.
   *Failing looks like:* `npx vitest run supabase/tests` red on `household_scope_lift`.
8. **Given** the Resume tab (5.3) and Files tab, **when** both render for the same shidduch,
   **then** the resume's file versions never appear under Files — they live in a structurally
   separate table (`resumes.files`) and storage path, never the generic files table.

## Tasks / Subtasks

- [ ] **Task 1 — Re-confirm the Epic 3 gate** (AC: 1)
  - [ ] Run the one-line grep from "Two unrelated pieces of work". It is verified green at HEAD;
        this is a re-confirmation on the wave's actual tree, not a branch point. If it is somehow
        red, stop and report — do not build a stand-in `FilesTab`.
- [ ] **Task 2 — Wire the `files` tab** (AC: 1, 3, 8)
  - [ ] `shidduchim/entityDescriptor.ts`: add `{ key: "files", render: () => <FilesTab
        targetType="shidduch" targetId={…} /> }` at its canonical position, and **delete
        `"files"` from `pendingTabs`**. `render` is arity-zero — reach the record inside it via
        `useRecordContext()` (`entity360/entityDescriptor.ts:106-112`); `EntityShow` always
        mounts inside `ShowBase`, so a `RecordContext` exists.
  - [ ] Do **not** add a `label` to either tab: "Files" and "External links" are already the i18n
        defaults (`entity360/tabKeys.ts:47,53`, `englishCrmMessages.ts:387,393`), and an override
        would need a "why THAT entity deviates" comment
        (`entity360/entityDescriptor.ts:97-104`) for a deviation that does not exist. **Epic 5
        adds no `crm.entity360.tab.*` keys at all.**
  - [ ] Update `entity360/registry.stubs.test.ts`'s pinned `shidduchim` row in the same diff.
- [ ] **Task 3 — Schema for External links** (AC: 4, 6, 7)
  - [ ] `supabase/schemas/01_tables.sql`: `create table public.shidduchim_external_links (id
        bigint generated by default as identity primary key, account_id bigint not null,
        created_at timestamptz not null default now(), shidduchim_id bigint not null, url text
        not null, label text)`, placed in the shidduchim section next to `shidduch_schools`
        (`:406-419`); composite FK `(account_id, shidduchim_id)` → `shidduchim(account_id, id)`
        on delete cascade, mirroring `:736-740`; the two indexes at `:805-806`.
  - [ ] `supabase/schemas/04_triggers.sql`: **both** triggers, mirroring `shidduch_schools` —
        `set_shidduchim_external_links_account_id` (`before insert`, `set_account_id_default()`,
        beside `:89-91`) **and** `validate_shidduchim_external_links_household_scope`
        (`before insert or update of account_id`, `enforce_household_scope()`, beside `:234-236`).
        Triggers live here, never in `01_tables.sql`. The only sanctioned alternative to the
        second trigger is an explicit `comment on table` recording a deliberate exclusion, per the
        `entity_files` precedent (`01_tables.sql:628-632`) — and no such exclusion applies here: a
        shidduch is household-only, so its child table is too.
  - [ ] `supabase/schemas/05_policies.sql`: `alter table … enable row level security`; policy
        `"Shidduchim external links scoped to account"` — same `for all to authenticated using
        (account_id = public.current_context_id()) with check (…)` shape as
        `"Shidduch schools scoped to account"` (`:223-226`).
  - [ ] `supabase/schemas/06_grants.sql`: **two** blocks, not one — the table+sequence
        `revoke anon / grant all` pair beside `shidduch_schools` at `:158-160` and `:219-221`,
        **and** the later hardening restatement at `:618-619`
        (`revoke all … from anon, authenticated; grant select, insert, update, delete … to
        authenticated`). Missing the second leaves the table ungranted to `authenticated`.
  - [ ] `supabase/schemas/02_functions.sql`: add the table to `account_has_domain_data()`
        (`:842`). Function *grants* live in `06_grants.sql`, not here — re-check them if the
        function's signature changes (it does not here).
  - [ ] `supabase/tests/household_scope_lift.sql`: increment the `enforce_household_scope`
        trigger-count assertion **and its name string** (`:56-64`; name `:57`, literal `:58`).
        Read the current value first.
  - [ ] Generate + hand-check migration:
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f shidduchim_external_links`.
        New table — the generated form is fine as-is; confirm RLS, both triggers and both grant
        blocks landed in the same migration, and that **no `*_target_type_check` line** appears
        (see the gate). Then
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never
        `db reset` / `db push`.
- [ ] **Task 4 — Frontend for External links** (AC: 2, 4, 5)
  - [ ] `src/components/atomic-crm/shidduchim/ExternalLinksTab.tsx`: add/list/remove a link
        (URL + label), rendered as `target="_blank" rel="noopener noreferrer"`. Validate with
        `new URL(value)` in a `try`/`catch` before insert and surface the failure, per
        `.claude/rules/coding-style.md` ("Validate all user input… fail fast").
  - [ ] `shidduchim/entityDescriptor.ts`: declare the `external-links` tab rendering it, **and
        delete `"external-links"` from `pendingTabs`** — the same diff as the component. (AC-2.)
  - [ ] `types.ts`: add `export type ShidduchExternalLink = { … }`, PascalCase-singular per the
        `ShidduchSchool` precedent (`types.ts:356`).
  - [ ] FakeRest mirror per AD-10: `providers/fakerest/dataProvider.ts`,
        `providers/fakerest/dataGenerator/shidduchim.ts`, and
        `providers/fakerest/internal/accountDomainData.ts`'s `DOMAIN_RESOURCES` (AC-7).
  - [ ] Both i18n catalogues — `providers/commons/englishCrmMessages.ts` **and**
        `frenchCrmMessages.ts` — for the tab's own copy (add/remove/empty/error, the URL-invalid
        message). `i18nProvider` runs `allowMissing: true`, so a missing French key falls back to
        English **silently**; the pair is kept in lockstep by hand. **No `crm.entity360.tab.*`
        entry is added** (see Task 2).
- [ ] **Task 5 — Tests** (AC: 2, 4, 5, 6, 7)
  - [ ] `supabase/tests/shidduchim_external_links.sql` **plus its paired
        `shidduchim_external_links.test.ts` runner** — every `.sql` suite in `supabase/tests/` has
        one, 13 pairs at HEAD, no exceptions. Cross-account negative read, following
        `shidduch_schools`' coverage inside the existing suites line-for-line in structure.
  - [ ] Component test for `ExternalLinksTab`: empty / loading / error states, the rendered
        `rel="noopener noreferrer"` attribute (AC-5), and the invalid-URL rejection (AC-4).
  - [ ] Tab-strip test: rendering `EntityShow` for a shidduch shows `Files` and `External links`
        in canonical order. Assert on the **rendered strip**, not on the descriptor literal.
  - [ ] `make typecheck && npm run lint && npx vitest run && npm run test:unit:db`.
- [ ] **Task 6 — `registry.json`**
  - [ ] `ExternalLinksTab.tsx` is a new non-test source file under
        `src/components/atomic-crm/**`, so `scripts/generate-registry.mjs` picks it up and
        `registry.json` changes. `.husky/pre-commit` regenerates it; commit the result rather than
        leaving the tree divergent.

## Dev Notes

### Test stack — what the repo actually uses

Component tests run under **`vitest-browser-react` in Chromium**, with `TestMemoryRouter` for
anything routed — see `entity360/EntityShow.regions.test.tsx` and `EntityShow.test.tsx` for the
canonical `buildEntityRoutes({ List, Show: EntityShow })`-inside-`TestMemoryRouter` shape.
**React Testing Library is not a dependency of this repo** — do not import `@testing-library/react`.
Follow AAA and the naming rules in `.claude/rules/testing.md`.

### Reuse — the exact template for the new table

`shidduch_schools` is structurally identical to what External links needs: a simple,
account-scoped, shidduch-child table with no sensitivity tier. It spans **five** schema files, and
copying only the first is the failure mode this story guards against:

| File | `shidduch_schools` | Why it matters |
|---|---|---|
| `01_tables.sql:406-419`, FK `:736-740`, indexes `:805-806` | table + composite FK + indexes | the obvious half |
| `04_triggers.sql:89-91`, `:234-236` | `set_…_account_id` **and** `validate_…_household_scope` | forgetting the second breaks the household-scope invariant silently |
| `05_policies.sql:71`, `:223-226` | `enable row level security` + the policy | |
| `06_grants.sql:158-160`, `:219-221`, `:618-619` | three blocks | the third is a separate hardening restatement |
| `02_functions.sql:842` | `account_has_domain_data()` | plus its by-hand FakeRest mirror |

Copy its shape, not just its idea — same column ordering, same trigger pair, same policy wording,
so a future reader sees one consistent pattern across all of a shidduch's simple child tables.

### Project Structure Notes

- `shidduchim_external_links` lives in the schema files' shidduchim section, next to
  `shidduch_schools`.
- `ExternalLinksTab.tsx` lives in `shidduchim/`, not a new top-level folder — it is
  shidduch-specific by this story's own scope decision, unlike the polymorphic Files tab, which
  stays in `entity360/tabs/` and is only *referenced* from the descriptor here.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.6]
- [Source: _bmad-output/planning-artifacts/epic3-api-contract.md] — binding. §3 (`TabKey`, the
  tab-set conformance rule), §8 (`UniversalTabProps`), §0 (validation commands, vocabulary).
- [Source: _bmad-output/implementation-artifacts/3-7-universal-files-tab.md] — `FilesTab`,
  `entity_files`, the `entity-files` bucket this story wires against.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-24]
  — Files as a universal, descriptor-driven tab; no bespoke per-entity file storage.
- [Source: .claude/rules/coding-style.md#Core-principles] — YAGNI: the rationale for not
  polymorphising external links.
- [Source: .claude/rules/web-security.md#XSS-prevention] — `noopener noreferrer` requirement.
- [Source: .claude/rules/testing.md] — AAA, naming, 80% coverage floor.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
