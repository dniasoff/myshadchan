# Slop Cleanup Worklist — MyShadchan (Calm Ledger theme)

Synthesized from five category audits (COLORS, INLINE/ARBITRARY, LAYOUT, DEAD-CODE, A11Y/TS).
Scope: `src/components/atomic-crm/**` + `src/components/ui/**` (+ a few `src/components/admin/**`).
**Excludes** the Deals -> Suggestions data-model/schema rewrite (separate epic). Deals items here are cosmetic only.
All line numbers are from the audits; verify the exact snippet before editing (files drift).

---

## SAFE FAST PASS (pure mechanical token swaps — batch + validate in one go, near-zero risk)

These are 1:1 palette-class -> semantic-token substitutions with no layout/logic change. Apply together, then run
`make lint` + `make typecheck` + a visual smoke of the affected screens:

- **Skeleton/placeholder greys -> `bg-muted`:** `activity/ActivityLogDealCreated.tsx:30`, `simple-list/SimpleListLoading.tsx:24`, `simple-list/SimpleListLoading.tsx:40`, `simple-list/ListPlaceholder.tsx:8`, `companies/GridList.tsx:13`.
- **Success ticks -> `text-positive`:** `dashboard/DashboardStepper.tsx:66`, `dashboard/DashboardStepper.tsx:75`, `contacts/ContactPersonalInfo.tsx:109`.
- **Error link -> `text-destructive hover:text-destructive/80`:** `contacts/ContactImportButton.tsx:135`.
- **Selection ring -> `ring-ring`:** `tags/RoundButton.tsx:5`.
- **Dropzone helper text -> `text-muted-foreground`:** `misc/ImageEditorField.tsx:170`.
- **Nivo hex -> CSS var (pattern already established in this file via `var(--color-muted-foreground)`):** `dashboard/DealsChart.tsx:184` `#2ebca6 -> var(--positive)`, `dashboard/DealsChart.tsx:193` `#f47560 -> var(--destructive)`, `dashboard/DealsChart.tsx:196` `#e25c3b -> var(--destructive)`.

Everything else needs at least a small judgement call (semantic mapping, contrast in dark mode, or a code change) and is broken out below.

---

## P1 — Real bugs / broken layout / broken a11y

### `src/components/atomic-crm/layout/MobileNavigation.tsx`
- **:45-53 · Invalid CSS silently dropped (latent bug).** `height: "calc(var(--spacing)) * 6" + (…)` puts `* 6` **outside** `calc()`, so the whole `height` property is invalid and dropped; only the className `h-14` applies, and the iOS safe-area padding relies on UA-sniffing + magic `15`.
  **Fix:** delete the inline `height` (and the `paddingBottom` magic-15 hack); keep `h-14` and add `pb-[env(safe-area-inset-bottom)]` to the className, dropping the whole `style` block.
  **Risk:** needs-care (verify iOS PWA bottom inset on device/sim). **Effort:** M.

### `src/components/atomic-crm/settings/SettingsPage.tsx`
- **:248 + :469 · Dead right-hand void + save bar on a different centering model (must fix both together).** Content row (`:248 flex gap-8`, nav `w-48` + `gap-8` + content `max-w-2xl` ~= 896px) is left-aligned in the 1280px `max-w-screen-xl` main, leaving ~384px empty on the right; the fixed save bar (`:469 max-w-screen-xl mx-auto`) re-centers on a *different* cap, so save/reset don't sit under the form columns and the offset grows with viewport width.
  **Fix:** `:248` -> add `max-w-4xl mx-auto` (`flex gap-8 mt-4 pb-20 max-w-4xl mx-auto`); `:469` -> change `max-w-screen-xl` to `max-w-4xl` (`max-w-4xl mx-auto flex gap-8 px-4`). Both = 896px so columns align.
  **Risk:** needs-care (coupled — changing one re-breaks alignment; verify at >=1280px and md). **Effort:** S.

### `src/components/atomic-crm/companies/GridList.tsx`
- **:10 · Skeleton fixed `w-[1008px]` overflows narrow viewports and mismatches the real grid.** The loaded grid (`:27-31`) is responsive (`w-full grid` + `gridTemplateColumns: repeat(auto-fill, minmax(180px,1fr))`); the loading block is a fixed 1008px flex-wrap that overflows -> horizontal scroll.
  **Fix:** `:10` -> `<div className="w-full gap-2 grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>` to mirror `LoadedGridList`.
  **Risk:** needs-care (skeleton layout parity). **Effort:** S.
- **:13 · Skeleton card fixed size + off-theme grey.** `h-[200px] w-[194px] flex flex-col bg-gray-200`.
  **Fix:** `h-[200px] w-full flex flex-col bg-muted rounded` (drop fixed width; grey -> token). **Risk:** pure-swap. **Effort:** S. *(The `bg-gray-200 -> bg-muted` half is in the Safe Fast Pass; the width change is layout.)*

### `src/components/atomic-crm/simple-list/SimpleListItem.tsx`
- **:61 · Broken Tailwind focus class (a11y — primary list-row target).** `focus: bg-muted` (space) splits into an invalid `focus:` token + an **unconditional** `bg-muted`, so rows are always tinted and the focus highlight never renders.
  **Fix:** `focus:bg-muted` (no space).
  **Risk:** pure-swap. **Effort:** S.
- **:58 · `<button>` missing `type`.** Defaults to `type="submit"`.
  **Fix:** add `type="button"`. **Risk:** pure-swap. **Effort:** S.

### `src/components/atomic-crm/tags/TagChip.tsx`
- **:26-30 · Clickable `<div onClick>` opens TagEditModal but is keyboard-inaccessible.** No `role`/`tabIndex`/`onKeyDown`.
  **Fix:** make it `<button type="button">` (move the nested unlink button to a sibling — a button can't nest in a button), or add `role="button" tabIndex={0}` + Enter/Space `onKeyDown`.
  **Risk:** needs-care (restructure to avoid nested interactive elements). **Effort:** M.
- **:32 · Icon-only unlink `<button>` has no accessible name and no `type`.** Only unlabeled icon button in the domain.
  **Fix:** add `type="button"` + `aria-label={translate("ra.action.remove", { _: "Remove tag" })}` (or `sr-only` span).
  **Risk:** pure-swap. **Effort:** S.
- **:27 · `text-black` on pastel tag swatch.** See P2 tag-contrast cluster — do NOT blind-swap to `text-foreground`. **Effort:** M (shared with cluster).

---

## P2 — Token & style slop (semantic-token mapping / safe pure-swaps)

### `src/components/atomic-crm/misc/ImageEditorField.tsx`
- **:166 · Dropzone surface/border greys.** `bg-gray-50 … border-gray-300 … hover:bg-gray-100`.
  **Fix:** `bg-muted border-input hover:bg-accent` (or `hover:bg-muted/80`). **Risk:** needs-care (dropzone contrast in both themes). **Effort:** M.
- **:170 · Helper text grey** `text-gray-600 -> text-muted-foreground`. *(Safe Fast Pass.)* **Risk:** pure-swap. **Effort:** S.
- **:35-36,55,64 · Magic default sizes.** `props.width || (avatar ? 50 : 200)` inline `style`. Dynamic prop is fine; hoist defaults to `AVATAR_SIZE = 50` / `IMAGE_SIZE = 200` constants. **Risk:** pure-swap. **Effort:** S.

### `src/components/atomic-crm/misc/Status.tsx`
- **:23 · Hand-rolled tooltip** `text-white bg-gray-800`.
  **Fix:** `bg-popover text-popover-foreground` (or `bg-foreground text-background` for an inverted tooltip; or replace with the `ui/tooltip` primitive). **Risk:** needs-care (verify contrast — was a fixed dark chip). **Effort:** S.

### `src/components/atomic-crm/deals/DealShow.tsx` (Deals cosmetic — in scope)
- **:192-193 · Archived banner** `bg-orange-500` + child `text-white`.
  **Fix:** `bg-attention-strong text-attention-foreground` (attention/warning surface). *(Audits split on `bg-attention` vs `bg-attention-strong`; prefer `-strong` for a full banner fill.)* **Risk:** needs-care (semantic choice). **Effort:** S.

### `src/components/atomic-crm/dashboard/DealsChart.tsx` (Deals cosmetic — in scope)
- **:106 · Series colors** `["#61cdbb","#97e3d5","#e25c3b"]` for `["won","pending","lost"]`.
  **Fix:** `["var(--positive)", "var(--chart-3)", "var(--destructive)"]` (or chart-native `chart-1/2/3`). **Risk:** needs-care (legibility). **Effort:** M.
- **:184 / :193 / :196 · Marker hexes** -> `var(--positive)` / `var(--destructive)` / `var(--destructive)`. *(Safe Fast Pass.)* **Risk:** pure-swap. **Effort:** S.
- **:52,66,201 · TS suppression** `{} as any`, `@ts-expect-error - multiplier type issue`, `[...] as any`.
  **Fix:** type the reducer accumulator + Nivo config instead of suppressing. **Risk:** needs-care. **Effort:** M. *(Also see P3 TS smells.)*

### `src/components/atomic-crm/sales/SalesList.tsx`
- **:29 · Admin badge outline** `border-blue-300 dark:border-blue-700`.
  **Fix:** `border-primary` (drop the `dark:` variant — token is theme-aware). **Risk:** needs-care (semantic choice). **Effort:** S.
- **:37 · Disabled badge outline** `border-orange-300 dark:border-orange-700`.
  **Fix:** `border-attention`. **Risk:** needs-care. **Effort:** S.

### `src/components/atomic-crm/login/LoginPage.tsx`
- **:95-96 + :9(#96 overlay) · Brand hero panel** `bg-muted … text-white` (:95) with `bg-zinc-900` overlay (:96). `text-white` on `bg-muted` is a light-theme contrast bug.
  **Fix:** pick a deliberate surface — `bg-sidebar text-sidebar-foreground` (or `bg-primary text-primary-foreground`) — and set overlay to the same family instead of `bg-zinc-900`. **Risk:** needs-care (decorative brand panel; couple both lines). **Effort:** M.

### Inline-style -> utility (safe layout swaps)
- **`companies/GridList.tsx:29-31` · `style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))" }}`** -> class `grid-cols-[repeat(auto-fill,minmax(180px,1fr))]` (removes the `style` prop). **Risk:** pure-swap. **Effort:** S. *(If P1 skeleton fix mirrors this via inline style, keep both consistent.)*

### Arbitrary sizing -> scale utilities
- **`contacts/Avatar.tsx:26-28,34` · `w-[20px] h-[20px] -> size-5`, `w-[25px] h-[25px]` (off-grid) keep or `size-6`, `text-[10px] -> text-xs`.** **Risk:** pure-swap. **Effort:** S.
- **`companies/CompanyAvatar.tsx:15` · `w-[20px] h-[20px] -> size-5`.** **Risk:** pure-swap. **Effort:** S.
- **`companies/CompanyCard.tsx:88 · `size-8` + `w-[25px] h-[25px]` conflict** (arbitrary wins, `size-8` is dead) -> collapse to `size-[25px]`; **:91** `text-[10px] -> text-xs`. **Risk:** pure-swap. **Effort:** S.
- **`activity/ActivityLogDealCreated.tsx:30 · `w-[20px] h-[20px] -> size-5`** (grey half in Safe Fast Pass). **Risk:** pure-swap. **Effort:** S.
- **`layout/MobileNavigation.tsx:106 · `text-[0.6rem]` (~9.6px)** -> `text-xs` (or keep if the ~10px tab-label fit is deliberate). **Risk:** needs-care. **Effort:** S.

### `ui/**` primitives (lower priority, mutable dependency)
- **`ui/button.tsx:15`, `ui/badge.tsx:17` · `bg-destructive text-white`.** No `--destructive-foreground` token exists; `text-white` is the intended on-destructive fg. Leave unless a token is added. **Note only.**
- **`ui/drawer.tsx:38`, `ui/dialog.tsx:39`, `ui/sheet.tsx:37` · scrim `bg-black/50`.** Optionally `bg-foreground/50` for theme-awareness. **Risk:** cosmetic. **Effort:** S.

### `src/components/admin/**` (framework layer, lowest UI priority)
- **`admin/bulk-actions-toolbar.tsx:64` · `bg-zinc-100 dark:bg-zinc-900` -> `bg-card`** (or `bg-muted`). **Effort:** S.
- **`admin/ready.tsx:20,34` · dev splash `bg-zinc-100 text-black` -> `bg-muted text-foreground`** (dev-only). **Effort:** S.
- **`admin/login-page.tsx:59`, `supabase/layout.tsx:12` · hero `bg-zinc-900`+`text-white`** -> `bg-sidebar`/`bg-popover` if theme-driven is wanted. **Risk:** needs-care. **Effort:** S.
- **`admin/theme-mode-toggle.tsx:27-28` · `h-[1.2rem] w-[1.2rem] -> size-[1.2rem]`.** **Effort:** S.

### Needs-care: tag-color contrast cluster (design decision, NOT a mechanical swap)
`text-black` paired with a runtime pastel `backgroundColor` — black is chosen for contrast on light swatches; a straight token swap inverts to near-white in dark mode over a light swatch and breaks contrast.
Files: `tags/TagChip.tsx:27`, `contacts/TagsList.tsx:15`, `contacts/TagsListEdit.tsx:129`, `contacts/ContactListFilter.tsx:117`, `contacts/ContactListFilter.tsx:238`, `contacts/BulkTagButton.tsx:166`.
**Fix (one decision, applied to all):** introduce a `--tag-foreground` token via `text-[color:var(--tag-foreground)]`, or compute a readable fg from each tag color. **Risk:** needs-care. **Effort:** M.

### Needs-care: persisted color DATA (config/seed — not classes)
- **`tags/colors.ts:2-11` · 10-swatch tag palette** (`#eddcd2`…`#99c1de`) applied via inline `style`. Natural target: `var(--avatar-0..9)` (10 slots) or a `--tag-N` set. Changes stored data semantics; interacts with the tag-contrast cluster. **Risk:** needs-care (data). **Effort:** L.
- **`providers/fakerest/dataGenerator/tags.ts:4-9` · fake seed tag colors** — keep in sync with `tags/colors.ts`. Demo-only. **Effort:** S.
- **`root/defaultConfiguration.ts:44-47` · `defaultNoteStatuses`** (`#7dbde8`,`#e8cb7d`,`#e88b7d`,`#a4e87d`) cold/warm/hot/in-contract. Map to a resolved status ramp (cold->`st-new`, warm->`attention`, hot->`attention-strong`, in-contract->`positive`); resolve to concrete hex since these are config strings. **Risk:** needs-care (persisted config). **Effort:** M.
- **`contacts/useContactImport.tsx:68` · imported-tag default `color: "#f9f9f9"`** — derive from `--muted` or the first `colors.ts` swatch. **Risk:** needs-care (data default). **Effort:** S.
- **`settings/SettingsPage.tsx:291,303` · `backgroundImageColor="#f5f5f5"`/`"#1a1a1a"`** behind logo (canvas needs a literal color). Resolve `--background`/`--card` light+dark to concrete hex, or thread the current theme value in. **Risk:** needs-care (literal required). **Effort:** M.
- **`settings/SettingsPage.tsx:517` · `field.value || "#000000"`** in native `<input type="color">` — **acceptable as-is** (native picker deals in hex; neutral empty default). **No change.**

---

## P3 — Tidy / dead-code / DRY / TS smells

### Dead code (confirmed zero references in `src`; `tsc` doesn't catch unused *exports*)
- **`dashboard/DealsPipeline.tsx` · entire 92-line file dead** (`DealsPipeline`, 0 refs; replaced by `DealsChart`). **Delete file.** **Risk:** pure-swap. **Effort:** S.
- **`dashboard/LatestNotes.tsx` · entire 124-line file dead** (`LatestNotes`, 0 refs; replaced by `DashboardActivityLog`). **Delete file.** **Risk:** pure-swap. **Effort:** S.
- **`notes/utils.ts:8` · `formatNoteDate`** exported, 0 refs (keep sibling `getCurrentDate`). **Remove function.** **Effort:** S.
- **`providers/fakerest/dataGenerator/utils.ts:3` · `weightedArrayElement`** 0 refs. **Remove.** **Effort:** S.
- **`providers/fakerest/dataGenerator/utils.ts:27` · `randomFloat`** 0 refs. **Remove.** **Effort:** S.
- **`providers/commons/englishCrmMessages.ts:573` · `PartialCrmMessages` type** 0 refs. **Delete** (or keep if a published extension point). **Risk:** needs-care only if API. **Effort:** S.

### DRY / duplication
- **Empty-state shell duplicated** across `deals/DealEmpty.tsx`, `companies/CompanyEmpty.tsx`, `contacts/ContactEmpty.tsx` (same centered full-height scaffold + `img/empty.svg` + title + muted description + actions). **Fix:** extract `EmptyStateLayout` (props: `title`, `description`, actions/children) in `misc/`; keep caller-specific branching (`ContactEmpty` mobile/import, `DealEmpty` contacts-loaded branch) in the callers. **Risk:** needs-care. **Effort:** M.
- **`calc(100dvh - ${appbarHeight}px)` inline style repeated 4x** (`deals/DealEmpty.tsx:31`, `companies/CompanyEmpty.tsx:13`, `contacts/ContactEmpty.tsx:23`, `dashboard/DashboardStepper.tsx:43`). **Fix:** fold the three empty-states into `EmptyStateLayout`; for `DashboardStepper` (conditionally nulls height on mobile) leave as-is or add a `useAppBarOffsetHeight()` helper. **Risk:** pure-swap (empty-states) / needs-care (stepper). **Effort:** S (rolls into the extraction above).
- **Duplicated thumbnail dims** `w-[200px] h-[100px] object-cover …` in `notes/NoteAttachments.tsx:42` and `contacts/AttachmentField.tsx:68`. **Fix:** extract a shared `attachmentThumbnailClass` constant. **Risk:** pure-swap. **Effort:** S.

### Oversize / split
- **`misc/useImportFromJson.ts` · 815 lines (>800 ceiling); `importFile` callback ~117-685 (~560 lines, >>50-line limit).** Inlines per-entity import pipelines (sales/companies/contacts/tags-notes/tasks). **Fix:** extract each entity importer to `misc/import/importCompanies.ts` etc. (take shared context/`setState`, return stats); move type-guards `isSale/isCompany/…` + `TYPES/getType/mapSizeToCategory` (705-808) to `misc/import/importGuards.ts`; hook orchestrates. Keep sequential ordering + shared failure/stats accumulation; add tests. **Risk:** needs-care (behavior-preserving refactor of live import). **Effort:** L.

### A11y / semantics (medium)
- **`notes/Note.tsx:202` · read-more `<button>` missing `type`** -> add `type="button"`. **Effort:** S.
- **`notes/NoteInputsMobile.tsx:45` · textarea labeled only by placeholder** -> add `aria-label={translate("resources.notes.inputs.add_note")}`. **Effort:** S.
- **`tags/RoundButton.tsx:2` · color-swatch button conveys meaning by background color only** -> add `aria-label` with the color/tag name. **Effort:** S.

### TS smells (tidy, non-blocking)
- **`providers/supabase/dataProvider.ts:108` · `(getIsInitialized as any)._is_initialized_cache = true`** -> hoist to module-scoped `let isInitializedCache = false`. **Risk:** needs-care (module state). **Effort:** S/M.
- **`dashboard/DealsChart.tsx:52,66,201` · `any`/`@ts-expect-error`** — see P2 entry; type properly. **Effort:** M.
- **Widespread `any`** (per-file, mostly mechanical): `providers/commons/activity.ts:26,33,62,83,91,138,146`; `root/CRM.tsx:179,191,208`; `tags/RoundButton.tsx:1`; `contacts/TagsList.tsx:7`; `dashboard/LatestNotes.tsx:94,111` *(moot if file deleted)*; `deals/DealCard.tsx:29-30` (`provided?/snapshot?` -> dnd `DraggableProvided`/`DraggableStateSnapshot`); `notes/NoteCreateSheet.tsx:46,81`; `tasks/AddTask.tsx:51`; `tasks/TaskCreateSheet.tsx:44`. **Effort:** S each, L aggregate.
- **Non-null assertions to guard:** `deals/DealListContent.tsx:49`, `notes/NoteShowPage.tsx:35`, `notes/NoteCreateSheet.tsx:74`, `tasks/AddTask.tsx:120`, `tasks/TaskCreateSheet.tsx:72`. Prefer early-return guards. **Effort:** S.
- **Silent catches** (`root/CRM.tsx:186,204,212`, `providers/commons/getContactAvatar.ts:57`): acceptable; add `console.debug` if honoring the "never swallow" rule. **Effort:** S.

### Tidy-only (doc-comment hexes)
- **`simple-list/SimpleList.tsx:43`** JSDoc `'#efe'/'white'` example; **`root/CRM.tsx:107`** JSDoc `'#0000ff'` example. Comment-only; leave or delete. **Effort:** S.

---

## Totals

**By source category (deduplicated into this list):**
- Colors/tokens: ~29 findings (13 pure-swap Safe-Fast-Pass, rest needs-care incl. tag/data clusters).
- Inline/arbitrary: ~10 (1 real bug, rest style/scale swaps + DRY).
- Layout: 2 (both P1: SettingsPage, GridList skeleton).
- Dead-code/DRY/oversize: 10 (6 dead exports/files, 3 DRY, 1 oversize split).
- A11y/TS: A11y 6 (3 P1, 3 P3-medium) + TS smells (several clusters, ~15+ sites).

**By priority:**
- **P1:** 8 items across 5 files (1 CSS bug, 2 layout, 5 a11y) — `MobileNavigation`, `SettingsPage` (x2 coupled), `GridList` (x2), `SimpleListItem` (x2), `TagChip` (x2).
- **P2:** ~30 items (13 in the Safe Fast Pass; ~17 needs-care token/data/semantic mappings + `ui/` + `admin/`).
- **P3:** ~19+ items (6 dead-code, 3 DRY, 1 oversize-L, 3 a11y-medium, TS-smell clusters, 2 doc-comment).

**Effort roll-up:** most items S; M cluster = ImageEditorField dropzone, DealsChart series/TS, LoginPage hero, tag-contrast token, EmptyStateLayout extraction, MobileNavigation safe-area, noteStatuses/backgroundImageColor data. Single L = `useImportFromJson` split (and tag `colors.ts` data migration).

**Deferred (out of scope):** Deals -> Suggestions data-model/schema/migration rewrite. Only Deals *cosmetic* items (`DealShow` banner, `DealsChart` colors/TS) are included above.
