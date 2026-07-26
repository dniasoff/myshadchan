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

7. **The React resource is `members`.** `src/components/atomic-crm/sales/` becomes `src/components/atomic-crm/members/` with `MemberCreate.tsx`, `MemberEdit.tsx`, `MemberInputs.tsx`, `MemberList.tsx`, `useGetMemberName.ts`, `index.ts`. `<Resource name="sales" …>` in `root/CRM.tsx` becomes `<Resource name="members" …>`; the route is `/members`; `TopBar.tsx` links to `/members`; `canAccess.ts` gates on `resource === "members"`. No `/sales` route, redirect or alias survives (NFR-14).

8. **Types and provider methods carry the new name.** `Sale` → `Member` and `SalesFormData` → `MemberFormData` in `src/components/atomic-crm/types.ts`; `Task.sales_id` → `Task.member_id`. `dataProvider.salesCreate` → `memberCreate` and `dataProvider.salesUpdate` → `memberUpdate` in **both** providers (`providers/supabase/dataProvider.ts` and `providers/fakerest/dataProvider.ts`) and at all 7 call sites (`sales/SalesCreate.tsx:20`, `sales/SalesEdit.tsx:47`, `settings/ProfileForm.tsx:76`, `settings/ProfilePage.tsx:44`, `settings/ProfileSection.tsx:54` and `:86`, and `misc/useImportFromJson.ts:159` — the last of which story 1.1 deletes, leaving 6). `getSale()` → `getMember()` and `CURRENT_SALE_CACHE_KEY` → `CURRENT_MEMBER_CACHE_KEY` (value `"RaStore.auth.current_member"`) in `providers/supabase/authProvider.ts`.

9. **The i18n resource block is renamed in both locales.** `resources.sales` → `resources.members` in `providers/commons/englishCrmMessages.ts` and `frenchCrmMessages.ts`. Every `translate("resources.sales.…")` call site is updated. No translation key resolves through a fallback.

10. **The edge functions carry the new name.** `supabase/functions/_shared/getUserSale.ts` → `getUserMember.ts` (export `getUserSale` → `getUserMember`); in `users/index.ts` the helpers `createSale` / `updateSaleAdministrator` / `updateSaleAvatar` / `updateSaleDisabled` / `currentUserSale` and the request-body field `sales_id` are renamed; in `postmark/` the exported `resolveAccountIdForSalesEmail` → `resolveAccountIdForMemberEmail` and its locals; `_shared/db.ts`'s `TasksTable.sales_id` → `member_id`. The client and the edge function agree on the new `member_id` body field name (a mismatch here silently 404s the profile save).

11. **The FakeRest side is renamed with the Supabase side.** `providers/fakerest/dataGenerator/sales.ts` → `members.ts` (`generateSales` → `generateMembers`), `Db.sales` → `Db.members` in `dataGenerator/types.ts`, the `db.sales = …` line in `dataGenerator/index.ts`, the `sales_id: 0` seeds in `dataGenerator/tasks.ts` and `dataGenerator/references.ts`, the `resource: "sales"` lifecycle-callback block, and `providers/fakerest/authProvider.ts`. The FakeRest demo boots and lets a user sign in (AD-10: the two providers stay in sync).

12. **Tests and e2e fixtures are renamed.** `e2e/fixtures.ts`: the `TABLES` reset list entry `"sales"` → `"members"`, `createSales` → `createMember`, its `salesId` params and `sales_id` inserts → `memberId` / `member_id`. `src/test/StoryWrapper.tsx` (`Sale` → `Member`, `sales: [baseSale]` → `members: [baseMember]`, `sales_id` → `member_id`). `tasks/TaskCreateSheet.test.tsx` and `tasks/TasksListFilter.test.tsx`.

13. **A database test proves the rename and the access posture.** A new `supabase/tests/members_rename.sql` + `members_rename.test.ts` pair (same shape as `billing_entitlement.*`) asserts, at minimum:
    - `to_regclass('public.sales') is null` and `to_regproc('public.set_sales_id_default') is null` (positive proof of deletion, not just absence of grep hits);
    - **negative RLS/grant check:** the `anon` role cannot read `public.members` (no DML grant, no policy) — this is the mandatory negative test for an RLS-touching change;
    - `set_member_id_default()` populates `tasks.member_id` from the calling `auth.uid()`;
    - `handle_new_user()` inserts a `public.members` row and bootstraps the first user's `account_members` row exactly as before.

14. **Verification gate — no `sales` reference survives in live code.** All of the following return **zero** hits:
    - `grep -rniE '\bsales?\b' src/ e2e/ supabase/schemas/ supabase/functions/ supabase/tests/`
    - `grep -rn 'sales' registry.json` (after `make registry-gen`)
    - `grep -rniE '\bsales?\b' AGENTS.md .claude/skills/backend-dev/SKILL.md .claude/skills/frontend-dev/SKILL.md`
    - `grep -rniE '\bsales?\b' doc/src/content/docs/developers/architecture-choices.mdx`

    The one known false positive — the comment `// Arrange: sales language, …` in `src/components/atomic-crm/landing/LandingPage.test.tsx:119`, ordinary English about marketing copy rather than the entity — is reworded to `marketing language` so the gate can be zero-tolerance.

    **`supabase/migrations/` is excluded from the gate and must not be rewritten.** Migrations are an append-only historical record; 17 existing files legitimately name `sales` (118 occurrences) because that is what the database was called when they ran, and this story's own migration necessarily names `sales` in its `ALTER … RENAME` statements. The testable form of "no migration references the retired name" is AC 1 + AC 13: after `migration up`, `to_regclass('public.sales')` is NULL and no `public` relation is named `sales%`. Every migration authored **after** this one must name only `members`.

    Also excluded by design: `CHANGELOG.md`, `mockup/`, `design-artifacts/`, `_bmad-output/`, `dist/`, `node_modules/` (historical or generated — never rewritten), and the five `doc/` pages documenting fossil resources (see "Scope calls").

15. **No alias, view, redirect, synonym or compatibility shim to `sales` exists anywhere** — no `create view sales as select * from members`, no `/sales` route redirect, no `salesCreate` re-export, no `Sale = Member` type alias, no `sales_id` accepted alongside `member_id` in any request body (NFR-14, AD-23).

16. **The build is green with no suppressions.** `npm run typecheck`, `npm run lint`, `npm run prettier`, `npm run test:unit:app`, `npm run test:unit:functions`, `npm run test:unit:db` all pass, and no `@ts-ignore`, `eslint-disable` or skipped test was added to achieve it.

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
  - [ ] Use LSP `findReferences` on `Sale` and `SalesFormData` before editing: 37 `Sale` references across 14 files today.

- [ ] **Task 6 — Rename the resource directory and registration** (AC: 7)
  - [ ] `git mv src/components/atomic-crm/sales src/components/atomic-crm/members`; rename the five component files and `useGetSalesName.ts` → `useGetMemberName.ts`; rename the exported symbols (`SalesCreate`→`MemberCreate`, `SalesEdit`→`MemberEdit`, `SalesInputs`→`MemberInputs`, `SalesList`→`MemberList`, `SalesListActions`→`MemberListActions`, `SaleEditTitle`→`MemberEditTitle`, `useGetSalesName`→`useGetMemberName`).
  - [ ] `src/components/atomic-crm/root/CRM.tsx`: import path (line 37) and `<Resource name="sales" …>` → `name="members"` (line 290).
  - [ ] `src/components/atomic-crm/layout/TopBar.tsx`: `<CanAccess resource="members" …>` (line 44), `<Link to="/members">` (line 131), `translate("resources.members.name", …)` (line 133).
  - [ ] `src/components/atomic-crm/providers/commons/canAccess.ts`: `params.resource === "members"` (lines 20-21).
  - [ ] `useGetMemberName` is imported today by 7 files, 6 of which (`notes/*`, `contacts/ContactBackgroundInfo.tsx`, `activity/*`, `companies/CompanyAside.tsx`) are deleted by story 1.1 — after 1.1 the hook may have zero call sites. Keep it (it is the members resource's own hook); do not delete it in this story.

- [ ] **Task 7 — Rename provider methods and the auth path** (AC: 8, 11)
  - [ ] `providers/supabase/dataProvider.ts`: `salesCreate` → `memberCreate` (line 194), `salesUpdate` → `memberUpdate` (line 216), the two `console.error("salesCreate.error", …)` strings, the `sales_id: id` body field on the `users` invoke (line 229) → `member_id`, and the `resource: "sales"` lifecycle-callback block (line 684).
  - [ ] `providers/supabase/dataProvider.ts` line 251: the `update_password` invoke body sends `sales_id`, which the `update_password` edge function never reads (it resolves the user from the JWT). **Delete the dead field** rather than rename it — NFR-14 forbids carrying a dead surface through a rename. (Fallback if the reviewer objects to the deletion: rename it to `member_id`; do not leave `sales_id`.)
  - [ ] `providers/supabase/authProvider.ts`: `getSale()` → `getMember()` (line 55), `.from("members")` (line 71), `CURRENT_SALE_CACHE_KEY` → `CURRENT_MEMBER_CACHE_KEY = "RaStore.auth.current_member"` (line 27 + lines 57, 81, 88), locals `sale`/`dataSale`/`errorSale` → `member`/`dataMember`/`errorMember`, and the comment on line 25.
  - [ ] `providers/fakerest/dataProvider.ts` (35 hits): `salesCreate`/`salesUpdate` (lines 675, 685), every `"sales"` resource string (lines 662, 676, 689, 697, 705, 720, 728, 947), `filter.sales_id` (line 499), `newSaleId` (line 970) and the `sales_id` update payloads (lines 1011-1029). The `beforeDelete` reassignment block (starting line 965) fans out to `companies`/`contacts`/`contact_notes`/`deals` — those four arms are removed by story 1.1; rename what survives and coordinate.
  - [ ] `providers/fakerest/authProvider.ts`: `getList("members")` (line 24), `Sale` → `Member` (lines 3, 68, 77), locals.
  - [ ] `providers/fakerest/dataGenerator/`: `git mv sales.ts members.ts`, `generateSales` → `generateMembers`; `index.ts` line 8/16; `types.ts` `Db.sales` → `Db.members` (line 34) and the `Sale` import (line 19); `tasks.ts` line 50 and `references.ts` line 344 `sales_id: 0` → `member_id: 0`.

- [ ] **Task 8 — Rename the settings/profile and tasks surfaces** (AC: 8, 9)
  - [ ] `settings/ProfileForm.tsx` (lines 19, 35, 66-76, 107, 178 — including the `resources.sales.fields.` label prefix), `settings/ProfilePage.tsx` (lines 14, 27, 36, 44, 81), `settings/ProfileSection.tsx` (lines 23, 29, 44, 54-57, 83-86, 126, 134, 142).
  - [ ] `tasks/AddTask.tsx:109`, `tasks/TaskCreateSheet.tsx:82`, `tasks/TasksListByDueDate.tsx:44` — `sales_id: identity.id` → `member_id: identity.id`.

- [ ] **Task 9 — Rename the i18n resource block** (AC: 9)
  - [ ] `providers/commons/englishCrmMessages.ts`: the `sales: { … }` block at line 339 → `members: { … }`. Lines 77 and 140 (`sales_id: "Account manager"` under `companies` / `contacts`) and line 619 belong to fossil resources — story 1.1's.
  - [ ] `providers/commons/frenchCrmMessages.ts`: the same block at line 344; lines 79 and 143 are 1.1's.
  - [ ] Grep for `resources.sales` across `src/` and update every `translate()` / `label=` / `notify()` key.

- [ ] **Task 10 — Rename the edge functions** (AC: 10)
  - [ ] `git mv supabase/functions/_shared/getUserSale.ts supabase/functions/_shared/getUserMember.ts`; export `getUserMember`; `.from("members")`; update the one importer (`users/index.ts:6`).
  - [ ] `supabase/functions/users/index.ts` (53 hits): `createSale`/`updateSaleAdministrator`/`updateSaleAvatar`/`updateSaleDisabled` → `createMember`/`updateMemberAdministrator`/`updateMemberAvatar`/`updateMemberDisabled`; `currentUserSale` → `currentUserMember`; every `.from("sales")` → `.from("members")`; the destructured request field `sales_id` → `member_id` (line 244) and its two `.eq("id", …)` uses (lines 255, 299); the error strings ("Failed to update sale", "A sales for this email already exists", "Error patching sale:").
  - [ ] `supabase/functions/postmark/createInboxItemFromEmail.ts`: `resolveAccountIdForSalesEmail` → `resolveAccountIdForMemberEmail`, param `salesEmail` → `memberEmail`, `.from("members")`, and the doc comment.
  - [ ] `supabase/functions/postmark/index.ts` (19 hits): the import (line 16), `salesEmail`/`allSales`/`salesEmails` locals, `.from("members")` (line 57), the three error strings and the two explanatory comments (lines 52, 77, 83, 90, 251).
  - [ ] `supabase/functions/_shared/db.ts`: `TasksTable.sales_id` → `member_id` (line 47). Lines 36/55/73 belong to `ContactsTable`/`ContactNotesTable`/`DealsTable` — story 1.1's.
  - [ ] `supabase/functions/mcp/index.ts`: the two tool-description sentences that mention `sales_id` (lines 306, 360) → `member_id`. The "Sales pipeline" bullet on line 297 is fossil CRM vocabulary — story 1.1's.

- [ ] **Task 11 — Rename the tests and e2e fixtures** (AC: 12)
  - [ ] `e2e/fixtures.ts` (23 hits): `TABLES` entry `"sales"` → `"members"` (line 21) and the cascade comment (line 30); `createSales` → `createMember` (lines 57, 76, 80, 87, 217, 239-240); `salesId` params (lines 95, 99, 125, 128, 189) → `memberId`; `sales_id` insert fields (lines 111, 132, 148, 155, 169) → `member_id`.
  - [ ] `src/test/StoryWrapper.tsx`: `Sale` → `Member` (lines 10, 27, 29), `sales: [baseSale]` → `members: [baseMember]` (line 49), `sales_id: 0` → `member_id: 0` (line 71).
  - [ ] `tasks/TaskCreateSheet.test.tsx:39` and `tasks/TasksListFilter.test.tsx:16,23`.
  - [ ] `e2e/userAddingATask.spec.ts` and `e2e/bulkContactTags.spec.ts` build contacts/companies and are expected to be deleted by story 1.1. If they still exist when this story runs, rename their `createSales`/`salesId`/`sales_id` uses so the gate in AC 14 passes.
  - [ ] Reword `landing/LandingPage.test.tsx:119` `sales language` → `marketing language`.

- [ ] **Task 12 — Add the database test** (AC: 13)
  - [ ] Create `supabase/tests/members_rename.sql` and `supabase/tests/members_rename.test.ts` modelled on `supabase/tests/billing_entitlement.{sql,test.ts}`: `\set ON_ERROR_STOP on`, `begin;`, a temp `results(name, passed, detail)` table, one row per check, JSON output, `rollback;`. The `.test.ts` runner skips itself when the database is unreachable.
  - [ ] Checks: `to_regclass('public.sales') is null`; `to_regclass('public.members') is not null`; `to_regproc('public.set_sales_id_default') is null`; no `pg_class` row in schema `public` with `relname like 'sales%'`; `anon` **cannot** read `public.members` (negative test); `set_member_id_default()` fills `tasks.member_id` from `auth.uid()`; `handle_new_user()` writes a `members` row and the first user's `account_members` row.

- [ ] **Task 13 — Update the developer documentation that describes the renamed surface** (AC: 14)
  - [ ] `AGENTS.md` line 82 (`sales/  # Sales team management` → `members/  # Member (user/profile) management`) and line 127 (the `auth.users` ↔ `sales` trigger sentence).
  - [ ] `.claude/skills/backend-dev/SKILL.md` lines 28, 38, 49, 58 (`salesCreate()`, "the auto-set `sales_id` trigger") and `.claude/skills/frontend-dev/SKILL.md` line 42 (`dataProvider.salesCreate()` in `SalesCreate.tsx`).
  - [ ] `doc/src/content/docs/developers/architecture-choices.mdx:46` — the paragraph explaining the `sales` table is the one doc page describing a surface that survives; update it to `members`. The other five `doc/` pages (`users/import-data.mdx`, `users/inbound-email.mdx`, `developers/custom-fields.mdx`, `developers/sso.mdx`, `index.mdx`) document the fossil CRM import/contacts flow — see Dev Notes for the scope call.
  - [ ] `make registry-gen` (also runs on pre-commit) so `registry.json` no longer lists `sales/*` paths.
  - [ ] Repo-root `MEMORY.md` lines 7 and 9 are maintained by the `documentator` agent — flag, do not hand-edit.

- [ ] **Task 14 — Run the gate** (AC: 14, 16)
  - [ ] `grep -rniE '\bsales?\b' src/ e2e/ supabase/schemas/ supabase/functions/ supabase/tests/` → zero hits. (Do **not** include `supabase/migrations/` — see AC 14.)
  - [ ] `grep -rn 'sales' registry.json` → zero hits.
  - [ ] `psql "$SUPABASE_DB_URL" -c "select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname like 'sales%'"` → zero rows.
  - [ ] `npm run typecheck && npm run lint && npm run prettier` → clean.
  - [ ] `npm run test:unit:app`, `npm run test:unit:functions`, `npm run test:unit:db` → green.
  - [ ] Smoke: sign in against the local stack, open `/members`, edit the profile at `/settings`, create a reminder — the three paths that write through `members` / `member_id`.

## Dev Notes

### Verified surface (counted, 2026-07-26)

`sales` / `sale` appears **731 times** across the repo's live code and developer docs (case-insensitive, `\bsales?\b`; excludes `node_modules/`, `dist/`, `CHANGELOG.md`, `mockup/`, `design-artifacts/`, `_bmad-output/`). Split by who owns it:

| Area | Files | Occurrences | Owner |
|---|---|---|---|
| `supabase/schemas/*.sql` | 6 | 79 | split — see per-line map below |
| `src/`, `supabase/functions/`, `e2e/` — surviving files | 40 | 329 | **this story** |
| `src/`, `supabase/functions/` — fossil files | 40 | 287 | **story 1.1** (deleted outright) |
| `doc/` | 6 | 18 | split — see below |
| `registry.json` | 1 | 7 | generated (`make registry-gen`) |
| `AGENTS.md`, `.claude/skills/{backend-dev,frontend-dev}/SKILL.md` | 3 | 9 | **this story** (Task 13) |
| repo-root `MEMORY.md` | 1 | 2 | `documentator` agent — flag, do not hand-edit |

**Per-line map of `supabase/schemas/` (79 occurrences on 62 lines):**

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

- **Story 1.1 (delete the fossils)** — the big one. It deletes 40 of the files that mention `sales` today (287 occurrences). It also edits, but does not delete: `supabase/schemas/{01_tables,02_functions,03_views,04_triggers,05_policies,06_grants}.sql`, `src/components/atomic-crm/types.ts`, `root/CRM.tsx`, `providers/{supabase,fakerest}/dataProvider.ts`, `providers/commons/{englishCrmMessages,frenchCrmMessages}.ts`, `supabase/functions/_shared/db.ts`, `supabase/functions/mcp/index.ts`, `e2e/fixtures.ts`. **Sequence 1.1 before 1.2** if at all possible — it removes ~40% of the `sales` surface for free. If 1.2 lands first, the AC-14 gate still has to pass, so the fossil files must be renamed too and 1.1 then deletes them.
- **Story 1.3 (`children` → `singles`)** — touches the same registration and provider files: `root/CRM.tsx`, `types.ts`, both `dataProvider.ts`, both message files, `dataGenerator/index.ts` + `types.ts`, `e2e/fixtures.ts`, and `supabase/schemas/01_tables.sql`. Note `children.member_id` is 1.3's column on a table 1.3 renames — coordinate so the `member_id` semantics discussion above happens once.
- **Story 1.4 (retire the token portal)** — `root/CRM.tsx`, `providers/*/dataProvider.ts`, `supabase/schemas/*`. No `sales` overlap (`src/components/atomic-crm/portal/` and `children/ChildPortalShare.tsx` contain zero `sales` references).
- **Story 1.5 (dead routes)** — `root/CRM.tsx` and `layout/navItems.ts`. `navItems.ts` currently has **no** `sales` reference, so `/members` is not in the nav today; do not add it in this story.
- **Story 1.6 (tidy baseline)** — inherits AC 16. Do not defer lint/type failures to it.

### Scope calls to confirm rather than guess

1. **`doc/` pages.** Only `developers/architecture-choices.mdx:46` describes the surviving profile table. The other five pages (`users/import-data.mdx` — 7 hits, `users/inbound-email.mdx` — 1, `developers/custom-fields.mdx` — 3, `developers/sso.mdx` — 1, `index.mdx` — 3) document the fossil CRM's JSON import and `<ReferenceField reference="sales">` patterns for entities story 1.1 deletes. This story updates only `architecture-choices.mdx` and leaves the rest to 1.1 / the documentator. Flag if the planner wants them all swept now.
2. **The `update_password` dead body field.** `providers/supabase/dataProvider.ts:251` sends `sales_id`, which `supabase/functions/update_password/index.ts` never reads. Task 7 deletes it; renaming it is the low-risk fallback. Either satisfies the gate — leaving `sales_id` does not.
3. **`useGetMemberName` may end up with zero call sites** after story 1.1 removes its six fossil importers. This story keeps it (it belongs to the `members` resource). Deleting an unused export is story 1.6's call.
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
