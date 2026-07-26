# Story 1.1: Delete the fossil resources

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the Atomic CRM fork entities (`contacts`, `companies`, `deals`, `deal_notes`, `contact_notes`, `tags`, `favicons_excluded_domains`) removed entirely — schema, UI, fixtures, generators, types and tests,
so that the codebase contains only concepts that exist in shidduchim and no developer or agent has to guess which "contact" is real.

## Context and vocabulary

AD-23 is explicit: *"The fork's `contacts`, `companies`, `deals`, `deal_notes`, `contact_notes`, `tags` and `favicons_excluded_domains` are **dropped outright** with their UI, fixtures and types — no aliases, views or redirects survive (NFR-14)."*
The glossary lists **"contact", "company", "deal", "lead"** under *"Words we deliberately do not use"*.
NFR-14 (greenfield): no backwards compatibility, no shims, no fallbacks, no aliased views/columns; **when something is replaced the replaced thing is deleted in the same change**.

**Not in this story:** `sales` (story 1.2 renames it to `members`), `children` (story 1.3 → `singles`), `child_portal_tokens` / `portal/` / `get_child_portal()` (story 1.4), the `/tasks` redirect and the route-renders-something check (story 1.5), the zero-warning CI gate (story 1.6). Leave `sales`, `set_sales_id_default()`, `is_admin()`, `init_state` and `current_account_id()` exactly as they are.

---

## Acceptance Criteria

1. **The seven tables and everything attached to them no longer exist.** `supabase/schemas/01_tables.sql` no longer declares `companies`, `contacts`, `contact_notes`, `deals`, `deal_notes`, `tags`, `favicons_excluded_domains`, their **10 foreign-key constraints**, their **2 legacy PK constraints** (`contactNotes_pkey`, `dealNotes_pkey`) or their **4 FK indexes** (`contact_notes_contact_id_idx`, `contacts_company_id_idx`, `deal_notes_deal_id_idx`, `deals_company_id_idx`). The **7 identity sequences** (`companies_id_seq`, `contacts_id_seq`, `"contactNotes_id_seq"`, `deals_id_seq`, `"dealNotes_id_seq"`, `tags_id_seq`, `favicons_excluded_domains_id_seq`) are gone with them.

2. **The three fossil views are dropped**: `activity_log`, `companies_summary`, `contacts_summary` (`supabase/schemas/03_views.sql` lines 6–128). No replacement view, no alias, no `security_invoker` shell is left behind. `init_state` and every shidduchim-domain view survive untouched.

3. **The 13 fossil triggers and 9 fossil functions are dropped.** Triggers (`04_triggers.sql` lines 7–71): `set_company_sales_id_trigger`, `set_contact_sales_id_trigger`, `set_contact_notes_sales_id_trigger`, `set_deal_sales_id_trigger`, `set_deal_notes_sales_id_trigger`, `company_saved`, `10_lowercase_contact_emails`, `20_contact_saved`, `on_public_contact_notes_created_or_updated`, `on_contact_notes_attachments_updated_delete_note_attachments`, `on_contact_notes_deleted_delete_note_attachments`, `on_deal_notes_attachments_updated_delete_note_attachments`, `on_deal_notes_deleted_delete_note_attachments`. Functions (`02_functions.sql`): `cleanup_note_attachments()`, `get_avatar_for_email(text)`, `get_domain_favicon(text)`, `get_note_attachments_function_url()`, `handle_company_saved()`, `handle_contact_note_created_or_updated()`, `handle_contact_saved()`, `lowercase_email_jsonb()`, `merge_contacts(bigint,bigint)`. **`set_sales_id_default()` survives** — `tasks` still uses it (`set_task_sales_id_trigger`), and story 1.2 renames it.

4. **The 25 fossil RLS policies and their 7 `enable row level security` lines are removed** from `05_policies.sql` (companies 4, contacts 4, contact_notes 4, deals 4, deal_notes 4, tags 4, favicons_excluded_domains 1). The `tasks` policy `"Tasks scoped to account"` and every shidduchim-domain policy survive unchanged.

5. **All 68 fossil grant statements are removed** from `06_grants.sql`: 27 function grants (9 functions × 3 roles, lines 13–27, 32–42, 56–62), 14 table grants (lines 74–104), 9 view grants (`activity_log`, `companies_summary`, `contacts_summary`, lines 108–117), 18 sequence grants (lines 124–146). `sales`, `tasks`, `configuration`, `init_state` and `sales_id_seq` grants survive.

6. **`tasks` is de-fossilised in the same change.** `tasks.contact_id` (column, `tasks_contact_id_fkey`, the `nb_tasks` join in `contacts_summary`) is dropped; `tasks.target_type` no longer defaults to `'contact'` (new default `'shidduch'`) and `'contact'` is removed from `tasks_target_type_check`; `sync_task_target()` is rewritten so it no longer reads or writes `contact_id` and rejects a row with no `target_id`. No `contact_id` shim column, no tolerated `'contact'` target type.

7. **`supabase/seed.sql` no longer seeds `favicons_excluded_domains`** (the 103-row INSERT is the entire file; leave the file empty or delete it).

8. **The six fossil frontend directories are deleted in full — 119 files**: `src/components/atomic-crm/contacts/` (48, incl. `__screenshots__/`), `companies/` (15), `deals/` (16), `notes/` (22), `tags/` (9), `activity/` (9).

9. **The 47 further fossil-only files listed in Dev Notes §"Files to delete outside the six directories" are deleted** — 6 orphaned dashboard widgets, 8 `misc/` files, 6 `providers/commons/` files, 8 fakerest generators, 4 `tasks/` files, `consts.ts`, 2 `test-data/` fixtures, 3 e2e specs, and 9 edge-function files (`merge_contacts/`, `delete_note_attachments/`, `_shared/db.ts`, and the 6 orphaned `postmark/` contact modules).

10. **No fossil type survives in `src/components/atomic-crm/types.ts`**: `Company`, `Contact`, `ContactNote`, `Deal`, `DealNote`, `Tag`, `EmailAndType`, `PhoneNumberAndType`, `DealStage`, `ContactGender`, `NoteStatus`, `ActivityCompanyCreated`, `ActivityContactCreated`, `ActivityContactNoteCreated`, `ActivityDealCreated`, `ActivityDealNoteCreated`, `Activity` are all gone; `Task.contact_id` is gone and `TaskTargetType` is `"shadchan" | "shidduch" | "reference"`. **`Shadchan.contacts?: unknown` stays** — it is the `shadchanim.contacts` jsonb column, not the fossil table.

11. **The fossil configuration props are gone**: `companySectors`, `currency`, `dealCategories`, `dealPipelineStatuses`, `dealStages`, `noteStatuses` are removed from `root/defaultConfiguration.ts`, `root/ConfigurationContext.tsx`, `root/CRM.tsx` (default arg + JSDoc + store seed) and the `src/App.tsx` JSDoc list. `taskTypes`, `title`, `darkModeLogo`, `lightModeLogo`, `googleWorkplaceDomain`, `disableEmailPasswordAuthentication` survive.

12. **Both i18n catalogs are pruned symmetrically.** `resources.companies`, `resources.contacts`, `resources.deals`, `resources.notes`, `resources.tags`, `crm.activity`, `crm.import`, `crm.header.import_data`, `crm.settings.companies`, `crm.dashboard.{deals_chart,deals_pipeline,latest_activity,latest_activity_error,latest_notes,latest_notes_added_ago,stepper,upcoming_tasks}` and the fossil keys inside `resources.tasks` (`fields.contact_id`, `regarding_contact`, `empty_list_hint`) are removed from **both** `englishCrmMessages.ts` and `frenchCrmMessages.ts`. `frenchCrmMessages.ts` is type-checked against the English shape, so a one-sided removal is a `tsc` error.

13. **No dead route or dead link to a fossil resource remains.** `login/SignupPage.tsx:48` no longer redirects to `/contacts`; `misc/ImportPage` is no longer registered in `root/CRM.tsx` or linked from `layout/TopBar.tsx`; `reminders/reminderEntity.ts` no longer maps a `contact` target to `/contacts/:id/show`; `supabase/functions/mcp/taskListUi.ts` no longer builds a `/#/contacts/:id/show` URL.

14. **Verification — repo-wide grep.** After the change,

    ```bash
    grep -rnwE "contacts|contact_notes|contact_id|contact_ids|contactNote|contactNotes|companies|company_id|company_name|companies_summary|contacts_summary|nb_contacts|deals|deal_notes|deal_id|dealNote|dealNotes|nb_deals|tags|favicons_excluded_domains|merge_contacts|activity_log|position_at_company" \
      src/ supabase/schemas/ supabase/functions/ supabase/tests/ supabase/seed.sql e2e/
    ```

    returns hits **only** in the documented `shadchanim.contacts` allowlist (Dev Notes §"The `contacts` name collision"): `supabase/schemas/01_tables.sql` (the column declaration), `src/components/atomic-crm/types.ts` (`Shadchan.contacts`), `src/components/atomic-crm/shadchanim/shadchanUtils.ts`, `shadchanUtils.test.ts`, `ShadchanHeader.tsx`. Zero hits anywhere else. `supabase/migrations/` is **excluded** — it is append-only history (see AC-16).

15. **Green build.** `make typecheck`, `make lint` and `make test` (`test-app`, `test-functions`, `test-workers`, `test-db`) all pass. No `@ts-ignore`, `eslint-disable` or `test.skip` was added to get there. `npm run registry:gen` regenerates `registry.json` with no fossil paths (it runs on pre-commit).

16. **One new forward migration, no history rewrite.** A single generated migration in `supabase/migrations/` performs the drops; **no existing migration file is edited**. The new migration contains no `CREATE VIEW … contacts_summary`, no compatibility alias, no `contact_id` column and no re-grant to a dropped object. `npx supabase migration up --local` applies cleanly against a database already carrying the old migrations.

17. **A negative DB test proves the fossil path is closed.** The `references_entity.sql` case *"a legacy contact task still works and back-fills its polymorphic target"* is deleted and replaced by an assertion that `insert into public.tasks (target_type, target_id, text) values ('contact', 1, '…')` is **rejected** by `tasks_target_type_check`, and that `insert into public.tasks (text) values ('…')` (no target) is still rejected. `npm run test:unit:db` passes.

---

## Tasks / Subtasks

### A. Backend — declarative schema first (AC: 1–7, 16)

- [ ] **A1. `supabase/schemas/01_tables.sql`** (AC: 1, 6)
  - [ ] Delete the `create table` blocks for `companies` (L14–33), `contacts` (L36–54), `contact_notes` (L56–64), `deals` (L66–81), `deal_notes` (L83–91), `tags` (L106–109), `favicons_excluded_domains` (L148–151).
  - [ ] Delete the 10 FK `alter table` statements (L160–185) **and** `tasks_contact_id_fkey` (L188–189).
  - [ ] Delete the 2 legacy PK statements `"contactNotes_pkey"` / `"dealNotes_pkey"` (L192–196) and the 4 FK indexes (L202–205).
  - [ ] In `create table public.tasks`: drop the `contact_id` column; change `target_type text not null default 'contact'` → `default 'shidduch'`; narrow `tasks_target_type_check` to `('shadchan','shidduch','reference')`; rewrite the block comment (it currently explains the legacy contacts UI).
  - [ ] Leave `sales`, `tasks`' other columns, `configuration` and every shidduchim table untouched.
- [ ] **A2. `supabase/schemas/03_views.sql`** (AC: 2) — delete `activity_log` (L6–72), `companies_summary` (L74–100), `contacts_summary` (L102–128). Leave `init_state` (L130) and everything below it.
- [ ] **A3. `supabase/schemas/04_triggers.sql`** (AC: 3) — delete the 13 fossil triggers (L7–71). Keep `set_task_sales_id_trigger` (L27–29) and everything from L73 down.
- [ ] **A4. `supabase/schemas/02_functions.sql`** (AC: 3, 6) — delete the 9 fossil functions; rewrite `sync_task_target()` (L1222–1242) to drop every `contact_id` reference and keep only the "a task needs a target" guard. Verify `purge_polymorphic_dependents()` still compiles (it deletes from `tasks` by `target_type`, no contact coupling).
- [ ] **A5. `supabase/schemas/05_policies.sql`** (AC: 4) — delete the 7 `enable row level security` lines (L7–11, 13, 16) and the 25 policies (L19–55, L73); reword the `tasks` policy comment that says "while tasks were contacts-only".
- [ ] **A6. `supabase/schemas/06_grants.sql`** (AC: 5) — delete the 68 grant lines listed in AC-5. Do **not** touch the `alter default privileges` block (AD-1's anon revocation is Epic 2's job) or the shidduchim REVOKE/GRANT section.
- [ ] **A7. `supabase/seed.sql`** (AC: 7) — remove the `favicons_excluded_domains` INSERT.
- [ ] **A8. Generate + hand-check the migration** (AC: 16)
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f delete_fossil_resources`
  - [ ] Read the generated SQL line by line: confirm it drops (not renames) each object, confirm it does **not** drop/recreate a surviving view without `security_invoker = on`, and confirm it does not emit a `REVOKE` the schema files still declare. `db diff` historically loses `with (security_invoker = on)` and REVOKE statements — fix them by hand in the migration if it does.
  - [ ] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. **Never** `db reset` or `db push`.
- [ ] **A9. DB test** (AC: 17) — in `supabase/tests/references_entity.sql`, delete the legacy-contact-task `do $$ … $$` block (L236–247) and add the two rejection assertions. Reword the L6/L212 comments that mention contacts. Run `npm run test:unit:db`.

### B. Frontend — delete the fossil directories and orphans (AC: 8, 9)

- [ ] **B1.** Delete the six directories (AC: 8). The repo ships `.claude/skills/delete-initial-resource/delete-initial-resource.ts` which does exactly this for `contacts companies deals tags` and prints a dependent-file list — use it as a checklist, then delete `notes/` and `activity/` by hand (they are not in the script's resource list).
- [ ] **B2.** Delete the 47 further fossil-only files listed in Dev Notes (AC: 9). Verify each is an orphan with `LSP findReferences` before deleting; several were confirmed orphaned only once the six directories go.
- [ ] **B3.** Delete `supabase/functions/merge_contacts/`, `supabase/functions/delete_note_attachments/`, `supabase/functions/_shared/db.ts`, and the 6 orphaned `postmark/` modules; remove `[functions.merge_contacts]` and `[functions.delete_note_attachments]` from **both** `supabase/config.toml` (L182, L184) and `supabase/config.e2e.toml` (L159, L161).

### C. Frontend — types, config, providers (AC: 10, 11)

- [ ] **C1. `src/components/atomic-crm/types.ts`** (AC: 10) — delete the 17 fossil types; narrow `Task` and `TaskTargetType`; **keep `Shadchan.contacts`**; remove the `./consts` import (the whole file goes).
- [ ] **C2. `root/defaultConfiguration.ts`, `root/ConfigurationContext.tsx`, `root/CRM.tsx`, `src/App.tsx`** (AC: 11) — remove the 6 fossil config props everywhere they appear (default value, interface field, `CRM` prop default, JSDoc `@param`, store-seed object, App.tsx prop list).
- [ ] **C3. `providers/supabase/dataProvider.ts`** (AC: 9, 13) — remove: the fossil type imports (L15, 17, 18), `processCompanyLogo` (L50), the `companies`/`contacts` `getList` + `getOne` routing (L108–113, 149–154), the `activity_log` branch (L128–147), `unarchiveDeal` (L262–288), `mergeContacts` (L290–304), and the `contact_notes` / `deal_notes` / `contacts` / `companies` / `contacts_summary` / `deals` lifecycle-callback blocks (L661–745). Reword the comment at L516 that compares to the contacts merge.
- [ ] **C4. `providers/fakerest/dataProvider.ts`** — remove the mirror surface: fossil type imports, `processCompanyLogo`, `processContactAvatar`, `fetchAndUpdateCompanyData`, `updateCompany`, the `activity_log` branch (L494–500), `unarchiveDeal` (L627–651), `mergeContacts` (L738), the fossil `updateMany` block inside clear-demo (L972–1032), and the `contacts` / `companies` / `deals` / `contact_notes` / `deal_notes` callback blocks — **plus the `tasks` callbacks (L1077–1140) that increment/decrement `contacts.nb_tasks`**, which must go entirely, not be rewired.
- [ ] **C5. `providers/fakerest/dataGenerator/index.ts` + `types.ts`** — remove the 7 fossil generator calls and the 7 `Db` keys (`companies`, `contacts`, `contact_notes`, `deals`, `deal_notes`, `tags`, plus the `finalize` call). **Set `db.tasks = []` before `generateShidduchimDomain(db)`** — `references.ts:336` reads `db.tasks.length` and `references.ts:350` spreads `db.tasks`, so an undefined `db.tasks` crashes the demo provider.

### D. Frontend — surviving surfaces that must be edited (AC: 12, 13)

- [ ] **D1. `tasks/`** (AC: 9, 13) — delete `AddTask.tsx`, `TaskCreateSheet.tsx`, `TaskCreateSheet.test.tsx`, `TaskCreateSheet.stories.tsx`; strip `showContact` / `selectContact` / `filterByContact` and the contact `ReferenceField` / `ReferenceInput` from `Task.tsx`, `TaskEditSheet.tsx`, `TaskFormContent.tsx`, `TasksIterator.tsx`, `TasksListByDueDate.tsx`, `TasksListFilter.tsx`; drop the `contacts: []` fixture from `TasksListFilter.test.tsx`; check `TaskEdit.tsx` still type-checks against the narrowed `TaskFormContent` props.
- [ ] **D2. `reminders/`** (AC: 13) — remove the `contact` arm from `RESOURCE_FOR_TARGET`, `TARGET_TYPE_LABEL`, `targetEntityPath()` and `targetEntityLabel()` in `reminderEntity.ts`; remove `"contact"` from `ALL_TARGET_TYPES` and delete the fourth `useGetMany` + its `byType` row in `useReminders.ts`.
- [ ] **D3. i18n** (AC: 12) — prune `englishCrmMessages.ts` and `frenchCrmMessages.ts` symmetrically; repoint the `resources.deals.empty.title` assertion in `providers/commons/i18nProvider.test.ts:43` to a surviving French key (e.g. `resources.shidduchim.*`).
- [ ] **D4. Routes / shell** (AC: 13) — `login/SignupPage.tsx:48` `redirectTo: "/contacts"` → `"/"`; remove the `ImportPage` route from `root/CRM.tsx:268` and the `ImportFromJsonMenuItem` + `Import` icon from `layout/TopBar.tsx`.
- [ ] **D5. `src/test/StoryWrapper.tsx`** — remove the fossil db keys (`companies`, `contact_notes`, `contacts`, `deal_notes`, `deals`, `tags`) and the `buildContact` builder + `Contact` import.
- [ ] **D6. e2e** — delete `e2e/bulkContactTags.spec.ts`, `e2e/onboarding.spec.ts`, `e2e/userAddingATask.spec.ts`; in `e2e/fixtures.ts` remove the 6 fossil tables from `TABLES`, delete `createNotes`, `createCompany`, `createContact` and the `goToContacts` menu helper, and remove them from the exported `test.extend` fixture object.
- [ ] **D7. Comment / prose sweep** (AC: 14) — `layout/navItems.ts:28`, `layout/navItems.test.ts:16–22` (delete the "excludes the legacy CRM resources" case — it only contains the fossil strings), `settings/SettingsPage.tsx:28`, `misc/EditSheet.tsx:68–72` (JSDoc example uses `resource="contacts"`), `shidduchim/boardUtils.ts:10`, `references/ReferenceMergeButton.tsx:33`, `references/ReferenceMergeCollision.tsx:9`, `providers/fakerest/internal/referenceMerge.ts:36`, `supabase/functions/merge_references/index.ts:10,13`, `supabase/functions/postmark/index.ts:78`, `AGENTS.md:163,172`.
- [ ] **D8. Edge function `mcp/`** (AC: 13, 14) — rewrite the fossil schema prose in `mcp/index.ts` (L278, 296, 304, 311–314, 354, 365–366, 467) to describe the shidduchim schema; replace the `contact_name` / `contact_id` link in `mcp/taskListUi.ts:93` with the reminder's polymorphic target; rewrite the arbitrary `contacts`/`companies` table names in `mcp/validateSql.test.ts` (25 fixtures) to live tables. Behaviour must not change — these are strings only.

### E. Verify (AC: 14, 15, 16, 17)

- [ ] **E1.** `npm run registry:gen` (or `make registry-gen`) and confirm `registry.json` has no fossil path.
- [ ] **E2.** `make typecheck` → clean. `make lint` (eslint + prettier) → clean.
- [ ] **E3.** `make test` — `test-app`, `test-functions`, `test-workers` — plus `npm run test:unit:db`.
- [ ] **E4.** Run the AC-14 grep and confirm the only hits are the 5 allowlisted `shadchanim.contacts` files.
- [ ] **E5.** Run the app against the local stack (`make start`) and click through Dashboard → Pipeline → Inbox → Shadchanim → References → Reminders → Settings; confirm no console error and no 404 from a removed resource.

---

## Dev Notes

### Files to delete outside the six directories (47)

**Dashboard orphans (6)** — all verified to have zero importers once `contacts/` and `companies/` go; the live `Dashboard.tsx` / `MobileDashboard.tsx` import none of them:
`src/components/atomic-crm/dashboard/DashboardActivityLog.tsx`, `DealsChart.tsx`, `HotContacts.tsx`, `DashboardStepper.tsx`, `TasksList.tsx`, `Welcome.tsx`.

**`misc/` (8)**:
`misc/ContactOption.tsx` (imports `contacts/Avatar`), `misc/Status.tsx` (only fossil importers; its `noteStatuses` config dies with it), `misc/attachmentThumbnail.ts` (only `notes/` importers), `misc/ImportPage.tsx`, `misc/useImportFromJson.ts` (815 lines; imports `tags/colors` and `contacts/contactModel`), `misc/import-sample.json`, `misc/unsupportedDomains.const.ts` (only `getContactAvatar` uses it), `misc/CreateSheet.tsx` (its three importers — `notes/NoteCreateSheet`, `contacts/ContactCreateSheet`, `tasks/TaskCreateSheet` — are all deleted; **`misc/EditSheet.tsx` survives** via `tasks/TaskEditSheet.tsx`).

**`providers/commons/` (6)**:
`activity.ts`, `getCompanyAvatar.ts`, `getCompanyAvatar.test.ts`, `getContactAvatar.ts`, `getContactAvatar.test.ts`, `mergeContacts.ts`.

**`providers/fakerest/dataGenerator/` (8)**:
`companies.ts`, `contacts.ts`, `contactNotes.ts`, `deals.ts`, `dealNotes.ts`, `tags.ts`, `tasks.ts` (generates 400 contact-bound tasks), `finalize.ts` (sets contact status from the latest contact note).

**`tasks/` (4)**: `AddTask.tsx`, `TaskCreateSheet.tsx`, `TaskCreateSheet.test.tsx`, `TaskCreateSheet.stories.tsx`.

**Root (1)**: `src/components/atomic-crm/consts.ts` (the 5 `*_CREATED` activity constants; nothing else lives in it).

**Fixtures (2)**: `test-data/contacts.csv`, `test-data/import-sample-invalid-sale.json`.

**e2e (3)**: `e2e/bulkContactTags.spec.ts`, `e2e/onboarding.spec.ts`, `e2e/userAddingATask.spec.ts`.

**Edge functions (9)**: `supabase/functions/merge_contacts/index.ts`, `supabase/functions/_shared/db.ts` (Kysely types; **only** `merge_contacts` imports it), `supabase/functions/delete_note_attachments/index.ts` (its only callers were the four `cleanup_note_attachments` triggers), and the orphaned `postmark/` modules `addNoteToContact.ts`, `addNoteToContact.test.ts`, `extractMailContactData.ts`, `extractMailContactData.test.ts`, `getNoteContent.ts`, `mailProvider.const.ts` — `postmark/index.ts:78` already records that legacy contact/note creation is retired and imports none of them.

### The `contacts` name collision — do not touch

`shadchanim.contacts jsonb` (`supabase/schemas/01_tables.sql:300`) is a **live column on a live table** holding a shadchan's phone/email/whatsapp. It has nothing to do with the fossil `contacts` table. These 5 files legitimately keep the word and are the AC-14 allowlist:

- `supabase/schemas/01_tables.sql` — the column declaration
- `src/components/atomic-crm/types.ts` — `Shadchan.contacts?: unknown`
- `src/components/atomic-crm/shadchanim/shadchanUtils.ts` — `parseContactInfo()`
- `src/components/atomic-crm/shadchanim/shadchanUtils.test.ts`
- `src/components/atomic-crm/shadchanim/ShadchanHeader.tsx`

Also benign and out of scope: `src/components/admin/*.tsx` JSDoc examples that use `tags` / `companies` / `company_id` as illustrative react-admin resources (10 files) — that is shadcn-admin-kit framework documentation, not this app's schema; `billing/BillingPage.tsx:158` ("Contact us"); `references_summary.contacted_count` and `src/index.css` "companion" (substrings, not word matches).

### Files that survive but must be edited (~35 in `src/`, 12 elsewhere)

Frontend: `src/App.tsx`, `types.ts`, `root/CRM.tsx`, `root/defaultConfiguration.ts`, `root/ConfigurationContext.tsx`, `layout/navItems.ts`, `layout/navItems.test.ts`, `layout/TopBar.tsx`, `login/SignupPage.tsx`, `settings/SettingsPage.tsx`, `misc/EditSheet.tsx`, `providers/supabase/dataProvider.ts`, `providers/fakerest/dataProvider.ts`, `providers/fakerest/dataGenerator/index.ts`, `providers/fakerest/dataGenerator/types.ts`, `providers/fakerest/internal/referenceMerge.ts`, `providers/fakerest/internal/supabaseAdapter.test.ts`, `providers/commons/englishCrmMessages.ts`, `providers/commons/frenchCrmMessages.ts`, `providers/commons/i18nProvider.test.ts`, `reminders/reminderEntity.ts`, `reminders/useReminders.ts`, `references/ReferenceMergeButton.tsx`, `references/ReferenceMergeCollision.tsx`, `shidduchim/boardUtils.ts`, `tasks/Task.tsx`, `tasks/TaskEdit.tsx`, `tasks/TaskEditSheet.tsx`, `tasks/TaskFormContent.tsx`, `tasks/TasksIterator.tsx`, `tasks/TasksListByDueDate.tsx`, `tasks/TasksListFilter.tsx`, `tasks/TasksListFilter.test.tsx`, `src/test/StoryWrapper.tsx`.

Elsewhere: `supabase/schemas/{01..06}.sql`, `supabase/seed.sql`, `supabase/config.toml`, `supabase/config.e2e.toml`, `supabase/tests/references_entity.sql`, `supabase/functions/mcp/{index.ts,taskListUi.ts,validateSql.test.ts}`, `supabase/functions/merge_references/index.ts` (comments), `supabase/functions/postmark/index.ts` (comment), `e2e/fixtures.ts`, `AGENTS.md`.

`registry.json` is generated (`make registry-gen`, pre-commit hook) — it currently lists ~30 fossil paths and will clean itself; do not hand-edit it.

### Migration workflow (this repo's rules)

`supabase/schemas/*.sql` is the **source of truth**; `supabase/migrations/` is append-only history.

```bash
DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f delete_fossil_resources
DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local
```

The `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix is mandatory — every `npx supabase` call otherwise hangs on the keyring and looks like a Docker fault.

**Never** run `npx supabase db reset --local` or `npx supabase db push` in this story. (`.claude/skills/delete-initial-resource/SKILL.md` suggests `db reset` as a verification step — that guidance is superseded here; the deploy-time apply is the harness's migration round, not this ticket.)

**`db diff` is not trustworthy without a read-through.** It has historically dropped `with (security_invoker = on)` from views it regenerates and lost `REVOKE` statements. Read the generated file top to bottom before applying: it must contain only `DROP` / `ALTER TABLE … DROP` statements plus the `tasks` default/check change — no `CREATE VIEW` for a fossil, no re-grant to a dropped object, and no re-created surviving view missing `security_invoker`.

**Editing `02_functions.sql` regenerates whole functions** in the diff — expected. Function bodies there must match `pg_dump` format exactly (`npx supabase db dump --local --schema public`) or a phantom diff appears on the next story.

### RLS / security

This diff drops RLS policies and grants, so it trips `.claude/rules/security-triggers.md` (database queries/migrations, RLS policies) — a security review is expected.

The concrete risk to test for: the fossil policies were `using (true)` — removing them removes nothing anyone still needs, but **`tasks` must keep its account-scoped policy** and must not lose it when `contact_id` is dropped. Add/confirm a negative test in `supabase/tests/` that a caller in account A cannot see a `tasks` row belonging to account B after the change. (AC-17 covers the target-type rejection; the cross-account read is the RLS-touching half.)

### Sequencing and cross-story overlap

Do the work in the order **schema → migration → types → components → tests → seed/demo data**. The frontend will not type-check until `types.ts` and the two dataProviders are done, so expect a long red window; do not "fix" it with temporary stubs (NFR-14 forbids shims, including temporary ones).

Files that a **later Epic 1 story will also touch** — expect merge overlap:

| File | Also touched by |
|---|---|
| `supabase/schemas/01_tables.sql`, `02_functions.sql`, `05_policies.sql`, `06_grants.sql` | 1.2 (`sales` → `members`), 1.3 (`children` → `singles`), 1.4 (drop `child_portal_tokens`) |
| `supabase/schemas/03_views.sql` | 1.2 (`init_state` reads `sales`), 1.3 (`children_summary`) |
| `src/components/atomic-crm/types.ts` | 1.2 (`Sale`/`SalesFormData`), 1.3 (`Child`/`ChildSummary`), 1.4 (`ChildPortal*`) |
| `providers/supabase/dataProvider.ts`, `providers/fakerest/dataProvider.ts` | 1.2, 1.3, 1.4 |
| `root/CRM.tsx` | 1.3 (`/singles` route), 1.4 (portal), 1.5 (`/tasks` redirect) |
| `englishCrmMessages.ts` / `frenchCrmMessages.ts` | 1.2, 1.3 |
| `e2e/fixtures.ts` | 1.2 (`sales` table + `createSales`) |
| `layout/navItems.test.ts` | 1.5 (route-renders-something check) |

`root/CRM.tsx:272–278` keeps a `/tasks` → `/reminders` redirect. **Leave it** — story 1.5 owns it.

### Scope calls flagged for the dev agent

1. **`misc/ImportPage` + `useImportFromJson` are deleted, not narrowed.** The JSON importer's five top-level types are `sales`, `companies`, `contacts`, `notes`, `tasks` — four of the five die here, and the survivor (`sales`) is renamed by story 1.2. Narrowing it to a sales+tasks importer would leave a fork surface with no shidduchim meaning. If the team would rather keep an importer, say so before starting; the alternative is to strip it and re-target it in Epic 10.
2. **`supabase/functions/mcp/` is edited, not deleted.** It is a live, config-registered surface, but its prompt strings describe the fork's schema and will actively lie after this change. Task D8 fixes strings only — no behaviour change. If the team prefers to defer the MCP rewrite, drop D8 and narrow the AC-14 grep to exclude `supabase/functions/mcp/`.
3. **`providers/fakerest/internal/supabaseAdapter.test.ts`** uses `tags@cs` / `tags` as an arbitrary array-column fixture in a generic filter-adapter test (4 lines). It is not a reference to the `tags` resource. Rename the fixture field to a live array column (`delivery_channels`) so the AC-14 grep stays clean; that is the only reason to touch the file.
4. **Deleting the three e2e specs leaves `e2e/` with `fixtures.ts` and nothing else.** Those specs exercise contacts, companies, tags and contact-bound tasks and cannot be rescued. Epic 2 (onboarding) and Epic 4 (reminders) re-establish e2e coverage. Flagged because it temporarily drops Playwright coverage to zero.
5. **Orphaned-but-not-fossil `misc/` primitives.** Deleting the six directories also orphans `misc/usePapaParse.tsx`, `isLinkedInUrl.ts`, `ActiveFilterButton.tsx`, `AsideSection.tsx`, `InfinitePagination.tsx`, `ResponsiveFilters.tsx`, `RelativeDate.tsx`, `MobileBackButton.tsx`. Recommendation: **delete `usePapaParse.tsx` and `isLinkedInUrl.ts`** (CSV-contact-import and LinkedIn are fork concepts with no shidduchim meaning); **keep the other six** — they carry no fossil vocabulary and AD-24's `EntityList` / `Entity360` will consume them in Epic 3/4. Not covered by any AC either way; call it out in the PR.
6. **`registry.json`** is regenerated, not edited. If `make registry-gen` is not run, the pre-commit hook runs it.

### Testing standards

- `.claude/rules/testing.md`: ≥80 % coverage on new code paths, AAA structure, descriptive test names, no `waitForTimeout`. This story is mostly deletion, so the coverage obligation lands on AC-17's replacement DB assertions and the cross-account `tasks` RLS test.
- Suites: `npm run test:unit:app` (browser/Playwright-backed vitest), `:functions` (Deno edge functions run in Node), `:workers`, `:db` (psql against the local stack — skips itself if the database is unreachable). `make test` runs the first three; run `:db` explicitly.
- Deleting `TaskCreateSheet.test.tsx` and the three e2e specs removes tests — that is intended deletion of tests for deleted behaviour, not a coverage regression, and should be stated in the PR body so story 1.6's zero-suppression gate is not read as violated.

### Project Structure Notes

- Alignment: file layout stays `src/components/atomic-crm/<feature>/`; no new module is introduced by this story. The `<Resource>` registrations in `root/CRM.tsx` already exclude all seven fossils (an earlier partial cleanup), so no `<Resource>` line is removed here — the work is the schema, the orphaned directories and the transitive references.
- Variance to note: `root/CRM.tsx` and `layout/navItems.ts` already *claim* the fork resources are gone while `supabase/schemas/` still declares all seven tables and `providers/` still routes to `contacts_summary` / `companies_summary`. That gap — a UI that pretends the fossils are gone over a schema that keeps them — is exactly the "schema that lies to the next developer" AD-23 prevents, and closing it is this story.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1: Debt Clearance & Entity Truth → Story 1.1: Delete the fossil resources]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-23 — Entities are named for what they hold; the fork's fossils are deleted]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-1 — Tenant isolation is scope + RLS, enforced in Postgres (deny-by-default)]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-13 / Consistency Conventions — polymorphic `tasks`, RLS test suite per table]
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md#NFR-14 — Greenfield standard]
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Constraints — "Greenfield engineering standard" and "Entities are named for what they hold"]
- [Source: _bmad-output/specs/spec-myshadchan/glossary.md#Words we deliberately do not use]
- [Source: AGENTS.md#Database Management — declarative schema in `supabase/schemas/`, generated migrations, `pg_dump` format for `02_functions.sql`]
- [Source: .claude/rules/security-triggers.md — database queries/migrations and RLS policies require a security review]
- [Source: .claude/rules/testing.md — 80 % coverage, AAA, deterministic Playwright waits]
- [Source: .claude/skills/delete-initial-resource/SKILL.md — the in-repo removal playbook: script, dependent-file map, "shapes a resource takes", i18n all-or-nothing rule]
- [Source: MEMORY.md#Supabase CLI D-Bus hang — `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix]

---

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
