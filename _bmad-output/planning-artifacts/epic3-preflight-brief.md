# Epic 3 — "The 360° Framework": pre-flight brief

> **Archived analysis.** This is a point-in-time document anchored to `main` @ `88216f4`; it is
> not maintained against `main`. Treat any line number that no longer resolves as expected
> drift, not as an authoritative anchor — re-read the cited file. The findings, the §4 API
> contract and especially §7 ("Not problems") remain load-bearing. Where this file and an Epic 3
> story file disagree on a line number, **the story file wins**. (The `04_triggers.sql` anchors
> below were corrected to `main` after archival; every other citation is as-written at `88216f4`.)

Anchored to `main` @ `88216f4` (`tests: add cross-context RLS negative coverage…`). `main` is
moving; line numbers may drift ±2. Every claim below was read directly, not inferred.
`src/components/atomic-crm/entity360/` **does not exist** — nothing in Epic 3 is built.
Audience: the agents that will refresh the 9 stories, then build them.

---

## 0. Read this first — cross-cutting facts every story gets wrong

These are wrong in **all or most of** the 9 stories. Fix once, globally, in the refresh pass.

| Fact | Truth on `main` |
|---|---|
| `ARCHITECTURE-SPINE.md` cited as a bare filename | Two files carry that name. The governing one is `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md` (AD-24 at `:177-180`). `mockup/uploads/ARCHITECTURE-SPINE.md` contains **no AD-22/23/24** at all. Every `[Source: ARCHITECTURE-SPINE.md#AD-24]` must become a full path. |
| `make typecheck` / `make test` | **Correction to this archived analysis (was wrong):** this row originally claimed "there is no `Makefile`" and that `AGENTS.md` documents commands that do not exist. That is false. The repo has a lowercase `makefile` (5351 bytes); GNU make searches `GNUmakefile`, then `makefile`, then `Makefile`, so the lowercase name resolves and `make typecheck` / `make test` / `make lint` / `make build` all work, expanding to `npm run typecheck` (`package.json:17` = `tsc --noEmit --project tsconfig.app.json && …`) and the equivalent `npm run …` scripts. `AGENTS.md` is correct as written. Both `make …` and `npm run …` are valid idioms going forward. |
| React Testing Library / `screen.queryByText` / `MemoryRouter` | `@testing-library/*` is **not a dependency** (`package.json`), and `queryByText` has zero hits in `src/`. The repo runs `vitest-browser-react` (`package.json:136`) in real Chromium (`vitest.config.ts:36-49`), with `TestMemoryRouter` from `ra-core`. Negative idiom: `await expect.element(screen.getByRole(...)).not.toBeInTheDocument()` — see `src/components/atomic-crm/layout/ContextSwitcher.test.tsx:2-3,68-69,95,210`. |
| `children/`, `ChildShow.tsx`, `ChildCard.tsx`, `ChildProfileHeader` | Deleted by Epic 1. Zero hits repo-wide. Real: `singles/SingleShow.tsx:42` (`SingleProfileHeader`, used at `:117`), `singles/SingleCard.tsx`. CI guard `scripts/check-retired-names.mjs` fails on the old names. |
| `simple-list/SimpleListItem.tsx` | Deleted by Epic 1 (`d66119c`). Zero hits. The real row-click primitive is `src/components/admin/data-table.tsx:23,233` (`useGetPathForRecordCallback`). |
| `sales.administrator` | Renamed. `public.members.administrator` (`supabase/schemas/01_tables.sql:14-23`); TS type `Member`. |
| "Epic 2 has not landed / `current_context_id()` may not exist" | Landed. `current_context_id()` at `02_functions.sql:201`; 43 uses in `05_policies.sql`; `current_account_id` gone. All Epic-2 contingency clauses in 3.4 (`:19-33`), 3.5 (`:207-215`), 3.6 (`:144-151`) are dead text — delete, do not retarget. |
| `?raw` source tests | The only in-repo precedent is `references/entitlementGate.guard.test.ts:16-20` using `import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true })`. A bare `import src from "./X.tsx?raw"` needs a `*?raw` module declaration to typecheck under `strict`. |
| The design source of truth for tabs | **Not the mockup.** It is PRD amendment A2 — `_bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:166-172` (UX-DR2 routes, UX-DR4 shared vocabulary `Overview, Activity, Notes, Tasks, Files, Related`, UX-DR5 per-entity matrix). `mockup/MyShadchan.dc.html` is pre-AD-24 and internally inconsistent (9-tab shidduch at `:1752`, 3-tab shadchan at `:1609`, no-tab reference at `:1217`, no single 360, and a "Child portal" parallel surface at `:1856-1857` that AD-24 forbids and Epic 1 already deleted). |

---

## 1. Verdict

**No — the story set is not buildable as written.** Two failure classes make it so. First,
staleness: 3.1, 3.2, 3.3, 3.4, 3.7 and 3.9 each contain sections written against a tree that
Epics 1 and 2 deleted, and in three cases (3-1's "Post-Epic-1 naming" block, 3-7's entire
security framing, 3-3's "flag to the epic owner" escalation) the stale text is *actively
misdirecting* — it tells a developer that correct paths are wrong, that a closed security
gap is open, and that a resolved cross-epic gap needs escalating, while the real gap goes
unreported. Second, and more expensive: the `EntityDescriptor` that 3.3 defines **cannot
express what four Epic 5/8 stories will hand it on their first day** — it has no field for
`rightRail` (5.7 is entirely a right rail "wired per the shidduch descriptor"), no
`ReactNode` identity header (5.9 requires `ShadchanHeader.tsx` *unchanged*, a Card of
`tel:`/`wa.me`/`mailto:` anchors), no way for a stat band to fetch (5.9's band is
`useGetOne("shadchan_stats")`), no renderer for the `actions` field it declares (5.1's
pipeline state control has nowhere to live), and no API to extend a registration that five
stories say they will "fill in". Add to that three ACs that cannot fail, two that
contradict each other inside the same story, one story (3.8) that ships a red typecheck if
followed literally, and no owner for record fetching, `/{entity}/new`, or the tab
vocabulary — and the framework as specified would be delivered, tested green, and then
rewritten mid-Epic-5. Fix §3's structural items **before** any dev picks up a ticket; the
§2 retargeting is mechanical and can happen in the same pass.

---

## 2. Blocking, per story

Checkboxes are for the refresh agent. Anything marked **[premise]** means delete/rewrite the
section, not update a line number.

### 3.1 — `Entity360` shell

- [ ] **[premise]** `:196-206` "Post-Epic-1 naming" — verbatim *"Epics 1-2 are storied but not yet implemented … the same 9 avatar call sites live under `children/ChildCard.tsx` and `children/ChildShow.tsx` — locate them by import statement rather than by the file paths quoted here."* Both epics landed. **Delete the whole section**; the literal paths elsewhere in the story are now correct and this block tells the dev to distrust them.
- [ ] `:69`, `:189` — `ChildProfileHeader` → `SingleProfileHeader`, `src/components/atomic-crm/singles/SingleShow.tsx:42`.
- [ ] `:242-245` References — `children/ChildShow.tsx:34-100` → `singles/SingleShow.tsx:42-109`.
- [ ] `:213-215` — `make typecheck` → `npm run typecheck` (`package.json:17`). `tsconfig.app.json` `include: ["src","demo","vitest-browser.d.ts"]`, so `.test.tsx` under `src/` *is* covered — the mechanism works, only the command name is wrong.
- [ ] **AC 3 forbids what AC 4 requires.** `:57-58` bans inline `style` background in `Entity360.tsx` **and `EntityAvatar.tsx`**; `:80` requires the `--avatar-{n}` background "exactly as today". All four chips set it inline: `singles/SingleShow.tsx:57-61`, `shadchanim/ShadchanHeader.tsx:32-37`, `references/ReferenceShow.tsx:48-53`, `shidduchim/ShidduchShowHeader.tsx:44-49` — each `style={{ backgroundColor: \`var(--avatar-${avatarIndex})\`, color: "var(--avatar-ink)" }}`. Tailwind cannot express a dynamic `--avatar-{0..9}` without an arbitrary-value class or safelist. **Resolve explicitly**: carve `backgroundColor` out of AC 3's ban and say why.
- [ ] **AC 3's regex cannot fail.** `:65` — `/min-w-\[(3[89][0-9]|[4-9][0-9]{2})px\]|#[0-9a-fA-F]{3,6}\b/`. Matches 3-digit px only (`min-w-[1024px]` passes clean); no `rgb(` branch despite the prose banning rgb; no coverage of `w-[Npx]`/`basis-[Npx]`/`style={{minWidth:500}}` despite the prose banning inline style; and the AC's headline ("does not overflow at 375px") is not tested at all. With Task 3's `flex flex-col` root it is true by construction before a line is written.
- [ ] **"`aria-hidden` exactly as today" is not one behaviour.** Present: `SingleShow.tsx:62`, `ReferenceShow.tsx:53`, `ShidduchShowHeader.tsx:49`. **Absent** on the `shadchanim/ShadchanHeader.tsx:32-39` chip. Make the a11y decision in the story.
- [ ] **The `className` contract understates variance.** `:76-79` names two axes. Actual: `SingleShow.tsx:57` `h-14 w-14 rounded-2xl text-xl` · `ShadchanHeader.tsx:32` `h-14 w-14 rounded-2xl text-lg` · `ReferenceShow.tsx:48` `h-12 w-12 rounded-xl text-base` · `ShidduchShowHeader.tsx:44` **`size-14`** `rounded-2xl text-lg`. Font size varies independently of box size; a two-variant contract cannot express it.
- [ ] **AC 2's second half is vacuous.** "extra DOM props are not plumbed through" — with seven named props and no `{...rest}`, extra props are a TS error at every call site; there is no code path that could plumb them.
- [ ] **`EntityAvatar` has zero consumers.** `grep -rn "EntityAvatar" _bmad-output/implementation-artifacts/5-*.md` → nothing, and `:82-85` explicitly declines to rewire the four call sites. Either add the rewire to 3.1 (it is 4 files) or assign a consumer story. Do not ship a tested-but-dead module.
- [ ] `:175-179` — theme-token pattern cited via the same dead `children/ChildShow.tsx` parenthetical.
- [ ] **Correct — do not touch:** AC 5's avatar census. 10 files import `getMonogram|getAvatarIndex`; the 6/3 split is right; the functions are `shidduchim/boardUtils.ts:35` and `:44`. Note for the dev: `ShidduchCard.tsx` and `ShidduchShowHeader.tsx:7` also import `formatRedtDate` from the same line, so those two keep a `./boardUtils` import alongside the new one.

### 3.2 — URL-backed tabs

- [ ] `:109-110` — `simple-list/SimpleListItem.tsx` as the live `useNavigate` pattern. Deleted. Use `layout/ContextSwitcher.tsx:10` or `admin/data-table.tsx`.
- [ ] `:171` — "React Testing Library + `MemoryRouter`". Replace with `vitest-browser-react` + `ra-core`'s `TestMemoryRouter` (`ContextSwitcher.test.tsx:2-3,69`). `render()` does return `container`, so 3.1 AC 1's `container.textContent` survives.
- [ ] `:112-113`, `:194-196` — existing tabs block is `references/ReferenceShow.tsx:129-165` (`<Tabs defaultValue="conversations">` at `:129`), not `:131-167`. Substance (local state, not URL-backed; tabs `Conversations/Timeline/Reminders/Assistant`) is correct.
- [ ] **`useCreatePath` is broken for `edit` and `create`, not just `show`.** Verified in `node_modules/ra-core/dist/routing/useCreatePath.js`: `case 'create'` (`:46`) → `` `${basename}/${resource}/create` `` — but AC 1 routes creation at `"new"`; `case 'edit'` (`:48`) → `` `${basename}/${resource}/${id}` `` — **byte-identical to AD-24's show URL**; `case 'show'` (`:56`) → `/{id}/show`. `admin/edit-button.tsx` and `admin/create-button.tsx` both build `to` from it, and `EditButton` is live at `singles/SingleShow.tsx`. **Day one of the first migration: Edit navigates to the 360, Create 404s.** No story in any epic addresses this. 3.2 is the right owner.
- [ ] **Registering only `list` sets `hasShow`/`hasEdit` false — and kills `<DataTable>` row clicks.** `node_modules/ra-core/dist/core/Resource.js:33-34` — `hasEdit: !!edit || !!hasEdit`, `hasShow: !!show || !!hasShow`. `routing/useGetPathForRecord.js` gates row-link resolution on those flags; `src/components/admin/data-table.tsx:233` calls `useGetPathForRecordCallback()`. Today `singles/index.ts`, `shadchanim/index.ts`, `references/index.ts` register full `list/create/edit/show`. **The escape hatch exists**: `<Resource>` accepts explicit `hasShow`/`hasEdit` props. Add an AC that migrated entities pass them.
- [ ] **Nobody establishes a `RecordContext`.** AC 1 types `Show: ComponentType` and routes `":id"`/`":id/:tab"` straight to it; 3.3 has `EntityShow` read the record from `useRecordContext()`. Under `buildEntityRoutes` nothing fetches — today that comes from `<Show>`/`ShowBase` (`src/components/admin/show.tsx`). Unowned; the first migrated 360 renders an empty shell. **3.2 must own the `ShowBase` wrapping and state it in AC 1.**
- [ ] **No "record not in this active context" case.** AC 3 enumerates only *unknown tab*. Under AD-19 `current_context_id()` fails closed and `ContextSwitcher.tsx:98-101` invalidates every query and navigates to `/` precisely because a record from the previous context no longer resolves. A pasted `/shidduchim/42/medical` in the wrong context returns an empty result set, not an error. Add the AC and the fallback.
- [ ] **AC 2 is not implementable from the inputs it names.** `Entity360Tabs` receives only `{ tabs }` — no entity, no id. `useParams()` inside the nested `<Routes>` yields `id` and `tab`, never the entity segment (consumed by the enclosing `<Resource name>`). Specify relative navigation (`useResolvedPath` / `navigate("../" + key)`) and pin **both** entry states — arriving at `:id` (append a segment) vs `:id/:tab` (replace one).
- [ ] Add an AC: the tab fallback is re-evaluated **on every location change**, not only on mount (a back-navigation after a context switch can land on a tab the viewer no longer has).
- [ ] Make the composition order explicit: Epic 8 Story 8.1 adds `contextKind` + `<RequireContextKind>` at the **resource** level (`8-1:52-55`), wrapping `EntityRoutes`. A dev who instead nests the guard per-route inside `buildEntityRoutes` gets it wrong.
- [ ] `RestoreScrollPosition` note: `Resource` wraps the `list` element in `<RestoreScrollPosition storeKey={\`${name}.list.scrollPosition\`}>`. Since `EntityRoutes` *is* the list element, every show/tab render inherits the list's saved scroll offset. Cosmetic, will read as a bug.
- [ ] AC 5 ("verified with a fixture entity") is vacuous — it is a diff-review check, not a test.
- [ ] **Correct — do not touch:** the `<Resource>` route-table analysis (`create/*`, `:id/show/*`, `:id/*`, `/*`) and the `useCreatePath` `/show` hardcoding. Both verified in ra-core 5.15.0.

### 3.3 — Entity descriptor registry

- [ ] **[premise]** `:33-49` "Epic list AC vs. this story's actual scope" — quotes 4.1 as saying *"No entity descriptor integration … a follow-up refactor"* and escalates to the epic owner. **That text was deleted from 4.1 by the same commit that recorded the gap.** Today: `4-1:29` *"Depends on Epic 3: Story 3.3's `EntityDescriptor` registry"*; `:43-44`; `:114` `getEntityDescriptor(resource).label`; `:234` *"No descriptor consumption beyond `label`"*; `:239` *"Never redefine the `EntityDescriptor` type"*. **Delete the section and replace it with the real escalation** (missing `rightRail`/`identityHeader`/`statBand` fields — see §3-A).
- [ ] **[premise]** `:157-166`, `:199` — *"the polymorphic `interactions`/`tasks` tables use a singular `target_type` value (`shidduch`, `single`, `shadchan`, `reference`) — see `01_tables.sql:525-527,134-136`"*. Wrong on both counts. Line numbers point at `pipeline_transitions`/`subscription` and at `accounts`. Real: `tasks.target_type` `01_tables.sql:44`, check `:45-47` = `('shadchan','shidduch','reference')`; `interactions.target_type` `:436`, check `:458-459` = `('reference','shidduch')`. **`single` is legal in neither table; `shadchan` is illegal in `interactions`.** 3.5 and 3.8 widen them — say so as future, not present.
- [ ] `getEntityDescriptor(name): EntityDescriptor | undefined` with no fail-fast accessor. `4-1:114` dereferences `.label` unguarded; 3.9 registers 4 entities while `root/routeManifest.ts:93-99` declares **7** (`shidduchim, singles, inbox_items, shadchanim, references, tasks, members`). `EntityList` over `tasks`/`inbox_items`/`members` → `TypeError`. Add `requireEntityDescriptor(name)` per `.claude/rules/coding-style.md#Error-handling`.
- [ ] AC 3's `"or"` — `{resource, record}` props **or** `ra-core` context — makes the component contract untestable. Pick `useRecordContext`/`useResourceContext` (the repo pattern: `singles/SingleShow.tsx`, `shadchanim/ShadchanShow.tsx`).
- [ ] AC 5's structural check does not prove what it claims. The regex bans *imports* from entity folders; `if (resource === "shidduchim")` contains no `/` and passes clean. Reword to what the test does, and **widen the alternation** — it lists `(shidduchim|singles|shadchanim|references)` and misses `connections/`, the entity `8-5` Task 2 adds. Use "no import from any sibling directory of `entity360/`".
- [ ] `label?: string` is optional but `4-1:114` uses it as a `translate` fallback (`_:`), which needs `string`. Make it required or have 4.1 default it.
- [ ] `:141-145` `ResourceEntry { name, surface, definition }` is **correct** (`root/routeManifest.ts:39-43`) — but it gains `contextKind?` from `8-1:52-55`. Note it.
- [ ] Task 3 is a doc comment with "(AC: none — coordination)". Nothing fails if skipped, and it is the only artefact recording the 3.3↔4.1 split. Give it an AC or delete it.
- [ ] **The four structural gaps are in §3-A, not here** — `identityHeader`, `statBand`, `rightRail`, `actions` rendering, and the missing extend API require a rewrite of AC 1/AC 2/AC 3, not a retarget.

### 3.4 — Permission-aware rendering

- [ ] **[premise]** `:19-33` — *"This story needs a real, per-context role for the signed-in caller. Today that does not exist: the only role signal in the codebase is `sales.administrator`."* **False on four counts:**
  - `src/components/atomic-crm/types.ts:109-110` — `export type MemberRole = "parent_admin" | "helper" | "self_manager" | "shadchan" | "single";`
  - `supabase/schemas/02_functions.sql:341` — `my_contexts() RETURNS TABLE(account_id, kind, name, role, is_active)`, `is_active = (am.account_id = current_context_id())`
  - `src/components/atomic-crm/root/useMyContexts.ts:12-18` — `useMyContexts()` → `dataProvider.getMyContexts()`, cached `["myContexts"]`; row type `MyContext` at `types.ts:165-171`
  - `supabase/schemas/01_tables.sql:153-155` — `role in ('parent_admin','single','helper','self_manager','shadchan')`
  Delete the section and the "Hard cross-epic dependency" block.
- [ ] **[premise]** AC 5 (`:81-95`) is unimplementable as written. It says derive the role "via `useGetIdentity()` [Source: authProvider.ts:9-20]". `providers/supabase/authProvider.ts:9-22` returns exactly `{ id, fullName, avatar }`; `administrator` is read only inside `canAccess` at `:151`. The FakeRest provider matches. Task 3 cannot be written without editing `getIdentity` in both providers — work no task authorises. **Replace AC 5 with `useMyContexts().data?.find(c => c.is_active)?.role`.**
- [ ] The provisional mapping is also *wrong*, not merely provisional. `members.administrator` is a **global per-login** column (`01_tables.sql:14-23`, one row per `user_id`), unrelated to `account_members.role`. A login holding household + shadchanus memberships gets the same role in both — the exact multi-context case Epic 2 exists to support. `self_manager` and `single` become **unreachable**, which silently dead-codes `5-5:86` (`minVisibility: ["parent_admin","self_manager"]`), `6-1:141` and `6-4:169`. And it installs the hardcoded flag AD-2 forbids (`ARCHITECTURE-SPINE.md:65`).
- [ ] AC 2's test uses `screen.queryByText(...)` — throws `is not a function` under `vitest-browser-react`. Rewrite to `await expect.element(...).not.toBeInTheDocument()`.
- [ ] **Loading state is unhandled and it rewrites deep links.** `useMyContexts`/`useGetIdentity` are async → first paint has `viewerRole === undefined` → AC 2's fail-closed filters every restricted tab → 3.2's fallback fires and **pushes** a new history entry away from the deep link → the role resolves and the tab reappears, URL already rewritten. Add an AC covering the pending state (render nothing / skeleton, do not navigate).
- [ ] Stale citations: `:23` `canAccess.ts:16-30` → the file is **26 lines**, admin branch `:16-18`. `:24`,`:212` `authProvider.ts:166-169`/`160-170` → `canAccess` is `:145-152`. `:173` `<CanAccess>` at `TopBar.tsx:44,47` → it is `TopBar.tsx:41` (`ContextSwitcher` at `:35` shifted them). `:161-168`,`:215` `01_tables.sql:271-273` "`single` added by Epic 2 Story 2.2" → it is `:153-155` and `single` is already there; delete the note.
- [ ] `sales.administrator` at `:21,:84,:92,:119,:214` → `members.administrator`.
- [ ] **`canAccess.ts` is owned by nobody.** `:176-179` defers to Epic 2; `2-7:261-264` defers to Epic 3/6. `providers/commons/canAccess.ts:16-25` is still the binary `admin`/`user` check. 3.4 is the natural owner and currently forbids itself. Assign it.
- [ ] AC 1 presents stat-gating as "the field half", but `stats` is a pure function of an **already-fetched** record — hiding a stat hides a rendering of data the client holds. `epics.md:509` requires *"the underlying data was never sent to the client"*. Get explicit epic-owner sign-off on the reduction, in the AC, not a Dev Note.
- [ ] `Role` is declared twice: `:38-41` claims `entity360/entityDescriptor.ts` is *"the one place this union is spelled out"*; `types.ts:109-110` already has it, and `InvitableRole` (`types.ts:117`) derives from it. **Re-export from `types.ts`.**

### 3.5 — Universal Activity tab

- [ ] **`ListPaginationContextProvider` does not exist in `ra-core`.** `:113-114`, `:240`. `node_modules/ra-core/dist/controller/list/` exports `ListPaginationContext` (a raw `React.Context`) and `usePickPaginationContext`; the name `ListPaginationContextProvider` survives only inside `useListPaginationContext.js:16`'s error string. `ListPaginationContextValue` is a 10-field `Pick<ListControllerResult, 'isLoading'|'isPending'|'hasPreviousPage'|'hasNextPage'|'page'|'perPage'|'setPage'|'setPerPage'|'total'|'resource'>`; `useGetList` supplies two of them. `useListPaginationContext` **throws** if absent, so getting it wrong is a hard crash inside `admin/list-pagination.tsx`, not a degraded render. Name the six fields the dev must synthesise, or drop the context requirement.
- [ ] **The TS type is never widened.** `src/components/atomic-crm/types.ts:477` — `target_type: "reference" | "shidduch";`. AC 4 has `ActivityTab` take four values. `types.ts` appears in no AC, task or File List. **`npm run typecheck` fails on the first fixture.** Same omission in 3.6 for `deleted_at`. Assign `types.ts` to whichever of 3.5/3.8 lands first.
- [ ] **Widening `target_type` without extending purge orphans rows.** `purge_polymorphic_dependents()` (`02_functions.sql:1799-1817`) is wired only at `04_triggers.sql:109-111` (`references`) and `:118-120` (`shidduchim`). There is no purge trigger on `public.singles` or `public.shadchanim`, and `interactions` carries no FK on `target_id` by design. AD-1 requires target-scope integrity. Add the two triggers in this story.
- [ ] **A shadchanus context can never hold an interaction.** `04_triggers.sql:195-197` — `validate_interactions_household_scope … execute function public.enforce_household_scope()` (`02_functions.sql:387-402`, raises unless `accounts.kind = 'household'`). So the "universal" Activity tab is structurally unavailable in a shadchanus context, which is what `8-5` needs. **Decide and state it** (see §3-J).
- [ ] AC 5's `RecordLink` branch crashes the tab. `3-9` AC 1 makes `RecordLink` **throw** on an unregistered resource; `interactions.metadata` is free-form `jsonb` (`01_tables.sql`) that clients may update (`06_grants.sql:615-616` grants `update (body, metadata)`). One stale `linkedResource` blanks the whole tab. Require a registry-membership guard with plain-text fallback.
- [ ] AC 5 is fixture-only: no SQL writer in `02_functions.sql` populates `metadata` in the shape AC 5 reads, and `:124-128` says this story does not retrofit them. `epics.md:523` is therefore satisfied by unreachable code. Name the owning story or state the limitation in the AC.
- [ ] `AGENTS.md`: `02_functions.sql` must use exact `pg_dump` format (`CREATE OR REPLACE FUNCTION "public"."name"() … LANGUAGE "plpgsql"`, e.g. `:201-203`). AC 3's lowercase/unquoted snippet produces a phantom diff. Same gap in 3.6 Task 1.
- [ ] `KIND_LABELS` moving to `entity360/tabs/interactionLabels.ts` cements six hardcoded English strings at the **framework** layer, against the spine's i18n convention (`:194`) and AD-18 (English + Hebrew). Higher cost than leaving it in one component. Same for AC 7's inline strings and 3.6 AC 4/5.
- [ ] Stale citations: interactions table `01_tables.sql:432-484` (not `:499-545`); the "Without this discriminator…" comment `:449-451` (not `:505-518`); policy `05_policies.sql:262` (not `:163-241`); grants `06_grants.sql:412-422` and `:595-616` (not `:341-351,528-533`).
- [ ] `:207-215` Epic 2 contingency — moot, delete.
- [ ] `:57-58`, `:224-226` quote the schema comment's word **"candidate"** (`01_tables.sql:451`). AD-23 retires it. Task 1 already rewrites that comment block — fix the word there.
- [ ] Mechanical notes to keep: `set_interaction_actor_member_id` will be a **second** BEFORE INSERT trigger on `interactions` (first is `set_interactions_account_id`, `04_triggers.sql:131-133`); Postgres fires them in name order. `current_member_id()` returns NULL with no active context — state the fail-closed behaviour. AC 2's new `exists` checks carry no `status='active'` filter, so an archived single's interactions stay visible — probably intended, say so.
- [ ] **Correct — do not touch:** the current-policy description (`05_policies.sql:262-313`), the grant analysis, `current_member_id()` genuinely not existing, the two inline lookups at `02_functions.sql:2128-2132` and `:2381-2385`, every `ShidduchTimeline.tsx` line citation, `assertValidInteraction` at `providers/fakerest/dataProvider.ts:95-123`, and `@is` filter support (`transformFilter.ts:26-29`).

### 3.6 — Universal Notes tab

- [ ] **AC 2 hardcodes `am.role = 'parent_admin'` (`:57-65`), locking self-managing households out of moderation.** `02_functions.sql:439-444` — `is_owning_membership_role(p_role) := p_role in ('parent_admin','self_manager')`, with the comment at `:434-438` that it exists so nothing "can ever diverge on this list", and it is used at `:553,565,644,795-800`. `add_persona()` creates a household whose only membership may be `self_manager`. `5-5:86` correctly uses both. **Call `public.is_owning_membership_role(am.role)`.**
- [ ] **Persona archive/re-add permanently strips an author of their own notes.** `remove_persona()` archives (`02_functions.sql:770,863`); `add_persona()` **inserts** a new row (`:531,:574,:598`); `account_members_account_user_active_uq` is partial — `(account_id,user_id) where status='active'` (`01_tables.sql:710`) — so archived and active rows coexist with different `id`s. 3.5's `current_member_id()` resolves `status='active' order by id limit 1`, so a note authored before a round-trip has `actor_member_id ≠ current_member_id()` forever: AC 2's `using` yields zero rows and AC 4's controls vanish. In a `self_manager` household nobody can recover them. **Compare on `user_id` via a join, not on the membership row id.** This is a design decision this story must make.
- [ ] **[premise]** `:144-151` leaves an unresolved decision — *"`account_members.user_id → members` (or `auth.users`, depending on how Epic 1's rename of `sales` finally wires the FK — check at implementation time)"*. The tree decides it now: `account_members_user_id_fkey … references auth.users(id) on delete set null` (`01_tables.sql:592`); `members.user_id uuid not null` + `uq__members__user_id` (`:20,:25`). Join is `account_members.user_id = members.user_id`. A `ready-for-dev` story must not carry an open decision.
- [ ] `types.ts:475-487` has no `deleted_at` and still the 2-value `target_type`. See 3.5.
- [ ] AC 2 splits a `for all` policy (`05_policies.sql:262`) into per-command policies and enumerates three, never stating that **DELETE gets no policy** (correct — `06_grants.sql:597` withholds the grant). State it, or a `for all` remnant survives. AC 3's matrix tests UPDATE only.
- [ ] Cross-reference for 6.4: `6-4:137-144` instructs adding `and kind <> 'single_input'` to the `with check` of **every other** policy on `interactions`, enumerated via `pg_policies`. 3.6's split multiplies that set.
- [ ] AC 3's *"zero rows affected"* is not observable through PostgREST — a 0-row UPDATE returns 404/`PGRST116`, which ra-core throws, indistinguishable from a policy error. Restate as a `db`-project (psql) assertion; AC 4's `useNotify` behaviour is the client half and is not connected to it.
- [ ] Stale citations: DELETE-withholding comment `06_grants.sql:595` (not `:512`); interactions grants `:412-422`, `:595-616`; `ShidduchShow.tsx` shadchanim fetch `:72-75`, `shadchanName` `:93-94` (not `:75-78,96-97`).
- [ ] `:146-147` "`members` (the renamed `sales` table)" — settled, state it as fact.
- [ ] `3-9` `RecordLink` is declared as a dependency (`:20-21`) and then never rendered by any AC or task. Either drop it or give AC 4 a mention-rendering clause with the unregistered-resource guard.
- [ ] **Correct — do not touch:** the soft-delete rationale, the `for all` → widening-policy reasoning (and the `05_policies.sql:113-142` precedent worth citing), the `useNotify` pattern at `ShidduchTimeline.tsx:61-66`, and the author-resolution feasibility analysis.

### 3.7 — Universal Files tab

- [ ] **[premise] `:23-44` — the entire framing section describes a security gap that was closed before Epic 2.** Verified now:
  - `supabase/schemas/07_storage.sql:19` — `update storage.buckets set public = false where id = 'attachments';`
  - `:21-23` drops the three unscoped `Attachments 1mt4rzk_*` policies
  - `:25-44` replaces them with `bucket_id='attachments' and (storage.foldername(name))[1] = public.current_context_id()::text` for select/insert/delete
  - `uploadToBucket` is `providers/supabase/dataProvider.ts:663+`; path is `` `${accountId}/${crypto.randomUUID()}${fileExt}` `` (`:702`) where `accountId` comes from `getCurrentAccountId()` (`:654-662`, RPC `current_context_id`); it ends in `createSignedUrl(filePath, ATTACHMENT_URL_TTL_SECONDS)` (`:716`) and throws if signing fails
  - **`getPublicUrl` has zero hits across `src/`, `supabase/` and `workers/`** (verified count: 0)
  The cited `07_storage.sql:6-8` now points at the *comment describing the fix*. Rewrite the premise; the case for a separate private `entity-files` bucket may still hold, but it currently rests on a false statement.
- [ ] **`:142-145` (Task 1) is inverted:** *"the `attachments` bucket's policies do not have this predicate — do not copy them verbatim"*. They do. Copying `07_storage.sql:25-44` with the bucket id swapped is now the correct implementation, and the instruction steers away from the one correct template in the repo.
- [ ] `:37-38` — "load-bearing for the `sales`/`members` avatar and the app logo upload (`dataProvider.ts:650-691`)". `sales` is gone; the only surviving caller is the members avatar hook (`dataProvider.ts:~571`); **there is no app-logo upload in that file** (the only logo handling is `providers/fakerest/dataProvider.ts:77-83`, demo-only base64). The cited range is `ATTACHMENT_URL_TTL_SECONDS` + `getCurrentAccountId`.
- [ ] `:111-112` — signed-URL check is `dataProvider.ts:666-670`; the load-bearing `createSignedUrl` is `:716`.
- [ ] **`:88,:91` "FORCE RLS … the same shape as `interactions`/`tasks`" — no table in this repo has FORCE RLS.** Repo-wide `grep -i "force row level" supabase/schemas/` → one hit, `01_tables.sql:85`, a comment reading *"FORCE ROW LEVEL SECURITY remains a flagged gap with no assigned story."* Live DB: 22 tables RLS-enabled, **0 forced**. The shape does not exist. (Note if verifying from the file rather than the DB: `grep -c "SECURITY DEFINER" 02_functions.sql` returns 32 while the live-DB definer-function count is 20 — state which measurement you used.)
- [ ] `:90-91` — `uploaded_by_member_id` "server-set by a trigger … exactly like `actor_member_id` on `interactions`". **There is no such trigger.** `04_triggers.sql:131-133` sets only `account_id`; `actor_member_id` is written inline in RPC bodies (`02_functions.sql:2129-2132`, `:2149-2153`).
- [ ] **AC 4(a) cannot fail** — it asserts `getPublicUrl` appears nowhere under files this same story authors, and the symbol exists nowhere in the repository.
- [ ] **AC 5's mandated reuse of `file-input.tsx` may be unbuildable.** `src/components/admin/file-input.tsx` calls `useInput` and needs a `source` prop plus a surrounding form context; `FilesTab` is a list + upload action. Task 4 concedes it in a parenthesis while AC 5 states it as an acceptance condition. Downgrade to "reuse `file-field.tsx` for display; upload need not go through `file-input.tsx`".
- [ ] `visibility` is stored and never settable. `epics.md`'s own 3.7 AC requires *"per-file visibility"*; AC 2 adds the column with `default 'shared'` and defers enforcement, and AC 5 offers no control. Every row is `'shared'` forever. Also: `private_parent`/`private_single` are meaningless for a `shadchan`- or `reference`-targeted file, which AC 2's four-value check permits.
- [ ] AC 1 scopes three storage policies; Task 1 says four (`select/insert/update/delete`); Task 2 argues `update` is unnecessary. Three statements, three answers.
- [ ] Task 2 omits the sequence revoke. Every domain table in `06_grants.sql` pairs its table grant with `revoke all on sequence public.<t>_id_seq from anon;` (56 such lines; `interactions_id_seq` at `:460-462`).
- [ ] `entity_files` is in no purge path (`02_functions.sql:1799-1817` covers `identity_signals`/`interactions`/`tasks` only), so deleting a parent strands rows **and** storage objects.
- [ ] **AC 6's negative test is the wrong test post-Epic-2.** "Two accounts, one user each" passes trivially. The regression that now matters is *one user who is a member of both A and B, seeing B's files while A is active* — exactly what `current_context_id()` was written to prevent (`02_functions.sql:192-200`). Rewrite AC 6 as a single multi-context login.
- [ ] Two-phase upload has no cross-system consistency assertion: `getCurrentAccountId()` re-resolves on every upload, and a context switch between storage-put and `dataProvider.create` orphans the object. Assert `storage_path`'s first segment equals the row's trigger-assigned `account_id`.
- [ ] Signed URLs survive a context switch (bearer token, own TTL; `ContextSwitcher.tsx:98` only clears React Query). AC 4's controls are right; state the residual window.
- [ ] Household-scope decision for `entity_files` — see §3-J.
- [ ] **Correct — do not touch:** the visibility vocabulary (`01_tables.sql:303-306` `shidduchim_visibility_check in ('shared','private_parent','private_single')`), the `interactions_target_idx` shape reference (`01_tables.sql:729` — but note the story omits its `created_at desc` tail), and the existence of `admin/file-input.tsx` / `file-field.tsx`.

### 3.8 — Universal Tasks tab

- [ ] **Task 1 ships a red typecheck, and AC 2 bans the fix.** Task 1 adds `"single"` to `TaskTargetType` (`types.ts:71`). `reminders/reminderEntity.ts:21` (`RESOURCE_FOR_TARGET`) and `:28` (`TARGET_TYPE_LABEL`) are both `Record<TaskTargetType, string>` → `Property 'single' is missing` ×2. AC 2 (`:60-62`) says in bold *"…gain their `single` entries in Story 3.9, not here — do not edit `reminders/`"*, and 3.8's own ordering note puts 3.9 after it. **Either resequence (see §5) or move the two `Record` edits into 3.8.**
- [ ] **AC 1's "No RLS change is needed" is false at the table level.** `04_triggers.sql:207-209` — `validate_tasks_household_scope … before insert or update of account_id on public.tasks … execute function public.enforce_household_scope()`, which raises `'account % is not a household-kind account'` (`02_functions.sql:396-397`). Combined with `set_tasks_account_id` (`04_triggers.sql:123-125`) assigning `current_context_id()`, **every task insert by a shadchan in their own context fails with a raw Postgres exception** — and AC 2 makes `TasksTab` accept `targetType: "shadchan"`, on which Epic 8 Story 8.5 is built. The Dev Notes reason entirely about policies and never look at triggers.
- [ ] **AC 3's test cannot fail.** It proposes asserting a `useGetList` read "unfiltered by target". The global list is `tasks/TasksListByDueDate.tsx:27-34` — `useGetList("tasks", { filter: { member_id: identity?.id } })`, and `member_id` is set by the Postgres trigger `set_member_id_default()` (`02_functions.sql:168-178`), which the browser-mode test environment never runs (the story's own Dev Notes say so). The AC reads a different query from the one it claims to verify, and `epics.md`'s "appears in the global Tasks list" goes untested.
- [ ] **Global-list scoping is by creator, not by household.** `set_member_id_default()` resolves `members where user_id = auth.uid()`, and `tasks.member_id` points at `public.members` (global), **not** `account_members` — flagged in `01_tables.sql:53-58` with *"resolving the collision is Epic 2 (AD-19), not this story"*, and **that comment is still there**, so Epic 2 did not resolve it. A task parent A creates never appears in parent B's list in the same household. The story never mentions assignment.
- [ ] Purge hole: adding `'single'` creates a fourth target type with **no purge trigger on `public.singles`** (`'shadchan'` already has the same hole). `sync_task_target()` (`02_functions.sql:1823-1835`) is benign — record that so the next dev need not re-derive it.
- [ ] Stale citations: policy `05_policies.sql:31-36` (not `:57-65`); table `01_tables.sql:31-51`, constraint `:45-47` (not `:119-140`).
- [ ] The `psql`-insert verification step (`:110-113`) fails for a reason unrelated to the change: a bare psql session has `auth.uid()` null → `current_context_id()` NULL → NOT NULL violation on `account_id`. Needs an authenticated JWT context.
- [ ] **Correct — do not touch:** `TaskTargetType` = 3 values (`types.ts:71`), `tasks_target_type_check` = the same 3 (`01_tables.sql:46`), `references/ReferenceTasks.tsx` as a working record-scoped precedent.

### 3.9 — `RecordLink` primitive

- [ ] **[premise]** `:199`, `:203-212` "Why `SimpleListItem.tsx` is out of scope" — reasons about a file Epic 1 deleted (`d66119c`). The real row-click primitive is `src/components/admin/data-table.tsx:23,233`. The exclusion of AD-24's "list row" clause is therefore unjustified (though moot in practice: the real list rows — `SingleCard`, `ShadchanCard`, `ReferenceList` — are all inside the 12-site sweep). Rewrite the reasoning; do not simply delete the section.
- [ ] `:94`, `:97`, `:188`, `:196` — `children/ChildCard.tsx`, `children/ChildList.tsx:46`, and the `children` alternation in AC 3's grep. Real: `singles/SingleCard.tsx:61`, `singles/SingleList.tsx:46`. Drop `children` from the pattern.
- [ ] `:192` — `reminders/ReminderCard.tsx:61-62` → `<Link to={linkedEntity.to}>` is at `:58-59`.
- [ ] **AC 5 misses two more places that must learn about `single`.** `reminders/useReminders.ts:42-45` — `const ALL_TARGET_TYPES: TaskTargetType[] = ["shidduch","reference","shadchan"]`, which seeds `groupIdsByTargetType`'s buckets (`:52-56`); and `:69-89` hardcodes **three** `useGetMany` calls with a three-row tuple at `:93-97` (order-stable by the comment at `:64-67`), so a fourth type needs a fourth hook, not a map entry. Without both, a `single`-targeted reminder is silently skipped and renders the literal label — the exact degradation `:129-130` claims to prevent.
- [ ] **AC 5 preserves a live AD-23 violation** it is already editing around: `reminderEntity.ts:29` — `shidduch: "Suggestion"` — and `:60`'s fallback `"Suggestion"`, both user-facing via `ReminderCard.tsx:58-64` and `ReminderCreateSheet.tsx`. Fix it here.
- [ ] **AC 2 pins a modal as the canonical shidduch destination.** `shidduchim/index.ts` exports `{ list: ShidduchimList }` only; `ShidduchimList.tsx:79` does `matchPath("/shidduchim/:id/show", …)`; `ShidduchShow.tsx:18-20` self-documents *"A routed Dialog (`/shidduchim/:id/show` over the board), not a `Show`"* and `:35` is `<Dialog>`. `<Resource>` therefore sets `hasShow: false` for shidduchim. AC 2's pinned string puts a **passing test around a UX-DR3 violation**. Keep the pin (it is the honest current state and 5.1 un-pins it) but add the comment, and note that any ra-core machinery gated on `hasShow` disagrees with the descriptor.
- [ ] AC 1's sample `<Link to={getEntityDescriptor(resource).buildRecordPath(id)}>` does not typecheck against 3.3's `| undefined` return. Use the fail-fast accessor (§3-A).
- [ ] AC 4's snippet (`:217-227`) spreads `{...provided?.draggableProps}` **after** `onClick`; today's `shidduchim/ShidduchCard.tsx:101-108` puts the spreads **first**, precisely because `@hello-pangea/dnd`'s `dragHandleProps` carries its own handlers. Also, `:89-100` passes `{ _scrollToTop: false }` to `redirect` — a bare `<Link>` drops it, so board-card clicks will start jumping to top. Both must be in the AC.
- [ ] Task 3's "update existing tests (if any)" resolves to **none**: of the 12 sweep targets only `references/ReferenceMatchPanel.tsx` has a sibling test; `reminders/` has no component tests. The story's own Testing standard (`:236-239`) plus `.claude/rules/testing.md`'s 80% rule implies ~11 new test files plus `RecordLink.test.tsx`. The scope note ("a small leaf component", `:24-25`) is wrong by an order of magnitude. Re-estimate.
- [ ] `dashboard/RecentSuggestions.tsx` and `shadchanim/ShadchanSuggestions.tsx` are both in the sweep and both named for "suggestion" while rendering shidduchim. Renaming is arguably Epic 5's; note it.
- [ ] **Correct — do not touch:** the 12-site sweep inventory. AC 3's command 1 re-run verbatim returns **exactly 9 hits in exactly the 9 claimed files**; commands 2-4 also match. `ShidduchCard.tsx` line refs are exact. `reminderEntity.ts:34`'s comment ("`shadchanim` has no /show") is stale and the `:44-46` bug is **real and live** — `shadchanim/index.ts` does register `show`.

---

## 3. Structural problems — rewrite / split / add / resequence

### 3-A. **Rewrite 3.3 AC 1 / AC 2 / AC 3.** The descriptor cannot express what its consumers hand it.

Four consumers break on day one, all confirmed:

| Missing | Consumer that needs it |
|---|---|
| a `ReactNode` identity header | `5-9` AC 3 + Task 3: *"the identity header is `ShadchanHeader.tsx` **unchanged** (contact quick actions intact)"* — `shadchanim/ShadchanHeader.tsx:28-100` is a `<Card>` of `tel:`/`wa.me`/`mailto:` anchors, a `<MapPin>` row and `<ResponsivenessChip>`. `5-1` Task 3 relocates `ShidduchShowHeader.tsx`, whose `firstSuggestedByName` prop (`:22-28`) is documented as *"looked up by the parent against the shadchanim list it already fetches"* — not derivable from the record at all. `8-5` AC 2 needs account name + connection status. |
| a `statBand` that can fetch | `5-9` Task 3: "stat band = `ShadchanStatsRow`" — `shadchanim/ShadchanShow.tsx:40-43` is `useGetOne<ShadchanStats>("shadchan_stats", { id })` with its own skeleton (`03_views.sql:202`, `security_invoker`). `8-5` AC 2/AC 7 likewise. A `(record) => {value: number}[]` cannot call a hook. Note 3.1 AC 6 deliberately typed `statBand` as `ReactNode` *"the shell does not fetch or format stats itself"* — 3.3 then re-narrowed it. |
| a `rightRail` field | `5-7` is **entirely** the right rail; Task 2: *"wire into the shell's right-rail region **per the shidduch descriptor**"*. `8-5` AC 4/5 puts send-a-redt and end-connection in the Connection 360's rail under a Task-1 mandate of *"zero bespoke layout code per AD-24"*. |
| a rendering contract for `actions` | `3-3` declares `actions?: (record) => ReactNode`, `3-3` AC 3 renders identityHeader/statBand/tabBar/children and *"nothing else"*. `5-1:51-53`: `ShidduchStateControl` *"is relocated into the shell's identity-header/actions region per the descriptor contract… Deleting the dialog without re-homing it would remove the only transition UI on the 360."* `9-2:157` defers a Single-360 action to this field. |
| an extend/replace API | `3-3` AC 2: *"Registering the same `name` twice **throws**"*, with no update path. But `4-1:162` "Extend the `singles` entry", `5-1:93` "Add a shidduch entry", `5-8:105` "Fill in the `singles` entity descriptor (3.9 registered the minimal stub)", `5-9:95`, `5-10:106`. |

**Replacement:** see §4 for the exact shape. Also scope AC 5's `?raw` boundary test to
`EntityShow.tsx` alone and state that a *descriptor module* may live in, and import from, its
entity folder — otherwise the boundary test forbids the only workable layout.

### 3-B. **3.2 must own record fetching.** Nothing under `buildEntityRoutes` establishes a `RecordContext`; `EntityShow` reads `useRecordContext()`. Add to 3.2 AC 1: the `:id` and `:id/:tab` routes wrap `Show` in `ShowBase` (`src/components/admin/show.tsx`) so `RecordContext`, pending and error states exist. Otherwise every Epic 5 story improvises it.

### 3-C. **Add a story (or an owned 3.2 AC): route-convention alignment.** AD-24 / UX-DR2 mandate `/{entity}/new`; the app is `/create` in 14 places (`dashboard/Dashboard.tsx:36,56`, `layout/MobileNavigation.tsx:172`, `singles/SingleList.tsx:46`, `shidduchim/ShidduchimList.tsx:78` `matchPath("/shidduchim/create")`, …) and `4-1` keeps `createTo="/singles/create"`. `useCreatePath.js:46` hardcodes `/create` and `:48` returns `/{resource}/{id}` for **edit** — AD-24's *show* URL. **No story in any epic renames it.** Scope: the rename, a `useCreatePath`/`CreateButton`/`EditButton` override, `4-1`'s `createTo` props, and explicit `hasShow`/`hasEdit` props on `<Resource>` for list-only registrations (`ra-core/dist/core/Resource.js:33-34` accepts them).

### 3-D. **Rewrite 3.4 AC 5 and give 3.4 `canAccess.ts`.** Implement `useViewerRole()` against `my_contexts()` now (`02_functions.sql:341`, `root/useMyContexts.ts:12-18`). Reduce `6-4` AC 5 / Task 4 to a verification. Assign `providers/commons/canAccess.ts` to 3.4 — 3.4 and `2-7:261-264` currently point at each other and it is still the binary `admin`/`user` check.

### 3-E. **Resequence 3.9 before 3.8.** `3-9:17-18` says build 3.9 first; `3-8:15-17` says the opposite. Only one order compiles (see 3.8's first checkbox). Pick 3.9-first and delete the contradicting note.

### 3-F. **Add a story: the tab vocabulary (UX-DR4).** `amendment-a2.md:166-167` writes the shared vocabulary down (`Overview, Activity, Notes, Tasks, Files, Related`); `3-3:72-74` types `EntityTabDescriptor.key`/`label` as free strings, so nothing stops drift — and drift already exists in the story set (`5-8:107` `shidduchim` vs `5-10:69` `linked-shidduchim` for the same concept; `7-1` `discussions` vs `8-5`'s "Conversations" for the same panel). Deliverable: a closed union of canonical tab keys + their canonical labels, typed into `EntityTabDescriptor["key"]`, plus the `Overview` and `Related` shared components that UX-DR4 names and no story builds. **This is the highest-leverage missing story: it is what makes ~30 downstream stories converge instead of diverge.**

### 3-G. **Add a story: an AD-24 conformance validator.** Model on Epic 1's proven pattern — `root/routeManifest.ts:175+` `findManifestViolations` with a fixture-in-test-file. Assertions: every `RESOURCES` entry (`routeManifest.ts:93-99`, 7 today) has a registered descriptor; no detail/`Show` component outside `entity360/` is route-reachable; no `<Dialog>` wraps a primary record surface; every `buildRecordPath` matches the AD-24 shape. 3.1 AC 3 and 3.3 AC 5 are `?raw` checks scoped to the framework's own files — they stop the framework special-casing an entity; they do nothing to stop an entity bypassing the framework. **Without this, Epic 3 hands Epic 5 zero enforcement and AD-24 is a document, not a contract.**

### 3-H. **UX-DR3 ("records live at URLs, not modals") is mapped to Epic 3 (`epics.md:127`) and owned by no Epic 3 story.** Live modals on `main`: `shidduchim/ShidduchShow.tsx:35` (killed by 5.1), `shidduchim/ShidduchCreate.tsx`, `tasks/TaskEdit.tsx`. The latter two are named by no story from Epic 3 through Epic 9. Assign or explicitly defer with a written trigger.

### 3-I. **Rewrite 3.7's premise section** (`:23-44`, `:142-145`) rather than retargeting lines — see §2/3.7. The story's conclusion (a separate private `entity-files` bucket) may survive; its justification does not.

### 3-J. **Decide, once, whether the four universal tabs exist in a shadchanus context.** `enforce_household_scope()` is attached to 13 tables via `04_triggers.sql:159-209`, including `interactions` (`:195-197`) and `tasks` (`:207-209`). So Activity, Notes and Tasks are structurally unavailable outside a household — and `8-5` ("shadchan's own CRM") is built on them. `entity_files` faces the identical undecided question in 3.7. Options: (a) scope the universal tabs "household contexts only" and say so in 3.5/3.7/3.8 and Epic 8; (b) own the lift of `interactions`/`tasks` out of the household-only set (`04_triggers.sql:147-158` warns this is *"a migration-time total insert outage, not a refactor"*). Do not leave it to a dev.

### 3-K. **Assign purge coverage.** `purge_polymorphic_dependents()` (`02_functions.sql:1799-1817`) is wired only to `references` and `shidduchim` (`04_triggers.sql:109-111,118-120`). 3.5 and 3.8 add two more target types; 3.7 adds a table the function does not know about, plus storage objects nothing deletes. Give it to 3.5 (triggers on `singles`/`shadchanim`) and 3.7 (`entity_files` + object cleanup), explicitly.

### 3-L. **Assign `types.ts`.** `Interaction.target_type` (`types.ts:477`) and `Interaction.deleted_at` are needed by 3.5 and 3.6; `TaskTargetType` (`:71`) by 3.8/3.9. No story lists the file. Whichever lands first owns it; say which.

### 3-M. **Decide: Tasks in the rail or in the tab bar — once, for every entity.** `5-1:36-37` gives the shidduch 360 a `tasks` tab; `5-7:50-51` AC 3 says the right-rail reminders panel *"**is** Story 3.8's `entity360/tabs/TasksTab.tsx` with `{ targetType: "shidduch", targetId }`"*. Same screen, same component, two surfaces. UX-DR5 puts Tasks in the tab bar; the mockup puts reminders only in the rail. Both stories are individually sanctioned; together they are per-screen invention by accretion.

### 3-N. **Nobody delivers stat data-loading.** 3.1 AC 6 punts it to 3.3; 3.3 types it as a pure function. Fixed by 3-A's `statBand?: (record) => ReactNode`, but say explicitly in 3.3 that the descriptor module — not `EntityShow` — owns the query.

---

## 4. Downstream contract — the API Epic 3 must produce

This is the section that prevents a 30-story rewrite. A builder should be able to diff their
implementation against it. Every consumer citation below was read.

### 4.1 `Entity360` (Story 3.1)

```ts
// entity360/Entity360.tsx
export interface Entity360Props {
  breadcrumb?: ReactNode;
  identityHeader?: ReactNode;
  statBand?: ReactNode;
  alertSlot?: ReactNode;
  tabBar?: ReactNode;
  children?: ReactNode;     // tab content
  rightRail?: ReactNode;
}
```
Fixed order, all optional, **no `className`, no `...rest`, no reorder prop**. Regions render in
AD-24's order (`ARCHITECTURE-SPINE.md:180`) whether or not neighbours are present.
`breadcrumb` and `alertSlot` currently have no consumer in Epics 4-9 — keep them (AD-24 names
them) and mark them reserved.

### 4.2 `EntityDescriptor` (Story 3.3) — **rewritten shape**

```ts
export type EntityDescriptor<T extends RaRecord = RaRecord> = {
  /** resource name as registered in routeManifest.ts (plural, e.g. "singles") */
  name: string;
  /** required; Epic 5 flips these from `/{r}/{id}/show` to `/{r}/{id}` */
  buildRecordPath: (id: Identifier) => string;

  label: string;                       // REQUIRED — 4-1:114 uses it as a translate fallback
  icon?: LucideIcon;

  // --- region renderers: ReactNode, not strings. Owned by the entity's module,
  //     which MAY call hooks (it is a component boundary, not a data shape).
  identityHeader?: ComponentType<{ record: T }>;
  statBand?: ComponentType<{ record: T }>;
  rightRail?: ComponentType<{ record: T }>;
  actions?: ComponentType<{ record: T }>;   // rendered INSIDE identityHeader region
  alertSlot?: ComponentType<{ record: T }>;

  // --- default composition, used only when identityHeader is absent
  avatar?: (record: T) => { seed: string };
  title?: (record: T) => string;
  meta?: (record: T) => (string | null | undefined)[];

  tabs?: EntityTabDescriptor<T>[];
  relationships?: EntityRelationshipDescriptor[];  // see 4.6
};

export type EntityTabDescriptor<T> = {
  key: TabKey;                          // closed union — see §3-F
  label: string;
  render: (record: T) => ReactNode;
  visibleTo?: MemberRole[];             // absent = visible to every role
};
```

Rules a builder must satisfy:
- `ComponentType`, not `(record) => ReactNode`, for every region — it is the only shape that
  can call `useGetOne`/`useGetList` (5.9's stat band, 8.5's connection stats).
- `EntityShow` renders **exactly** the seven regions from these fields and nothing else, and
  contains no entity name. The `?raw` boundary test asserts no import from **any sibling
  directory of `entity360/`** (not a four-name alternation — `connections/` exists in 8.5).
- `MemberRole` is **imported from `src/components/atomic-crm/types.ts:109-110`**, never
  re-declared.

### 4.3 Registry (Story 3.3) — three functions, not two

```ts
registerEntityDescriptor<T>(d: EntityDescriptor<T>, opts?: { replace?: boolean }): void;
getEntityDescriptor(name: string): EntityDescriptor | undefined;   // callers must guard
requireEntityDescriptor(name: string): EntityDescriptor;           // fail-fast, throws
```
- Duplicate `name` without `{ replace: true }` throws. **With** it, replaces — this is what
  `4-1:162`, `5-1:93`, `5-8:105`, `5-9:95`, `5-10:106` all mean by "extend"/"fill in".
- **Home:** `src/components/atomic-crm/<entity>/entityDescriptor.ts`, eagerly imported. The
  eager-import mechanism already exists: `root/routeManifest.ts:6-18` imports every resource
  index module at module scope and `CRM.tsx` maps over `RESOURCES` (`routeManifest.ts:93-99`)
  at boot, so registration is complete before first render. 3.9's four stubs must be written
  as **files Epic 5 will replace**, not literals four stories concurrently hand-edit.
- 4.1 consumes `label` today (`4-1:114`) and nothing else (`4-1:234`). `icon`/`meta`/`stats`
  have no list consumer — either wire them in 4.1 or drop the expectation from `8-5:24`.

### 4.4 Routes (Story 3.2)

```ts
buildEntityRoutes(config: {
  List: ComponentType;
  New?: ComponentType;
  Edit?: ComponentType;
  Show: ComponentType;
}): ReactElement;   // nested <Routes>: index | "new" | ":id/edit" | ":id" | ":id/:tab"
```
- The entity registers **only `list`** on `<Resource>`, **plus explicit `hasShow`/`hasEdit`
  props** (`ra-core/dist/core/Resource.js:33-34`) so `useGetPathForRecord` and
  `admin/data-table.tsx:233` keep resolving row links.
- `:id` and `:id/:tab` are wrapped in `ShowBase` so a `RecordContext` exists.
- Unknown tab → first **visible** tab, evaluated on every location change, `replace` not
  `push`. Unknown/out-of-context record → an explicit handled state, never a blank screen.
- Route segment is `new`, not `create` (§3-C), and `useCreatePath`/`CreateButton`/`EditButton`
  are overridden accordingly.

### 4.5 Tabs & visibility (Stories 3.2 / 3.4)

```ts
<Entity360Tabs tabs={{ key: TabKey; label: string; render: () => ReactNode }[]} />
hasVisibility(visibleTo: MemberRole[] | undefined, role: MemberRole | undefined): boolean;
useViewerRole(): MemberRole | undefined;   // = useMyContexts().data?.find(c => c.is_active)?.role
```
- `render` is lazy (`() => ReactNode`) so no subtree is constructed for an unopened tab.
- Filtering happens **before** the array reaches `Entity360Tabs`; a denied tab's `render` is
  never called and its label never enters the DOM.
- `undefined` role (pending) fails closed **without navigating** — see 3.4's loading finding.

### 4.6 `RecordLink` (Story 3.9)

```tsx
<RecordLink resource="singles" id={42}>{label}</RecordLink>
// path = requireEntityDescriptor(resource).buildRecordPath(id)
```
- Unregistered resource: render an inert `<span>` + `console.error` — **do not throw at
  render**. 3.5 AC 5 links from free-form `interactions.metadata` that clients can write
  (`06_grants.sql:615-616`); a throw blanks the whole Activity tab.
- Preserve `{ _scrollToTop: false }` behaviour for board cards (`ShidduchCard.tsx:89-100`) and
  keep dnd prop spreads **before** `onClick` (`ShidduchCard.tsx:101-108`).

### 4.7 Universal tabs (Stories 3.5-3.8)

```ts
type UniversalTabProps = {
  targetType: "shidduch" | "single" | "shadchan" | "reference";
  targetId: Identifier;
};
ActivityTab | NotesTab | FilesTab | TasksTab  // all take exactly this
```
Backing DB vocabulary must end up identical across `tasks_target_type_check`
(`01_tables.sql:45-47`), `interactions_target_type_check` (`:458-459`) and the new
`entity_files` check, with **one** TS source of truth in `types.ts`. Each new target type
gets a purge trigger. `connection` is Epic 8's to add, not Epic 3's.

### 4.8 Related records (optional but recommended)

`relationships` is currently declared and rendered by nobody, while three stories hand-roll
the same thing (`5-8` Task 5 `shidduchim` tab, `5-10:114` `linked-shidduchim`, `8-5:24`).
Either **delete the field**, or define it as
`{ key: TabKey; label: string; resource: string; getFilter: (record) => object }` and ship a
generic `RelatedRecordsTab` in 3.3. Note `{resource, foreignKey}` cannot express
`reference → reference_links → shidduchim`, the one many-to-many the domain actually has.

---

## 5. Recommended build order

| # | Story | Why here |
|---|---|---|
| 0 | **3-F (tab vocabulary)** + `types.ts` ownership + §3-A/3-C decisions | Story-refresh work, not code. The closed `TabKey` union and the rewritten `EntityDescriptor` are inputs to 3.3, and 3.3 is an input to everything. Doing this after 3.3 ships means editing a shipped public type mid-Epic-5. |
| 1 | **3.1** `Entity360` + `EntityAvatar` | No dependencies. Pure presentational. Resolve the AC3/AC4 contradiction first. |
| 2 | **3.3a** — descriptor **types + registry only** (no `EntityShow`) | Split from 3.3. The registry has no dependency on the shell, and 3.9 needs it immediately. Ships `EntityDescriptor`, `EntityTabDescriptor`, `register/get/requireEntityDescriptor`, and the `<entity>/entityDescriptor.ts` convention. |
| 3 | **3.9** `RecordLink` + the four stub descriptors | Needs 3.3a's registry. **Must precede 3.8** — it owns `reminderEntity.ts`'s `Record<TaskTargetType, string>` maps, and `useReminders.ts:42-45,69-97`. Also the only Epic 3 story that touches live files, so it lands the AD-23 `"Suggestion"` fix. |
| 4 | **3.2** `buildEntityRoutes` + `Entity360Tabs` + `ShowBase` wiring + `hasShow/hasEdit` + `/new` | Needs 3.1's `tabBar`/`children` regions. Owns the routing conflicts (`useCreatePath` ×3, `hasShow/hasEdit`, record context) — all framework-wide, all cheaper before any consumer exists. |
| 5 | **3.3b** `EntityShow` | Needs 3.1 (shell), 3.2 (`Entity360Tabs`), 3.3a (descriptor). This is the piece that composes seven regions from the descriptor. |
| 6 | **3.4** permission-aware rendering | Additive `visibleTo` on 3.3a's types; needs 3.3b to have somewhere to filter; needs 3.2's fallback path. Owns `useViewerRole()` for real and `canAccess.ts`. |
| 7 | **3.5** Activity | First universal tab. Owns the `target_type` widening, `current_member_id()`, the purge triggers, and `types.ts` if it lands first. Everything downstream reuses these. |
| 8 | **3.6** Notes | Hard dependency on 3.5's `current_member_id()`, `set_interaction_actor_member_id`, `interactionLabels.ts`, and the widened enum. |
| 9 | **3.8** Tasks | Needs 3.9 (the `Record` maps) — that is the ordering fix. Independent of 3.5/3.6 otherwise; placed here so the two interaction stories stay adjacent. |
| 10 | **3.7** Files | Heaviest new surface (bucket + table + policies + grants + FakeRest mirror) and depends on 3.5's four-value vocabulary and `current_member_id()`. Last so its premise rewrite and the household-scope decision (§3-J) have the most information. |
| 11 | **3-G (conformance validator)** | Needs every primitive to exist before it can assert on them. Must land **inside Epic 3**, before Epic 5's first migration, or it never lands. |

Epic 5 must not start until steps 0-11 are done. 5.1 is the pilot and hits §3-A's three
missing fields, §3-B's record context and §3-C's Create button on its first day.

---

## 6. Landmines

1. **The reflex is to grep `ChildProfileHeader` / `SimpleListItem` / `getPublicUrl` and, finding nothing, invent the file.** All three are deleted or never existed. `getPublicUrl` has **0 hits** repo-wide; `children/` and `simple-list/` are gone. **Do instead:** treat any Epic-3 path with `child`/`Child`/`simple-list` as "verify against `main` before use", and remember `scripts/check-retired-names.mjs` will fail CI on the old names. **Assert:** the story's File List resolves with `ls` before the ticket is marked ready.

2. **The reflex is to make `EntityAvatar` Tailwind-only, per 3.1 AC 3.** The `--avatar-{0..9}` index is dynamic; Tailwind cannot express it without an arbitrary-value class or safelist, and AC 4 requires "exactly as today", which is an inline `style`. **Do instead:** carve `backgroundColor` out of AC 3's ban explicitly. **Assert:** the four migrated chips render the same computed `background-color` as `boardUtils.getAvatarIndex` produces, not that the string `style=` is absent.

3. **The reflex is to register the migrated entity as `list`-only, per 3.2's resolution, and stop there.** `Resource.registerResource` then sets `hasShow: false, hasEdit: false` (`ra-core/dist/core/Resource.js:33-34`), and `useGetPathForRecord` returns no path, so **every `<DataTable>` row for that entity stops being clickable** (`admin/data-table.tsx:233`). `singles`, `shadchanim` and `references` all register full CRUD today. **Do instead:** pass explicit `hasShow`/`hasEdit` props — `<Resource>` accepts them. **Assert:** a `<DataTable>` row click for a migrated entity still navigates, in a test, before the migration is called done.

4. **The reflex is to leave `<EditButton>`/`<CreateButton>` alone because they "just work".** `useCreatePath.js:48` returns `/{resource}/{id}` for `edit` — **byte-identical to AD-24's show URL** — and `:46` returns `/{resource}/create` while 3.2 routes `"new"`. **Do instead:** override both in the same story that flips the route shape. **Assert:** clicking Edit on a migrated entity lands on `/{entity}/{id}/edit`, and clicking Create lands on `/{entity}/new`.

5. **The reflex is to write the descriptor's `stats` as a pure function because that is what the type says.** The only real stat band in the app is `useGetOne("shadchan_stats")` (`ShadchanShow.tsx:40-43`, view at `03_views.sql:202`). `singles_summary` happens to carry its counts inline, so a fixture test on `singles` passes and 5.9 dies. **Do instead:** `statBand?: ComponentType<{record}>` (§4.2). **Assert:** the shadchan descriptor's stat band renders three tiles with a pending state, in a test, using the real view.

6. **The reflex is to build `useViewerRole()` from `members.administrator` because 3.4 AC 5 says so.** It is a **global per-login** column (`01_tables.sql:14-23`), so a login with household + shadchanus memberships gets the same role in both, and `self_manager`/`single` become unreachable — silently dead-coding `5-5:86`, `6-1:141`, `6-4:169`. `getIdentity` doesn't even expose it (`authProvider.ts:16-20`). **Do instead:** `useMyContexts().data?.find(c => c.is_active)?.role`. **Assert:** after `ContextSwitcher` switches contexts, `useViewerRole()` returns a *different* value for a login that holds two memberships with different roles.

7. **The reflex is to fail closed on `viewerRole === undefined` and let 3.2's unknown-tab fallback handle it.** On first paint the role is always `undefined`, every restricted tab is filtered out, the fallback fires, and 3.2 AC 2's history **push** rewrites the deep link before the role resolves. **Do instead:** render a pending state and do not navigate while the role query is in flight; when you do fall back, `replace`. **Assert:** deep-linking to a permitted restricted tab leaves `location.pathname` unchanged after the role resolves, and adds no history entry.

8. **The reflex is to write `and am.role = 'parent_admin'` for "owner" checks.** `02_functions.sql:439-444` `is_owning_membership_role()` exists precisely so this list cannot diverge, and a `self_manager` household may contain no `parent_admin` at all. **Do instead:** call the function. **Assert:** a `db`-project test where the only membership is `self_manager` can still moderate a helper's note.

9. **The reflex is to resolve note authorship through `current_member_id()` (`account_members.id`).** `remove_persona()` archives and `add_persona()` **inserts** (`02_functions.sql:770,863` / `:531,574,598`); the unique index is partial (`01_tables.sql:710`), so a re-added persona gets a **new id** and loses edit/delete on every note they wrote. **Do instead:** compare on `user_id` via a join. **Assert:** archive + re-add a persona and confirm the author still owns their prior notes.

10. **The reflex is to say "no RLS change needed" after reading the policy.** For `tasks` and `interactions` the blocker is a **trigger**, not a policy: `enforce_household_scope()` (`04_triggers.sql:195-197`, `:207-209`) raises for any `kind='shadchanus'` context. Policy-only reasoning produces a change that typechecks, passes every mocked test, and dies with a raw Postgres exception for shadchanim in their own context — the case Epic 8 is built on. **Do instead:** grep `04_triggers.sql` for the table name before concluding. **Assert:** a `db`-project insert under a shadchanus context, with the intended outcome stated.

11. **The reflex is to widen a `target_type` CHECK and move on.** `purge_polymorphic_dependents()` (`02_functions.sql:1799-1817`) is wired to only `references` and `shidduchim` (`04_triggers.sql:109-111,118-120`), and `interactions.target_id` carries no FK by design. Every new target type without a purge trigger strands rows that later surface as reminders pointing at dead ids. **Do instead:** add the trigger in the same story. **Assert:** deleting a single/shadchan leaves zero `tasks`/`interactions`/`entity_files` rows for it.

12. **The reflex is to render `RecordLink` from `interactions.metadata` and let it throw on a bad resource.** `metadata` is client-writable `jsonb` (`06_grants.sql:615-616`); one stale `linkedResource` blanks the whole Activity tab, and AC 7's error state covers fetch errors only. **Do instead:** guard on registry membership, fall back to plain text. **Assert:** an interaction row with `linkedResource: "nope"` still renders the rest of the tab.

13. **The reflex is to write a "two accounts, two users" cross-tenant negative test.** Epic 2's whole point is *one user, several contexts*; two disjoint users pass without ever exercising `current_context_id()`'s active-context resolution — the exact thing that regresses. **Do instead:** one login with memberships in A and B, active in A. **Assert:** B's rows/objects are invisible while A is active, and the same login sees them after `set_active_context`.

14. **The reflex is to import `ListPaginationContextProvider` from `ra-core` because 3.5 names it.** It does not exist; only `ListPaginationContext` does, and `useListPaginationContext` **throws** if the context is missing (`useListPaginationContext.js:16`) — a hard crash inside `admin/list-pagination.tsx`, not a degraded render. `ListPaginationContextValue` needs 10 fields; `useGetList` gives 2. **Do instead:** either provide all 10 explicitly or drop the pagination-context requirement. **Assert:** the tab renders with `<ListPagination>` mounted.

15. **The reflex is to write `?raw` source-scanning tests and count them as coverage.** Three of them in Epic 3 cannot fail: 3.1 AC 3's regex (3-digit px only, no `rgb`, no inline-style branch, and true by construction under `flex flex-col`), 3.3 AC 5's four-name alternation (`if (resource === "shidduchim")` passes; `connections/` isn't listed), and 3.7 AC 4(a) (greps for `getPublicUrl`, which exists nowhere in the repo). **Do instead:** make each assert a behaviour or, if it must be a source scan, widen it and prove it fails on a deliberately-broken fixture. **Assert:** every guard test is shown red once before it is shown green.

16. **The reflex is to trust the mockup for tab sets.** `mockup/MyShadchan.dc.html` predates AD-24, is internally inconsistent (9-tab shidduch `:1752`, 3-tab shadchan `:1609`, tabless reference `:1217`, no single 360), and ships a "Child portal" parallel surface (`:1856-1857`) that AD-24 forbids and Epic 1 deleted. `mockup/uploads/ARCHITECTURE-SPINE.md` contains no AD-24 at all. **Do instead:** use `amendment-a2.md:166-172` (UX-DR4 vocabulary + UX-DR5 matrix). **Assert:** each Epic 5 entity's declared tab set matches the UX-DR5 row for it, by test if the `TabKey` union lands.

---

## 7. Not problems — refuted; do not "fix" these

- **The registry is *not* broken by context switching.** No story needs two descriptors for one `name`: `8-5` registers a **new** resource (`connections`, `8-5:24,72-74`), so the duplicate-name throw is never reached. Per-viewer variation already happens at render — the dynamic fields are functions and `3-4:126` gates through a hook, re-evaluated after `ContextSwitcher.tsx:98-101` invalidates every query. Context-**kind** routing lives on `routeManifest.ts` via `8-1:52-55`'s `<RequireContextKind>`, not on the descriptor. **Do not re-key the registry by `(name, contextKind)`.** The real defect is narrower and is in §3-A: no *extend* API.
- **`RecordLink` throwing will not white-screen on import order.** `root/routeManifest.ts:6-18` eagerly imports every resource index module at module scope and `CRM.tsx` maps over `RESOURCES` at boot, so an `8-5`-style `connections/index.ts` registration is loaded before any render. (Degrade rather than throw anyway — but for the `metadata` reason in §6.12, not this one.)
- **`<Resource>` does *not* lack a way to keep `hasShow`/`hasEdit`.** `ra-core/dist/core/Resource.js:33-34` reads `!!edit || !!hasEdit` / `!!show || !!hasShow` — both are accepted props. The regression is real; the remedy is two props, not a framework change or a new story.
- **Epic 3's 4 universal tabs do *not* conflict with the design's 9 per-entity tabs.** `amendment-a2.md:166-167` (UX-DR4) names `Overview, Activity, Notes, Tasks, Files, Related` as the *shared* vocabulary, and `:168-172` (UX-DR5) gives the per-entity matrix. Epic 5's declared tab sets match UX-DR5 line for line (`5-9:62` shadchan is exact; `5-8:106-107` single is exact; `5-10:69` reference is exact + one sanctioned exception; `5-1:40-42` quotes the shidduch matrix verbatim). Two compatible layers, working as designed.
- **`EntityList` is *not* unowned.** `4-1` is that story (AC 1-7, `EntityList`/`EntityListView`/`useEntityListStatus`, three lists retrofitted, URL-held state) and it **does** consume the descriptor (`4-1:29,43-44,114,236-237`). The residual is only that `icon`/`meta`/`stats` have no list consumer and `shidduchim`/tasks/reminders/inbox/members never migrate.
- **`8-5` does not have to hand-roll its Connections list.** `EntityList`'s row rendering is an injected `renderItems` prop (`4-1:104,112,166`); supplying a `ConnectionCard` *is* using the framework.
- **Missing `minVisibility` declarations across 5.1/5.6/5.8/5.10 are not a gap.** `3-4:47-48` makes absence mean "visible to every role"; `6-3:281-285` states in writing that *"This story guarantees the data is never sent regardless of what the client renders (AD-1's actual requirement)"*; `7-1:274` deliberately declares none. `5-5:86` is the one sensitive tab that needs one, and it has one.
- **`useViewerRole()` being provisional through Epics 4-5 is an owned, sequenced limitation, not an unowned mismatch.** `5-5:155-163` states it and says *"do not 'fix' the hook inside this story's diff"*; `6-3:280-285` and `6-4:64-70,154-164` own the rewire. (§3-D still recommends doing it in 3.4 — that is advice about cost, not a defect report.)
- **`relationships` having no renderer breaks nothing today.** `3-3` says outright no relationship-rendering is built; `5-8:113`, `5-10:69-73` and `8-5:24` each hand-write theirs by design. It is a dead field to delete or fill (§4.8), not a downstream break.
- **Eager `render(record)` does not violate 3.4's "never invoked" guarantee.** `3-4:69-79` and Task 4 filter *before* the array reaches `Entity360Tabs`; calling `render` on surviving tabs creates elements, runs no hooks and fetches nothing. Lazy `() => ReactNode` is a cheap improvement, not a fix.
- **The four `buildRecordPath` flips are not a merge hazard.** `5-1:109-110`, `5-8:107-108`, `5-9:107-108`, `5-10:106-108` are one-line edits to a table, and `3-9:65-72` designed the pinning test to fail loudly. Ordinary sequential work.
- **`minVisibility` being an allow-list rather than a threshold, and `breadcrumb`/`alertSlot` having no consumer, are not defects.** Rename `minVisibility` → `visibleTo` if convenient; keep the two regions (AD-24 names them).
- **`connections` lacking a `target_type` value is not a gap today.** `8-5` AC 3 asks only for a Conversations tab; Notes/Files/Tasks/Activity on a Connection 360 would need a constraint migration, which is Epic 8's if it ever happens.
- **3.1's avatar census (AC 5) and 3.9's 12-site sweep are both accurate.** Re-verified: 10 files import `getMonogram|getAvatarIndex`; 3.9's command-1 grep returns exactly 9 hits in exactly the 9 named files. **Do not "correct" either inventory.**
- **`shidduchim` already being `list`-only does *not* mean the row-click regression is already accepted.** It renders as a Kanban board and never goes through `<DataTable>`, so nothing calls `useGetPathForRecordCallback` for it. The regression is genuinely **new** for `singles`/`shadchanim`/`references`.
- **Do not "simplify" 3.5's `current_member_id()` resolver on the strength of Epic 2's new unique index.** `account_members_account_user_active_uq` is **partial** (`where status='active'`, `01_tables.sql:710`); it does not make `order by id limit 1` redundant across archived rows — which is the exact mechanism behind the 3.6 authorship bug.

### Anchor corrections (the reports disagree with each other; these are the read values)
`SingleProfileHeader` `singles/SingleShow.tsx:42` (chip `:57-64`) · `ReferenceShow.tsx` chip `:48-56` ·
`account_members_account_user_active_uq` `01_tables.sql:710` (not `:131-133` — that is a *policy comment* in `05_policies.sql` mentioning it) ·
`account_members_user_id_fkey` `01_tables.sql:592`; `members_user_id_fkey` `:71` ·
`interactions_target_type_check` `01_tables.sql:458-459` (`:460-462` is the `kind` check) ·
`shidduchim_visibility_check` opens `01_tables.sql:303` ·
`admin/file-input.tsx` `useInput` at `:14` · `root/routeManifest.ts` is **261** lines · `07_storage.sql` is **44** lines, policies `:25-44` ·
`references/ReferenceShow.tsx` tabs `:129-165`.

---

## 8. Unowned work (S1-S12) — disposition

| # | State on `main` | Owner |
|---|---|---|
| **S1** storage hardening | **Half done.** Bucket private + context-scoped policies shipped (`07_storage.sql:19,25-44`); `getPublicUrl` gone. AD-9's Worker proxy-stream + `share_access_log` **not** done — `workers/share/index.ts` is 14 lines with a "future work" comment at `:7`, and the app still hands out signed URLs (`dataProvider.ts:716`). | Close the `current_context_id()` half as **done**. Proxy-stream half → **own story in Epic 9**. |
| **S2** FORCE RLS + CI assertion | **Not done, and the surface grew.** Live DB: 22/22 tables RLS-enabled, **0 forced**; 20 `SECURITY DEFINER` functions in `public`, all owned by `postgres` (which bypasses unforced RLS). Only artefact is the comment at `01_tables.sql:85`. CI `guards` job runs suppression + retired-name checks only; the `db` suite asserts `relrowsecurity` on 5 tables total and never `relforcerowsecurity`. Note `accept_invite` does an **unscoped** read of `invites` that only works *because* RLS is unforced — a blanket retrofit breaks invite acceptance. AD-1's "one scoping axis" clause also needs a justified allowlist (`accounts`, `members`, `member_state`, `configuration`, `pipeline_transitions` legitimately have none; **zero** tables have `connection_id`). | **Own story, before Epic 3.** Split: (a) CI assertion + allowlist — cheap, ship now; (b) the retrofit with designed bypasses. |
| **S3** invite-token hashing split | `invites.token uuid … unique` raw (`01_tables.sql:193`); zero `sha256`/`digest` in `supabase/schemas/`. `8-2:119,131-133` specifies `token_hash` + pgcrypto. 2.7's raw table is **live in production**. | **Decision story now** — align `invites` to hashing (one-table migration today) or have the architecture owner bless the split in the spine. Cheaper before 8.2. |
| **S4** `target_type` extensibility | `tasks` = 3 values (`01_tables.sql:45-47`); no `connections` table, no `connection_id` on any table. | **Enum-shape half → 3.8** (state the union in one place, prove adding a value is one line). The `'connection'` value → **Epic 8**, with 8.2/8.5. |
| **S5** reminder delivery | **Worse than "unwired".** `workers/cron/index.ts`'s entire `scheduled` handler is `console.warn("[cron] sweep tick")`; `wrangler.toml:9` `crons = ["*/15 * * * *"]`; the deploy workflow ships it with `RESEND_API_KEY`. A stub is firing in production every 15 minutes. `public.tasks` has **no** `delivered_at`/`last_notified_at`, so a real sweep needs a migration. | **Own story in Epic 7 (call it 7.6)**, scope including the idempotency-column migration. |
| **S6** AD-8 tracing / AD-17 rate limiting | Zero progress: no Langfuse, no limiter, no account-namespaced cache. The only `rate.limit` hit is GoTrue's own `over_email_send_rate_limit` being swallowed at `authProvider.ts:84`. Epic 2's OTP flow is a shipped, unlimited enumeration surface. | **Split.** Auth/invite rate limiting → **own story now**. Langfuse + cache → **defer, trigger = first real inference call (Epic 11.1)**. |
| **S7** descriptor ↔ list contract | `entity360/` does not exist. The escalation text in `epics.md:1252-1257` and `3-3:33-49` quotes 4.1 language deleted by the same commit; `4-1` now consumes `label`. | **Rewrite, do not close.** Narrow `epics.md`'s 3.3 AC to the 360 half; residual = `icon`/`meta`/`stats` unconsumed and four resources never on `EntityList` → one Epic 4 story. |
| **S8** inbound-email stack | `supabase/functions/postmark/` is the live ingress; `workers/ingest/index.ts:7` still says postal-mime parsing is "separate future work". | **Defer with a written trigger** (Postmark cost/volume, or S9 landing). Record it next to AD-6 so the stack table stops describing something unshipped. |
| **S9** per-account inbound addresses | One global `VITE_INBOUND_EMAIL`. | **Epic 10**, sequenced **after** S8. |
| **S10** e2e OTP helper | **Done** — `e2e/fixtures.ts` exports a shared `fetchOtpCode` + two-step passwordless sign-in, consumed by multiple specs. (`e2e/` is being rewritten concurrently; the finding is "the shared helper exists", not the line numbers.) | **Close.** |
| **S11** delivery-channel enum collision | Not live: `TaskDeliveryChannel` exists (`types.ts:74`); `MessageNotificationChannel` has zero hits. `3-8:57-60` correctly declines a channel picker. | **Defer, trigger = 7.5 introduces the second enum.** Add one AC line to 7.5: reuse `TaskDeliveryChannel` or justify the second type. |
| **S12** FR coverage map | Stale. `epics.md:126-137`: the Epic 8 row omits AD-22/AD-24/AD-19; the **Epic 3 row omits UX-DR2** even though `3-2` delivers the route convention the map assigns to Epic 4. | **First task of the Epic 3 re-story pass.** Rebuild the map from the story files, cross-check every row. A stale map is how S7 got through the first time. |

**Two additions this pass surfaces:**

- **S13 — the five-value role has a DB half and no client half.** `account_members.role` carries the AD-2 constraint (`01_tables.sql:153-155`) and `my_contexts()` exposes it (`02_functions.sql:341`), but the client still resolves permissions from a boolean: `authProvider.ts:151` → `canAccess.ts:16`. There is no `current_member_role()` among the definer functions. §3-D assigns the client half to 3.4; the *server* helper and the `canAccess` retirement need an owner.
- **S14 — the household/shadchanus scope of the universal tabs.** `enforce_household_scope()` on 13 tables (`04_triggers.sql:159-209`) makes Activity/Notes/Tasks — and, by default, Files — unavailable in a shadchanus context, which is what Epic 8 Story 8.5 is built on. See §3-J. Currently owned by nobody in any epic.
