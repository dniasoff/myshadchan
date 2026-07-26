# Story 3.4: Permission-aware rendering

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a platform owner,
I want fields and tabs to respect the viewer,
so that one view can safely serve parent, single, helper and shadchan.

## Position in Epic 3

**4th of 9. Depends on 3.3** (adds `minVisibility` to `EntityTabDescriptor` and gates
`EntityShow`'s tab rendering). **3.5-3.8 depend on this story** to declare
`minVisibility` on their tab kinds where relevant, and **3.9** does not depend on it.

**Hard cross-epic dependency — flag to the epic owner.** This story needs a real,
per-context **role** for the signed-in caller. Today that does not exist: the only role
signal in the codebase is `sales.administrator` (a boolean), consumed by
`providers/commons/canAccess.ts` as a binary `"admin" | "user"`
[Source: src/components/atomic-crm/providers/commons/canAccess.ts:16-30,
src/components/atomic-crm/providers/supabase/authProvider.ts:166-169]. **Epic 2** (not
yet storied at the time this story was written) is where the real 5-value role
(`parent_admin | single | helper | self_manager | shadchan`, AD-2) becomes resolvable
per active context. This story is written against an assumed contract — a
`current_role()` seam — and names exactly one call site that Epic 2 must satisfy or
retarget. **This is not this story's decision to defer** (per the harness rule "no
unresolved decisions") — it commits to the contract below and Epic 2 either matches it
or updates the one function documented in AC 5.

## Acceptance Criteria

1. **`EntityTabDescriptor` gains `minVisibility`.** In `entity360/entityDescriptor.ts`
   (3.3), `EntityTabDescriptor<T>` gains an optional `minVisibility?: Role[]`, where
   `Role` is the AD-2 vocabulary: `"parent_admin" | "single" | "helper" |
   "self_manager" | "shadchan"` (exported from the same file, the one place this union
   is spelled out — 3.5-3.8 and Epic 5/6 import it rather than re-declaring it). A tab
   with no `minVisibility` is visible to every role (the default is open, matching every
   tab that exists today).

2. **A viewer without the required role never sees the tab, in the DOM or the tab
   bar.** `entity360/entityPermissions.ts` exports a pure function
   `hasVisibility(minVisibility: Role[] | undefined, viewerRole: Role | undefined):
   boolean` (no `minVisibility` → `true`; `viewerRole` undefined → `false` for any
   restricted tab — fail closed). `EntityShow`/`Entity360Tabs` (3.2/3.3) filter the
   descriptor's `tabs` array through `hasVisibility` **before** it reaches
   `Entity360Tabs` — a gated-out tab is not merely styled `hidden`, it is never included
   in the array passed to the renderer, so it cannot appear in `document.body.innerHTML`
   under any selector. A render test with a two-tab fixture (one `minVisibility:
   ["parent_admin"]`, one open) and a mocked `helper` viewer asserts
   `screen.queryByText(...)` for the restricted tab's label returns `null`.

3. **A role-restricted URL behaves exactly like an unknown tab.** Deep-linking straight to
   `/{entity}/{id}/{restricted-tab-key}` as a `helper` falls back to the first
   *visible-to-that-role* tab — reusing 3.2 AC 3's fallback path, not a second
   "access denied" branch, so the URL never confirms to the caller that a tab they cannot
   see exists. A test seeds a memory router at the restricted tab's path with a `helper`
   viewer and asserts the first visible tab renders instead.

4. **The gated tab's data is never fetched for a viewer who cannot see it — proven by a
   spy, not a screenshot.** A tab's `render` function is where its data-fetching hook
   lives (per 3.3's `EntityTabDescriptor.render: (record) => ReactNode`); because
   `hasVisibility` filtering happens before a tab reaches `Entity360Tabs` (AC 2), a
   restricted tab's `render` function is **never called** for a viewer who fails the
   check — not called-and-its-output-hidden, simply never invoked. A test passes a
   `vi.fn()` as the restricted tab's `render` and asserts it has zero calls when mounted
   for a `helper` viewer, and at least one call for a `parent_admin` viewer. This is the
   client-side half of "the underlying data was never sent to the client" — see Dev
   Notes "What this AC does and does not prove" for the server-side half, which is
   necessarily entity-specific and therefore out of this story's scope.

5. **The viewer-role seam is named, isolated, and documented as swap-in-progress.**
   `entity360/useViewerRole.ts` exports `useViewerRole(): Role | undefined` as the
   **single** call site every gating check in `entity360/` goes through. Its current
   implementation derives a role from the existing `sales.administrator` boolean
   (`"admin"` → `"parent_admin"`, else → `"helper"` — the closest honest mapping
   available today, documented as provisional) via `useGetIdentity()`
   [Source: src/components/atomic-crm/providers/supabase/authProvider.ts:9-20]. A
   `// TODO(Epic-2)` comment states exactly what must change: read
   `account_members.role` for `current_context_id()` (AD-19) instead. No other file in
   `entity360/` calls `useGetIdentity()` or reads `sales.administrator` directly — a grep
   test (`grep -rn "useGetIdentity\|\.administrator" src/components/atomic-crm/entity360/`)
   returns exactly the one hit inside `useViewerRole.ts`.

6. **Negative test — the security-triggers rule, satisfied at this story's own
   layer.** `.claude/rules/security-triggers.md` requires a negative test for any
   diff touching authorization code. This story's negative test is AC 2 + AC 4 combined:
   for **each** of the five AD-2 roles, a fixture descriptor with a tab restricted to a
   different role renders with that tab absent from the DOM and its `render` uncalled —
   one parameterised `it.each` covering all five, not one hand-picked role.

## Tasks / Subtasks

- [ ] **Task 1 — Extend the descriptor type** (AC: 1)
  - [ ] Add `Role` union and `minVisibility?: Role[]` to `EntityTabDescriptor` in
        `entity360/entityDescriptor.ts` (3.3's file — this is an additive edit, not a new
        file).

- [ ] **Task 2 — `entityPermissions.ts`** (AC: 2)
  - [ ] Implement `hasVisibility` exactly as specified (fail-closed on missing
        `viewerRole`).
  - [ ] `entityPermissions.test.ts`: table-driven over all five roles × restricted/open
        tab combinations.

- [ ] **Task 3 — `useViewerRole.ts`** (AC: 5)
  - [ ] Implement the provisional mapping from `sales.administrator`, with the
        `// TODO(Epic-2)` comment naming `account_members.role` + `current_context_id()`
        as the real source.
  - [ ] Add the grep-boundary test from AC 5.

- [ ] **Task 4 — Wire gating into `EntityShow`/`Entity360Tabs`** (AC: 2, 3, 4)
  - [ ] `EntityShow` (3.3) filters `descriptor.tabs` through `hasVisibility(tab.minVisibility, useViewerRole())` before constructing the array passed to `Entity360Tabs`.
  - [ ] Confirm 3.2's "unknown tab falls back to first" logic in `Entity360Tabs` needs no
        change to satisfy AC 3 — it already falls back on any tab key not present in the
        (now pre-filtered) array. If it does need a change, make it in
        `entity360/Entity360Tabs.tsx`, not by adding a second fallback path.
  - [ ] Tests per AC 2, 3, 4 (the `vi.fn()` render-spy test, the deep-link fallback test).

- [ ] **Task 5 — The five-role negative test** (AC: 6)
  - [ ] One `it.each` in `EntityShow.test.tsx` (or a new `EntityShow.permissions.test.tsx`
        if the file would otherwise exceed ~350 lines) covering all five AD-2 roles.

## Dev Notes

### What this AC does and does not prove — read before writing the negative test

AD-1: *"every domain row is scoped … FORCE ROW LEVEL SECURITY … enforced in Postgres"*
[Source: ARCHITECTURE-SPINE.md#AD-1]. This story's negative test proves the **client**
never requests or renders gated data — a real, valuable, testable guarantee, and the
correct guarantee for a story about *rendering*. It does **not** and cannot prove that
Postgres itself would refuse the same read if a client bypassed the UI entirely (e.g. a
raw REST call), because that requires a genuinely sensitive **entity-specific** column or
table (medical notes, candid reference words) that does not exist inside Epic 3's
"machinery, not entities" scope (see 3.1/3.2/3.3's own scope boundaries). That DB-level
half is delivered where the sensitive data actually lives: Epic 5 Story 5.5 (Medical tab,
"the tab and its data are absent, enforced by RLS not UI") and Epic 6 Story 6.3
(field-level scoping for a single). **Flag to the epic owner:** confirm this split —
Epic 3 delivers the rendering discipline and the never-fetch guarantee; Epic 5/6 deliver
the RLS half for their specific sensitive fields, each with its own AD-1-mandated
negative test at the database layer.

### The role vocabulary, and why `useViewerRole` is provisional

`parent_admin | single | helper | self_manager | shadchan`
[Source: ARCHITECTURE-SPINE.md#AD-2; _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#Roles-within-a-context].
Today's schema only has `parent_admin | helper | self_manager | shadchan` on
`account_members_role_check` [Source: supabase/schemas/01_tables.sql:271-273] — `single`
is added by Epic 2 Story 2.2 per Epic 1 Story 1.3's own Dev Notes
("Epic 2 (story 2.2) will add `single` to `account_members_role_check`"). This story's
`Role` union includes `single` now, ahead of the schema, because the type is meant to be
stable for 3.5-3.8 and Epic 5/6 to build against without a second edit later — a
TypeScript union with an unreachable-until-Epic-2 member is harmless; a schema check
constraint without `single` is not touched by this story.

### Reuse — `canAccess`/`useCanAccess`, not a second permission system

`ra-core` already ships a permission mechanism this app already uses
(`authProvider.canAccess`, `<CanAccess resource action>` in `layout/TopBar.tsx:44,47`).
This story does **not** replace it or build a parallel authorization framework — it adds
a narrower, 360-specific `minVisibility` check for tabs, which answers a different
question ("can this role see this **tab of this record**") than `canAccess` answers
("can this role perform this **action on this resource**"). Do not route
`minVisibility` checks through `canAccess`, and do not extend `canAccess` inside this
story — that binary `admin`/`user` split is Epic 2's to replace, not this story's.

### Testing standard

AAA, `app` vitest project, table-driven (`it.each`) for the five-role sweep
[Source: .claude/rules/testing.md]. No database/RLS surface touched by this story — no
migration, no `test:unit:db` involvement (that arrives with 3.5/3.6's schema widening,
and with Epic 5/6's entity-specific sensitive fields).

### Security review

This diff touches authorization-adjacent code (`entityPermissions.ts`, `useViewerRole.ts`)
— dispatch SECURITY-REVIEWER per `.claude/rules/security-triggers.md`, even though no RLS
policy changes in this story.

### Project Structure Notes

- `entity360/entityPermissions.ts` and `entity360/useViewerRole.ts` are new, small,
  single-purpose files — do not fold either into `entityDescriptor.ts` (the type
  definition file) or `EntityShow.tsx` (the renderer); `.claude/rules/coding-style.md`'s
  "grow the file count, not the file" applies directly here.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3-The-360-Framework — Story 3.4]
- [Source: ARCHITECTURE-SPINE.md#AD-1] — Postgres-enforced isolation, the half this story
  does not (and structurally cannot) cover
- [Source: ARCHITECTURE-SPINE.md#AD-2] — the role vocabulary
- [Source: ARCHITECTURE-SPINE.md#AD-19] — `current_context_id()`, the resolver
  `useViewerRole()` must eventually read through (Epic 2)
- [Source: _bmad-output/specs/spec-myshadchan/personas-and-contexts.md#Roles-within-a-context]
- [Source: src/components/atomic-crm/providers/commons/canAccess.ts] — the existing,
  soon-to-be-superseded binary permission check; not replaced by this story
- [Source: src/components/atomic-crm/providers/supabase/authProvider.ts:9-20,160-170]
  — `getIdentity`/`canAccess`, today's only role signal
  (`sales.administrator`)
- [Source: supabase/schemas/01_tables.sql:271-273] — `account_members_role_check`,
  missing `single` until Epic 2 Story 2.2
- [Source: _bmad-output/implementation-artifacts/1-3-rename-children-to-singles.md#Cross-story-coupling]
  — "Epic 2 (story 2.2) will add `single` to `account_members_role_check`"
- [Source: .claude/rules/security-triggers.md]
- [Source: .claude/rules/coding-style.md, .claude/rules/testing.md,
  .claude/rules/english-only.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
