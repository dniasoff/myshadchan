# MyShadchan — Implementation vs Mockup Gap Analysis

_Generated 2026-07-24. Reference design: `MyShadchan.dc.html` (imported from the Claude
Design project `b46ed978-6197-481a-979d-706fe08470df`; screen set identical to the local
`design-artifacts/MyShadchan.dc.html`). Implementation audited by driving the running local
app with Playwright and cross-referencing `src/components/atomic-crm/`._

---

## 1. Methodology

- **Reference (source of truth):** the approved mockup `MyShadchan.dc.html` — a design-comp
  with 23 distinct surfaces (21 `is*` screens + two overlay surfaces `refFullOpen` and
  `callOpen`). Shared design tokens extracted from its `:root` (Calm Ledger: indigo
  `--primary`, honey `--attention`, sage `--positive`, seven `--st-*` pipeline colors;
  Space Grotesk / Inter / Heebo; `--radius: 0.875rem`).
- **Implementation:** the running app at `http://localhost:5173` against local Supabase,
  logged in as the seeded demo account `test@local.dev` (2 children, 12 shidduchim,
  5 shadchanim, 4 references, tasks/reminders). Playwright (headless Chromium) captured
  **19 routes × {desktop 1600px, mobile Pixel 5} = 38 screenshots**, cross-checked against
  the feature source under `src/components/atomic-crm/{landing,login,dashboard,shidduchim,shadchanim,references,children,reminders,tasks,settings,layout}`.
- **Scoring:** `match %` = how faithfully the built screen realizes the mockup's layout,
  components, content, states and visual system. `Status` ∈ {built, partial, missing,
  divergent}. Deliberate product decisions (e.g. removing Hebrew) are marked **divergent**,
  not counted as defects.

### Caveats
- Single account, **light theme only**, seeded demo data. Dark mode and RTL not re-shot.
- The board's two rightmost columns (**Unsure**, **No**) are clipped at 1600px width; their
  presence is confirmed from `shidduchim/pipelineStates.ts` (7 states) rather than pixels.
- **Hebrew / RTL was intentionally removed** from the UI (commit _"Remove Hebrew from the UI
  everywhere"_; see `design-artifacts/remove-hebrew.md`). The mockup is heavily bilingual;
  this is the single largest _deliberate_ divergence and is treated as such throughout.
- `fullPage` screenshots render blank in this headless build for the app's animated/OKLCH
  content; captures use a tall real viewport instead. (An audit artifact, not a product bug.)

---

## 2. Executive summary

**The in-app CRM is substantially built and closely on-design.** The dashboard, the 7-state
pipeline board, the 360° suggestion detail, the shadchanim book + detail, the entire
references lane (book, tabbed detail, call log, repeat-recognition, merge, gated AI
assistant), the children roster + forms, the reminders hub, the public landing page and the
sign-in screen all realize the mockup's "Calm Ledger" system faithfully: monogram avatars,
`StateChip`s, QL cards, honey/sage/indigo tokens, gradient primaries, and the calm shidduch
vocabulary (_redt, shadchan, shidduch_, the seven states). **Roughly 70–75% of the mockup's
surfaces are shipped to a high bar.**

**The gaps are concentrated, not diffuse.** They fall into four buckets:

1. **The net-new "capture pipeline" is missing.** The mockup's whole front-of-funnel — the
   PWA **share-target** ("the front door"), the **Inbox** of items needing confirmation, and
   the AI **auto-parse / "confirm the details"** resume review — does not exist; resume scan
   is a labelled _"coming soon"_. This is the most valuable missing chunk.
2. **Two standalone surfaces don't exist:** the candidate-facing **portal** ("what's being
   looked into for you") and the **billing** screen (only an entitlement gate exists).
3. **The shidduch-level catch/dedupe review is stubbed** (the card catch-chip is a deliberate
   placeholder), even though the reference-level repeat-recognition panel _is_ built.
4. **Bilingual Hebrew / RTL was deliberately removed** — a product decision that diverges from
   the mockup across every screen.

A short tail of cross-cutting polish remains: the legacy `/tasks` route renders blank
(superseded by Reminders), primary-button treatment is inconsistent (gradient vs flat blue),
and desktop `/settings` uses a narrow mobile-style column.

---

## 3. Coverage scorecard

| # | Mockup screen | App surface | Status | Match | Headline gap |
|---|---|---|---|---|---|
| 1 | `isLanding` — landing page | `landing/*` at `/` (LandingGate) | ✅ Built | ~90% | Minor section/copy differences only |
| 2 | `isSignin` — sign in (Screens 1–5) | `login/LoginPage` + `supabase/*` | ✅ Built | ~85% | Onboarding steps (18+ affirmation, invite accept, first-run add-child) not evident |
| 3 | `isDashboard` — per-child dashboard | `dashboard/*` | ✅ Built | ~90% | Attention "catch" card is a calm empty ("nothing to review") — no dedupe engine feeding it |
| 4 | `isBoard` — 7-state pipeline | `shidduchim/ShidduchimList` | ✅ Built | ~90% | Card catch-chip slot deliberately empty; "Show No column" toggle in source |
| 5 | `isDetail` — 360° suggestion (Screen 18) | `shidduchim/ShidduchShow` (routed dialog) | 🟡 Partial | ~65% | AI dossier, dating-history, external-sites sections deferred to future epic |
| 6 | Add a suggestion (Screen 10) | `shidduchim/ShidduchCreate` | ✅ Built | ~90% | Chunked Who/Redt-by/Details present; flat-blue primary, no bilingual name pair |
| 7 | `isCandidates` — children list (Screen 32) | `children/ChildList` | ✅ Built | ~85% | Mockup label "candidates" vs app "children"; per-child pipeline count not shown |
| 8 | `isChildinput` — add/edit child | `children/ChildInputs` | ✅ Built | ~85% | Hebrew name pairing removed (intentional); flat Save button |
| 9 | `isShadchanim` — shadchan book (Screen 19) | `shadchanim/ShadchanList` | ✅ Built | ~90% | Card grid + responsiveness chip + suggestion counts — strong |
| 10 | `isShadDetail` — shadchan detail (Screen 20) | `shadchanim/ShadchanShow` | 🟡 Partial | ~80% | Productivity stats (#redts / #progressed / #dates) likely absent (no aggregate) |
| 11 | `isReference` — reference book/detail/call (22–24) | `references/*` | ✅ Built | ~90% | Most complete lane; 4 tabs, call log, repeat-recognition, merge, gated AI assistant |
| 12 | `refFullOpen` / `callOpen` — AI research + AI-guided call | `references/ResearchAssistantPanel`, `CallCaptureSheet` | 🟡 Partial | ~60% | Assistant panel + call-capture sheet exist; full AI-guided call thread is lighter than mockup |
| 13 | `isReminders` — reminders hub (26–27) | `reminders/*` | ✅ Built | ~90% | Overdue(honey)/Upcoming groups, snooze, gradient CTA — matches intent |
| 14 | `isTasks` — tasks | `tasks` (no desktop list) | ⚪ Superseded | n/a | Concept realized as Reminders; raw `/tasks` route renders blank on desktop |
| 15 | `isPrivacy` — privacy & settings (37–39) | `settings/*` | ✅ Built | ~85% | Per-family record counts + export/delete + theme/lang; desktop uses narrow mobile layout |
| 16 | `isCatch` — catch/dedupe review | card slot + `references/RepeatRecognitionPanel` | 🟠 Partial | ~30% | No shidduch-level catch-review screen or dedupe engine; reference repeat-recognition only |
| 17 | `isBilling` — billing | `references/useAiEntitlement` (gate only) | 🔴 Missing | ~10% | No billing/subscription UI; free-vs-$2/mo AI tiering not surfaced |
| 18 | `isInbox` — capture inbox | — | 🔴 Missing | 0% | No in-app inbox of captured items |
| 19 | `isParse` — auto-parse "confirm the details" | — ("scan a resume — coming soon") | 🔴 Missing | 0% | No OCR/auto-fill resume review |
| 20 | `isShare` — PWA share-target front door | — | 🔴 Missing | 0% | No Android/WhatsApp share-target link flow |
| 21 | `isChildhome` — candidate portal | — | 🔴 Missing | 0% | No candidate-facing read-only "what's being looked into" view |
| 22 | `isRtl` — Hebrew/RTL variant | removed | ⚫ Divergent | n/a | Hebrew/RTL intentionally removed product-wide |
| — | `isLauncher` | _(mockup's own index page)_ | — | — | Not a product screen; the inline child-switcher is the real equivalent |

**Tally:** 11 built · 4 partial · 5 missing · 1 divergent · 1 superseded · 1 non-screen.

---

## 4. Thematic gap clusters

### A. Missing net-new capture / AI flows  ← _biggest value gap_
The mockup's core thesis is a **calm capture funnel**: a resume arrives on WhatsApp/SMS/photo,
the parent **shares it into the app** (`isShare` — "the front door"), it lands in an **Inbox**
of things needing confirmation (`isInbox`), and an **AI auto-parse** step lets her _"confirm
the details"_ without retyping (`isParse`, with the original PDF "kept as received, never
edited"). **None of this is built.** Evidence:
- Mobile nav exposes _"Scan a resume (coming soon)"_ — `layout/MobileNavigation.tsx:176`.
- `dashboard/Welcome.tsx` markets "Capture a resume from wherever it arrives" as a promise.
- No `parse`/`extract`/`ocr` implementation anywhere in `src/components/atomic-crm/`.
- No share-target manifest handling or inbox UI (`inbox` appears only in data-provider plumbing).

The AI is partially scaffolded on the **reference** side: `references/ResearchAssistantPanel.tsx`
(gated by `references/useAiEntitlement.ts`) and `references/CallCaptureSheet.tsx` exist, but the
mockup's AI-guided **call thread** (`callOpen`) is richer than what ships, and the AI **resume
parse** side has no counterpart at all.

### B. Deliberate divergences (document, don't "fix")
- **Hebrew / RTL removed.** The mockup pairs every name EN/HE (Heebo, `dir="rtl"`) and has a
  full RTL screen. The app has `name_he` referenced once and **zero** `Heebo`/`dir="rtl"`
  usages in components — a conscious simplification (`remove-hebrew.md`). Every "missing
  bilingual identity" is this one decision. If bilingual support returns, it is a schema +
  component sweep, not a per-screen fix.
- **"Candidates" → "Children".** The mockup calls the singles "candidates"; the app
  standardizes on "children" (`Family roster`, `children` resource). Naming choice, not a bug.
- **`isLauncher` is the mockup's own table-of-contents**, never a product screen. The app's
  inline child-switcher pill (top-left, `dashboard/DashboardHeader.tsx` /
  `shidduchim/ShidduchimList.tsx`) is the correct realization.

### C. Partial screens needing completion
- **Suggestion detail (`isDetail`)** is the richest mockup surface (dossier, dating history,
  external-site checks, catch chip). Shipped sections: header + `StateChip` + 7-state
  transition control + provenance ("first suggested by…") + suggestion facts + schools +
  redt history + references + timeline (`shidduchim/ShidduchShow.tsx:117-129`). The
  AI/dating/external blocks are **plan-acknowledged future-epic** deferrals.
- **Shadchan detail (`isShadDetail`)** has header + "suggestions from this shadchan"; the
  **productivity stats** the mockup shows need an aggregate that likely doesn't exist.
- **Reference AI overlays (`refFullOpen`/`callOpen`)**: the assistant tab and call-capture
  sheet are present but the guided-call experience is lighter than the mock.

### D. Data-model gaps blocking full parity
| Gap | Blocks | Note |
|---|---|---|
| No `children_summary` / per-child pipeline count view | Child cards' "N in pipeline" | Plan flags an N+1 risk; count omitted rather than faked |
| No shadchan productivity aggregate | `isShadDetail` stat tiles | #redts / #progressed / #led-to-dates |
| Catch/dedupe engine (name+DOB+mother match, prior-date flag) | `isCatch`, card catch-chip | `ShidduchCard.tsx:124` marks the slot "Intentionally [deferred]" |
| Resume attachment + OCR/parse fields | `isParse`, `isInbox`, `isShare` | Entire capture funnel |
| Billing/subscription + usage metering | `isBilling` | `useAiEntitlement` gates AI but no plan/usage/billing surface |
| Candidate-portal access (token / read-only share) | `isChildhome` | No public/read-only route |

### E. Cross-cutting quality
- **Empty legacy route:** desktop `/#/tasks` renders only the shell (no `list` registered for
  the `tasks` resource in `root/CRM.tsx`). Should redirect to `/reminders` or be unreachable.
- **Primary-button inconsistency:** list/hero CTAs use the gradient primary ("Add a shadchan",
  "Add a suggestion"), but some form saves (child create/edit) use a flat blue `SaveButton`.
- **Desktop settings** render a narrow, centered mobile-style column rather than a desktop
  two-pane layout.
- **States/responsive/a11y/dark-mode** were only spot-checked here (light theme, populated
  data); an explicit empty/loading/error + dark + 375px pass per screen is still owed.

---

## 5. Per-screen detail (highlights)

> Full evidence (file:line and screenshot) is inline in the scorecard and clusters above.
> This section expands the surfaces where the story is more than one line.

### `isDetail` — 360° suggestion (Screen 18) · 🟡 Partial ~65%
**Matches:** routed `Dialog` at `/shidduchim/:id/show`; monogram + name + `StateChip`; meta
row (location · seminary · via {shadchan} · Redt {date}); provenance line; a **"Move through
the pipeline"** 7-state control with the rule "a decision can only be made from Look-into";
"Suggestion facts" (parents/seminary/location/age/height, marked _informational only_);
"Schools & seminaries" with add-form; redt history, references and timeline below the fold.
**Gaps:** AI dossier, dating-history flags, external-site checks, and the inline catch chip
from the mockup are not rendered (future-epic). No fabricated data — correct call.

### `isReference` (+ `refFullOpen`/`callOpen`) — references · ✅ Built ~90%
**Matches:** QL header (monogram, contact line, **"1 of 1 conversations done"** progress
meter), **Merge duplicates**, four tabs (Conversations / Timeline and notes / Reminders /
Assistant), the honey **repeat-recognition** panel ("You have spoken to … about N other
singles"), answered-status chips, "Log a call". `CallCaptureSheet` for the one-thumb mobile
path. **Gaps:** the AI assistant is gated (`useAiEntitlement`) with no billing surface to
unlock it; the mockup's AI-guided call **thread with up-next questions** is lighter in-app.

### `isReminders` — reminders hub · ✅ Built ~90%
**Matches:** "Follow-through / Reminders", gradient **Add a reminder**, **Overdue** group in
honey ("Since 22 Jul") and **Upcoming** group, each card linked to an entity, with checkbox
complete + **Snooze**. No red, no anxiety count badge — exactly emotional-law #1. This
supersedes the mockup's separate `isTasks` screen.

### `isCatch` — catch / dedupe · 🟠 Partial ~30%
**Mockup:** "You've come across this person before" with a high-confidence match (name + DOB +
mother's name), prior-suggestion and prior-date history, Confirm/Dismiss, "nothing merges
automatically". **App:** reference-level `RepeatRecognitionPanel` is built and wired into
`ReferenceShow`; the **shidduch-level** catch is only a provenance line
(`first_suggested_at/by`) plus an explicitly deferred card catch-chip slot. The core
**dedupe engine** (matching + prior-date detection) is not present.

### Capture funnel — `isShare` / `isInbox` / `isParse` · 🔴 Missing
The mockup's entire front-of-funnel. `isShare`: an Android/WhatsApp **share-target** that
files a shared resume and resolves _which shadchan / which child / link to existing
suggestion_. `isInbox`: a queue of items "needing your confirmation — we won't guess".
`isParse`: **AI auto-fill** review that reads a resume into structured fields while keeping
the original PDF untouched, with an always-available "Enter myself" escape. **All absent;**
resume capture is surfaced only as "coming soon".

### `isBilling` · 🔴 Missing (~10%)
**Mockup:** "Run at cost, not for profit" — a **Free-forever** tier (CRM, manual entry,
duplicate catch, reference tracking) and an **AI tier at $2/mo or $24/yr** (auto-parse OCR,
research assistant, cross-reference gaps), a usage meter (34/100 resumes), graceful lapse.
**App:** only `useAiEntitlement` exists as a boolean gate — no plan comparison, no usage
meter, no subscribe flow.

### `isChildhome` — candidate portal · 🔴 Missing
"Rivky's space / What's being looked into for you / Your thoughts? →" — a calm, read-only
candidate-facing view. No public/read-only route or token-scoped access exists.

---

## 6. Prioritized backlog

### P0 — the product's missing spine (build to ship the core promise)
| Item | Screens | Effort | Notes |
|---|---|---|---|
| Capture funnel: PWA share-target + Inbox | `isShare`, `isInbox` | **L** | Manifest share_target + inbound-email address (Postmark webhook already exists) → an Inbox resource |
| AI auto-parse "confirm the details" | `isParse` | **L** | Resume attachment + OCR/LLM extract → editable review; keep original untouched; "Enter myself" escape |
| Catch / dedupe engine + shidduch catch review | `isCatch`, board chip | **M** | Match on name+DOB+mother; prior-suggestion & prior-date flags; wire the deferred card chip |

### P1 — complete built surfaces & monetization
| Item | Screens | Effort | Notes |
|---|---|---|---|
| Billing / subscription + usage meter | `isBilling` | **M** | Surfaces the $2/mo AI tier that `useAiEntitlement` already gates |
| Shadchan productivity stats | `isShadDetail` | **M** | Needs an aggregate view (redts/progressed/dates) |
| Per-child pipeline counts on child cards | `isCandidates` | **S–M** | `children_summary` view to avoid N+1 |
| Onboarding steps (18+, invite, first-run add-child) | `isSignin` cluster | **M** | UI shell + invite tokens/account naming backend |
| Candidate portal (read-only) | `isChildhome` | **M** | Token-scoped read-only route |

### P2 — polish & consistency
| Item | Screens | Effort | Notes |
|---|---|---|---|
| Fix/redirect empty desktop `/tasks` | `isTasks` | **S** | Redirect to `/reminders` or drop the route |
| Unify primary-button treatment (gradient everywhere) | forms | **S** | Child/reference create-saves |
| Desktop settings two-pane layout | `isPrivacy` | **S** | Currently narrow mobile column on desktop |
| Explicit empty/loading/error + dark + 375px pass | all | **M** | Owed per the plan's parity checklist |

### Intentional deferrals — track, don't rank as bugs
- Hebrew / RTL bilingual identity (removed by decision).
- Suggestion-detail AI dossier / dating-history / external-site sections (future epic).
- Reference AI assistant remains gated until billing exists.

---

## 7. Bottom line

The **relationship-memory core** of MyShadchan — pipeline, people (shadchanim, references,
children), follow-through (reminders) and the calm visual system — is **shipped and on-brand**.
What separates today's build from the mockup's full vision is almost entirely the **capture &
AI funnel** (share → inbox → auto-parse), the **dedupe "catch"**, and the **billing** that
unlocks the AI — plus the deliberately-dropped Hebrew. Delivering the three P0 items would
close the largest experiential gap between the running app and the approved design.
