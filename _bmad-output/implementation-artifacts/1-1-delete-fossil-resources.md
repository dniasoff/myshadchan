---
baseline_commit: 36c0098a73828cc94b4d180644dff63ee45e4389
---

# Story 1.1: Delete the fossil resources

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the Atomic CRM fork entities (`contacts`, `companies`, `deals`, `deal_notes`, `contact_notes`, `tags`, `favicons_excluded_domains`) removed entirely — schema, UI, fixtures, generators, types and tests,
so that the codebase contains only concepts that exist in shidduchim and no developer or agent has to guess which "contact" is real.

## Context and vocabulary

AD-23 is explicit: *"The fork's `contacts`, `companies`, `deals`, `deal_notes`, `contact_notes`, `tags` and `favicons_excluded_domains` are **dropped outright** with their UI, fixtures and types — no aliases, views or redirects survive (NFR-14)."*
The glossary lists **"contact", "company", "deal", "lead"** under *"Words we deliberately do not use"*.
NFR-14 (greenfield): no backwards compatibility, no shims, no fallbacks, no aliased views/columns; **when something is replaced the replaced thing is deleted in the same change**.

### Position in Epic 1

Epic 1 runs in a **pinned order: 1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6.** This story is **first**. It depends on no other story; every other Epic 1 story depends on it — 1.4 (drop the child portal), 1.5 (dead routes + `routeManifest.ts`), 1.3 (`children` → `singles`), 1.2 (`sales` → `members`) and 1.6 (CI gates) all assume the fossils are already gone.

**Not in this story:**

- `sales` → `members`, including `set_sales_id_default()` — story **1.2**.
- `children` → `singles`, including every camelCase `child` symbol (`ChildSummary`, `selectedChildId`, `isChildVisibleState`, …) — story **1.3**.
- `child_portal_tokens` / `portal/` / `get_child_portal()` — story **1.4**.
- `/changelog` and `/profile` — story **1.5**, which also owns `settings/ProfileForm.tsx` + `settings/ProfilePage.tsx`, `settings/AboutSection.tsx`, `misc/ChangelogPage.tsx`, `misc/Markdown.tsx`, the `ChangelogMenuItem` / `ProfileMenuItem` entries in `layout/TopBar.tsx`, the `/tasks` → `/reminders` redirect, `root/routeManifest.ts` and the route-renders-something check. **Do not touch `root/CRM.tsx`'s `<Resource>` block or the `/tasks` redirect in this story**, and in `layout/TopBar.tsx` remove **only** `ImportFromJsonMenuItem` (AC-13) — leave the other three menu items to 1.5.
- The zero-warning CI gate, the repo-wide prettier/lint green gate and the replacement e2e smoke spec — story **1.6**.

Leave `sales`, `set_sales_id_default()`, `is_admin()`, `init_state` and `current_account_id()` exactly as they are.

**Owned here, and nowhere else:**

- The **entire `/import` surface** — `misc/ImportPage.tsx`, `misc/useImportFromJson.ts`, `misc/import-sample.json`, the `ImportPage` route + import in `root/CRM.tsx`, the `ImportFromJsonMenuItem` (+ its `ImportPage` import and the `Import` lucide icon) in `layout/TopBar.tsx`, and the `crm.import` / `crm.header.import_data` i18n keys. This story runs **first**, and `misc/useImportFromJson.ts:12-15` imports `Tag` from `../types`, `colors` from `../tags/colors` and `contactGender` from `../contacts/contactModel` — all three deleted here by AC-8/AC-10 — so the surface cannot survive this story under any ownership split. It goes here, whole. (An earlier draft handed it to 1.5; that ruling ignored the pinned order and is superseded.)
- `dashboard/Welcome.tsx` (verified orphan, zero importers — story 1.3 must not list it), `misc/usePapaParse.tsx`, `misc/isLinkedInUrl.ts`.
- The *deletion* of `tasks/AddTask.tsx`, `tasks/TaskCreateSheet.tsx`, `tasks/TaskCreateSheet.test.tsx`, `tasks/TaskCreateSheet.stories.tsx` (story 1.2 must not edit files this story deletes; only `tasks/TasksListByDueDate.tsx` survives for it).

---

## Acceptance Criteria

1. **The seven tables and everything attached to them no longer exist.** `supabase/schemas/01_tables.sql` no longer declares `companies`, `contacts`, `contact_notes`, `deals`, `deal_notes`, `tags`, `favicons_excluded_domains`, their **9 foreign-key constraints** (`companies_sales_id_fkey`, `contacts_company_id_fkey`, `contacts_sales_id_fkey`, `"contactNotes_contact_id_fkey"`, `"contactNotes_sales_id_fkey"`, `deals_company_id_fkey`, `deals_sales_id_fkey`, `"dealNotes_deal_id_fkey"`, `"dealNotes_sales_id_fkey"` — verified by enumeration at `01_tables.sql:157-182`; an earlier draft said 10, which counted `sales_user_id_fkey` by mistake), their **2 legacy PK constraints** (`contactNotes_pkey`, `dealNotes_pkey`) or their **4 FK indexes** (`contact_notes_contact_id_idx`, `contacts_company_id_idx`, `deal_notes_deal_id_idx`, `deals_company_id_idx`). The **7 identity sequences** (`companies_id_seq`, `contacts_id_seq`, `"contactNotes_id_seq"`, `deals_id_seq`, `"dealNotes_id_seq"`, `tags_id_seq`, `favicons_excluded_domains_id_seq`) are gone with them. **`sales_user_id_fkey` (`01_tables.sql:184-185`) survives** — it belongs to `public.sales`, which story 1.2 renames.

2. **The three fossil views are dropped**: `activity_log`, `companies_summary`, `contacts_summary` (`supabase/schemas/03_views.sql` lines 6–128). No replacement view, no alias, no `security_invoker` shell is left behind. `init_state` and every shidduchim-domain view survive untouched.

3. **The 13 fossil triggers and 9 fossil functions are dropped.** Triggers (`04_triggers.sql` lines 7–71): `set_company_sales_id_trigger`, `set_contact_sales_id_trigger`, `set_contact_notes_sales_id_trigger`, `set_deal_sales_id_trigger`, `set_deal_notes_sales_id_trigger`, `company_saved`, `10_lowercase_contact_emails`, `20_contact_saved`, `on_public_contact_notes_created_or_updated`, `on_contact_notes_attachments_updated_delete_note_attachments`, `on_contact_notes_deleted_delete_note_attachments`, `on_deal_notes_attachments_updated_delete_note_attachments`, `on_deal_notes_deleted_delete_note_attachments`. Functions (`02_functions.sql`): `cleanup_note_attachments()`, `get_avatar_for_email(text)`, `get_domain_favicon(text)`, `get_note_attachments_function_url()`, `handle_company_saved()`, `handle_contact_note_created_or_updated()`, `handle_contact_saved()`, `lowercase_email_jsonb()`, `merge_contacts(bigint,bigint)`. **`set_sales_id_default()` survives** — `tasks` still uses it (`set_task_sales_id_trigger`), and story 1.2 renames it.

4. **The 25 fossil RLS policies and their 7 `enable row level security` lines are removed** from `05_policies.sql` (companies 4, contacts 4, contact_notes 4, deals 4, deal_notes 4, tags 4, favicons_excluded_domains 1). The `tasks` policy `"Tasks scoped to account"` and every shidduchim-domain policy survive unchanged.

5. **All 71 fossil grant statements are removed** from `06_grants.sql`, re-counted line by line (an earlier draft said 68 — it missed `tags_id_seq`, and its view range started one line late):
    - **27 function grants** (9 functions × 3 roles): L13–27 (`cleanup_note_attachments`, `get_avatar_for_email`, `get_domain_favicon`, `get_note_attachments_function_url`), L32–42 (`handle_company_saved`, `handle_contact_note_created_or_updated`, `handle_contact_saved`), L56–62 (`lowercase_email_jsonb`, `merge_contacts`).
    - **14 table grants** (7 tables × 2 roles), **not** a contiguous block: L74–75, L77–78, L80–81, L83–84, L86–87, L92–93, L103–104.
    - **9 view grants**: L107–117 (`activity_log`, `companies_summary`, `contacts_summary`) — the block starts at **L107**, not 108.
    - **21 sequence grants** (7 sequences × 3 roles): L124–146 **plus L152–154** (`tags_id_seq`, which sits after `sales_id_seq` and was omitted from the earlier count of 18).

    **Survivors inside those spans, which must not be touched:** `set_sales_id_default()` function grants (L64–66), `sales` (L89–90), `tasks` (L95–96) and `configuration` (L100–101) table grants, `init_state` view grants (L119–121), and `sales_id_seq` (L148–150) / `tasks_id_seq` (L156–158) sequence grants. All are story 1.2's or permanent.

6. **`tasks` is de-fossilised in the same change — column, default, constraint and data.** `tasks.contact_id` (column, `tasks_contact_id_fkey`, the `nb_tasks` join in `contacts_summary`) is dropped. `sync_task_target()` no longer reads or writes `contact_id`. No `contact_id` shim column, no tolerated `'contact'` target type.

    Narrowing `tasks_target_type_check` to `('shadchan','shidduch','reference')` needs **three** things in the **same** migration, in this order, because `ALTER TABLE … ADD CONSTRAINT` validates existing rows and a stale default breaks the next insert:

    a. **Change the column default.** `supabase/schemas/01_tables.sql:133` currently declares `target_type text not null default 'contact'` — verified. It becomes `default 'shidduch'`. This is the load-bearing half: the constraint alone would leave every default-valued insert failing.
    b. **Re-target the data defensively.** `update public.tasks set target_type = 'shidduch' where target_type = 'contact';` — emitted unconditionally, before the constraint is added. Today the live database holds **zero** `'contact'` rows (6 `shidduch`, 2 `reference`), so this is a no-op on the current snapshot; it stays in because the snapshot is not a guarantee and the deploy-time migration round runs against production, not against this snapshot.
    c. **Then** add the narrowed check constraint.

    `db diff` will not generate (b) — add it by hand to the generated migration and re-read the file top to bottom afterwards (AC-19).

7. **`supabase/seed.sql` no longer seeds `favicons_excluded_domains`** (the 103-row INSERT is the entire file; leave the file empty or delete it).

8. **The six fossil frontend directories are deleted in full — 119 files**: `src/components/atomic-crm/contacts/` (48, incl. `__screenshots__/`), `companies/` (15), `deals/` (16), `notes/` (22), `tags/` (9), `activity/` (9).

9. **The 56 further fossil-only files listed in Dev Notes §"Files to delete outside the six directories" are deleted** — 6 orphaned dashboard widgets, 17 `misc/` files (the 14 orphans plus the 3 `/import` files), 6 `providers/commons/` files, 8 fakerest generators, 4 `tasks/` files, `consts.ts`, 2 `test-data/` fixtures, 3 e2e specs, and 9 edge-function files (`merge_contacts/`, `delete_note_attachments/`, `_shared/db.ts`, and the 6 orphaned `postmark/` contact modules). Every one of the 17 `misc/` files has **zero** importers once the six directories and the `/import` route go — verified individually; none is kept "for Epic 3/4".

10. **No fossil type survives in `src/components/atomic-crm/types.ts`**: `Company`, `Contact`, `ContactNote`, `Deal`, `DealNote`, `Tag`, `EmailAndType`, `PhoneNumberAndType`, `DealStage`, `ContactGender`, `NoteStatus`, `ActivityCompanyCreated`, `ActivityContactCreated`, `ActivityContactNoteCreated`, `ActivityDealCreated`, `ActivityDealNoteCreated`, `Activity` are all gone; `Task.contact_id` is gone and `TaskTargetType` is `"shadchan" | "shidduch" | "reference"`. **`Shadchan.contacts?: unknown` stays** — it is the `shadchanim.contacts` jsonb column, not the fossil table.

11. **The fossil configuration props are gone**: `companySectors`, `currency`, `dealCategories`, `dealPipelineStatuses`, `dealStages`, `noteStatuses` are removed from `root/defaultConfiguration.ts`, `root/ConfigurationContext.tsx`, `root/CRM.tsx` (default arg + JSDoc + store seed) and the `src/App.tsx` JSDoc list. `taskTypes`, `title`, `darkModeLogo`, `lightModeLogo`, `googleWorkplaceDomain`, `disableEmailPasswordAuthentication` survive.

12. **Both i18n catalogs are pruned symmetrically.** `resources.companies`, `resources.contacts`, `resources.deals`, `resources.notes`, `resources.tags`, `crm.activity`, `crm.settings.companies`, `crm.dashboard.{deals_chart,deals_pipeline,latest_activity,latest_activity_error,latest_notes,latest_notes_added_ago,stepper,upcoming_tasks}`, the fossil keys inside `resources.tasks` (`fields.contact_id`, `regarding_contact`), and — with the `/import` surface — `crm.import` and `crm.header.import_data` (which empties `crm.header`, so that block goes too) are removed from **both** `englishCrmMessages.ts` and `frenchCrmMessages.ts`. `frenchCrmMessages.ts` is type-checked against the English shape, so a one-sided removal is a `tsc` error.

    **`resources.tasks.empty_list_hint` is *kept and reworded*, not removed** — it is rendered by `tasks/TasksListContent.tsx:11`, a surviving component that story 1.5 promotes to both surfaces, so deleting the key would render a raw key string on the live Tasks list. Its current copy is fossil vocabulary (`"Tasks added to your contacts will appear here."` / `"Les tâches ajoutées à vos contacts apparaîtront ici."`) and would fail AC-14's grep, so both catalogs get shidduchim-domain copy instead (e.g. `"Tasks you add will appear here."` / `"Les tâches que vous ajoutez apparaîtront ici."`). `tasks/TasksListContent.tsx` itself is **not** edited by this story.

13. **No dead route or dead link to a fossil resource remains, and the `/import` surface is gone.** `login/SignupPage.tsx:48` no longer redirects to `/contacts`; `reminders/reminderEntity.ts` no longer maps a `contact` target to `/contacts/:id/show`; `supabase/functions/mcp/taskListUi.ts:93` no longer builds a `/#/contacts/:id/show` URL. The `ImportPage` route and its import are removed from `root/CRM.tsx` (`:31`, `:268`), and `ImportFromJsonMenuItem` — component, `<UserMenu>` usage, its `ImportPage` import and the then-unused `Import` lucide icon — is removed from `layout/TopBar.tsx` (`:6`, `:25`, `:50`, `:171-185`). **Those are the only two edits this story makes to those files**: the `<Resource>` block and the `/tasks` redirect in `CRM.tsx`, and the `ChangelogMenuItem` / `ProfileMenuItem` / `UsersMenuItem` entries in `TopBar.tsx`, all stay for story 1.5.

14. **Verification — repo-wide grep, snake_case and bare fossil words.** After the change,

    ```bash
    grep -rnwE "contacts|contact_notes|contact_id|contact_ids|contactNote|contactNotes|companies|company_id|company_name|companies_summary|contacts_summary|nb_contacts|deals|deal_notes|deal_id|dealNote|dealNotes|nb_deals|tags|favicons_excluded_domains|merge_contacts|activity_log|position_at_company" \
      --exclude-dir=admin --exclude-dir=ui \
      src/ supabase/schemas/ supabase/functions/ supabase/tests/ supabase/seed.sql e2e/
    ```

    returns hits **only** in the documented `shadchanim.contacts` allowlist (Dev Notes §"The `contacts` name collision"): `supabase/schemas/01_tables.sql` (the column declaration), `src/components/atomic-crm/types.ts` (`Shadchan.contacts`), `src/components/atomic-crm/shadchanim/shadchanUtils.ts`, `shadchanUtils.test.ts`, `ShadchanHeader.tsx`. **Zero hits anywhere else** — there is no `/import` carve-out, because this story deletes those three files (AC-9). Baseline today: **150 files** match; all of them are either deleted or edited by this story.

    `--exclude-dir=admin --exclude-dir=ui` is **part of the criterion, not a convenience**: `src/components/admin/` is shadcn-admin-kit framework code whose JSDoc uses `tags` / `companies` / `company_id` as illustrative react-admin resources — **13 matching lines, 14 occurrences, across 10 files** (verified: `array-input`, `array-field`, `reference-array-input`, `reference-array-field`, `text-array-input`, `autocomplete-array-input`, `badge-field`, `single-field-list`, `reference-input`, `simple-form-iterator`) — and is out of scope per Dev Notes. `src/components/ui/` has zero hits today; it is excluded for the same reason (mutable vendored dependency). Without the exclusion the command can never return the allowlist, and the AC is unpassable. `supabase/migrations/` is **excluded** — it is append-only history (see AC-19).

15. **Verification — camelCase compounds of the retired names.** A word-boundary grep cannot match `contactNote`, `processCompanyLogo` or `showContact`, so retired vocabulary can survive AC-14 untouched. After the change,

    ```bash
    grep -rnE "ContactNote|DealNote|contactNote|dealNote|ContactGender|contactGender|DealStage|NoteStatus|noteStatuses|ActivityCompanyCreated|ActivityContactCreated|ActivityContactNoteCreated|ActivityDealCreated|ActivityDealNoteCreated|processCompanyLogo|processContactAvatar|fetchAndUpdateCompanyData|updateCompany|getCompanyAvatar|getContactAvatar|mergeContacts|unarchiveDeal|showContact|selectContact|filterByContact|getContactRepresentation|contactOptionText|buildContact|companySectors|dealCategories|dealPipelineStatuses|dealStages|generateCompanies|generateContacts|generateContactNotes|generateDeals|generateDealNotes|generateTags|getDealsByStage|HotContacts|DealsChart|DashboardActivityLog|useContactImport|createCompany|createContact|createNotes|goToContacts" \
      --include=*.ts --include=*.tsx --exclude-dir=admin --exclude-dir=ui \
      src/ supabase/functions/ e2e/
    ```

    returns **zero hits**. Verified today this pattern hits **444 lines across 94 files** — 46 of them inside the six directories AC-8 deletes, and the other 48 all either deleted or edited by this story (the full list is `e2e/{bulkContactTags,fixtures,userAddingATask}`, `src/App.tsx`, `atomic-crm/{consts.ts,types.ts}`, the 4 orphaned `dashboard/` widgets, `misc/{ContactOption,Status,useImportFromJson}`, the 6 `providers/commons/` files, the 9 `providers/fakerest/dataGenerator/` files, both `dataProvider.ts`, `root/{CRM,ConfigurationContext,defaultConfiguration}`, `shidduchim/boardUtils.ts`, the 10 `tasks/` files, `src/test/StoryWrapper.tsx`, and `supabase/functions/{merge_contacts/index.ts,postmark/addNoteToContact.ts,_shared/db.ts}`). So the AC is passable by doing the story, not by narrowing the pattern. Live shidduchim vocabulary that *looks* similar and must be left alone: `isContacted` / `getCallStatusDescriptor` (`references/callStatus.ts`), `parseContactInfo` / `ShadchanContactInfo` / `hasContactInfo` (`shadchanim/`), `AddNote` / `addNote` / `relationshipNote` / `deliveryNote` / `setNote`, `contacted_count`.

16. **`doc/` is owned, not orphaned.** `doc/src/content/docs/users/merging-contacts.mdx` (documents the `merge_contacts` edge function this story deletes) and `doc/src/content/docs/users/import-data.mdx` (documents the `/import` + contacts-CSV surface this story deletes) are **deleted**, and their two entries are removed from the `Users Documentation` sidebar array in `doc/astro.config.mjs` (`users/import-data`, `users/merging-contacts`). The remaining **18** pages under `doc/src/content/docs/` are **explicitly deferred, not forgotten** — see Dev Notes §"`doc/` — what is deleted and what is deferred". `doc/` is deliberately absent from the AC-14 / AC-15 path lists; that absence is recorded, not accidental.

17. **The e2e surface shrinks to fixtures — it is not dismantled.** `e2e/bulkContactTags.spec.ts`, `e2e/onboarding.spec.ts` and `e2e/userAddingATask.spec.ts` are deleted (they exercise contacts, companies, tags and contact-bound tasks and cannot be rescued). **Everything else survives untouched:** the `e2e/` directory, `e2e/fixtures.ts` (trimmed, see Task D6), `playwright.config.ts`, the `test-e2e` / `test-e2e-ci` / `start-e2e*` / `build-e2e` make targets, and the `e2e-test` job in `.github/workflows/check.yml:97-116`. **Do not delete the job and do not delete `e2e/`.** Story **1.6** lands the single replacement smoke spec (sign in → see the pipeline) on top of the trimmed `fixtures.ts`. Consequence to state in the PR body: between this story and 1.6, `make test-e2e-ci` exits **1** with `Error: No tests found` — see Dev Notes §"Known interim red: the `e2e-test` job".

18. **Green build.** `make typecheck`, `npm run lint` (eslint) and `make test` (`test-app`, `test-functions`, `test-workers`) plus `npm run test:unit:db` all pass **repo-wide** — verified green on `main` today (`tsc` exit 0, `eslint` exit 0), so this story must not break them.

    **Formatting is scoped to this story's own diff.** `npx prettier --config ./.prettierrc.json --check <every file this story creates or modifies>` returns clean. The repo-wide `npm run prettier` / `make lint` gate is **story 1.6's** and cannot be met here: `npm run prettier` fails on **89 files** on `main` today (58 under `src/components/`, plus `.claude/skills/` 12, `supabase/functions/` 7, `_bmad/wds/` 6, `design-artifacts/` 4, and 2 others), the great majority of which this story never touches. Deleting fossil files reduces that number; it does not zero it.

    No `@ts-ignore`, `eslint-disable` or `test.skip` was added to get there — and no stub, `any` or shim either (NFR-14). `npm run registry:gen` regenerates `registry.json` with no fossil paths (it runs on pre-commit).

19. **One new forward migration, no history rewrite.** A single generated migration in `supabase/migrations/` performs the drops, the `tasks.target_type` default change, the defensive `update` (AC-6b) and the narrowed constraint; **no existing migration file is edited**. The new migration contains no `CREATE VIEW … contacts_summary`, no compatibility alias, no `contact_id` column and no re-grant to a dropped object. `npx supabase migration up --local` applies cleanly against a database already carrying the old migrations.

20. **A negative DB test proves the fossil path is closed.** The `references_entity.sql` case *"a legacy contact task still works and back-fills its polymorphic target"* is deleted and replaced by an assertion that `insert into public.tasks (target_type, target_id, text) values ('contact', 1, '…')` is **rejected** by `tasks_target_type_check`, plus an assertion that a task row with no target is still rejected (that one is guaranteed by `tasks.target_id bigint not null`, not by `sync_task_target()` — keep the test, drop the claim). The surviving `contact_id` assertion at `references_entity.sql:224` (`t.contact_id is null`) is rewritten — the column no longer exists, so the statement errors as written. `npm run test:unit:db` passes.

---

## Tasks / Subtasks

### A. Backend — declarative schema first (AC: 1–7, 19)

- [x] **A1. `supabase/schemas/01_tables.sql`** (AC: 1, 6)
  - [x] Delete the `create table` blocks for `companies` (L14–34), `contacts` (L36–54), `contact_notes` (L56–64), `deals` (L66–81), `deal_notes` (L83–91), `tags` (L106–110), `favicons_excluded_domains` (L148–151). **Leave `sales` (L93–102), `tasks` (L119–140) and `configuration` (L142–146) in place.**
  - [x] Delete the **9** fossil FK `alter table` statements at **L157–182** **and** `tasks_contact_id_fkey` at **L187–188**. **Do not delete L184–185 (`sales_user_id_fkey`)** — it sits between the two ranges and belongs to the surviving `sales` table (story 1.2 renames it). An earlier draft gave the range as "L160–185", which both missed the first FK and swept up `sales_user_id_fkey`; the ranges above are verified by line.
  - [x] Delete the 2 legacy PK statements `"contactNotes_pkey"` / `"dealNotes_pkey"` (L190–195, including the `-- Legacy primary key constraint names` comment on L190) and the 4 FK indexes (L201–204, with their `-- Indexes on foreign keys` header at L197–199).
  - [x] In `create table public.tasks`: drop the `contact_id` column; change `target_type text not null default 'contact'` → `default 'shidduch'`; narrow `tasks_target_type_check` to `('shadchan','shidduch','reference')`; rewrite the block comment (it currently explains the legacy contacts UI).
  - [x] Leave `sales`, `tasks`' other columns, `configuration` and every shidduchim table untouched.
- [x] **A2. `supabase/schemas/03_views.sql`** (AC: 2) — delete `activity_log` (L6–72), `companies_summary` (L74–100), `contacts_summary` (L102–128). Leave `init_state` (L130) and everything below it.
- [x] **A3. `supabase/schemas/04_triggers.sql`** (AC: 3) — delete the 13 fossil triggers (L7–71). Keep `set_task_sales_id_trigger` (L27–29) and everything from L73 down.
- [x] **A4. `supabase/schemas/02_functions.sql`** (AC: 3, 6) — delete the 9 fossil functions; rewrite `sync_task_target()` (L1222–1242) to drop every `contact_id` reference (L1227–1233 collapse away) and keep only the "a task needs a target" guard. **Keep the function and its trigger**: the guard is redundant with `tasks.target_id bigint not null`, but `supabase/tests/references_entity.sql:715,728` asserts `sync_task_target` exists with a hardened `search_path`, and its name is not retired vocabulary — dropping it is out of scope here. Verify `purge_polymorphic_dependents()` still compiles (it deletes from `tasks` by `target_type`, no contact coupling).
- [x] **A5. `supabase/schemas/05_policies.sql`** (AC: 4) — delete the 7 `enable row level security` lines (L7–11, 13, 16 — **not** L12 `sales`, L14 `tasks` or L15 `configuration`) and the 25 fossil policies: **L18–46** (companies 4, contacts 4, contact_notes 4, deals 4, deal_notes 4, with their section comments), **L51–55** (tags 4, with its comment) and **L72–73** (favicons_excluded_domains 1, with its comment). **Keep L48–49 — the `-- Sales` comment and `"Enable read access for authenticated users" on public.sales`** — it sits inside the fossil block but belongs to the surviving `sales` table, and story 1.2 moves it onto `public.members`. (An earlier draft gave the range as "L19–55", which would have deleted it.) Reword the `tasks` policy comment at L57–61 that says "while tasks were contacts-only".
- [x] **A6. `supabase/schemas/06_grants.sql`** (AC: 5) — delete the **71** grant lines enumerated in AC-5, working from that list rather than from ranges: three of the four groups interleave surviving grants (`set_sales_id_default`, `sales`, `tasks`, `configuration`, `init_state`, `sales_id_seq`, `tasks_id_seq`), so a range delete drops objects story 1.2 needs. Do **not** touch the `alter default privileges` block starting at L160 (AD-1's anon revocation is Epic 2's job) or the shidduchim REVOKE/GRANT section.
- [x] **A7. `supabase/seed.sql`** (AC: 7) — remove the `favicons_excluded_domains` INSERT.
- [x] **A8. Generate + hand-check the migration** (AC: 6, 19)
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f delete_fossil_resources`
  - [x] Read the generated SQL line by line: confirm it drops (not renames) each object, confirm it does **not** drop/recreate a surviving view without `security_invoker = on`, and confirm it does not emit a `REVOKE` the schema files still declare. `db diff` historically loses `with (security_invoker = on)` and REVOKE statements — fix them by hand in the migration if it does.
  - [x] **Hand-add the AC-6 data step.** `db diff` compares schemas, so it will emit the default change and the constraint but **never** a DML statement. Insert, between the `alter column target_type set default 'shidduch'` and the `add constraint tasks_target_type_check`, the line `update public.tasks set target_type = 'shidduch' where target_type = 'contact';`. Confirm by reading the file that the three statements appear in that order. Without it the migration is one production row away from failing at `ADD CONSTRAINT` validation time.
  - [x] `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. **Never** `db reset` or `db push`.
- [x] **A9. DB test** (AC: 20) — in `supabase/tests/references_entity.sql`:
  - [x] Delete the legacy-contact-task `do $$ … $$` block (L236–247) and add the two rejection assertions.
  - [x] **Fix the live `contact_id` assertion at L222–224.** It currently reads `select 'a task can target a reference with no contact at all', t.contact_id is null and t.account_id = public.current_account_id()` — dropping the column makes that statement error, not fail. Rewrite it as a target-shape assertion, e.g. `t.target_type = 'reference' and t.target_id = :ref1 and t.account_id = public.current_account_id()`, and rename the case to match (the "with no contact at all" phrasing is fossil vocabulary).
  - [x] Reword the L6 and L212 comments that mention contacts (L212's `contacted_count` is a live `references_summary` column — leave the identifier alone, only the prose).
  - [x] Run `npm run test:unit:db`.

### B. Frontend — delete the fossil directories and orphans (AC: 8, 9)

- [x] **B1.** Delete the six directories (AC: 8). The repo ships `.claude/skills/delete-initial-resource/delete-initial-resource.ts` which does exactly this for `contacts companies deals tags` and prints a dependent-file list — use it as a checklist, then delete `notes/` and `activity/` by hand (they are not in the script's resource list).
- [x] **B2.** Delete the 56 further fossil-only files listed in Dev Notes (AC: 9), **including the three `/import` files** `misc/ImportPage.tsx`, `misc/useImportFromJson.ts` and `misc/import-sample.json`. Verify each is an orphan with `LSP findReferences` before deleting; several were confirmed orphaned only once the six directories go. **Do not** delete `misc/Markdown.tsx`, `misc/ChangelogPage.tsx` or `misc/MobileBackButton.tsx` — those three are story 1.5's (and `MobileBackButton.tsx` is kept, see §"Scope calls" item 5).
- [x] **B3.** Delete `supabase/functions/merge_contacts/`, `supabase/functions/delete_note_attachments/`, `supabase/functions/_shared/db.ts`, and the 6 orphaned `postmark/` modules; remove `[functions.merge_contacts]` and `[functions.delete_note_attachments]` from **both** `supabase/config.toml` (L182, L184) and `supabase/config.e2e.toml` (L159, L161).

### C. Frontend — types, config, providers (AC: 10, 11)

- [x] **C1. `src/components/atomic-crm/types.ts`** (AC: 10) — delete the 17 fossil types; narrow `Task` and `TaskTargetType`; **keep `Shadchan.contacts`**; remove the `./consts` import (the whole file goes).
- [x] **C2. `root/defaultConfiguration.ts`, `root/ConfigurationContext.tsx`, `root/CRM.tsx`, `src/App.tsx`** (AC: 11) — remove the 6 fossil config props everywhere they appear (default value, interface field, `CRM` prop default, JSDoc `@param`, store-seed object, App.tsx prop list).
- [x] **C3. `providers/supabase/dataProvider.ts`** (AC: 9, 13) — remove: the fossil type imports (L15, 17, 18), `processCompanyLogo` (L50), the `companies`/`contacts` `getList` + `getOne` routing (L108–113, 149–154), the `activity_log` branch (L128–147), `unarchiveDeal` (L262–288), `mergeContacts` (L290–304), and the `contact_notes` / `deal_notes` / `contacts` / `companies` / `contacts_summary` / `deals` lifecycle-callback blocks (L661–745). Reword the comment at L516 that compares to the contacts merge.
- [x] **C4. `providers/fakerest/dataProvider.ts`** — remove the mirror surface: fossil type imports, `processCompanyLogo`, `processContactAvatar`, `fetchAndUpdateCompanyData`, `updateCompany`, the `activity_log` branch (L494–500), `unarchiveDeal` (L627–651), `mergeContacts` (L738), the fossil `updateMany` block inside clear-demo (L972–1032), and the `contacts` / `companies` / `deals` / `contact_notes` / `deal_notes` callback blocks — **plus the `tasks` callbacks (L1077–1140) that increment/decrement `contacts.nb_tasks`**, which must go entirely, not be rewired.
- [x] **C5. `providers/fakerest/dataGenerator/index.ts` + `types.ts`** — remove the 7 fossil generator calls and the 7 `Db` keys (`companies`, `contacts`, `contact_notes`, `deals`, `deal_notes`, `tags`, plus the `finalize` call). **Set `db.tasks = []` before `generateShidduchimDomain(db)`** — `references.ts:336` reads `db.tasks.length` and `references.ts:350` spreads `db.tasks`, so an undefined `db.tasks` crashes the demo provider.

### D. Frontend — surviving surfaces that must be edited (AC: 12, 13, 16, 17)

- [x] **D1. `tasks/`** (AC: 9, 13) — delete `AddTask.tsx`, `TaskCreateSheet.tsx`, `TaskCreateSheet.test.tsx`, `TaskCreateSheet.stories.tsx`; strip `showContact` / `selectContact` / `filterByContact` and the contact `ReferenceField` / `ReferenceInput` from `Task.tsx`, `TaskEditSheet.tsx`, `TaskFormContent.tsx`, `TasksIterator.tsx`, `TasksListByDueDate.tsx`, `TasksListFilter.tsx`; drop the `contacts: []` fixture from `TasksListFilter.test.tsx`; check `TaskEdit.tsx` still type-checks against the narrowed `TaskFormContent` props.
- [x] **D2. `reminders/`** (AC: 13) — remove the `contact` arm from `RESOURCE_FOR_TARGET`, `TARGET_TYPE_LABEL`, `targetEntityPath()` and `targetEntityLabel()` in `reminderEntity.ts`; remove `"contact"` from `ALL_TARGET_TYPES` and delete the fourth `useGetMany` + its `byType` row in `useReminders.ts`.
- [x] **D3. i18n** (AC: 12) — prune `englishCrmMessages.ts` and `frenchCrmMessages.ts` symmetrically, **including `crm.import` (english 608, french 616) and `crm.header.import_data` (english 599, french 606) — and the `crm.header` block itself, which holds nothing else and is left empty by that removal** (verified: `import_data` is `crm.header`'s only key in both catalogs). **Keep `resources.tasks.empty_list_hint` and reword it** in both catalogs — `tasks/TasksListContent.tsx:11` renders it and survives this epic; its current copy names "contacts" and would fail AC-14. Repoint the `resources.deals.empty.title` assertion in `providers/commons/i18nProvider.test.ts:43` to a surviving French key (e.g. `resources.shidduchim.*`).
- [x] **D4. Routes / shell — including the `/import` surface** (AC: 13)
  - [x] `login/SignupPage.tsx:48` `redirectTo: "/contacts"` → `"/"`.
  - [x] `root/CRM.tsx`: delete the `ImportPage` route (`:268`) and its import (`:31`). **Touch nothing else in that file's route block** — the `<CustomRoutes>` entries for `/profile` and `/changelog`, the `/tasks` → `/reminders` redirect (`:272-278`) and every `<Resource>` line are story 1.5's, which replaces the whole block with a `routeManifest.ts` map.
  - [x] `layout/TopBar.tsx`: delete the `ImportFromJsonMenuItem` component (`:171-185`), its `<UserMenu>` usage (`:50`), its `ImportPage` import (`:25`) and the then-unused `Import` lucide icon (`:6`). **Leave `ChangelogMenuItem`, `ProfileMenuItem` and `UsersMenuItem` alone** — 1.5 removes the first two, 1.2 edits the third. The pinned order makes this a sequential edit to the same `<UserMenu>` block, not a parallel one; 1.5 rebases on top of it.
- [x] **D5. `src/test/StoryWrapper.tsx`** — remove the fossil db keys (`companies`, `contact_notes`, `contacts`, `deal_notes`, `deals`, `tags`) and the `buildContact` builder + `Contact` import.
- [x] **D6. e2e** (AC: 17) — delete `e2e/bulkContactTags.spec.ts`, `e2e/onboarding.spec.ts`, `e2e/userAddingATask.spec.ts`. In `e2e/fixtures.ts` remove the **7** fossil entries from `TABLES` — **L13–19** exactly: `contact_notes`, `deal_notes`, `deals`, `contacts`, `companies`, `tags`, `favicons_excluded_domains`. `tasks` (L12) and `configuration` (L20) stay; `sales` (L21) stays too — story 1.2 renames it, it is not a fossil. (Earlier drafts said "6 fossil tables" and the cross-check said 5; both undercounted by missing `contact_notes` / `deal_notes` — verified count is 7 of the 10 entries.), delete `createNotes` (L93), `createCompany` (L123), `createContact` (L143), their call inside the seed helper (L187) and the `goToContacts` menu helper (L201), and remove the three from the `test.extend` type block (L218–220) and its implementation block (L243–252). **Keep the file, the `e2e/` directory, `playwright.config.ts`, the `test-e2e*` make targets and the CI `e2e-test` job** — story 1.6 lands the replacement smoke spec on top of the trimmed fixtures (`createUser`, `createSales`, `login`, `resetDb`, `menu`, `dismissToast` all survive and are what it needs).
- [x] **D7. Comment / prose sweep** (AC: 14, 15) — `layout/navItems.ts:28`, `layout/navItems.test.ts:16–22` (delete the "excludes the legacy CRM resources" case — it only contains the fossil strings), `settings/SettingsPage.tsx:28`, `misc/EditSheet.tsx:68–72` (JSDoc example uses `resource="contacts"`), `shidduchim/boardUtils.ts:10` ("mirrors getDealsByStage for the deals Kanban"), `providers/fakerest/dataGenerator/shidduchim.ts:291` ("mirrors generateDeals()"), `references/ReferenceMergeButton.tsx:29,33`, `references/ReferenceMergeCollision.tsx:9`, `providers/fakerest/internal/referenceMerge.ts:36`, `supabase/functions/merge_references/index.ts:10,13`, `supabase/functions/postmark/index.ts:78`, `AGENTS.md:163,172`.
- [x] **D8. Edge function `mcp/`** (AC: 13, 14) — rewrite the fossil schema prose in `mcp/index.ts` (L278, 296, 304, 311–314, 354, 365–366, 467) to describe the shidduchim schema; replace the `contact_name` / `contact_id` link in `mcp/taskListUi.ts:93` with the reminder's polymorphic target; rewrite the arbitrary `contacts`/`companies` table names in `mcp/validateSql.test.ts` (25 fixtures) to live tables. Behaviour must not change — these are strings only.
- [x] **D9. `doc/`** (AC: 16) — delete `doc/src/content/docs/users/merging-contacts.mdx` and `doc/src/content/docs/users/import-data.mdx`; remove `"users/import-data"` and `"users/merging-contacts"` from the `Users Documentation` sidebar array in `doc/astro.config.mjs`. Leave the other 18 pages alone (explicitly deferred — Dev Notes). `doc/` has no build step in `make test` / `make typecheck`, so verify by eye that the sidebar array has no dangling entry.

### E. Verify (AC: 14–20)

- [x] **E1.** `npm run registry:gen` (or `make registry-gen`) and confirm `registry.json` has no fossil path (it currently lists `useImportFromJson.ts` at line 409 and `ImportPage.tsx` at 453 — both go here; `Markdown.tsx` at 445 and `ChangelogPage.tsx` at 473 are 1.5's).
- [x] **E2.** `make typecheck` → clean. `npm run lint` (eslint) → clean. Then `npx prettier --config ./.prettierrc.json --check` over **this story's changed files only** → clean (AC-18; the repo-wide prettier gate is 1.6's).
- [x] **E3.** `make test` — `test-app`, `test-functions`, `test-workers` — plus `npm run test:unit:db`.
- [x] **E4.** Run the AC-14 grep and confirm the only hits are the 5 allowlisted `shadchanim.contacts` files.
- [x] **E5.** Run the AC-15 camelCase grep and confirm it returns **zero** hits.
- [x] **E6.** Smoke: run the app against the local stack (`make start`) and click through Dashboard → Pipeline → Inbox → Shadchanim → References → Reminders → Settings; confirm no console error and no 404 from a removed resource. (Smoke step, not an acceptance criterion — AC-18's suites are the gate.)

---

## Dev Notes

### Files to delete outside the six directories (56)

**Dashboard orphans (6)** — all verified to have zero importers once `contacts/` and `companies/` go; the live `Dashboard.tsx` / `MobileDashboard.tsx` import none of them:
`src/components/atomic-crm/dashboard/DashboardActivityLog.tsx`, `DealsChart.tsx`, `HotContacts.tsx`, `DashboardStepper.tsx`, `TasksList.tsx`, `Welcome.tsx`.

`Welcome.tsx` is **this story's**, not 1.3's: `grep -rn "Welcome" src/` returns only unrelated copy strings, so it has zero importers today, independent of the `children` → `singles` rename.

**`misc/` (17)** — the three `/import` files first, then the fossil-named modules, then the primitives that become zero-importer orphans the moment the six directories go. Every entry below was checked individually; none has a surviving importer:

| File | Why it dies |
|---|---|
| `misc/useImportFromJson.ts` | **`/import`, this story's.** `:12` imports `Tag` from `../types` (deleted by AC-10), `:13` imports `colors` from `../tags/colors` and `:15` imports `contactGender` from `../contacts/contactModel` (both directories deleted by AC-8). Its five import types are `sales`, `companies`, `contacts`, `notes`, `tasks` (`:689`) — four are fossils. It cannot compile past this story under any ownership split |
| `misc/ImportPage.tsx` | **`/import`.** Sole consumer of `useImportFromJson`; its route and menu item go with it (AC-13) |
| `misc/import-sample.json` | **`/import`.** The sample payload `ImportPage` links to; a fixture for a deleted importer |
| `misc/ContactOption.tsx` | imports `contacts/Avatar` |
| `misc/Status.tsx` | only fossil importers; its `noteStatuses` config dies with it |
| `misc/attachmentThumbnail.ts` | only `notes/` importers |
| `misc/unsupportedDomains.const.ts` | only `getContactAvatar` uses it |
| `misc/CreateSheet.tsx` | its three importers — `notes/NoteCreateSheet`, `contacts/ContactCreateSheet`, `tasks/TaskCreateSheet` — are all deleted (**`misc/EditSheet.tsx` survives** via `tasks/TaskEditSheet.tsx`) |
| `misc/usePapaParse.tsx` | sole importer `contacts/ContactImportButton.tsx:18`; a CSV-contact-import hook has no shidduchim meaning |
| `misc/isLinkedInUrl.ts` | importers `companies/CompanyInputs.tsx:11`, `contacts/ContactInputs.tsx:21` — both deleted |
| `misc/RelativeDate.tsx` | importers: `notes/Note.tsx:25`, `notes/NoteShowPage.tsx:18`, `notes/NotesIteratorMobile.tsx:14`, `activity/ActivityLog{CompanyCreated,ContactCreated,ContactNoteCreated,DealCreated,DealNoteCreated}.tsx`, `companies/CompanyAside.tsx:15`, `companies/CompanyShow.tsx:32`, `contacts/ContactBackgroundInfo.tsx:9`, `contacts/ContactListContent.tsx:21` — all deleted (this covers `RelativeDate`, `formatRelativeDate` and `formatLocalizedDate`) |
| `misc/ActiveFilterButton.tsx` | sole importer `contacts/ContactListFilter.tsx` (9 uses) |
| `misc/AsideSection.tsx` | importers `contacts/ContactAside.tsx`, `companies/CompanyAside.tsx` |
| `misc/InfinitePagination.tsx` | importers `notes/NotesIterator.tsx:37`, `notes/NotesIteratorMobile.tsx:87`, `activity/ActivityLogIterator.tsx:101`, `contacts/ContactList.tsx:133` |
| `misc/ResponsiveFilters.tsx` | sole importer `contacts/ContactListFilter.tsx:30` |
| `misc/fetchWithTimeout.ts` | importers `providers/commons/getContactAvatar.ts:1` + `getContactAvatar.test.ts:1` — both deleted below |
| `misc/useAppBarHeight.ts` | importers `dashboard/DashboardStepper.tsx:14`, `deals/DealEmpty.tsx:7`, `contacts/ContactEmpty.tsx:7`, `companies/CompanyEmpty.tsx:4` — all deleted |

**Not in this list, deliberately:** `misc/Markdown.tsx` and `misc/ChangelogPage.tsx` (story 1.5 — the `/changelog` surface; `Markdown.tsx` keeps a live importer in `ChangelogPage.tsx:6` until 1.5 lands); `misc/MobileBackButton.tsx` — its last importer is `misc/ChangelogPage.tsx:8,18`, which 1.5 deletes, and 1.5 §3 has ruled that it keeps the file rather than deleting it. Do not delete either here; deleting them would break `ChangelogPage.tsx` two stories early.

**`providers/commons/` (6)**:
`activity.ts`, `getCompanyAvatar.ts`, `getCompanyAvatar.test.ts`, `getContactAvatar.ts`, `getContactAvatar.test.ts`, `mergeContacts.ts`.

**`providers/fakerest/dataGenerator/` (8)**:
`companies.ts`, `contacts.ts`, `contactNotes.ts`, `deals.ts`, `dealNotes.ts`, `tags.ts`, `tasks.ts` (generates 400 contact-bound tasks), `finalize.ts` (sets contact status from the latest contact note).

**`tasks/` (4)**: `AddTask.tsx`, `TaskCreateSheet.tsx`, `TaskCreateSheet.test.tsx`, `TaskCreateSheet.stories.tsx`.

**Root (1)**: `src/components/atomic-crm/consts.ts` (the 5 `*_CREATED` activity constants; nothing else lives in it).

**Fixtures (2)**: `test-data/contacts.csv`, `test-data/import-sample-invalid-sale.json`. Both are `test-data/` files with **zero** code references (verified: only prose in `AGENTS.md:172`, `doc/`, and the `delete-initial-resource` skill mention them). The second is a fixture for the JSON importer, whose whole surface this story deletes (AC-9/AC-13) — it dies with it.

**e2e (3)**: `e2e/bulkContactTags.spec.ts`, `e2e/onboarding.spec.ts`, `e2e/userAddingATask.spec.ts` — **the specs only.** `e2e/fixtures.ts` is edited, not deleted (Task D6), and the directory, `playwright.config.ts`, the make targets and the CI job all stay (AC-17).

**Edge functions (9)**: `supabase/functions/merge_contacts/index.ts`, `supabase/functions/_shared/db.ts` (Kysely types; **only** `merge_contacts` imports it), `supabase/functions/delete_note_attachments/index.ts` (its only callers were the four `cleanup_note_attachments` triggers), and the orphaned `postmark/` modules `addNoteToContact.ts`, `addNoteToContact.test.ts`, `extractMailContactData.ts`, `extractMailContactData.test.ts`, `getNoteContent.ts`, `mailProvider.const.ts` — `postmark/index.ts:78` already records that legacy contact/note creation is retired and imports none of them.

### The `contacts` name collision — do not touch

`shadchanim.contacts jsonb` (`supabase/schemas/01_tables.sql:300`) is a **live column on a live table** holding a shadchan's phone/email/whatsapp. It has nothing to do with the fossil `contacts` table. These 5 files legitimately keep the word and are the AC-14 allowlist:

- `supabase/schemas/01_tables.sql` — the column declaration
- `src/components/atomic-crm/types.ts` — `Shadchan.contacts?: unknown`
- `src/components/atomic-crm/shadchanim/shadchanUtils.ts` — `parseContactInfo()`
- `src/components/atomic-crm/shadchanim/shadchanUtils.test.ts`
- `src/components/atomic-crm/shadchanim/ShadchanHeader.tsx`

Also benign and out of scope: `src/components/admin/*.tsx` JSDoc examples that use `tags` / `companies` / `company_id` as illustrative react-admin resources — **13 matching lines / 14 occurrences across 10 files**, verified today (`array-input.tsx:20`, `array-field.tsx:28,29`, `reference-array-input.tsx:28`, `reference-array-field.tsx:33`, `text-array-input.tsx:27,41`, `autocomplete-array-input.tsx:51,58`, `badge-field.tsx:13`, `single-field-list.tsx:31`, `reference-input.tsx:22` (two occurrences on one line), `simple-form-iterator.tsx:272`) — that is shadcn-admin-kit framework documentation, not this app's schema. `src/components/ui/` has **zero** hits today and is excluded on the same grounds. Both are `--exclude-dir`'d in AC-14/AC-15 so the AC text and this allowlist agree; earlier drafts said "zero hits anywhere else" while exempting `admin/` in prose, which made the AC unpassable as written. Also benign: `billing/BillingPage.tsx:158` ("Contact us"); `references_summary.contacted_count` and `src/index.css` "companion" (substrings, not word matches).

### Files that survive but must be edited (35 in `src/`, 13 entries elsewhere)

Frontend: `src/App.tsx`, `types.ts`, `root/CRM.tsx`, `root/defaultConfiguration.ts`, `root/ConfigurationContext.tsx`, `layout/TopBar.tsx`, `layout/navItems.ts`, `layout/navItems.test.ts`, `login/SignupPage.tsx`, `settings/SettingsPage.tsx`, `misc/EditSheet.tsx`, `providers/supabase/dataProvider.ts`, `providers/fakerest/dataProvider.ts`, `providers/fakerest/dataGenerator/index.ts`, `providers/fakerest/dataGenerator/types.ts`, `providers/fakerest/dataGenerator/shidduchim.ts`, `providers/fakerest/internal/referenceMerge.ts`, `providers/fakerest/internal/supabaseAdapter.test.ts`, `providers/commons/englishCrmMessages.ts`, `providers/commons/frenchCrmMessages.ts`, `providers/commons/i18nProvider.test.ts`, `reminders/reminderEntity.ts`, `reminders/useReminders.ts`, `references/ReferenceMergeButton.tsx`, `references/ReferenceMergeCollision.tsx`, `shidduchim/boardUtils.ts`, `tasks/Task.tsx`, `tasks/TaskEdit.tsx`, `tasks/TaskEditSheet.tsx`, `tasks/TaskFormContent.tsx`, `tasks/TasksIterator.tsx`, `tasks/TasksListByDueDate.tsx`, `tasks/TasksListFilter.tsx`, `tasks/TasksListFilter.test.tsx`, `src/test/StoryWrapper.tsx`.

`layout/TopBar.tsx` is on this list for **exactly one** removal — `ImportFromJsonMenuItem` and its two now-unused imports (AC-13). Story 1.5 owns the other three menu items in that `<UserMenu>` block. `root/CRM.tsx` is on the list for the config-prop cleanup (AC-11) **and** the `ImportPage` route + import (AC-13); its `<Resource>` block and the `/tasks` redirect are 1.5's.

Elsewhere: `supabase/schemas/{01..06}.sql`, `supabase/seed.sql`, `supabase/config.toml`, `supabase/config.e2e.toml`, `supabase/tests/references_entity.sql`, `supabase/functions/mcp/{index.ts,taskListUi.ts,validateSql.test.ts}`, `supabase/functions/merge_references/index.ts` (comments), `supabase/functions/postmark/index.ts` (comment), `e2e/fixtures.ts`, `AGENTS.md`, `doc/astro.config.mjs` (sidebar entries, AC-16).

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

The concrete risk to test for: the fossil policies were `using (true)` — removing them removes nothing anyone still needs, but **`tasks` must keep its account-scoped policy** and must not lose it when `contact_id` is dropped. Add/confirm a negative test in `supabase/tests/` that a caller in account A cannot see a `tasks` row belonging to account B after the change. (AC-20 covers the target-type rejection; the cross-account read is the RLS-touching half.)

Second risk, specific to AC-6: the `update public.tasks set target_type = 'shidduch' where target_type = 'contact'` step runs as the migration role and bypasses RLS. That is correct and intended (it is a schema-repair step, not an application write), but it means the statement must not be copied into any application code path — it belongs in the migration file and nowhere else.

### Sequencing and cross-story overlap

Do the work in the order **schema → migration → types → components → tests → seed/demo data**. The frontend will not type-check until `types.ts` and the two dataProviders are done, so expect a long red window; do not "fix" it with temporary stubs (NFR-14 forbids shims, including temporary ones).

Files that a **later Epic 1 story will also touch** — expect merge overlap. Order is pinned **1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6**, so every row below is "someone edits this *after* you":

| File | Also touched by |
|---|---|
| `supabase/schemas/01_tables.sql`, `02_functions.sql`, `05_policies.sql`, `06_grants.sql` | 1.4 (drop `child_portal_tokens`), 1.3 (`children` → `singles`), 1.2 (`sales` → `members`) |
| `supabase/schemas/03_views.sql` | 1.3 (`children_summary`), 1.2 (`init_state` reads `sales`) |
| `src/components/atomic-crm/types.ts` | 1.4 (`ChildPortal*`), 1.3 (`Child`/`ChildSummary`), 1.2 (`Sale`/`SalesFormData`) |
| `providers/supabase/dataProvider.ts`, `providers/fakerest/dataProvider.ts` | 1.4, 1.3, 1.2 |
| `root/CRM.tsx` | 1.5 (replaces the whole `<Resource>`/`<Route>` block with a `routeManifest.ts` map, and owns the `/profile` + `/changelog` routes and the `/tasks` redirect), then 1.3 / 1.2 via the manifest |
| `layout/TopBar.tsx` | 1.5 (`ChangelogMenuItem`, `ProfileMenuItem`), 1.3 (`ChildSwitcherPill`), 1.2 (`UsersMenuItem`) — you remove **only** `ImportFromJsonMenuItem` |
| `englishCrmMessages.ts` / `frenchCrmMessages.ts` | 1.5 (`crm.changelog`, `crm.profile.inbound/mcp`), 1.3, 1.2 |
| `e2e/fixtures.ts` | 1.2 (`sales` table + `createSales`), 1.6 (the replacement smoke spec consumes it) |
| `layout/navItems.test.ts` | 1.5 (route-renders-something check) |
| `supabase/tests/references_entity.sql` | 1.3 (`children` / `child_id` inserts) |

`root/CRM.tsx:272–278` keeps a `/tasks` → `/reminders` redirect. **Leave it** — story 1.5 owns it.

### Why the `/import` surface is this story's — settled, do not re-litigate

An earlier draft handed the whole `/import` surface to story 1.5. That ruling was made without reference to the pinned order and is **superseded**: with 1.1 first and 1.5 third, `misc/useImportFromJson.ts` cannot compile for the two stories in between, because it imports three things this story deletes:

```
misc/useImportFromJson.ts:12  import type { RAFile, Tag } from "../types";   → Tag is deleted by AC-10
misc/useImportFromJson.ts:13  import { colors } from "../tags/colors";       → tags/ is deleted by AC-8
misc/useImportFromJson.ts:15  import { contactGender } from "../contacts/contactModel"; → contacts/ is deleted by AC-8
```

`tsconfig.app.json` includes all of `src`, so leaving the file behind makes `make typecheck` red from the end of this story until 1.5 lands — contradicting AC-18, with no legal repair available (NFR-14 forbids a stub, an `any` or a `@ts-ignore`, and narrowing the importer to its one surviving type was rejected in §"Scope calls" item 1).

The surface therefore moves **whole** into this story: the three files (AC-9), the route and its import in `root/CRM.tsx`, the `ImportFromJsonMenuItem` in `layout/TopBar.tsx` (AC-13), and the `crm.import` / `crm.header.import_data` keys (AC-12). Nothing about `/import` is left for 1.5, and there is no open decision here — start work.

The one consequence to respect: `layout/TopBar.tsx`'s `<UserMenu>` block is now edited by this story **and** by 1.5. Under the pinned order that is a sequential edit, not a concurrent one — you remove one menu item and 1.5 rebases on the result. Do not remove any of the other three while you are in the file (C5's concern was two stories racing on the same block, which the pinned order already resolves).

### `doc/` — what is deleted and what is deferred

Verified today: the `doc/` tree is 20 Starlight pages, and **all 20** are upstream Atomic CRM documentation (title `Atomic CRM`, base path `/atomic-crm/doc/`, marmelab logos, marmelab Umami analytics, a GitHub link to `marmelab/atomic-crm`). 14 of them match the AC-14 fossil pattern.

**Deleted here (AC-16), because their entire subject is a surface that dies inside this epic:**

- `doc/src/content/docs/users/merging-contacts.mdx` — documents `merge_contacts`, the edge function this story deletes.
- `doc/src/content/docs/users/import-data.mdx` — documents `/import` and the contacts CSV import. Both surfaces die in this story (the `/import` route and `useImportFromJson` under AC-9/AC-13, the CSV path with `contacts/` and `misc/usePapaParse.tsx` under AC-8/AC-9), so the page goes with them.

**Explicitly deferred, with the reason recorded (this is a deferral, not an oversight):** the other 18 pages — `developers/{agent-harness,architecture-choices,atomic-crm-api,custom-fields,customizing,data-providers,deploy,google-oauth,inbound-email-configuration,migrations,sso,supabase-configuration}.mdx`, `users/{user-management,settings,inbound-email,mobile-app,mcp-server}.mdx`, `index.mdx`. Rewriting them is a **rebrand of the whole documentation site**, not a fossil-deletion task: it needs a product name, a logo, a base path and an owner, none of which Epic 1 decides. This sits with the same deferral bucket as the `src/components/atomic-crm/` directory name (which story 1.6 freezes explicitly). `doc/` is therefore deliberately **absent** from the AC-14 and AC-15 path lists — recorded here so no reviewer reads that absence as an accident.

### Known interim red: the `e2e-test` job

This story deletes the last three Playwright specs; story 1.6 lands the replacement smoke spec. Between the two — i.e. across 1.4, 1.5, 1.3 and 1.2 — `make test-e2e-ci` runs `npx playwright test` against an empty spec set, which exits **1** with `Error: No tests found` (verified empirically). The `e2e-test` job in `.github/workflows/check.yml:97-116` has no `if:` guard and no `--pass-with-no-tests`, so it will be red for four stories.

That is a known, accepted consequence of the pinned order, **not** a licence to delete the job, the directory or the make targets (AC-17 forbids all three) and **not** a reason to leave a fossil spec alive. State it in the PR body. If the epic owner would rather keep CI green throughout, the fix is to move 1.6's smoke spec forward into this story — raise it, do not improvise it.

### Scope calls flagged for the dev agent

1. **The `/import` surface is deleted whole here — narrowing it is not an option.** The JSON importer's five top-level types are `sales`, `companies`, `contacts`, `notes`, `tasks` (`useImportFromJson.ts:689`); four of the five die in this story and the survivor (`sales`) is renamed by 1.2, so a "narrowed" importer would be a fork surface with no shidduchim meaning, and no SPEC capability covers JSON import (CAP-1 capture is share / email / manual upload into the inbox; AD-15 is *export*). Delete the files, the route, the menu item and the two i18n keys in one pass — see §"Why the `/import` surface is this story's".
2. **`supabase/functions/mcp/` is edited, not deleted.** It is a live, config-registered surface, but its prompt strings describe the fork's schema and will actively lie after this change. Task D8 fixes strings only — no behaviour change. If the team prefers to defer the MCP rewrite, drop D8 and narrow the AC-14 grep to exclude `supabase/functions/mcp/`.
3. **`providers/fakerest/internal/supabaseAdapter.test.ts`** uses `tags@cs` / `tags` as an arbitrary array-column fixture in a generic filter-adapter test (4 lines). It is not a reference to the `tags` resource. Rename the fixture field to a live array column (`delivery_channels`) so the AC-14 grep stays clean; that is the only reason to touch the file.
4. **Deleting the three e2e specs leaves `e2e/` with `fixtures.ts` and nothing else — and that is the intended end state for this story.** Those specs exercise contacts, companies, tags and contact-bound tasks and cannot be rescued. `e2e/`, `fixtures.ts`, `playwright.config.ts`, the make targets and the CI `e2e-test` job all stay (AC-17); story 1.6 lands one real smoke spec (sign in → see the pipeline) on the trimmed fixtures, and Epic 2 / Epic 4 grow coverage from there. The interim red is documented in §"Known interim red".
5. **Orphaned-but-not-fossil `misc/` primitives — deleted now, not kept for later.** Deleting the six directories orphans `usePapaParse.tsx`, `isLinkedInUrl.ts`, `RelativeDate.tsx`, `ActiveFilterButton.tsx`, `AsideSection.tsx`, `InfinitePagination.tsx`, `ResponsiveFilters.tsx`, `fetchWithTimeout.ts` and `useAppBarHeight.ts` — **nine** files, every importer verified to live in a deleted directory (see the `misc/` table above). An earlier draft kept six of them on the grounds that AD-24's `EntityList` / `Entity360` "will consume them in Epic 3/4". That is speculative retention of zero-importer code and NFR-14 forbids it: *when something is replaced the replaced thing is deleted in the same change*. Epic 3/4 can restore any of them from git history in one command, against a real requirement, instead of inheriting nine unused modules whose props were shaped by the fork's contact list. All nine are in the AC-9 list.

    The single exception is `misc/MobileBackButton.tsx`, which also ends Epic 1 with zero importers: it still has a live importer at *this* story's boundary (`misc/ChangelogPage.tsx:8,18`), and story 1.5 — which deletes that importer — has ruled that it keeps the file. Leave it alone here; the exception is 1.5's to justify, not this story's to pre-empt.
6. **`registry.json`** is regenerated, not edited. If `make registry-gen` is not run, the pre-commit hook runs it.

### Testing standards

- `.claude/rules/testing.md`: ≥80 % coverage on new code paths, AAA structure, descriptive test names, no `waitForTimeout`. This story is mostly deletion, so the coverage obligation lands on AC-20's replacement DB assertions (including the rewritten `references_entity.sql:222–224` case) and the cross-account `tasks` RLS test.
- Suites: `npm run test:unit:app` (browser/Playwright-backed vitest), `:functions` (Deno edge functions run in Node), `:workers`, `:db` (psql against the local stack — skips itself if the database is unreachable). `make test` runs the first three; run `:db` explicitly.
- Deleting `TaskCreateSheet.test.tsx`, `getCompanyAvatar.test.ts`, `getContactAvatar.test.ts`, the `postmark/` contact test modules and the three e2e specs removes tests — that is intended deletion of tests for deleted behaviour, not a coverage regression, and should be stated in the PR body so story 1.6's zero-suppression gate is not read as violated. The e2e count going to zero is covered by AC-17 and §"Known interim red".

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
- [Source: _bmad-output/implementation-artifacts/EPIC1-CROSSCHECK.md — findings applied to this story: C1 (AC-6 data migration), C4 (task-file ownership), C5 (TopBar — resolved by the pinned order; this story removes only `ImportFromJsonMenuItem`), **D1 — reversed: the `/import` surface is this story's, not 1.5's, because 1.1 runs first and deletes `useImportFromJson.ts`'s three imports** (see §"Why the `/import` surface is this story's"), D2 (`Welcome.tsx` → 1.1), G1 (e2e job survives), G3 (`references_entity.sql:222–224`), G5 (`doc/`), G7 (`usePapaParse` / `isLinkedInUrl`), G9 (`e2e/fixtures.ts` table count), G10 (redundant `target_id` claim), V1 (no speculative retention), W1 (AC-14 `--exclude-dir`), and the pinned order 1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6]

---

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `db diff` regenerated `references_summary` (drop+recreate) even though its
  SELECT text was unchanged — the drop lost its `select`/`all` grants and the
  privilege set fell back to the schema's blanket `alter default privileges …
  grant all on tables to anon` rule. Hand-added
  `revoke all … from anon, authenticated; grant select … to authenticated;
  grant all … to service_role;` for `references_summary` into the generated
  migration and verified live grants after apply (`information_schema.role_table_grants`).
  `with (security_invoker = on)` was also missing from the regenerated
  `create or replace view` and was hand-added.
- `db diff` did not emit the AC-6(b) data-repair step (`update public.tasks
  set target_type = 'shidduch' where target_type = 'contact'`); inserted it by
  hand between the default change and the narrowed constraint, per the story's
  explicit instruction.
- Deleting `misc/useImportFromJson.ts` (AC-9) removed the only import of
  `papaparse`, whose `@types/papaparse` typings carry `/// <reference
  types="node" />`. That was the *only* path by which `@types/node`'s ambient
  `process` global reached the "app" TypeScript program, so several unrelated
  surviving files (`src/components/admin/*.tsx`, `root/CRM.tsx`,
  `src/components/supabase/set-password-page.tsx`) broke with `Cannot find
  name 'process'` the moment the file was removed. Fixed by adding `"node"`
  explicitly to `tsconfig.app.json`'s `types` array (`@types/node` was already
  a devDependency) instead of depending on an accidental transitive import.
  Verified against a clean worktree checkout of the pre-story commit to
  confirm the regression was real and not pre-existing.
- `make registry-gen`, `npx vite build`, and a brief `vite` dev-server boot
  (curl 200 on `/`) were run as additional smoke checks beyond the story's
  required gates.

### Completion Notes List

- All 20 ACs satisfied; the story's own "Done" proving command for 1.1 passes
  verbatim: `make typecheck && npm run lint && make test && npm run
  test:unit:db && <AC-15-family zero-hit grep>`.
- AC-5's "71 fossil grants" count reproduced exactly as enumerated (27 + 14 +
  9 + 21).
- AC-14 baseline reproduced at **150 files** as stated; AC-15 baseline
  reproduced at **444 lines / 94 files** as stated. Both greps return the
  documented allowlist / zero hits after the change.
- One AC-19 risk materialized for real (not just a documented risk): `db
  diff`'s drop+recreate of `references_summary` silently dropped its grants.
  Caught by reading the migration top-to-bottom as instructed, fixed by hand
  in both the live local DB and the migration file, and reverified via
  `information_schema.role_table_grants` and a second `db diff` (`No schema
  changes found`).
- Local DB was already at migration `20260726214835_secure_attachments_bucket.sql`
  (matches the build plan's precondition #2), so the storage-security delta
  did not fold into this story's diff. Post-migration assertions confirmed:
  `pg_policies` count for `storage.objects` "Attachments%" = 3,
  `storage.buckets.public` for `attachments` = false.
- Collateral cleanup beyond the story's literal enumeration, all directly
  caused by the mandated deletions and required to keep the build green /
  AC-14 clean, not independent scope decisions: removed the now-orphaned
  `AttachmentNote` type (its only two users, `ContactNote`/`DealNote`, are
  both deleted); removed dead `TASK_MARKED_AS_DONE/UNDONE/DONE_NOT_CHANGED`
  constants and `preserveAttachmentMimeType` in the FakeRest provider (their
  only call sites were the deleted `tasks`/`contact_notes`/`deal_notes`
  lifecycle callbacks); reworded four schema/type comments that still named
  "contacts"/"deals" in prose (`02_functions.sql`, `03_views.sql` ×2,
  `01_tables.sql`, `04_triggers.sql`, `types.ts`) after AC-14/15 flagged them
  live against the real tree; rewrote `supabase/functions/mcp/{index.ts,
  taskListUi.ts}` (Task D8) to replace the `contact_name`/`contact_id` MCP
  task-list link with the reminder's polymorphic `target_type`/`target_id`/
  `target_label` shape; renamed the `tags@cs` fixture in
  `supabaseAdapter.test.ts` to `delivery_channels@cs` (Dev Notes scope call
  #3); rewrote `mcp/validateSql.test.ts`'s 25 arbitrary-table fixtures from
  `contacts`/`companies` to `shidduchim`/`shadchanim` (Task D8); updated
  `AGENTS.md`'s directory tree, `<CRM>` prop list, "Adding Custom Fields"
  section, and removed its now-false "Running with Test Data" section (the
  referenced CSV and Import button are both gone). `crm.settings.deals` /
  `crm.settings.companies` and the "in_use" validation string in both i18n
  catalogs were removed/reworded because they are dead, zero-caller keys
  (verified by grep) whose literal names/prose fail the AC-14 grep — not
  independently decided to prune; `crm.settings.notes` and
  `crm.settings.tasks` were left alone (dead but do not contain a forbidden
  word, and are outside the story's explicit AC-12 list).
- Some claims in the story did not need re-verification beyond what a normal
  implementation pass already confirms (line numbers, counts) — all matched
  the tree as stated; no story claim was found stale against `main` at
  `36c0098`.

### File List

**Schema (edited):** `supabase/schemas/01_tables.sql`, `02_functions.sql`,
`03_views.sql`, `04_triggers.sql`, `05_policies.sql`, `06_grants.sql`;
`supabase/seed.sql` (emptied); `supabase/tests/references_entity.sql`.

**Migration (new):** `supabase/migrations/20260727091141_delete_fossil_resources.sql`.

**Config:** `supabase/config.toml`, `supabase/config.e2e.toml` (removed
`merge_contacts`/`delete_note_attachments` function entries); `tsconfig.app.json`
(added `"node"` to `types`).

**Deleted directories (119 files):** `src/components/atomic-crm/{contacts,companies,deals,notes,tags,activity}/`.

**Deleted files (58):** 6 dashboard orphans (`DashboardActivityLog.tsx`,
`DealsChart.tsx`, `HotContacts.tsx`, `DashboardStepper.tsx`, `TasksList.tsx`,
`Welcome.tsx`); 17 `misc/` files (`useImportFromJson.ts`, `ImportPage.tsx`,
`import-sample.json`, `ContactOption.tsx`, `Status.tsx`,
`attachmentThumbnail.ts`, `unsupportedDomains.const.ts`, `CreateSheet.tsx`,
`usePapaParse.tsx`, `isLinkedInUrl.ts`, `RelativeDate.tsx`,
`ActiveFilterButton.tsx`, `AsideSection.tsx`, `InfinitePagination.tsx`,
`ResponsiveFilters.tsx`, `fetchWithTimeout.ts`, `useAppBarHeight.ts`); 6
`providers/commons/` files (`activity.ts`, `getCompanyAvatar.ts`,
`getCompanyAvatar.test.ts`, `getContactAvatar.ts`, `getContactAvatar.test.ts`,
`mergeContacts.ts`); 8 `providers/fakerest/dataGenerator/` files
(`companies.ts`, `contacts.ts`, `contactNotes.ts`, `deals.ts`, `dealNotes.ts`,
`tags.ts`, `tasks.ts`, `finalize.ts`); 4 `tasks/` files (`AddTask.tsx`,
`TaskCreateSheet.tsx`, `TaskCreateSheet.test.tsx`,
`TaskCreateSheet.stories.tsx`); `consts.ts`; 2 `test-data/` fixtures
(`contacts.csv`, `import-sample-invalid-sale.json`); 3 e2e specs
(`bulkContactTags.spec.ts`, `onboarding.spec.ts`, `userAddingATask.spec.ts`);
9 edge-function files (`merge_contacts/index.ts`,
`delete_note_attachments/index.ts`, `_shared/db.ts`,
`postmark/{addNoteToContact.ts,addNoteToContact.test.ts,extractMailContactData.ts,extractMailContactData.test.ts,getNoteContent.ts,mailProvider.const.ts}`);
2 `doc/` pages (`users/merging-contacts.mdx`, `users/import-data.mdx`).

**Frontend (edited):** `src/App.tsx`, `types.ts`,
`root/{CRM.tsx,ConfigurationContext.tsx,defaultConfiguration.ts}`,
`layout/{TopBar.tsx,navItems.ts,navItems.test.ts}`, `login/SignupPage.tsx`,
`settings/SettingsPage.tsx`, `misc/EditSheet.tsx`,
`providers/supabase/dataProvider.ts`, `providers/fakerest/dataProvider.ts`,
`providers/fakerest/dataGenerator/{index.ts,types.ts,shidduchim.ts}`,
`providers/fakerest/internal/supabaseAdapter.test.ts`,
`providers/commons/{englishCrmMessages.ts,frenchCrmMessages.ts,i18nProvider.test.ts}`,
`reminders/{reminderEntity.ts,useReminders.ts}`,
`references/{ReferenceMergeButton.tsx,ReferenceMergeCollision.tsx}`,
`shidduchim/boardUtils.ts`,
`tasks/{Task.tsx,TaskEditSheet.tsx,TaskFormContent.tsx,TasksIterator.tsx,TasksListByDueDate.tsx,TasksListFilter.tsx,TasksListFilter.test.tsx}`,
`src/test/StoryWrapper.tsx`.

**Elsewhere (edited):** `supabase/functions/mcp/{index.ts,taskListUi.ts,validateSql.test.ts}`,
`supabase/functions/merge_references/index.ts`,
`supabase/functions/postmark/index.ts`, `e2e/fixtures.ts`, `AGENTS.md`,
`doc/astro.config.mjs`, `registry.json` (regenerated).
