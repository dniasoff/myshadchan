# Atomic CRM → Calm Ledger — File-by-File Remediation Plan

**Scope:** turn the real MyShadchan (Atomic CRM fork) app into Calm-Ledger quality.
**Status:** AUDIT/DESIGN — nothing under `src/` is edited here. Implementation runs
through the project's agent harness (orchestrator → planner/developer/reviewer/merger)
after sign-off. All findings below are grounded in the five audits and verified against
the live files (`src/index.css`, the flagged feature folders).

**One-sentence verdict:** *Lift the tokens and the information architecture from the
canvas; discard 100% of its execution.* The real React app is already
token-clean and Lucide-based — the "sloppy html / hardcoded / huge whitespace"
complaint is overwhelmingly a property of the throwaway canvas
(`design-artifacts/MyShadchan.dc.html`: 970 inline styles, 2,227 hardcoded px, 1 CSS
class), **not** of the shipped source. A single theme swap does ~90% of the visual
work for free; the remainder is a short, named list of small edits plus one genuine
desktop layout bug and the Deals domain rewrite.

---

## 1. The ONE foundational change — swap the theme in `src/index.css`

**File:** `src/index.css` · **Reference:** `design-artifacts/calm-ledger-theme.css`
(ready-to-apply, produced alongside this plan).

**What to do (three edits, all same-var-name → true drop-in):**
- **A.** Extend the existing `@theme inline { }` block (`index.css:7-44`) with the
  **new token families**: `--color-attention`, `--color-attention-strong`,
  `--color-attention-foreground`, `--color-positive`, `--color-destructive-foreground`
  (fills a pre-existing gap), `--shadow-sm/-md/-lg`, and `--color-st-new … --color-st-no`.
  These do **not** exist today and are **not** mapped — editing `:root`/`.dark` alone
  will not expose them to Tailwind utilities (`bg-attention`, `text-positive`,
  `shadow-md`, `bg-st-yes`). This `@theme` edit is mandatory for those utilities.
- **B.** Replace the raw values in `:root { }` (`index.css:47-88`) with the light block.
- **C.** Replace the raw values in `.dark { }` (`index.css:92-132`) with the dark block.

**Three canvas defects already fixed in the reference file (do not re-copy the raw
canvas):** (1) the self-referential `--avatar-blue:var(--avatar-blue)` tokens are
dropped — we **keep the app's existing numeric `--avatar-0..9`** so no avatar consumer
changes; (2) the `--paper-*` skeuomorphic hex tokens are dropped (canvas-only, unused
in real code); (3) tokens the canvas omitted but the app needs are re-added:
`--popover(-foreground)`, `--chart-1..5`, the full `--sidebar-*` family,
`--destructive-foreground`.

**What this ONE change fixes app-wide for FREE** (because every real component already
consumes semantic tokens through the `@theme` → utility indirection):
- **Colors:** achromatic Atomic grey → warm-paper background (hue 95) with an indigo
  `--primary` (hue 268), amber `--attention*`, green `--positive`. Every `bg-card`,
  `text-muted-foreground`, `bg-primary`, `border`, `bg-secondary` consumer re-skins with
  zero component edits — shell, cards, buttons, badges, forms, list rows, Settings,
  Contacts, Deals shell.
- **Dark mode:** the app currently has an achromatic-grey dark palette; the reference
  supplies a genuinely designed indigo-on-slate `.dark` set (brightened primary
  `oklch(0.64 0.19 266)`). The class-based toggle (`admin/theme-provider.tsx`) already
  works — no JS/config change.
- **Elevation:** introduces the missing 3-tier `--shadow-sm/-md/-lg` scale. Today only 3
  files use raw Tailwind shadows; once the tokens back the `shadow-*` utilities, existing
  `shadow-sm`/`shadow-md`/`shadow-lg` usages (`DealCard.tsx:53-54`) resolve to the calm,
  theme-aware, low-elevation values automatically.

**Risk:** LOW. Pure CSS token edit, no markup, no logic. This is the whole of Phase 1.

---

## 2. Per-area work BEYOND the theme swap

### 2a. Shadchan / Contacts (`src/components/atomic-crm/contacts/`, `misc/`)
Already token-clean and Lucide-based; needs the theme swap **plus 5 small hardcoded-color
fixes** (priority order):
1. **`misc/Status.tsx:23`** — tooltip hardcodes `text-white bg-gray-800`; replace with
   `bg-popover text-popover-foreground` (or `bg-foreground text-background`). Highest
   impact: this status dot/tooltip is shared across Contacts **and** Deals/Notes.
2. **`contacts/ContactListFilter.tsx:117` and `:238`** — tag `Badge` hardcodes
   `text-black`; drop it and let the `secondary` variant supply theme-aware foreground so
   tag chips work in dark mode. (The adjacent `style={{ backgroundColor: record?.color }}`
   is legitimate runtime tag data — leave it.)
3. **`contacts/Avatar.tsx:25-29`** — arbitrary px (`w-[20px] h-[20px]`, `w-[25px] h-[25px]`,
   `text-[10px]`) → token scale (`size-5`, `size-6`, `size-10`, `text-xs`).
4. **`contacts/ContactAside.tsx:25`** — `w-92 min-w-92` (not a Tailwind step) → `w-80`/`w-96`.
5. **`contacts/ContactAside.tsx:78`** *(optional)* — clean up the fragile
   `!`-important DeleteButton override stack.

Everything else (list density `pl-2 pr-4 py-2` + `md:divide-y`, `<Card>` usage, forms,
Lucide icons) already meets the bar. **No whitespace problem here.**

### 2b. Settings (`src/components/atomic-crm/settings/`)
Token-disciplined and emoji-free — **but the theme swap alone is NOT enough**: there is
one **real desktop whitespace/layout bug** (see §3) plus one hardcoded-color pair.
- **Layout fix 1 (dead right-hand space)** — `SettingsPage.tsx:248`: the root
  `<div className="flex gap-8 mt-4 pb-20">` has **no `max-width` and no `mx-auto`**, so
  the `w-48` rail + `max-w-2xl` column float flush-left and leave 500–1000px empty on wide
  screens. Wrap in a centered, capped shell (e.g. `mx-auto max-w-screen-xl px-4`).
- **Layout fix 2 (misaligned sticky bar)** — `SettingsPage.tsx:468-471`: the fixed
  Save/Reset footer uses `max-w-screen-xl mx-auto` (centered) while the form above is not
  centered, so buttons sit under a different x-position than the fields. Unify both layers
  on one `max-w` + `mx-auto` + same `w-48` rail + `max-w-2xl` column structure.
- **Token fix** — `SettingsPage.tsx:291` (`#f5f5f5`) and `:303` (`#1a1a1a`): the two
  hardcoded logo-tile hexes flow into `misc/ImageEditorField.tsx:48`'s inline
  `style={{ backgroundColor }}`. Pass a token-backed class (e.g. `--muted`/`--card`)
  instead of raw hex so previews follow Calm Ledger in both themes.
- `ProfilePage.tsx` and `SettingsPageMobile.tsx` are fine (Profile self-centers
  `max-w-lg mx-auto`; mobile is width-constrained). No canvas Settings layout exists to
  port from — the real IA (Branding/Companies/Deals/Notes/Tasks + sticky rail) is sound.

### 2c. Board / Deals (`src/components/atomic-crm/deals/`) — the deepest work
The Kanban is already token-clean, so the theme swap reskins the shell for free, **but
per-state color does not exist in the data model and the card must be rewritten** for the
matchmaking domain. This is the one area that is a substantive component/domain change,
not a reskin — and it touches the DB (route the schema piece through the harness's
`backend-dev` / `writing-migrations` skill).
1. **`root/defaultConfiguration.ts:24-31`** — replace `defaultDealStages` (6 sales
   stages) with the 7 states **New · Look-into · Not-sure · For-sure-not · Yes · Unsure ·
   No**; add a `color` per stage bound to the `--st-*` tokens; update
   `dealPipelineStatuses` (`:33`) to the terminal decision states.
2. **`types.ts:213-218`** — extend `DealStage`/`LabeledValue` with `color?: string`; add
   the domain fields the card renders (Hebrew name, shadchan reference, "suggested-before"
   catch flag, redt date) — these need DB columns (migration).
3. **`deals/DealColumn.tsx:19-32`** — render the per-state color (header dot + bottom
   border) from stage config; **remove** the `totalAmount` currency sum (`:15,23-31`) —
   MyShadchan has no deal value.
4. **`deals/DealCard.tsx:57-94`** — rewrite per spec (`mockup-generation-prompt.md:385-387`):
   single's name EN + HE (two lines, Hebrew in Heebo), soft pastel **person** monogram
   (reuse `contacts/Avatar` + `--avatar-*`) instead of `CompanyAvatar`, an always-shown
   **shadchan provenance chip** (dot), a conditional honey **"Suggested before" catch chip**
   (`bg-attention`), and a `redt` timestamp; **remove** amount/currency/category.
5. **`deals/DealInputs.tsx:99`** — change stage `defaultValue` from `"opportunity"` to
   `"new"`; add identity/bilingual fields; drop company/amount/category.
6. **`deals/DealShow.tsx`** — remove amount/category/currency blocks (`:107-132`); replace
   the hardcoded `bg-orange-500` archived banner (`:192`) with `bg-attention`; add EN+HE
   header, shadchan provenance, catch flags, references.
7. **i18n** — relabel all `resources.deals.*` keys (stage labels, "Add suggestion").
- **Not changing:** the DnD engine, `stages.ts` `getDealsByStage` bucketing/sort, and the
  index-reorder persistence (`DealListContent.tsx:88-245`) — all stage-count-agnostic.

### 2d. Layout + Dashboard (`src/components/atomic-crm/layout/`, `dashboard/`)
Strong token discipline, Lucide throughout, shadow-light — theme swap reskins for free.
Two concrete non-theme cleanups:
- **`layout/MobileNavigation.tsx:45-53`** — malformed inline `style` height math
  (`"calc(var(--spacing)) * 6"` — misplaced parens, mixed raw `15`px iOS inset). Rewrite
  as a valid token-based height; also normalize `text-[0.6rem]` (`:106`) and the
  `h-16 w-16 -mt-3` FAB (`:139`). This is the shell's one genuinely non-token spot.
- **`dashboard/DealsChart.tsx:106,184,193,196`** — hardcoded Nivo hex
  (`#61cdbb,#97e3d5,#e25c3b,#2ebca6,#f47560`) that won't follow a retheme → map to the
  existing `--chart-1..5` OKLCH tokens (axis text at `:133` already uses
  `var(--color-muted-foreground)` correctly).
- Shared `ui/` primitives (`card.tsx`, `button.tsx`, `badge.tsx`) are fully token-driven
  and need **no** change. The `--sidebar-*` tokens / framework sidebar are dead surface
  for this top-bar shell — keep the tokens defined (framework references them) but no work.

---

## 3. The "huge white space / sloppy HTML / hardcoded" complaint — where it actually lives

**It lives almost entirely in the CANVAS (throwaway), not in real files.** The canvas
`MyShadchan.dc.html` has 970 inline `style=` attrs, 2,227 hardcoded px, 141 raw inline
`oklch()` literals, 18 hex, 32 ad-hoc box-shadows, exactly **1** CSS class, and **1**
`.dark` selector (tokens only) — and its "whitespace" is 30 distinct magic-number
`max-width` containers (1180/1140/900/840px…) each floating a narrow column in a lake of
empty space. **All of that is discarded** — it is not shipped code.

**One real file genuinely has the complaint:** the desktop **Settings** page
(`SettingsPage.tsx:248` + `:468-471`, detailed in §2b) — an uncentered/uncapped outer
container leaves a real 500–1000px dead zone on wide screens, and the sticky save bar is
centered on a different rule than the form. That is a true layout bug, fixed by two edits.

**Nowhere else in `src/` is the complaint valid.** Contacts list density
(`ContactListContent.tsx:79,115`), Deals cards/columns, and the dashboard widgets are
appropriately dense and bordered.

**Calm ≠ empty.** Calm Ledger is *intentional spacing rhythm* — `space-y-6` between cards,
`CardContent` `space-y-4`, `Separator`-delimited subsections, `gap-8` two-column detail —
sitting inside **capped, centered** containers with soft low elevation. The fix for
Settings is to give the content a centered cap so the rhythm reads as calm, not to add
padding. Do **not** introduce empty voids or oversized `max-width` ceilings — that would
reproduce the canvas's mistake.

---

## 4. Icon strategy

**Lucide is already the in-stack standard — confirmed.** `lucide-react ^0.542.0` is a
direct dependency (`package.json:69`) used across ~98 files; icons are Tailwind-sized
(`size-6`, `w-4 h-4`) and token-colored (`text-muted-foreground`, `text-primary`).
Contacts, Settings, the shell, and the dashboard contain **no emoji UI icons**. Emoji
icons (`▤ ✉ ☰ 🔒 ◷ ✦ ⚙`…) exist **only** in the throwaway canvas.
**Rule for our new work (esp. the Deals rewrite):** use Lucide components exclusively —
never port a canvas emoji. E.g. the "suggested before" catch chip and shadchan-provenance
chip should use Lucide glyphs (e.g. `Sparkles`/`Repeat`, `UserRound`), not `✦`/`◷`.

---

## 5. Sequencing & risk

| Phase | Work | Files | Risk | Gate |
|---|---|---|---|---|
| **1 — PURE THEME** | Apply `calm-ledger-theme.css` (3 edits to `index.css`) | `src/index.css` | **LOW** — CSS only, no markup/logic; reskins app + dark mode + elevation for free | Visual QA in both themes |
| **2 — Small token fixes** | 5 Contacts fixes (§2a), Settings hex detokenize (§2b), MobileNav style + DealsChart hex (§2d) | `misc/Status.tsx`, `contacts/*`, `settings/SettingsPage.tsx`, `misc/ImageEditorField.tsx`, `layout/MobileNavigation.tsx`, `dashboard/DealsChart.tsx` | **LOW–MED** — localized class/hex swaps | Dark-mode check on each |
| **3 — Settings layout** | 2 desktop layout edits (centered cap + unified sticky bar) | `settings/SettingsPage.tsx` | **MED** — structural but isolated to `SettingsFormFields` | Wide-viewport check |
| **4 — Deals domain rewrite** | 7-state config + `color`, card rewrite, column, inputs, show, i18n, **DB migration** | `root/defaultConfiguration.ts`, `types.ts`, `deals/*`, i18n; schema via `writing-migrations` | **HIGH** — data-model + DB change; DnD/persistence untouched | Security review (migration), full flow test |

**Do Phase 1 first and independently** — it is the highest-leverage, lowest-risk step and
makes every later phase visible against the real palette. Phases 2–3 are component polish.
Phase 4 is a genuine feature/domain change and must go through the harness's backend path
(migration → `backend-dev`, security-reviewer per `.claude/rules/security-triggers.md`).

**Implementation note:** this document is AUDIT/DESIGN only. No `src/` file is modified.
On sign-off, each phase is handed to the project's agent harness (dispatch `orchestrator`
with the session dir); the developer applies the changes under the Ponytail minimization
ladder, the quality-reviewer verifies token/wiring discipline, and the migration round
(Phase 4) is confirmed via the PD-ASK round-trip before it touches the database.
