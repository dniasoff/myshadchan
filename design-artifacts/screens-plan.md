# MyShadchan — Stage-2 Screens Plan ("Quiet Luminance" rollout)

Concrete, per-lane tickets for the eight screen lanes. **Authoritative design:**
`DESIGN-DIRECTION.md` + `design-language.md` (read both first). This plan only
tells each executor *what to build in their lane and to what bar* — the visual
system is already locked.

## Reference quality bar (already shipped — mirror it, do not touch it)

The Foundation shipped these as the reference for craft and vocabulary. **Read
them; copy their patterns; never edit them** (they are in locked dirs):

- Board: `shidduchim/ShidduchCard.tsx`, `shidduchim/ShidduchColumn.tsx`,
  `shidduchim/ShidduchimList.tsx` — monogram avatar (`var(--avatar-N)` +
  `var(--avatar-ink)`), bilingual EN/HE identity pattern, hover-lift card,
  per-state dot/underline, calm meta rows, child-switcher pill group.
- Dashboard (locked): `dashboard/PipelineSnapshot.tsx`, `RecentSuggestions.tsx`,
  `AttentionSection.tsx`, `DashboardStat.tsx`, `Dashboard.tsx` — the funnel
  "moment", honey attention treatment, staggered `.ql-enter` entrance, QL card.
- Shared, **reuse don't duplicate** (in locked `misc/` — import, don't edit):
  `misc/StateChip.tsx` (the 7-state chip — token-driven), `misc/EmptyState.tsx`
  (warm SVG empty state + gradient CTA), shadcn `ui/card|button|dialog|sheet|tabs`.
- Bilingual identity helpers importable from `shidduchim/boardUtils.ts`:
  `getMonogram(nameEn)`, `getAvatarIndex(key)`, `formatRedtDate(date)`.

## Global rules for every ticket (from the repo rules + brief)

- **File ownership:** edit ONLY files inside your lane's directory. Do NOT touch
  `src/index.css`, `layout/*`, `dashboard/*`, `misc/*`. Cross-lane **imports are
  fine** (read-only) — importing `StateChip`, `EmptyState`, `boardUtils` helpers,
  and `pipelineStates` is expected and encouraged.
- **No new shared tokens/components.** If you genuinely need one, style your
  screen with what exists and note the gap in your return.
- **Colour = tokens only** (no hardcoded hex/oklch in components). Arbitrary
  Tailwind values that *reference* CSS vars are the norm (`bg-[--glass-bg]`,
  `text-[var(--st-look)]`, `color-mix(... var(--st-x) ...)`). Arbitrary **px** in
  brackets is acceptable only where it matches the board's established rhythm;
  prefer the type scale (design-language §2) and spacing scale otherwise.
- **SVG/Lucide icons only** — never emoji as an icon. **Space Grotesk** on
  headings + big numbers, **Heebo + `dir="rtl"`** on every Hebrew node,
  `tabular-nums` on all data. **Logical properties** (`ms/me/ps/pe`, `start/end`,
  `border-s/e`) — no `left/right`.
- **Glass on chrome/overlays ONLY** (sheets, dialogs, popovers) — reading
  surfaces (cards, forms, tables, timelines) are solid.
- **One primary CTA per screen**; the gradient primary recipe is design-language
  §5.3 (already embodied in `EmptyState`'s CTA — copy that class string).
- **Motion:** `.ql-enter` staggered entrance (already in `index.css`),
  `active:scale-[0.97]`, hover lift/glow, `--ease-spring`; transform/opacity
  only; honour `prefers-reduced-motion`.
- **Both themes + AA.** Force dark with `document.documentElement.classList.add
  ("dark")` and screenshot both. Render at least the empty state and one Hebrew
  node per screen.
- **`make typecheck` must pass. Do NOT git commit.** English-only in code.
- **Never fabricate data.** Where a screen's brief calls for data the schema
  does not yet expose (AI dossier, dating-history flags, dedupe catches,
  productivity stats), leave the slot out or show a calm "coming soon" — do not
  invent numbers. Flag each such gap in your return.

---

## Lane 1 — suggestion-detail  (`shidduchim/ShidduchShow.tsx`)

**Screen 18 — the 360° Shidduch view.** Currently a `Dialog` with plain
`border` sections and a bare `Badge variant="outline"` for state; it does not use
`StateChip`, the monogram, or QL cards. This is a hero — raise it to the board's bar.

**Files to modify (lane-owned):** `ShidduchShow.tsx`. If it exceeds ~400 lines,
extract sub-sections into new files in `shidduchim/` (e.g.
`ShidduchShowHeader.tsx`, `ShidduchSchoolsSection.tsx`, `RedtHistorySection.tsx`).
Keep the existing `Dialog` shell and all data hooks / RPC calls (`addRedt`,
`addSchool`, `useGetOne/useGetList`) intact — this is a visual + structure pass.

**Quiet-Luminance treatment:**
- Header: monogram avatar (reuse `getMonogram`/`getAvatarIndex` from
  `boardUtils`) beside the bilingual name (EN foreground + HE in
  `font-hebrew text-muted-foreground` with a real gap — copy `ShidduchCard`), the
  `<StateChip state={shidduch.pipeline_state} />` (replace the `Badge`), and the
  meta row (location · seminary · `via {shadchan_name}` · `Redt {date}` ·
  `redt ×N`). Dialog content is an overlay → glass is permitted on the dialog
  surface only.
- Body: sectioned QL cards (`rounded-2xl bg-card border border-border shadow-sm`)
  with §2 section headers (`font-display text-lg font-semibold`) — Schools &
  seminaries, Redt history (mark First/Latest with tabular dates), References
  (the existing `<ShidduchReferencesSection>` — leave wired, wrap in a section
  header), Add-a-redt form.
- Provenance line ("first suggested by … {date}") if `first_suggested_at` present.
- The empty "catch-chip slot" and AI dossier / dating-history / external-site
  sections are **future-epic** — keep the `ShidduchCard` comment convention: do
  not render fabricated catch/dossier data.

**States to render:** populated; each sub-section empty (schools none / redts one
/ references none — calm one-liners, not `EmptyState` inside a dialog); **loading
skeleton** (currently `return null` — add a lightweight skeleton header + rows).

**Acceptance:** uses `StateChip` not `Badge`; monogram + bilingual header matches
board; sections are QL cards; typecheck passes; light+dark+one Hebrew name checked.

**Risks:** it's a routed `Dialog` (`/shidduchim/:id/show`), not a `Show` — keep
that. Age/height are info-only (FR11) — never present as matching signals.

---

## Lane 2 — suggestion-form  (`shidduchim/ShidduchInputs.tsx`, `ShidduchCreate.tsx`)

**Screen 10 — Manual add a suggestion.** Currently plain react-admin inputs
(`ShidduchInputs`) inside a `Dialog` (`ShidduchCreate`). Make it a calm,
chunked, forgiving form (emotional law #6) at QL bar.

**Files to modify (lane-owned):** `ShidduchInputs.tsx`, `ShidduchCreate.tsx`.
Keep the `createShidduch` submit path (AD-4 sole INSERT), the `?state=` initial
column logic, and all field `source` names exactly.

**Quiet-Luminance treatment:**
- Dialog is an overlay → glass on the dialog surface allowed; group inputs into
  labelled QL sections with §2 headers: **Who** (child + bilingual name EN/HE),
  **Redt by** (shadchan, redt date, starting column), **Details** (seminary,
  location, parents, shul, age, height). Pair EN/HE name fields visibly as a
  bilingual identity (not two unrelated rows).
- One primary CTA: restyle the `SaveButton` "Add a suggestion" to the gradient
  primary (wrap or pass the §5.3 class); focus rings visible; targets ≥ 44px.
- Starting-column `SelectInput` — show the state's dot/colour alongside the label
  if cheap (reuse `pipelineStates` tokens), else leave plain.

**States:** default; required-field validation error (child + name_en required);
narrow mobile (single column — `useIsMobile` already wired) vs desktop two-column.

**Acceptance:** submits via `createShidduch`; bilingual name pairing correct incl.
RTL; one gradient primary CTA; typecheck passes; both themes checked.

**Risks:** `SaveButton`/`FormToolbar` are admin components — style via className/
wrapper, don't fork them. Do not add fields not in `CreateShidduchInput`.

---

## Lane 3 — children  (`children/*`)

**Screen 32 — manage children (+ child cards).** Currently a bare
`DataTable` list and plain `SimpleForm` create/edit; **no Show view**. Children are
few (Chani has two) — a **card grid**, not a table, is the humane choice.

**Files to modify/create (lane-owned):** `ChildList.tsx` (rebuild as card grid),
`ChildInputs.tsx` (chunk + bilingual pairing), `ChildCreate.tsx`/`ChildEdit.tsx`
(wrap in QL page frame), `index.ts` (wire a `show` if you add one). Optionally
add `ChildShow.tsx` and `ChildCard.tsx` in-lane.

**Quiet-Luminance treatment:**
- List → responsive grid of QL cards, one per child: monogram avatar
  (`getMonogram(first_name_en)` + `getAvatarIndex`), bilingual name (EN +
  `first_name_he` in Heebo/RTL with real gap), community, and a `status` chip
  (active = sage `--positive` tint; paused = muted). `.ql-enter` staggered.
  Card press → child's pipeline (`/shidduchim` filtered) or a `ChildShow`.
- A single gradient "Add a child" primary (top-right, `CreateButton` restyled).
- Form: bilingual first/last name pairs, gender chooser, community, status;
  calm labels; ≥44px targets; one primary save.

**States:** populated grid; **empty/first-run** (reuse `EmptyState`: "Add your
first child" → `/children/create`); loading skeleton cards.

**Acceptance:** card grid not table; monogram + bilingual + status chip; empty
state via shared `EmptyState`; typecheck passes; both themes + Hebrew name.

**Risks:** no `children_summary` view — **pipeline-count-per-child is not
guaranteed to be queryable** without an N+1. Do **not** fabricate counts; if a
cheap per-child count isn't available, omit it and show status/community only
(flag in return). Adding a `ChildShow` is optional; if added, wire it in
`index.ts` and keep it calm (child's suggestions list + edit) — not a hero.

---

## Lane 4 — shadchanim  (`shadchanim/*`)

**Screens 19–21 — shadchan book, detail, add/edit.** Currently a bare
`DataTable` and plain forms; **no Show view**. Screen 20 (detail with "all
suggestions from this shadchan" + productivity stats) is the substantive add.

**Files to modify/create (lane-owned):** `ShadchanList.tsx` (rebuild),
`ShadchanInputs.tsx`, `ShadchanCreate.tsx`/`ShadchanEdit.tsx`, `index.ts` (add
`show`). Create `ShadchanShow.tsx` (detail), optionally `ShadchanCard.tsx`.

**Quiet-Luminance treatment:**
- List (screen 19): card list/grid — name (EN + `name_he` Heebo/RTL), location, a
  **responsiveness cue** as a calm chip (high = sage, medium = neutral, low =
  muted honey — never red), monogram avatar. `.ql-enter`; card → `ShadchanShow`.
- Detail (screen 20): QL header (monogram, bilingual name, location, contact
  info, responsiveness chip, notes) + a section **"Suggestions from this
  shadchan"** — query `shidduchim` filtered by `shadchan_id` (via `redts`/
  `shidduchim_summary.shadchan_id`), each row a compact card with `StateChip`.
- Add/edit form: name EN/HE, location, responsiveness chooser, notes; one primary.

**States:** populated; **empty book** (`EmptyState`: "Add your first shadchan");
detail with zero suggestions (calm "No suggestions from her yet"); loading.

**Acceptance:** styled list + working `ShadchanShow` wired in `index.ts`;
suggestions-from-this-shadchan renders with `StateChip`; typecheck passes; both
themes + Hebrew name.

**Risks:** **productivity stats (# redts, # progressed, # led to dates) require a
view/aggregate that likely does not exist.** Do NOT fabricate them. Ship the
"all suggestions from this shadchan" list (real, queryable) as the informative
payload; add stat tiles only if a real aggregate is available, else omit and flag
in your return. Confirm the queryable field for "suggestions by shadchan" before
building (`shidduchim_summary.shadchan_id` vs the `redts` join).

---

## Lane 5 — references  (`references/*`)

**Screens 22–24 — reference book, detail, on-call capture.** This is the
**most-complete lane already** (full `ReferenceShow` with tabs, call log, timeline,
research/match panels, and the mobile-hero `CallCaptureSheet`). The gap is
**visual polish to the QL bar** — `ReferenceList` is a plain `DataTable` and
`ReferenceShow`/`ReferenceCallLog` use plain `Card`/`CardContent`, not the QL
recipe. **Do not rewire any RPC/logic** — polish visuals only.

**Files to modify (lane-owned, visual-only):** `ReferenceList.tsx` (styled list),
`ReferenceShow.tsx` + its `ReferenceHeader` (monogram + calm progress meter, QL
card), `ReferenceCallLog.tsx` / `LinkCard` (QL cards, `--ease-spring` press),
`CallStatusChip.tsx` (confirm it's token-driven like `StateChip`),
`RepeatRecognitionPanel.tsx` (honey "you've spoken to them before" treatment,
§5.8). Leave `CallCaptureSheet` behavior intact — only ensure it's a glass bottom
sheet with ≥44–56px targets (it mostly is).

**Quiet-Luminance treatment:**
- List: card list (or restyled table) — bilingual name, relationship, phone,
  school, and "**Linked to N singles**" + reminder count as tabular badges;
  repeat-recognition is the whole point, so make "linked to N" prominent.
- Header: monogram + bilingual name; the `contacted / total conversations` as a
  calm progress meter (not a raw string) — sage `--positive` fill.
- Tabs: keep the 4 tabs; give the active tab an indigo underline/tint; call-log
  cards are QL cards with the `CallStatusChip` and a gradient-subordinate "Log a
  call" (this is a secondary action — keep it ghost/outline, the sheet's Save is
  the primary).

**States:** populated; empty book (`EmptyState`); reference linked to no singles
(existing copy); tab-level empties (already present); loading. Mobile: the
`CallCaptureSheet` one-thumb path is a hero — verify at 375px.

**Acceptance:** List + Show + call log read as QL (not stock shadcn); no logic/RPC
touched; `CallStatusChip` token-driven; typecheck passes; both themes + one
Hebrew reference; mobile call sheet ≥44px targets.

**Risks:** large surface (~25 files) — **scope strictly to visual polish**; resist
refactoring the match/research/RPC machinery. The AI research panel is gated/paid
(`useAiEntitlement`) — keep its lock framing kind (emotional law #7), don't unlock.

---

## Lane 6 — reminders  (`reminders/RemindersPage.tsx`)

**Screens 26–27 — reminders hub + create.** Currently a placeholder "coming
soon" `EmptyState`. The full catch/overdue engine is a later epic, but the `tasks`
resource **is** registered — build the calm hub shell now against it, with the
honey (never red) overdue treatment as the signature.

**Files to modify/create (lane-owned):** `RemindersPage.tsx` (build the hub),
new in-lane files as needed (`ReminderList.tsx`, `ReminderCard.tsx`,
`ReminderCreateSheet.tsx`). Keep `RemindersPage.path = "/reminders"`.

**Quiet-Luminance treatment:**
- Two calm groups: **Overdue** and **Upcoming**, reading `tasks` by due date.
  Overdue = honey nudge (`bg-[color-mix(in oklch,var(--attention) 18%,transparent)]`
  §5.8), a gentle "since {date}" — **never a red alarm, never a count badge**
  (emotional law #1). Each reminder card: text, linked entity (shadchan /
  suggestion / reference), due date (tabular), quick-complete + snooze actions.
- Create = bottom sheet (glass) on mobile: what · due date/time · linked entity ·
  delivery note (in-app + email floor; **no SMS ever** — show this calmly).
- One primary CTA ("Add a reminder", gradient).

**States:** upcoming populated; overdue (honey); **empty** ("Nothing due —
you're on top of it." via `EmptyState`); loading skeleton.

**Acceptance:** overdue is honey not red; no anxiety badges; one primary CTA;
typecheck passes; both themes.

**Risks:** **`tasks` may not yet carry a polymorphic linked-entity or the fields
this hub wants.** Inspect the `tasks`/reminders schema first. If the data model
can't support a real hub yet, ship an **elevated, QL-quality "coming soon"** that
still demonstrates the overdue-honey and empty treatments (don't fabricate live
reminders) — and flag the exact missing fields in your return. Do NOT expose the
raw legacy Atomic Tasks UI.

---

## Lane 7 — settings-profile  (`settings/ProfilePage.tsx`)

**Screens 37–39 (profile slice) — your account + language + privacy.**
`ProfilePage.tsx` is an Atomic-CRM leftover: profile card, an **MCP-server** card
and an **inbound-email** card (CRM-dev features, off-brand here), a language
selector. Reskin to QL and to MyShadchan's calm/trust tone.

**Files to modify (lane-owned):** `ProfilePage.tsx`. (The big
`SettingsPage.tsx` / `SettingsPageMobile.tsx` = the branding/config admin — a
**separate** surface, out of this ticket's scope; do not touch beyond noting.)

**Quiet-Luminance treatment:**
- Profile card = QL card: monogram/avatar (existing `ImageEditorField`), first/
  last name, email, and a **prominent language toggle EN / עברית** (the existing
  `LanguageSelector` — make it first-class, RTL-correct). Edit/save/password with
  one primary + subordinate secondaries.
- **Privacy affordance** (emotional law #4): a calm chip/line — "Private to your
  family · operated at cost, not for profit" — this is the wedge made visible.
- **Remove or reframe the MCP-server and inbound-email cards** — they are
  developer plumbing, not parent-facing. Prefer hiding them (or gate behind an
  admin/dev flag); at minimum do not present them as core to a parent. Confirm
  neither is load-bearing before removing (they're env-gated already).

**States:** view mode; edit mode (dirty-gated save); password-reset sent
(existing notify); loading (`identity` null → calm skeleton, currently null).

**Acceptance:** QL profile card; language toggle prominent + RTL-correct; privacy
line present; no "contacts"/CRM-jargon copy; MCP/inbound cards removed or clearly
de-emphasised; typecheck passes; both themes.

**Risks:** copy references "contacts" and CRM concepts — rewrite to shidduchim
vocabulary. Removing the MCP/email cards changes behavior slightly — they're
`import.meta.env`-gated, so removal is safe, but note it. `SettingsPage.tsx`
(branding admin) is Atomic slop but **out of scope** here — flag it for a later lane.

---

## Lane 8 — auth-onboarding  (`login/*`)

**Screens 1–5 — sign-in / sign-up / confirmation / first-run.** LoginPage,
SignupPage, and `AuthHero` are **already MyShadchan-branded and reasonably
polished** (split hero + form, bilingual pipeline chips, Calm-Ledger gradient).
The gaps are: `ConfirmationRequired` is stock/plain; the onboarding steps (18+
affirmation, invite acceptance, first-run family setup / add-first-child) don't
exist; and dark-mode + Hebrew-RTL parity across the cluster needs verification.

> **⚠ COORDINATION RISK — READ FIRST.** Other agents are **active in this session
> and editing `login/` and `landing/` right now**: `auth-polish`,
> `landing-and-auth`, `landing-plain-copy`, `landing-polish`, `landing-rebuild`.
> **Do not collide.** Before editing `LoginPage.tsx` / `SignupPage.tsx` /
> `AuthHero.tsx`, assume `auth-polish` owns them — coordinate via `SendMessage`
> or confine yourself to files they are not in. Landing (`landing/*`) is **out of
> this lane entirely**. Scope this ticket to the **gaps**, not a turf war over
> LoginPage.

**Files to modify (lane-owned, coordinate on the hot ones):** `ConfirmationRequired.tsx`
(reskin to match the auth cluster — glass card, LedgerMark, calm copy, dark+RTL),
`StartPage.tsx` (routing only — leave). New in-lane onboarding files **only if not
owned by another agent**: `AgeAffirmation.tsx`, `InviteAcceptance.tsx`,
`FirstRunSetup.tsx` (name account + add first child + language). Verify (don't
necessarily rewrite) `LoginPage`/`SignupPage`/`AuthHero` for dark-mode + RTL.

**Quiet-Luminance treatment:** the split hero + solid form panel already set the
pattern — match it. `AuthHero` is chrome → its gradient/blur is fine. Form panels
are solid reading surfaces. One primary CTA each; `ConfirmationRequired` becomes a
centered glass-free calm card with LedgerMark and reassurance copy.

**States:** sign-in (default / error / loading); sign-up (first-user / already-
initialized redirect / creating); confirmation-required; **first-run empty**
(no children → teach the core loop in one sentence); dark + one Hebrew RTL screen.

**Acceptance:** `ConfirmationRequired` matches the cluster; any new onboarding
screen is QL + one primary CTA; **no collision** with the active auth/landing
agents (coordinated or file-disjoint); typecheck passes; both themes + one RTL.

**Risks:** the biggest risk is **stepping on `auth-polish`/landing agents** — a
merge conflict or double-styling. Coordinate first. Onboarding screens (18+,
invite, first-run) may need data/routes that don't exist yet (invite tokens,
account naming) — build the UI shell, don't fabricate a backend; flag missing
routes. `ConfirmationRequired` currently inverts a logo via CSS filter — replace
with `LedgerMark` (already used across the cluster).

---

## Cross-lane parity checklist (every executor, before returning)

- [ ] Reused `StateChip` / `EmptyState` / `boardUtils` helpers instead of
      re-implementing them.
- [ ] Colour via tokens only; no hardcoded hex/oklch; glass only on overlays.
- [ ] Space Grotesk on headings + big numbers; Heebo + `dir="rtl"` on Hebrew with
      a real gap (never `ms-*` on the RTL span); `tabular-nums` on data.
- [ ] Logical properties throughout; one Hebrew node sanity-checked.
- [ ] One primary CTA (gradient §5.3); secondaries subordinate; targets ≥ 44px.
- [ ] `.ql-enter` entrance + `active:scale-[0.97]` press; `prefers-reduced-motion`
      honoured; transform/opacity only.
- [ ] Empty + loading states rendered; no fabricated data (catches/dossier/stats).
- [ ] Screenshotted light **and** dark (force `.dark`) at 375 + desktop; AA in both.
- [ ] `make typecheck` passes. No `git commit`. English-only in code.
- [ ] Return: what changed, any data gaps found, any shared token/component you
      wanted but couldn't add.
