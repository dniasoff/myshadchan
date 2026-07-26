# Story 3.1: `Entity360` shell

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want every record to look and behave the same,
so that I learn the app once.

## Position in Epic 3

**1st of 9.** Nothing in this epic exists yet — this story creates the directory
(`src/components/atomic-crm/entity360/`) every later Epic 3 story adds to. It has no
in-epic dependency, but it depends structurally on **Epic 1** having landed
(`children` → `singles`, `sales` → `members`, `root/routeManifest.ts` created by Epic 1
Story 1.5) and this story is itself a dependency of 3.2 (tabs slot into the shell) and
3.3 (the descriptor registry renders 360s through this shell).

**Scope boundary — read before starting.** This story builds and tests the shell as a
**generic, presentational primitive** using a fixture record, not a real entity. Wiring
a real resource (`shidduchim`, `singles`, `shadchanim`, `references`) onto `Entity360`
is explicitly **Epic 5's** job (Stories 5.1, 5.8, 5.9, 5.10) — Epic 1 Story 1.5's Dev
Notes table states this in writing: *"Epic 3/4/5 | `Entity360`, `EntityList`, AD-24
route shape … | Do not restructure routes."* Do not migrate `ShidduchShow.tsx`,
`ShadchanShow.tsx`, `singles/SingleShow.tsx` or `ReferenceShow.tsx` onto `Entity360` in
this story — that would pre-empt Epic 5 and leave two parallel show surfaces live at
once, which NFR-14 forbids. Prove the shell with a fixture record and role-play props in
its own test file, the same pattern Epic 1 Story 1.5 used for `routeManifest.test.ts`
("a deliberately-invalid fixture manifest declared inside the test file").

## Acceptance Criteria

1. **`Entity360` renders seven fixed regions, in fixed DOM order, each optional.**
   `src/components/atomic-crm/entity360/Entity360.tsx` exports a component accepting one
   prop per region — `breadcrumb`, `identityHeader`, `statBand`, `alertSlot`, `tabBar`,
   `children` (the content region), `rightRail` — each `ReactNode | undefined`. When a
   region's prop is `undefined`, nothing renders for it (no empty wrapper `<div>` left in
   the DOM). When two or more regions ARE populated, they appear in the DOM in exactly
   the order breadcrumb → identityHeader → statBand → alertSlot → tabBar → children →
   rightRail, regardless of the order the props are passed in JSX. A render test with all
   seven populated asserts this order via `container.textContent.indexOf(...)` (or
   `compareDocumentPosition`) on distinguishable marker text in each region.

2. **Regions cannot be restyled or reordered by the caller.** `Entity360`'s props carry
   no `className` (per-region or root) and no `order`/`layout` prop. Each region is
   wrapped in a fixed, non-overridable container the shell owns; only the **content**
   inside a region is caller-supplied. A test asserts `Entity360` accepts no `className`
   prop at the type level (a `// @ts-expect-error` test case) and that passing extra DOM
   props is not plumbed through to the root element.

3. **Renders in light and dark, and does not overflow at 375px.** `Entity360` uses only
   Tailwind semantic tokens / CSS custom properties already used elsewhere in the app
   (`bg-card`, `text-muted-foreground`, `border-border`, etc. — see Dev Notes "Theme
   tokens already in use") — no hard-coded hex/rgb color and no inline `style` background
   color. No class name or inline style in `Entity360.tsx` or `EntityAvatar.tsx` sets a
   fixed pixel width greater than 375, and the root container's layout classes include a
   responsive stack (`flex-col`) with no unconditional `min-w-` wider than the smallest
   breakpoint. Verified by a vitest `it` that imports each new file's source as text via
   Vite's `?raw` import (the `app` project runs in a real Chromium browser —
   vitest.config.ts's own comment — so `child_process`/`node:fs` are unavailable; `?raw`
   is the in-browser equivalent of the grep) and asserts
   `/min-w-\[(3[89][0-9]|[4-9][0-9]{2})px\]|#[0-9a-fA-F]{3,6}\b/` matches nothing.

4. **The identity header stops duplicating the avatar chip.** A shared `EntityAvatar`
   component (`src/components/atomic-crm/entity360/EntityAvatar.tsx`) is built to replace
   the four near-identical monogram-chip blocks currently hand-rolled in
   `singles/SingleShow.tsx` (`ChildProfileHeader`, today `children/ChildShow.tsx:34-100`),
   `shadchanim/ShadchanHeader.tsx:21-22` + its surrounding markup,
   `references/ReferenceShow.tsx:36-58` (`ReferenceHeader`), and
   `shidduchim/ShidduchShowHeader.tsx:31-40`. `EntityAvatar` takes
   `{ seed?: string | null; monogramSource?: string | null; className?: string }` —
   `monogramSource` feeds `getMonogram`, `seed` feeds `getAvatarIndex` (all four call
   sites today pass `name` as the monogram source and `name ?? String(id)` as the index
   seed — two inputs, so one `seed` prop cannot serve both), `className` only for the
   size/radius variants the four sites genuinely differ in (`h-14/rounded-2xl` vs
   `h-12/rounded-xl`) — and renders the rounded chip with the `--avatar-{n}` background
   and `aria-hidden` exactly as today. **This story only extracts the component and gets
   `getMonogram`/`getAvatarIndex` into it (AC 5) — it does not yet rewire the four call
   sites to use `EntityAvatar`.** Rewiring each header is each entity's own change, made
   when Epic 5 migrates that entity onto `Entity360` (Stories 5.1, 5.8, 5.9, 5.10) —
   doing it now would touch live show pages, which is out of this story's scope per
   "Position in Epic 3" above.

5. **`getMonogram`/`getAvatarIndex` move to `entity360/`.** They are cross-entity
   utilities already imported by 9 files beyond `boardUtils.ts` itself, six of them
   outside `shidduchim/` (verified:
   `singles/SingleCard.tsx`, `singles/SingleShow.tsx`, `references/ReferenceList.tsx`,
   `references/ReferenceShow.tsx`, `shadchanim/ShadchanCard.tsx`,
   `shadchanim/ShadchanHeader.tsx`, `shidduchim/ShidduchShowHeader.tsx`,
   `shidduchim/ShidduchCard.tsx`, plus `shidduchim/boardUtils.test.ts` — 9 files today
   under the pre-rename names `children/ChildCard.tsx` and `children/ChildShow.tsx`).
   Move both functions from `shidduchim/boardUtils.ts` to
   `src/components/atomic-crm/entity360/avatar.ts`; `boardUtils.ts` no longer exports
   either; all 8 non-test importers switch their import to
   `"../entity360/avatar"`; the two `describe("getMonogram")` /
   `describe("getAvatarIndex")` blocks move from `shidduchim/boardUtils.test.ts` to a new
   `entity360/avatar.test.ts` unchanged. `grep -rn "getMonogram\|getAvatarIndex" src/components/atomic-crm/shidduchim/boardUtils.ts` returns no hits afterward.

6. **The stat band reuses `DashboardStat`, never a bespoke tile.** `Entity360`'s
   `statBand` prop accepts `ReactNode` (a caller-composed row) rather than a data shape —
   the shell does not fetch or format stats itself (that is 3.3's job, per-entity). Dev
   Notes name `dashboard/DashboardStat.tsx` as the tile every future stat band must
   render through; this AC is satisfied by the shell imposing no bespoke tile of its own
   and by a code comment/JSDoc on the `statBand` prop pointing implementers at it.

7. **The alert slot reuses shadcn's `Alert`.** Same treatment as the stat band: the
   `alertSlot` prop is `ReactNode`, and Dev Notes direct implementers to
   `@/components/ui/alert.tsx` rather than a new banner component.

## Tasks / Subtasks

- [ ] **Task 1 — Move the avatar utilities** (AC: 5)
  - [ ] Create `src/components/atomic-crm/entity360/avatar.ts`; move `getMonogram` and
        `getAvatarIndex` out of `shidduchim/boardUtils.ts` verbatim (no behaviour change).
  - [ ] Update the 8 non-test importers listed in AC 5 to import from `"../entity360/avatar"`.
        Use `LSP findReferences` on both symbols first to confirm the count before editing
        (`.claude/rules/lsp-usage.md`) — do not re-grep by hand.
  - [ ] Move `entity360/avatar.test.ts` out of `boardUtils.test.ts`'s two `describe`
        blocks; confirm `boardUtils.ts` still type-checks (it keeps `getShidduchimByState`
        and `ShidduchimByState`, which are genuinely shidduchim-specific and stay put).

- [ ] **Task 2 — Build `EntityAvatar`** (AC: 4)
  - [ ] Create `entity360/EntityAvatar.tsx` with the AC 4 props (`seed`,
        `monogramSource`, `className` — the `className` override is a size/radius
        variant only; AC 2's "no restyling" rule applies to `Entity360` itself, not this
        leaf component), rendering the monogram chip markup common to the four headers
        named in AC 4 (rounded box, `--avatar-{getAvatarIndex(seed)}` background,
        `getMonogram(monogramSource)` text, `aria-hidden`).
  - [ ] Do not touch `singles/SingleShow.tsx`, `shadchanim/ShadchanHeader.tsx`,
        `references/ReferenceShow.tsx` or `shidduchim/ShidduchShowHeader.tsx` beyond what
        Task 1's import move requires. Rewiring them to render `<EntityAvatar>` is Epic
        5's job (see "Position in Epic 3").

- [ ] **Task 3 — Build the `Entity360` shell** (AC: 1, 2, 3, 6, 7)
  - [ ] Create `entity360/Entity360.tsx` with the seven props from AC 1, each rendered
        inside its own fixed wrapper element in the pinned order; no prop controls order
        or styling (AC 2).
  - [ ] Root layout: `flex flex-col gap-*` (stacks regions vertically, which is
        375px-safe by construction); `rightRail`, when present, renders after `children`
        in the DOM but may lay out side-by-side at a wider breakpoint via a responsive
        grid/flex wrapper — still no fixed pixel `min-w` above 375 (AC 3).
  - [ ] JSDoc on `statBand` and `alertSlot` props naming `DashboardStat` and `Alert`
        respectively as the tile/banner primitive to compose them from (AC 6, 7).

- [ ] **Task 4 — Tests** (AC: 1, 2, 3)
  - [ ] `entity360/Entity360.test.tsx`, AAA-structured: one `it` per region-order
        assertion (all seven populated → correct DOM order), one `it` per "region absent
        when prop undefined" case, one `it` for the `className`/no-restyle type check
        (`// @ts-expect-error` on `<Entity360 className="x" .../>`).
  - [ ] The no-hard-pixel / no-hex-color check from AC 3, written as a plain vitest `it`
        (no DOM) over `?raw` source imports, modelled on `routeManifest.test.ts`'s
        plain-logic style.
  - [ ] `entity360/avatar.test.ts` — the two moved `describe` blocks, unchanged
        assertions.

## Dev Notes

### What this story is (and is not)

AD-24: *"every entity renders through one `Entity360` shell with fixed regions in fixed
order (breadcrumb → identity header → stat band → alert slot → tab bar → content →
optional right rail); regions are optional per entity but never reordered or
restyled."* [Source: ARCHITECTURE-SPINE.md#AD-24] This story delivers exactly that
sentence as a component, proven with fixture content — it does **not** decide what goes
in the tab bar (3.2), does not fetch or declare per-entity data (3.3), and does not gate
by viewer role (3.4). Those are named, separate stories precisely so this one stays a
small, reusable layout primitive.

### Theme tokens already in use (reuse, do not invent new ones)

Every existing show page in the repo already themes exclusively through CSS custom
properties consumed via Tailwind semantic classes — `bg-card`, `text-muted-foreground`,
`border-border`, `--avatar-{n}` / `--avatar-ink`, `--positive`, `--glass-bg` /
`--glass-border` — see `singles/SingleShow.tsx` (today `children/ChildShow.tsx`),
`shadchanim/ShadchanShow.tsx`, `references/ReferenceShow.tsx` for the pattern. Dark mode
is therefore automatic wherever `Entity360` sticks to the same tokens; it needs no
`dark:` variant classes of its own, matching how the rest of the app themes.

### Why the avatar move, and why call-site rewiring is deferred

Nine files import `getMonogram`/`getAvatarIndex` from `shidduchim/boardUtils.ts` today —
a shidduchim-specific file hosting a cross-entity primitive purely by historical
accident. `.claude/rules/coding-style.md` ("organize by feature/domain") and DRY both
point at relocating it into the shell's own home now that `entity360/` exists as that
home. But the four *header* components that build the avatar chip inline
(`ChildProfileHeader`, `ShadchanHeader`, `ReferenceHeader`, `ShidduchShowHeader`) are live
production show pages outside this epic's "machinery only" boundary — editing their JSX
now duplicates work Epic 5 does anyway when it moves each entity onto `Entity360`, and
risks a visual regression in a screen this story has no reason to touch. The import-path
fix (Task 1) is mechanical and safe; the JSX extraction (`EntityAvatar`, Task 2) is built
and tested but not yet consumed by production code — same posture as the shell itself.

### Post-Epic-1 naming

Written against the state after Epic 1 lands: `singles/` (not `children/`), `members`
(not `sales`), `root/routeManifest.ts` exists. On `main` today (Epics 1-2 are storied but
not yet implemented) the same 9 avatar call sites live under `children/ChildCard.tsx` and
`children/ChildShow.tsx` — locate them by import statement
(`from "../shidduchim/boardUtils"` importing `getMonogram`/`getAvatarIndex`) rather than
by the file paths quoted here, and use whatever the resource directory is actually named
at the time you implement this story.

### Testing standard

AAA, descriptive `it` names, no shared mutable state between tests
[Source: .claude/rules/testing.md]. Runs in the `app` vitest project
(`npm run test:unit:app`), same project as `routeManifest.test.ts` — note the `app`
project executes in a real headless Chromium (vitest browser mode), so tests cannot
shell out or touch `node:fs`; source-text assertions use Vite `?raw` imports instead
[Source: vitest.config.ts — the "app" project block and its browser config]. The
`// @ts-expect-error` case in AC 2 is enforced by `make typecheck` (an unused
`@ts-expect-error` is itself a tsc error), not by the test runner. No new backend
surface — no migration, no RLS, no `test:unit:db` involvement in this story.

### Project Structure Notes

- New directory `src/components/atomic-crm/entity360/` is this epic's home; every
  subsequent Epic 3 story adds files here (`entity360/tabs/` for 3.5-3.8,
  `entity360/RecordLink.tsx` for 3.9, etc.). Do not scatter shell code into an existing
  entity folder.
- File sizes stay well inside the 200-400 line typical ceiling
  [Source: .claude/rules/coding-style.md#File-organization] — `Entity360.tsx` is a pure
  layout component with no data fetching, so it should land under 150 lines.
- English-only in all new files and comments [Source: .claude/rules/english-only.md].

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3-The-360-Framework — Story 3.1]
- [Source: ARCHITECTURE-SPINE.md#AD-24] — the shell contract this story implements
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Capabilities — CAP-7]
- [Source: _bmad-output/planning-artifacts/epics.md#UX-Design-Requirements — UX-DR1,
  UX-DR11] (the UX-DRs are defined in epics.md, not in SPEC.md)
- [Source: _bmad-output/implementation-artifacts/1-5-remove-dead-routes.md#Dev-Notes §4] —
  "Epic 3/4/5 … `Entity360` … Do not restructure routes" — the scope boundary this story
  respects, and the fixture-in-test-file testing pattern (`routeManifest.test.ts`) this
  story follows
- [Source: src/components/atomic-crm/shidduchim/boardUtils.ts:34-51] — `getMonogram` /
  `getAvatarIndex`, moved by this story
- [Source: src/components/atomic-crm/children/ChildShow.tsx:34-100,
  shadchanim/ShadchanHeader.tsx, references/ReferenceShow.tsx:31-58,
  shidduchim/ShidduchShowHeader.tsx] — the four duplicated avatar-chip blocks `EntityAvatar`
  will eventually replace (Epic 5)
- [Source: src/components/atomic-crm/dashboard/DashboardStat.tsx] — the stat tile the
  stat band must compose from
- [Source: src/components/ui/alert.tsx] — the alert primitive the alert slot must compose
  from
- [Source: .claude/rules/coding-style.md, .claude/rules/testing.md,
  .claude/rules/lsp-usage.md, .claude/rules/english-only.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
