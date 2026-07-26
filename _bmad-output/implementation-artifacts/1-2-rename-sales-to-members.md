# Story 1.2: Rename `sales` to `members`

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the user/profile table named for what it holds — `members`, not `sales` —
so that the identity model is legible and no later epic has to reason about a
salesperson concept that does not exist in shidduchim.

## Acceptance Criteria

1. **The table is `public.members`.** `public.sales` no longer exists. `select to_regclass('public.sales')` returns NULL and `select to_regclass('public.members')` returns non-NULL. Its eight columns are unchanged in type and order (`id`, `first_name`, `last_name`, `email`, `administrator`, `user_id`, `avatar`, `disabled`).

2. **Every database object attached to it carries the new name.** Verified against the live local database, the complete set is:
   - constraint `sales_pkey` → `members_pkey`
   - constraint `sales_user_id_fkey` → `members_user_id_fkey` (still `foreign key (user_id) references auth.users(id)`)
   - index `uq__sales__user_id` → `uq__members__user_id`
   - sequence `public.sales_id_seq` → `public.members_id_seq` (a table rename does **not** rename its identity sequence — this needs its own `ALTER SEQUENCE`)
   - policy `"Enable read access for authenticated users"` is attached to `public.members`
   - table grants (`authenticated`, `service_role`) and sequence grants (`anon`, `authenticated`, `service_role`) name `public.members` / `public.members_id_seq`
   - `select count(*) from pg_class where relname like 'sales%'` in schema `public` returns 0.

3. **The FK-bearing column on the one surviving referencing table is renamed.** `public.tasks.sales_id` → `public.tasks.member_id`. No new FK constraint is added (there is none today) and no `account_members`-referencing column (`children.member_id`, `shidduchim.owner_member_id`, `interactions.actor_member_id`) is touched — see Dev Notes for the naming collision this creates and why it is deliberate.

4. **The trigger function and its trigger are renamed and rewritten.** `public.set_sales_id_default()` → `public.set_member_id_default()`, whose body reads `NEW.member_id` and `from public.members`. Trigger `set_task_sales_id_trigger` on `public.tasks` → `set_task_member_id_trigger`. `select to_regproc('public.set_sales_id_default')` returns NULL. Its three grants (`anon`, `authenticated`, `service_role`) name the new function.

5. **Every function whose body reads the table reads `public.members`.** Verified against the live database, the functions that mention `sales` are exactly five: `handle_new_user`, `handle_update_user`, `is_admin`, `merge_contacts`, `set_sales_id_default`. `merge_contacts` is deleted by story 1.1; the other four are this story's. `handle_new_user`'s local variable `sales_count` becomes `member_count`. `is_admin()` still reads `administrator = true`, now from `public.members` (retiring `is_admin()` itself is AD-1 / Epic 2, **not** this story).

6. **The `init_state` view reads `public.members`.** It is the only surviving view of the four whose definition mentions `sales` (`activity_log`, `companies_summary`, `contacts_summary` die with story 1.1). Its `security_invoker = off` posture is preserved byte-for-byte by this story (dropping the definer view is AD-1 / Epic 2).

7. **The React resource is `members`.** `src/components/atomic-crm/sales/` becomes `src/components/atomic-crm/members/` with `MemberCreate.tsx`, `MemberEdit.tsx`, `MemberInputs.tsx`, `MemberList.tsx`, `useGetMemberName.ts`, `index.ts`. Story 1.5 lands **before** this one and has already replaced every `<Resource>` / `<Route>` element in `root/CRM.tsx` with a `.map()` over `src/components/atomic-crm/root/routeManifest.ts` (1.5 AC 5), so what this story renames is the **manifest entry**, not JSX: the `RESOURCES` entry `{ name: "sales", surface: "desktop", definition: … }` becomes `{ name: "members", surface: "desktop", definition: … }`, and the manifest's `import sales from "../sales"` becomes `import members from "../members"`. `CRM.tsx` itself needs no edit. The route is `/members`; `TopBar.tsx` links to `/members`; `canAccess.ts` gates on `resource === "members"`. `grep -rni 'sale' src/components/atomic-crm/root/routeManifest.ts src/components/atomic-crm/root/CRM.tsx` returns no hits. No `/sales` route, redirect or alias survives (NFR-14).

8. **Types and provider methods carry the new name.** `Sale` → `Member` and `SalesFormData` → `MemberFormData` in `src/components/atomic-crm/types.ts`; `Task.sales_id` → `Task.member_id`. `dataProvider.salesCreate` → `memberCreate` and `dataProvider.salesUpdate` → `memberUpdate` in **both** providers (`providers/supabase/dataProvider.ts` and `providers/fakerest/dataProvider.ts`) and at the **4** call sites that survive to this story's position: `members/MemberCreate.tsx` (was `sales/SalesCreate.tsx:20`), `members/MemberEdit.tsx` (was `sales/SalesEdit.tsx:47`), and `settings/ProfileSection.tsx:54` and `:86`. (`main` carries 7; three are deleted before you — `misc/useImportFromJson.ts:159` goes with `/import` in **story 1.1**, and `settings/ProfileForm.tsx:76` + `settings/ProfilePage.tsx:44` go with `/profile` in **story 1.5**.) `getSale()` → `getMember()` and `CURRENT_SALE_CACHE_KEY` → `CURRENT_MEMBER_CACHE_KEY` (value `"RaStore.auth.current_member"`) in `providers/supabase/authProvider.ts`.

9. **The i18n resource block is renamed in both locales, and a test proves it.** `resources.sales` → `resources.members` in `providers/commons/englishCrmMessages.ts` and `frenchCrmMessages.ts`. Every `translate("resources.sales.…")` call site is updated. `providers/commons/i18nProvider.test.ts` gains a case asserting that `i18nProvider.translate("resources.members.name", { smart_count: 2 })` returns `"Users"` under `en` and `"Utilisateurs"` under `fr`, and that neither catalogue exposes the retired block — `expect("sales" in englishCrmMessages.resources).toBe(false)` and the same for `frenchCrmMessages`.

10. **The edge functions carry the new name.** `supabase/functions/_shared/getUserSale.ts` → `getUserMember.ts` (export `getUserSale` → `getUserMember`); in `users/index.ts` the helpers `createSale` / `updateSaleAdministrator` / `updateSaleAvatar` / `updateSaleDisabled` / `currentUserSale` and the request-body field `sales_id` are renamed; in `postmark/` the exported `resolveAccountIdForSalesEmail` → `resolveAccountIdForMemberEmail` and its locals. The client and the edge function agree on the new `member_id` body field name (a mismatch here silently 404s the profile save). `_shared/db.ts` is **not** this story's — story 1.1 deletes it (verified: its sole importer is `supabase/functions/merge_contacts/index.ts:3`, which 1.1 also deletes).

11. **The FakeRest side is renamed with the Supabase side.** `providers/fakerest/dataGenerator/sales.ts` → `members.ts` (`generateSales` → `generateMembers`), `Db.sales` → `Db.members` in `dataGenerator/types.ts`, the `db.sales = …` line in `dataGenerator/index.ts`, the `sales_id: 0` seeds in `dataGenerator/tasks.ts` and `dataGenerator/references.ts`, the `resource: "sales"` lifecycle-callback block, and `providers/fakerest/authProvider.ts`. The FakeRest demo boots and lets a user sign in (AD-10: the two providers stay in sync).

12. **Tests and e2e fixtures are renamed.** `e2e/` survives Epic 1: story 1.1 deletes the three fossil specs but keeps the directory, `fixtures.ts`, `playwright.config.ts`, the `test-e2e*` make targets and the CI job, and **story 1.6 — which runs last, after this one — lands the single replacement smoke spec `e2e/pipeline.spec.ts`** (1.6 AC-7). So at this story's position `e2e/` holds `fixtures.ts` and **no spec at all**; `fixtures.ts` is still live code that 1.6 is about to consume, and this story renames it: the `TABLES` reset entry `"sales"` → `"members"` (line 21), the `resetDb` cascade comment (line 30), and the `createSales` helper → `createMember` (declaration line 57, its two failure strings 76/87, `.from("sales")` line 80, the `test.extend` type field line 217 and its fixture wrapper 239-240). **There is no spec call site to update** — 1.6 writes its spec against the already-renamed `createMember`. The `salesId` params and `sales_id` insert fields at lines 95-189 belong to `createNotes` / `createCompany` / `createContact`, which story 1.1 deletes. Also `src/test/StoryWrapper.tsx` (`Sale` → `Member`, `sales: [baseSale]` → `members: [baseMember]`, `sales_id` → `member_id`) and `tasks/TasksListFilter.test.tsx` (`sales_id: null` line 16, `sales: []` in the fake dataProvider line 23). `tasks/TaskCreateSheet.test.tsx` is **not** this story's — story 1.1 deletes it with `TaskCreateSheet.tsx`.

    **`make test-e2e-ci` is expected to exit 1 (`Error: No tests found`) throughout this story** — a known interim red running from 1.1 to 1.6, documented in 1.1 §"Known interim red: the `e2e-test` job". Do not treat it as a regression, do not delete the job to silence it, and do not write a spec to fix it: 1.6 owns that.

13. **A database test proves the rename and the access posture.** A new `supabase/tests/members_rename.sql` + `members_rename.test.ts` pair (same shape as `billing_entitlement.*`) asserts, at minimum:
    - `to_regclass('public.sales') is null` and `to_regproc('public.set_sales_id_default') is null` (positive proof of deletion, not just absence of grep hits);
    - **negative RLS/grant check:** the `anon` role cannot read `public.members` (no DML grant, no policy) — this is the mandatory negative test for an RLS-touching change;
    - `set_member_id_default()` populates `tasks.member_id` from the calling `auth.uid()`;
    - `handle_new_user()` inserts a `public.members` row and bootstraps the first user's `account_members` row exactly as before.

14. **Verification gate — no `sales` reference survives in live code.** The gate is a **case-insensitive substring** sweep for `sale`, not a word-boundary one. Verified: `grep -niE '\bsales?\b'` matches **none** of `sales_id`, `salesId`, `SalesCreate`, `useGetSalesName`, `getUserSale` or `CURRENT_SALE_CACHE_KEY` (`_` is a word character, and the camelCase / PascalCase compounds have no boundary before or after the token) — and those forms are most of the surface. All of the following return **zero** hits:
    - ```bash
      grep -rni 'sale' \
        --exclude=i18nProvider.test.ts --exclude=members_rename.sql \
        src/ e2e/ supabase/schemas/ supabase/functions/ supabase/tests/ | grep -vi wholesale
      ```
    - `grep -rni 'sale' registry.json` (after `make registry-gen`)
    - `grep -rni 'sale' AGENTS.md .claude/skills/backend-dev/SKILL.md .claude/skills/frontend-dev/SKILL.md`
    - `grep -rni 'sale' doc/src/content/docs/developers/architecture-choices.mdx`

    **The two `--exclude`d files are part of the criterion, not a loophole.** This story's own ACs *require* them to name the retired word, so a gate that forbade it would be unpassable by construction — the same defect the AC-14 exclusion in story 1.1 corrects:
    - `src/components/atomic-crm/providers/commons/i18nProvider.test.ts` — AC 9 mandates `expect("sales" in englishCrmMessages.resources).toBe(false)` and the French twin. An assertion that a name is *gone* must spell the name.
    - `supabase/tests/members_rename.sql` — AC 13 mandates `to_regclass('public.sales') is null`, `to_regproc('public.set_sales_id_default') is null` and `relname like 'sales%'`. Same reason.

    The exclusion is bounded, and the bound is itself checkable. Run

    ```bash
    grep -ni 'sale' src/components/atomic-crm/providers/commons/i18nProvider.test.ts \
                    supabase/tests/members_rename.sql
    ```

    and confirm **every** line it prints is a retirement assertion (or that assertion's test/check name) proving `sales` no longer exists — never a live read, write, import, type, resource string or i18n key. Any other kind of hit in these two files fails the gate exactly as it would anywhere else.

    `supabase/tests/members_rename.test.ts` is **not** excluded: it is a generic runner that loads `members_rename.sql` by path and turns each JSON result row into a named test (the shape of `billing_entitlement.test.ts`), so the retired word lives in the SQL's check names, not in the runner. Write it that way — if you find yourself typing `sales` into the `.test.ts`, restructure instead of widening the exclusion.

    Two further non-entity matches exist in these trees today; both are named, and neither is left to judgement:
    - `wholesale` in the prose comment `supabase/schemas/01_tables.sql:514` ("denies this bucket wholesale") — ordinary English inside story 1.3's policy block, filtered out by the `grep -vi wholesale` above rather than reworded.
    - `// Arrange: sales language, …` in `src/components/atomic-crm/landing/LandingPage.test.tsx:119` — ordinary English about marketing copy. It **is** reworded, to `marketing language`, so the gate can stay zero-tolerance.

    **`supabase/migrations/` is excluded from the gate and must not be rewritten.** Migrations are an append-only historical record; 17 existing files legitimately name `sales` (142 occurrences under the substring metric above) because that is what the database was called when they ran, and this story's own migration necessarily names `sales` in its `ALTER … RENAME` statements. The testable form of "no migration references the retired name" is AC 1 + AC 13: after `migration up`, `to_regclass('public.sales')` is NULL and no `public` relation is named `sales%`. Every migration authored **after** this one must name only `members`.

    Also excluded by design: `CHANGELOG.md`, `mockup/`, `design-artifacts/`, `_bmad-output/`, `dist/`, `node_modules/` (historical or generated — never rewritten), and the five `doc/` pages documenting fossil resources (see "Scope calls").

15. **No alias, view, redirect, synonym or compatibility shim to `sales` exists anywhere** — no `create view sales as select * from members`, no `/sales` route redirect, no `salesCreate` re-export, no `Sale = Member` type alias, no `sales_id` accepted alongside `member_id` in any request body (NFR-14, AD-23).

16. **The build is green with no suppressions.** `npm run typecheck`, `npm run lint` (eslint), `npm run test:unit:app`, `npm run test:unit:functions` and `npm run test:unit:db` all pass **repo-wide**, and no `@ts-ignore`, `eslint-disable` or skipped test was added to achieve it.

    **Formatting is scoped to this story's own diff:** `npx prettier --config ./.prettierrc.json --check <every file this story creates, renames or modifies>` returns clean. The repo-wide `npm run prettier` / `make lint` gate is **story 1.6's** (its AC-5) and is not achievable here — on `main` `npm run prettier` fails on **89 files** plus one it cannot parse (`mockup/MyShadchan.dc.html`), and 1.6's fix is partly `.prettierignore` policy, which is a repo-wide decision this story has no mandate to make. `make test-e2e-ci` is also **not** part of this gate — see AC 12.

## Tasks / Subtasks

- [ ] **Task 1 — Rename the table and its dependent objects in the declarative schema** (AC: 1, 2)
  - [ ] `supabase/schemas/01_tables.sql`: rename `create table public.sales` → `public.members` (lines 93-101); rename `uq__sales__user_id` → `uq__members__user_id` (line 104); rename constraint `sales_user_id_fkey` → `members_user_id_fkey` (lines 184-185); rewrite the two prose comments that name `sales` (line 11 "used by sales policies migration", line 261 "Replaces the fork's `sales` concept …").
  - [ ] `supabase/schemas/01_tables.sql`: rename `tasks.sales_id` → `tasks.member_id` (line 126). **Do not touch** lines 27/50/61/79/89 (`companies`/`contacts`/`contact_notes`/`deals`/`deal_notes`) or their FKs on lines 158/164/170/176/182 — those tables are deleted by story 1.1.
  - [ ] `supabase/schemas/05_policies.sql`: `alter table public.members enable row level security` (line 12); move the `"Enable read access for authenticated users"` policy onto `public.members` (lines 48-49, including the `-- Sales` section comment).
  - [ ] `supabase/schemas/06_grants.sql`: table grants (lines 89-90) → `public.members`; sequence grants (lines 148-150) → `public.members_id_seq`; function grants (lines 64-66) → `public.set_member_id_default()`.

- [ ] **Task 2 — Rename the trigger function, its trigger, and the four functions that read the table** (AC: 4, 5)
  - [ ] `supabase/schemas/02_functions.sql`: `set_sales_id_default()` → `set_member_id_default()` (header at line 496); body reads `NEW.member_id` and `from public.members` (lines 501-502).
  - [ ] `supabase/schemas/02_functions.sql`: `handle_new_user()` (header line 237) — `sales_count` → `member_count` (lines 242, 245-246, 266), `from public.sales` → `from public.members`, `insert into public.members …` (line 248); `handle_update_user()` (header line 288) — `update public.members` (line 293); `is_admin()` (header line 316) — `from public.members` (line 322). Keep the exact `pg_dump` formatting of these bodies (see Dev Notes).
  - [ ] `supabase/schemas/04_triggers.sql`: rename `set_task_sales_id_trigger` → `set_task_member_id_trigger` (lines 27-29) and rewrite the two prose comments (line 6 "Auto-populate sales_id…", line 73 "sync auth.users to public.sales"). Leave the five fossil triggers on lines 7-25 to story 1.1.
  - [ ] Leave `merge_contacts()` (line 468) alone — it is deleted by story 1.1.

- [ ] **Task 3 — Rename the reference inside `init_state`** (AC: 6)
  - [ ] `supabase/schemas/03_views.sql` lines 130-134 (`init_state`): `select members.id from public.members limit 1`. Keep `with (security_invoker = off)` and the `anon`/`authenticated`/`service_role` grants exactly as they are — deleting this definer view is AD-1 / Epic 2 work, not this story's.

- [ ] **Task 4 — Generate and hand-check the migration** (AC: 1, 2, 3, 4, 5, 6)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f rename_sales_to_members`
  - [ ] **Hand-edit the generated file**: `db diff` emits a rename as `DROP TABLE` + `CREATE TABLE`, which destroys every existing profile row. Replace it with the explicit rename sequence:
        `alter table public.sales rename to members;`
        `alter table public.members rename constraint sales_pkey to members_pkey;`
        `alter table public.members rename constraint sales_user_id_fkey to members_user_id_fkey;`
        `alter index public.uq__sales__user_id rename to uq__members__user_id;`
        `alter sequence public.sales_id_seq rename to members_id_seq;`
        `alter table public.tasks rename column sales_id to member_id;`
        `alter function public.set_sales_id_default() rename to set_member_id_default;`
        `alter trigger set_task_sales_id_trigger on public.tasks rename to set_task_member_id_trigger;`
        then `create or replace function` for the four rewritten bodies and `create or replace view public.init_state`.
  - [ ] Confirm the migration re-declares `security_invoker`/`security_definer` on `init_state` and re-issues any `revoke`/`grant` the diff dropped (see Dev Notes).
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. **Never** `db reset --local` or `db push`.
  - [ ] Re-run `db diff` and confirm it reports no drift.

- [ ] **Task 5 — Rename the TypeScript types** (AC: 8)
  - [ ] `src/components/atomic-crm/types.ts`: `SalesFormData` → `MemberFormData` (line 19), `Sale` → `Member` (line 29), `Task.sales_id` → `Task.member_id` (line 164). The other ten `sales_id` fields (lines 63, 97, 109, 126, 134, 175, 182, 189, 197, 204) belong to `Company`/`Contact`/`ContactNote`/`Deal`/`DealNote`/`Activity*` types that story 1.1 deletes — leave them to 1.1.
  - [ ] Use LSP `findReferences` on `Sale` and `SalesFormData` before editing. Re-run it at the start of the ticket rather than trusting a count taken on `main` — 1.1 and 1.5 land first and delete roughly a quarter of the references (on `main`: 56 `Sale`/`SalesFormData` references across 17 files; in the files that survive to this story: 43 across 12).

- [ ] **Task 6 — Rename the resource directory and its manifest entry** (AC: 7)
  - [ ] `git mv src/components/atomic-crm/sales src/components/atomic-crm/members`; rename the four component files and `useGetSalesName.ts` → `useGetMemberName.ts` (plus `index.ts`); rename the exported symbols (`SalesCreate`→`MemberCreate`, `SalesEdit`→`MemberEdit`, `SalesInputs`→`MemberInputs`, `SalesList`→`MemberList`, `SalesListActions`→`MemberListActions`, `SaleEditTitle`→`MemberEditTitle`, `useGetSalesName`→`useGetMemberName`).
  - [ ] `src/components/atomic-crm/root/routeManifest.ts` (created by story 1.5, which lands before this story): change the module import `../sales` → `../members` and the `RESOURCES` entry's `name: "sales"` → `name: "members"`. Keep `surface: "desktop"` — `/members` is desktop-only today and this story does not change that.
  - [ ] **Do not edit `root/CRM.tsx` for the registration.** After 1.5 it contains no `<Resource name=…>` / `<Route path=…>` literals — it maps over the manifest — so the JSX at `CRM.tsx:290` and the import at `CRM.tsx:37` that this story was originally written against no longer exist. If you find them, 1.5 has not landed: stop and report rather than re-introducing JSX.
  - [ ] `src/components/atomic-crm/layout/TopBar.tsx`: `<CanAccess resource="members" …>` (line 44), `<Link to="/members">` (line 131), `translate("resources.members.name", …)` (line 133).
  - [ ] `src/components/atomic-crm/providers/commons/canAccess.ts`: `params.resource === "members"` (lines 20-21).
  - [ ] `useGetSalesName` is imported by **10** files today (`notes/Note.tsx`, `notes/NoteShowPage.tsx`, `notes/NotesIteratorMobile.tsx`, `contacts/ContactBackgroundInfo.tsx`, `companies/CompanyAside.tsx`, and the five `activity/ActivityLog*Created.tsx`) — **all ten** are deleted by story 1.1, so at this story's position the hook has zero call sites. Keep it (it is the members resource's own hook); do not delete it in this story.

- [ ] **Task 7 — Rename provider methods and the auth path** (AC: 8, 11)
  - [ ] `providers/supabase/dataProvider.ts`: `salesCreate` → `memberCreate` (line 194), `salesUpdate` → `memberUpdate` (line 216), the two `console.error("salesCreate.error", …)` strings, the `sales_id: id` body field on the `users` invoke (line 229) → `member_id`, and the `resource: "sales"` lifecycle-callback block (line 684).
  - [ ] `providers/supabase/dataProvider.ts` line 251: the `update_password` invoke body sends `sales_id`, which the `update_password` edge function never reads (it resolves the user from the JWT). **Delete the dead field** — the `body` becomes `{}`. Renaming it to `member_id` is not an option: NFR-14 forbids carrying a dead surface through a rename, and a renamed dead field is still a dead field.
  - [ ] `providers/supabase/authProvider.ts`: `getSale()` → `getMember()` (line 55), `.from("members")` (line 71), `CURRENT_SALE_CACHE_KEY` → `CURRENT_MEMBER_CACHE_KEY = "RaStore.auth.current_member"` (line 27 + lines 57, 81, 88), locals `sale`/`dataSale`/`errorSale` → `member`/`dataMember`/`errorMember`, and the comment on line 25.
  - [ ] `providers/fakerest/dataProvider.ts` (35 hits): `salesCreate`/`salesUpdate` (lines 675, 685), every `"sales"` resource string (lines 662, 676, 689, 697, 705, 720, 728, 947), `filter.sales_id` (line 499), `newSaleId` (line 970) and the `sales_id` update payloads (lines 1011-1029). The `beforeDelete` reassignment block (starting line 965) fans out to `companies`/`contacts`/`contact_notes`/`deals` — those four arms are removed by story 1.1; rename what survives and coordinate.
  - [ ] `providers/fakerest/authProvider.ts`: `getList("members")` (line 24), `Sale` → `Member` (lines 3, 68, 77), locals.
  - [ ] `providers/fakerest/dataGenerator/`: `git mv sales.ts members.ts`, `generateSales` → `generateMembers`; `index.ts` line 8/16; `types.ts` `Db.sales` → `Db.members` (line 34) and the `Sale` import (line 19); `tasks.ts` line 50 and `references.ts` line 344 `sales_id: 0` → `member_id: 0`.

- [ ] **Task 8 — Rename the settings and tasks surfaces** (AC: 8, 9)
  - [ ] `settings/ProfileSection.tsx` (lines 23, 29, 44, 54-57, 83-86, 126, 134, 142 — including the three `resources.sales.fields.*` labels). It is the **only** settings file in scope: `settings/ProfileForm.tsx` and `settings/ProfilePage.tsx` are deleted by story 1.5 with the `/profile` route, and `ProfileSection` is the surviving profile editor on both `/settings` surfaces.
  - [ ] `tasks/TasksListByDueDate.tsx:44` — `sales_id: identity?.id` → `member_id: identity?.id`. It is the only `tasks/` file in scope: `tasks/AddTask.tsx:109` and `tasks/TaskCreateSheet.tsx:82` are deleted by story 1.1.

- [ ] **Task 9 — Rename the i18n resource block and prove it** (AC: 9)
  - [ ] `providers/commons/englishCrmMessages.ts`: the `sales: { … }` block at line 339 → `members: { … }`. Lines 77 and 140 (`sales_id: "Account manager"` under `companies` / `contacts`) and line 619 belong to fossil resources — story 1.1's.
  - [ ] `providers/commons/frenchCrmMessages.ts`: the same block at line 344; lines 79 and 143 are 1.1's.
  - [ ] Grep for `resources.sales` across `src/` and update every `translate()` / `label=` / `notify()` key.
  - [ ] Extend `providers/commons/i18nProvider.test.ts` (AAA, one behaviour per `it`): `"resolves the members resource name in english and french"` — `changeLocale("en")` then `translate("resources.members.name", { smart_count: 2 })` is `"Users"`, `changeLocale("fr")` then the same call is `"Utilisateurs"`; and `"carries no retired sales catalogue block"` — import both message objects and assert `"sales" in englishCrmMessages.resources` and `"sales" in frenchCrmMessages.resources` are both `false`.

- [ ] **Task 10 — Rename the edge functions** (AC: 10)
  - [ ] `git mv supabase/functions/_shared/getUserSale.ts supabase/functions/_shared/getUserMember.ts`; export `getUserMember`; `.from("members")`; update the one importer (`users/index.ts:6`).
  - [ ] `supabase/functions/users/index.ts` (53 hits): `createSale`/`updateSaleAdministrator`/`updateSaleAvatar`/`updateSaleDisabled` → `createMember`/`updateMemberAdministrator`/`updateMemberAvatar`/`updateMemberDisabled`; `currentUserSale` → `currentUserMember`; every `.from("sales")` → `.from("members")`; the destructured request field `sales_id` → `member_id` (line 244) and its two `.eq("id", …)` uses (lines 255, 299); the error strings ("Failed to update sale", "A sales for this email already exists", "Error patching sale:").
  - [ ] `supabase/functions/postmark/createInboxItemFromEmail.ts`: `resolveAccountIdForSalesEmail` → `resolveAccountIdForMemberEmail`, param `salesEmail` → `memberEmail`, `.from("members")`, and the doc comment.
  - [ ] `supabase/functions/postmark/index.ts` (19 hits): the import (line 16), `salesEmail`/`allSales`/`salesEmails` locals, `.from("members")` (line 57), the three error strings and the two explanatory comments (lines 52, 77, 83, 90, 251).
  - [ ] `supabase/functions/mcp/index.ts`: the two tool-description sentences that mention `sales_id` (lines 306, 360) → `member_id`. The "Sales pipeline" bullet on line 297 is fossil CRM vocabulary — story 1.1's.
  - [ ] **Not in scope:** `supabase/functions/_shared/db.ts` (`TasksTable.sales_id`). Story 1.1 deletes the file — verified its sole importer is `supabase/functions/merge_contacts/index.ts:3`, which 1.1 also deletes. If it is still present when this story runs, 1.1 has not landed; report rather than renaming it.

- [ ] **Task 11 — Rename the tests and e2e fixtures** (AC: 12)
  - [ ] `e2e/fixtures.ts` — the part that survives story 1.1 (which deletes `createNotes`, `createCompany`, `createContact` and the fossil `TABLES` entries): `TABLES` entry `"sales"` → `"members"` (line 21) and the `resetDb` cascade comment (line 30); `createSales` → `createMember` (declaration line 57, the two `Failed to create sales:` strings on lines 76 and 87, `.from("sales")` line 80, the `test.extend` type field line 217, the fixture wrapper lines 239-240). Do **not** rename the `salesId` params (lines 95, 99, 125, 128, 189) or the `sales_id` insert fields (lines 111, 132, 148, 155, 169) — every one of them is inside a helper 1.1 deletes.
  - [ ] **No spec to update.** `e2e/` holds only `fixtures.ts` at this point — 1.1 deleted the three fossil specs and 1.6 has not yet landed `e2e/pipeline.spec.ts`. After renaming the helper, confirm with `ls e2e/*.spec.ts` (no matches) and `grep -rn "createSales" e2e/` (no hits). `make test-e2e-ci` still exits 1 with `Error: No tests found`; that is the documented interim red (AC 12), not something to fix here.
  - [ ] `src/test/StoryWrapper.tsx`: `Sale` → `Member` (lines 10, 27, 29), `sales: [baseSale]` → `members: [baseMember]` (line 49), `sales_id: 0` → `member_id: 0` (line 71).
  - [ ] `tasks/TasksListFilter.test.tsx:16` (`sales_id: null`) and `:23` (`sales: []` in the `fakeDataProvider` seed). `tasks/TaskCreateSheet.test.tsx` is deleted by story 1.1 — leave it alone.
  - [ ] Reword `landing/LandingPage.test.tsx:119` `sales language` → `marketing language`.

- [ ] **Task 12 — Add the database test** (AC: 13)
  - [ ] Create `supabase/tests/members_rename.sql` and `supabase/tests/members_rename.test.ts` modelled on `supabase/tests/billing_entitlement.{sql,test.ts}`: `\set ON_ERROR_STOP on`, `begin;`, a temp `results(name, passed, detail)` table, one row per check, JSON output, `rollback;`. The `.test.ts` runner skips itself when the database is unreachable.
  - [ ] Checks: `to_regclass('public.sales') is null`; `to_regclass('public.members') is not null`; `to_regproc('public.set_sales_id_default') is null`; no `pg_class` row in schema `public` with `relname like 'sales%'`; `anon` **cannot** read `public.members` (negative test); `set_member_id_default()` fills `tasks.member_id` from `auth.uid()`; `handle_new_user()` writes a `members` row and the first user's `account_members` row.

- [ ] **Task 13 — Update the developer documentation that describes the renamed surface** (AC: 14)
  - [ ] `AGENTS.md` line 82 (`sales/  # Sales team management` → `members/  # Member (user/profile) management`) and line 127 (the `auth.users` ↔ `sales` trigger sentence).
  - [ ] `.claude/skills/backend-dev/SKILL.md` lines 28, 38, 49, 58 (`salesCreate()`, "the auto-set `sales_id` trigger") and `.claude/skills/frontend-dev/SKILL.md` line 42 (`dataProvider.salesCreate()` in `SalesCreate.tsx`).
  - [ ] `doc/src/content/docs/developers/architecture-choices.mdx:46` — the paragraph explaining the `sales` table is the one doc page describing a surface that survives; update it to `members`. `users/import-data.mdx` is already gone (deleted by story 1.1, its AC-16). The remaining four (`users/inbound-email.mdx`, `developers/custom-fields.mdx`, `developers/sso.mdx`, `index.mdx`) document the fossil CRM contacts flow and sit inside 1.1's deferred `doc/` rebrand — see Dev Notes for the scope call.
  - [ ] `make registry-gen` (also runs on pre-commit) so `registry.json` no longer lists `sales/*` paths.
  - [ ] Repo-root `MEMORY.md` lines 7 and 9 are maintained by the `documentator` agent — flag, do not hand-edit.

- [ ] **Task 14 — Run the gate** (AC: 14, 16)
  - [ ] `grep -rni 'sale' --exclude=i18nProvider.test.ts --exclude=members_rename.sql src/ e2e/ supabase/schemas/ supabase/functions/ supabase/tests/ | grep -vi wholesale` → zero hits. Substring, case-insensitive, **not** `\bsales?\b` — the word-boundary form matches none of `sales_id`, `salesId`, `SalesCreate`, `useGetSalesName`, `getUserSale`, `CURRENT_SALE_CACHE_KEY`. (Do **not** include `supabase/migrations/` — see AC 14.)
  - [ ] Then run the bounded check on the two excluded files — `grep -ni 'sale' src/components/atomic-crm/providers/commons/i18nProvider.test.ts supabase/tests/members_rename.sql` — and confirm every printed line is a retirement assertion or its name (AC 14). Paste the output in the PR body.
  - [ ] `grep -rni 'sale' registry.json` → zero hits.
  - [ ] `psql "$SUPABASE_DB_URL" -c "select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname like 'sales%'"` → zero rows.
  - [ ] `npm run typecheck && npm run lint` → clean repo-wide. Then `npx prettier --config ./.prettierrc.json --check` over **this story's changed files only** → clean (AC 16; the repo-wide prettier gate is 1.6's).
  - [ ] `npm run test:unit:app`, `npm run test:unit:functions`, `npm run test:unit:db` → green. **Not** `make test-e2e-ci` — it exits 1 with `Error: No tests found` until 1.6 lands the smoke spec (AC 12).
  - [ ] Smoke: sign in against the local stack, open `/members`, edit the profile at `/settings`, create a reminder — the three paths that write through `members` / `member_id`.

## Dev Notes

### Position in Epic 1 — **5th of 6** (binding)

The epic order is pinned: **1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6**. This story runs fifth, so it starts on a tree where:

- **1.1 (delete the fossils)** has already removed `contacts/`, `companies/`, `deals/`, `tags/`, `notes/`, `activity/`, the fossil dashboard widgets and generators, `tasks/AddTask.tsx` + `TaskCreateSheet*`, `supabase/functions/{merge_contacts,delete_note_attachments}/`, `_shared/db.ts`, the orphaned `postmark/` contact modules, the whole `/import` surface (`misc/ImportPage.tsx`, `misc/useImportFromJson.ts`, `misc/import-sample.json`, the `CRM.tsx` route, `ImportFromJsonMenuItem`, `crm.import` / `crm.header.import_data`), and the three fossil e2e specs. It keeps `e2e/`, `fixtures.ts` and the CI `e2e-test` job — but **not** a spec: the replacement smoke spec is **story 1.6's** (1.6 AC-7), so the job is red from 1.1 until 1.6 lands.
- **1.4 (retire the token portal)** has removed `portal/`, `child_portal_tokens` and `get_child_portal()` — zero `sales` overlap.
- **1.5 (dead routes)** has replaced the `<Resource>` / `<Route>` JSX in `root/CRM.tsx` with a `.map()` over the new `root/routeManifest.ts`, and has deleted `/profile` (`settings/ProfilePage.tsx`, `settings/ProfileForm.tsx`) and `/changelog`. (`/import` was **1.1's**, not 1.5's — see above.) **This is a hard dependency:** AC 7 renames a manifest entry that does not exist before 1.5, and AC 8's call-site count assumes both 1.1's and 1.5's deletions.
- **1.3 (`children` → `singles`)** has already renamed the singles resource, so `routeManifest.ts`, `types.ts`, both dataProviders, both message catalogues and `01_tables.sql` carry its edits — rebase onto them, do not undo them.
- **1.6 (tidy baseline)** runs after this story. It owns the repo-wide prettier/lint green gate (AC 16 here is scoped to this story's own diff), the zero-suppression gate, the retired-name guard, and the replacement e2e smoke spec `e2e/pipeline.spec.ts`, which it writes against the `createMember` helper this story renames.

**Dependency in one line:** this story cannot start until 1.5 has landed; it also assumes 1.1. If `root/routeManifest.ts` does not exist, or `settings/ProfileForm.tsx` still does, stop and report — do not work around it.

### Verified surface (counted, 2026-07-26)

Counting metric: **case-insensitive substring `sale`** (`grep -roi 'sale'`), which is the only sweep that catches every live form in one pass — `sales`, `sale`, `Sale`, `sales_id`, `salesId`, `SalesFormData`, `useGetSalesName`, `getUserSale`, `CURRENT_SALE_CACHE_KEY`. (The word-boundary form `\bsales?\b` used in earlier drafts matches roughly a third of them and must not be used as a gate — see AC 14.) Excludes `node_modules/`, `dist/`, `CHANGELOG.md`, `mockup/`, `design-artifacts/`, `_bmad-output/`, `supabase/migrations/`. Split by who owns it:

| Area | Files | Occurrences | Owner |
|---|---|---|---|
| `supabase/schemas/*.sql` | 6 | 80 | split — see per-line map below |
| `src/`, `supabase/functions/`, `e2e/` — files that survive to this story | 31 | 348 | **this story** |
| `src/`, `supabase/functions/`, `e2e/` — fossil files | 45 | 253 | **story 1.1** (deleted outright) |
| `src/` — the 3 `/import` files (`misc/{ImportPage.tsx,useImportFromJson.ts,import-sample.json}`) | 3 | 76 | **story 1.1** (deleted outright — verified 5 / 64 / 7) |
| `src/` — the 2 `/profile` files (`settings/{ProfileForm.tsx,ProfilePage.tsx}`) | 2 | 14 | **story 1.5** (deleted outright — verified 9 / 5) |
| `doc/` | 6 | 20 | split — see below |
| `registry.json` | 1 | 12 | generated (`make registry-gen`) |
| `AGENTS.md`, `.claude/skills/{backend-dev,frontend-dev}/SKILL.md` | 3 | 9 | **this story** (Task 13) |
| repo-root `MEMORY.md` | 1 | 2 | `documentator` agent — flag, do not hand-edit |
| `supabase/migrations/` | 17 | 142 | **nobody** — append-only history, excluded from the gate |

The 31 files this story owns, heaviest first: `supabase/functions/users/index.ts` (86), `providers/fakerest/dataProvider.ts` (40), `providers/supabase/authProvider.ts` (27), `e2e/fixtures.ts` (23), `supabase/functions/postmark/index.ts` (19), `sales/SalesEdit.tsx` (17), `providers/supabase/dataProvider.ts` (14), `types.ts` (13), `sales/SalesCreate.tsx` (12), `sales/index.ts` (11), `settings/ProfileSection.tsx` (10), `providers/fakerest/authProvider.ts` (10), `postmark/createInboxItemFromEmail.ts` (8), `src/test/StoryWrapper.tsx` (7), `sales/SalesList.tsx` (6), `dataGenerator/sales.ts` (5), `mcp/index.ts` (4), `root/CRM.tsx` (4 — moved into `routeManifest.ts` by 1.5), `dataGenerator/index.ts` (4), `englishCrmMessages.ts` (4), `_shared/getUserSale.ts` (3), `sales/SalesInputs.tsx` (3), `dataGenerator/types.ts` (3), `frenchCrmMessages.ts` (3), `layout/TopBar.tsx` (3), `tasks/TasksListFilter.test.tsx` (2), `sales/useGetSalesName.ts` (2), `providers/commons/canAccess.ts` (2), `tasks/TasksListByDueDate.tsx` (1), `dataGenerator/references.ts` (1), `landing/LandingPage.test.tsx` (1, the false positive reworded in Task 11).

**Per-line map of `supabase/schemas/` (80 occurrences on 62 lines):**

- `01_tables.sql` (29): **this story** → lines 11, 93-101 (table), 104 (unique index), 126 (`tasks.sales_id`), 184-185 (FK), 261 (comment). **Story 1.1** → lines 27, 50, 61, 79, 89 (columns) and 158, 164, 170, 176, 182 (FKs).
- `02_functions.sql` (16): **this story** → 227 (comment), 242/245/246/248/266 (`handle_new_user`), 293 (`handle_update_user`), 322 (`is_admin`), 496/501/502 (`set_sales_id_default`), 560 (comment). **Story 1.1** → 468 (`merge_contacts`).
- `03_views.sql` (9): **this story** → 133 (`init_state`). **Story 1.1** → 12, 25, 38, 52, 65 (`activity_log`), 88 (`companies_summary`), 117 (`contacts_summary`).
- `04_triggers.sql` (14): **this story** → 6 (comment), 27-29 (`set_task_sales_id_trigger`), 73 (comment). **Story 1.1** → 7-25 (five fossil triggers).
- `05_policies.sql` (3): **this story** → 12, 48, 49.
- `06_grants.sql` (8): **this story** → 64-66 (function), 89-90 (table), 148-150 (sequence).
- `07_storage.sql` (0): clean.

**Live-database object inventory** (queried against `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, so this is fact, not inference):

- Columns named `%sales%`: 9 — `activity_log.sales_id`, `companies.sales_id`, `companies_summary.sales_id`, `contact_notes.sales_id`, `contacts.sales_id`, `contacts_summary.sales_id`, `deal_notes.sales_id`, `deals.sales_id`, **`tasks.sales_id`**. Only the last survives story 1.1.
- Constraints: 7 — `sales_pkey`, `sales_user_id_fkey`, plus 5 FKs from fossil tables.
- Indexes on `sales`: 2 — `sales_pkey`, `uq__sales__user_id`.
- Sequences: 1 — `sales_id_seq`.
- Policies on `sales`: 1 — `"Enable read access for authenticated users"`, `SELECT`, `using (true)`.
- Triggers calling `set_sales_id_default`: 6 — on `tasks` (survives), `contacts`, `contact_notes`, `companies`, `deals`, `deal_notes` (all deleted by 1.1).
- Functions mentioning `sales`: 5 — `handle_new_user`, `handle_update_user`, `is_admin`, `merge_contacts`, `set_sales_id_default`.
- Views mentioning `sales`: 4 — `activity_log`, `companies_summary`, `contacts_summary`, `init_state`.
- Grants on `public.sales`: `anon` holds only `REFERENCES`/`TRIGGER`/`TRUNCATE` (no DML — correct, keep it that way); `authenticated` and `service_role` hold full DML.

### Naming collision — `member_id` already means something else *(flagged ambiguity)*

The schema already has three `*_member_id` columns, and **all three reference `public.account_members(id)`, not the profile table**:

- `children.member_id` → `children_member_id_fkey references public.account_members(id)` (`01_tables.sql:681`)
- `shidduchim.owner_member_id` → `shidduchim_owner_member_id_fkey references public.account_members(id)` (`01_tables.sql:699`)
- `interactions.actor_member_id` → `interactions_actor_member_id_fkey references public.account_members(id)` (`01_tables.sql:754`)

After this rename, `tasks.member_id` will look identical to those but mean *"a row in `members`"*. That is a real footgun and it is **not** something this story invents the answer to. What the sources actually say:

- The epic ("Rename `sales` to `members`") and **AD-23** ("The user/profile table is **`members`**, not `sales`") are unambiguous that the profile table becomes `members`.
- **AD-1** keeps `account_members(account_id, user_id, role, status)` as the membership table, and the glossary defines **member** as *"a login's membership of a context, carrying a role"* — i.e. `account_members`.
- **SOLUTION-DESIGN.md:110** says `account_members` *"Replaces `sales`"*, which contradicts AD-23. The spine (AD-23) and the epic win; SOLUTION-DESIGN is the companion, not the contract.

**Decision for this story:** rename `sales` → `members` and `tasks.sales_id` → `tasks.member_id`, and **do not touch `account_members` or any `*_member_id` column that FKs to it**. Add a `comment on column public.tasks.member_id` recording which table it points at. If the planner wants the collision resolved rather than documented, that is Epic 2 work (`current_context_id()` / AD-19 rewrites the membership model anyway) — raise it, do not invent a third name.

### Migration workflow (repo-specific — get this wrong and you lose data)

- `supabase/schemas/*.sql` is the **source of truth**. Edit it first, then generate:
  `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f rename_sales_to_members`
  then `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`.
  **Never** `db reset --local` (destructive) and **never** `db push` (that is the deploy-time round, owned by the orchestrator, not the ticket).
- The `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix is mandatory on this machine: without it every `npx supabase` call hangs forever in the go-keyring D-Bus lookup. It looks like a Docker fault and is not.
- **`db diff` renders a rename as DROP + CREATE.** `AGENTS.md` documents this explicitly ("sometimes manual adjustment is needed — e.g. replacing a DROP+CREATE with an ALTER TABLE RENAME for column renames"). For a table holding every user profile, accepting the generated DROP would delete every account. Hand-write the `ALTER … RENAME` sequence in Task 4.
- **`db diff` historically drops `security_invoker` and `REVOKE` statements.** `init_state` is `with (security_invoker = off)` — a definer view deliberately readable by `anon` pre-sign-in. Diff the generated migration against `03_views.sql` and `06_grants.sql` by hand and re-add anything the tool silently omitted. Precedent for hand-fixed grants/revokes: `20260722130000_shidduch_redts.sql`, `20260722150000_references_entity.sql`, `20260724124914_revoke_accounts_decoy_writes.sql`.
- Function bodies in `02_functions.sql` must match `pg_dump` formatting exactly (`npx supabase db dump --local --schema public`) or every later `db diff` reports a phantom diff. The four functions you touch are already in that format — preserve the quoting (`"public"."handle_new_user"`), the `SET "search_path" TO ''`, and the `SECURITY DEFINER` markers verbatim.
- Renaming a table does **not** rename its identity sequence, its primary-key constraint, or its indexes. All three need explicit `ALTER` statements (AC 2).
- `ALTER FUNCTION … RENAME` preserves the function OID, so the existing trigger on `tasks` keeps pointing at it — rename the function first, then `CREATE OR REPLACE` the new body, then rename the trigger. Dropping and recreating instead would require dropping the trigger first.

### Security posture

This change touches RLS, grants and `SECURITY DEFINER` functions, so it is a `.claude/rules/security-triggers.md` case — a security review is expected on the diff.

- The rename must be **behaviour-neutral**. `members` keeps the same single policy (`select … to authenticated using (true)`), the same grants, and the same `anon` posture (no DML). Hardening `members` (FORCE RLS, revoking `anon`, account-scoping the read) is AD-1 / Epic 2, explicitly **not** this story.
- `handle_new_user()` and `handle_update_user()` are `SECURITY DEFINER … SET search_path TO ''`, and every reference inside them is schema-qualified. Keep both properties: an unqualified `members` inside a definer function with an empty `search_path` fails at runtime, not at migration time.
- **A negative test is mandatory** (AC 13): prove `anon` still cannot read `public.members`. A rename that quietly widens the grant surface is exactly the class of regression the db-test suite exists to catch.

### Files another Epic 1 story also touches — expect conflicts

All four predecessors land before this story (see "Position in Epic 1" above), so these are rebase surfaces, not races.

- **Story 1.1 (delete the fossils)** — the big one. It deletes 45 of the files that mention `sales` today (253 occurrences), including `tasks/AddTask.tsx`, `tasks/TaskCreateSheet.tsx`, `tasks/TaskCreateSheet.test.tsx` and `supabase/functions/_shared/db.ts`, **plus the 3 `/import` files (76 more occurrences)**. It also edits, but does not delete: `supabase/schemas/{01_tables,02_functions,03_views,04_triggers,05_policies,06_grants}.sql`, `src/components/atomic-crm/types.ts`, `root/CRM.tsx`, `layout/TopBar.tsx` (`ImportFromJsonMenuItem` only), `providers/{supabase,fakerest}/dataProvider.ts`, `providers/commons/{englishCrmMessages,frenchCrmMessages}.ts`, `providers/commons/i18nProvider.test.ts`, `supabase/functions/mcp/index.ts`, `tasks/TasksListFilter.test.tsx`, `src/test/StoryWrapper.tsx`, `e2e/fixtures.ts` (it strips the fossil helpers; the `sales` table entry and `createSales` are explicitly left to this story).
- **Story 1.3 (`children` → `singles`)** — lands immediately before this story and touches the same registration and provider files: `root/routeManifest.ts`, `types.ts`, both `dataProvider.ts`, both message files, `dataGenerator/index.ts` + `types.ts`, `e2e/fixtures.ts`, and `supabase/schemas/01_tables.sql`. Note `children.member_id` is 1.3's column on a table 1.3 renames — the `member_id` semantics discussion below happens once, in 1.3's ticket or this one, not twice.
- **Story 1.4 (retire the token portal)** — no `sales` overlap (`src/components/atomic-crm/portal/` and `children/ChildPortalShare.tsx` contain zero `sales` references).
- **Story 1.5 (dead routes)** — the hard dependency. It creates `root/routeManifest.ts` (which this story's AC 7 edits) and deletes `settings/ProfileForm.tsx` + `settings/ProfilePage.tsx` — two files this story would otherwise have renamed, carrying two of the seven `salesUpdate`/`salesCreate` call sites (the third, `misc/useImportFromJson.ts:159`, goes with story 1.1's `/import` deletion). It also owns the `ChangelogMenuItem` / `ProfileMenuItem` removals in `layout/TopBar.tsx` (1.1 having already removed `ImportFromJsonMenuItem`); this story only edits TopBar's `UsersMenuItem` link and `CanAccess` resource. `layout/navItems.ts` has **no** `sales` reference, so `/members` is not in the nav today; do not add it here.
- **Story 1.6 (tidy baseline)** — inherits AC 16. Do not defer lint/type failures to it.

### Scope calls to confirm rather than guess

1. **`doc/` pages.** Only `developers/architecture-choices.mdx` describes the surviving profile table. Of the other five, `users/import-data.mdx` (8 hits) is **deleted by story 1.1** (its AC-16), so it is gone before you start; the remaining four (`index.mdx` — 4, `developers/custom-fields.mdx` — 4, `users/inbound-email.mdx` — 1, `developers/sso.mdx` — 1) document the fossil CRM's `<ReferenceField reference="sales">` patterns for entities story 1.1 deletes, and sit inside the 18-page `doc/` rebrand that 1.1 explicitly defers (1.1 Dev Notes §"`doc/` — what is deleted and what is deferred"). This story updates only `architecture-choices.mdx`. Flag if the planner wants the deferred four swept now.
2. **The `update_password` dead body field.** `providers/supabase/dataProvider.ts:251` sends `sales_id`, which `supabase/functions/update_password/index.ts` never reads (it resolves the user from the JWT). Task 7 **deletes** it. There is no rename fallback: NFR-14 forbids carrying a dead surface through a rename, so `member_id` here would be a fresh greenfield violation rather than a safe compromise.
3. **`useGetMemberName` ends up with zero call sites.** All **ten** of `useGetSalesName`'s importers today (`notes/Note.tsx`, `notes/NoteShowPage.tsx`, `notes/NotesIteratorMobile.tsx`, `contacts/ContactBackgroundInfo.tsx`, `companies/CompanyAside.tsx`, `activity/ActivityLog{CompanyCreated,ContactCreated,ContactNoteCreated,DealCreated,DealNoteCreated}.tsx`) are deleted by story 1.1, which lands first. This story keeps the hook (it belongs to the `members` resource). Deleting an unused export is story 1.6's call.
4. **`.claude/skills/delete-initial-resource/*.md`** mentions `sales`/`sales_id` throughout — it is the tooling for story 1.1's own job and will itself become obsolete once the fossils are gone. Deliberately excluded from the AC-14 gate; flag for whoever retires that skill.

### Testing standards

- `.claude/rules/testing.md`: 80% minimum on new code paths, AAA structure, descriptive behaviour names, no shared mutable state, no `waitForTimeout`.
- Test projects (`vitest.config.ts`): `app` (browser/DOM), `functions` (edge functions), `workers`, `claude` (hooks), `db` (psql). This story adds to `db` and edits `app` + `functions` fixtures. `npm run test:unit:db` skips itself if the local stack is down — make sure it is up (`make start`) so the new suite actually runs.
- The `db` suite pattern is `begin; … rollback;` with a temp `results` table emitting JSON, one row per invariant, turned into named assertions by the `.test.ts` runner. Copy `supabase/tests/billing_entitlement.{sql,test.ts}` rather than inventing a shape.

### Project Structure Notes

- The renamed folder stays under the established one-folder-per-resource convention: `src/components/atomic-crm/members/` alongside `children/`, `shadchanim/`, `shidduchim/`, `references/`, `inbox/`, `reminders/`.
- `src/components/admin/` and `src/components/ui/` are mutable dependencies and contain no `sales` reference — do not touch them.
- Both data providers must stay in sync (AD-10 / the `providers/{supabase,fakerest,commons}` seam). A rename applied to one provider only is a divergence bug, not a partial success.
- `registry.json` is generated (`make registry-gen`, wired into the pre-commit hook); do not hand-edit it, but do regenerate it so the six `sales/*` paths and `dataGenerator/sales.ts` disappear.
- `.claude/rules/lsp-usage.md`: use `findReferences` / `goToDefinition` for the TypeScript symbols (`Sale`, `SalesFormData`, `salesCreate`, `salesUpdate`, `useGetSalesName`, `getSale`) rather than `grep -rn`. Use `grep`/`rg` for the SQL identifiers (`sales`, `sales_id`, `sales_id_seq`) and for the final AC-14 sweep — those are string-level, not symbol-level.
- `.claude/rules/english-only.md`: the French message file is a **runtime translation value**, so `frenchCrmMessages.ts` keeps French copy. Only its **key** (`sales:` → `members:`) changes.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2: Rename `sales` to `members`] — the acceptance contract: "the table, its FKs, policies, grants and all code references are `members`… no alias, view or compatibility shim to `sales` remains."
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-23] — "The user/profile table is **`members`**, not `sales`… no aliases, views or redirects survive (NFR-14). CI fails on a reference to a retired name."
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-1] — tenant isolation is scope + RLS in Postgres, deny-by-default; `account_members` is the membership table; views are `security_invoker = on` and `init_state` is slated for deletion (Epic 2, not here).
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1: Debt Clearance & Entity Truth] — NFR-14 / D19 greenfield standard: "no backwards compatibility, no deprecation shims, no fallbacks, no aliased views or columns. One code path per behaviour."
- [Source: _bmad-output/specs/spec-myshadchan/glossary.md#Identity and access] — **member** = "a login's membership of a context, carrying a role"; **"contact", "company", "deal", "lead"** are words the product deliberately does not use.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/SOLUTION-DESIGN.md:110] — the contradicting claim that `account_members` "Replaces `sales`"; superseded by AD-23 for the purposes of this story.
- [Source: AGENTS.md#Database Management] — declarative schema in `supabase/schemas/` is the source of truth; generated migrations "sometimes need manual adjustment (e.g. replacing a DROP+CREATE with an ALTER TABLE RENAME)"; `02_functions.sql` must keep exact `pg_dump` format.
- [Source: supabase/schemas/01_tables.sql:93-104,126,184-185,261] — the `sales` table, its unique index, `tasks.sales_id`, its FK, and the comment claiming `account_members` "Replaces the fork's `sales` concept… `sales` itself is left in place for the legacy CRM resources."
- [Source: supabase/schemas/02_functions.sql:237,288,316,496] — the `CREATE OR REPLACE FUNCTION` headers for `handle_new_user`, `handle_update_user`, `is_admin`, `set_sales_id_default`.
- [Source: supabase/schemas/03_views.sql:130-135] — `init_state`, `security_invoker = off`, `select sales.id from public.sales limit 1`.
- [Source: supabase/schemas/04_triggers.sql:6,27-29,73] — the surviving `set_task_sales_id_trigger` and the auth-sync trigger comment.
- [Source: supabase/schemas/05_policies.sql:12,48-49] and [Source: supabase/schemas/06_grants.sql:64-66,89-90,148-150] — RLS and the full grant surface.
- [Source: .claude/rules/security-triggers.md] — database migrations and RLS policies always dispatch a security review.
- [Source: .claude/rules/testing.md] — coverage floor, AAA, isolation, deterministic waits.
- [Source: .claude/rules/lsp-usage.md] — LSP for TS symbols; `grep`/`rg` for SQL identifiers and string sweeps.
- [Source: user memory `supabase-cli-dbus-hang`] — every `npx supabase` invocation needs `DBUS_SESSION_BUS_ADDRESS=/dev/null` or it hangs forever on the keyring.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
