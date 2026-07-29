# Story 5.2: Shidduch Overview tab

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a parent,
I want the suggested person's details in one place,
so that I can assess without hunting.

## Position in Epic 5

Runs in **Wave A, in parallel with 5.1** — the only parallel pair in the epic. 5.1 relocates the
Overview *container* (`ShidduchFactsCard` moves from a dialog into the `overview` tab); 5.2 edits
that card's `facts` entries and the schema beneath them. The two do not touch the same lines.
**5.2 does not depend on 5.1** and must not be sequenced behind it.

Written for the post-Epic-1 schema (`shidduchim.child_id` already renamed to `single_id`,
`is_child_visible_state` already renamed to `is_single_visible_state`).

### Hard ordering constraint: **5.2 must land after 4.3**

4.3 Task 1 registers `applyFullTextSearch(["name_en", "name_he", "shadchan_name",
"shadchan_name_he", "parents_en", "parents_he", "location_en", "location_he"])` for `shidduchim`
(`4-3-shidduchim-list-view.md:156`), and carries a source comment naming **this story** as the
owner of that column list (`:167-172`). AC-3 drops `parents_en`/`parents_he`. Landing 5.2 with 4.3
unlanded means 4.3 arrives referencing dead columns; landing 5.2 without replacing that list means
**every `shidduchim` search 400s at runtime**, with no compile-time signal. AC-3 covers the
replacement explicitly.

## Under-specification this story resolves

The epic's AC lists fields the schema does not yet have: **DOB, background, separate father and
mother, marital status, and existing children**. `shidduchim` today has `age` (no `dob`), a single
combined `parents_en`/`parents_he` (`01_tables.sql:275-276`, no separate father/mother), and
nothing for background, marital status, or existing children. This story adds them — a decision
made here, not left open:

| New field | Column(s) | Rationale |
|---|---|---|
| Father | `father_en text`, `father_he text` | Replaces `parents_en`/`parents_he` (dropped, not kept alongside — NFR-14). Splitting is a real semantic change the epic asks for; a combined "parents" string cannot render "father, mother" as two facts. |
| Mother | `mother_en text`, `mother_he text` | As above. |
| DOB | `dob date` | Added alongside the existing `age`. Epic wording is "age/DOB" — either may be known; Overview shows both when present, and computes an age hint from `dob` when it is set. |
| Background | `background text` | Single-script, matching the existing `singles.community text` pattern (post-Epic-1 name; not bilingual like a name — it is prose, not a matching signal, so AD-12's bilingual-identity rule does not apply). |
| Marital status | `marital_status text` | Free text (e.g. "single", "divorced", "widowed") — an enum is not warranted; the field exists across an unbounded set of communities' phrasing and this is descriptive, not a matching key. |
| Existing children | `existing_children_note text` | Free text (e.g. "one daughter, age 6"), not a structured sub-record — the epic's own wording is a fact in a list, not a feature request for a children sub-table. This describes the *suggested person's own* prior children, a different real-world concept from the retired `children` resource (AD-23). **The retired-name guard does not know that; see the ruling below.** |

Existing production data is demo/test only (SPEC Assumptions), so `parents_en`/`parents_he` are
dropped outright with no migration-and-carry-forward of their values into father/mother — a
free-text "Mr. and Mrs. Cohen" cannot be split programmatically into two identities without
inventing data, and NFR-14 forbids leaving the old columns as a shim.

## Ruling: `existing_children_note` is exempted in `scripts/retired-names.json`, not renamed

The guard's `1.3-children-contextual` pattern is
`child_|_child|child-|public\.children|children_summary|"children"|/children|db\.children|resources\.children|crm\.children`
with flags `i` (`scripts/retired-names.json`). Running it: **`existing_children_note` matches** on
the substring `_child`, and so does the RPC parameter `p_existing_children_note`. Only two of the
touched files are in `exactFileAllowlist` (`supabase/schemas/01_tables.sql`,
`src/components/atomic-crm/types.ts`); `02_functions.sql`, `03_views.sql`, `ShidduchInputs.tsx`,
`ShidduchFactsCard.tsx`, `seed_demo/*` and both i18n catalogues are **not**. A `p_`-prefixed
parameter is unavoidable (`create_shidduch`'s convention) and any base name beginning `children`
produces `p_child…` → `_child`, so renaming cannot solve the parameter without abandoning the word.

**Decision — exempt, do not rename.** Add to `1.3-children-contextual`'s `exempt` array, with a
matching `exemptReasons` entry each:

```
"p_existing_children_note"  → "Story 5.2: create_shidduch()'s parameter for the SUGGESTED PERSON'S
                               own prior children (a shidduch fact), not the retired `children`
                               resource, which is now `singles` (AD-23)."
"existing_children_note"    → "Story 5.2: shidduchim column for the suggested person's own prior
                               children — see above."
```

List **both**, longer first in intent — `stripExemptTerms` sorts longest-first and blanks each
term to a single space, so the pair is safe in either order and the residue of the `p_` form
(`"p_ "`) matches nothing. (Strictly, the column name alone would also cover the parameter, since
stripping it leaves `p_`; the parameter is listed explicitly so a `grep` of the config finds it and
so the reason is recorded against the thing a reviewer will actually see in `02_functions.sql`.)
Exemption is per-term, not per-line — a genuine fossil sharing a line is still caught
(`scripts/check-retired-names.mjs:32-67`).

**Trap the exemption does not cover:** the `1.3-children-camelcase` pattern is
**case-sensitive** and includes `\bChildren\b`, so an i18n label whose *value* is the bare word
`"Children"` fails. Use `"Existing children"` (lowercase `c`) — that clears both patterns, since
`1.3-children-contextual` needs `_`/`-`/`.`/`"` adjacency the phrase does not have.

## The parents *matching signal* must survive the column split (AD-5)

The dropped columns feed identity matching in three verified places, none of which the epic AC
mentions and all of which break if only the columns are dropped:

1. `sync_shidduch_identity_signals()` (`supabase/schemas/02_functions.sql:1959`) computes
   `parents_norm` from `normalize_identity_text(coalesce(new.parents_en, new.parents_he))` — the
   trigger body fails to compile against the new schema.
2. `catch_shidduch()` reads `coalesce(v_s.parents_en, v_s.parents_he)` at two sites — the deciding
   facts (`:2791`) and its own `v_parents_norm` (`:2808`).
3. The FakeRest mirror `providers/fakerest/internal/shidduchCatch.ts` computes
   `parents: normalizeIdentityText(s.parents_en ?? s.parents_he)`.

AD-5's signal set is "name, **parents**, seminary/yeshiva, Shul, location" — the *signal* is
legitimately named `parents` and stays; only the *columns* die. All three sites are rewritten to
build the combined string from the new fields, in the same way in both runtimes (AD-5's one
normalizer, one derivation):
`nullif(trim(coalesce(father_en, father_he, '') || ' ' || coalesce(mother_en, mother_he, '')), '')`
(TS mirror: `[father_en ?? father_he, mother_en ?? mother_he].filter(Boolean).join(" ")`).
`match_identity()`'s `p_parents` parameter (`02_functions.sql:2056`) and the
`parents_norm`/`v_parents_norm` signal names are unchanged — they name the signal, not the
columns. `dating_records.person_parents` (`:2836`) is a different table's column and is out of
scope.

## Acceptance Criteria

1. **Given** a shidduch, **when** I open Overview, **then** I see: name (en + he), age and/or
   DOB, height, background, location (en + he), shul (en + he), current and earlier
   yeshiva/seminary (via the existing `ShidduchSchoolsSection`, unchanged), father (en + he),
   mother (en + he), marital status, and the existing-children note.

   **Falsifiable:** `shidduchim/ShidduchFactsCard.test.tsx` renders a fixture carrying all eight
   new fields and asserts each label and value is in the DOM. Failing looks like a missing `<dt>`.

2. **Given** any of the above fields has no value, **when** Overview renders, **then** that field
   is omitted from the DOM entirely — never rendered blank or with a placeholder.

   The null-omission guarantee already exists and must be **reused, not re-created**:
   `FactRow`'s `if (!en && !he && !plain) return null;` lives in
   `entity360/tabs/OverviewFactGrid.tsx:20-21` (Story 3-10 lifted it out of `ShidduchFactsCard`).
   `ShidduchFactsCard.tsx:18-41` now passes a `facts: OverviewFact[]` array to
   `<OverviewFactGrid>`; this story edits **entries of that array**. There is no `FactRow` in
   `ShidduchFactsCard.tsx` and none may be added.

   **Falsifiable:** the same test with a fixture carrying only `name_en` asserts none of the eight
   new labels appears.

3. **Given** the schema change, **when** it lands, **then** `parents_en`/`parents_he` no longer
   exist anywhere — table, view, RPC parameter, TypeScript type, i18n key, FakeRest generator,
   seed data, or test fixture. `grep -rniE 'parents_en|parents_he'` over `src/`,
   `supabase/schemas`, `supabase/functions` and `supabase/tests` returns zero hits (this also
   catches `p_parents_en`/`p_parents_he`). `match_identity()`'s `p_parents` parameter and the
   `parents_norm` signal deliberately survive — they name AD-5's combined signal, not the columns.

   **And**, in the same diff, 4.3's `applyFullTextSearch` column list for `shidduchim`
   (`providers/supabase/dataProvider.ts`, carrying 4.3's source comment naming this story) has
   `"parents_en", "parents_he"` replaced by `"father_en", "father_he", "mother_en", "mother_he"`.
   The grep above lands on it; the ordering constraint at the top of this story is why.

   **Falsifiable:** the grep, plus a manual search in the running app returning 200, not 400.

4. **Given** `create_shidduch()`, **when** a shidduch is created, **then** it accepts
   `p_father_en`, `p_father_he`, `p_mother_en`, `p_mother_he`, `p_dob`, `p_background`,
   `p_marital_status`, `p_existing_children_note` (all nullable) in place of `p_parents_en`/
   `p_parents_he`, and `ShidduchCreate.tsx`/`ShidduchInputs.tsx` collect them.

   The signature changes from 18 arguments to 24, which forces `DROP FUNCTION` before
   `CREATE FUNCTION` — and **grants are attached to the signature, not the name**.
   `supabase/schemas/06_grants.sql:411-413` spells the full 18-type argument list three times
   (`revoke … from public, anon`, `grant execute … to authenticated`, `grant execute … to
   service_role`). All three lines must be rewritten to the new type list in the same diff, or
   every create 403s for `authenticated`. `06_grants.sql` is **not** currently in this story's
   file list; it is now.

   **Falsifiable:** `npm run test:unit:db` plus a create as `authenticated` in
   `supabase/tests/shidduch_catch.sql`'s harness.

5. **Given** the three signal sites (`sync_shidduch_identity_signals()`, `catch_shidduch()`,
   FakeRest `internal/shidduchCatch.ts`), **when** the migration lands, **then** each derives
   the combined parents string from father/mother per the formula above, and a catch that
   matched on parents before this story still matches after: extend
   `supabase/tests/shidduch_catch.sql`'s fixtures (seven `insert into public.shidduchim (…,
   parents_en, …)` statements at `:52-90`) to seed `father_en`/`mother_en`, and assert
   `identity_signals.parents_norm` is non-null and the existing parents-corroborated catch
   assertion still passes. Its paired runner `supabase/tests/shidduch_catch.test.ts` executes it
   (every `.sql` under `supabase/tests/` has one — 13 pairs, no exceptions).

   **Falsifiable:** `npm run test:unit:db` — a null `parents_norm` fails the new assertion, and a
   broken derivation fails the pre-existing catch assertion.

6. **Given** the toolchain, **when** run over this story's changed files, **then**
   `make typecheck && npm run lint && make test && npm run test:unit:db` pass, **and**
   `node scripts/check-retired-names.mjs` is clean (this is what proves the exemption ruling above
   was actually applied and that no camelCase form slipped in), **and** the existing `shidduchim`
   cross-account RLS test in `supabase/tests/shidduch_catch.sql` still passes unchanged — this
   story does not touch RLS, only columns, so a passing existing test is the proof nothing broke.

## Tasks / Subtasks

- [ ] **Task 0 — Confirm 4.3 has landed** (prerequisite to AC-3)
  - [ ] `grep -n "applyFullTextSearch" src/components/atomic-crm/providers/supabase/dataProvider.ts`
        and confirm the `shidduchim` entry with 4.3's source comment exists. If it does not, 4.3
        has not landed — stop and report rather than dropping the columns out from under it.
- [ ] **Task 1 — Schema** (AC: 3, 4, 5)
  - [ ] `supabase/schemas/01_tables.sql`: on `public.shidduchim`, drop `parents_en`/`parents_he`
        (`:275-276`), add `father_en`, `father_he`, `mother_en`, `mother_he`, `dob date`,
        `background text`, `marital_status text`, `existing_children_note text`.
  - [ ] `supabase/schemas/03_views.sql`: update `shidduchim_summary` to select the new columns in
        place of `s.parents_en`/`s.parents_he` (`:60-61`). Re-verify the view still declares
        `with (security_invoker = on)` — **`supabase db diff` never re-emits it**; if the
        generated migration touches the view, hand-add
        `alter view "public"."shidduchim_summary" set (security_invoker = on);` after the replace,
        exactly as `supabase/migrations/20260724112600_add_summary_stats_views.sql:30-37`'s
        `MANUAL ADJUSTMENTS` block documents.
  - [ ] `supabase/schemas/02_functions.sql`: `create_shidduch()` (`:1434-1435, :1496, :1504`) —
        replace the `p_parents_en`/`p_parents_he` parameters and every body reference with the
        eight new ones. LSP does not cover SQL: sweep this file with the AC-3 grep instead.
  - [ ] `supabase/schemas/02_functions.sql`: `sync_shidduch_identity_signals()` (`:1959`) —
        recompute `parents_norm` from father/mother per the AC-5 formula; `catch_shidduch()` —
        same at its two sites (`:2791`, `:2808`). Leave `match_identity()`'s `p_parents`
        parameter (`:2056`) and `dating_records.person_parents` (`:2836`) untouched.
  - [ ] `supabase/schemas/06_grants.sql:411-413`: rewrite all three `create_shidduch(...)`
        argument lists to the new 24-type signature (AC-4).
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f shidduch_overview_fields`,
        hand-check: this is a genuine `DROP COLUMN` + `ADD COLUMN` (not a rename — the concepts
        are different, per the table above), so the generated migration's plain form is correct
        here, unlike a same-meaning rename. Confirm the drop-then-create function cycle appears
        (a signature change forces drop-first, exactly as
        `1-3-rename-children-to-singles.md` Task 3 documents for `is_child_visible_state`).
  - [ ] Apply with `migration up --local`. Never `db reset`/`db push`.
- [ ] **Task 2 — Types and providers** (AC: 3, 4, 5)
  - [ ] `types.ts`: `Shidduch` (`:287-288`) and `CreateShidduchInput` (`:383-384`) — replace
        `parents_en`/`parents_he` with the 8 new fields. `ShidduchSummary` is
        `Shidduch & { … }` (`:310`) and needs no separate edit.
  - [ ] `providers/supabase/dataProvider.ts`: `createShidduchViaRpc`'s `p_parents_*` mapping
        (`:73-74`) → the eight new params; **and** 4.3's `applyFullTextSearch` column list for
        `shidduchim` inside `lifeCycleCallbacks` (AC-3). If 4.3 pinned that list in
        `providers/supabase/dataProvider.test.ts`, retarget the pin in the same diff.
  - [ ] `providers/fakerest/dataProvider.ts`, `providers/fakerest/dataGenerator/shidduchim.ts`,
        `providers/fakerest/internal/shidduchCatch.ts` + `shidduchCatch.test.ts` — in
        `shidduchCatch.ts` the `parents:` signal switches to the AC-5 TS mirror formula, keeping
        the FakeRest catch emulation in lockstep with the SQL trigger (AD-10); the `.test.ts`
        fixtures move to father/mother.
  - [ ] `providers/commons/englishCrmMessages.ts:12` / `frenchCrmMessages.ts:14`: replace the
        `parents_en: "Parents"` field label with the new labels. Use `"Existing children"`
        (lowercase `c`) — see the exemption ruling.
  - [ ] **Wave A hand-off from 5-1:** while in `englishCrmMessages.ts`, scrub the dead
        `ShidduchTimeline` reference in the comment at `:414`. 5-2 owns both catalogues in Wave A;
        5-1 owns the other six `ShidduchTimeline` sites and will not touch this file.
  - [ ] `supabase/functions/seed_demo/dataset.ts` / `index.ts`: seed data uses the new fields.
  - [ ] `supabase/functions/mcp/validateSql.test.ts:38` — the SQL fixture string
        `"SELECT * FROM shidduchim WHERE parents_en = …"` is inside AC-3's grep scope
        (`supabase/functions` is a `scanPath`). Retarget it to a surviving column; the test is
        about UPDATE-in-a-string-literal detection, not about `parents_en`.
- [ ] **Task 3 — UI** (AC: 1, 2)
  - [ ] `ShidduchFactsCard.tsx:19-41`: replace the single `{ label: "Parents", en:
        shidduch.parents_en, he: shidduch.parents_he }` entry in the `facts` array with "Father"
        and "Mother" entries; add "Background", "Marital status", "Existing children" entries; add
        a DOB display alongside Age (show DOB when present, else the stored `age`). Do **not**
        introduce a local `FactRow` — `OverviewFactGrid` owns it.
  - [ ] `ShidduchFactsCard.test.tsx:34` — the fixture's `parents_en` moves to `father_en`; add the
        AC-1 and AC-2 cases.
  - [ ] `ShidduchInputs.tsx:156,161`: replace the `parents_en`/`parents_he` `TextInput`s with
        father/mother, and add inputs for `dob`, `background`, `marital_status`,
        `existing_children_note`.
  - [ ] `ShidduchCreate.tsx:45`: the `CreateShidduchInput` assembly picks up the 8 new values.
  - [ ] `inbox/InboxResolveDialog.tsx:50`: update its `parents_en` reference (it prefills
        `create_shidduch` from a parsed inbox item).
- [ ] **Task 4 — Guard config** (AC: 6)
  - [ ] `scripts/retired-names.json`: add the two `exempt` terms and their two `exemptReasons`
        entries to `1.3-children-contextual` per the ruling above.
  - [ ] `node scripts/check-retired-names.mjs` clean.
- [ ] **Task 5 — Verify** (AC: 3, 5, 6)
  - [ ] Run `grep -rniE 'parents_en|parents_he' src/ supabase/schemas supabase/functions supabase/tests`
        — zero hits. **20 files** carry a hit today (re-verified on `main` @ `88f6c3c`); see the
        list in Dev Notes. `supabase/migrations/*` is never edited and is outside the grep.
  - [ ] Run the AC-5 signal check in `supabase/tests/shidduch_catch.sql`.
  - [ ] `make typecheck && npm run lint && make test && npm run test:unit:db`.

## Dev Notes

### Files verified (`main` @ `88f6c3c`)

`grep -rliE 'parents_en|parents_he|p_parents'` over `src/`, `supabase/schemas`,
`supabase/functions`, `supabase/tests` returns **20** files:

`inbox/InboxResolveDialog.tsx`, `providers/commons/{english,french}CrmMessages.ts`,
`providers/fakerest/dataGenerator/shidduchim.ts`, `providers/fakerest/dataProvider.ts`,
`providers/fakerest/internal/shidduchCatch.ts`, `providers/fakerest/internal/shidduchCatch.test.ts`,
`providers/supabase/dataProvider.ts`, `shidduchim/ShidduchCreate.tsx`,
`shidduchim/ShidduchFactsCard.tsx`, `shidduchim/ShidduchFactsCard.test.tsx`,
`shidduchim/ShidduchInputs.tsx`, `types.ts`,
`supabase/functions/mcp/validateSql.test.ts`, `supabase/functions/seed_demo/{dataset.ts,index.ts}`,
`supabase/schemas/{01_tables,02_functions,03_views}.sql`, `supabase/tests/shidduch_catch.sql`.

An earlier revision of this story said 18, verified 2026-07-26; two files landed after that count
was taken (`validateSql.test.ts`, `ShidduchFactsCard.test.tsx`), and `supabase/tests/child_portal.sql`
— which that count excluded by hand — is already deleted by Epic 1 Story 1.4. Two further files
this story must edit carry **no** `parents` hit and so are invisible to the grep:
`supabase/schemas/06_grants.sql` (AC-4) and `scripts/retired-names.json` (Task 4). Re-run the grep
before starting.

### Reuse

- `entity360/tabs/OverviewFactGrid.tsx` owns `FactRow` and the null-omission guarantee AC-2
  depends on. `ShidduchFactsCard.tsx` is a thin caller passing a `facts` array — add entries to
  the array. Do not write a second fact-row primitive and do not re-create the one 3-10 removed.
- AD-5's normalizer is a single Postgres function; the TS mirror in
  `providers/fakerest/internal/shidduchCatch.ts` exists to keep FakeRest in lockstep (AD-10).
  Change both or neither.

### Testing standard

Per `.claude/rules/testing.md`: AAA structure, 80% coverage on new code paths. **The frontend test
stack is `vitest-browser-react` running in Chromium, with ra-core's `TestMemoryRouter` where a
router is needed — React Testing Library is not a dependency of this repo.** `ShidduchFactsCard`
renders no router-dependent child, so `render(<ShidduchFactsCard shidduch={fixture} />)` from
`vitest-browser-react` is sufficient; `ShidduchFactsCard.test.tsx` already has that shape.
Database assertions run through `npm run test:unit:db`, which executes the `.sql`/`.test.ts` pairs
under `supabase/tests/`. Update the existing `shidduchCatch.test.ts` and `ShidduchFactsCard.test.tsx`
fixtures to the new fields rather than adding parallel fixtures.

### Wave A ownership

**5-2 owns:** `shidduchim/{ShidduchFactsCard,ShidduchInputs,ShidduchCreate}.tsx` + their tests,
`inbox/`, `types.ts`, `providers/**` (**including both i18n catalogues**), `supabase/**`
(including `migrations/**`, `functions/**`, `tests/**`), `scripts/retired-names.json`.
**5-1 owns:** `entity360/**`, `root/routeManifest.ts`, `misc/`, `reminders/`, `registry.json`,
`shidduchim/{index.ts, entityDescriptor.ts, ShidduchimList.tsx, ShidduchShow*.tsx,
ShidduchTimeline.tsx, ShidduchOverviewTab.tsx, ShidduchCreatePage.tsx}`, and the three named e2e
specs. Do not cross. The one hand-off is `englishCrmMessages.ts:414` (Task 2), which 5-2 performs
on 5-1's behalf.

**5-2 does not touch `registry.json`** — it adds and deletes no non-test source file under
`src/components/atomic-crm/`, so `scripts/generate-registry.mjs`'s glob is unaffected. 5-1
regenerates it once at the end of the wave.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-5-Entity-360s, Story 5.2]
- [Source: AGENTS.md#Database-Management] — schema-first workflow, `db diff` → hand-check → `migration up`.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-5]
  — the parents signal, its single normalizer, and why `p_parents`/`parents_norm` survive the
  column split.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-12]
  — bilingual rule scoped to identity/matching fields, not prose.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-23]
  — why `children` is a retired name and why this column still describes something else.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-10]
  — the FakeRest lockstep obligation on `shidduchCatch.ts`.
- [Source: _bmad-output/implementation-artifacts/1-3-rename-children-to-singles.md#Task-3] — the
  drop-function-before-recreate pattern this story's RPC signature change must follow.
- [Source: _bmad-output/implementation-artifacts/4-3-shidduchim-list-view.md:156,167-172] — the
  `applyFullTextSearch` column list this story owns, and the handoff comment that points here.
- [Source: scripts/retired-names.json] + [Source: scripts/check-retired-names.mjs:32-67] — the
  pattern and the per-term exemption mechanism the ruling above uses.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
