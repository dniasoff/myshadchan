## Cross-check findings — Epic 1 (stories 1.1–1.6)

Base: `/home/daniel/repos/myshadchan`, `main` @ `8ad49cb`. Story files under `/home/daniel/repos/myshadchan/_bmad-output/implementation-artifacts/`.

---

### 1. Conflicts (two stories, incompatible changes to the same file/table/route)

**C1 — blocker — `tasks_target_type_check` has no data migration (1.1).**
`/home/daniel/repos/myshadchan/_bmad-output/implementation-artifacts/1-1-delete-fossil-resources.md:35` (AC‑6) and `:76` (A1) narrow the constraint to `('shadchan','shidduch','reference')` and drop `tasks.contact_id`, but specify **no** `update public.tasks …` for existing `target_type='contact'` rows — unlike 1.3, which does exactly that for `private_child` (`1-3-rename-children-to-singles.md:177-179`). Today `/home/daniel/repos/myshadchan/supabase/schemas/01_tables.sql:133,135` still default to `'contact'`, and production carries E1–E7. `ALTER TABLE … ADD CONSTRAINT` validates existing rows, so the deploy-time migration round will fail. **Fix:** add to 1.1 A8 an explicit pre-constraint step (`update public.tasks set target_type='shidduch' where target_type='contact'` or delete the rows), mirroring 1.3's pattern.

**C2 — blocker — `root/CRM.tsx` registration mechanism is replaced by 1.5 but 1.2/1.3 still edit JSX line numbers.**
`1-5-remove-dead-routes.md:47-53` (AC‑5) requires all `<Resource>`/`<Route>` JSX to be replaced by `.map()` over a new `src/components/atomic-crm/root/routeManifest.ts`, and requires `grep -n "<Route path=\|<Resource name=" CRM.tsx` to return only the map lines. But `1-2-rename-sales-to-members.md:108` targets `<Resource name="sales" …>` at `CRM.tsx:290`, and `1-3-rename-children-to-singles.md:215-216` targets `<Resource name="children">` at `CRM.tsx:281,351`. Verified those lines exist today (`/home/daniel/repos/myshadchan/src/components/atomic-crm/root/CRM.tsx:280-291,350-357`) and will not after 1.5. Neither 1.2 nor 1.3 mentions `routeManifest.ts`; only 1.5 asserts the hand-off (`1-5:281-282`). **Fix:** pin the order (see O1) and rewrite 1.2 Task 6 / 1.3 Task 7 to target the manifest.

**C3 — should-fix — `settings/ProfileForm.tsx` + `settings/ProfilePage.tsx`: 1.2 renames, 1.5 deletes.**
`1-2:122` (Task 8) renames symbols at `ProfileForm.tsx` lines 19/35/66‑76/107/178 and `ProfilePage.tsx` 14/27/36/44/81; `1-5:124-127` + AC‑4 (`1-5:43`) delete both files outright. **Fix:** 1.5 owns the deletion; strip both files from 1.2 Task 8 and from its AC‑8 call-site list.

**C4 — should-fix — `tasks/AddTask.tsx`, `tasks/TaskCreateSheet.tsx`, `tasks/TaskCreateSheet.test.tsx`: 1.1 deletes, 1.2 edits.**
1.1 deletes all three (`1-1:106,141`); 1.2 edits `sales_id` inside them (`1-2:123,141`). **Fix:** remove those three from 1.2; keep only `tasks/TasksListByDueDate.tsx:44`, which survives.

**C5 — should-fix — `layout/TopBar.tsx` `ImportFromJsonMenuItem` removed twice.**
1.1 D4 (`1-1:109`) and 1.5 Task 4 (`1-5:122-123`) both remove it plus its import. Same `UserMenu` block, guaranteed merge conflict. **Fix:** 1.5 owns all TopBar menu-item removals.

---

### 2. Double-specification

**D1 — should-fix — the whole `/import` surface is claimed by both 1.1 and 1.5.**
Claimed by 1.1: `misc/ImportPage.tsx`, `misc/useImportFromJson.ts`, `misc/import-sample.json` (`1-1:133`), the `CRM.tsx:268` route + TopBar item (`1-1:109`), and the i18n keys `crm.import` / `crm.header.import_data` (`1-1:47`). Claimed by 1.5: the same files (`1-5:121-123`), the same route/menu item, the same two i18n keys (`1-5:130-131`), plus `/changelog` and `/profile`. **Owner: 1.5** — it removes all three superseded surfaces in one coherent pass. Delete the `/import` bullets from 1.1 AC‑9/AC‑12/D4 and from its 47-file list (making it 44).

**D2 — note — `dashboard/Welcome.tsx`.** 1.1 deletes it as a verified orphan (`1-1:130`); 1.3 lists it in its 68-file rename inventory (`1-3:381`). Verified: zero importers (`grep -rn Welcome src/` finds only unrelated copy strings). **Owner: 1.1.**

**D3 — see G4 —** `is_child_visible_state` is "retained untouched" by 1.4 (`1-4:98-103`) and renamed by 1.3 (`1-3:38-40`). They only agree by accident of ordering; the TS twin is renamed by neither.

---

### 3. Gaps (checked against the codebase, not the stories)

**G1 — blocker — deleting all e2e specs turns the CI `e2e-test` job red, and nobody owns it.**
`/home/daniel/repos/myshadchan/e2e/` holds exactly `bulkContactTags.spec.ts`, `onboarding.spec.ts`, `userAddingATask.spec.ts`, `fixtures.ts`. 1.1 D6 (`1-1:111`) deletes all three specs. `/home/daniel/repos/myshadchan/.github/workflows/check.yml` runs `make test-e2e-ci` → `npx playwright test` (`/home/daniel/repos/myshadchan/makefile:124-126`), and I verified empirically that Playwright exits **1** with `Error: No tests found`. 1.1 only flags the coverage drop (`1-1:218`); 1.6 rebuilds CI (AC‑10, `1-6:282-288`) but never mentions the e2e job. Second-order: `e2e/fixtures.ts` becomes an importer-less orphan that 1.2 still spends 23 renames on (`1-2:139`) and 1.6 adds to the typecheck project (`1-6:225`). **Fix:** add an AC to 1.1 (or 1.6) that either deletes `e2e/` + the `e2e-test` job + `test-e2e*` make targets, or keeps one real smoke spec.

**G2 — blocker — `supabase/tests/*.sql` are outside 1.3's scope but full of `children` / `child_id`.**
`/home/daniel/repos/myshadchan/supabase/tests/shidduch_catch.sql:44-90` and `/home/daniel/repos/myshadchan/supabase/tests/references_entity.sql:63,66,68,618,658,742` insert into `public.children` and `shidduchim.child_id` / `date_records.child_id`. 1.3 Task 10 lists only 9 TypeScript suites (`1-3:269-277`); AC‑11's grep is scoped to `src/ supabase/schemas/ supabase/functions/` (`1-3:89`), and AC‑12's `make test` runs app+functions+workers only. So the rename lands with `npm run test:unit:db` broken and no AC catching it. **Fix:** add both `.sql` suites to 1.3 Task 10 and add `supabase/tests/` to the AC‑11 grep.

**G3 — should-fix — a live `contact_id` assertion in `references_entity.sql` is not covered by 1.1.**
`/home/daniel/repos/myshadchan/supabase/tests/references_entity.sql:222-224` asserts `t.contact_id is null` for the reference task. 1.1 A9 (`1-1:88`) only deletes the legacy block at L236‑247 and rewords comments L6/L212. Dropping `tasks.contact_id` makes L224 error. **Fix:** add L222‑224 to A9.

**G4 — should-fix — the TS symbol `isChildVisibleState` survives all of Epic 1.**
`/home/daniel/repos/myshadchan/src/components/atomic-crm/shidduchim/pipelineStates.ts:142`. 1.4 AC‑8 pins it as retained (`1-4:102-103`); 1.3 renames only the SQL function. After 1.4 deletes `providers/fakerest/internal/childPortal.ts:10,121`, its only non-test caller is gone — dead code carrying a retired name, against AD‑23 ("CI fails on a reference to a retired name") and NFR‑14. It also escapes every verification grep: `\bchild(ren)?\b|child_id|childId` cannot match inside a camelCase compound. Verified the same blind spot hides `ChildSwitcherPill`, `ChildSummary`, `selectedChildId`, `setChildId`, `enrichChildrenSummary`, `ShidduchimNoChildren`, `desktopChildSwitcherStep`. **Fix:** 1.3 renames it `isSingleVisibleState` (+ `pipelineStates.test.ts`); 1.3 AC‑11 and 1.6 AC‑11 add `[A-Za-z]Child|Child[A-Za-z]`.

**G5 — should-fix — `doc/` is orphaned between 1.1 and 1.2.**
17 pages under `/home/daniel/repos/myshadchan/doc/src/content/docs/` carry fork vocabulary, including `developers/atomic-crm-api.mdx`, `users/merging-contacts.mdx` (documents the `merge_contacts` edge function 1.1 deletes), `users/import-data.mdx` (documents `/import`, deleted by 1.5), `developers/custom-fields.mdx`, `developers/data-providers.mdx`, `users/settings.mdx`, `index.mdx`. 1.2 explicitly punts five of them to "1.1 / the documentator" (`1-2:249`), but 1.1 lists `doc/` in **no** AC and **no** task. **Fix:** give 1.1 an explicit AC for `doc/`, or record the deferral in the epic.

**G6 — should-fix — `misc/Markdown.tsx` becomes an orphan nobody deletes, on a wrong rationale.**
Verified consumers: `notes/Note.tsx:24`, `notes/NoteShowPage.tsx:16` (deleted by 1.1) and `misc/ChangelogPage.tsx:6` (deleted by 1.5) → zero after Epic 1. 1.5 §3 keeps it precisely because of those consumers (`1-5:251-252`) — a factual error. Same wrong rationale for `misc/MobileBackButton.tsx` (consumers `notes/NoteShowPage.tsx:17`, `companies/CompanyShow.tsx:31`, `contacts/ContactShow.tsx:34`, `misc/ChangelogPage.tsx:8` — all deleted). **Fix:** 1.5 owns `Markdown.tsx`; reconcile `MobileBackButton` with 1.1's keep-list (`1-1:219`).

**G7 — note — `misc/usePapaParse.tsx` / `misc/isLinkedInUrl.ts` are recommended for deletion by no AC.**
`1-1:219` recommends deleting them but states "Not covered by any AC either way"; `1-5:260` confirms they are 1.1's. A fork-only CSV hook can therefore survive Epic 1. **Fix:** fold into 1.1 AC‑9's enumerated list.

**G8 — note — unowned fork residue:** `.claude/skills/delete-initial-resource/` (flagged only in `1-2:252`), `CHANGELOG.md` (kept as a repo file, `1-5:250`), and the directory name `src/components/atomic-crm/` itself, which 1.6 explicitly freezes (`1-6:551-553`) despite the epic's stated goal "Remove every trace of the Atomic CRM fork". Record as deliberate deferrals.

**G9 — note — off-by-one in 1.1 D6.** `1-1:111` says "remove the 6 fossil tables from `TABLES`"; `/home/daniel/repos/myshadchan/e2e/fixtures.ts:15-22` has 5 fossil tables (`deals, contacts, companies, tags, favicons_excluded_domains`) plus `configuration` (keep) and `sales` (1.2's).

**G10 — note — 1.1 AC‑6 restates an existing invariant.** "`sync_task_target()` … rejects a row with no `target_id`" is already guaranteed by `tasks.target_id bigint not null` (`01_tables.sql:132`).

---

### 4. Ordering hazards

**Declared and mutually consistent (clean):** 1.4 → 1.3 (`1-4:407-412`, `1-3:408-412`); 1.1 → 1.2 (`1-2:241`); 1.6 last (`1-6:216-219`, AC‑1).

**O1 — blocker — 1.5 must precede 1.2 and 1.3, and no story says so.** Consequence of C2. 1.5 assumes it lands first ("1.2 renames the manifest entry", `1-5:281-282`); 1.2 and 1.3 assume the opposite by quoting JSX line numbers. **Fix:** pin `1.1 → 1.4 → 1.5 → 1.3 → 1.2 → 1.6` in the epic (or any order that puts 1.5 before 1.2/1.3), and update the two stories to target `routeManifest.ts`.

**O2 — should-fix — 1.5 must precede 1.2 for `ProfileForm.tsx` / `ProfilePage.tsx`** (C3), otherwise 1.2 renames symbols in files 1.5 immediately deletes.

**O3 — should-fix — 1.2's call-site count is stale under the correct order.** `1-2:37` says 7 call sites, "6 after 1.1". Verified today there are 7 (`sales/SalesEdit.tsx:47`, `sales/SalesCreate.tsx:20`, `settings/ProfileSection.tsx:54,86`, `settings/ProfilePage.tsx:44`, `settings/ProfileForm.tsx:76`, `misc/useImportFromJson.ts:159`); after 1.1 **and** 1.5 only **4** remain.

**O4 — note — 1.4's composite-FK line numbers** (`1-4:82`, `child_portal_tokens_child_id_fkey → children(account_id,id)`) are correct only if 1.4 precedes 1.3. 1.4 offers a fallback (`1-4:410-412`) but the order is only "recommended" — make it binding.

---

### 5. Greenfield violations (NFR‑14)

**Clean part first (negative confirmation):** no story leaves an alias, view, redirect or shim to a renamed entity. 1.1 AC‑2/AC‑16, 1.2 AC‑15, 1.3 AC‑10, 1.4 AC‑12 and 1.5 AC‑1/AC‑4 each forbid it explicitly, and the one live shim in the repo — `/tasks → /reminders` at `CRM.tsx:272-278` — is correctly owned by 1.5 and correctly left alone by 1.1 (`1-1:211`).

**V1 — should-fix — speculative dead code kept on purpose.** 1.1 scope-call #5 (`1-1:219`) keeps six `misc/` primitives — `RelativeDate.tsx`, `ActiveFilterButton.tsx`, `AsideSection.tsx`, `InfinitePagination.tsx`, `ResponsiveFilters.tsx`, `MobileBackButton.tsx` — because "AD‑24's `EntityList` / `Entity360` will consume them in Epic 3/4". I verified every current importer lives in `notes/`, `contacts/`, `companies/` or `activity/`, i.e. all deleted → zero importers after 1.1. Same pattern for `useGetMemberName` (`1-2:111,251`), whose deletion is punted to 1.6 — a story that owns no product-code deletion and whose lint gate will not flag an unused export. **Fix:** delete now, or record an explicit, time-boxed exception in the epic.

**V2 — should-fix —** `is_child_visible_state` retained with zero callers (`1-4:98-100`) — see G4.

**V3 — note —** `1-2:115` offers a fallback to *rename* the dead `update_password` `sales_id` body field instead of deleting it. The primary instruction (delete) is right; the fallback is the violation. Drop it.

**V4 — note (scoping, not a violation) —** the `anon` surface survives Epic 1 by design: 1.2 AC‑6 preserves `init_state` as `security_invoker = off` (`1-2:33`), 1.1 A6 leaves the `alter default privileges … to anon` block (`1-1:82`), 1.4 leaves the fork `to anon` grants to 1.1 (`1-4:353-356`). Correct per AD‑1/Epic 2, but state it in the epic so 1.4 AC‑11 is not read as "anon is closed".

---

### 6. Weak acceptance criteria

**W1 — blocker — 1.1 AC‑14 contradicts its own Dev Notes and cannot pass as written.**
AC‑14 (`1-1:51-58`) requires the fossil-word grep over `src/` to hit "only" 5 allowlisted `shadchanim.contacts` files, "Zero hits anywhere else"; Dev Notes (`1-1:161`) declare `src/components/admin/*.tsx` JSDoc examples "benign and out of scope". Verified: **13 hits across 10 files** under `/home/daniel/repos/myshadchan/src/components/admin/` (`reference-input.tsx`, `array-field.tsx`, `array-input.tsx`, `badge-field.tsx`, `single-field-list.tsx`, `simple-form-iterator.tsx`, `text-array-input.tsx`, `autocomplete-array-input.tsx`, `reference-array-input.tsx`, `reference-array-field.tsx`). **Fix:** put `--exclude-dir=admin --exclude-dir=ui` into the AC's command so the AC text matches the allowlist.

**W2 — should-fix — 1.2 AC‑9: "No translation key resolves through a fallback."** (`1-2:39`) No mechanism, command or test named; not objectively verifiable. **Fix:** replace with a concrete assertion in `providers/commons/i18nProvider.test.ts` (e.g. `resources.members.name` resolves in both catalogs and `resources.sales` is absent from both).

**W3 — should-fix — 1.3 AC‑11's pass condition depends on external state and its regex leaks.** (`1-3:87-100`) "returns no hits outside the token-portal surface that story 1.4 deletes … If story 1.4 has already landed, the command must return zero hits" — the same command has two different correct answers. Its hand-tuned `grep -v` also cannot match camelCase compounds (see G4). **Fix:** make 1.4→1.3 binding so the AC is unconditional, and extend the pattern.

**W4 — should-fix — 1.6 AC‑11's retired-name guard is under-specified and collides with 1.1's allowlist.** (`1-6:290-296`) Its list omits `Child`, `Sale`, `child_id`, `sales_id`, `private_child`, `activity_log`, `merge_contacts`, `contacts_summary` / `companies_summary` / `children_summary`; and `contacts` will fire on the live `shadchanim.contacts` jsonb column that 1.1 AC‑14 allowlists in 5 files, plus the 10 `src/components/admin/` JSDoc files. The story also mandates a unit test for `check-suppressions.mjs` but none for the name guard. **Fix:** make the pattern list + allowlist a single shared artifact referenced by both 1.1 AC‑14 and 1.6 AC‑11, and require a test for it.

**W5 — should-fix — 1.5 AC‑7 "Route inventory is complete and honest".** (`1-5:69-72`) "honest" and "rather than being absent by accident" are not machine-checkable; AC‑6(a‑e) already carries the objective content. **Fix:** reduce to "`surface` is a required, non-optional field on both manifest entry types", or delete AC‑7.

**W6 — note — "prove the assertion bites" leaves no artifact.** 1.5 AC‑6 (`1-5:66-67`) and 1.6 AC‑10 (`1-6:286-288`) both require seeding a violation and reverting it; the proof exists only in the dev transcript. **Fix:** express as a real test over a deliberately-invalid fixture manifest.

**W7 — note — unautomated ACs:** 1.2 AC‑11 "The FakeRest demo boots and lets a user sign in" (`1-2:43`) and 1.1's manual click-through (`1-1:121`) are smoke steps, not verifiable acceptance criteria. Move them into Tasks.

---

### Summary

- **Blockers (5):** C1 (missing `target_type='contact'` data migration), C2/O1 (routeManifest vs 1.2/1.3, and the undeclared order), G1 (e2e specs deleted → CI `e2e-test` job exits 1), G2 (`supabase/tests/*.sql` outside 1.3's scope → db suite breaks silently), W1 (1.1 AC‑14 unpassable as written).
- **Should-fix (14):** C3, C4, C5, D1, G3, G4, G5, G6, O2, O3, V1, V2, W2, W3, W4, W5.
- **Notes (11):** D2, G7, G8, G9, G10, O4, V3, V4, W6, W7.
- **Clean:** no story leaves an alias/view/redirect/shim to a renamed entity — the greenfield rule is correctly and consistently specified across all six; and the three declared orderings (1.4→1.3, 1.1→1.2, 1.6 last) are mutually consistent.