# Story 3.9: `RecordLink` primitive

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want every mention of a record to be clickable and go to the same place,
so that navigation is predictable.

## Position in Epic 3

**Depends on 3.3** (resolves a record's path through the `EntityDescriptor` registry).
**3.5 depends on this story** (its "entries link via `RecordLink`" AC). **Build this
story before 3.4-3.8** despite being numbered last — see 3.1's "suggested delivery
order" (`3.1 → 3.2 → 3.3 → 3.9 → 3.4 → ...`).

**Scope boundary — this story is the one exception to "no live-code changes."** Unlike
3.1-3.8, which build and test machinery without touching a real screen, this story's own
acceptance criterion — *"no ad-hoc record links remain in the codebase"* — is
unsatisfiable without touching real, live screens. Doing the sweep now (rather than
deferring it to Epic 5) is deliberate: `RecordLink` is a small leaf component with no
routing/shell dependency, the sweep is low-risk (each site already navigates correctly
today; this only centralises *how*), and leaving 12 duplicated, already-slightly-wrong
implementations in place until Epic 5 would fail this story's own AC for no benefit.

## What this story registers, and why that is not Epic 5's job

`RecordLink` resolves a path via `getEntityDescriptor(resource).buildRecordPath(id)`
(3.3). To work today, it needs *some* descriptor registered for each of the four live
entities. This story registers the **minimal** two required fields only — `name` +
`buildRecordPath`, reflecting **today's real, working routes** — not a full 360
descriptor (no `tabs`, `stats`, `avatar`, etc.). That is consistent with 3.3 AC 1, which
makes every field but those two optional for exactly this reason. Epic 5 fills in the
rest of each descriptor as it migrates that entity onto `Entity360`, and updates
`buildRecordPath` in the same story when the entity's route shape changes from
`/{resource}/{id}/show` to the AD-24 bare `/{resource}/{id}` (3.2's Dev Notes name this
exact one-line future edit).

```ts
registerEntityDescriptor({ name: "shidduchim", buildRecordPath: (id) => `/shidduchim/${id}/show` });
registerEntityDescriptor({ name: "singles",    buildRecordPath: (id) => `/singles/${id}/show` });
registerEntityDescriptor({ name: "shadchanim", buildRecordPath: (id) => `/shadchanim/${id}/show` });
registerEntityDescriptor({ name: "references", buildRecordPath: (id) => `/references/${id}/show` });
```

## Acceptance Criteria

1. **`RecordLink` renders an anchor, resolved from the registry, never a hand-built
   string.** `entity360/RecordLink.tsx` exports
   `RecordLink({ resource, id, children, ...rest }: RecordLinkProps)` where
   `RecordLinkProps = { resource: string; id: Identifier } &
   Omit<ComponentProps<typeof Link>, "to">` — it forwards every remaining anchor prop
   (`className`, `onClick`, `aria-*`, drag props, …) **and its ref** to the underlying
   `<Link to={getEntityDescriptor(resource).buildRecordPath(id)}>` (the `ShidduchCard`
   migration in AC 4 spreads `draggableProps`/`dragHandleProps` and passes
   `provided.innerRef`, so pass-through is load-bearing, not convenience). Calling
   it with an unregistered `resource` throws immediately with a message naming the
   resource — a missing registration is a developer error to catch at build/test time,
   not a silent broken link in production (`.claude/rules/coding-style.md#Error-handling`:
   "fail fast with clear error messages").

2. **The four live entities are registered exactly as above.** A test asserts
   `getEntityDescriptor("shidduchim")`, `"singles"`, `"shadchanim"`, `"references"` all
   resolve and pins each `buildRecordPath(1)` to today's real show route
   (`/{resource}/1/show`). The test cannot derive route shapes from
   `routeManifest.ts` (its `definition` holds components, not path templates), so it
   pins the four strings and carries a comment naming `routeManifest.ts` /
   `root/CRM.tsx` as what to re-check when it fails — which it will, deliberately, when
   Epic 5 changes an entity's route shape without updating its registration.

3. **The 12 verified ad-hoc record-mention sites (12 files) are migrated to
   `RecordLink`.** All four of these commands return **zero** hits after this story
   (the first returns exactly 9 hits today — verified 2026-07-26; create links contain
   no `${` directly after the resource segment, so the pattern skips them by
   construction):
   ```
   grep -rnE 'to=\{`/(shidduchim|references|shadchanim|children|singles)/\$\{' \
     src/components/atomic-crm --include="*.tsx" --include="*.ts"
   grep -n "useRedirect" src/components/atomic-crm/shidduchim/ShidduchCard.tsx
   grep -rn 'createPath({ resource: "references"' src/components/atomic-crm/references
   grep -rn "targetEntityPath" src/components/atomic-crm
   ```
   The 12 sites (line numbers as they exist under the pre-Epic-1 `children/` name — see
   Dev Notes "Verified sites" for the full table; re-verify with `LSP findReferences` /
   `workspaceSymbol` before editing, since Epic 1/2 landing first will have shifted line
   numbers and directory names):
   `dashboard/RecentSuggestions.tsx`, `dashboard/AttentionSection.tsx`,
   `references/ShidduchReferencesSection.tsx`, `references/ReferenceCallLog.tsx`
   (`LinkCard`), `references/ReferenceMatchPanel.tsx`,
   `references/RepeatRecognitionPanel.tsx`, `references/ReferenceList.tsx`,
   `singles/SingleCard.tsx` (today `children/ChildCard.tsx`),
   `shadchanim/ShadchanCard.tsx`, `shadchanim/ShadchanSuggestions.tsx`,
   `shidduchim/ShidduchCard.tsx`, `reminders/ReminderCard.tsx`.
   `/create`-suffixed links (e.g. `children/ChildList.tsx:46`, `shadchanim/ShadchanList.tsx:23`,
   `shidduchim/ShidduchColumn.tsx:104`, `shidduchim/ShidduchimList.tsx:151`,
   `references/ShidduchReferencesSection.tsx:93`) and
   list-level links (e.g. `dashboard/PipelineSnapshot.tsx:38`'s `to="/shidduchim"`) are
   **not** record mentions and are explicitly out of scope — do not convert them, `RecordLink`
   is for a specific record's own page, not a resource's list or create route.

4. **The one accessibility defect this sweep fixes.** `shidduchim/ShidduchCard.tsx`
   today navigates via `useRedirect()` inside a `<div onClick={handleClick}>` — not a
   real anchor, so it has no `href`, cannot be opened in a new tab, and is not reachable
   by keyboard or announced as a link by assistive tech. This story replaces it with
   `<RecordLink resource="shidduchim" id={shidduch.id} ...>` wrapping the card content,
   preserving the drag-vs-click guard (`if (snapshot?.isDragging) return`) by passing it
   as `RecordLink`'s `onClick`, which calls `event.preventDefault()` when dragging (a
   `<Link>` respects `preventDefault()` called from a consumer-supplied `onClick` and does
   not navigate) — verified with a test that a click during `snapshot.isDragging = true`
   does not navigate, and an ordinary click does.

5. **`reminders/reminderEntity.ts`'s `targetEntityPath` is retired, and its known bug is
   gone with it.** `targetEntityPath` hard-codes `/shadchanim/${id}` with **no** `/show`
   suffix (`reminderEntity.ts:47`, commented *"shadchanim has no /show — edit is its
   detail view"*) — but `shadchanim/index.ts` registers a real `show: ShadchanShow`, so
   that comment is stale and the link has pointed at the **edit** page instead of show
   for every shadchan-targeted reminder. `reminders/useReminders.ts`'s `linkedEntity`
   construction switches from `targetEntityPath(type, id)` to
   `<RecordLink resource={RESOURCE_FOR_TARGET[type]} id={id}>` (via `ReminderCard.tsx`,
   AC 3) — `targetEntityPath` is deleted; `RESOURCE_FOR_TARGET` and
   `targetEntityLabel`/`TARGET_TYPE_LABEL` stay (they answer a different question —
   which resource, and what to call it — that `RecordLink` does not need to duplicate).
   While in this file, add the `single` case Story 3.8 introduces to `TaskTargetType`
   (`RESOURCE_FOR_TARGET.single = "singles"`, `TARGET_TYPE_LABEL.single = "Single"`) so a
   single-targeted reminder is linkable and labelled — Story 3.8 widens the schema/type
   but does not touch this file, and leaving it out would silently break single-targeted
   reminders the moment 3.8 lands.

## Tasks / Subtasks

- [ ] **Task 1 — `RecordLink.tsx`** (AC: 1, 2)
  - [ ] Implement per AC 1 (throw on unregistered resource).
  - [ ] Register the four descriptors from "What this story registers" — in
        `entity360/RecordLink.tsx` itself (a module-scope side effect, matching the
        established pattern of `routeManifest.ts`'s `RESOURCES` populated at module
        scope) or a small co-located `entity360/liveResourcePaths.ts` if keeping
        registration separate from the component reads better — either is acceptable,
        pick one and do not split it across three files.
  - [ ] `RecordLink.test.tsx`: renders the right `href` for each of the four resources;
        throws for an unregistered one; forwards `onClick`/`className`/`children`.

- [ ] **Task 2 — The sweep** (AC: 3, 4)
  - [ ] Before editing, run `LSP findReferences` (or `workspaceSymbol`) to confirm each
        of the 12 files in AC 3 still matches — Epic 1/2 will have renamed
        `children` → `singles` and shifted line numbers by the time this story is
        implemented; use the import statements and `to={` patterns to relocate each site,
        not the line numbers quoted here.
  - [ ] Replace each site's `<Link to={...}>` (or, for `ShidduchCard.tsx`, the
        `<div onClick>`) with `<RecordLink resource="..." id={...}>`, preserving every
        existing class name / styling exactly (this is a navigation-mechanism change,
        not a visual one).
  - [ ] `references/ReferenceList.tsx`'s existing `createPath({...})` call is replaced
        too, even though it was already framework-correct — for consistency, and because
        `useCreatePath`'s hardcoded `/show` suffix (3.2 Dev Notes) means it will not
        follow `references`' route shape when Epic 5 changes it, while `RecordLink` will.
  - [ ] Run all four AC 3 verification commands; each must return nothing.

- [ ] **Task 3 — `reminderEntity.ts` / `ReminderCard.tsx` / `useReminders.ts`** (AC: 5)
  - [ ] Delete `targetEntityPath`; update `useReminders.ts`'s `linkedEntity` shape (it
        currently carries a precomputed `to: string` — change it to carry
        `{ resource: string; id: Identifier; label: string }` instead, and have
        `ReminderCard.tsx` render `<RecordLink resource={linkedEntity.resource}
        id={linkedEntity.id}>{linkedEntity.label}</RecordLink>`).
  - [ ] Add the `single` entries to `RESOURCE_FOR_TARGET` / `TARGET_TYPE_LABEL` /
        `LINKABLE_TARGET_TYPES` (if reminders should be creatable against a single — check
        whether `LINKABLE_TARGET_TYPES` gating a create picker should include it; if
        unsure, include it, since `TaskTargetType` now legitimately allows it per 3.8).
  - [ ] Update/extend `reminderEntity.ts`'s existing tests (if any) and
        `ReminderCard`'s tests for the new link shape.

## Dev Notes

### Verified sites (grep run 2026-07-26, against `main` pre-Epic-1/2 — re-verify at
implementation time)

| File | Target | Mechanism today |
|---|---|---|
| `dashboard/RecentSuggestions.tsx:51-52` | shidduch | `<Link to={`/shidduchim/${item.id}/show`}>` |
| `dashboard/AttentionSection.tsx:63-64` | shidduch | same shape |
| `references/ShidduchReferencesSection.tsx:69-70` | reference | same shape |
| `references/ReferenceCallLog.tsx:43-44` (`LinkCard`) | shidduch | same shape |
| `references/ReferenceMatchPanel.tsx:76-77` | reference | same shape |
| `references/RepeatRecognitionPanel.tsx:83-84` | shidduch | same shape |
| `references/ReferenceList.tsx:67-68` | reference | `createPath({ resource, id, type: "show" })` (already framework-correct — migrate for consistency, see Task 2) |
| `children/ChildCard.tsx:50-51` (→ `singles/SingleCard.tsx`) | single | `<Link to={`/children/${child.id}/show`}>` |
| `shadchanim/ShadchanCard.tsx:31-32` | shadchan | same shape |
| `shadchanim/ShadchanSuggestions.tsx:56-57` | shidduch | same shape |
| `shidduchim/ShidduchCard.tsx:89-98` | shidduch | `useRedirect()` inside `<div onClick>` — **not an anchor** (AC 4) |
| `reminders/ReminderCard.tsx:61-62` | polymorphic | `to={linkedEntity.to}`, built by `reminders/reminderEntity.ts:targetEntityPath` |

Excluded, checked and confirmed **not** record mentions: `dashboard/PipelineSnapshot.tsx:38`
(`to="/shidduchim"`, a list link), `dashboard/DashboardStat.tsx`'s `to` prop (caller-supplied
list-filter link, not a record), `children/ChildList.tsx:46`, `shadchanim/ShadchanList.tsx:23`,
`shidduchim/ShidduchColumn.tsx:104`, `shidduchim/ShidduchimList.tsx:151` (all `/create`
links), `misc/EmptyState.tsx`'s `actionTo` (generic CTA, resource-agnostic),
`settings/FamilySection.tsx:26` (list link), `simple-list/SimpleListItem.tsx` (a
different concern — the generic `<List>`/`<DataTable>` row-click primitive, not an
inline record mention; left alone by this story, see below).

### Why `SimpleListItem.tsx` is out of scope

`simple-list/SimpleListItem.tsx` already resolves its href via `ra-core`'s
`useGetPathForRecord`/`useCreatePath` machinery — it is a `<List>`/`<DataTable>` row
wrapper, not an inline mention of a record inside other content (a card, a timeline
entry, a rail panel). AD-24's "every record mention … on a board card, list row,
timeline entry, rail panel or search result" reads "list row" as *this* kind of
component's job, which Epic 4's `EntityList` (UX-DR7) owns, not this story. Converting
it to `RecordLink` would fold Epic 4 scope into Epic 3 for no behavioural gain — it is
not one of the ad-hoc/duplicated cases this story exists to clean up.

### The `ShidduchCard.tsx` fix, mechanically

```tsx
<RecordLink
  resource="shidduchim"
  id={shidduch.id}
  onClick={(e) => { if (snapshot?.isDragging) e.preventDefault(); }}
  {...provided?.draggableProps}
  {...provided?.dragHandleProps}
  ref={provided?.innerRef}
  className="cursor-pointer block"
>
  <Card>...</Card>
</RecordLink>
```
`react-router`'s `<Link>` (which `RecordLink` wraps) calls a consumer-supplied `onClick`
before its own navigation logic and respects `preventDefault()` — this is the standard,
documented way to suppress a `<Link>`'s navigation conditionally, not a hack.
`@hello-pangea/dnd`'s `draggableProps`/`dragHandleProps` are plain DOM props/attributes
and are safe to spread onto an anchor element.

### Testing standard

AAA, `app` project. Component tests per file touched (a render + click test proving the
right `href`/navigation, not a snapshot test) — reuse each file's existing test file if
one exists, add one if it does not. No backend/RLS surface in this story.

### Project Structure Notes

- `entity360/RecordLink.tsx` is the last new file in `entity360/` for this epic.
- This story is the only one in Epic 3 that edits files outside `entity360/` — that is
  the deliberate exception stated in "Position in Epic 3", not scope creep.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3-The-360-Framework — Story 3.9]
- [Source: ARCHITECTURE-SPINE.md#AD-24] — "every record mention anywhere renders through
  one `RecordLink`"
- [Source: 3-2-url-backed-tabs.md#Dev-Notes] — `useCreatePath`'s hardcoded `/show` suffix,
  why `ReferenceList.tsx`'s already-correct usage is migrated anyway
- [Source: 3-3-entity-descriptor-registry.md] — the registry `RecordLink` resolves through
- [Source: src/components/atomic-crm/shidduchim/ShidduchCard.tsx:79-99] — the
  accessibility defect (`useRedirect` in a `<div onClick>`) this story fixes
- [Source: src/components/atomic-crm/reminders/reminderEntity.ts:36-52] — `targetEntityPath`
  and its stale, wrong `/shadchanim/${id}` (no `/show`) case, retired by this story
- [Source: src/components/atomic-crm/references/ReferenceList.tsx:67-68] — the one
  already-framework-correct site, migrated for consistency
- [Source: .claude/rules/lsp-usage.md] — `findReferences`/`workspaceSymbol` before editing
  any of the 12 files, since Epic 1/2 will have moved/renamed them
- [Source: .claude/rules/coding-style.md#Error-handling, .claude/rules/testing.md,
  .claude/rules/english-only.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
