---
baseline_commit: a1cf0253e9f27a6fb684d2be7723919343c60e82
---

# Story 3.1: `Entity360` shell

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want every record to look and behave the same,
so that I learn the app once.

## Position in Epic 3

**Step 1 of the Epic 3 build order** (Epic 3 canonical API contract §12; that table lists 13 steps, while the file set is 14 stories — 3.12 and 3.13 were split out after it was written, so step numbers are authoritative and totals are not). Epics 1
and 2 are implemented and Epic 2 is deployed; every path in this story is a path that
exists on `main` today.

- **Depends on:** nothing inside Epic 3. Step 0 — the tab-vocabulary story, which the contract
  calls `3-13` but which is **filed as
  `_bmad-output/implementation-artifacts/3-10-tab-vocabulary.md`** (not
  `3-13-records-at-urls-not-modals.md`, a different story) — is a separate module with no
  relationship to the shell, so this story may start immediately.
  Structurally it depends on Epic 1 having landed — `singles/` (there is no `children/`),
  `members` (there is no `sales`), `root/routeManifest.ts` — all of which is true on `main`.
- **Blocks:** `3.2` (`Entity360Tabs` fills the `tabBar` and `children` regions), `3.3b`
  (`EntityShow` composes all seven regions from a descriptor), and through them every
  Epic 4–11 story that renders a 360.
- `src/components/atomic-crm/entity360/` **does not exist**. This story creates it.

### Scope boundary — read before starting

Two different things are easy to confuse here, and only one of them is in scope.

**In scope.** Build the shell as a generic, presentational primitive, proven with fixture
content (no real entity, no data fetching, no router). Extract the duplicated monogram-chip
markup into `EntityAvatar` **and rewire the four header components that render it today**
— that is a like-for-like JSX extraction inside four files, not a layout change.

**Out of scope.** Migrating any entity's show page *onto* `Entity360`. Do not restructure
`singles/SingleShow.tsx`, `shadchanim/ShadchanShow.tsx`, `references/ReferenceShow.tsx` or
`shidduchim/ShidduchShowHeader.tsx` into shell regions, do not touch their routes, do not
introduce a second parallel show surface. That is Epic 5 (Stories 5.1, 5.8, 5.9, 5.10),
and Epic 1 Story 1.5 wrote the boundary down: *"Epic 3/4/5 | `Entity360`, `EntityList`,
AD-24 route shape … | Do not restructure routes."*
[Source: _bmad-output/implementation-artifacts/1-5-remove-dead-routes.md:456]

The shell itself ships with **no production consumer** — that is deliberate and matches
step 1 of the build order. `EntityAvatar` does **not** ship without a consumer: AC 5
rewires its four call sites in this story, because a tested-but-dead module is how the
duplication survives (contract §12, step 1).

### The contract this story implements

Reproduced verbatim from the Epic 3 canonical API contract §1 so this story stands alone:

```ts
// src/components/atomic-crm/entity360/Entity360.tsx
export interface Entity360Props {
  breadcrumb?: ReactNode;
  identityHeader?: ReactNode;
  statBand?: ReactNode;
  alertSlot?: ReactNode;
  tabBar?: ReactNode;
  children?: ReactNode;   // tab content
  rightRail?: ReactNode;
}
export function Entity360(props: Entity360Props): ReactElement;
```

1. Regions render in **exactly** that order, whether or not neighbours are present. No
   reorder prop, no slot-order prop, no variant prop.
2. All regions optional. An absent region renders **nothing** — no wrapper, no spacer.
3. **No `className`, no `...rest`, no `style`.** Seven named props and nothing else.
4. `breadcrumb` and `alertSlot` have no consumer in Epics 4–11 today. They are **reserved**
   (AD-24 names them): keep them, do not delete them, do not repurpose them.
5. Works at 375px, light and dark, with empty/loading/error content (UX-DR11). Root is
   `flex flex-col`; the right rail is a sibling column at `lg:` and above, stacked below
   the content beneath that.
6. `EntityAvatar` **may set `backgroundColor` inline**. The ban on inline style covers
   **layout** properties only. See AC 4.

## Acceptance Criteria

1. **`Entity360` renders seven fixed regions, in fixed DOM order, each optional.**
   `src/components/atomic-crm/entity360/Entity360.tsx` exports `Entity360` and the
   `Entity360Props` interface above — exactly seven optional props, each
   `ReactNode | undefined`, one per region. When two or more regions are populated they
   appear in the DOM in the order breadcrumb → identityHeader → statBand → alertSlot →
   tabBar → children → rightRail, **regardless of the order the props are written in JSX**.
   When a region's prop is `undefined`, nothing is emitted for it — no wrapper element, no
   spacer. When **both** `children` and `rightRail` are absent, the content/rail wrapper is
   not emitted either.
   *Falsifiable by:* a render test with all seven populated with distinct marker text,
   asserting order via `Node.compareDocumentPosition` (or
   `container.textContent.indexOf`); plus one `it` per region asserting its marker is
   absent and the shell root's child-element count drops by one when that prop is omitted.
   Reordering any two regions in the implementation, or wrapping an absent region in an
   empty `<div>`, fails it.

2. **The signature is closed.** `Entity360Props` declares no `className` (root or
   per-region), no `style`, no `order`/`layout`/`variant` prop, and `Entity360` performs no
   JSX spread of caller-supplied props onto any element. A consumer that wants different
   spacing edits `Entity360.tsx` for every entity or does not get it.
   *Falsifiable by:* two `// @ts-expect-error` cases in `Entity360.test.tsx` —
   `<Entity360 className="x" />` and `<Entity360 data-testid="x" />`. An unused
   `@ts-expect-error` is itself a tsc error, so `npm run typecheck` fails the moment either
   prop becomes accepted. The source guard in AC 4 additionally asserts `Entity360.tsx`
   contains no `{...` spread. **This AC governs `Entity360` only** — `EntityAvatar` (AC 5)
   deliberately does take a `className`.

3. **The layout is 375px-safe, and the right rail is a column only from `lg` up.**
   Asserted behaviourally in the `app` project (real Chromium), using
   `page.viewport(width, height)` from `@vitest/browser/context`:
   - at a **375 × 720** viewport, with all seven regions populated with long unbroken
     strings, the shell root satisfies `root.scrollWidth <= root.clientWidth` (no
     horizontal overflow);
   - at **375 × 720**, `rightRail.getBoundingClientRect().top >=`
     `content.getBoundingClientRect().bottom` (rail stacked below the content);
   - at **1280 × 720**, `rightRail.getBoundingClientRect().left >=`
     `content.getBoundingClientRect().right` (rail beside the content).

   Each test restores the viewport in an `afterEach` so no test depends on another's
   viewport [Source: .claude/rules/testing.md#Test-isolation].
   *Falsifiable by:* adding `min-w-[420px]` to any region wrapper (breaks the first
   assertion), or making the rail wrapper unconditionally `flex-row` (breaks the second).

4. **No hard-coded colour anywhere; no inline *layout* style; `EntityAvatar`'s inline
   `backgroundColor` is explicitly permitted.** The rule that AC 4 of the previous revision
   of this story and its AC 3 contradicted is settled here, once:

   - `Entity360.tsx` contains **no `style=` attribute at all** and no colour literal.
   - `EntityAvatar.tsx` **may** carry inline `style`, and the only CSS properties it may
     assign are `backgroundColor` and `color`, both to `var(--avatar-*)` values. Any layout
     property (`width`, `height`, `min*`, `max*`, `margin`, `padding`, `position`, `top`,
     `right`, `bottom`, `left`, `display`, `flex`, `grid`, `gap`, `inset`) inside a `style`
     object is a violation. The `--avatar-{0..9}` index is dynamic and Tailwind cannot
     express it without a safelist; all four existing chips already set it inline
     (`singles/SingleShow.tsx:58-61`, `shadchanim/ShadchanHeader.tsx:33-36`,
     `references/ReferenceShow.tsx:49-52`, `shidduchim/ShidduchShowHeader.tsx:45-48`).
   - Neither file contains a colour literal:
     `/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/`.
   - Neither file contains an arbitrary-value pixel width above 375: scan
     `/\b(?:min-w|w|basis)-\[(\d+)px\]/g` and compare the captured number numerically
     (**not** by digit count — the previous revision's regex matched three-digit values
     only, so `min-w-[1024px]` passed clean).

   *Implementation, and how it is made falsifiable:* the check is a pure predicate
   `findStyleViolations(fileName: string, source: string): string[]` declared **inside**
   `entity360/entity360Style.guard.test.ts`, modelled on `findManifestViolations`
   [Source: src/components/atomic-crm/root/routeManifest.test.ts:17-31]. It is run over
   the two real sources (expect `[]`) **and** over four deliberately broken fixture
   strings declared in the test file — a hex literal, an `oklch(` literal, a
   `min-w-[1024px]`, and an `EntityAvatar` style object assigning `minWidth` — each of
   which must produce a violation. The guard is therefore shown red and green in the same
   run, permanently (contract §13 rule 2).

   Separately and behaviourally: rendering `<EntityAvatar seed={s} />` for two seeds whose
   `getAvatarIndex` values differ produces two **different** computed
   `background-color` values, and each equals the computed `background-color` of a probe
   element styled `background-color: var(--avatar-${getAvatarIndex(seed)})`. Asserting the
   computed colour — not the absence of the string `style=` — is what makes hard-coding
   index `0` fail.

5. **`EntityAvatar` is built *and* the four duplicated header chips are rewired onto it.**
   `src/components/atomic-crm/entity360/EntityAvatar.tsx` exports
   `EntityAvatar({ seed, monogramSource, className }: { seed?: string | null; monogramSource?: string | null; className?: string })`.
   `monogramSource` feeds `getMonogram`, `seed` feeds `getAvatarIndex` — two separate
   inputs, because every call site today passes the name as the monogram source and
   `name ?? String(id)` as the palette seed, and one prop cannot serve both.

   - Base classes owned by the component: `grid shrink-0 place-items-center font-bold`.
     They carry **no size, no radius and no text size**, so the caller's `className` is
     appended without a `tailwind-merge` conflict (`size-14` vs `h-14 w-14` is exactly the
     case that would otherwise be ambiguous). When `className` is `undefined` the component
     falls back to `"h-14 w-14 rounded-2xl text-lg"` — a fallback, not a merge.
   - The chip always renders `aria-hidden="true"`. **This is a decision, not a copy:**
     three of the four chips set it (`singles/SingleShow.tsx:62`,
     `references/ReferenceShow.tsx:53`, `shidduchim/ShidduchShowHeader.tsx:49`) and
     `shadchanim/ShadchanHeader.tsx:31-39` does not. The monogram is decorative in all four
     — the name renders as an adjacent heading in every case (e.g.
     `ShadchanHeader.tsx:41-43`) — so the shadchan chip gains `aria-hidden` and the
     inconsistency ends.
   - The four rewires, with the exact `className` each must keep so the rendered chip is
     visually unchanged:

     | File | Chip today | `className` passed |
     |---|---|---|
     | `singles/SingleShow.tsx` (`SingleProfileHeader`, `:42`) | `:56-65` | `h-14 w-14 rounded-2xl text-xl` |
     | `shadchanim/ShadchanHeader.tsx` (`:20`) | `:31-39` | `h-14 w-14 rounded-2xl text-lg` |
     | `references/ReferenceShow.tsx` (`ReferenceHeader`, `:31`) | `:47-56` | `h-12 w-12 rounded-xl text-base` |
     | `shidduchim/ShidduchShowHeader.tsx` | `:43-52` | `size-14 rounded-2xl text-lg` |

   *Falsifiable by:* a component test per variant asserting the rendered chip carries its
   size/radius/text classes and `aria-hidden="true"`; plus `LSP findReferences` on
   `getMonogram` returning **no** reference inside those four files afterwards. Shipping
   `EntityAvatar` without the rewires fails this AC.

   **Not in scope, and named so nobody guesses:** the four *card* chips
   (`singles/SingleCard.tsx:47-48`, `shadchanim/ShadchanCard.tsx:27-28`,
   `references/ReferenceList.tsx:58-59`, `shidduchim/ShidduchCard.tsx:81-82`) keep their
   inline chips in this story. They are list-row surfaces and are re-rendered by Epic 4's
   `EntityList` `renderItems` retrofit; rewiring them here would collide with that diff.
   They still switch their **import path** under AC 6.

6. **`getMonogram` / `getAvatarIndex` move to `entity360/avatar.ts`.** They are
   cross-entity utilities living in a shidduchim-specific file by historical accident:
   9 files import them beyond `boardUtils.ts` itself, **six of them outside `shidduchim/`**
   — `singles/SingleCard.tsx:6`, `singles/SingleShow.tsx:9`,
   `references/ReferenceList.tsx:10`, `references/ReferenceShow.tsx:6`,
   `shadchanim/ShadchanCard.tsx:6`, `shadchanim/ShadchanHeader.tsx:5`,
   `shidduchim/ShidduchShowHeader.tsx:7`, `shidduchim/ShidduchCard.tsx:12`, plus
   `shidduchim/boardUtils.test.ts:4-5`. **This census is verified against `main`; do not
   "correct" it.**

   Move both functions verbatim (no behaviour change) from
   `shidduchim/boardUtils.ts:35-51` to `src/components/atomic-crm/entity360/avatar.ts`.
   Every surviving importer switches to `"../entity360/avatar"` (or `"./avatar"` inside
   `entity360/`). Note that `shidduchim/ShidduchCard.tsx:12` and
   `shidduchim/ShidduchShowHeader.tsx:7` also import `formatRedtDate` from the same line,
   so those two keep a `./boardUtils` import alongside the new one — except that
   `ShidduchShowHeader.tsx`, rewired under AC 5, no longer needs the two avatar functions
   at all and keeps only `formatRedtDate`.

   The `describe("getMonogram")` (`boardUtils.test.ts:67-80`) and
   `describe("getAvatarIndex")` (`:82-96`) blocks move unchanged into a new
   `entity360/avatar.test.ts`; `describe("getShidduchimByState")` and
   `describe("formatRedtDate")` stay in `boardUtils.test.ts`.
   *Falsifiable by:* `LSP documentSymbol` on `shidduchim/boardUtils.ts` returning exactly
   `ShidduchimByState`, `getShidduchimByState` and `formatRedtDate`; plus `npm run typecheck`
   and `npm run test:unit:app` green.

7. **The shell composes; it owns no primitives of its own.** `Entity360.tsx` imports
   **only** from `react` (types) and `@/lib/utils` — no import from `@/components/ui/*`, no
   import from any sibling directory of `entity360/`, no `Card`, no bespoke stat tile, no
   bespoke banner. `statBand` and `alertSlot` are plain `ReactNode`: the shell neither
   fetches nor formats stats (the descriptor module owns that — contract §2 rule 1), and
   neither renders a banner. JSDoc on the two props names the primitive each must be
   composed from: `src/components/atomic-crm/dashboard/DashboardStat.tsx` for stat tiles
   and `src/components/ui/alert.tsx` (`Alert` / `AlertTitle` / `AlertDescription`) for
   banners.
   *Falsifiable by:* the AC 4 guard predicate, extended with an import allowlist for
   `Entity360.tsx` and a fixture importing `@/components/ui/card` that must be reported as
   a violation; plus an assertion that the `statBand` and `alertSlot` JSDoc blocks name
   `DashboardStat` and `Alert` respectively.

## Tasks / Subtasks

- [x] **Task 1 — Move the avatar utilities** (AC: 6)
  - [x] Create `src/components/atomic-crm/entity360/avatar.ts`; move `getMonogram`
        (`shidduchim/boardUtils.ts:35-42`) and `getAvatarIndex` (`:44-51`) verbatim,
        JSDoc included. `boardUtils.ts` keeps `ShidduchimByState`,
        `getShidduchimByState` and `formatRedtDate`.
  - [x] Run `LSP findReferences` on both symbols **before** editing to confirm the
        importer set matches AC 6 [Source: .claude/rules/lsp-usage.md] — do not re-derive
        it with `grep`. *(The `LSP` tool was not available/loaded in this session; the
        9-file importer census was verified with a targeted `grep -rn` restricted to the
        two symbol names, matching the census this story and §7 "Not problems" both
        already pin. See report for this deviation.)*
  - [x] Repoint every importer at `"../entity360/avatar"`. Keep `formatRedtDate` on
        `"./boardUtils"` in `shidduchim/ShidduchCard.tsx`.
  - [x] Create `entity360/avatar.test.ts` with the two moved `describe` blocks, assertions
        unchanged; delete them from `shidduchim/boardUtils.test.ts`.

- [x] **Task 2 — Build `EntityAvatar` and rewire its four call sites** (AC: 4, 5)
  - [x] Create `entity360/EntityAvatar.tsx` per AC 5: base classes
        `grid shrink-0 place-items-center font-bold`, `className` appended (fallback
        `"h-14 w-14 rounded-2xl text-lg"` when absent), inline
        `{ backgroundColor: \`var(--avatar-${getAvatarIndex(seed)})\`, color: "var(--avatar-ink)" }`,
        `getMonogram(monogramSource)` as the child, `aria-hidden="true"` always.
  - [x] Replace the chip `<div>` in `singles/SingleShow.tsx:56-65`,
        `shadchanim/ShadchanHeader.tsx:31-39`, `references/ReferenceShow.tsx:47-56` and
        `shidduchim/ShidduchShowHeader.tsx:43-52` with `<EntityAvatar>`, passing the
        `monogramSource` / `seed` pair each file already computes and the `className` from
        AC 5's table. Delete the now-unused local `monogram` / `avatarIndex` consts and
        their imports (`noUnusedLocals` is on — `tsconfig.app.json:21`).
  - [x] Do **not** touch the four card chips named in AC 5, beyond Task 1's import move.

- [x] **Task 3 — Build the `Entity360` shell** (AC: 1, 2, 3, 7)
  - [x] Create `entity360/Entity360.tsx`: the seven props from AC 1, each rendered inside
        its own fixed wrapper in the pinned order; no prop controls order or styling.
  - [x] Root is `flex flex-col gap-*`. `children` and `rightRail` share one wrapper that is
        `flex flex-col gap-*` up to `lg` and `lg:flex-row lg:items-start` above it, with
        the content column `min-w-0 flex-1` and the rail `lg:w-80 lg:shrink-0`. DOM order
        stays content → rail. The wrapper is not emitted when both are absent (AC 1).
  - [x] JSDoc on `statBand` and `alertSlot` naming `DashboardStat` and `Alert` (AC 7).
        Imports limited to `react` and `@/lib/utils` (AC 7).

- [x] **Task 4 — Tests** (AC: 1, 2, 3, 4, 5, 7)
  - [x] `entity360/Entity360.test.tsx`, AAA-structured: region order with all seven
        populated and with the props written in scrambled JSX order; one `it` per
        "region absent emits nothing"; the `children`+`rightRail`-both-absent case; the two
        `// @ts-expect-error` cases from AC 2. *(The second fixture was substituted —
        `variant="x"` instead of the contract's literal `data-testid="x"` — because
        TypeScript's JSX checker never flags hyphenated attribute names on any element;
        see report.)*
  - [x] `entity360/Entity360.responsive.test.tsx` (or the same file): the three
        `page.viewport()` assertions from AC 3, with an `afterEach` restoring the viewport.
        *(Required adding `@tailwindcss/vite` to the "app" vitest project and importing
        `@/index.css` in this file — real computed layout is meaningless without the
        real stylesheet; see report.)*
  - [x] `entity360/EntityAvatar.test.tsx`: the four `className` variants render their
        classes and `aria-hidden`; the computed-`background-color` assertions from AC 4.
        *(Same `@/index.css` import needed for the `--avatar-{n}` assertions.)*
  - [x] `entity360/entity360Style.guard.test.ts`: `findStyleViolations` run over the two
        real sources **and** over the four broken fixtures, per AC 4, plus AC 7's import
        allowlist and its `@/components/ui/card` fixture.
  - [x] `entity360/avatar.test.ts` — the two moved `describe` blocks.
  - [x] Validation before hand-off: `npm run typecheck`, `npm run test:unit:app`,
        `npm run lint`, `npm run build`. **No DB surface in this story** — no migration, no
        RLS, no `npm run test:unit:db`.

## Dev Notes

### What this story is (and is not)

AD-24: *"every entity renders through one `Entity360` shell with fixed regions in fixed
order (breadcrumb → identity header → stat band → alert slot → tab bar → content →
optional right rail); regions are optional per entity but never reordered or restyled."*
[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:177-180]

**Cite the full path.** Two files in this repo are named `ARCHITECTURE-SPINE.md`;
`mockup/uploads/ARCHITECTURE-SPINE.md` contains no AD-22/AD-23/AD-24 at all and is not a
source for anything.

This story delivers exactly that sentence as a component, proven with fixture content. It
does **not** decide what goes in the tab bar (3.2), does not fetch or declare per-entity
data (3.3a/3.3b), and does not gate by viewer role (3.4). Those are named, separate
stories precisely so this one stays a small, reusable layout primitive.

### Vocabulary (AD-23)

*shidduch/shidduchim*, *redt*, *shadchan/shadchanim*, *reference*, and **single** — never
"child" and never "candidate", in code, comments, tests or UI strings.
[Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:172-176]
`scripts/check-retired-names.mjs` fails CI on the retired names.

### Theme tokens already in use (reuse, do not invent new ones)

Every show page in the repo themes exclusively through CSS custom properties consumed via
Tailwind semantic classes — `bg-card`, `text-muted-foreground`, `border-border`,
`--avatar-{0..9}` / `--avatar-ink`, `--positive`, `--glass-bg` / `--glass-border` — all
defined for both schemes in `src/index.css` (light `:196-206`, `:248`; dark `:376-386`,
`:411`). See `singles/SingleShow.tsx`, `shadchanim/ShadchanShow.tsx` and
`references/ReferenceShow.tsx` for the pattern. Dark mode is therefore automatic wherever
`Entity360` sticks to the same tokens; it needs no `dark:` variants of its own, matching
how the rest of the app themes. This is why AC 4's colour-literal ban is a real constraint
and not a style preference: a hex value is the one thing that would not follow the theme.

### Why the avatar move, and why the four headers *are* rewired here

Nine files import `getMonogram`/`getAvatarIndex` from `shidduchim/boardUtils.ts` — a
shidduchim-specific file hosting a cross-entity primitive by historical accident.
`.claude/rules/coding-style.md` ("organize by feature/domain") and DRY both point at
relocating it into the shell's own home now that `entity360/` exists.

The four *header* chips are rewired in the same story, against the earlier revision of this
story, which deferred them to Epic 5. The reason for the reversal: the deferral shipped a
module with **zero consumers**, and a primitive nobody renders is a primitive nobody
notices is wrong. Rewiring is four `<div>` → `<EntityAvatar>` substitutions inside header
components whose surrounding layout is untouched — it does not migrate any page onto
`Entity360`, does not change a route, and does not create a second show surface. Each
rewire is covered by a per-variant render test (AC 5), which is the regression protection
the deferral was trying to buy.

The four *card* chips are a different case and stay put: Epic 4 Story 4.1 re-renders list
rows through `EntityList`'s injected `renderItems`, so touching them now guarantees a
collision. AC 5 names them explicitly so this is a decision on the record rather than an
oversight.

### The AC 3 / AC 4 contradiction in the previous revision, and how it is resolved

The previous revision banned inline `style` background in `Entity360.tsx` **and**
`EntityAvatar.tsx` while simultaneously requiring the `--avatar-{n}` background "exactly as
today" — and every one of the four chips sets it inline. Tailwind cannot express a dynamic
`--avatar-{0..9}` without an arbitrary-value class or a safelist. The ban is therefore
scoped to **layout** properties, `backgroundColor`/`color` are carved out for
`EntityAvatar` only, and the behavioural assertion is on the **computed** colour rather
than on the absence of the string `style=`. See AC 4.

Its regex was also unfalsifiable: `/min-w-\[(3[89][0-9]|[4-9][0-9]{2})px\]|#[0-9a-fA-F]{3,6}\b/`
matched three-digit pixel values only (so `min-w-[1024px]` passed), had no `rgb(`/`oklch(`
branch despite the prose banning them, and covered no inline-style case — and with a
`flex flex-col` root it was true before a line was written. AC 3 now asserts the overflow
behaviour it always claimed to, in a real browser at a real 375px viewport; AC 4 compares
captured pixel values numerically and proves itself red against fixtures.

### Testing standard

AAA, descriptive `it` names, no shared mutable state between tests, ≥80% coverage on new
code [Source: .claude/rules/testing.md]. Tests run in the `app` vitest project
(`npm run test:unit:app`), which executes in a **real headless Chromium** via
`@vitest/browser-playwright` [Source: vitest.config.ts:36-49], so tests cannot shell out or
touch `node:fs`.

- **React Testing Library is not a dependency.** There is no `screen.queryByText` and no
  `MemoryRouter` in this repo. Use `render` from `vitest-browser-react`; the negative idiom
  is `await expect.element(screen.getByRole(...)).not.toBeInTheDocument()`
  [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-3].
- `render()` returns `container`, so `container.textContent` assertions survive.
- `Entity360` and `EntityAvatar` are context-free — no router, no data provider, no
  `CoreAdminContext` wrapper is needed. If a later test ever needs one, the repo pattern is
  `TestMemoryRouter` from `ra-core` [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:3,69-71],
  never `MemoryRouter` from `react-router`.
- Viewport control: `import { page } from "@vitest/browser/context"` then
  `await page.viewport(375, 720)` [Source: node_modules/@vitest/browser/context.d.ts:814-816].
- **`?raw` source scanning.** A bare `import source from "./Entity360.tsx?raw"` typechecks:
  Vite's `declare module '*?raw'` (`node_modules/vite/client.d.ts:243`) is in scope via
  `/// <reference types="vite/client" />` in `src/vite-env.d.ts:1`, and `src` is in
  `tsconfig.app.json`'s `include`. The alternative, if a whole directory must be scanned,
  is the repo's existing `import.meta.glob("…", { query: "?raw", import: "default", eager: true })`
  precedent [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20].
  Either is acceptable; AC 4 only cares that the predicate is pure, exported inside the test
  file, and exercised against broken fixtures.
- The `// @ts-expect-error` cases in AC 2 are enforced by **`npm run typecheck`**
  (`package.json:17`), not by the test runner — an unused `@ts-expect-error` is itself a tsc
  error, and `tsconfig.app.json`'s `include: ["src","demo","vitest-browser.d.ts"]` covers
  `.test.tsx` files under `src/`.
- The validation set is `npm run typecheck`, `npm run test:unit:app`, `npm run lint`,
  `npm run build` (equivalently `make typecheck`, `make test`, `make lint`, `make build` — the
  repo's lowercase `makefile` resolves these).

### Project Structure Notes

- New directory `src/components/atomic-crm/entity360/` is this epic's home; every
  subsequent Epic 3 story adds files here (`entity360/tabs/` for 3.5–3.8,
  `entity360/RecordLink.tsx` for 3.9, `entity360/tabKeys.ts` for 3-13, etc.). Do not
  scatter shell code into an entity folder.
- File sizes stay well inside the 200–400 line typical ceiling
  [Source: .claude/rules/coding-style.md#File-organization] — `Entity360.tsx` is a pure
  layout component with no data fetching and should land under 150 lines.
- Immutability, KISS, explicit error handling and the naming conventions in
  `.claude/rules/coding-style.md` apply.
- English-only in all new files and comments [Source: .claude/rules/english-only.md].

### References

- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:177-180] — AD-24, the shell contract this story implements
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md:172-176] — AD-23, the vocabulary
- [Source: _bmad-output/planning-artifacts/epics.md:452-469] — Epic 3 preamble and Story 3.1's epic-level acceptance criteria
- [Source: _bmad-output/planning-artifacts/prds/prd-myshadchan-2026-07-21/amendment-a2.md:157-161] — UX-DR1, the region list; [:186-187] — UX-DR11, empty/loading/error, light+dark, 375px. (Indexed at `_bmad-output/planning-artifacts/epics.md:109,119`.) **The mockup is not a source:** `mockup/MyShadchan.dc.html` predates AD-24 and is internally inconsistent.
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md:50] — CAP-7, "One consistent 360° view of every entity"
- [Source: _bmad-output/implementation-artifacts/1-5-remove-dead-routes.md:442,456] — Dev Notes §4, "Epic 3/4/5 … `Entity360` … Do not restructure routes", the scope boundary this story respects
- [Source: _bmad-output/implementation-artifacts/1-5-remove-dead-routes.md:126] — the fixture-declared-inside-the-test-file pattern this story's guard test follows
- [Source: src/components/atomic-crm/shidduchim/boardUtils.ts:35-51] — `getMonogram` / `getAvatarIndex`, moved by this story
- [Source: src/components/atomic-crm/shidduchim/boardUtils.test.ts:67-96] — the two `describe` blocks that move to `entity360/avatar.test.ts`
- [Source: src/components/atomic-crm/singles/SingleShow.tsx:42,56-65] — `SingleProfileHeader` and its chip
- [Source: src/components/atomic-crm/shadchanim/ShadchanHeader.tsx:20,31-39] — the one chip with no `aria-hidden`
- [Source: src/components/atomic-crm/references/ReferenceShow.tsx:31,47-56] — `ReferenceHeader` and its chip
- [Source: src/components/atomic-crm/shidduchim/ShidduchShowHeader.tsx:43-52] — the `size-14` chip
- [Source: src/components/atomic-crm/dashboard/DashboardStat.tsx:7-12] — `DashboardStatProps`, the stat tile every stat band composes from
- [Source: src/components/ui/alert.tsx:66] — `Alert` / `AlertTitle` / `AlertDescription`, the banner primitives the alert slot composes from
- [Source: src/components/atomic-crm/root/routeManifest.test.ts:17-31] — `findManifestViolations`, the pure-predicate-plus-fixture guard pattern AC 4 copies
- [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:16-20] — the repo's `?raw` scanning precedent
- [Source: src/components/atomic-crm/layout/ContextSwitcher.test.tsx:1-3,69-71] — `vitest-browser-react` + `TestMemoryRouter`; the negative-assertion idiom
- [Source: src/index.css:196-206,248,376-386,411] — the `--avatar-*`, `--glass-*` and `--positive` tokens in both schemes
- [Source: vitest.config.ts:36-49] — the `app` project's Chromium browser mode
- [Source: package.json:7,17,20] — `test:unit:app`, `typecheck`, `lint`
- [Source: .claude/rules/coding-style.md, .claude/rules/testing.md, .claude/rules/lsp-usage.md, .claude/rules/english-only.md, .claude/rules/typescript.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (claude-sonnet-5 harness, bmad-dev-story workflow)

### Debug Log References

- `make typecheck` — green.
- `make lint` (eslint + repo prettier check) — green.
- `npx vitest run` (all 5 projects) — 912/912 passed.
- `make build` — green.
- `npx prettier --check .` — 15 pre-existing unrelated warnings (docs/workflow files),
  confirmed identical on `main` before this story; no file this story touched is flagged.
- `node scripts/check-retired-names.mjs` — clean (required renaming several test
  identifiers that coincidentally spelled "CHILD"/"Children" — see Completion Notes).
- `node scripts/check-suppressions.mjs` — fails on `main` at baseline (3 pre-existing
  `@ts-expect-error`-style comments in `entity360/tabKeys.test.ts` already exceed the
  `src/components/atomic-crm` budget of 0); this story's two AC-2-mandated directives
  bring it to 5. Not in this story's DoD list; not fixed (see report).

### Completion Notes List

- AC1–AC7 implemented per contract §1. The AC3/AC4 inline-`backgroundColor` contradiction
  was resolved per contract §1 rule 6 before writing code: `Entity360.tsx` carries no
  `style=` at all; `EntityAvatar.tsx` alone may set `backgroundColor`/`color` inline to
  `var(--avatar-*)` values, enforced by a red/green guard predicate
  (`entity360Style.guard.test.ts`).
- `getMonogram`/`getAvatarIndex` moved verbatim to `entity360/avatar.ts`; all 9 importers
  beyond `boardUtils.ts` repointed (4 header rewires onto `EntityAvatar`, 4 card chips kept
  inline but repointed, plus the moved test file) — census re-verified by grep and matches
  the story/§7 "Not problems" census exactly.
- `EntityAvatar` built and its four header call sites rewired in this story (not deferred),
  per the contract's explicit reversal of the earlier no-consumer revision. The one
  behavioural gap the earlier revision had (`ShadchanHeader`'s chip missing
  `aria-hidden="true"`) is closed by construction — `EntityAvatar` always sets it.
- `Entity360` composes 7 optional regions via a `Region` wrapper (`min-w-0 break-words`)
  used for the 5 singleton regions, and a similarly-guarded content/rail row for
  `children`/`rightRail`. The `min-w-0`/`break-words` pairing is load-bearing, not
  decorative: without it, AC 3's 375px-with-long-unbroken-strings test genuinely
  overflows (verified red before adding it).
- **Infrastructure change required for AC 3/AC 4 to be real tests, not tautologies**:
  the "app" vitest project only had the `react()` Vite plugin, no Tailwind processing and
  no global stylesheet import anywhere in the test suite (confirmed: zero prior
  `getComputedStyle`/`page.viewport(` usage in the repo). Without real CSS, every
  Tailwind utility class is inert and CSS custom properties are undefined, so the
  layout/colour assertions this story's own AC 3/AC 4 demand cannot mean anything — they
  were observed to fail with the *wrong* real-world layout (no flexbox, transparent
  backgrounds) before the fix. Added `@tailwindcss/vite` to the "app" project's plugins
  (mirrors `vite.config.ts`) and `import "@/index.css"` in the two test files that need
  real computed style. This only costs anything for files that import the stylesheet;
  the other 56 pre-existing "app" test files are unaffected (confirmed: full suite still
  912/912 green).
- `scripts/check-retired-names.mjs` flagged several of my own test identifiers —
  `firstElementChild`/`lastElementChild` (DOM APIs, not in the guard's `firstChild`/
  `lastChild` exempt list — a narrow pre-existing gap I worked around rather than
  patched, by using `.children[0]` / `.children[len-1]` instead) and a few
  all-caps/underscored names of mine that happened to spell "CHILD" (`CHILDREN_MARKER`,
  `FULL_ROOT_CHILD_COUNT`, a destructured `_children` binding) — renamed to
  `CONTENT_MARKER`, `ALL_REGIONS_ROOT_COUNT`, `_content`. No production code was
  affected; the guard is clean at the end.

### File List

**Created:**
- `src/components/atomic-crm/entity360/avatar.ts`
- `src/components/atomic-crm/entity360/avatar.test.ts`
- `src/components/atomic-crm/entity360/EntityAvatar.tsx`
- `src/components/atomic-crm/entity360/EntityAvatar.test.tsx`
- `src/components/atomic-crm/entity360/Entity360.tsx`
- `src/components/atomic-crm/entity360/Entity360.test.tsx`
- `src/components/atomic-crm/entity360/Entity360.responsive.test.tsx`
- `src/components/atomic-crm/entity360/entity360Style.guard.test.ts`

**Modified:**
- `src/components/atomic-crm/shidduchim/boardUtils.ts` (removed `getMonogram`/`getAvatarIndex`)
- `src/components/atomic-crm/shidduchim/boardUtils.test.ts` (removed their `describe` blocks)
- `src/components/atomic-crm/singles/SingleShow.tsx` (rewired onto `EntityAvatar`)
- `src/components/atomic-crm/singles/SingleCard.tsx` (import path only)
- `src/components/atomic-crm/shadchanim/ShadchanHeader.tsx` (rewired onto `EntityAvatar`)
- `src/components/atomic-crm/shadchanim/ShadchanCard.tsx` (import path only)
- `src/components/atomic-crm/references/ReferenceShow.tsx` (rewired onto `EntityAvatar`)
- `src/components/atomic-crm/references/ReferenceList.tsx` (import path only)
- `src/components/atomic-crm/shidduchim/ShidduchShowHeader.tsx` (rewired onto `EntityAvatar`)
- `src/components/atomic-crm/shidduchim/ShidduchCard.tsx` (import path only)
- `vitest.config.ts` (added `@tailwindcss/vite` to the "app" project's plugins)
- `registry.json` (regenerated via `make registry-gen`, picks up the 3 new source files)

### Change Log

- 2026-07-28: Story implemented — `Entity360` shell + `EntityAvatar` built, four header
  chips rewired, avatar utilities relocated to `entity360/avatar.ts`. All gates green.
