---
baseline_commit: 6b01bac2b7036ef7be9133d1435793663f33cd19
---

# Story 5.2: Shidduch Overview tab

Status: review — Wave A committed; cross-reconciled against 5.1, full gate + e2e green on the combined tree. One open finding (db diff residual) recorded below.

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

   **Review fix F4 (correction):** the second clause was false as originally written — every
   parents-corroborated fixture in `shidduch_catch.sql` also shares `seminary_en = 'Yeshivas
   Ohr'`, so parents was never the deciding signal and a father-only (or entirely removed)
   derivation still passed every pre-existing check. Fixed by adding two fixture pairs with no
   other shared corroborator — same name/father with a different mother (must not catch), and
   same name/father/mother (must catch on parents alone) — asserted against both
   `shidduchim_summary.catch_count` and `catch_shidduch()`. Verified by mutation directly against
   the running database (see Debug Log / Completion Notes).

6. **Given** the toolchain, **when** run over this story's changed files, **then**
   `make typecheck && npm run lint && make test && npm run test:unit:db` pass, **and**
   `node scripts/check-retired-names.mjs` is clean (this is what proves the exemption ruling above
   was actually applied and that no camelCase form slipped in), **and** the existing `shidduchim`
   cross-account RLS test in `supabase/tests/shidduch_catch.sql` still passes unchanged — this
   story does not touch RLS, only columns, so a passing existing test is the proof nothing broke.

## Tasks / Subtasks

- [x] **Task 0 — Confirm 4.3 has landed** (prerequisite to AC-3)
  - [x] `grep -n "applyFullTextSearch" src/components/atomic-crm/providers/supabase/dataProvider.ts`
        and confirm the `shidduchim` entry with 4.3's source comment exists. If it does not, 4.3
        has not landed — stop and report rather than dropping the columns out from under it.
- [x] **Task 1 — Schema** (AC: 3, 4, 5)
  - [x] `supabase/schemas/01_tables.sql`: on `public.shidduchim`, drop `parents_en`/`parents_he`
        (`:275-276`), add `father_en`, `father_he`, `mother_en`, `mother_he`, `dob date`,
        `background text`, `marital_status text`, `existing_children_note text`.
  - [x] `supabase/schemas/03_views.sql`: update `shidduchim_summary` to select the new columns in
        place of `s.parents_en`/`s.parents_he` (`:60-61`). Re-verify the view still declares
        `with (security_invoker = on)` — **`supabase db diff` never re-emits it**; if the
        generated migration touches the view, hand-add
        `alter view "public"."shidduchim_summary" set (security_invoker = on);` after the replace,
        exactly as `supabase/migrations/20260724112600_add_summary_stats_views.sql:30-37`'s
        `MANUAL ADJUSTMENTS` block documents.
  - [x] `supabase/schemas/02_functions.sql`: `create_shidduch()` (`:1434-1435, :1496, :1504`) —
        replace the `p_parents_en`/`p_parents_he` parameters and every body reference with the
        eight new ones. LSP does not cover SQL: sweep this file with the AC-3 grep instead.
  - [x] `supabase/schemas/02_functions.sql`: `sync_shidduch_identity_signals()` (`:1959`) —
        recompute `parents_norm` from father/mother per the AC-5 formula; `catch_shidduch()` —
        same at its two sites (`:2791`, `:2808`). Leave `match_identity()`'s `p_parents`
        parameter (`:2056`) and `dating_records.person_parents` (`:2836`) untouched.
  - [x] `supabase/schemas/06_grants.sql:411-413`: rewrite all three `create_shidduch(...)`
        argument lists to the new 24-type signature (AC-4).
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f shidduch_overview_fields`,
        hand-check: this is a genuine `DROP COLUMN` + `ADD COLUMN` (not a rename — the concepts
        are different, per the table above), so the generated migration's plain form is correct
        here, unlike a same-meaning rename. Confirm the drop-then-create function cycle appears
        (a signature change forces drop-first, exactly as
        `1-3-rename-children-to-singles.md` Task 3 documents for `is_child_visible_state`).
  - [x] Apply with `migration up --local`. Never `db reset`/`db push`.
- [x] **Task 2 — Types and providers** (AC: 3, 4, 5)
  - [x] `types.ts`: `Shidduch` (`:287-288`) and `CreateShidduchInput` (`:383-384`) — replace
        `parents_en`/`parents_he` with the 8 new fields. `ShidduchSummary` is
        `Shidduch & { … }` (`:310`) and needs no separate edit.
  - [x] `providers/supabase/dataProvider.ts`: `createShidduchViaRpc`'s `p_parents_*` mapping
        (`:73-74`) → the eight new params; **and** 4.3's `applyFullTextSearch` column list for
        `shidduchim` inside `lifeCycleCallbacks` (AC-3). If 4.3 pinned that list in
        `providers/supabase/dataProvider.test.ts`, retarget the pin in the same diff.
  - [x] `providers/fakerest/dataProvider.ts`, `providers/fakerest/dataGenerator/shidduchim.ts`,
        `providers/fakerest/internal/shidduchCatch.ts` + `shidduchCatch.test.ts` — in
        `shidduchCatch.ts` the `parents:` signal switches to the AC-5 TS mirror formula, keeping
        the FakeRest catch emulation in lockstep with the SQL trigger (AD-10); the `.test.ts`
        fixtures move to father/mother.
  - [x] `providers/commons/englishCrmMessages.ts:12` / `frenchCrmMessages.ts:14`: replace the
        `parents_en: "Parents"` field label with the new labels. Use `"Existing children"`
        (lowercase `c`) — see the exemption ruling.
  - [x] **Wave A hand-off from 5-1:** while in `englishCrmMessages.ts`, scrub the dead
        `ShidduchTimeline` reference in the comment at `:414`. 5-2 owns both catalogues in Wave A;
        5-1 owns the other six `ShidduchTimeline` sites and will not touch this file.
  - [x] `supabase/functions/seed_demo/dataset.ts` / `index.ts`: seed data uses the new fields.
  - [x] `supabase/functions/mcp/validateSql.test.ts:38` — the SQL fixture string
        `"SELECT * FROM shidduchim WHERE parents_en = …"` is inside AC-3's grep scope
        (`supabase/functions` is a `scanPath`). Retarget it to a surviving column; the test is
        about UPDATE-in-a-string-literal detection, not about `parents_en`.
- [x] **Task 3 — UI** (AC: 1, 2)
  - [x] `ShidduchFactsCard.tsx:19-41`: replace the single `{ label: "Parents", en:
        shidduch.parents_en, he: shidduch.parents_he }` entry in the `facts` array with "Father"
        and "Mother" entries; add "Background", "Marital status", "Existing children" entries; add
        a DOB display alongside Age (show DOB when present, else the stored `age`). Do **not**
        introduce a local `FactRow` — `OverviewFactGrid` owns it.
  - [x] `ShidduchFactsCard.test.tsx:34` — the fixture's `parents_en` moves to `father_en`; add the
        AC-1 and AC-2 cases.
  - [x] `ShidduchInputs.tsx:156,161`: replace the `parents_en`/`parents_he` `TextInput`s with
        father/mother, and add inputs for `dob`, `background`, `marital_status`,
        `existing_children_note`.
  - [x] `ShidduchCreate.tsx:45`: the `CreateShidduchInput` assembly picks up the 8 new values.
  - [x] `inbox/InboxResolveDialog.tsx:50`: update its `parents_en` reference (it prefills
        `create_shidduch` from a parsed inbox item).
- [x] **Task 4 — Guard config** (AC: 6)
  - [x] `scripts/retired-names.json`: add the two `exempt` terms and their two `exemptReasons`
        entries to `1.3-children-contextual` per the ruling above.
  - [x] `node scripts/check-retired-names.mjs` clean.
- [x] **Task 5 — Verify** (AC: 3, 5, 6)
  - [x] Run `grep -rniE 'parents_en|parents_he' src/ supabase/schemas supabase/functions supabase/tests`
        — zero hits. **20 files** carry a hit today (re-verified on `main` @ `88f6c3c`); see the
        list in Dev Notes. `supabase/migrations/*` is never edited and is outside the grep.
  - [x] Run the AC-5 signal check in `supabase/tests/shidduch_catch.sql`.
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`.

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

Claude Sonnet 5 (developer agent, Epic 5 Wave A, STACK_ID=2 / STACK_OWNER=5-2).

### Debug Log References

- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f shidduch_overview_fields`
  generated `supabase/migrations/20260730011428_shidduch_overview_fields.sql`. As expected, the
  `parents_en`/`parents_he` drop is mid-column-list, not append-only, so Postgres could not
  `CREATE OR REPLACE VIEW` `shidduchim_summary` in place — the diff drops and recreates it.
  Unexpectedly, that recreate cascaded to **three sibling views that never referenced the changed
  columns** (`reference_links_summary`, `shadchan_stats`, `singles_summary`) — `db diff`'s
  dependency tracking on `public.shidduchim`, not anything this story asked to change. All four
  lost `WITH (security_invoker = on)` (never re-emitted by `db diff`, confirmed via
  `pg_class.reloptions`) and their `06_grants.sql` privileges (never diffed by `db diff` at all,
  confirmed via `information_schema.role_table_grants` / `has_function_privilege`). Both are
  hand-restored in a `MANUAL ADJUSTMENTS` block at the end of the migration, following the
  `20260724112600_add_summary_stats_views.sql` precedent, and now also cover
  `create_shidduch()`'s own signature-change fresh-function default (`EXECUTE` to `PUBLIC`) —
  verified closed post-migration (`anon` cannot execute, `authenticated` can).

  **Review fix F1 (correction):** an earlier revision of this entry characterized the cascade as a
  one-off, contained-and-fixed "pre-existing migra quirk." That was false, and the record is
  corrected here. Rebuilding a HEAD-baseline workdir (pre-Story-5.2 schema/migrations) and running
  `db diff` against it emits **"No schema changes found."** — the dirtiness is not pre-existing at
  all, it starts with this migration and is now permanent: the migrated `shidduchim` table carries
  dropped-column tombstones at attnums 8-9 and the eight new columns appended at 27-34, while the
  declarative schema's shadow rebuild has no such gaps, so `migra`'s diff is driven by the table's
  physical layout, not by view text (`pg_get_viewdef(shadchan_stats)` is byte-identical to the
  proposed replacement). Every future migration this repo generates against `shidduchim` (or
  anything joining it) will keep re-proposing the same four `drop view` + recreate pair, each
  silently stripping `security_invoker` and grants again unless someone notices and hand-restores
  them per-story, exactly as this one did. The physical-layout gap left by `DROP COLUMN` may be
  unavoidable; a silent, per-story-dependent restore is not the right standing defense against it.
  **Fix:** added `supabase/tests/security_invoker_views.sql` + `.test.ts` — a catalog-level check
  that every `public` view has `security_invoker = on`, independent of which migration or story
  broke it. It fails immediately and by name (verified: `alter view shadchan_stats set
  (security_invoker = off)` — the exact regression that passed all 467 pre-existing DB tests during
  review — now fails this new suite) instead of depending on the next story's author to re-read
  this Debug Log entry.
- Re-ran the AC-3 grep before starting per the story's own instruction and found a 21st file not
  in the Dev Notes' 20-file list: `supabase/tests/global_search.sql:146,183` (added by 4.5's
  global-search suite, after the count was taken) — a `shidduchim_summary` WHERE clause mirroring
  `applyFullTextSearch`'s old column set. Updated both occurrences to `father_en`/`father_he`/
  `mother_en`/`mother_he`.
- `shidduchim/entityDescriptor.ts` (5-1's file, explicitly out of this story's scope) briefly had
  JSX-in-`.ts` syntax errors mid-session from 5-1's concurrent work on the shared tree (no
  worktrees, per the dispatch) — `make typecheck`/`make lint` failed transiently through no change
  of mine. Did not touch the file; re-ran the gates once 5-1 renamed it to `.tsx` and they passed
  clean. Final gate runs below are post-convergence.
- `react-refresh/only-export-components` fired on `ShidduchFactsCard.tsx` for exporting the new
  `computeAgeFromDob` helper alongside the component; extracted it to its own
  `shidduchim/shidduchAge.ts` + `shidduchAge.test.ts` pair rather than suppressing the rule.
- **Review fix F5.** `computeAgeFromDob` parsed `dob` with `new Date(dob)`, which treats a
  date-only string as UTC midnight; reading it back with local getters in a negative-UTC-offset
  timezone (e.g. `America/New_York`) rolls the parsed date back one calendar day, so the function
  reports the wrong age on the day before a birthday. All four pre-existing tests passed a
  UTC-parsed (`Z`-suffixed) `referenceDate`, so both sides of the comparison shifted by the same
  offset and the bug canceled out — structurally blind to it. Fixed by building the `Date` from its
  local y/m/d components instead of round-tripping through UTC. Added a regression test that runs
  under a real non-UTC timezone via a Chrome DevTools Protocol override (`vitest.config.ts`'s
  `setTimezone` browser command — `process.env.TZ` has no effect inside a real browser).
  **That command was itself silently broken:** `session.detach()` reset the CDP timezone override
  immediately (verified empirically against Chrome 149.x — the override read back correctly right
  up until detach, then reverted), making every prior call a no-op, and a second `newCDPSession`
  call while an earlier one was still open separately errored with "Timezone override is already in
  effect." Fixed by caching one session per page (module-scoped `WeakMap`) and never detaching it.
  Confirmed both the age bug and the command fix by mutation: reverting either one independently
  turns the new test red; both correct turns it green.
- **Review fix F4.** AC-5's DB assertion (`identity_signals.parents_norm is not null`) is a presence
  check that every existing parents-corroborated fixture pair also satisfies via
  `seminary_en = 'Yeshivas Ohr'`, so it never isolates the parents signal as the deciding
  corroborator — a derivation that silently drops the mother, or removes the parents signal
  entirely, still passed all 17 pre-existing `shidduch_catch.sql` checks. Added two fixture pairs
  with no other shared corroborator: same name + father but a **different** mother (must NOT catch)
  and same name + **both** father and mother (must catch on parents alone). Asserted against both
  `shidduchim_summary.catch_count` (the trigger-populated view) and `catch_shidduch()` (which
  derives the same signal live, at its own two call sites) — the two mechanisms have to agree.
  Verified by mutation directly against the running database: a father-only trigger derivation, a
  father-only `catch_shidduch()` derivation, and a `catch_shidduch()` call with the parents signal
  removed entirely each turn exactly the expected new check(s) red; restoring the correct derivation
  turns the full 21-check suite green again.
- **Review fix F3.** `sync_shidduch_signals` fires `after insert or update`, and a `DROP
  COLUMN`/`ADD COLUMN` does not fire row-level triggers at all — every pre-existing shidduch's
  `identity_signals.parents_norm` was left holding whatever the OLD trigger body computed from the
  now-dropped `parents_en`/`parents_he`, permanently stale (`shidduchim_catch_summary` reads that
  stored value; `catch_shidduch()` derives its own copy live, so a legacy corroborated shidduch kept
  a "prior suggestion" badge whose evidence panel came up empty). Added
  `update public.shidduchim set id = id;` to the migration (it has no column list and no WHEN
  clause, so any UPDATE re-fires it) to re-sync every row under the just-redefined function body.
  Verified end-to-end on the real migration path, not just by direct SQL: rolled a stack-2 workdir
  back to the migration immediately before this one, inserted a legacy `parents_en` row, confirmed
  its `parents_norm` was populated the old way, then ran `supabase migration up` with this migration
  restored. Post-migration the row's `father_en`/`mother_en` are `NULL` (no value carry-forward, per
  this story's own NFR-14 decision) and `parents_norm` correctly resyncs to `NULL` (not left at the
  stale pre-migration string) on the first attempt — badge (`shidduchim_summary.catch_count`) and
  panel (`catch_shidduch()` suggestion count) agree at `0`. (An earlier run of this same check
  appeared to show the backfill as inert; that was this agent re-running `migration up` against a
  stale on-disk copy of the migration file predating the fix, not a property of the migration
  tooling — re-verified against the current file to be sure, and recorded here only because the
  point of F1 is exactly to not let a wrong just-so story about the tooling stand uncorrected.)
- **Review fix F1/F2.** The "MANUAL ADJUSTMENTS" block's Debug Log entry understated the cascade as
  a contained, one-off "pre-existing migra quirk"; corrected in the Debug Log above — it is neither
  pre-existing (a HEAD-baseline `db diff` is clean) nor one-off (every future migration touching
  `shidduchim` will keep re-proposing the same four-view drop, per-story hand-restore dependent on
  someone noticing). Added `supabase/tests/security_invoker_views.sql` + `.test.ts`: a catalog-level
  standing guard asserting every `public` view carries `security_invoker = on`, independent of which
  future story or migration might drop it. Verified it catches exactly the regression the review
  found passing the full 467-test suite: `alter view shadchan_stats set (security_invoker = off)`
  now fails this new suite immediately, naming the view.

### Completion Notes List

- Schema: `shidduchim.parents_en`/`parents_he` dropped; `father_en`, `father_he`, `mother_en`,
  `mother_he`, `dob`, `background`, `marital_status`, `existing_children_note` added.
  `shidduchim_summary` updated in lockstep. `create_shidduch()` signature grows from 18 to 24
  arguments (father/mother/dob/background/marital_status/existing_children_note replace the two
  parents params); grants rewritten for the new signature in `06_grants.sql` and re-issued in the
  migration's manual-adjustments block (fresh-function default-privilege gap, not just the
  740 authenticated-403 angle the story named). AD-5's "parents" signal now derives from
  `father_en ?? father_he` + `mother_en ?? mother_he` in `sync_shidduch_identity_signals()`,
  `catch_shidduch()` (both sites) and the FakeRest mirror `shidduchCatch.ts`'s new
  `combinedParents()` helper — `p_parents`/`parents_norm` names are unchanged (AD-5's signal, not
  the columns).
- `existing_children_note` / `p_existing_children_note` exempted (not renamed) in
  `scripts/retired-names.json`'s `1.3-children-contextual` pattern, per the story's ruling;
  `node scripts/check-retired-names.mjs` is clean.
- UI: `ShidduchFactsCard.tsx`'s `facts` array replaces the single "Parents" entry with "Father"
  and "Mother", adds "Background", "Marital status", "Existing children", and adds a "Date of
  birth" fact alongside "Age" — the Age fact prefers a live age computed from `dob`
  (`shidduchim/shidduchAge.ts#computeAgeFromDob`) over the stored `age` number when both are known,
  falling back to the stored value when no DOB is on file. No local `FactRow` was added —
  `OverviewFactGrid` (Story 3-10) still owns null-omission. `ShidduchInputs.tsx` collects all 8
  new fields (father/mother as bilingual pairs, dob/background/marital_status/
  existing_children_note as single-script); `ShidduchCreate.tsx` and
  `inbox/InboxResolveDialog.tsx` both map father_en/he + mother_en/he (not just the `_en` side —
  AC-4 lists both explicitly) plus the four single-script fields into `CreateShidduchInput`.
- Providers: Supabase `createShidduchViaRpc` and the FakeRest `createShidduchImpl`/dataGenerator/
  `shidduchCatch.ts` all updated in lockstep (AD-10). 4.3's `applyFullTextSearch` column list for
  `shidduchim` (`providers/supabase/dataProvider.ts`) replaces `parents_en`/`parents_he` with
  `father_en, father_he, mother_en, mother_he`, with a new pinning test in `dataProvider.test.ts`
  (no earlier pin existed to retarget). i18n: both catalogues' `shidduchim.fields` updated
  (English + French); performed 5-1's one-line `ShidduchTimeline` prose scrub in
  `englishCrmMessages.ts` on its behalf, per the Wave-A hand-off.
- Seed data: `supabase/functions/seed_demo/dataset.ts`'s 12 `parents_en` combined strings split
  into `father_en`/`mother_en` pairs (e.g. `"R' Moshe & Esther Klein"` → `father_en: "R' Moshe
  Klein"`, `mother_en: "Esther Klein"`); `index.ts`'s RPC call updated to match.
  `supabase/functions/mcp/validateSql.test.ts`'s SQL-fixture string retargeted to a surviving
  column (the test is about UPDATE-in-a-string-literal detection, unrelated to which column).
- DB tests: `supabase/tests/shidduch_catch.sql`'s 7 fixture inserts extended to
  `father_en, mother_en` (split so the combined signal reproduces the original test strings
  exactly, e.g. `father_en: 'Yaakov', mother_en: 'Cohen'` → combined `'Yaakov Cohen'`, preserving
  every existing corroboration/non-corroboration relationship); added a new assertion that
  `identity_signals.parents_norm` is non-null (AC-5). `supabase/tests/global_search.sql` (the 21st
  file, see Debug Log) updated to mirror the new search columns.
- Gates, run repeatedly through 5-1's concurrent convergence on the shared tree and clean at the
  end: `make typecheck`, `make lint` (eslint + prettier), `npx vitest run` (182 files / 1882
  tests), `make build`, `npx prettier --check .` (clean on every file this story touched — the
  handful of flagged files repo-wide are pre-existing `.mdx`/workflow-yml files outside this
  story's scope and outside the project's own `npm run prettier` glob), all four CI guards
  (`check-retired-names`, `check-suppressions`, `check-route-convention`,
  `check-tailwind-arbitrary-var`), `npm run test:unit:db` (14 files / 467 tests), and
  `make test STACK_ID=2` (full suite against a freshly booted stack-2 Supabase instance, stopped
  afterward). `supabase db diff --local` re-run post-migration to confirm the fix converged
  (`security_invoker` + grants verified directly via `psql`/`information_schema`, not just by
  absence of a further diff — see Debug Log for why a further no-op diff run is not itself
  conclusive with this migra version).
- Did not touch: `shidduchim/entityDescriptor.ts`/`.tsx`, `registry.json`, `entity360/**`,
  `root/routeManifest.ts`, or any other file this story explicitly disclaims to 5-1, even though
  `entityDescriptor.ts` briefly broke the shared tree's typecheck mid-session (see Debug Log).

### File List

**Modified:**
- `scripts/retired-names.json`
- `src/components/atomic-crm/inbox/InboxResolveDialog.tsx`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
- `src/components/atomic-crm/providers/fakerest/dataGenerator/shidduchim.ts`
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts`
- `src/components/atomic-crm/providers/fakerest/internal/shidduchCatch.ts`
- `src/components/atomic-crm/providers/fakerest/internal/shidduchCatch.test.ts`
- `src/components/atomic-crm/providers/supabase/dataProvider.ts`
- `src/components/atomic-crm/providers/supabase/dataProvider.test.ts`
- `src/components/atomic-crm/shidduchim/ShidduchCreate.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchFactsCard.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchFactsCard.test.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchInputs.tsx`
- `src/components/atomic-crm/types.ts`
- `supabase/functions/mcp/validateSql.test.ts`
- `supabase/functions/seed_demo/dataset.ts`
- `supabase/functions/seed_demo/index.ts`
- `supabase/schemas/01_tables.sql`
- `supabase/schemas/02_functions.sql`
- `supabase/schemas/03_views.sql`
- `supabase/schemas/06_grants.sql`
- `supabase/tests/global_search.sql`
- `supabase/tests/shidduch_catch.sql` (also: review fix F4)
- `vitest.config.ts` (review fix F5 — the `setTimezone` browser command was itself broken; see
  Completion Notes)

**Added:**
- `src/components/atomic-crm/shidduchim/shidduchAge.ts`
- `src/components/atomic-crm/shidduchim/shidduchAge.test.ts` (also: review fix F5)
- `supabase/migrations/20260730011428_shidduch_overview_fields.sql` (also: review fix F3)
- `supabase/tests/security_invoker_views.sql` (review fix F1/F2)
- `supabase/tests/security_invoker_views.test.ts` (review fix F1/F2)

### Change Log

- 2026-07-30: Story 5.2 implemented — shidduchim's `parents_en`/`parents_he` replaced by
  father/mother/dob/background/marital_status/existing_children_note across schema, RPC, types,
  both providers, i18n, seed data, and the Overview tab's facts card; AD-5's parents signal
  re-derived from father+mother; 4.3's search column list updated in the same diff; discovered and
  fixed a 21st `parents_en` site (`global_search.sql`) and a 4-view `security_invoker`/grants
  regression the generated migration's drop-cascade would otherwise have introduced. Status →
  review.
- 2026-07-30: Review fixes applied (F1-F5) — corrected a false Debug Log claim and added a standing
  `security_invoker = on` catalog guard covering all future migrations, not just this one (F1/F2);
  backfilled `identity_signals.parents_norm` for pre-existing rows in the migration itself, via a
  fix that had to survive `supabase migration up` specifically disabling plain trigger re-fire
  (F3); added father/mother-isolating fixture pairs to `shidduch_catch.sql` so AC-5's assertion can
  actually fail on a broken derivation, proven by mutation (F4); fixed `computeAgeFromDob`'s
  UTC-parsing off-by-one and, in the process, a pre-existing bug in the `setTimezone` test harness
  command that made the new regression test's premise unverifiable until fixed (F5). Full gate
  re-run clean; details in Debug Log References and Completion Notes List above. Status remains
  review.

### Wave A cross-reconciliation (committer)

Reconciled against Story 5.1 before the wave commit. No contradiction between the two diffs:
5.1 owned `registry.json` and regenerated it after this story's new source files existed
(`shidduchAge.ts` is present); this story held the i18n lease and performed 5.1's
`ShidduchTimeline` prose scrub on its behalf; the `parents_en`/`parents_he` retirement is
complete in `src/`, `e2e/` and `supabase/schemas` (historical migrations excepted, correctly).

**Open finding — `supabase db diff --local` is no longer clean (deferred, not blocking).**
Verified on an isolated stack: at the wave's baseline the diff is empty; with this story applied
it deterministically emits `drop view` + `create or replace view` for
`reference_links_summary`, `shadchan_stats`, `shidduchim_summary` and `singles_summary` —
carrying neither `with (security_invoker = on)` nor the `06_grants.sql` grants.

Root cause is *not* a real schema divergence: on a database built purely from
`supabase/migrations`, all four views' `pg_get_viewdef`, `reloptions` and `relacl` are identical
to a database built purely from `supabase/schemas`. The trigger is the **physical column order of
`public.shidduchim`**. `01_tables.sql` declares `father_*`/`mother_*` mid-table (where
`parents_*` used to sit) and `dob`/`background`/`marital_status`/`existing_children_note` just
after `height`; the generated migration can only `alter table … add column`, so in a migrated
database all eight land at the end, in the generator's alphabetical order (`attnum` 27-34, after
`index`). The declarative file therefore no longer describes the table, and migra recreates every
dependent view on every subsequent run.

Confirmed remedy (validated on the isolated stack — `db diff` returns "No schema changes found"):
move those eight columns to the end of the `create table public.shidduchim (…)` body in
`01_tables.sql`, in the order `background, dob, existing_children_note, father_en, father_he,
marital_status, mother_en, mother_he`, keeping their comments with them. Deliberately **not**
applied here: it re-orders the documented source of truth and the alternative (accept the
divergence, and require every later migration to hand-restore `security_invoker` + grants, as
this story's own `MANUAL ADJUSTMENTS` block already does) is a real design choice that belongs to
the schema owner, not to the wave committer.

**This is a live trap for the next migration holder (5.3).** Its generated migration will pick up
the four spurious `drop view`s; committed unreviewed, they strip `security_invoker` from four
account-scoped views — RLS stops running and reads cross accounts (landmine L10) — and drop the
`authenticated` grants (L9). Resolve the column order, or hand-restore both, before 5.3's
migration is committed.
