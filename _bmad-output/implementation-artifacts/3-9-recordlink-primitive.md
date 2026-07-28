---
baseline_commit: e5ca5e2f340b83d4e5b38936963e6f6fe2a39b5c
---

# Story 3.9: `RecordLink` primitive

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want every mention of a record to be clickable and go to the same place,
so that navigation is predictable.

## Position in Epic 3

This story is **step 3** of the Epic 3 build order (contract §12).

**Depends on — must be merged first:**

| Dependency | What this story consumes from it |
|---|---|
| **3-13** — the tab-vocabulary story (`entity360/tabKeys.ts`). Contract numbering; **filed as `_bmad-output/implementation-artifacts/3-10-tab-vocabulary.md`**, *not* `3-13-records-at-urls-not-modals.md` | `TabKey` / `TAB_LABELS`. Not used directly here, but `EntityDescriptor` references `TabKey`, so 3.3a will not typecheck without it. |
| **3.3a** — `entity360/entityDescriptor.ts` + `entity360/registry.ts` | The `EntityDescriptor` type and `registerEntityDescriptor` / `getEntityDescriptor` / `requireEntityDescriptor` (contract §2, §4). |

**Does not depend on** 3.1 (`Entity360` shell), 3.2 (routes / `entityPaths.ts`) or 3.3b
(`EntityShow`). `RecordLink` is a leaf that talks only to the registry.

**Blocks — these stories cannot land until this one has:**

| Blocked story | Why |
|---|---|
| **3.8** — Tasks tab | 3.8 widens `TaskTargetType` with `single`. `reminders/reminderEntity.ts:21,28` are `Record<TaskTargetType, string>` and `reminders/useReminders.ts:42-46,69-97` hardcodes three target types, three `useGetMany` calls and a three-row tuple. This story owns all of that (contract §10, §12 step 3). 3.8's own ordering note putting itself before 3.9 is **deleted**; only this order compiles. |
| **3.5** — Activity tab | Its timeline entries render record mentions through `RecordLink` and rely on the degrade-not-throw behaviour of AC 1 (contract §7 rule 2). |
| **3-15** — conformance validator | Asserts `PENDING_DB_WIDENINGS` (AC 6) is empty. |

**Scope boundary — this story is the one Epic 3 exception to "no live-code changes."**
Unlike 3.1–3.8, which build machinery without touching a real screen, this story's own
acceptance criterion — *"no ad-hoc record links remain in the codebase"*
([Source: _bmad-output/planning-artifacts/epics.md:575]) — is unsatisfiable without editing
live screens. Doing the sweep now rather than deferring to Epic 5 is deliberate: `RecordLink`
has no routing or shell dependency, and every swept site already navigates correctly today —
this only centralises *how*.

**Estimate — this is not "a small leaf component."** Thirteen live files change plus
`types.ts`, four new descriptor modules, four `index.ts` edits, and roughly **12 new test
files**: of the 13 swept files only `references/ReferenceMatchPanel.tsx` has a sibling test
(`references/ReferenceMatchPanel.test.tsx`), and `reminders/` has no component tests at all.
Budget accordingly.

## What this story registers, and why that is not Epic 5's job

`RecordLink` resolves a path via `getEntityDescriptor(resource)?.buildRecordPath(id)`. To work
today it needs *some* descriptor registered for each of the four live entities.

Per **contract §4 rule 5**, the four stubs are written as **four files Epic 5 replaces** —
never as four object literals in one shared module that four Epic 5 stories would hand-edit
concurrently:

```
src/components/atomic-crm/shidduchim/entityDescriptor.ts
src/components/atomic-crm/singles/entityDescriptor.ts
src/components/atomic-crm/shadchanim/entityDescriptor.ts
src/components/atomic-crm/references/entityDescriptor.ts
```

Each module exports its descriptor object **and** calls `registerEntityDescriptor` at module
scope (contract §4 rule 4). Each `<entity>/index.ts` gains `import "./entityDescriptor";` as
its first line. Registration is then complete before first render without any lazy import,
`useEffect`, or registration-inside-a-component:
`src/components/atomic-crm/root/routeManifest.ts:7-17` imports every resource index module at
module scope, and `RESOURCES` (`:92-100`) is mapped over at boot.

Each stub carries the **three required fields** of contract §2 — `name`, `buildRecordPath`,
`label` — reflecting today's real, working routes, **plus `tabs: []` and a full
`pendingTabs`** (below). No `statBand`, no `identityHeader`, no `relationships`. Epic 5
replaces each whole descriptor via `registerEntityDescriptor(d, { replace: true })`
(contract §4 rule 2) and flips `buildRecordPath` from `/{r}/{id}/show` to the AD-24 bare
`/{r}/{id}` in the same story.

**Each stub declares `pendingTabs: <its full canonical tab set>` — required, not optional**
[Source: _bmad-output/planning-artifacts/epic3-api-contract.md#4-Registry — rule 5;
#3-TabKey — rule 5]. Under 3-11's conformance rule a descriptor's
`keys(tabs) ∪ pendingTabs` must equal that entity's canonical row, compared as sets, and
`pendingTabs` must itself be in canonical order and drawn from `TabKey`
(`entity360/tabKeys.ts`, build-order step 0, so the union already exists here). A stub is
simply the extreme case — everything pending, nothing built — and there is **no
stub-exemption list**: a stub shipped without `pendingTabs` makes 3-11 AC 6(d) report
`tab-set-incomplete` for all four entities, and the fix would belong in this story. The four
rows, verbatim from contract §3 rule 5:

| Stub | `pendingTabs` (canonical order) |
|---|---|
| `shidduchim` | `overview, resume, photo, medical, files, diligence, external-links, notes, tasks, activity` |
| `singles` | `overview, resume, photo, files, shidduchim, notes, tasks, activity` |
| `shadchanim` | `overview, shidduchim, notes, tasks, activity` |
| `references` | `overview, conversations, shidduchim, notes, tasks, activity, assistant` |

Do **not** add `discussions` to the `shidduchim` row or invent a `connections` row — 7-1 and
8-5 add their own key and row together, in their own diff (contract §3 rules 3 and 5).

```ts
// shidduchim/entityDescriptor.ts  (shape; label strings per AD-23)
export const shidduchimDescriptor: EntityDescriptor = {
  name: "shidduchim",
  label: "Shidduchim",
  buildRecordPath: (id) => `/shidduchim/${id}/show`,
  tabs: [],
  pendingTabs: [
    "overview", "resume", "photo", "medical", "files",
    "diligence", "external-links", "notes", "tasks", "activity",
  ],
};
registerEntityDescriptor(shidduchimDescriptor);
```

…and likewise `singles` → `/singles/${id}/show` (label "Singles"), `shadchanim` →
`/shadchanim/${id}/show` (label "Shadchanim"), `references` → `/references/${id}/show`
(label "References"), each with the `pendingTabs` row from the table above.

**`shidduchim`'s pinned path is honest, not aspirational, and it pins a UX-DR3 violation.**
`src/components/atomic-crm/shidduchim/index.ts:5-7` exports `{ list: ShidduchimList }` only;
`shidduchim/ShidduchimList.tsx:79` does `matchPath("/shidduchim/:id/show", …)`; and
`shidduchim/ShidduchShow.tsx:18-24` self-documents *"A routed Dialog (`/shidduchim/:id/show`
over the board), not a `Show`"* with `<Dialog>` at `:35`. So `<Resource>` computes
`hasShow: false` for `shidduchim`
([Source: node_modules/ra-core/dist/core/Resource.js:33-34]) and any ra-core machinery gated
on `hasShow` disagrees with this descriptor. Story 5.1 kills the dialog and un-pins it. The
descriptor states today's truth; the comment in the file must say all of this so the next
reader does not take the pinned string as a blessing.

## Acceptance Criteria

### AC 1 — `RecordLink` resolves through the registry and **degrades, never throws**

`src/components/atomic-crm/entity360/RecordLink.tsx` exports exactly the contract §7 shape,
plus one addition (`style`, justified below):

```tsx
export function RecordLink(props: {
  resource: string;
  id: Identifier;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}): ReactElement;
```

1. **Registered resource** → renders `<Link to={descriptor.buildRecordPath(id)}>` with
   `className` and `style` forwarded verbatim. Path comes from
   `getEntityDescriptor(resource)`, never a hand-built template literal.
2. **Unregistered resource** → renders an inert `<span>{children}</span>` (carrying the same
   `className`/`style`) plus **one** `console.error` naming the resource. **It must not
   throw.** Story 3.5 links from `interactions.metadata`, which is free-form `jsonb` that
   clients may write — `supabase/schemas/06_grants.sql:616` grants
   `update (body, metadata) on table public.interactions to authenticated` — so a throw at
   render blanks the entire Activity tab.
3. **No `onClick`, no `ref` forwarding, no `{...rest}` spread.** The signature is closed. A
   caller that needs drag props, a ref or a click guard puts them on its own wrapper element
   (AC 4 shows the pattern). This is deliberate: `@hello-pangea/dnd` sets an inline
   `transform` style on the node it owns, and that node must not also be the anchor.

**Falsifiable by:**
- (a) A registered-resource test asserting `getByRole("link").getAttribute("href")` equals
  `/singles/7/show` for `<RecordLink resource="singles" id={7}>Nechama</RecordLink>`.
- (b) An unregistered-resource test rendering
  `<div><RecordLink resource="nope" id={1}>x</RecordLink><span>sibling</span></div>` and
  asserting: no error is thrown, `sibling` is still in the document,
  `await expect.element(screen.getByRole("link")).not.toBeInTheDocument()`, and
  `console.error` (spied via `vi.spyOn`) was called exactly once with a message containing
  `"nope"`.
- (c) A TypeScript-level check: `RecordLinkProps` has exactly five keys. Assert with a
  `satisfies`/`Exclude` type test in the test file — passing `onClick` must be a compile
  error, so the negative case is written as a `// @ts-expect-error` line, which fails the
  build if the prop is ever added.

> **Deviation from contract §7, flagged deliberately.** §7's prop list omits `style`, but two
> swept sites need it: `singles/SingleCard.tsx:65` and `references/ReferenceList.tsx:70` both
> set `style={{ animationDelay: … }}` on the anchor alongside the `ql-enter` class. Moving
> that pair onto the inner `<Card>` is **not** behaviour-preserving: `.ql-enter` is
> `animation: ql-rise var(--dur-enter) var(--ease-out) both` (`src/index.css:496-498`), and
> `animation-fill-mode: both` leaves the final keyframe's `transform` applied, which would
> override the Card's `hover:-translate-y-0.5` / `active:scale-[0.98]` classes. `style` is the
> same concern `className` already covers. One addition, no `onClick`, no ref, no spread.

### AC 2 — the four descriptors are registered and their paths are pinned

A test in `entity360/registry.stubs.test.ts` (or co-located with `RecordLink.test.tsx`)
imports the four `<entity>/entityDescriptor` modules and asserts, for each of
`"shidduchim" | "singles" | "shadchanim" | "references"`:

- `getEntityDescriptor(name)` is defined;
- `.name === name` and `.label` is a non-empty string;
- `.buildRecordPath(1)` equals the pinned string `/{name}/1/show`;
- `.tabs` is `[]` and `.pendingTabs` **deep-equals** that entity's canonical row from the
  table above, in that exact order — the assertion that stops 3-11 AC 6(d) from going red on
  all four entities the day the validator lands.

The pins are literal strings, not derived. `root/routeManifest.ts`'s `ResourceEntry`
(`:39-43`) holds `definition: Omit<ResourceProps, "name">` — components, not path templates —
so there is nothing to derive them from. The test carries a comment naming
`root/routeManifest.ts:92-100` and each `<entity>/index.ts` as what to re-read when it fails,
and stating that it **is meant to fail** when Epic 5 flips a route shape without updating that
entity's `buildRecordPath`.

**Falsifiable by** construction: deleting any one `registerEntityDescriptor` call, or changing
one path, turns the test red.

### AC 3 — the 13 ad-hoc record-navigation sites are migrated

All five commands below return **zero** hits after this story. Counts in brackets are the
values on `main` at refresh time (verified 2026-07-28) — if a command's *current* count is
already zero before you start, the pattern has rotted and must be re-derived, not deleted.

```bash
# (a) inline template-literal record links — 9 hits today
grep -rnE 'to=\{`/(shidduchim|references|shadchanim|singles)/\$\{' \
  src/components/atomic-crm --include='*.tsx' --include='*.ts'

# (b) the board card's non-anchor navigation — 2 hits today (:6 import, :79 call)
grep -n 'useRedirect' src/components/atomic-crm/shidduchim/ShidduchCard.tsx

# (c) the one already-framework-correct site — 1 hit today (ReferenceList.tsx:68)
grep -rn 'createPath({ resource: "references"' src/components/atomic-crm

# (d) the retired reminders path builder — 3 hits today
grep -rn 'targetEntityPath' src/components/atomic-crm
```

```bash
# (e) census: after the sweep, the ONLY files in src/components/atomic-crm that build a
#     `/{descriptor-entity}/${id}` path by template literal are the four descriptor modules.
#     12 files today; must be exactly these 4 afterwards.
grep -rlE '`/(shidduchim|singles|shadchanim|references)/\$\{' \
  src/components/atomic-crm --include='*.ts' --include='*.tsx' | sort
# expected output, exactly:
#   src/components/atomic-crm/references/entityDescriptor.ts
#   src/components/atomic-crm/shadchanim/entityDescriptor.ts
#   src/components/atomic-crm/shidduchim/entityDescriptor.ts
#   src/components/atomic-crm/singles/entityDescriptor.ts
```

The sites, with line numbers verified on `main` 2026-07-28. **Relocate each by its import
statement and `to={` pattern, not by line number** — use the `LSP` tool
(`workspaceSymbol` / `findReferences` / `goToDefinition`) for TypeScript symbols per
`.claude/rules/lsp-usage.md`, and `grep` only for the string patterns above.

| # | File:line | Target resource | Id expression | Mechanism today |
|---|---|---|---|---|
| 1 | `dashboard/RecentSuggestions.tsx:51-52` | `shidduchim` | `item.id` | `<Link to={\`/shidduchim/${…}/show\`}>` |
| 2 | `dashboard/AttentionSection.tsx:63-64` | `shidduchim` | `s.id` | same |
| 3 | `references/ShidduchReferencesSection.tsx:69-70` | `references` | `link.reference_id` | same |
| 4 | `references/ReferenceCallLog.tsx:43-44` (`LinkCard`) | `shidduchim` | `link.shidduchim_id` | same |
| 5 | `references/ReferenceMatchPanel.tsx:76-77` | `references` | `candidate.reference_id` | same |
| 6 | `references/RepeatRecognitionPanel.tsx:83-84` | `shidduchim` | `link.shidduchim_id` | same |
| 7 | `references/ReferenceList.tsx:67-68` | `references` | `record.id` | `createPath({ resource, id, type: "show" })` |
| 8 | `singles/SingleCard.tsx:60-61` | `singles` | `single.id` | `<Link to={…}>` + `style={{animationDelay}}` |
| 9 | `shadchanim/ShadchanCard.tsx:31-32` | `shadchanim` | `shadchan.id` | `<Link to={…}>` |
| 10 | `shadchanim/ShadchanSuggestions.tsx:59-60` | `shidduchim` | `item.id` | same |
| 11 | `shidduchim/ShidduchCard.tsx:89-99`, `:101-108` | `shidduchim` | `shidduch.id` | `useRedirect()` in a `<div onClick>` — **not an anchor** (AC 4) |
| 12 | `reminders/ReminderCard.tsx:58-59` | polymorphic | `linkedEntity.id` | `to={linkedEntity.to}` (AC 5) |
| 13 | `shidduchim/ShidduchCatchSection.tsx:34-45` | `shidduchim` | `suggestion.prior_shidduchim_id` | `useRedirect()` in a confirm handler — **not a mention** (see below) |

**Site 13 is an addition to the inventory, not a correction of it.** The 12-site `<Link>`
inventory is accurate and is not being restated. Site 13 is an *imperative* `useRedirect` in
`ShidduchCatchSection`'s `confirm` callback, which the `<Link>`-shaped inventory never
covered. It is not a record mention and does **not** become a `RecordLink`; it stays a
`redirect(...)` call whose path becomes
`requireEntityDescriptor("shidduchim").buildRecordPath(suggestion.prior_shidduchim_id)`,
keeping its `{ _scrollToTop: false }` fifth argument unchanged. It is in scope because
command (e) above cannot reach zero exceptions otherwise, and because leaving a hardcoded
`/shidduchim/${id}/show` here means Epic 5's one-line `buildRecordPath` flip silently misses
it.

**Out of scope, verified as not record mentions** (do not convert; every one re-read
2026-07-28): `dashboard/PipelineSnapshot.tsx:37` (`to="/shidduchim"`, a list link) ·
`dashboard/DashboardStat.tsx:60-61` (caller-supplied list-filter `to`) ·
`singles/SingleList.tsx:45`, `shadchanim/ShadchanList.tsx:22`,
`shidduchim/ShidduchColumn.tsx:103-104`, `shidduchim/ShidduchimList.tsx:152`,
`references/ShidduchReferencesSection.tsx:93`, `layout/MobileNavigation.tsx:172`
(all `/create` links — Story **3.12** renames these to `/new`, not this story) ·
`misc/EmptyState.tsx:59-60` (`actionTo`, resource-agnostic CTA) ·
`settings/FamilySection.tsx:34` (`to="/singles"`, a list link) ·
`layout/Sidebar.tsx:60-61`, `layout/TopBar.tsx:134,150`, `settings/SettingsPage.tsx:73`
(navigation) · `misc/MobileBackButton.tsx:11-16` (`createPath({ type: "list" })`).

Styling is preserved byte-for-byte at every site. This is a navigation-mechanism change, not
a visual one.

### AC 4 — the accessibility defect on the board card is fixed, and drag still works

`shidduchim/ShidduchCard.tsx` today renders `ShidduchCardContent` as a `<div onClick>` that
calls `useRedirect()` (`:79`, `:89-99`, `:101-108`). Because `@hello-pangea/dnd`'s
`dragHandleProps` supplies `tabIndex: 0` and `role: "button"`
([Source: node_modules/@hello-pangea/dnd/dist/dnd.js:7844-7852]) the card *is* focusable
today — the defects are narrower and all three must be stated correctly:

- it has **no `href`**, so it cannot be middle-clicked, cmd/ctrl-clicked, opened in a new tab,
  or have its address copied;
- it is announced as a **button**, not a link;
- **Enter does not navigate** — there is no keyboard activation path to the record.

**The fix keeps the dnd wrapper and puts the anchor inside it:**

```tsx
<div
  className="cursor-pointer"
  data-tour={tourAnchor ? "pipeline-card" : undefined}
  {...provided?.draggableProps}
  {...provided?.dragHandleProps}
  ref={provided?.innerRef}
  onClickCapture={(e) => { if (snapshot?.isDragging) e.preventDefault(); }}
>
  <RecordLink resource="shidduchim" id={shidduch.id} className="block">
    <Card …>…</Card>
  </RecordLink>
</div>
```

Four mechanics, each verified, that the implementer must not "simplify":

1. **The dnd spreads stay on the `<div>`, before any handler, exactly as today**
   (`ShidduchCard.tsx:105-107`), and `provided.innerRef` stays on the `<div>`.
   `@hello-pangea/dnd` writes an inline `transform` to the node it owns; that node must not be
   the anchor. This satisfies contract §7 rule 4 without `RecordLink` accepting a spread.
2. **The drag guard is `onClickCapture`, not `onClick`.** React dispatches the capture path
   before the target's bubble handler, and `preventDefault()` sets `defaultPrevented` on the
   **same** synthetic event instance
   ([Source: node_modules/react-dom/cjs/react-dom-client.development.js:3384-3393]).
   `react-router`'s `<Link>` runs `if (onClick) onClick(event); if (!event.defaultPrevented)
   internalOnClick(event);`
   ([Source: node_modules/react-router/dist/development/chunk-KS7C4IRE.mjs:10552-10557],
   react-router 7.18.1), so the guard suppresses navigation. A bubble-phase `onClick` on the
   `<div>` would run **after** the anchor has already navigated and would not work.
3. **Native HTML5 drag of the inner anchor is already suppressed.** `dragHandleProps.onDragStart`
   is `preventHtml5Dnd` ([Source: node_modules/@hello-pangea/dnd/dist/dnd.js:7797-7799]) and
   `dragstart` bubbles from the anchor to the wrapper, so no extra `draggable={false}` is
   needed — do not add one, `RecordLink` has no prop for it.
4. **`{ _scrollToTop: false }` is preserved by omission, and that is provable — not an
   oversight.** `useRedirect` injects `state: { _scrollToTop: true, ...state }`
   ([Source: node_modules/ra-core/dist/routing/useRedirect.js:41]), which is why today's call
   must pass `false` explicitly. A bare `<Link>` sets no such state, and both consumers read
   it as falsy: `useScrollToTop` scrolls only `if (location.state?._scrollToTop && …)`
   ([Source: node_modules/ra-core/dist/routing/useScrollToTop.js:24-33], mounted by
   [Source: node_modules/ra-core/dist/core/CoreAdminRoutes.js:9]) and
   `useRestoreScrollPosition` restores `if (position != null && location.state?._scrollToTop
   !== true)` ([Source: node_modules/ra-core/dist/routing/useRestoreScrollPosition.js:24-35]).
   `undefined` and `false` are indistinguishable to both.

**Falsifiable by** three browser-mode tests on `ShidduchCardContent`:
- a card renders `getByRole("link")` whose `href` is `/shidduchim/{id}/show` (fails today —
  today's card has `role="button"` and no `href`);
- clicking the card with `snapshot={{ isDragging: false }}` changes `location.pathname` to
  `/shidduchim/{id}/show` (captured via `TestMemoryRouter`'s `locationCallback`);
- clicking with `snapshot={{ isDragging: true }}` leaves `location.pathname` unchanged.

### AC 5 — `reminders/` learns `single`, loses `targetEntityPath`, and stops saying "Suggestion"

Five changes in `reminders/`, all in this story (contract §10, §12 step 3):

1. **`targetEntityPath` is deleted** (`reminderEntity.ts:34-48`). Its `shadchan` branch
   returns `/shadchanim/${id}` with **no** `/show` and carries the comment *"`shadchanim` has
   no /show — edit is its detail view"* (`:34`). That comment is stale and the bug is live:
   `shadchanim/index.ts:11` registers `show: ShadchanShow`, so every shadchan-targeted
   reminder has been linking to the **edit** page. Deleting the function deletes the bug.
2. **`LinkedEntityRef` stops carrying a precomputed path.** `useReminders.ts:21-26` becomes
   `{ type: TaskTargetType; id: Identifier; label: string }` — the `to: string` field is
   removed (`:25`, populated at `:148`). `ReminderCard.tsx:57-66` then renders
   `<RecordLink resource={RESOURCE_FOR_TARGET[linkedEntity.type]} id={linkedEntity.id}
   className="…">{linkedEntity.label}</RecordLink>`, keeping the existing class string
   unchanged. `RESOURCE_FOR_TARGET` and `targetEntityLabel` stay — they answer *which
   resource* and *what to call it*, questions `RecordLink` does not duplicate.
3. **The two live AD-23 violations are fixed.** `reminderEntity.ts:29`
   (`shidduch: "Suggestion"`) and `:60` (the `|| "Suggestion"` fallback) are the only two
   occurrences of the string `"Suggestion"` left in `src/components/atomic-crm` (verified
   2026-07-28) and both are user-facing via `ReminderCard.tsx:64` and
   `ReminderCreateSheet.tsx:223`. Both become **"Shidduch"**.
   **This forces a second fix in the same change:** `ReminderCreateSheet.tsx:243` builds a
   plural as `` `No ${TARGET_TYPE_LABEL[linkType].toLowerCase()}s yet` ``, which turns
   "Shidduch" into *"shidduchs"* — a new AD-23 violation created by fixing the first one. Add
   a sibling `TARGET_TYPE_LABEL_PLURAL: Record<TaskTargetType, string>` in `reminderEntity.ts`
   (`shidduch: "shidduchim"`, `reference: "references"`, `shadchan: "shadchanim"`,
   `single: "singles"`) and use it at `:243`. `:246` (`Pick a ${…}`) keeps the singular map.
4. **`single` is added everywhere the type union now requires it.** After AC 6 widens
   `TaskTargetType`, `npm run typecheck` fails until:
   - `reminderEntity.ts:21` `RESOURCE_FOR_TARGET.single = "singles"`;
   - `reminderEntity.ts:28` `TARGET_TYPE_LABEL.single = "Single"` (+ the plural map above);
   - `reminderEntity.ts:51-72` `targetEntityLabel` gains an explicit `case "single":`
     returning `[record.first_name_en, record.last_name_en].filter(Boolean).join(" ")` with a
     `"Single"` fallback — matching `singles/index.ts:12-14`'s `recordRepresentation`. Without
     the case the existing `default:` branch silently returns `record.name`, which
     `public.singles` does not have (`types.ts:173-185`), so every single-targeted reminder
     would render the literal word "Single".
   - `useReminders.ts:42-46` `ALL_TARGET_TYPES` gains `"single"`;
   - `useReminders.ts:69-90` gains a **fourth** `useGetMany` (`RESOURCE_FOR_TARGET.single`,
     `enabled: singleIds.length > 0`) and `:92-97`'s tuple gains a fourth row. A map entry
     alone is not enough — these are three literal hook calls and a three-row tuple, and the
     comment at `:64-67` documents that the hook count is fixed by `ALL_TARGET_TYPES`.
5. **`LINKABLE_TARGET_TYPES` does NOT gain `single`, and the reason is written in the file.**
   `reminderEntity.ts:14-18` seeds the create-picker (`ReminderCreateSheet.tsx:86,221`).
   `tasks_target_type_check` is still `in ('shadchan', 'shidduch', 'reference')`
   ([Source: supabase/schemas/01_tables.sql:45-47]) — offering `single` here would ship a
   picker option whose insert is rejected by Postgres. Add a comment naming **Story 3.8** as
   the trigger: 3.8 widens the check and adds `"single"` to this array in the same diff.

**Falsifiable by:**
- `grep -rn 'targetEntityPath' src/components/atomic-crm` → 0 (AC 3 command (d));
- `grep -rn '"Suggestion"' src/components/atomic-crm` → 0 (2 hits today);
- a `reminderEntity.test.ts` asserting `targetEntityLabel("single", { first_name_en: "Rivky",
  last_name_en: "Klein" }).label === "Rivky Klein"` and
  `targetEntityLabel("single", undefined).label === "Single"`;
- a `reminderEntity.test.ts` assertion that `LINKABLE_TARGET_TYPES` has length 3 and does not
  contain `"single"` — this test is **meant to be edited by 3.8**, and its comment says so;
- a `ReminderCard.test.tsx` rendering a `shadchan`-targeted item and asserting the link's
  `href` is `/shadchanim/{id}/show` — **this test is red on today's code** (today it is
  `/shadchanim/{id}`), which is the live bug being fixed.

### AC 6 — `types.ts` gains the one target-type vocabulary, and the DB gap is recorded

Per contract §8 and §10, this story owns the TypeScript half of the polymorphic target-type
vocabulary. In `src/components/atomic-crm/types.ts`:

```ts
export const ENTITY_TARGET_TYPES = ["shidduch", "single", "shadchan", "reference"] as const;
export type EntityTargetType = (typeof ENTITY_TARGET_TYPES)[number];
export type TaskTargetType = EntityTargetType;   // widens types.ts:71, does not duplicate it
```

`TaskTargetType` at `types.ts:71` is today `"shadchan" | "shidduch" | "reference"` and is
**widened in place**, never re-declared alongside a second union.

**The four-value TS union deliberately runs ahead of the database, and that gap is recorded,
not hidden.** Present fact on `main`:

| Constraint | Values today | Widened by |
|---|---|---|
| `tasks_target_type_check` ([Source: supabase/schemas/01_tables.sql:45-47]) | `('shadchan', 'shidduch', 'reference')` — `single` is **illegal** | Story 3.8 |
| `interactions_target_type_check` ([Source: supabase/schemas/01_tables.sql:458-460]) | `('reference', 'shidduch')` — `single` **and** `shadchan` are illegal | Story 3.5 |
| `entity_files` target-type check | table does not exist yet | Story 3.7 |

This is safe because nothing writes a single-targeted task until 3.8 (AC 5 item 5 keeps it out
of the only picker). To keep it from being forgotten, this story adds:

```ts
// entity360/pendingDbWidenings.ts
export const PENDING_DB_WIDENINGS = [
  "tasks_target_type_check",          // -> 3.8
  "interactions_target_type_check",   // -> 3.5
  "entity_files_target_type_check",   // -> 3.7 (table not created yet)
] as const;
```

plus a vitest guard that reads `supabase/schemas/01_tables.sql` as source text and asserts,
for every check constraint **not** listed in `PENDING_DB_WIDENINGS`, that its value set is a
subset of `ENTITY_TARGET_TYPES`. Stories 3.5 / 3.7 / 3.8 each remove their own entry; story
3-15 asserts the array is empty.

**Falsifiable by** proving the guard **red before green** (contract §13 rule 2): temporarily
remove `"tasks_target_type_check"` from `PENDING_DB_WIDENINGS` and confirm the guard fails
with a message naming that constraint, then restore it. Record the red run in the Debug Log
References section below. A guard that has never been seen to fail is not coverage.

Reading the SQL: use the same mechanism as
`src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20`'s
`import.meta.glob(…, { query: "?raw", import: "default", eager: true })` — the only in-repo
`?raw` precedent — with the glob pattern retargeted at
`../../../../supabase/schemas/01_tables.sql` rather than that test's `../**/*.{ts,tsx}`. A
bare `import x from "…/01_tables.sql?raw"` needs a `*?raw` module declaration to typecheck
under `strict`.

## Tasks / Subtasks

- [x] **Task 1 — `types.ts` vocabulary + `PENDING_DB_WIDENINGS`** (AC: 6)
  - [x] Add `ENTITY_TARGET_TYPES` / `EntityTargetType`; widen `TaskTargetType` at
        `types.ts:71` to alias it. Do not add a second union.
  - [x] Add `entity360/pendingDbWidenings.ts` and the `?raw` guard test.
  - [x] Show the guard red (remove one entry), capture the output in Debug Log References,
        restore it, show it green.

- [x] **Task 2 — `RecordLink.tsx`** (AC: 1)
  - [x] Implement per AC 1: `getEntityDescriptor` (the guarded accessor, **not**
        `requireEntityDescriptor`), inert `<span>` + single `console.error` on miss.
  - [x] `RecordLink.test.tsx`: href per resource; unregistered resource does not throw and
        leaves siblings mounted; `console.error` called once; `// @ts-expect-error` line
        proving `onClick` is not a prop.

- [x] **Task 3 — the four descriptor modules** (AC: 2)
  - [x] Create `shidduchim/entityDescriptor.ts`, `singles/entityDescriptor.ts`,
        `shadchanim/entityDescriptor.ts`, `references/entityDescriptor.ts` — each exports the
        descriptor **and** registers it at module scope.
  - [x] Give each stub `tabs: []` and the `pendingTabs` row pinned in AC 2's table, importing
        `TabKey` from `entity360/tabKeys.ts`. Transcribe the rows from contract §3 rule 5 —
        do not re-derive them from UX-DR5, and do not add `discussions` or `connections`.
  - [x] Add `import "./entityDescriptor";` as the first line of each `<entity>/index.ts`.
  - [x] Put the UX-DR3 comment in `shidduchim/entityDescriptor.ts` (routed Dialog,
        `hasShow: false`, un-pinned by 5.1).
  - [x] Pinning test per AC 2, with the "re-check `routeManifest.ts` / `<entity>/index.ts`"
        comment.

- [x] **Task 4 — the sweep, sites 1–10 and 13** (AC: 3)
  - [x] Relocate each site by its import statement and `to={` pattern. Use `LSP`
        (`workspaceSymbol` / `findReferences`) for TypeScript symbols; `grep` only for the
        AC 3 string patterns.
  - [x] Replace each `<Link to={…}>` with `<RecordLink resource="…" id={…}>`, moving
        `className` and (sites 8, 7) `style` across unchanged.
  - [x] Site 7 (`references/ReferenceList.tsx:67-68`) is migrated even though `createPath` is
        framework-correct today: `useCreatePath` hardcodes the `/show` suffix
        ([Source: node_modules/ra-core/dist/routing/useCreatePath.js:56-62]), so it will not
        follow `references`' route shape when Epic 5 flips it, while `RecordLink` will.
  - [x] Site 13 (`shidduchim/ShidduchCatchSection.tsx:34-45`) stays a `redirect(...)`; only
        its path expression changes to
        `requireEntityDescriptor("shidduchim").buildRecordPath(...)`. Keep the
        `{ _scrollToTop: false }` argument.
  - [x] Run AC 3 commands (a)–(e); (a)–(d) return nothing, (e) returns exactly the four
        descriptor files.

- [x] **Task 5 — `ShidduchCard.tsx`** (AC: 4)
  - [x] Restructure per AC 4: dnd spreads + `innerRef` stay on the `<div>`; the guard becomes
        `onClickCapture`; `RecordLink` wraps the `<Card>`; `useRedirect` import and call are
        deleted.
  - [x] Three tests: `href` present; ordinary click navigates; click while
        `snapshot.isDragging` does not.

- [x] **Task 6 — `reminders/`** (AC: 5)
  - [x] `reminderEntity.ts`: delete `targetEntityPath`; `"Suggestion"` → `"Shidduch"` (×2);
        add `single` to `RESOURCE_FOR_TARGET` / `TARGET_TYPE_LABEL` / `targetEntityLabel`; add
        `TARGET_TYPE_LABEL_PLURAL`; leave `LINKABLE_TARGET_TYPES` at three with the 3.8
        comment.
  - [x] `ReminderCreateSheet.tsx:243`: use the plural map.
  - [x] `useReminders.ts`: drop `to` from `LinkedEntityRef`; add `"single"` to
        `ALL_TARGET_TYPES`; add the fourth `useGetMany` and the fourth tuple row.
  - [x] `ReminderCard.tsx:57-66`: render `RecordLink`, class string unchanged.
  - [x] New `reminderEntity.test.ts` and `ReminderCard.test.tsx` per AC 5.

- [x] **Task 7 — validation**
  - [x] `npm run typecheck` · `npx vitest run` · `npm run lint` · `npm run build`.
        (Equivalently `make typecheck` / `make test` / `make lint` / `make build`.) No DB
        change in this story, so `npm run test:unit:db` is unchanged but must
        still pass.

## Dev Notes

### Where the contract lives

The binding shape authority for this story is the **Epic 3 canonical API contract**, produced
by the Epic 3 refresh pass — specifically §0 (global corrections), §2 (`EntityDescriptor`),
§4 (registry + the "descriptor stubs are files" rule), §7 (`RecordLink`), §8 (target-type
vocabulary), §10 (ownership) and §12 (build order). At the time this story was refreshed the
contract was **not yet committed under `_bmad-output/planning-artifacts/`**; the committer for
this pass must place it there, and this story's citations to "contract §n" then resolve to it.
Where this story deviates from the contract it says so in the AC itself — there is exactly one
such deviation, the `style` prop in AC 1.

### Why `<DataTable>` row clicks are not this story's job

An earlier draft justified excluding `simple-list/SimpleListItem.tsx`. **That file was deleted
by Epic 1 and the reasoning is void.** The real row-click primitive is
`src/components/admin/data-table.tsx:23,233` (`useGetPathForRecordCallback`), and the correct
reasoning is different:

- AD-24's "every record mention … on a board card, **list row**, timeline entry, rail panel or
  search result" is satisfied for all four descriptor-bearing entities by this sweep — their
  list rows are `singles/SingleCard.tsx`, `shadchanim/ShadchanCard.tsx` and
  `references/ReferenceList.tsx`, sites 8, 9 and 7. None of them goes through `<DataTable>`.
- The only `<DataTable>` consumer in `src/components/atomic-crm` is `members/MemberList.tsx`,
  and `members` gets no descriptor in Epic 3 (`root/routeManifest.ts:92-100` declares seven
  resources; four get descriptors here).
- Generalising `<DataTable>`'s row link is Epic 4's `EntityList` (UX-DR7) plus contract §5
  rule 4's explicit `hasShow`/`hasEdit` props on `<Resource>`, both owned by Story 3.2 / 4.1.

So `data-table.tsx` is untouched here — by assignment, not because a deleted file made it
awkward.

### Naming residue, noted and deferred

`dashboard/RecentSuggestions.tsx` and `shadchanim/ShadchanSuggestions.tsx` are both in the
sweep and both named "Suggestions" while rendering shidduchim — an AD-23 violation in file and
symbol names. **Renaming them is not this story's work** (they are relocated by Epic 5's
shidduch/shadchan 360 stories); this story changes only the navigation mechanism inside them
and leaves the names alone. Recorded here so the next reader does not think it was missed.

### Testing standard

- Browser-mode vitest (`app` project): `vitest-browser-react` + `TestMemoryRouter` from
  `ra-core`, in real Chromium. **React Testing Library is not a dependency** — no `screen.queryByText`,
  no `MemoryRouter`. The negative idiom is
  `await expect.element(screen.getByRole(...)).not.toBeInTheDocument()`.
  Pattern file: `src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-12,59-86,95`
  (imports, `TestMemoryRouter` + `locationCallback` harness, negative assertion).
- `render()` returns `container`, so `container.textContent` assertions survive.
- AAA. Descriptive test names. No `waitForTimeout`. ≥80% coverage on new code
  (`.claude/rules/testing.md`).
- Navigation assertions read `location.pathname` through `TestMemoryRouter`'s
  `locationCallback` (`ContextSwitcher.test.tsx:69-74`), never a mocked `useNavigate`.
- The registry is module-scoped state. Tests that register fixture descriptors must use
  `registerEntityDescriptor(d, { replace: true })` and must not depend on file execution order
  (contract §4 rule 6, §13 rule 3).
- No backend, RLS or migration surface in this story.

### Project Structure Notes

- New files in `entity360/`: `RecordLink.tsx`, `pendingDbWidenings.ts`, plus their tests.
- New files outside it: four `<entity>/entityDescriptor.ts`.
- This is the only Epic 3 story that edits live application files — the deliberate exception
  stated in "Position in Epic 3", not scope creep.

### References

- [Source: _bmad-output/planning-artifacts/epics.md:564-575] — Epic 3, Story 3.9 acceptance
  criterion ("no ad-hoc record links remain in the codebase")
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:177-180]
  — AD-24: "every record mention anywhere renders through **one `RecordLink`**"
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:172-175]
  — AD-23: the vocabulary (`single`, `shidduch`, `shadchan`, `reference`); CI fails on retired names
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:173-175]
  — UX-DR6, the `RecordLink` design ruling (board card · list row · timeline entry · rail
  panel · search result)
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:161-165]
  — UX-DR2 (route convention) and UX-DR3 (records live at URLs, not modals)
- [Source: src/components/atomic-crm/root/routeManifest.ts:7-17,39-43,92-100] — module-scope
  resource imports, `ResourceEntry`, the seven registered resources
- [Source: src/components/atomic-crm/shidduchim/ShidduchCard.tsx:79,89-99,101-108] — the
  `useRedirect`-in-a-`<div onClick>` defect this story fixes
- [Source: src/components/atomic-crm/shidduchim/ShidduchShow.tsx:18-24,35] and
  [Source: src/components/atomic-crm/shidduchim/ShidduchimList.tsx:79] — the routed Dialog and
  its `matchPath`, the UX-DR3 violation `shidduchim`'s pinned path honestly records
- [Source: src/components/atomic-crm/shidduchim/index.ts:5-7] — `list` only, so
  `hasShow: false`
- [Source: src/components/atomic-crm/shadchanim/index.ts:11] — `show: ShadchanShow` **is**
  registered, which is why `reminderEntity.ts:34`'s comment is stale and its `:44-46` branch
  is a live bug
- [Source: src/components/atomic-crm/reminders/reminderEntity.ts:14-18,21-25,28-32,34-48,51-72]
  — `LINKABLE_TARGET_TYPES`, the two `Record<TaskTargetType, string>` maps, `targetEntityPath`,
  `targetEntityLabel`
- [Source: src/components/atomic-crm/reminders/useReminders.ts:21-26,42-46,64-67,69-97,148]
  — `LinkedEntityRef.to`, `ALL_TARGET_TYPES`, the three `useGetMany` calls and the three-row
  tuple
- [Source: src/components/atomic-crm/reminders/ReminderCard.tsx:57-66] — the `<Link
  to={linkedEntity.to}>` this story replaces
- [Source: src/components/atomic-crm/reminders/ReminderCreateSheet.tsx:86,221-226,243,246] —
  the create picker and the `+ "s"` pluralisation the AD-23 fix breaks
- [Source: src/components/atomic-crm/types.ts:71,173-185] — `TaskTargetType`; the `Single`
  shape (`first_name_en`/`last_name_en`, no `name`)
- [Source: src/components/atomic-crm/singles/index.ts:12-14] — `recordRepresentation` the
  `single` label case mirrors
- [Source: supabase/schemas/01_tables.sql:45-47,458-460] — `tasks_target_type_check` (3 values)
  and `interactions_target_type_check` (2 values): the DB half this story deliberately runs
  ahead of
- [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20] — the only
  in-repo `?raw` source-scanning precedent
- [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-12,59-86,95] —
  `vitest-browser-react` + `TestMemoryRouter` harness and the negative assertion idiom
- [Source: src/components/admin/data-table.tsx:23,233] — `useGetPathForRecordCallback`, the
  row-click primitive this story does **not** touch
- [Source: src/index.css:496-498] — `.ql-enter` / `ql-rise … both`, why `style` must ride on
  the anchor rather than move to the `<Card>`
- [Source: node_modules/react-router/dist/development/chunk-KS7C4IRE.mjs:10552-10557] —
  `<Link>` runs a consumer `onClick` first and skips navigation when `defaultPrevented`
  (react-router 7.18.1)
- [Source: node_modules/react-dom/cjs/react-dom-client.development.js:3384-3393] —
  `SyntheticEvent.preventDefault()` sets `defaultPrevented` on the shared event instance,
  which is what makes the capture-phase guard work
- [Source: node_modules/@hello-pangea/dnd/dist/dnd.js:7797-7799,7844-7852] —
  `dragHandleProps` (`tabIndex`, `role: "button"`, `draggable: false`, `preventHtml5Dnd`)
- [Source: node_modules/ra-core/dist/routing/useRedirect.js:41] and
  [Source: node_modules/ra-core/dist/routing/useScrollToTop.js:24-33] and
  [Source: node_modules/ra-core/dist/routing/useRestoreScrollPosition.js:24-35] and
  [Source: node_modules/ra-core/dist/core/CoreAdminRoutes.js:9] — why a bare `<Link>` is
  equivalent to `{ _scrollToTop: false }`
- [Source: node_modules/ra-core/dist/core/Resource.js:33-34] — `hasShow: !!show || !!hasShow`
- [Source: node_modules/ra-core/dist/routing/useCreatePath.js:56-62] — `useCreatePath`'s
  hardcoded `/show` suffix, why site 7 is migrated anyway
- [Source: supabase/schemas/06_grants.sql:616] — `grant update (body, metadata) on table
  public.interactions to authenticated`, why `RecordLink` must degrade rather than throw
- [Source: .claude/rules/lsp-usage.md] — use `LSP` for TypeScript symbols before editing the
  swept files; `grep` for the string patterns only
- [Source: .claude/rules/coding-style.md] — error handling; immutability
- [Source: .claude/rules/testing.md] — AAA, 80% coverage, no `waitForTimeout`
- [Source: .claude/rules/english-only.md]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via the bmad-dev-story workflow.

### Debug Log References

RED run of AC 6's `PENDING_DB_WIDENINGS` guard (contract §13 rule 2), captured by temporarily
removing `"tasks_target_type_check"` from the real `entity360/pendingDbWidenings.ts` array (not
a test-local copy) and running:

```
npx vitest run --config vitest.config.ts --project app src/components/atomic-crm/entity360/pendingDbWidenings.test.ts
```

```
 FAIL  |app (chromium)| src/components/atomic-crm/entity360/pendingDbWidenings.test.ts > PENDING_DB_WIDENINGS guard > reports no offenders today — every named constraint is honestly tracked as pending
AssertionError: expected [ 'tasks_target_type_check' ] to deeply equal []
- Expected
+ Received
- []
+ [
+   "tasks_target_type_check",
+ ]
 ❯ src/components/atomic-crm/entity360/pendingDbWidenings.test.ts:152:59

 FAIL  |app (chromium)| src/components/atomic-crm/entity360/pendingDbWidenings.test.ts > PENDING_DB_WIDENINGS guard > fails, naming the constraint, when interactions_target_type_check is removed from the pending list before its migration lands
AssertionError: expected [ 'tasks_target_type_check', …(1) ] to deeply equal [ 'interactions_target_type_check' ]

 Test Files  1 failed (1)
      Tests  2 failed | 7 passed (9)
```

Restored the entry; re-ran the same command — 9/9 passed (green). The permanent red-run
regression tests live in the test file itself (`PENDING_DB_WIDENINGS guard` describe block,
using a local filtered copy of the pending list so the suite doesn't require mutating the real
source on every run).

### Completion Notes List

- Implemented `RecordLink` (AC 1), the four stub descriptors (AC 2), the 13-site sweep (AC 3),
  the `ShidduchCard` accessibility fix (AC 4), the `reminders/` AD-23 + `single`-widening changes
  (AC 5), and the `types.ts` target-type vocabulary + `PENDING_DB_WIDENINGS` ledger (AC 6).
- **Contract deviation flagged, not silently made:** contract §8 rule 2 / this story's AC 6 say
  the guard "asserts... its value set is a subset of ENTITY_TARGET_TYPES". A literal subset
  check can never fail for either `tasks_target_type_check` or `interactions_target_type_check`
  as they stand today (their current value sets are already valid, legal subsets — just not at
  full parity), so it cannot produce the required red run ("remove `tasks_target_type_check`
  from `PENDING_DB_WIDENINGS` and confirm the guard fails, naming that constraint"). Implemented
  as a set-**equality** ("at parity with `ENTITY_TARGET_TYPES`") check for constraints not listed
  as pending instead, which is what makes the specified red run actually red, and matches
  contract §8 rule 1's "three DB check constraints must end up with the same four values."
  Flagged in the final report as something to fix in the contract text, not deviated from
  silently.
- **Second contract gap flagged:** `supabase/schemas/01_tables.sql` has a fourth
  `*_target_type_check` constraint not mentioned anywhere in the contract or story —
  `identity_signals_target_type_check`, values `('reference', 'shidduch', 'date_record')` — AD-5's
  dedupe/identity-match vocabulary, unrelated to AD-13's polymorphic tasks/interactions
  vocabulary this story's `ENTITY_TARGET_TYPES` governs. `date_record` is not an
  `EntityTargetType`. A blanket "every `*_target_type_check` constraint" scan would misclassify
  it as a violation on day one. The guard is scoped by an explicit, named allowlist (the three
  constraints contract §8 rule 1 actually names) rather than a name-pattern scan, with the
  reasoning documented in the guard test file's own header comment.
- `EntityTabDescriptor` (landed by 3.3a, pre-existing) is intentionally non-generic — no `<T>` —
  per its own doc comment; the four stub descriptors' `tabs: []` typechecks against it without
  needing a generic parameter.
- `RepeatRecognitionPanel.tsx`'s `others` filter was rewritten as a type-guard predicate
  (`link is ReferenceLinkSummary & { shidduchim_id: Identifier }`) so `RecordLink`'s `id: Identifier`
  prop typechecks without a non-null assertion — same runtime filter, better narrowing.
  `ReferenceCallLog.tsx`'s existing `link.shidduchim_id ? … : …` ternary already narrows correctly
  and needed no such change.
- `ReferenceMatchPanel.test.tsx` (pre-existing, not previously touched by Epic 3) needed a
  side-effect import of `./entityDescriptor` added so its existing `getByRole("link", …)`
  assertions keep resolving now that the panel renders through `RecordLink` (which degrades to a
  `<span>` for an unregistered resource) — the only pre-existing test file among the swept sites.
- Two prose mentions each of the retired `targetEntityPath` identifier and the quoted string
  `"Suggestion"` were left in doc comments after the first pass; reworded them out entirely so
  AC 3 command (d) and the AC 5 `"Suggestion"` grep both return zero hits including comments, not
  only live code.
- `make lint`'s `npm run prettier` step scopes to `**/*.{mjs,js,json,ts,tsx,css,md,html}` and is
  fully green. A broader `npx prettier --check .` (matching more extensions, e.g. `.yml`/`.mdx`)
  reports 15 pre-existing formatting issues in files this story never touches
  (`.github/workflows/*`, `.lintstagedrc`, `doc/**/*.mdx`) — verified via `git status` that none
  of them are part of this diff. Not fixed, to keep the diff scoped to this story.
- Local Supabase (dev stack, port 54321) was already running, so `npm run test:unit:db` (351
  tests, 8 files) ran for real rather than self-skipping, and
  `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local` was run and confirmed
  "No schema changes found" — expected, since this story touches no SQL.

### File List

**New files:**
- `src/components/atomic-crm/entity360/RecordLink.tsx`
- `src/components/atomic-crm/entity360/RecordLink.test.tsx`
- `src/components/atomic-crm/entity360/pendingDbWidenings.ts`
- `src/components/atomic-crm/entity360/pendingDbWidenings.test.ts`
- `src/components/atomic-crm/entity360/registry.stubs.test.ts`
- `src/components/atomic-crm/shidduchim/entityDescriptor.ts`
- `src/components/atomic-crm/shidduchim/ShidduchCard.test.tsx`
- `src/components/atomic-crm/singles/entityDescriptor.ts`
- `src/components/atomic-crm/shadchanim/entityDescriptor.ts`
- `src/components/atomic-crm/references/entityDescriptor.ts`
- `src/components/atomic-crm/reminders/reminderEntity.test.ts`
- `src/components/atomic-crm/reminders/ReminderCard.test.tsx`

**Modified files:**
- `src/components/atomic-crm/types.ts` (AC 6 — `ENTITY_TARGET_TYPES`/`EntityTargetType`, widened `TaskTargetType`)
- `src/components/atomic-crm/shidduchim/index.ts` (descriptor import)
- `src/components/atomic-crm/singles/index.ts` (descriptor import)
- `src/components/atomic-crm/shadchanim/index.ts` (descriptor import)
- `src/components/atomic-crm/references/index.ts` (descriptor import)
- `src/components/atomic-crm/dashboard/RecentSuggestions.tsx` (sweep site 1)
- `src/components/atomic-crm/dashboard/AttentionSection.tsx` (sweep site 2)
- `src/components/atomic-crm/references/ShidduchReferencesSection.tsx` (sweep site 3)
- `src/components/atomic-crm/references/ReferenceCallLog.tsx` (sweep site 4)
- `src/components/atomic-crm/references/ReferenceMatchPanel.tsx` (sweep site 5)
- `src/components/atomic-crm/references/RepeatRecognitionPanel.tsx` (sweep site 6)
- `src/components/atomic-crm/references/ReferenceList.tsx` (sweep site 7)
- `src/components/atomic-crm/singles/SingleCard.tsx` (sweep site 8)
- `src/components/atomic-crm/shadchanim/ShadchanCard.tsx` (sweep site 9)
- `src/components/atomic-crm/shadchanim/ShadchanSuggestions.tsx` (sweep site 10)
- `src/components/atomic-crm/shidduchim/ShidduchCard.tsx` (AC 4 — sweep site 11, accessibility fix)
- `src/components/atomic-crm/shidduchim/ShidduchCatchSection.tsx` (sweep site 13)
- `src/components/atomic-crm/reminders/reminderEntity.ts` (AC 5)
- `src/components/atomic-crm/reminders/useReminders.ts` (AC 5)
- `src/components/atomic-crm/reminders/ReminderCard.tsx` (AC 5, sweep site 12)
- `src/components/atomic-crm/reminders/ReminderCreateSheet.tsx` (AC 5)
- `src/components/atomic-crm/references/ReferenceMatchPanel.test.tsx` (pre-existing test, updated for RecordLink)
- `registry.json` (regenerated via `make registry-gen`)

## Change Log

- 2026-07-28 — Story implemented in full: all 6 ACs, all 7 tasks. `make typecheck`, `make lint`
  (eslint + prettier), `npx vitest run` (988 tests, all 5 projects including `db`), `make build`
  and `npx prettier --check .` (scoped diff only — 15 pre-existing unrelated files flagged) all
  green. Two contract deviations flagged rather than silently made: (1) AC 6's guard implements
  "at parity with `ENTITY_TARGET_TYPES`" rather than a literal "subset of" check, because subset
  alone can never fail and cannot produce the red run the AC itself requires; (2) the guard is
  scoped to the three named constraints (contract §8 rule 1) rather than every
  `*_target_type_check` constraint in the schema, because a real fourth one —
  `identity_signals_target_type_check` (AD-5's dedupe store, values including `date_record`) — is
  a different, unrelated vocabulary and would be a false positive under a blanket scan. Both are
  detailed in Completion Notes above.
