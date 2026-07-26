# Story 1.3: Rename `children` to `singles`

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a product owner,
I want the entity called a **single**,
so that the model is not false for a widow, a divorcee or an independent adult managing
their own shidduchim.

## Acceptance Criteria

1. **The table is `singles`.** `public.children` is renamed to `public.singles` in
   `supabase/schemas/01_tables.sql`, and every object attached to it carries the new name:
   the unique key `singles_account_id_id_key`, the FKs `singles_account_id_fkey` and
   `singles_member_id_fkey`, the index `singles_account_id_idx`, the identity sequence
   `singles_id_seq`, the RLS policy `"Singles scoped to account"`, and the trigger
   `set_singles_account_id`. No object anywhere still reads `children*`.

2. **Every `child_id` column that names the single is `single_id`.** Renamed on
   `public.shidduchim` (NOT NULL), `public.date_records` and `public.inbox_items`, together
   with `shidduchim_child_id_fkey` → `shidduchim_single_id_fkey`,
   `date_records_child_id_fkey` → `date_records_single_id_fkey`,
   `shidduchim_child_id_idx` → `shidduchim_single_id_idx` and
   `date_records_child_id_idx` → `date_records_single_id_idx`. (`inbox_items.single_id`
   carries neither an FK nor an index — see Dev Notes.)

3. **The summary view is `singles_summary`** and the child-prefixed columns exported by
   `shidduchim_summary` and `reference_links_summary` are single-prefixed:
   `child_id` → `single_id`, `child_first_name_en|he` → `single_first_name_en|he`,
   `child_last_name_en|he` → `single_last_name_en|he`. All three views are recreated
   **with `security_invoker = on`** and with `anon` revoked (see AC-10).

4. **The two functions that name the single are renamed and their payload keys with them.**
   `public.is_child_visible_state(pipeline_state)` → `public.is_single_visible_state(pipeline_state)`
   (including the exception text `unclassified pipeline_state in single-visibility policy: %`
   and its three grant lines); `public.create_shidduch()`'s first parameter
   `p_child_id` → `p_single_id`; `public.catch_shidduch()`'s returned JSON keys `child_id`,
   `child_first_name_en`, `child_first_name_he` → `single_id`, `single_first_name_en`,
   `single_first_name_he`.

5. **`private_child` becomes `private_single`.** The `shidduchim_visibility_check`
   constraint reads `visibility in ('shared', 'private_parent', 'private_single')`, existing
   rows holding `'private_child'` are updated to `'private_single'` in the same migration,
   and the TypeScript union `ShidduchVisibility` matches. `private_parent` is unchanged.

6. **The React resource, route and directory are `singles`.**
   `src/components/atomic-crm/children/` is renamed to
   `src/components/atomic-crm/singles/`; its components become `SingleCard`, `SingleCreate`,
   `SingleEdit`, `SingleFormFrame`, `SingleInputs`, `SingleList`, `SingleShow`; both
   `<Resource name="children" …>` registrations in
   `src/components/atomic-crm/root/CRM.tsx` (desktop line 281, mobile line 351) become
   `<Resource name="singles" …>`; and all 7 `/children…` links resolve to `/singles…`.

7. **The types are `Single`.** In `src/components/atomic-crm/types.ts`, `Child` → `Single`,
   `ChildSummary` → `SingleSummary`, and every `child_id` / `child_first_name_*` /
   `child_last_name_*` member on `Shidduch`, `ShidduchSummary`, `CreateShidduchInput`,
   `InboxItem`, `ReferenceLinkSummary`, `ShidduchCatchSuggestion`, `ShidduchDatePrior` and
   `DateRecord` is single-named.

8. **User-facing copy says "single", never "child"/"children".** Covers the i18n resource
   block (`resources.children` → `resources.singles` in both `englishCrmMessages.ts` and
   `frenchCrmMessages.ts`), `resources.shidduchim.fields.child_id` → `single_id`, the runtime
   keys `crm.children.gender_*`, `crm.profile.family.children` and
   `crm.auth.onboarding.child_*`, the onboarding/roster/pipeline empty-state and tour strings,
   and the landing copy. The single Playwright/vitest assertion that pins the landing string
   (`src/components/atomic-crm/landing/LandingPage.test.tsx:19`) is updated to match.

9. **The seeded demo data reflects the new naming.** `supabase/functions/seed_demo/dataset.ts`
   (`DemoChild` → `DemoSingle`, `CHILDREN` → `SINGLES`),
   `supabase/functions/seed_demo/index.ts` (the `"children"` table read/insert, the
   `p_child_id` RPC argument, the `children:` count key in the response) and
   `supabase/functions/clear_demo/index.ts` (the `"children"` entry in the deletion order)
   all use `singles`. The FakeRest generator (`dataGenerator/shidduchim.ts`,
   `dataGenerator/index.ts`, `dataGenerator/types.ts`) seeds `db.singles`.

10. **No alias, view, redirect or compatibility shim survives** (NFR-14). Specifically: no
    `children` view over `singles`, no `child_id` generated/duplicated column, no
    `/children → /singles` route redirect, no `Child` type alias, no re-export from a
    `children/` barrel, and no `getChildPortal`-style back-compat wrapper. The generated
    migration contains only `ALTER … RENAME` / `DROP`+`CREATE`, never a
    `create view public.children as select * from public.singles`.

11. **Verification — grep is clean.** From the repo root,
    ```
    grep -rniE '\bchild(ren)?\b|child_id|childId' src/ supabase/schemas/ supabase/functions/ \
      | grep -viE 'asChild|React\.Children|first-child|last-child|\{ *children|props\.children|children\?: *React|children: *React|functions/mcp/taskListUi\.ts'
    ```
    (`supabase/functions/mcp/taskListUi.ts:101,113,114` is excluded by inspection: `children`
    there is the third parameter of a generic DOM-element helper, not the domain word.)
    returns **no hits outside the token-portal surface that story 1.4 deletes**
    (`src/components/atomic-crm/portal/*`, `src/components/atomic-crm/singles/SinglePortalShare.tsx`
    if 1.4 has not yet landed, `providers/fakerest/internal/childPortal.ts`,
    `providers/fakerest/dataProvider.childPortal.test.ts`, `src/App.tsx:8-10`,
    and the `child_portal_tokens` / `set_child_portal_token_defaults()` /
    `get_child_portal()` blocks in `supabase/schemas/*`). **If story 1.4 has already landed,
    the command must return zero hits.** See Dev Notes for the sequencing rule.

12. **Verification — the toolchain is green.** `make typecheck`, `make lint` and
    `make test` all pass with zero new warnings and with no `@ts-ignore`,
    `eslint-disable` or skipped test added to get there.

13. **Verification — the database is proven, not assumed.** After
    `npx supabase migration up --local`:
    (a) `select count(*) from public.singles;` succeeds and `public.children` no longer
    exists; (b) `select relrowsecurity, relforcerowsecurity from pg_class where relname='singles';`
    still shows RLS enabled; (c) `select c.relname, c.reloptions from pg_class c where
    c.relname in ('singles_summary','shidduchim_summary','reference_links_summary');`
    shows `security_invoker=on` on all three; (d) `select grantee, privilege_type from
    information_schema.role_table_grants where table_name in
    ('singles','singles_summary');` shows **no `anon` row**; and (e) a **negative RLS test**
    proves a member of account A reading `singles` and `singles_summary` while account B holds
    rows returns **zero** rows from account B.

## Tasks / Subtasks

- [ ] **Task 1 — Rename the table and its attached objects in the declarative schema** (AC: 1, 2, 5)
  - [ ] `supabase/schemas/01_tables.sql`: `create table public.children` → `public.singles`
        (line 277) and rewrite the section comment at line 276.
  - [ ] Rename in the constraints block: `children_account_id_id_key` (661),
        `children_account_id_fkey` (679), `children_member_id_fkey` (681),
        `shidduchim_child_id_fkey` (692-693), `date_records_child_id_fkey` (728-729) —
        each `references public.children(account_id, id)` becomes `public.singles(...)`.
  - [ ] Rename the columns: `shidduchim.child_id` (336), `inbox_items.child_id` (405),
        `date_records.child_id` (442) → `single_id`.
  - [ ] Rename the indexes: `children_account_id_idx` (792), `shidduchim_child_id_idx` (796),
        `date_records_child_id_idx` (803).
  - [ ] Change `shidduchim_visibility_check` (371-373) to `'private_single'`.
  - [ ] Refresh the prose comments that call the entity a child: lines 276, 329, 364, 390,
        413, 513-514, 654.
  - [ ] **Leave the `child_portal_tokens` block (624-652, 775-786, 822-823) untouched** — it
        is story 1.4's to delete.

- [ ] **Task 2 — Rename the dependent schema objects** (AC: 1, 3, 4)
  - [ ] `supabase/schemas/05_policies.sql`: `alter table public.children enable row level
        security` (88) → `public.singles`; policy `"Children scoped to account"` (112) →
        `"Singles scoped to account" on public.singles`; refresh comments 178, 185-187
        (`is_child_visible_state` → `is_single_visible_state`).
  - [ ] `supabase/schemas/04_triggers.sql`: `set_children_account_id` (99-101) →
        `set_singles_account_id … before insert on public.singles`.
  - [ ] `supabase/schemas/03_views.sql`: rewrite `shidduchim_summary` (181-229),
        `reference_links_summary` (263-290) and `children_summary` → `singles_summary`
        (292-320) — new column names per AC-3, joins onto `public.singles`, keeping
        `with (security_invoker = on)` on all three.
  - [ ] `supabase/schemas/02_functions.sql`: rename `is_child_visible_state` (578) and its
        exception text (592); rename `create_shidduch`'s `p_child_id` (644) and the four body
        sites (686-689, 708, 716, 735); rename the `catch_shidduch` output keys (1995-1997,
        2011, 2037-2040) and its `public.children` joins; refresh comments 559, 573, 683, 732,
        1925, 1977-1978.
  - [ ] `supabase/schemas/06_grants.sql`: table grants (195-197 and 484-485), sequence grants
        (256-258 → `singles_id_seq`), `is_child_visible_state` grants (303-305), and
        `children_summary` view grants (381-383). **Do not touch 623-655** (portal).

- [ ] **Task 3 — Generate and hand-check the migration** (AC: 1, 2, 3, 4, 5, 10, 13)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f rename_children_to_singles`
  - [ ] **Replace the generated `DROP TABLE public.children` + `CREATE TABLE public.singles`
        with `ALTER TABLE public.children RENAME TO public.singles;`** — the generated form
        destroys data and breaks every FK (AGENTS.md explicitly calls this out for renames).
        Same for the three renamed columns (`ALTER TABLE … RENAME COLUMN`).
  - [ ] Add the renames `db diff` never emits: `ALTER SEQUENCE public.children_id_seq RENAME
        TO singles_id_seq;`, `ALTER INDEX … RENAME TO …` (×3), `ALTER TABLE … RENAME
        CONSTRAINT … TO …` (×5), `ALTER POLICY "Children scoped to account" ON public.singles
        RENAME TO "Singles scoped to account";`, `ALTER TRIGGER set_children_account_id ON
        public.singles RENAME TO set_singles_account_id;`.
  - [ ] `DROP FUNCTION public.is_child_visible_state(public.pipeline_state);` and
        `DROP FUNCTION public.create_shidduch(<18-arg signature>);` **before** creating the
        renamed versions — `CREATE OR REPLACE` cannot rename a parameter, and a rename that
        leaves the old function in place is an alias (AC-10). Re-issue every `REVOKE`/`GRANT`
        for both, because grants die with the dropped function.
  - [ ] `DROP VIEW` the three views before recreating them (a `CREATE OR REPLACE VIEW` cannot
        rename or drop a column), in dependency-safe order, then re-apply
        `alter view … set (security_invoker = on);` and the `revoke anon` / `grant select
        authenticated` / `grant all service_role` triplet for each — `db diff` emits neither.
  - [ ] Migrate the data value: `update public.shidduchim set visibility = 'private_single'
        where visibility = 'private_child';` **before** re-adding
        `shidduchim_visibility_check`.
  - [ ] Apply with `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        **Never `db reset` and never `db push`.**

- [ ] **Task 4 — Types** (AC: 7, 5)
  - [ ] `src/components/atomic-crm/types.ts`: `Child` → `Single` (277), `ChildSummary` →
        `SingleSummary` (296) and its doc comment (291-295), `ShidduchVisibility`'s
        `"private_child"` → `"private_single"` (258), then the member renames on `Shidduch`
        (398), `ShidduchSummary` (428-431), `CreateShidduchInput` (494), `InboxItem` (534),
        `ReferenceLinkSummary` (600-602), `ShidduchCatchSuggestion` (686-688),
        `ShidduchDatePrior` (704-705), `DateRecord` (790). Leave the `ChildPortal*` types
        (311-342) alone — story 1.4 deletes them.

- [ ] **Task 5 — Data providers** (AC: 6, 7, 3, 4)
  - [ ] `providers/supabase/dataProvider.ts`: `p_child_id` → `p_single_id` (75) and the
        comment at 125. Leave 392-427 (portal) alone.
  - [ ] `providers/fakerest/dataProvider.ts`: the `"children"` base-resource reads (276, 538,
        540), the `children_summary` emulation `enrichChildrenSummary` (326-350), the
        `child_first_name_*` / `child_last_name_*` enrichment (304-317), and the
        `createShidduch` emulation (418-479). Leave 72 and 845-856 (portal) alone.
  - [ ] `providers/fakerest/internal/shidduchCatch.ts` and
        `providers/fakerest/internal/referenceSummary.ts`: same key/resource renames.

- [ ] **Task 6 — Rename the resource directory and its components** (AC: 6)
  - [ ] `git mv src/components/atomic-crm/children src/components/atomic-crm/singles`, then
        rename `ChildCard.tsx` → `SingleCard.tsx`, `ChildCreate.tsx` → `SingleCreate.tsx`,
        `ChildEdit.tsx` → `SingleEdit.tsx`, `ChildFormFrame.tsx` → `SingleFormFrame.tsx`,
        `ChildInputs.tsx` → `SingleInputs.tsx`, `ChildList.tsx` → `SingleList.tsx`,
        `ChildShow.tsx` → `SingleShow.tsx`, and rename the exported symbols to match.
  - [ ] `index.ts`: `recordRepresentation` fallback `Child #${record.id}` → `Single #${record.id}`.
  - [ ] `ChildPortalShare.tsx` → move with the directory **unchanged** (name and internals) if
        story 1.4 has not landed; delete outright if it has. Do not rename it — see Dev Notes.
  - [ ] `SingleList.tsx`: `useGetList<SingleSummary>("children_summary")` (68) →
        `"singles_summary"`.

- [ ] **Task 7 — Registration points and routes** (AC: 6)
  - [ ] `root/CRM.tsx`: `import children from "../children"` (18) →
        `import singles from "../singles"`; both `<Resource name="children" …>` (281, 351).
  - [ ] Rewrite the 7 `/children…` links: `singles/SingleCard.tsx:51`,
        `singles/SingleList.tsx:46,90`, `dashboard/MobileDashboard.tsx:60`,
        `dashboard/Dashboard.tsx:36`, `shidduchim/ShidduchimList.tsx:151`,
        `settings/FamilySection.tsx:26`.
  - [ ] `settings/exportFamilyData.ts:5`: `EXPORT_RESOURCES` `"children"` → `"singles"`.
  - [ ] `layout/navItems.ts` needs **no** change — it never listed the resource. Confirm and
        move on.

- [ ] **Task 8 — Remaining consumers** (AC: 6, 7)
  - [ ] `layout/TopBar.tsx` (the `ChildSwitcherPill`, `data-tour="child-switcher"`),
        `dashboard/useDashboardData.ts`, `dashboard/DashboardHeader.tsx`,
        `dashboard/Dashboard.tsx`, `dashboard/MobileDashboard.tsx`,
        `dashboard/PipelineSnapshot.tsx`, `dashboard/AttentionSection.tsx`,
        `dashboard/RecentSuggestions.tsx`, `dashboard/bucketByState.ts`,
        `shidduchim/ShidduchimList.tsx` (incl. `ShidduchimNoChildren` → `ShidduchimNoSingles`),
        `shidduchim/ShidduchCreate.tsx`, `shidduchim/ShidduchInputs.tsx`,
        `shidduchim/ShidduchCard.tsx`, `shidduchim/ShidduchShowHeader.tsx`,
        `shidduchim/ShidduchCatchPanel.tsx`, `shidduchim/boardUtils.ts`,
        `shidduchim/pipelineStates.ts`, `shadchanim/ShadchanSuggestions.tsx`,
        `shadchanim/ShadchanShow.tsx`, `inbox/InboxResolveDialog.tsx`,
        `references/ReferenceCallLog.tsx`, `references/RepeatRecognitionPanel.tsx`,
        `references/ReferenceList.tsx`, `references/ReferenceTimeline.tsx`,
        `references/useReferenceLinks.ts`, `settings/FamilySection.tsx`,
        `settings/PrivacySection.tsx`, `root/OnboardingGate.tsx`, `root/onboardingKeys.ts`,
        `login/FirstRunSetup.tsx`, `login/OnboardingChoice.tsx`, `tour/tourSteps.ts`
        (`desktopChildSwitcherStep` and the `[data-tour="child-switcher"]` anchor, which must
        change on **both** sides), `tour/useTour.ts`.
  - [ ] Use `LSP findReferences` on `Child`, `ChildSummary` and each renamed component before
        editing, so no call site is missed (`.claude/rules/lsp-usage.md`).

- [ ] **Task 9 — Copy and i18n** (AC: 8)
  - [ ] `providers/commons/englishCrmMessages.ts`: `resources.shidduchim.fields.child_id`
        (8) → `single_id: "Single"`; the `children:` resource block (20-30) →
        `singles: { name: "Single |||| Singles", forcedCaseName: "Single", … }`; the landing
        strings at 464, 476, 498.
  - [ ] `providers/commons/frenchCrmMessages.ts`: the mirrored `child_id` (10) and `children`
        block (22-32) — French labels, English keys (`.claude/rules/english-only.md`).
  - [ ] Rename the runtime keys and their `_:` fallbacks: `crm.children.gender_female|male`
        → `crm.singles.gender_*` (`FirstRunSetup.tsx:262,267`);
        `crm.profile.family.children` → `crm.profile.family.singles`
        (`FamilySection.tsx:29`, `PrivacySection.tsx:61`);
        `crm.auth.onboarding.child_save_error|child_title|child_body|child_first_name|child_gender|child_gender_placeholder|add_child`
        → `single_*` / `add_single` (`FirstRunSetup.tsx:103,219,224,233,245,255,281`). None of
        these keys is defined in the message catalogues — they resolve to their `_:` default,
        so this is a code-only rename plus a copy rewrite.
  - [ ] Landing copy: `LandingHero.tsx:29` and `englishCrmMessages.ts:464`
        `"for your children."` → `"for your singles."`; `LandingWhatItDoes.tsx:21` and
        `LandingHowItWorks.tsx:17` "the child it was suggested for" / "against a child" →
        "the single it was suggested for" / "against a single"; update
        `LandingPage.test.tsx:19` to the new sentence.

- [ ] **Task 10 — Tests** (AC: 12, 13)
  - [ ] Update the 9 suites that carry the old vocabulary:
        `dashboard/bucketByState.test.ts`, `shidduchim/boardUtils.test.ts`,
        `shidduchim/redts.test.ts`, `shidduchim/schools.test.ts`,
        `shidduchim/pipelineStates.test.ts`, `shidduchim/shidduchService.test.ts`,
        `shidduchim/ShidduchCatchPanel.test.tsx`,
        `providers/fakerest/internal/shidduchCatch.test.ts`,
        `providers/fakerest/dataProvider.summaryStats.test.ts` (its
        `describe("children_summary emulation (E6)")` becomes `singles_summary`).
        Leave `providers/fakerest/dataProvider.childPortal.test.ts` alone — 1.4 deletes it.
  - [ ] Add the **negative RLS test** required by AC-13(e): two accounts, one row each in
        `singles`; assert account A's client reads exactly its own row from both
        `singles` and `singles_summary`. `.claude/rules/security-triggers.md` makes this
        mandatory for any policy-touching diff.
  - [ ] `make test` / `make typecheck` / `make lint`.

- [ ] **Task 11 — Seed and demo data** (AC: 9)
  - [ ] `supabase/functions/seed_demo/dataset.ts`: `DemoChild` → `DemoSingle` (17),
        `CHILDREN` → `SINGLES` (26), comments at 123 and 212.
  - [ ] `supabase/functions/seed_demo/index.ts`: the import (9), the emptiness guard list
        (41), `.from("children")` (125), `CHILDREN` (126), the `childId` parameter and
        `p_child_id` RPC argument (73, 86), the local `children` binding and its error text
        (124-134), the `children:` response count key (249), comments 24, 36-37, 273-274.
  - [ ] `supabase/functions/clear_demo/index.ts`: the `"children"` entry (44) and the
        FK-order comment (28-29).
  - [ ] FakeRest generators: `dataGenerator/types.ts:41` (`children: Child[]` →
        `singles: Single[]`), `dataGenerator/index.ts:30,50,65`,
        `dataGenerator/shidduchim.ts` (`childrenSeed`, the 15 `child_id` seed rows,
        `childGenderById`, `db.children = childrenSeed` at 385).

- [ ] **Task 12 — Final verification** (AC: 10, 11, 12, 13)
  - [ ] Run the AC-11 grep and confirm the only survivors are the enumerated 1.4 portal files.
  - [ ] Confirm the new migration contains no `create view public.children`, no
        `alter table … rename to children`, and no second function/route/type carrying the old
        name.
  - [ ] `make typecheck && make lint && make test`, then a manual smoke of `/singles`,
        `/singles/create`, `/singles/:id/show`, the dashboard switcher and the pipeline board.

## Dev Notes

### Why this rename exists

> "the person being redt for is a **`single`**, never a 'child' — the term is false for a
> widow, divorcee or independent adult, and a self-managing person is a `single` row in their
> own household linked by `member_id` (FR87) … CI fails on a reference to a retired name."
> [Source: ARCHITECTURE-SPINE.md#AD-23]

The glossary lists **"child"** under *"Words we deliberately do not use"*
[Source: _bmad-output/specs/spec-myshadchan/glossary.md#Words-we-deliberately-do-not-use], and
SPEC constraint *"Entities are named for what they hold"* makes it contractual
[Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Constraints]. FR86 and FR89 are the
requirement rows [Source: _bmad-output/planning-artifacts/epics.md#Requirements-Inventory].

### Greenfield rule (this is the part that fails reviews)

NFR-14: *"no backwards compatibility, deprecation shims, fallbacks or aliased names; when
something is replaced the replaced thing is deleted in the same change."*
[Source: ARCHITECTURE-SPINE.md#AD-23, _bmad-output/planning-artifacts/epics.md#NonFunctional-Requirements]
Concretely, **none of these may exist after this story**: a `children` view over `singles`,
a `child_id` column kept alongside `single_id`, a `/children` → `/singles` redirect, an
`export type Child = Single` alias, a `children/index.ts` re-export, or a kept
`is_child_visible_state` wrapper delegating to the new function.

### Verified surface (counted, 2026-07-26)

| Area | Files | Line-level references |
|---|---|---|
| `supabase/schemas/*.sql` (rename scope) | 6 | 87 |
| `supabase/schemas/*.sql` (portal, story 1.4) | 4 | 69 |
| `src/**` (rename scope) | 68 | 490 |
| `src/**` + `supabase/functions` (portal, story 1.4) | 9 | 114 |
| `supabase/functions/{seed_demo,clear_demo}` | 3 | 25 |
| **Rename total** | **77** | **602** |

`supabase/schemas` per file (total → rename scope): `01_tables.sql` 47 → 25;
`02_functions.sql` 46 → 23; `03_views.sql` 17 → 17; `04_triggers.sql` 5 → 2;
`05_policies.sql` 10 → 6; `06_grants.sql` 31 → 14.

**The 68 `src/` files, with rename-scope hit counts** (verified by
`grep -rniE '\bchild(ren)?\b|child_id|childId'` with React `children`/`asChild`/CSS
`:first-child` noise filtered out; no truncation):

`shidduchim/ShidduchimList.tsx` 30 · `providers/fakerest/dataProvider.ts` 29 ·
`providers/fakerest/dataGenerator/shidduchim.ts` 28 · `children/ChildList.tsx` 28 ·
`types.ts` 26 · `providers/fakerest/dataProvider.summaryStats.test.ts` 25 ·
`login/FirstRunSetup.tsx` 19 · `layout/TopBar.tsx` 19 · `children/ChildShow.tsx` 18 ·
`children/ChildCard.tsx` 15 · `dashboard/DashboardHeader.tsx` 14 ·
`providers/fakerest/internal/shidduchCatch.ts` 13 · `dashboard/useDashboardData.ts` 13 ·
`dashboard/Dashboard.tsx` 13 · `children/ChildEdit.tsx` 13 · `tour/tourSteps.ts` 11 ·
`dashboard/MobileDashboard.tsx` 11 · `children/index.ts` 11 ·
`shidduchim/shidduchService.test.ts` 10 · `providers/supabase/dataProvider.ts` 8 ·
`providers/fakerest/internal/referenceSummary.ts` 8 · `children/ChildCreate.tsx` 8 ·
`shidduchim/schools.test.ts` 7 · `settings/FamilySection.tsx` 7 ·
`providers/fakerest/internal/shidduchCatch.test.ts` 7 ·
`providers/commons/englishCrmMessages.ts` 6 · `shidduchim/redts.test.ts` 5 ·
`shidduchim/ShidduchCatchPanel.test.tsx` 5 · `root/OnboardingGate.tsx` 5 ·
`shidduchim/ShidduchCreate.tsx` 4 · `shidduchim/ShidduchCatchPanel.tsx` 4 ·
`shadchanim/ShadchanSuggestions.tsx` 4 · `inbox/InboxResolveDialog.tsx` 4 ·
`dashboard/RecentSuggestions.tsx` 4 · `dashboard/PipelineSnapshot.tsx` 4 ·
`children/ChildFormFrame.tsx` 4 · `shidduchim/pipelineStates.test.ts` 3 ·
`settings/PrivacySection.tsx` 3 · `root/CRM.tsx` 3 · `references/useReferenceLinks.ts` 3 ·
`providers/fakerest/dataGenerator/index.ts` 3 · `dashboard/AttentionSection.tsx` 3 ·
`shidduchim/ShidduchInputs.tsx` 2 · `shidduchim/ShidduchCard.tsx` 2 ·
`login/OnboardingChoice.tsx` 2 · `dashboard/bucketByState.ts` 2 ·
`dashboard/bucketByState.test.ts` 2 · `children/ChildInputs.tsx` 2 · `tour/useTour.ts` 1 ·
`shidduchim/pipelineStates.ts` 1 · `shidduchim/boardUtils.ts` 1 ·
`shidduchim/boardUtils.test.ts` 1 · `shidduchim/ShidduchShowHeader.tsx` 1 ·
`shadchanim/ShadchanShow.tsx` 1 · `settings/exportFamilyData.ts` 1 ·
`root/onboardingKeys.ts` 1 · `references/RepeatRecognitionPanel.tsx` 1 ·
`references/ReferenceTimeline.tsx` 1 · `references/ReferenceList.tsx` 1 ·
`references/ReferenceCallLog.tsx` 1 · `providers/fakerest/dataGenerator/types.ts` 1 ·
`providers/commons/frenchCrmMessages.ts` 1 · `landing/LandingWhatItDoes.tsx` 1 ·
`landing/LandingPage.test.tsx` 1 · `landing/LandingHowItWorks.tsx` 1 ·
`landing/LandingHero.tsx` 1 · `dashboard/Welcome.tsx` 1 · `src/App.tsx` 1
(all paths relative to `src/components/atomic-crm/` unless stated).

`src/App.tsx`'s single remaining hit is line 10, a comment inside the portal-routing block —
story 1.4 removes it, so 1.3 leaves it alone.

**Definitively out of scope** (verified zero domain hits): `workers/`, `e2e/`, `scripts/`,
`public/`, `demo/`, `test-data/`, `registry.json`, `doc/src`, and everything under
`src/components/admin/` and `src/components/ui/` (their `children` occurrences are the React
prop). `e2e/fixtures.ts`'s `TABLES` list contains only fork-era tables — that is story 1.1's.
`design-artifacts/*.md` are historical planning records and are **not** rewritten.

### The rename decisions you were told to justify

| Identifier | Decision | Why |
|---|---|---|
| `public.children` | → `public.singles` | AD-23, verbatim. |
| `child_id` on `shidduchim` / `date_records` / `inbox_items` | → `single_id` | The column names the person being redt for. Same word, same lie. |
| `child_first_name_*`, `child_last_name_*` (view + RPC payload keys) | → `single_first_name_*`, `single_last_name_*` | Same. These are read by the SPA, so the TS types move with them. |
| **`is_child_visible_state`** | → **`is_single_visible_state`** | It answers *"which pipeline states may the person being redt for see"* — the subject is the single, not a tree relation. AD-3's dignity floor is about "the child" only because AD-3 predates A2; AD-2 records the amendment (`child_candidate` is renamed `single` (AD-23)) and AD-23 governs. Roles in AD-2 are `parent_admin \| single \| helper \| self_manager \| shadchan` — there is no `child` role to name it after. |
| **`private_child`** (in `shidduchim_visibility_check` and `ShidduchVisibility`) | → **`private_single`** | Same reasoning: it is the counterpart to `private_parent`, and `parent` is a real persona while `child` is not. The pair becomes `private_parent \| private_single`, which matches the role vocabulary exactly. |
| `private_parent` | **unchanged** | "Parent" is a first-class persona in the glossary and AD-2. Renaming it would be scope creep and would be wrong. |
| `singles.member_id` | **unchanged** | It names a membership row, not a child. See the FK note below. |
| `child_portal_tokens`, `set_child_portal_token_defaults()`, `get_child_portal()`, `portal/`, `ChildPortalShare` | **untouched** | Story 1.4 deletes them whole. Renaming them first would be pure churn on code that is about to be removed. |

### Cross-story coupling — read this before starting

- **Story 1.4 (retire the token portal) should land first.** It deletes 9 files and 114
  references that would otherwise have to be renamed and then deleted. If 1.4 lands first,
  AC-11's grep returns **zero** hits and there is no allow-list. If 1.3 lands first,
  `ChildPortalShare.tsx` moves into `singles/` unchanged and the allow-list in AC-11 applies.
  Do not rename portal symbols under any ordering.
- **Story 1.1 (delete the fossil resources)** removes `contacts`, `companies`, `deals`,
  `deal_notes`, `contact_notes`, `tags`, `favicons_excluded_domains`. It touches the *same
  files* you will: `root/CRM.tsx`, `types.ts`, both `dataProvider.ts`, both
  `*CrmMessages.ts`, `dataGenerator/*`, `03_views.sql`, `06_grants.sql`, `e2e/fixtures.ts`.
  Expect conflicts there.
- **Story 1.2 (`sales` → `members`)** also touches `root/CRM.tsx` (`<Resource name="sales">`),
  `types.ts`, `01_tables.sql`, `02_functions.sql` (`set_sales_id_default`), `06_grants.sql`
  and `dataGenerator/sales.ts`.
- **Correction to the brief:** `children.member_id` does **not** point at `sales`. The FK is
  `children_member_id_fkey foreign key (member_id) references public.account_members(id) on
  delete set null` (`01_tables.sql:680-681`). `account_members` is a *different* table from
  `sales` and story 1.2 does not rename it. So `singles.member_id` needs no coordination with
  1.2 — but flag to the team that after 1.2 the schema will hold both `members` (ex-`sales`)
  and `account_members`, which is confusing; resolving that is Epic 2's `AD-2` work, **not
  this story's**.
- **Epic 2 (story 2.2)** will add `single` to `account_members_role_check` (today it is
  `parent_admin | helper | self_manager | shadchan`). Do **not** touch that constraint here.

### Migration workflow for this repo (non-obvious, gets people)

- `supabase/schemas/*.sql` is the **source of truth**; migrations are generated from it
  [Source: AGENTS.md#Database-Management].
- Every `npx supabase …` call must be prefixed `DBUS_SESSION_BUS_ADDRESS=/dev/null`, or it
  hangs on the keyring (looks like a Docker fault; it isn't)
  [Source: memory/supabase-cli-dbus-hang.md].
- Loop: edit `supabase/schemas/*` → `db diff --local -f <name>` → **hand-check** →
  `migration up --local`. **Never `db reset --local`** (destructive) and **never `db push`**
  from a story.
- `db diff` is not trustworthy for this change and must be corrected by hand:
  1. it emits **DROP + CREATE** where a rename is meant (AGENTS.md names this explicitly);
  2. it **drops `WITH (security_invoker = on)`** when it writes a view — without it the view
     runs as owner and RLS never applies. Precedent:
     `supabase/migrations/20260724112600_add_summary_stats_views.sql:28-47` re-adds it by hand;
  3. it **does not diff view privileges at all**, so a recreated view keeps schema-default
     privileges, which grant `anon`. Re-add the `revoke … from anon, authenticated` /
     `grant select … to authenticated` / `grant all … to service_role` triplet for each view;
  4. function definitions in `02_functions.sql` must keep the exact `pg_dump` format
     (`npx supabase db dump --local --schema public`) or the next diff shows phantom changes.
- Historical migrations under `supabase/migrations/` are **append-only and are not edited**.
  Eight of them mention `children`/`child_id` (`20260722120000_shidduchim_pipeline.sql`,
  `20260722130000_shidduch_redts.sql`, `20260722140000_shidduch_schools.sql`,
  `20260722150000_references_entity.sql`, `20260724112600_add_summary_stats_views.sql`,
  `20260724115340_add_shidduch_catch.sql`, `20260724130247_add_inbox_items.sql`,
  `20260724170639_add_child_portal.sql`). That is the record of what was applied, not a live
  reference, so AC-11 deliberately scopes its grep to `supabase/schemas/` and
  `supabase/functions/`. **Scope flag:** squashing the migration history so that literally no
  file names `children` would be defensible under the SPEC assumption *"existing production
  data is demo and test only"*, but it is an Epic-1-wide call (closest home: story 1.6, the
  tidy-code baseline) and is **not** taken here. Raise it rather than doing it unilaterally.

### Security / RLS

Every table in `public` ships `account_id` + RLS scoped to `current_account_id()`
[Source: ARCHITECTURE-SPINE.md#AD-1]. This diff renames an RLS-protected table, its policy and
three `security_invoker` views, so `.claude/rules/security-triggers.md` mandates a security
review **and** a negative test (AC-13e). The two ways this rename silently breaks isolation:
a recreated view losing `security_invoker = on`, and a recreated view/table regaining the
`anon` default grant. Assert both explicitly.

Note that `current_account_id()` is itself the blocker Epic 2 replaces (it resolves a user to
one arbitrary account via `order by am.id limit 1`)
[Source: ARCHITECTURE-SPINE.md#AD-19]. **Do not touch it here** — rename around it.

### Project Structure Notes

- Component directories under `src/components/atomic-crm/` are lowercase and plural
  (`shidduchim/`, `shadchanim/`, `references/`) → `singles/`. Resource names are
  snake_case-plural [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions], and the
  PostgREST resource name follows the table, so `<Resource name="singles">` and `/singles`
  come free with the table rename.
- Components are PascalCase singular (`ReferenceList`, `ShadchanShow`) → `SingleList`,
  `SingleShow`, `SingleCard`, `SingleCreate`, `SingleEdit`, `SingleInputs`,
  `SingleFormFrame`. Beware the collision with the existing shadcn-admin-kit component
  `src/components/admin/single-field-list.tsx` (`SingleFieldList`) — different symbol,
  different directory, no conflict, but `workspaceSymbol "Single"` will show both.
- `.claude/rules/coding-style.md` caps files at ~400 lines typical / 800 max; this story adds
  no lines, so no file should grow past its current size.
- All committed content stays English [Source: .claude/rules/english-only.md] — the French
  message catalogue keeps English *keys* with French *values*.

### Testing standards

- AAA structure, descriptive names, isolated fixtures, ≥80% coverage on new paths
  [Source: .claude/rules/testing.md]. This story adds no new behaviour, so the bar is: every
  existing assertion keeps passing under the new names, plus the one new negative RLS test.
- Commands: `make typecheck`, `make lint`, `make test` (which runs `test-app`,
  `test-functions`, `test-workers`).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.3-Rename-children-to-singles]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-1-Debt-Clearance--Entity-Truth]
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Constraints]
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Assumptions]
- [Source: _bmad-output/specs/spec-myshadchan/glossary.md]
- [Source: ARCHITECTURE-SPINE.md#AD-23] — entities named for what they hold
- [Source: ARCHITECTURE-SPINE.md#AD-1] — scope + forced RLS, no anon grants, no definer views
- [Source: ARCHITECTURE-SPINE.md#AD-2] — role vocabulary; `child_candidate` renamed `single`
- [Source: ARCHITECTURE-SPINE.md#AD-3] — the single's visibility floor
- [Source: ARCHITECTURE-SPINE.md#AD-19] — `current_account_id()` is Epic 2's, not this story's
- [Source: AGENTS.md#Database-Management] — schema-first workflow, hand-edited renames
- [Source: .claude/rules/security-triggers.md] — RLS/migration diffs require security review
- [Source: .claude/rules/lsp-usage.md] — use `findReferences`, not `grep`, for TS symbols
- [Source: memory/supabase-cli-dbus-hang.md] — `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix
- [Source: supabase/migrations/20260724112600_add_summary_stats_views.sql:28-47] — the
  documented hand-fixes `db diff` requires for views

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
