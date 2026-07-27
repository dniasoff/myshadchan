---
baseline_commit: 8d685c491b72884fa745e8635b3c7d4c4b7eb614
---

# Story 1.3: Rename `children` to `singles`

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a product owner,
I want the entity called a **single**,
so that the model is not false for a widow, a divorcee or an independent adult managing
their own shidduchim.

## Position in Epic 1

**4th of 6.** The epic order is pinned and binding:

`1.1 (delete fossil resources) → 1.4 (retire token portal) → 1.5 (remove dead routes) →
**1.3 (this story)** → 1.2 (sales → members) → 1.6 (tidy-code baseline)`

Three stories land **before** this one and change the ground under it — read
"Cross-story coupling" in Dev Notes before starting:

- **1.1** has already deleted the fossil resources (`contacts`, `companies`, `deals`, `tags`,
  `notes`, `activity`) and the orphaned dashboard widgets including `dashboard/Welcome.tsx`.
- **1.4** has already deleted the whole token-portal surface, so **no `child_portal*` /
  `ChildPortal*` symbol exists any more** and there is no allow-list in this story's
  verification grep.
- **1.5** has already replaced the `<Resource>` / `<Route>` JSX in `root/CRM.tsx` with a
  `.map()` over `src/components/atomic-crm/root/routeManifest.ts`. **This story edits the
  manifest, not JSX.**

Two stories land **after**: 1.2 (`sales` → `members`) and 1.6 (CI baseline).

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
   **with `security_invoker = on`** and with `anon` revoked (see AC-14).

4. **The two SQL functions that name the single are renamed and their payload keys with them.**
   `public.is_child_visible_state(pipeline_state)` → `public.is_single_visible_state(pipeline_state)`
   (including the exception text `unclassified pipeline_state in single-visibility policy: %`
   and its three grant lines); `public.create_shidduch()`'s first parameter
   `p_child_id` → `p_single_id`; `public.catch_shidduch()`'s returned JSON keys `child_id`,
   `child_first_name_en`, `child_first_name_he` → `single_id`, `single_first_name_en`,
   `single_first_name_he`. Its TypeScript twin (`isChildVisibleState` /
   `CHILD_VISIBLE_STATES`) is renamed by AC-8 — the two must not diverge.

5. **`private_child` becomes `private_single`.** The `shidduchim_visibility_check`
   constraint reads `visibility in ('shared', 'private_parent', 'private_single')`, existing
   rows holding `'private_child'` are updated to `'private_single'` in the same migration,
   and the TypeScript union `ShidduchVisibility` matches. `private_parent` is unchanged.

6. **The React resource, route and directory are `singles`.**
   `src/components/atomic-crm/children/` is renamed to
   `src/components/atomic-crm/singles/`; its components become `SingleCard`, `SingleCreate`,
   `SingleEdit`, `SingleFormFrame`, `SingleInputs`, `SingleList`, `SingleShow`; the resource
   entry in `src/components/atomic-crm/root/routeManifest.ts` becomes
   `{ name: "singles", surface: "both", definition: singles }` (1.5 registered it as
   `"children"` — see Dev Notes "Cross-story coupling"); and all 7 `/children…` links resolve
   to `/singles…`. Afterwards
   `grep -n '"children"' src/components/atomic-crm/root/routeManifest.ts` returns no hits and
   `routeManifest.test.ts` still passes unchanged.

7. **The types are `Single`.** In `src/components/atomic-crm/types.ts`, `Child` → `Single`,
   `ChildSummary` → `SingleSummary`, and every `child_id` / `child_first_name_*` /
   `child_last_name_*` member on `Shidduch`, `ShidduchSummary`, `CreateShidduchInput`,
   `InboxItem`, `ReferenceLinkSummary`, `ShidduchCatchSuggestion`, `ShidduchDatePrior` and
   `DateRecord` is single-named.

8. **Every *compound* identifier that names the single is single-named — camelCase,
   PascalCase and UPPER_SNAKE included.** This is the blind spot a `\bchild\b`-style grep
   cannot see, and it is this story's to close. Applying the rule in Dev Notes
   "Which `child` stays, which goes", the following are renamed (full verified enumeration in
   Dev Notes "Compound identifiers"):
   `isChildVisibleState` → `isSingleVisibleState` and `CHILD_VISIBLE_STATES` →
   `SINGLE_VISIBLE_STATES` (`shidduchim/pipelineStates.ts:114,142,143` + `pipelineStates.test.ts`),
   `ChildSwitcherPill` → `SingleSwitcherPill`, `ChildSummary` → `SingleSummary`,
   `selectedChildId` → `selectedSingleId`, `childId` / `setChildId` → `singleId` / `setSingleId`,
   `childList` → `singleList`, `childLabel` → `singleLabel`, `childName` / `setChildName`,
   `childForm`, `handleChildSubmit`, `createChild`, `isSavingChild`, `childById`,
   `childSummaryById`, `childGenderById`, `childrenSeed`, `childrenPending`, `childrenTotal`,
   `childrenError`, `hasChildren`, `enrichChildrenSummary`, `forChild`, `totalForChild` /
   `totalForChildPending`, `onSelectChild`, `ShidduchimNoChildren` → `ShidduchimNoSingles`,
   `desktopChildSwitcherStep` → `desktopSingleSwitcherStep`, `DemoChild` → `DemoSingle`,
   `CHILDREN` → `SINGLES`, and the `children/` component-internal symbols
   (`ChildCardProps`, `ChildFormFrameProps`, `ChildListSkeleton`, `ChildListHeader`,
   `ChildListContent`, `ChildShowLayout`, `ChildShowActions`, `ChildProfileHeader`,
   `ChildEditActions`). The DOM anchor `data-tour="child-switcher"` becomes
   `data-tour="single-switcher"` on **both** sides (`layout/TopBar.tsx:93` and
   `tour/tourSteps.ts:62`).

9. **User-facing copy says "single", never "child"/"children".** Covers the i18n resource
   block (`resources.children` → `resources.singles` in both `englishCrmMessages.ts` and
   `frenchCrmMessages.ts`), `resources.shidduchim.fields.child_id` → `single_id`, the runtime
   keys `crm.children.gender_*`, `crm.profile.family.children` and
   `crm.auth.onboarding.child_*`, the onboarding/roster/pipeline empty-state and tour strings,
   and the landing copy. The single Playwright/vitest assertion that pins the landing string
   (`src/components/atomic-crm/landing/LandingPage.test.tsx:19`) is updated to match.

10. **The seeded demo data reflects the new naming.** `supabase/functions/seed_demo/dataset.ts`
    (`DemoChild` → `DemoSingle`, `CHILDREN` → `SINGLES`),
    `supabase/functions/seed_demo/index.ts` (the `"children"` table read/insert, the
    `p_child_id` RPC argument, the `children:` count key in the response) and
    `supabase/functions/clear_demo/index.ts` (the `"children"` entry in the deletion order)
    all use `singles`. The FakeRest generator (`dataGenerator/shidduchim.ts`,
    `dataGenerator/index.ts`, `dataGenerator/types.ts`) seeds `db.singles`.

11. **No alias, view, redirect or compatibility shim survives** (NFR-14). Specifically: no
    `children` view over `singles`, no `child_id` generated/duplicated column, no
    `/children → /singles` route redirect, no `Child` type alias, no
    `export const isChildVisibleState = isSingleVisibleState` re-export, no re-export from a
    `children/` barrel, and no `routeManifest` entry keeping the old resource name alive. The
    generated migration contains only `ALTER … RENAME` / `DROP`+`CREATE`, never a
    `create view public.children as select * from public.singles`.

12. **Verification — the three greps are clean, unconditionally.** Because 1.4 and 1.5 land
    before this story (see "Position in Epic 1"), there is no allow-list and no
    "if 1.4 has landed" branch. From the repo root, over
    `src/ supabase/schemas/ supabase/functions/ supabase/tests/` with
    `--include='*.ts' --include='*.tsx' --include='*.sql' --exclude-dir=admin --exclude-dir=ui`
    (the two excluded directories are the untouched shadcn-admin-kit / shadcn-ui mutable
    dependencies, whose `children` is React's):

    **(a) snake_case objects, columns, resource strings and routes — must return ZERO:**
    ```
    grep -rniE 'child_|_child|child-|public\.children|children_summary|"children"|/children|db\.children|resources\.children|crm\.children' \
      src/ supabase/schemas/ supabase/functions/ supabase/tests/ \
      --include='*.ts' --include='*.tsx' --include='*.sql' --exclude-dir=admin --exclude-dir=ui \
      | grep -vE 'node:child_process|(first|last|only|nth)-child'
    ```

    **(b) camelCase / PascalCase / UPPER_SNAKE compounds — case-SENSITIVE, must return ZERO:**
    ```
    grep -rnE '\bChild\b|\bChildren\b|Child[A-Za-z]|[a-z]Child|CHILD|child[a-z]*[A-Z]' \
      src/ supabase/schemas/ supabase/functions/ supabase/tests/ \
      --include='*.ts' --include='*.tsx' --include='*.sql' --exclude-dir=admin --exclude-dir=ui \
      | grep -vE 'asChild|appendChild|removeChild|firstChild|lastChild|replaceChildren|nbChildren|PropsWithChildren|React\.Children|\bChildren\.(toArray|only|map|count|forEach)'
    ```
    The `-i` flag is **omitted on purpose**: with it, `Child[A-Za-z]` matches the `childr` of
    React's `children` and the command drowns in false positives.

    **(c) the plain English word — allow-listed:**
    ```
    grep -rniE '\bchild(ren)?\b' \
      src/ supabase/schemas/ supabase/functions/ supabase/tests/ \
      --include='*.ts' --include='*.tsx' --include='*.sql' --exclude-dir=admin --exclude-dir=ui \
      | grep -vE 'asChild|appendChild|removeChild|firstChild|lastChild|replaceChildren|nbChildren|PropsWithChildren|React\.Children|\bChildren\.(toArray|only|map|count|forEach)|node:child_process|(first|last|only|nth)-child|childhood'
    ```
    Every surviving line is either React's `children` prop or the word used for
    *FK-dependent rows* — never for a person. The complete expected survivor set is
    enumerated in Dev Notes "Residual `children` after this story"; **anything not on that
    list is a failure.**

13. **Verification — the toolchain is green, including the database suite.**
    `make typecheck`, `npm run lint` (eslint) and `make test` **plus `npm run test:unit:db`**
    all pass **repo-wide**, with zero new warnings and with no `@ts-ignore`, `eslint-disable` or
    skipped test added to get there. `npm run test:unit:db` is **not** part of `make test`
    (`makefile:108` — `test-unit: test-app test-functions test-workers`), which is exactly why
    a rename can break `supabase/tests/*.sql` silently; it is called out here so it cannot.
    It needs the local stack running (`make start`).

    **Formatting is scoped to this story's own diff, and `make lint` as a whole is not the
    gate.** `make lint` runs `npm run lint` **and** `npm run prettier`; the eslint half passes
    repo-wide today and must keep passing, but the prettier half fails on **89 files** on `main`
    (plus one it cannot parse), overwhelmingly in files this story never opens. So the criterion
    is `npx prettier --config ./.prettierrc.json --check <every file this story creates, renames
    or modifies>` → clean. Making repo-wide `npm run prettier` / `make lint` green is **story
    1.6's** AC-5, and it gets there partly through `.prettierignore` policy that is not this
    story's to set.

    `make test-e2e-ci` is likewise **not** part of this gate: `e2e/` holds no spec between 1.1
    and 1.6, so Playwright exits 1 with `Error: No tests found`. That interim red is documented
    in 1.1 §"Known interim red: the `e2e-test` job" and closed by 1.6 AC-7.

14. **Verification — the database is proven, not assumed.** After
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

- [x] **Task 1 — Rename the table and its attached objects in the declarative schema** (AC: 1, 2, 5)
  - [x] `supabase/schemas/01_tables.sql`: `create table public.children` → `public.singles`
        (line 277) and rewrite the section comment at line 276.
  - [x] Rename in the constraints block: `children_account_id_id_key` (661),
        `children_account_id_fkey` (679), `children_member_id_fkey` (681),
        `shidduchim_child_id_fkey` (692-693), `date_records_child_id_fkey` (728-729) —
        each `references public.children(account_id, id)` becomes `public.singles(...)`.
  - [x] Rename the columns: `shidduchim.child_id` (336), `inbox_items.child_id` (405),
        `date_records.child_id` (442) → `single_id`.
  - [x] Rename the indexes: `children_account_id_idx` (792), `shidduchim_child_id_idx` (796),
        `date_records_child_id_idx` (803).
  - [x] Change `shidduchim_visibility_check` (371-373) to `'private_single'`.
  - [x] Refresh the prose comments that call the entity a child: lines 276, 329, 364, 390,
        413, 513-514, 654.
  - [x] The `child_portal_tokens` block is **already gone** (story 1.4). If you still find one
        at ~624-652 / 775-786 / 822-823, the pinned order has been violated — stop and report.

- [x] **Task 2 — Rename the dependent schema objects** (AC: 1, 3, 4)
  - [x] `supabase/schemas/05_policies.sql`: `alter table public.children enable row level
        security` (88) → `public.singles`; policy `"Children scoped to account"` (112) →
        `"Singles scoped to account" on public.singles`; refresh comments 178, 185-187
        (`is_child_visible_state` → `is_single_visible_state`).
  - [x] `supabase/schemas/04_triggers.sql`: `set_children_account_id` (99-101) →
        `set_singles_account_id … before insert on public.singles`.
  - [x] `supabase/schemas/03_views.sql`: rewrite `shidduchim_summary` (181-229),
        `reference_links_summary` (263-290) and `children_summary` → `singles_summary`
        (292-320) — new column names per AC-3, joins onto `public.singles`, keeping
        `with (security_invoker = on)` on all three.
  - [x] `supabase/schemas/02_functions.sql`: rename `is_child_visible_state` (578) and its
        exception text (592); rename `create_shidduch`'s `p_child_id` (644) and the four body
        sites (686-689, 708, 716, 735); rename the `catch_shidduch` output keys (1995-1997,
        2011, 2037-2040) and its `public.children` joins; refresh comments 559, 573, 683, 732,
        1925, 1977-1978.
  - [x] `supabase/schemas/06_grants.sql`: table grants (195-197 and 484-485), sequence grants
        (256-258 → `singles_id_seq`), `is_child_visible_state` grants (303-305), and
        `children_summary` view grants (381-383).

- [x] **Task 3 — Generate and hand-check the migration** (AC: 1, 2, 3, 4, 5, 11, 14)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f rename_children_to_singles`
  - [x] **Replace the generated `DROP TABLE public.children` + `CREATE TABLE public.singles`
        with `ALTER TABLE public.children RENAME TO public.singles;`** — the generated form
        destroys data and breaks every FK (AGENTS.md explicitly calls this out for renames).
        Same for the three renamed columns (`ALTER TABLE … RENAME COLUMN`).
  - [x] Add the renames `db diff` never emits: `ALTER SEQUENCE public.children_id_seq RENAME
        TO singles_id_seq;`, `ALTER INDEX … RENAME TO …` (×3), `ALTER TABLE … RENAME
        CONSTRAINT … TO …` (×5), `ALTER POLICY "Children scoped to account" ON public.singles
        RENAME TO "Singles scoped to account";`, `ALTER TRIGGER set_children_account_id ON
        public.singles RENAME TO set_singles_account_id;`.
  - [x] `DROP FUNCTION public.is_child_visible_state(public.pipeline_state);` and
        `DROP FUNCTION public.create_shidduch(<18-arg signature>);` **before** creating the
        renamed versions — `CREATE OR REPLACE` cannot rename a parameter, and a rename that
        leaves the old function in place is an alias (AC-11). Re-issue every `REVOKE`/`GRANT`
        for both, because grants die with the dropped function.
  - [x] `DROP VIEW` the three views before recreating them (a `CREATE OR REPLACE VIEW` cannot
        rename or drop a column), in dependency-safe order, then re-apply
        `alter view … set (security_invoker = on);` and the `revoke anon` / `grant select
        authenticated` / `grant all service_role` triplet for each — `db diff` emits neither.
  - [x] Migrate the data value: `update public.shidduchim set visibility = 'private_single'
        where visibility = 'private_child';` **before** re-adding
        `shidduchim_visibility_check`.
  - [x] Apply with `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
        **Never `db reset` and never `db push`.**

- [x] **Task 4 — Types** (AC: 7, 5)
  - [x] `src/components/atomic-crm/types.ts`: `Child` → `Single` (277), `ChildSummary` →
        `SingleSummary` (296) and its doc comment (291-295), `ShidduchVisibility`'s
        `"private_child"` → `"private_single"` (258), then the member renames on `Shidduch`
        (398), `ShidduchSummary` (428-431), `CreateShidduchInput` (494), `InboxItem` (534),
        `ReferenceLinkSummary` (600-602), `ShidduchCatchSuggestion` (686-688),
        `ShidduchDatePrior` (704-705), `DateRecord` (790). The `ChildPortal*` types
        (currently 311-342) are **already deleted** by 1.4 — if they are still there, the
        pinned order has been violated; stop and report.

- [x] **Task 5 — Data providers** (AC: 6, 7, 3, 4, 8)
  - [x] `providers/supabase/dataProvider.ts`: `p_child_id` → `p_single_id` (75) and the
        comment at 125.
  - [x] `providers/fakerest/dataProvider.ts`: the `"children"` base-resource reads (266, 276,
        538, 540), the `children_summary` emulation `enrichChildrenSummary` →
        `enrichSinglesSummary` (337, 537, 543) with its `forChild` local (345, 348, 349), the
        `child_first_name_*` / `child_last_name_*` enrichment and its `childById` map
        (304-317), and the `createShidduch` emulation (418-479).
  - [x] `providers/fakerest/internal/shidduchCatch.ts` (`childById` 159, 175, 222) and
        `providers/fakerest/internal/referenceSummary.ts` (`childById` 123, 131): same
        key/resource/local renames.

- [x] **Task 6 — Rename the resource directory and its components** (AC: 6, 8)
  - [x] `git mv src/components/atomic-crm/children src/components/atomic-crm/singles`, then
        rename `ChildCard.tsx` → `SingleCard.tsx`, `ChildCreate.tsx` → `SingleCreate.tsx`,
        `ChildEdit.tsx` → `SingleEdit.tsx`, `ChildFormFrame.tsx` → `SingleFormFrame.tsx`,
        `ChildInputs.tsx` → `SingleInputs.tsx`, `ChildList.tsx` → `SingleList.tsx`,
        `ChildShow.tsx` → `SingleShow.tsx`, and rename the exported symbols to match.
  - [x] Rename the file-local compounds too (AC-8): `ChildCardProps` (`ChildCard.tsx:9,30,32`),
        `ChildFormFrameProps` (`ChildFormFrame.tsx:5,12,18,22`), `ChildListSkeleton` /
        `ChildListHeader` / `ChildListContent` (`ChildList.tsx:13,32,62,82,84,114,124`),
        `ChildShowLayout` / `ChildProfileHeader` / `ChildShowActions` / `childName`
        (`ChildShow.tsx:34,102,106,111,113,118,129,130,131`), `ChildEditActions`
        (`ChildEdit.tsx:17,24`).
  - [x] `index.ts`: `recordRepresentation` fallback `Child #${record.id}` → `Single #${record.id}`.
  - [x] `SingleList.tsx`: `useGetList<SingleSummary>("children_summary")` (68) →
        `"singles_summary"`.
  - [x] `ChildPortalShare.tsx` no longer exists (deleted by 1.4). If it does, stop and report.

- [x] **Task 7 — Registration point and routes** (AC: 6)
  - [x] `src/components/atomic-crm/root/routeManifest.ts` (created by story 1.5): change the
        resource entry `{ name: "children", … }` to `{ name: "singles", … }` and the import
        `import children from "../children"` to `import singles from "../singles"`. **Do not
        look for `<Resource name="children">` JSX in `root/CRM.tsx` — 1.5 removed it; `CRM.tsx`
        now only maps over the manifest.** If you still find the JSX, the pinned order has been
        violated: stop and report rather than adapting.
  - [x] Re-run `routeManifest.test.ts` — it asserts route/resource shape, not names, so it must
        pass unchanged.
  - [x] Rewrite the 7 `/children…` links: `singles/SingleCard.tsx:51`,
        `singles/SingleList.tsx:46,90`, `dashboard/MobileDashboard.tsx:60`,
        `dashboard/Dashboard.tsx:36`, `shidduchim/ShidduchimList.tsx:151`,
        `settings/FamilySection.tsx:26`.
  - [x] `settings/exportFamilyData.ts:5`: `EXPORT_RESOURCES` `"children"` → `"singles"`.
  - [x] `layout/navItems.ts` needs **no** change — it never listed the resource. Confirm and
        move on.

- [x] **Task 8 — Remaining consumers, including every compound identifier** (AC: 6, 7, 8)
  - [x] Work the file list in Dev Notes "Compound identifiers" top to bottom. It is the
        verified enumeration of everything grep (b) of AC-12 will catch; nothing on it is
        optional.
  - [x] `shidduchim/pipelineStates.ts`: `CHILD_VISIBLE_STATES` (114, 143) →
        `SINGLE_VISIBLE_STATES`, `isChildVisibleState` (142) → `isSingleVisibleState`,
        comments 109-111. Then `shidduchim/pipelineStates.test.ts` (3, 5, 101, 107-109,
        113-116). This keeps the TS twin in lockstep with the SQL function renamed in Task 2 —
        story 1.4 deliberately left both for this story (1.4 §"Position and dependencies",
        bullet "Every `child`-named **symbol** … is **1.3's** to rename"; and 1.4 **AC 8**,
        "left for story 1.3 to rename … Untouched here").
  - [x] `layout/TopBar.tsx`: `ChildSwitcherPill` (38, 68), `childLabel` (57, 100, 113),
        `childList` (69, 76, 77, 79, 81, 86, 108), `childId` / `setChildId` (73, 76, 77, 79,
        86, 111), the `ChildContext` TODO comment (65), and `data-tour="child-switcher"` (93).
  - [x] `tour/tourSteps.ts`: `desktopChildSwitcherStep` (61, 127), the
        `[data-tour="child-switcher"]` anchor (62) — which must change on **both** sides — and
        the copy at 9, 13, 60, 64, 78. Then `tour/useTour.ts`.
  - [x] `dashboard/`: `useDashboardData.ts` (`setChildId` 12/33/37/67, `childrenPending`
        26/63, `selectedChildId` 41/47/50/64/66, `totalForChild` + `totalForChildPending`
        43/64/68, `ChildContext` comment 21, `child_id` filter 47), `DashboardHeader.tsx`
        (`childList` 8/19/23/37/39, `childLabel` 13/24/53, `onSelectChild` 10/21/43),
        `Dashboard.tsx` (22, 41, 46, 47, 48, 60, 63), `MobileDashboard.tsx` (45, 66, 72, 73,
        74, 86, 87), `PipelineSnapshot.tsx`, `AttentionSection.tsx`, `RecentSuggestions.tsx`,
        `bucketByState.ts`.
  - [x] `shidduchim/ShidduchimList.tsx`: `ShidduchimNoChildren` → `ShidduchimNoSingles`
        (36, 143), `childLabel` (16, 127), `childrenPending` (20, 35), `childId` / `setChildId`
        (27, 31, 105), `selectedChildId` (38, 51), `childList` (50, 67, 71, 85, 97, 101, 105,
        113, 115), `onSelectChild` (52, 69, 73, 87), the `child_id` filter (44) and the "No
        children yet" copy (145).
  - [x] `login/FirstRunSetup.tsx`: `childName` / `setChildName` (46, 99), `createChild` /
        `isSavingChild` (58, 88, 276, 278), `childForm` (63, 87, 240, 250),
        `handleChildSubmit` (87, 230), plus the i18n keys handled in Task 9.
  - [x] `root/OnboardingGate.tsx`: `childrenTotal` / `childrenPending` (32, 39),
        `hasChildren` (43, 44), the `"children"` resource read (33), comments 10, 15, 26.
        **Careful:** lines 31, 40 and 50 use React's `children` prop in the same file — they
        stay. `root/onboardingKeys.ts` (8).
  - [x] `settings/PrivacySection.tsx`: `childrenTotal` (24, 64), the `"children"` read (24),
        the label key + fallback (61-62). `settings/FamilySection.tsx`: comments 11-13, the
        link (26) and the label key (29).
  - [x] `providers/fakerest/dataGenerator/shidduchim.ts`: `childrenSeed` (61, 356, 385),
        `childGenderById` (356, 364), the `childId` loop variable (292, 296), the 15 `child_id`
        seed rows and `db.children = childrenSeed` (385).
  - [x] `providers/fakerest/dataProvider.summaryStats.test.ts`: `ChildSummary` (2, 12, 13),
        `childSummaryById` (9, 69, 82), `childId` (69), and the
        `describe("children_summary emulation (E6)")` heading.
  - [x] The remaining single-hit consumers: `shidduchim/ShidduchCreate.tsx`,
        `ShidduchInputs.tsx`, `ShidduchCard.tsx`, `ShidduchShowHeader.tsx`,
        `ShidduchCatchPanel.tsx`, `boardUtils.ts`, `shadchanim/ShadchanSuggestions.tsx`,
        `shadchanim/ShadchanShow.tsx`, `inbox/InboxResolveDialog.tsx`,
        `references/ReferenceCallLog.tsx`, `RepeatRecognitionPanel.tsx`, `ReferenceList.tsx`,
        `ReferenceTimeline.tsx`, `useReferenceLinks.ts`, `login/OnboardingChoice.tsx`.
  - [x] Use `LSP findReferences` on `Child`, `ChildSummary`, `isChildVisibleState` and each
        renamed component before editing, so no call site is missed
        (`.claude/rules/lsp-usage.md`).

- [x] **Task 9 — Copy and i18n** (AC: 9)
  - [x] `providers/commons/englishCrmMessages.ts`: `resources.shidduchim.fields.child_id`
        (8) → `single_id: "Single"`; the `children:` resource block (20-30) →
        `singles: { name: "Single |||| Singles", forcedCaseName: "Single", … }`; the landing
        strings at 464, 476, 498.
  - [x] `providers/commons/frenchCrmMessages.ts`: the mirrored `child_id` (10) and `children`
        block (22-32) — French labels, English keys (`.claude/rules/english-only.md`).
  - [x] Rename the runtime keys and their `_:` fallbacks: `crm.children.gender_female|male`
        → `crm.singles.gender_*` (`FirstRunSetup.tsx:262,267`);
        `crm.profile.family.children` → `crm.profile.family.singles`
        (`FamilySection.tsx:29`, `PrivacySection.tsx:61`);
        `crm.auth.onboarding.child_save_error|child_title|child_body|child_first_name|child_gender|child_gender_placeholder|add_child`
        → `single_*` / `add_single` (`FirstRunSetup.tsx:103,219,224,233,245,255,281`). None of
        these keys is defined in the message catalogues — they resolve to their `_:` default,
        so this is a code-only rename plus a copy rewrite.
  - [x] Landing copy: `LandingHero.tsx:29` and `englishCrmMessages.ts:464`
        `"for your children."` → `"for your singles."`; `LandingWhatItDoes.tsx:21` and
        `LandingHowItWorks.tsx:17` "the child it was suggested for" / "against a child" →
        "the single it was suggested for" / "against a single"; update
        `LandingPage.test.tsx:19` to the new sentence.

- [x] **Task 10 — Tests, TypeScript and SQL** (AC: 13, 14)
  - [x] Update the 9 TypeScript suites that carry the old vocabulary:
        `dashboard/bucketByState.test.ts`, `shidduchim/boardUtils.test.ts`,
        `shidduchim/redts.test.ts`, `shidduchim/schools.test.ts`,
        `shidduchim/pipelineStates.test.ts`, `shidduchim/shidduchService.test.ts`,
        `shidduchim/ShidduchCatchPanel.test.tsx`,
        `providers/fakerest/internal/shidduchCatch.test.ts`,
        `providers/fakerest/dataProvider.summaryStats.test.ts`.
  - [x] **`supabase/tests/shidduch_catch.sql` — 26 lines, all of them domain**
        (44, 45, 46, 47, 48, 50, 52, 53, 55, 56, 60, 61, 65, 66, 71, 72, 74, 75, 80, 81, 83,
        84, 88, 89, 90, 91). Rename `insert into public.children` → `public.singles` (45, 47,
        88), every `shidduchim.child_id` / `date_records.child_id` → `single_id`, the psql
        `\gset` variables `child_leah` / `child_rivka` / `child_b` → `single_leah` /
        `single_rivka` / `single_b`, and the two prose comments (44, 50).
  - [x] **`supabase/tests/references_entity.sql` — 23 matching lines, 22 of which change**
        (63, 64, 65, 66, 67, 68, 69, 470, 493, 609, 615, 617, 618, 619, 621, 655, 657, 658,
        659, 661, 742, 798). Rename `public.children` (63, 742), `child_id` (66, 68, 618, 658),
        the `child_a` id-table key and `v_child_a` locals (64, 65, 67, 69, 615, 617, 618, 655,
        657, 658), the four `insert into results` assertion names that say "another account's
        child" (619, 621, 659, 661), the `'stolen child'` fixture string (618), the comments
        at 470 and 493, and the forbidden-column-name list at 798
        (`'child_visible'` → `'single_visible'` — a negative assertion, so the rename is
        meaning-preserving). **Line 351 stays**: *"Deleting a reference must take its
        polymorphic children with it"* means FK-dependent rows, not people (see the rule in
        Dev Notes).
  - [x] `supabase/tests/child_portal.sql` / `.test.ts` are **already deleted** by 1.4. If they
        are still present, stop and report.
  - [x] Add the **negative RLS test** required by AC-14(e): two accounts, one row each in
        `singles`; assert account A's client reads exactly its own row from both
        `singles` and `singles_summary`. `.claude/rules/security-triggers.md` makes this
        mandatory for any policy-touching diff. Put it in `supabase/tests/references_entity.sql`
        next to the existing cross-tenant checks, so it runs under `npm run test:unit:db`.
  - [x] `make test` **and `npm run test:unit:db`** (needs `make start`) / `make typecheck` /
        `npm run lint` — plus `npx prettier --config ./.prettierrc.json --check` over this
        story's changed files only (AC-13; **not** `make lint`, whose prettier half is 1.6's).

- [x] **Task 11 — Seed and demo data** (AC: 10, 8)
  - [x] `supabase/functions/seed_demo/dataset.ts`: `DemoChild` → `DemoSingle` (17),
        `CHILDREN` → `SINGLES` (26), comments at 123 and 212.
  - [x] `supabase/functions/seed_demo/index.ts`: the import (9), the emptiness guard list
        (41), `.from("children")` (125), `CHILDREN` (126), the `childId` parameter and
        `p_child_id` RPC argument (73, 86), the local `children` / `childrenError` bindings and
        the error text (124-134), the `children:` response count key (249), comments 24, 36-37,
        273-274.
  - [x] `supabase/functions/clear_demo/index.ts`: the `"children"` entry (44) and the
        FK-order comment (28-29).
  - [x] FakeRest generators: `dataGenerator/types.ts:41` (`children: Child[]` →
        `singles: Single[]`), `dataGenerator/index.ts:30,50,65`,
        `dataGenerator/shidduchim.ts` (handled in Task 8).

- [x] **Task 12 — Final verification** (AC: 11, 12, 13, 14)
  - [x] Run AC-12 greps (a) and (b) — both must print nothing at all.
  - [x] Run AC-12 grep (c) and diff its output against Dev Notes "Residual `children` after
        this story". Any extra line is a defect.
  - [x] Confirm the new migration contains no `create view public.children`, no
        `alter table … rename to children`, and no second function/route/type carrying the old
        name.
  - [x] `make typecheck && npm run lint && make test && npm run test:unit:db`, then
        `npx prettier --config ./.prettierrc.json --check` over this story's changed files only
        (AC-13). Then a manual smoke of `/singles`, `/singles/create`, `/singles/:id/show`, the
        dashboard switcher and the pipeline board.

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
`export type Child = Single` alias, a `children/index.ts` re-export, a `routeManifest` entry
still named `"children"`, or a kept `is_child_visible_state` / `isChildVisibleState` wrapper
delegating to the new one.

### Which `child` stays, which goes — the rule, so nobody has to guess

Apply this test to every hit, in this order:

1. **Substitution test.** Replace the word with *single*. If the sentence still means the same
   thing, the identifier names the entity → **rename it**. `child_id` → `single_id` ✔;
   `isChildVisibleState` → `isSingleVisibleState` ✔; `ShidduchimNoChildren` →
   `ShidduchimNoSingles` ✔.
2. **Structural exception.** If the substitution turns the phrase into nonsense, the word is
   about *containment*, not about a person → **keep it**. This covers exactly three families:
   - React: the `children` prop, `asChild`, `PropsWithChildren`, `React.Children.*`.
   - DOM / CSS: `appendChild`, `removeChild`, `firstChild`, `lastChild`, `replaceChildren`,
     `:first-child`, `:last-child`, `:nth-child`.
   - Prose about **FK-dependent rows**: e.g.
     `supabase/tests/references_entity.sql:351` — *"Deleting a reference must take its
     polymorphic children with it"*. "Polymorphic singles" is nonsense; the rows in question
     are `tasks` and `interactions`, not people.
   Plus `node:child_process` (a Node builtin) and the English word *childhood* in
   `references/relationshipQuestions.ts:4`.
3. **`parent` is never touched.** *Parent* is a first-class persona in the glossary and in
   AD-2's role vocabulary (`parent_admin | helper | self_manager | shadchan`). `private_parent`
   and `parent_admin` are correct names and stay. Only the *counterpart* moves:
   `private_child` → `private_single`, so the pair reads `private_parent | private_single`.

Applying rule 1 is why **the visibility surface renames too**: `is_child_visible_state`,
`isChildVisibleState`, `CHILD_VISIBLE_STATES` and `private_child` all answer *"what may the
person being redt for see?"*. AD-3 says "the child" only because AD-3 predates the amendment;
AD-2 records it (`child_candidate` is renamed `single`) and AD-23 governs. There is no `child`
role left to name them after.

### The rename decisions you were told to justify

| Identifier | Decision | Why |
|---|---|---|
| `public.children` | → `public.singles` | AD-23, verbatim. |
| `child_id` on `shidduchim` / `date_records` / `inbox_items` | → `single_id` | The column names the person being redt for. Same word, same lie. |
| `child_first_name_*`, `child_last_name_*` (view + RPC payload keys) | → `single_first_name_*`, `single_last_name_*` | Same. These are read by the SPA, so the TS types move with them. |
| **`is_child_visible_state`** / **`isChildVisibleState`** / **`CHILD_VISIBLE_STATES`** | → **`is_single_visible_state`** / **`isSingleVisibleState`** / **`SINGLE_VISIBLE_STATES`** | Rule 1. Story 1.4 explicitly left all three for this story rather than freezing them (1.4 §"Position and dependencies": "Every `child`-named **symbol** … is **1.3's** to rename"; 1.4 **AC 8**: "left for story 1.3 to rename … Untouched here"). Its "retained" wording means *retained by 1.4*, not *retained forever* — under the pinned order 1.4 → 1.3, this story renames them. |
| **`private_child`** (in `shidduchim_visibility_check` and `ShidduchVisibility`) | → **`private_single`** | Rule 1 + rule 3: it is the counterpart to `private_parent`, and `parent` is a real persona while `child` is not. |
| `private_parent` | **unchanged** | Rule 3. |
| `singles.member_id` | **unchanged** | It names a membership row, not a child. See the FK note below. |
| React `children`, DOM `appendChild`, `node:child_process`, "polymorphic children" | **unchanged** | Rule 2. |

### Verified surface (counted, 2026-07-26, at `main` @ `8ad49cb`)

| Area | Files | Line-level references |
|---|---|---|
| `supabase/schemas/*.sql` (rename scope) | 6 | 87 |
| `supabase/schemas/*.sql` (portal — deleted by 1.4 before this story) | 4 | 69 |
| `src/**` (rename scope) | 66 | 488 |
| `src/**` + `supabase/functions` (portal — deleted by 1.4) | 9 | 114 |
| `supabase/functions/{seed_demo,clear_demo}` | 3 | 25 |
| `supabase/tests/*.sql` (rename scope) | 2 | 49 matching, 48 changed |
| **Rename total** | **77** | **648** |

`supabase/schemas` per file (total → rename scope): `01_tables.sql` 47 → 25;
`02_functions.sql` 46 → 23; `03_views.sql` 17 → 17; `04_triggers.sql` 5 → 2;
`05_policies.sql` 10 → 6; `06_grants.sql` 31 → 14.

**The 66 `src/` files, with rename-scope hit counts.** These counts were produced with the
*narrow* pattern `grep -rniE '\bchild(ren)?\b|child_id|childId'` (React/CSS noise filtered
out), so they are a **floor**: they do not see the camelCase compounds added by AC-8, which are
enumerated separately below. No file is missing from this list — the AC-12 (a)+(b) greps hit no
`src/` file that is not here.

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
`landing/LandingHero.tsx` 1
(all paths relative to `src/components/atomic-crm/` unless stated).

**Two files were removed from this inventory and are *not* this story's** (they were in an
earlier draft's 68-file list; re-verified by grep, hence 68 → 66 files and 490 → 488 lines):

- `dashboard/Welcome.tsx` (1 hit, line 16 `"your child's dating history"`) — **story 1.1's**.
  It has zero importers today (`grep -rn 'Welcome' src/` finds only unrelated copy strings and
  `admin/ready.tsx`) and 1.1 deletes it as a verified orphan (1.1 **AC-9**, Dev Notes
  §"Files to delete outside the six directories" → "Dashboard orphans (6)", which states
  `Welcome.tsx` is 1.1's and "story 1.3 must not list it"). Under the pinned order it is gone
  before this story starts.
- `src/App.tsx` (1 hit under the narrow pattern, line 10 — a comment inside the portal-routing
  block; 4 hits with the broad pattern, lines 2/10/38) — **story 1.4's**. All of them go with
  the portal.

### Compound identifiers — the camelCase blind spot this story closes

A `\bchild\b`-anchored grep cannot match inside a compound: `\b` requires a non-word character
after `child`, and `I`/`_`/`r` are all word characters. So `isChildVisibleState`,
`selectedChildId`, `CHILD_VISIBLE_STATES` and `childrenSeed` all slip through the pattern the
earlier drafts used. AC-12 grep (b) is written to catch them; here is the verified list it
currently returns outside the portal surface.

| File | Compound identifiers (verified line numbers) |
|---|---|
| `shidduchim/pipelineStates.ts` | `CHILD_VISIBLE_STATES` 114, 143 · `isChildVisibleState` 142 |
| `shidduchim/pipelineStates.test.ts` | `CHILD_VISIBLE_STATES` 3, 101 · `isChildVisibleState` 5, 107, 108, 109, 113, 114, 115, 116 |
| `layout/TopBar.tsx` | `ChildSwitcherPill` 38, 68 · `childLabel` 57, 100, 113 · `childList` 69, 76, 77, 79, 81, 86, 108 · `childId`/`setChildId` 73, 76, 77, 79, 86, 111 · `ChildContext` (comment) 65 |
| `tour/tourSteps.ts` | `desktopChildSwitcherStep` 61, 127 |
| `types.ts` | `ChildSummary` 296 (and `Child` 277, covered by AC-7) |
| `dashboard/useDashboardData.ts` | `setChildId` 12, 33, 37, 67 · `childrenPending` 26, 63 · `selectedChildId` 41, 47, 50, 64, 66 · `totalForChild`/`totalForChildPending` 43, 64, 68 · `ChildContext` (comment) 21 |
| `dashboard/DashboardHeader.tsx` | `childList` 8, 19, 23, 37, 39 · `childLabel` 13, 24, 53 · `onSelectChild` 10, 21, 43 |
| `dashboard/Dashboard.tsx` | `setChildId` 22 · `selectedChildId` 41, 47, 60, 63 · `childList` 46 · `onSelectChild` 48 |
| `dashboard/MobileDashboard.tsx` | `setChildId` 45 · `selectedChildId` 66, 73, 86, 87 · `childList` 72 · `onSelectChild` 74 |
| `shidduchim/ShidduchimList.tsx` | `ShidduchimNoChildren` 36, 143 · `childLabel` 16, 127 · `childrenPending` 20, 35 · `childId`/`setChildId` 27, 31, 105 · `selectedChildId` 38, 51 · `childList` 50, 67, 71, 85, 97, 101, 105, 113, 115 · `onSelectChild` 52, 69, 73, 87 |
| `login/FirstRunSetup.tsx` | `childName`/`setChildName` 46, 99 · `createChild`/`isSavingChild` 58, 88, 276, 278 · `childForm` 63, 87, 240, 250 · `handleChildSubmit` 87, 230 |
| `root/OnboardingGate.tsx` | `childrenTotal` 32, 43 · `childrenPending` 32, 39 · `hasChildren` 43, 44 |
| `settings/PrivacySection.tsx` | `childrenTotal` 24, 64 |
| `providers/fakerest/dataProvider.ts` | `enrichChildrenSummary` 337, 537, 543 · `forChild` 345, 348, 349 · `childById` 304, 309 |
| `providers/fakerest/dataProvider.summaryStats.test.ts` | `ChildSummary` 2, 12, 13 · `childSummaryById` 9, 69, 82 · `childId` 69 |
| `providers/fakerest/internal/shidduchCatch.ts` | `childById` 159, 175, 222 |
| `providers/fakerest/internal/referenceSummary.ts` | `childById` 123, 131 |
| `providers/fakerest/dataGenerator/shidduchim.ts` | `childrenSeed` 61, 356, 385 · `childGenderById` 356, 364 · `childId` 292, 296 |
| `children/*` (whole directory) | `ChildCardProps`, `ChildFormFrameProps`, `ChildListSkeleton`, `ChildListHeader`, `ChildListContent`, `ChildShowLayout`, `ChildProfileHeader`, `ChildShowActions`, `ChildEditActions`, `childName` — see Task 6 for line numbers |
| `supabase/functions/seed_demo/dataset.ts` | `DemoChild` 17 · `CHILDREN` 26 |
| `supabase/functions/seed_demo/index.ts` | `CHILDREN` 9, 126 · `childId` 73 · `childrenError` 124, 128, 129 |
| `supabase/tests/references_entity.sql` | `v_child_a` 615, 617, 618, 655, 657, 658 |

The DOM anchor string `data-tour="child-switcher"` (`layout/TopBar.tsx:93`,
`tour/tourSteps.ts:62`) is not an identifier but breaks the tour silently if only one side is
changed — grep (a)'s `child-` alternative is there for exactly this.

### Residual `children` after this story — the complete allow-list for AC-12 grep (c)

Every one of these is React's `children` prop (rule 2). **Re-verified file-by-file against the
tree that remains after 1.1, 1.4 and 1.5 have landed** — every entry below exists today and still
exists at this story's position; nothing here mentions a person. **26 entries:**

`filters/FilterCategory.tsx` · `landing/LandingGate.tsx` · `landing/LandingHeading.tsx` ·
`landing/LandingSection.tsx` · `layout/Layout.tsx` · `layout/MobileContent.tsx` ·
`layout/MobileHeader.tsx` · `layout/MobileLayout.tsx` · `layout/TopToolbar.tsx` ·
`login/AuthLayout.tsx` · `login/GoogleSignInButton.tsx` · `login/GoogleSignInButton.test.tsx` ·
`login/SSOAuthButton.tsx` · `misc/EditSheet.tsx` · `root/OnboardingGate.tsx` (lines 31, 40,
50 only) · `settings/SectionLabel.tsx` · `shadchanim/ShadchanInputs.tsx` ·
`shidduchim/ShidduchInputs.tsx` · `simple-list/SimpleListItem.tsx` ·
`tasks/TasksListFilter.test.tsx` · `src/components/supabase/layout.tsx` ·
`src/lib/genericMemo.ts` (comment) · `src/test/StoryWrapper.tsx` ·
`supabase/functions/mcp/taskListUi.ts:101,113,114` (`children` is the third parameter of a
generic DOM-element helper) · `supabase/tests/references_entity.sql:351` ("polymorphic
children" = FK-dependent rows) · `supabase/functions/clear_demo/index.ts:28` *(only if the
comment is reworded to keep the FK-cascade sense; Task 11 rewrites it, so prefer zero here)*.

**Removed from an earlier draft of this list — all three are deleted by story 1.1 and cannot be
allowlisted:** `misc/AsideSection.tsx`, `misc/CreateSheet.tsx` and `misc/ResponsiveFilters.tsx`.
1.1's scope call #5 no longer keeps the zero-importer `misc/` primitives "for Epic 3/4" — it
deletes nine of them, these three included, keeping only `misc/MobileBackButton.tsx` (which has
no `children` prop and never belonged here). `misc/EditSheet.tsx` **does** stay on the list: 1.1
keeps it because `tasks/TaskEditSheet.tsx` still imports it.

Note `misc/Markdown.tsx` is **not** on this list: story 1.5 owns and deletes it (it has zero
consumers once `notes/`, `contacts/`, `companies/` and `misc/ChangelogPage.tsx` are gone).
Likewise `deals/DealList.tsx`, `notes/NotesIteratorMobile.stories.tsx`,
`tasks/TaskCreateSheet.stories.tsx` and `misc/ImportPage.tsx` are deleted by 1.1, and
`providers/fakerest/dataProvider.childPortal.test.ts` + `supabase/tests/child_portal.sql` by 1.4.

**Not on this list because they are *renamed*, not allowlisted** — surviving files whose
`children` is ordinary English about a family rather than a React prop, each already carried by a
task above: `landing/LandingHero.tsx:29` and `landing/LandingPage.test.tsx:19` (Task 12 landing
copy), `login/OnboardingChoice.tsx:142`, `root/onboardingKeys.ts:8`,
`settings/exportFamilyData.ts:5` (a resource string → `"singles"`) and `settings/FamilySection.tsx`.
If any of them still matched grep (c) at the end, the allow-list would be hiding real work.

### Cross-story coupling — read this before starting

The order is **pinned and binding**: `1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6`. This story is 4th.

- **1.4 (retire the token portal) — hard dependency, lands 2nd.** It deletes 9 `src/` files
  and 114 references, plus `supabase/tests/child_portal.{sql,test.ts}` and the 13 portal
  database objects. Because it lands first, **AC-12 has no allow-list** and this story never
  renames a portal symbol. 1.4's composite FK
  `child_portal_tokens_child_id_fkey → children(account_id, id)` is written against
  `public.children` precisely because it runs before you (1.4 **AC 7** and its §"Position and
  dependencies" bullet "**Blocks: 1.3**"). 1.4 leaves
  `is_child_visible_state` / `isChildVisibleState` / `CHILD_VISIBLE_STATES` alone and hands
  them to you by name (1.4 **AC 8**) — AC-8 and Task 8 pick them up.
- **1.5 (remove dead routes) — hard dependency, lands 3rd.** It replaces the `<Resource>` /
  `<Route>` JSX in `root/CRM.tsx` with a `.map()` over
  `src/components/atomic-crm/root/routeManifest.ts`, and registers the resource under its
  **current** name so this story renames the manifest entry (1.5 **AC #5** and its §"Position
  and dependencies", which names the exact retarget: `{ name: "children", … }` →
  `{ name: "singles", … }`). **Task 7 edits `routeManifest.ts`, never JSX.** 1.5 also deletes
  `misc/ChangelogPage.tsx`, `settings/ProfilePage.tsx`, `settings/ProfileForm.tsx`,
  `settings/AboutSection.tsx` and `misc/Markdown.tsx`, and owns the `ChangelogMenuItem` /
  `ProfileMenuItem` removals in `TopBar.tsx` — leave all of them alone. (`misc/ImportPage.tsx`
  and `misc/useImportFromJson.ts` are **1.1's**, not 1.5's, and are gone two stories before you.)
- **1.1 (delete the fossil resources) — lands 1st.** It removes `contacts`, `companies`,
  `deals`, `deal_notes`, `contact_notes`, `tags`, `favicons_excluded_domains`, the six orphaned
  dashboard widgets (including `dashboard/Welcome.tsx`), and `misc/usePapaParse.tsx` /
  `misc/isLinkedInUrl.ts`. It touches files you also touch — `types.ts`, both
  `dataProvider.ts`, both `*CrmMessages.ts`, `dataGenerator/*`, `03_views.sql`, `06_grants.sql`
  — but it lands first, so you rebase onto its result rather than conflicting with it.
- **1.2 (`sales` → `members`) — lands 5th, after you.** It will touch `routeManifest.ts`,
  `types.ts`, `01_tables.sql`, `02_functions.sql` (`set_sales_id_default`), `06_grants.sql` and
  `dataGenerator/sales.ts`. Nothing for you to do; do not pre-empt it.
- **1.6 (tidy-code baseline) — lands last.** Its CI retired-name guard must include the
  camelCase alternatives this story introduces (`[A-Za-z]Child|Child[A-Za-z]|child[a-z]*[A-Z]|CHILD`)
  or it will not bite. Flag it if 1.6's pattern list still only has `\bchild\b`.
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
  reference, so AC-12 deliberately scopes its greps to `supabase/schemas/`,
  `supabase/functions/` and `supabase/tests/`. **Scope flag:** squashing the migration history
  so that literally no file names `children` would be defensible under the SPEC assumption
  *"existing production data is demo and test only"*, but it is an Epic-1-wide call (closest
  home: story 1.6, the tidy-code baseline) and is **not** taken here. Raise it rather than
  doing it unilaterally.

### The database test suites (`supabase/tests/`) — in scope, and not covered by `make test`

`supabase/tests/*.sql` hold the RLS / trigger / `SECURITY DEFINER` assertions that only exist
inside Postgres. Each `.sql` file is driven by a sibling `.test.ts` under the vitest **`db`**
project (`vitest.config.ts:124`), run by `npm run test:unit:db`. That script is **not** part of
`make test` (`makefile:108` — `test-unit: test-app test-functions test-workers`), so a rename
that breaks them fails nothing until someone runs it by hand. AC-13 makes it explicit and
Task 10 does the work.

After 1.4, three pairs survive: `billing_entitlement` (no `child` references),
`shidduch_catch` (26 domain lines) and `references_entity` (23 matching lines, 22 changed).
`child_portal.{sql,test.ts}` are deleted by 1.4. The two `.test.ts` wrappers contain the string
`child` exactly once each — `import { execFileSync } from "node:child_process"` — which is
rule-2 noise and is excluded by AC-12's filters.

Also note `references_entity.test.ts` opens its own transaction and truncates
`public.account_members` before including the `.sql` file; keep that preamble intact when you
add the negative RLS test required by AC-14(e).

### Security / RLS

Every table in `public` ships `account_id` + RLS scoped to `current_account_id()`
[Source: ARCHITECTURE-SPINE.md#AD-1]. This diff renames an RLS-protected table, its policy and
three `security_invoker` views, so `.claude/rules/security-triggers.md` mandates a security
review **and** a negative test (AC-14e). The two ways this rename silently breaks isolation:
a recreated view losing `security_invoker = on`, and a recreated view/table regaining the
`anon` default grant. Assert both explicitly.

Note that `current_account_id()` is itself the blocker Epic 2 replaces (it resolves a user to
one arbitrary account via `order by am.id limit 1`)
[Source: ARCHITECTURE-SPINE.md#AD-19]. **Do not touch it here** — rename around it.

### Project Structure Notes

- Component directories under `src/components/atomic-crm/` are lowercase and plural
  (`shidduchim/`, `shadchanim/`, `references/`) → `singles/`. Resource names are
  snake_case-plural [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions], and the
  PostgREST resource name follows the table, so `name: "singles"` in the manifest and
  `/singles` come free with the table rename.
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
- Commands: `make typecheck`, `npm run lint`, `make test` (which runs `test-app`,
  `test-functions`, `test-workers`) **and `npm run test:unit:db`** (which does not), plus a
  changed-files-only `npx prettier --check`. Do **not** use `make lint` as the gate — it bundles
  `npm run prettier`, which is red repo-wide until story 1.6 (AC-13).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.3-Rename-children-to-singles]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-1-Debt-Clearance--Entity-Truth]
- [Source: _bmad-output/implementation-artifacts/EPIC1-CROSSCHECK.md] — C2, G2, G4, D2, W3
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
- [Source: 1-4-retire-token-portal.md#Acceptance Criteria AC 7, AC 8 and §"Position and
  dependencies"] — 1.4 drops the composite FK against `public.children` before this story runs,
  and hands the `child`-named symbols (`is_child_visible_state`, `isChildVisibleState`,
  `CHILD_VISIBLE_STATES`) to this story to rename
- [Source: 1-5-remove-dead-routes.md#Acceptance Criteria AC #5 and §"Position and dependencies"]
  — `routeManifest.ts` replaces the `<Resource>` / `<Route>` JSX in `CRM.tsx`, registering
  `children` under its current name; this story renames the manifest entry, never JSX
- [Source: 1-1-delete-fossil-resources.md#Dev Notes §"Files to delete outside the six
  directories"] — `dashboard/Welcome.tsx` is 1.1's verified orphan and must not appear in this
  story's inventory

*(Cross-story references are cited by AC / Task / section name rather than line number: these
six files are edited throughout Epic 1 and line numbers rot within a story or two.)*
- [Source: vitest.config.ts:124, makefile:108] — the `db` test project is outside `make test`

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via the bmad-dev-story workflow, dispatched directly as
the sole agent on `main` for this story (no harness worktrees — see the orchestrator's
non-negotiable working rules for this dispatch).

### Debug Log References

- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f rename_children_to_singles`
  — generated the naive DROP TABLE `children` + CREATE TABLE `singles` (plus DROP+ADD COLUMN
  for every renamed FK column). Discarded; hand-written as `ALTER TABLE … RENAME` /
  `ALTER … RENAME CONSTRAINT/COLUMN/INDEX` throughout, per Task 3 and AGENTS.md.
- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local` — applied cleanly,
  zero errors.
- `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f phantom_check` (re-run
  after `migration up`) — "No schema changes found": the hand-written migration reproduces the
  declarative schema exactly, no drift, no stray migration file written.
- `make typecheck` / `npm run lint` / `npm run test:unit:app` / `npm run test:unit:functions` /
  `npm run test:unit:workers` / `npm run test:unit:db` — all green (see Completion Notes for
  counts).
- `npx prettier --config ./.prettierrc.json --check <this story's changed .ts/.tsx files>` —
  16 files needed `--write` (pre-existing wrapping conventions this story's edits touched);
  reformatted, then re-verified typecheck/lint/all four test projects still green.

### Completion Notes List

- **Schema (Task 1-3).** `public.children` → `public.singles` in `01_tables.sql`, with every
  attached object renamed: `singles_account_id_id_key`, `singles_account_id_fkey`,
  `singles_member_id_fkey`, `singles_account_id_idx`, `singles_id_seq`, the RLS policy
  `"Singles scoped to account"`, the trigger `set_singles_account_id`. `child_id` → `single_id`
  on `shidduchim` (NOT NULL preserved), `date_records`, and `inbox_items` (no FK/index on that
  column, confirmed). `shidduchim_visibility_check` narrowed to
  `'shared' | 'private_parent' | 'private_single'`, with existing `'private_child'` rows
  migrated to `'private_single'` in the same migration, before the constraint was re-added.
  `is_child_visible_state` → `is_single_visible_state` (incl. the exception text),
  `create_shidduch`'s `p_child_id` → `p_single_id`, `catch_shidduch`'s output keys `child_id` /
  `child_first_name_en` / `child_first_name_he` → `single_*`. Three views recreated with
  `child_*` output columns renamed (`shidduchim_summary`, `reference_links_summary`,
  `children_summary` → `singles_summary`), each with `security_invoker = on` and the
  anon-revoke/authenticated-grant/service_role-grant triplet re-applied by hand (confirmed:
  `db diff` does not diff either).
- **Migration hand-fix (Task 3).** `db diff` emitted a destructive DROP TABLE + CREATE TABLE
  (would have deleted every single and every FK to them) and DROP+ADD COLUMN for the three
  renamed FK columns (data-losing). Replaced with `ALTER TABLE … RENAME TO singles`,
  `ALTER SEQUENCE children_id_seq RENAME TO singles_id_seq` (a table rename does not rename its
  owned identity sequence), `ALTER TABLE … RENAME CONSTRAINT` (×6: `singles_pkey`,
  `singles_account_id_id_key`, `singles_account_id_fkey`, `singles_member_id_fkey`,
  `shidduchim_single_id_fkey`, `date_records_single_id_fkey`), `ALTER INDEX … RENAME` (×3),
  `ALTER TABLE … RENAME COLUMN` (×3, lossless — preserves data and the `shidduchim.single_id`
  NOT NULL), `ALTER POLICY … RENAME`, `ALTER TRIGGER … RENAME`. Because the table itself was
  renamed rather than dropped, its existing grants (`grant all … to authenticated/service_role`,
  the later hardening `grant select,insert,update,delete … to authenticated`) carried over
  automatically — no table-level revoke/re-grant was needed for `singles` itself (only for the
  three recreated views, whose privileges genuinely do not survive a `DROP VIEW` + `CREATE
  VIEW`). `is_child_visible_state` and `create_shidduch` were dropped and recreated (per Task 3's
  explicit instruction and because `create_shidduch`'s parameter name changed, which
  `CREATE OR REPLACE FUNCTION` cannot do), with their grants re-issued by hand; `catch_shidduch`
  kept its exact signature so `CREATE OR REPLACE` was safe and its grants persisted
  automatically. Verified post-migration: `public.children` no longer exists (0 rows in
  `pg_class`), RLS still enabled + not forced (matches pre-existing `relforcerowsecurity=false`
  baseline), all three views show `security_invoker=on`, zero `anon` grants on `singles` /
  `singles_summary`, and a second `db diff` shows **zero drift** ("No schema changes found").
- **Negative RLS test (AC-14e, mandated by `.claude/rules/security-triggers.md`).** Added to
  `supabase/tests/references_entity.sql`: a tenant-B `singles` row inserted under tenant B's
  own RLS context, then asserted that tenant A's authenticated session reads exactly its own
  row (count = 1) and zero of tenant B's row from both `public.singles` and
  `public.singles_summary`. Both assertions pass under `npm run test:unit:db`.
- **Frontend (Tasks 4-9).** `Child`/`ChildSummary` → `Single`/`SingleSummary` in `types.ts`;
  every `child_id`/`child_first_name_*`/`child_last_name_*` member renamed across `Shidduch`,
  `ShidduchSummary`, `CreateShidduchInput`, `InboxItem`, `ReferenceLinkSummary`,
  `ShidduchCatchSuggestion`, `ShidduchDatePrior`, `DateRecord`. Both data providers
  (`supabase/dataProvider.ts`, `fakerest/dataProvider.ts` + its two `internal/` helpers)
  updated. `git mv children → singles`, 7 components renamed (`SingleCard`, `SingleCreate`,
  `SingleEdit`, `SingleFormFrame`, `SingleInputs`, `SingleList`, `SingleShow`) plus every
  file-local compound (`SingleCardProps`, `SingleFormFrameProps`, `SingleListSkeleton/Header/
  Content`, `SingleShowLayout/Actions`, `SingleProfileHeader`, `SingleEditActions`).
  `routeManifest.ts` resource entry + import retargeted to `"singles"` — `routeManifest.test.ts`
  passes unchanged (it asserts shape, not names). All 7 `/children…` links now resolve to
  `/singles…`. Every camelCase/PascalCase/UPPER_SNAKE compound enumerated in Dev Notes
  "Compound identifiers" was renamed: `isSingleVisibleState`/`SINGLE_VISIBLE_STATES`,
  `SingleSwitcherPill`, `singleLabel`, `singleList`, `singleId`/`setSingleId`, `singleName`/
  `setSingleName`, `singleForm`, `handleSingleSubmit`, `createSingle`, `isSavingSingle`,
  `singleById`, `singleSummaryById`, `singleGenderById`, `singlesSeed`, `singlesPending`,
  `totalForSingle`/`totalForSinglePending`, `onSelectSingle`, `ShidduchimNoSingles`,
  `desktopSingleSwitcherStep`, `DemoSingle`, `SINGLES`. The `data-tour="child-switcher"` anchor
  renamed to `"single-switcher"` on both `TopBar.tsx` and `tourSteps.ts`. i18n:
  `resources.children` → `resources.singles` (English + French — French keeps English keys,
  French values updated to "Célibataire(s)"), `resources.shidduchim.fields.child_id` →
  `single_id`, all `crm.auth.onboarding.child_*` / `crm.children.gender_*` /
  `crm.profile.family.children` runtime keys renamed to their `single_*` equivalents (none were
  defined in the catalogues, so this is a code + fallback-copy change only, exactly as the story
  predicted), and every landing-page "for your children" / "against the child" string reworded
  to "singles"/"single" (English + French + the pinned `LandingPage.test.tsx` assertion).
- **Seed/demo (Task 11).** `seed_demo/dataset.ts` (`DemoChild`→`DemoSingle`,
  `CHILDREN`→`SINGLES`), `seed_demo/index.ts` (the `"children"` table read/insert,
  `p_child_id`→`p_single_id`, the `children:` response count key), `clear_demo/index.ts` (the
  `"children"` deletion-order entry). FakeRest generator: `dataGenerator/shidduchim.ts`
  (`childrenSeed`→`singlesSeed`, all 15 seed rows' `child_id`→`single_id`,
  `childGenderById`→`singleGenderById`), `dataGenerator/index.ts`, `dataGenerator/types.ts`
  (`Db.children: Child[]` → `Db.singles: Single[]`).
- **Tests (Task 10).** 9 TypeScript suites updated (`bucketByState.test.ts`,
  `boardUtils.test.ts` [not separately listed by the story but carried a stray `child_id` seed
  field, fixed], `redts.test.ts`, `schools.test.ts`, `pipelineStates.test.ts`,
  `shidduchService.test.ts`, `ShidduchCatchPanel.test.tsx`, `shidduchCatch.test.ts`,
  `dataProvider.summaryStats.test.ts`). `supabase/tests/shidduch_catch.sql` (26 domain lines:
  `public.children`→`public.singles`, `child_id`→`single_id`, the `\gset` variables
  `child_leah`/`child_rivka`/`child_b`→`single_leah`/`single_rivka`/`single_b`, both prose
  comments). `supabase/tests/references_entity.sql`: renamed `public.children`, `child_id`, the
  `child_a` ids-table key and `v_child_a` locals (→ `single_a` / `v_single_a`), the
  `'stolen child'` fixture string, the four "another account's child" assertion names, the two
  prose comments about "child visibility"/"the child role", and the forbidden-column-name list
  (`'child_visible'`→`'single_visible'`). Line 346 (`"Deleting a reference must take its
  polymorphic children with it"`) correctly left unchanged — FK-dependent rows, not people
  (Dev Notes rule 2). Added the AC-14(e) negative RLS test (see above).
- **Verification (Task 12).** All three AC-12 greps run clean: (a) snake_case/quoted/route
  patterns — **zero** hits; (b) camelCase/PascalCase/UPPER_SNAKE compounds — **zero** hits;
  (c) the plain English word — **62** surviving lines, 100% either React's `children` prop, DOM
  `appendChild`/`removeChild`, `node:child_process`, `childhood` (relationshipQuestions.ts,
  explicitly excluded by rule), or the one FK-dependent-rows prose line the Dev Notes call out.
  New migration contains only `ALTER … RENAME` / `DROP`+`CREATE` (the three views, forced by
  Postgres — `CREATE OR REPLACE VIEW` cannot rename an output column) — no
  `create view public.children`, no second function/route/type carrying the old name.
  `make typecheck && npm run lint && make test && npm run test:unit:db` all pass, plus the
  changed-files-only `npx prettier --check` (after one `--write` pass to fix 16 files' wrapping
  — see Debug Log). Manual smoke of `/singles`, `/singles/create`, the dashboard switcher and
  the pipeline board was not run interactively in this session (no browser tool invoked); the
  full automated suite (`test:unit:app` 503 tests, `test:unit:functions` 76, `test:unit:workers`
  18, `test:unit:db` 132 incl. the 2 new negative-RLS assertions) is the verification basis.
- **Tool-use note.** `.claude/rules/lsp-usage.md` recommends the `LSP` tool for TS symbol
  rename/reference work; it was not present in this session's tool set, so `grep`/`rg` was used
  throughout instead, closed out by the exhaustive AC-12 grep suite (a)+(b)+(c) as the
  correctness backstop for "no call site missed."
- **Story-claim drift (per the orchestrator's build-plan §2 and this story's own "verified at
  `main`@`8ad49cb`" caveat) — all cosmetic, none load-bearing:**
  - Every line number cited in the story's Task list and Dev Notes is stale (measured before
    1.1/1.4/1.5 landed, which together deleted hundreds of lines above this story's targets).
    Every edit in this session was re-located by identifier via `grep`/`Read`, never by the
    story's line number, per the build plan's explicit landmine warning (L1).
  - Dev Notes "Residual `children` after this story" lists 26 allow-listed survivor files;
    2 of them (`filters/FilterCategory.tsx`, `simple-list/SimpleListItem.tsx`) no longer exist
    in the tree (deleted by an earlier story), so the real survivor set is smaller. One file not
    on that list, `dashboard/MobileDashboard.tsx`, legitimately survives grep (c) with its own
    unrelated `Wrapper = ({ children }: { children: ReactNode })` — verified React's `children`
    prop, not a documentation gap that hides real work.
  - `supabase/schemas/07_storage.sql` (new since the story's "supabase/schemas/{01..06}.sql"
    framing) was checked and confirmed to contain zero `child`/`single` references — correctly
    out of this story's scope, exactly as the build plan predicted.

### File List

**Schema (6 files, hand-edited) + 1 new migration:**
- `supabase/schemas/01_tables.sql`
- `supabase/schemas/02_functions.sql`
- `supabase/schemas/03_views.sql`
- `supabase/schemas/04_triggers.sql`
- `supabase/schemas/05_policies.sql`
- `supabase/schemas/06_grants.sql`
- `supabase/migrations/20260727112521_rename_children_to_singles.sql` (new; hand-rewritten from
  the `db diff` draft — see Debug Log / Completion Notes)

**Types, providers, routing (9 files):**
- `src/components/atomic-crm/types.ts`
- `src/components/atomic-crm/providers/supabase/dataProvider.ts`
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts`
- `src/components/atomic-crm/providers/fakerest/internal/shidduchCatch.ts`
- `src/components/atomic-crm/providers/fakerest/internal/referenceSummary.ts`
- `src/components/atomic-crm/root/routeManifest.ts`
- `src/components/atomic-crm/root/OnboardingGate.tsx`
- `src/components/atomic-crm/root/onboardingKeys.ts`
- `src/components/atomic-crm/settings/exportFamilyData.ts`

**Resource directory rename (8 files, `git mv children/ → singles/` + content rewrite):**
- `src/components/atomic-crm/singles/index.ts` (was `children/index.ts`)
- `src/components/atomic-crm/singles/SingleCard.tsx` (was `ChildCard.tsx`)
- `src/components/atomic-crm/singles/SingleCreate.tsx` (was `ChildCreate.tsx`)
- `src/components/atomic-crm/singles/SingleEdit.tsx` (was `ChildEdit.tsx`)
- `src/components/atomic-crm/singles/SingleFormFrame.tsx` (was `ChildFormFrame.tsx`)
- `src/components/atomic-crm/singles/SingleInputs.tsx` (was `ChildInputs.tsx`)
- `src/components/atomic-crm/singles/SingleList.tsx` (was `ChildList.tsx`)
- `src/components/atomic-crm/singles/SingleShow.tsx` (was `ChildShow.tsx`)

**Dashboard (7 files):**
- `src/components/atomic-crm/dashboard/useDashboardData.ts`
- `src/components/atomic-crm/dashboard/DashboardHeader.tsx`
- `src/components/atomic-crm/dashboard/Dashboard.tsx`
- `src/components/atomic-crm/dashboard/MobileDashboard.tsx`
- `src/components/atomic-crm/dashboard/PipelineSnapshot.tsx`
- `src/components/atomic-crm/dashboard/RecentSuggestions.tsx`
- `src/components/atomic-crm/dashboard/AttentionSection.tsx`
- `src/components/atomic-crm/dashboard/bucketByState.ts`

**Shidduchim / layout / tour (9 files):**
- `src/components/atomic-crm/shidduchim/ShidduchimList.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchCreate.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchInputs.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchCard.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchShowHeader.tsx`
- `src/components/atomic-crm/shidduchim/ShidduchCatchPanel.tsx`
- `src/components/atomic-crm/shidduchim/pipelineStates.ts`
- `src/components/atomic-crm/layout/TopBar.tsx`
- `src/components/atomic-crm/tour/tourSteps.ts`
- `src/components/atomic-crm/tour/useTour.ts`

**Login / settings / references / shadchanim (10 files):**
- `src/components/atomic-crm/login/FirstRunSetup.tsx`
- `src/components/atomic-crm/login/OnboardingChoice.tsx`
- `src/components/atomic-crm/settings/FamilySection.tsx`
- `src/components/atomic-crm/settings/PrivacySection.tsx`
- `src/components/atomic-crm/references/ReferenceCallLog.tsx`
- `src/components/atomic-crm/references/ReferenceList.tsx`
- `src/components/atomic-crm/references/ReferenceTimeline.tsx`
- `src/components/atomic-crm/references/RepeatRecognitionPanel.tsx`
- `src/components/atomic-crm/references/useReferenceLinks.ts`
- `src/components/atomic-crm/shadchanim/ShadchanShow.tsx`
- `src/components/atomic-crm/shadchanim/ShadchanSuggestions.tsx`

**i18n / landing (5 files):**
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts`
- `src/components/atomic-crm/landing/LandingHero.tsx`
- `src/components/atomic-crm/landing/LandingHowItWorks.tsx`
- `src/components/atomic-crm/landing/LandingWhatItDoes.tsx`

**FakeRest seed/demo (3 files):**
- `src/components/atomic-crm/providers/fakerest/dataGenerator/index.ts`
- `src/components/atomic-crm/providers/fakerest/dataGenerator/shidduchim.ts`
- `src/components/atomic-crm/providers/fakerest/dataGenerator/types.ts`

**Edge functions (3 files):**
- `supabase/functions/seed_demo/dataset.ts`
- `supabase/functions/seed_demo/index.ts`
- `supabase/functions/clear_demo/index.ts`

**Tests, TS (9 files) + SQL (2 files):**
- `src/components/atomic-crm/dashboard/bucketByState.test.ts`
- `src/components/atomic-crm/shidduchim/boardUtils.test.ts`
- `src/components/atomic-crm/shidduchim/redts.test.ts`
- `src/components/atomic-crm/shidduchim/schools.test.ts`
- `src/components/atomic-crm/shidduchim/pipelineStates.test.ts`
- `src/components/atomic-crm/shidduchim/shidduchService.test.ts`
- `src/components/atomic-crm/shidduchim/ShidduchCatchPanel.test.tsx`
- `src/components/atomic-crm/providers/fakerest/internal/shidduchCatch.test.ts`
- `src/components/atomic-crm/providers/fakerest/dataProvider.summaryStats.test.ts`
- `src/components/atomic-crm/landing/LandingPage.test.tsx`
- `supabase/tests/shidduch_catch.sql`
- `supabase/tests/references_entity.sql` (also gained the new AC-14(e) negative RLS test)

**Story file:**
- `_bmad-output/implementation-artifacts/1-3-rename-children-to-singles.md` (this file — Tasks,
  Dev Agent Record, Status)
