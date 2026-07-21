# MyShadchan — Master Prompt for AI-Generated Mock Screens

> Paste everything below the line into Claude (or any capable AI design surface) to generate
> a comprehensive, high-fidelity set of mock screens for MyShadchan v1. It is self-contained:
> product soul, personas, emotional laws, a full visual design system, a screen-by-screen
> inventory, the states to render, microcopy tone, and output instructions.
>
> Source of truth: `prd-myshadchan-2026-07-21/prd.md` (FR1–78, PRV-1–12, NFR-1–13, UJ-1/UJ-2)
> and `architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md` (18 ADs, data model, 7-state pipeline).
> **The app is a fork of Atomic CRM** (marmelab/atomic-crm) — read §0 first; the screens re-skin and
> extend Atomic CRM's existing UI, they do not invent a new one.

---

# ROLE

You are a senior product designer creating a comprehensive set of **high-fidelity mock screens**
for **MyShadchan** — a private, mobile-first web app. Produce screens a developer can build from
directly: real layout, real components, real (bilingual) content, every important state. This is a
**dual-surface** product — an installable **mobile PWA** and a full **desktop web** app from one
responsive codebase — so design **both** where noted, from a single design system.

Do not summarize the brief back to me. **Design the screens.** Where the brief leaves a detail
open, make the most humane, calmest choice and proceed.

---

# 0. FOUNDATION — THIS IS A FORK OF ATOMIC CRM (design *with* the grain, not against it)

MyShadchan is being built as a **fork of Atomic CRM** (marmelab/atomic-crm): **React 19 +
TypeScript + Vite**, **shadcn-admin-kit** (react-admin / `ra-core` headless) over **shadcn/ui +
Radix + Tailwind CSS v4**, Supabase backend. This is **decisive for the mocks**: you are
**re-skinning and extending an existing, working CRM shell** — not designing a product from a blank
page. Every screen should look like a natural, calmer evolution of Atomic CRM's real components.

**What this means concretely:**

- **Reuse Atomic CRM's shell.** Desktop = a **left sidebar + top app-bar** layout (`Layout`,
  `Header`, `TopToolbar`). Mobile = a **bottom navigation** shell (`MobileLayout`, `MobileHeader`,
  `MobileNavigation`, `MobileContent`). Keep these; restyle them.
- **Reuse the react-admin Resource idiom.** Each domain object is a **Resource** with **List / Show /
  Create / Edit** views. Lists have an **aside filter panel** (desktop) and a **SimpleList**
  (mobile). Show views use a **detail + aside** two-column pattern. Create/Edit use **SimpleForm**,
  often in a **bottom Sheet** on mobile. Design to these primitives.
- **The Deals Kanban *is* our Pipeline board.** Atomic CRM already ships a drag-and-drop deal board
  (`DealList` → `DealListContent` → `DealColumn` → `DealCard`, columns from `stages.ts`). Our
  Suggestions pipeline is **that board, restaged to 7 states**. Reuse it.
- **Contacts *are* our Shadchanim & References.** The contact List/Show/Aside/Avatar/merge/import
  machinery becomes the shadchan book and reference book. **Notes/Activity → interactions & timeline.
  Tasks → reminders. Tags → status/label chips. Dashboard widgets → the per-child dashboard.**
- **The palette is a RE-SKIN of Atomic CRM's existing token file.** Atomic CRM already themes via
  OKLCH CSS variables in `src/index.css` (currently a neutral achromatic grayscale, Inter font,
  `--radius: 0.625rem`). The "Calm Ledger" palette in §4.1 **replaces those exact variables** — same
  token names, warmer values. Do not introduce a parallel design system; retheme this one.
- **Net-new screens still live in the same idiom.** The genuinely new surfaces (Inbox/capture,
  auto-parse review, the catch banner, resume sharing, candidate portal, billing) have no Atomic CRM
  ancestor — design them fresh, **but** built from the same shadcn/ui + shadcn-admin-kit components,
  the same shell, and the same tokens, so they feel native to the app.

A per-screen **lineage map** (which Atomic CRM component each screen re-skins or extends, or "net-new")
is given in §5.5. Honor it — it keeps the design buildable.

---

# 1. THE PRODUCT IN ONE BREATH

MyShadchan is the **single source of truth for a parent managing the shidduch (Orthodox Jewish
matchmaking) process** across many *shadchanim* (matchmakers). A shadchan sends a *resume* (a
single person's profile) for consideration; the parent must remember every suggestion, every
reference call, every date, and — critically — **catch when a person has already been suggested
before or already been dated**, before it gets embarrassing. Today this lives in Google Sheets,
WhatsApp, Notes apps, and physical binders. It is chaotic, high-volume, and emotionally charged.

MyShadchan captures resumes from the channels they actually arrive on (WhatsApp, SMS, email,
upload), remembers everything against the right person, and **catches duplicates and already-dateds
automatically**. It is **not** a matchmaking engine and **not** a shadchan's tool — it is built for
the **parent's side** of the process.

**Positioning that must be felt in the UI:** free core, funded **at cost, not for profit**
(~$2/mo only for the optional AI features); **privacy is the product, not a setting**; no pooled or
public database of families, ever. Calm, trustworthy, dignified — never salesy, never gamified.

---

# 2. WHO YOU ARE DESIGNING FOR

**Chani (primary) — the parent.** A Lakewood mother with two children in shidduchim. Hugely
disorganised, "can't remember anything," messages scattered across WhatsApp, email, and texts.
**Non-technical, phone-first**, does this between everything else. She is not an edge case — she is
*the* user. Design so nothing feels like software: big tap targets, minimal typing, one clear
action per screen, forgiving.

**Rivky (secondary) — the single / child.** Chani's daughter, in shidduchim. Shidduchim can make a
single feel like "a product being shopped around." Rivky's login must make her a **partner in her
own process** — informed, in control, dignified — **without** dumping the churn on her. She sees a
**calm, curated slice**, never the gut-rejections or her mother's private notes. **The emotional
tone is the feature.**

**Helper (tertiary).** A trusted married sibling or friend who assists — scoped access.

**Device reality (design for all of it):** a real iPhone/Android split, and **many users are
phone-less** — desktop-only, or on kosher/basic phones. **No core action may require a smartphone.**
Both mobile and desktop are first-class.

---

# 3. THE SEVEN EMOTIONAL DESIGN LAWS (non-negotiable — every screen obeys these)

1. **Calm over urgency.** No red alert badges, no "3 unread!" anxiety, no countdown pressure, no
   confetti. Overdue reminders are gentle nudges, not alarms. Whitespace and quiet are features.
2. **Relief, not error, at the catch.** When the app catches a duplicate or an already-dated
   person, it reads as *"oh thank goodness we caught this."* Warm honey/amber tone, reassuring
   copy — **never** a harsh red error. This is the product's hero moment.
3. **Dignity for the single.** A received resume is a real person who never consented to being in a
   CRM. Photos and candid reference words are handled with visible care. The child portal protects
   the single from feeling surveilled or shopped.
4. **Trust made visible.** Privacy is shown, not hidden: "🔒 Private to you," "Only you can see
   this," clear sharing controls, "operated at cost — not for profit." The user should *feel* safe.
5. **Assistive, never authoritative.** AI-extracted fields always look reviewable and editable;
   low-confidence fields are visibly flagged; nothing is a black box; manual entry is always a
   first-class, free path standing right next to the AI one.
6. **Effortless for the non-technical.** Plain language, no jargon, generous targets, minimal
   typing, obvious primary actions, gentle empty states that teach.
7. **Honest, never salesy.** The paid AI tier is framed as transparent cost-recovery. No dark
   patterns, no fake scarcity, no "UPGRADE NOW" pressure. Locking an AI feature always reminds the
   user the free manual path still works.

---

# 4. VISUAL DESIGN SYSTEM — "Calm Ledger"

**Mood:** a trusted private journal on a warm desk — orderly, warm, quiet, reassuring. Think a
well-kept family ledger kept by a calm, discreet advisor. **Avoid entirely:** dating-app tropes
(hearts, rings, sparkles, swipe cards), clinical/hospital sterility, and growth-hacked SaaS
loudness. Warmth comes from color and copy, not decoration.

The app is built on **shadcn-admin-kit** (react-admin / `ra-core` headless) over **shadcn/ui +
Radix + Tailwind CSS v4**, with **OKLCH** design tokens. Use shadcn's component vocabulary
throughout (Card, Badge, Sheet, Dialog, Tabs, DropdownMenu, Command, Table, Avatar, Skeleton, Sonner
toasts) **as they appear inside react-admin's List / Show / Edit / Create views** (DataTable,
SimpleList, SimpleForm, aside panels, ReferenceField). Design to these tokens and these primitives so
the mocks drop straight onto the Atomic CRM fork (§0).

## 4.1 Color tokens (drop-in `:root` / `.dark`, OKLCH)

Use these as the design's palette. Light is the primary theme; also show a dark variant for 1–2
hero screens.

```css
:root {
  --radius: 0.625rem;                         /* soft, not childish */
  --background:        oklch(0.985 0.006 85);  /* warm parchment, not stark white */
  --foreground:        oklch(0.24 0.012 265);  /* warm ink */
  --card:              oklch(0.995 0.004 85);
  --card-foreground:   oklch(0.24 0.012 265);
  --primary:           oklch(0.48 0.11 264);   /* deep, dignified indigo-blue — trust */
  --primary-foreground:oklch(0.985 0.006 85);
  --secondary:         oklch(0.955 0.010 85);  /* warm sand */
  --secondary-foreground: oklch(0.30 0.012 265);
  --muted:             oklch(0.955 0.010 85);
  --muted-foreground:  oklch(0.52 0.012 265);
  --accent:            oklch(0.90 0.045 150);  /* calm sage — gentle positive */
  --accent-foreground: oklch(0.30 0.03 155);
  --attention:         oklch(0.80 0.11 75);    /* HONEY/AMBER — the reassuring "we caught this" */
  --attention-foreground: oklch(0.30 0.05 75);
  --positive:          oklch(0.70 0.09 155);   /* sage green — progressed / Yes */
  --destructive:       oklch(0.55 0.18 25);    /* restrained red — true delete ONLY */
  --border:            oklch(0.90 0.006 85);
  --input:             oklch(0.90 0.006 85);
  --ring:              oklch(0.48 0.11 264);
  --sidebar:           oklch(0.975 0.008 85);
}
.dark {
  --background:        oklch(0.20 0.010 265);  /* warm charcoal */
  --foreground:        oklch(0.96 0.006 85);
  --card:              oklch(0.24 0.010 265);
  --primary:           oklch(0.70 0.10 264);
  --attention:         oklch(0.78 0.10 75);
  --positive:          oklch(0.72 0.09 155);
  --border:            oklch(1 0 0 / 12%);
  /* ...mirror the rest at charcoal luminance */
}
```

**Pipeline-state colors (7 calm, distinct hues — used for board columns and status badges):**
- **New** → neutral slate-blue `oklch(0.72 0.03 250)`
- **Look-into** → primary indigo (active investigation) `oklch(0.48 0.11 264)`
- **Not-sure** → soft honey `oklch(0.80 0.08 80)`
- **For-sure-not** (gut) → muted warm grey — a gentle "set aside," not harsh `oklch(0.70 0.010 85)`
- **Yes** → sage green `oklch(0.70 0.09 155)`
- **Unsure** → soft plum `oklch(0.68 0.07 320)`
- **No** (post-investigation) → muted clay/terracotta — visibly distinct from gut For-sure-not
  `oklch(0.64 0.08 40)`

> Note the deliberate distinction: a **gut "For-sure-not"** (warm grey, quiet) is different from a
> **post-investigation "No"** (clay). Both are preserved and must look different.

## 4.2 Typography

- **Latin:** `Inter Variable` (already in the stack).
- **Hebrew:** `Heebo` (harmonizes with Inter; designed for Hebrew UI) — or Noto Sans Hebrew. The
  app switches font-family by script/locale. Hebrew must look **native and beautiful**, never an
  afterthought.
- **Scale (comfortable — these are non-technical, sometimes older eyes):** Display/H1 30–32 /
  H2 22 / H3 18 / **body 16 (never below 15)** / small 14. Line-height 1.5 for body.
- **Numerals:** tabular for all counts, stats, dates.

## 4.3 Space, shape, elevation, targets

- Generous whitespace; calm density (this is not a dense data grid). Section rhythm over cramming.
- Radius `0.625rem` (cards, inputs, buttons); pills for badges/status.
- Soft, low elevation — gentle shadows, hairline warm borders. No heavy drop shadows.
- **Tap targets ≥ 44px; primary actions ≥ 48px.** On mobile, primary actions sit in **thumb reach**
  (bottom). Forms minimize typing (choosers, typeaheads, toggles over free text where possible).

## 4.4 Icons, imagery, motion

- **Icons:** Lucide (in stack), simple line style. **No hearts, rings, sparkles, cupids.**
- **Photos:** sensitive (PRV-5). Use tasteful avatar placeholders (soft pastel monogram avatars);
  a received single's photo is shown behind a clear, controlled affordance, never casually splashed.
- **Motion:** minimal and gentle. Soft fades/slides. No urgency animation, no gamified reward FX.

## 4.5 Bilingual + RTL (first-class, not a toggle-afterthought)

- The whole UI is internationalized: **English + Hebrew**. Every name/identity field is bilingual
  (English + Hebrew spelling shown together).
- The layout is **bidirectional**: Hebrew flips the entire layout to **RTL** (nav, icons, alignment,
  progress). **Render at least one hero screen fully in Hebrew RTL** (mirrored) to prove it.
- Mixed content is normal: a Hebrew name next to an English seminary. Handle gracefully.

## 4.6 Component vocabulary (use these named patterns)

Kanban board · staging Inbox list · a review/confirm form with per-field confidence chips · a
"catch" banner (attention-colored, reassuring) · a 360° aggregate detail with tabbed/sectioned
panes · reusable-contact directory · timeline/conversation log · revocable share-link manager ·
bottom-sheet quick actions (mobile) · a child-switcher · a calm dashboard of counts + nudges · a
transparent billing/usage panel · privacy affordance chips ("🔒 Private to you").

---

# 5. GLOBAL LAYOUT & NAVIGATION

**Desktop:** left sidebar (Dashboard, Inbox, Pipeline, Shadchanim, References, Reminders, Search,
Settings) + a top bar with the **child switcher**, global search, language toggle (EN/עב), and the
account/trial status. Content area is calm and roomy.

**Mobile (PWA):** a **bottom tab bar** (Home · Inbox · Pipeline · Add(+) · More) with the large
central **Add (+)** capture action. Top shows child switcher + search. Installable; offline-tolerant
(a subtle "queued — will sync" indicator when offline). Push-notification friendly.

**The child (candidate) portal is a distinct, calmer shell** — fewer items, softer, its own gentle
navigation (see §6-N).

## 5.5 Screen → Atomic CRM lineage map (reuse the real components; retheme, don't reinvent)

Each MyShadchan screen either **re-skins** an Atomic CRM component, **extends** one, or is **net-new**
in the same idiom. Design accordingly — a developer should recognize the ancestor.

| MyShadchan screen (§6) | Atomic CRM origin to reuse / extend | Change |
| --- | --- | --- |
| App shell — desktop | `layout/Layout · Header · TopToolbar · FormToolbar` | **Re-skin** (sidebar labels → our resources) |
| App shell — mobile + bottom nav | `layout/MobileLayout · MobileHeader · MobileNavigation · MobileContent` | **Re-skin**; center **Add(+)** = capture |
| 1–5 Auth / onboarding | `login/LoginPage · SignupPage · StartPage · ConfirmationRequired · LoginSkeleton` + `dashboard/DashboardStepper` | **Extend** → passwordless + 18+ + invite |
| 6 Dashboard | `dashboard/Dashboard · MobileDashboard · Welcome · DealsPipeline · DealsChart · HotContacts · LatestNotes · TasksList · DashboardActivityLog` | **Re-skin** widget grid → counts, catches, recent resumes, reminders |
| 11 Unified Inbox | `contacts/ContactList · ContactListContent · ContactListFilter` list idiom | **Net-new** semantics, list pattern reused; source-channel + confidence badges |
| 12 Unattributed queue | same List idiom, flagged variant | **Net-new** |
| 9 Share-target quick-link | `contacts/ContactCreateSheet` + `AutocompleteInput` typeahead | **Net-new**, sheet idiom |
| 10 Manual add suggestion | `deals/DealCreate · DealInputs` | **Extend** (identity + bilingual fields) |
| 13 Auto-parse review | `notes/NoteInputs` + `SimpleForm` + per-field confidence chips | **Net-new** (doc-vs-fields split) |
| 14 Duplicate / already-dated catch | `contacts/ContactMergeButton` dedupe idiom, reworked | **Net-new** honey "relief" banner |
| 15 Reference-extraction confirm | `contacts` merge/link idiom | **Net-new** |
| 16–17 Pipeline board + quick-move | `deals/DealList · DealListContent · DealColumn · DealCard · stages.ts · DealArchivedList · DealEmpty` | **Re-stage** deal Kanban → **7 states**; card always shows shadchan |
| 18 360° Suggestion detail | `deals/DealShow` + `contacts/ContactShow · ContactAside` + `activity/ActivityLog · ActivityLogIterator` + `notes/NotesIterator` | **Extend heavily** → the aggregate pane |
| 19–21 Shadchanim | `contacts/ContactList · ContactShow · ContactAside · Avatar · ContactInputs · ContactImportButton` | **Re-skin** contacts → shadchanim + stats |
| 22–24 References + call capture | `contacts/*` (reusable-contact) + `notes/*` + `contacts/ContactTasksList` | **Re-skin** → reference book + conversation log |
| 25 AI diligence assist | `notes/NoteInputs` + `tasks` checklist idiom | **Net-new** |
| 26–27 Reminders | `tasks/TasksListByDueDate · TasksIterator · AddTask · TaskCreateSheet · MobileTasksList · TasksListFilter` | **Re-skin** tasks → reminders (polymorphic target) |
| 28–30 Resume sharing | `notes/AttachmentField · NoteAttachments` for files; share UI new | **Net-new** revocable-link manager + recipient view |
| 31 Global search | react-admin search / `Command` palette | **Extend** → bilingual, grouped |
| 32 Child switcher | `root/ConfigurationContext` + app-bar selector | **Extend** |
| 33–36 Billing / AI tier | `settings` idiom | **Net-new** transparency + Stripe-hosted |
| 37–39 Settings / privacy | `settings/*` + `sales` (members) idiom | **Extend** → transparency dial, export/delete |
| 40–44 Candidate portal | a **separate, calmer** `MobileLayout`/`Layout` variant reading curated views | **Net-new** shell, same components |
| Tags / status chips (everywhere) | `tags/TagChip · colors.ts · TagDialog` | **Re-skin** → state/label chips |
| Notes & interaction timeline (everywhere) | `notes/Note · NotesIterator(Mobile)` + `activity/ActivityLog*` | **Re-skin** |
| Avatars / monograms | `contacts/Avatar · companies/CompanyAvatar` | **Re-skin** (soft pastel monograms) |

---

# 6. THE SCREEN INVENTORY

Design every screen below. ★ = **hero screen, highest fidelity, show mobile + desktop**. Others:
at least the surface(s) noted. For each, I list purpose, key regions, and the essential states.

## A. Onboarding & Auth

1. **Landing / informational page** (desktop + mobile). Calm, trustworthy, honest. Explains what
   MyShadchan is ("the organised memory for the shidduch process — the parent's side"), the privacy
   wedge ("your data is never pooled or shared"), free-core / at-cost-AI, and **"source-available,
   operated at cost — not for profit."** A single warm primary CTA ("Get started"). No hype, no
   fake testimonials, no urgency.
2. **Passwordless sign-in / sign-up.** Enter email → "We've sent you a magic link." Passkey offered
   as a progressive enhancement (secondary). Warm, reassuring, zero password talk.
3. **18+ affirmation** — a clear, respectful age affirmation step at signup (required; COPPA N/A).
4. **Invite acceptance** — a member joins an existing family account by a verified invite ("Chani
   invited you to help with the Klein family's shidduchim"). Shows the role they'll have.
5. **First-run family setup** — name the account, **add your first child** (bilingual name, gender),
   pick language (auto-detected, overridable). Ends by teaching the core loop in one calm sentence.

## B. Home / Dashboard

6. ★ **Per-child Dashboard** (mobile + desktop). Calm command center for the selected child:
   - Pipeline **counts by state** (gentle, not alarming) with a glance at the board.
   - **Upcoming & overdue reminders** (gentle nudge styling).
   - **Recently added resumes** (from the Inbox).
   - **Flagged catches** — any pending duplicate / already-dated flags to review (honey accent).
   - **Child switcher** prominent (Chani has two children).
   - Empty/first-run variant that warmly teaches "capture your first resume."
7. **All-children overview** (desktop) — a light roll-up across children with the switcher.

## C. Capture & Inbox — the front door (HERO cluster, UJ-1)

8. **Capture entry / Add (+)** (mobile-first) — the ways in: **Share from WhatsApp/SMS** (Android
   1-tap share-target), **upload a file/photo**, **forward/CC to your private inbox address**
   (`you@in.myshadchan.space`, shown copyable), **manual add**. Explain the iPhone path (Share →
   Mail → your inbox) plainly. Phone-less path (desktop upload/forward) is equal, not lesser.
9. ★★ **Share-target receive + link-it** (mobile hero; desktop paste/upload equivalent) — **the
   product's front door.** The moment a resume is shared *into* the installed PWA from **WhatsApp /
   SMS / any app** (Android 1-tap Share → MyShadchan; iPhone via Share → Mail → inbox). The shared
   payload (text **and/or** image thumbnail) lands in *her own* authenticated app; then an
   **optional, 1-tap-skippable** link step resolves context **while she still remembers it** (the app
   can't infer who texted her — she can):
   - **Which shadchan** — typeahead over the shadchan book; **not found → add inline** (no context switch).
   - **Which candidate (child)** — quick chooser (Chani has two).
   - **Or attach to an existing suggestion** already on the board (files the share as a note/update on it).
   Pre-filled where inferable; **skipping just drops it into the Inbox unfiled** (never lost). **Never
   a blocking form** — big targets, one thumb, done in seconds. This is where "which shadchan / which
   boy" gets resolved **at capture** instead of dissolving into the chat scroll. Render it three ways:
   **a WhatsApp text**, **an SMS**, and **a shared photo/resume image**.
10. **Manual Add form** — add a resume by hand (the free path): which shadchan sent it + how, the
    single's identity fields (bilingual). Minimal, chunked, forgiving.
11. ★ **Unified Inbox** (mobile + desktop) — the staging area. A list of **unfiled items**, each
    showing **source channel** (WhatsApp / email-CC / email-forward / upload badge), attachment
    thumbnail(s), and the **known/detected shadchan with a confidence indicator**. Clear "file this"
    affordance. This is a calm to-do pile, distinct from the decision pipeline — **nothing
    auto-lands in a decision state.**
12. **Unattributed / holding queue** — items where the sender couldn't be safely matched to a
    shadchan (e.g. a forwarded email with an ambiguous original sender). Clearly flagged "needs your
    confirmation — we won't guess," never mis-attributed.

## D. Auto-parse Review + the Catch (HERO cluster)

13. ★ **Auto-parse Review / Confirm screen** (mobile + desktop) — the workhorse. The app has OCR'd
    the resume; now the human reviews. Show:
    - The **source document** (PDF/photo) on one side; **extracted fields** on the other (stacked on
      mobile).
    - Full schema, all editable: **name (English + Hebrew)**, DOB/age, height, **location**, **Shul**,
      parents' names, father's occupation, community/affiliation, seminary/yeshiva, high school,
      camps, **references (name / relationship / phone)**, and **preserved section text**.
    - **Low-confidence fields visibly flagged** (a subtle honey chip "please check") — assistive,
      never authoritative. A calm "Looks right — save" primary.
    - The **free/manual counterpart is one tap away** and never hidden.
    - Variant: the **trial/locked state** — if the AI tier isn't active, this screen shows a gentle
      "AI auto-fill is a paid feature — or fill it in yourself (free)" with the manual form right
      there. No pressure.
14. ★★ **The Duplicate / Already-Dated Catch** (mobile + desktop) — **the signature moment.**
    A warm, **honey/amber**, *reassuring* banner surfaced during filing/review:
    - *"⚠️ Mrs. Klein suggested him 3 months ago — you marked him For-sure-not."*
    - *"⚠️ Rivky may have dated this person (Feb 2026 — 'not for us')."*
    - Show a **confidence level** and the **deciding facts** (who first suggested + date; or prior
      date + outcome). Two calm choices: **Confirm match** or **Dismiss — different person**.
      **Nothing auto-merges.** Tone = relief ("thank goodness"), not error. Design this to feel like
      the app just quietly saved the user from an embarrassing repeat.
15. **Reference-extraction confirm** — the sub-step where extracted **references become reusable
    contacts**; a matched reference **links to the existing contact** ("You've spoken to this Rabbi
    before — 2 prior calls") instead of duplicating.

## E. Triage Pipeline Board (HERO)

16. ★★ **The Pipeline Board** (desktop = kanban, mobile = column-scroll / quick-move). **One board,
    seven states**, per child:
    - **Triage:** New · Look-into · Not-sure · For-sure-not
    - **Decision (reached only from Look-into):** Yes · Unsure · No
    - Each **card** shows the single's name (EN + HE), a small photo/monogram, and **always which
      shadchan** it came from, plus any catch flag. Desktop: drag-and-drop. Mobile: a tidy
      **quick-move** (tap → move to…). Calm color coding per §4.1. Distinguish **gut For-sure-not**
      (warm grey) from **post-investigation No** (clay) visually.
17. **Mobile quick-move sheet** — the bottom sheet for moving a card between states one-handed.

## F. 360° Suggestion Detail (HERO)

18. ★★ **The 360° Shidduch View** (mobile + desktop) — one pane aggregating **everything** known
    about a single suggestion (FR38). Sectioned/tabbed:
    - **Header:** single's name (EN + HE), photo (controlled), age/height (info only), location,
      Shul; the **shadchan** it came from; current **pipeline state + decision**.
    - **Provenance:** who **first suggested** this single (and any duplicate links).
    - **Resume:** the file(s) + photo + extracted fields + preserved sections.
    - **References & diligence:** every reference with **call-status** (Answered / No answer / Call
      back / They'll call back), **what they said**, and their track record; the **AI research
      dossier** (consensus / contradictions / **gaps** — "nobody asked about health") — gated/paid.
    - **Dating-history flags** for the child.
    - **External shidduch-site links** (ZUUG, ClickShadchan, Yismach, SawYouAtSinai…) — labeled, open
      in place.
    - **Notes** + a full **interaction timeline**.
    - **Reminders** on this suggestion.
    - **The candidate's own input** (if the child has weighed in — interested / not for me / want to
      know more, and any note to the parent).
    - **Share** action (→ revocable link, §J).

## G. Shadchanim

19. **Shadchan book** (list) — the account-wide directory of matchmakers (name, location, a
    responsiveness cue). Add (+).
20. **Shadchan detail** — contact info (phone / email / WhatsApp), notes, responsiveness/relationship
    notes, **all suggestions from this shadchan**, and **productivity stats**: # redts, # progressed
    to Look-into/Decision, # led to dates. Calm bar/stat styling (this teaches the parent which
    shadchanim are productive — informative, not judgmental).
21. **Add / edit shadchan** (form; also reachable inline from capture quick-link).

## H. References & AI Diligence (HERO — the diligence spine of UJ-1)

22. **Reference book** — reusable reference contacts within the account (name, phone, relationship,
    school, grad year), each linked to every resume they appear on. Never pooled across families.
23. **Reference detail** — a person's **conversation log across singles** ("You've spoken to Rabbi
    Weiss about 3 different boys") — repeat-recognition surfaced.
24. ★ **Reference call workspace** (on a suggestion; **mobile hero — she's literally on the phone**) —
    per-call capture, thumb-sized: set **call-status** (Answered / No answer / Call back / They'll
    call back), record **what they said** + who they are, append to the **conversation log**. When the
    AI tier is on, the **tailored questions** (screen 25) sit right beside the capture. Calm, roomy,
    forgiving — usable one-handed mid-conversation.
25. ★★ **Cross-reference summary + AI diligence** (paid) — the **"did we actually check him out?"**
    payoff. Aggregates every reference call on a suggestion into **consensus**, **contradictions**,
    and — the wow — **gaps** ("nobody asked about health," "no one who knew him *recently*"). Plus
    **tailored reference questions** by relationship type (rebbe vs neighbor vs seminary teacher) and
    a **guided call script / checklist** with inline capture. **Hard rule made visible in tone: the
    AI never judges compatibility and never matches** — it only organizes diligence. Show the free
    vs paid framing (core reference tracking stays free; only the AI assist is gated).

## I. Reminders & Follow-ups (HERO — follow-through is half the value)

26. ★ **Reminders hub** (mobile + desktop) — the follow-through center: **upcoming + overdue** against
    a **shadchan / suggestion / reference** ("Call Mrs. Feldman back Thursday," "Chase the seminary
    reference"). Overdue is a **gentle honey nudge, never a red alarm** (emotional law #1) — it keeps
    her on top of a high-volume process *without adding anxiety*. Quick-complete + snooze; the same
    reminders surface on the Dashboard and in-context on the 360° view. Empty state reassures
    ("nothing due — you're on top of it").
27. **Create reminder** (bottom-sheet on mobile) — due date/time, linked entity, delivery channels
    (**in-app + email — the guaranteed floor that reaches phone-less users — + push on installed
    PWA**; **no outbound SMS, ever**). Make the phone-less-inclusive delivery visible and calm.

## J. Resume Sharing (revocable, controlled — PRV-8)

28. **Create share link** — share a resume via a link that **always shows the latest version** and
    is **revocable**, **per-recipient**, **expiring**; **photo inclusion is the sharer's explicit
    choice**; **watermark** available. Privacy affordances front and center.
29. **Manage shares** — who has access, **who viewed and when** (access log), **revoke** (cuts
    access immediately).
30. **Recipient's view** of a shared resume (public, no login) — clean, watermarked, read-only,
    expiry-aware. This is what the outside world sees; keep it dignified and minimal.

## K. Search & Multi-child

31. **Global search results** — across shadchanim, singles, references, notes. Bilingual-aware
    (Hebrew ↔ English spellings). Grouped, calm, fast.
32. **Child switcher & manage children** — switch between children; each has its own pipeline,
    history, and resume set, over a **shared shadchan + reference book**.

## L. Billing / AI Tier (honest cost-recovery — parent/admin only)

33. **Free-vs-paid transparency panel** — states plainly what is **free forever** (the whole CRM,
    manual entry, the dedupe/already-dated wedge) vs the **paid AI features** (auto-parse + research
    assistant), the account's **current AI usage vs its limit**, and the **non-profit, cost-recovery
    rationale**. Trust-building, not a funnel.
34. **Trial state** — a calm, non-nagging banner: "AI features free for 14 days." Never a countdown
    pressure bomb.
35. **Subscribe / manage subscription** (Stripe-hosted; parent/admin only) — ~$2/mo **or ~$24/yr**;
    card data never touches us. **Neither child nor helper sees billing.** Annual gently preferred.
36. **Locked / graceful-degradation state** — when the subscription lapses or a rate limit is hit,
    AI features are disabled with a **clear, kind** explanation, and the free manual path is right
    there. **No data lost or hidden.** Plus a **past_due grace** variant (reminders *before* lock).

## M. Settings / Privacy (HERO — the wedge made tangible)

37. ★★ **Privacy & transparency center** (mobile + desktop) — **the pillar the whole product stands
    on** (privacy is the product, not a setting; the community's #1 concern). The **parent↔child
    transparency dial**, **per family, default private both ways**, rendered so the user *understands
    and trusts* it: a plain-language visual of **who can see what** (the parent's full board vs the
    child's curated live slice vs private notes, both directions). The **dignity floor is shown as
    un-lowerable** ("Rivky always sees her live prospects and can give input — this can never be
    turned off"). Roles: parent/admin, child, helper, self-manager. Every toggle states its effect
    in human terms, never jargon.
38. ★★ **Data ownership** (mobile + desktop) — the wedge made tangible and **empowering**: one-click
    **export/backup** of the entire account; **account deletion** ("purges our live system
    immediately, clears backups within the retention window"); **per-single purge** (honor a removal
    request from someone named on a resume); plain **sub-processor disclosure** ("here's exactly who
    touches your data, and what for"). Design it to make the user feel *safe and in control*, not
    warned.
39. **Account & members / language** — invite/manage members and roles; **language toggle (EN / עברית)**.

## N. Candidate (Child) Portal — UJ-2 (a distinct, calmer experience)

> This is a separate, gentler shell. Rivky logs in (desktop or phone). **Never** show gut-rejections,
> the parent's private notes, or candid reference words. Calm, low-pressure, dignified — the
> emotional tone *is* the feature. Design these to feel like a quiet, respectful space that is *hers*.

40. ★ **Child home — "my process, calmly."** Only the suggestions **actively being pursued** for her,
    and each one's **stage**. A gentle "anything new for me?" indicator — never an overwhelming
    resume dump. Soft, spacious, reassuring.
41. ★ **Child suggestion view + give-input** — the **emotional heart of UJ-2** ("heard, not just
    handled"). A live suggestion at a **dignified distance**: enough to be a **partner**, never the
    churn. She gives input with three calm, low-pressure choices — **interested / not for me / want
    to know more** — and can leave a **private note or question** for her mother. No pressure, no
    gamified urgency; her voice is visibly *heard and recorded*. This is what turns "a product being
    shopped around" into "a partner in her own process."
42. **Reference diligence at a distance** — she sees **that** diligence is happening (progress),
    **not** the candid content. Reassuring, not exposing.
43. **My preferences** — she sets **her own preferences** (what matters, dealbreakers) **in her own
    words**, once. This reflects *her*.
44. **My private space** — her notes/preferences are **private to her** unless she shares. Show the
    "🔒 private to you" affordance clearly (mirrors the parent's private notes being private too).

## O. Cross-cutting states (render as variants of the above)

45. **Empty / first-run states** — for Dashboard, Inbox, Pipeline, Shadchanim, References. Warm and
    teaching, never a dead end.
46. **Loading / parsing-in-progress** — skeletons; a calm "reading the resume…" state for auto-parse.
47. **Offline / queued (outbox)** — capture works offline; a subtle "queued — will sync" cue. Capture
    **never blocks on network.**
48. **Low-confidence / error** — OCR uncertainty (honey flags), a failed parse falling back to manual,
    a friendly recoverable error. Never a scary stack trace.
49. **Locked / paywalled AI** — the graceful, kind lock (see 36), always with the free path present.
50. ★ **Hebrew RTL** — at least one hero screen (Dashboard, the Board, or the 360° view) **fully
    mirrored to RTL in Hebrew** to prove the bidirectional design.

---

# 7. DOMAIN VOCABULARY & REALISTIC SAMPLE DATA

Use **real-feeling** Orthodox-community data so the mocks land (bilingual where identity fields
appear). Examples to draw from — vary them naturally:

- **Children (candidates):** Rivky Klein (רבקה קליין), Yaakov Klein (יעקב קליין).
- **Shadchanim:** Mrs. Sarah Feldman (Lakewood), Mrs. Rochel Weiss (Monsey), Mrs. Devorah Klein
  (Brooklyn), Mrs. Miriam Gold (Lakewood).
- **Singles (on resumes):** Dovid Berkowitz (דוד ברקוביץ), Shmuli Katz (שמואל כ״ץ), Ari Rosenberg,
  Menachem Stern.
- **Seminaries / yeshivas:** Bais Yaakov of Lakewood, BJJ, Michlala; BMG (Lakewood), Mir, Ner Yisroel.
- **Shuls / communities:** a named shul + community (e.g. "Khal Zichron Yaakov," "Lakewood — Coventry").
- **Locations:** Lakewood NJ, Monsey NY, Brooklyn NY, Baltimore MD, Cleveland OH.
- **References:** a *rebbe* (Rabbi Weiss), a seminary teacher (Mrs. Brachfeld), a neighbor
  (Mrs. Schwartz), a camp friend. Relationship types matter for the AI question generation.
- **External sites:** ZUUG, ClickShadchan, Yismach, Canopy, SawYouAtSinai.
- **Glossary to honor in copy:** *shadchan* (matchmaker), *redt / suggestion* (a proposed match),
  *candidate / child*, *resume* (the single's profile), *reference*, *dating history*, *Shul*.

Dates realistic to a 2026 timeframe. Money: "$2 / month or $24 / year." Never invent salesy stats.

---

# 8. STATES TO RENDER FOR EACH SCREEN

For every screen, where meaningful, show: **default (populated)**, **empty/first-run**,
**loading/skeleton**, and any **error / low-confidence / locked** variant. For the hero screens,
show **both mobile and desktop**. Render primarily in **light** theme; show **dark** for 1–2 heroes
and **Hebrew RTL** for at least one.

---

# 9. MICROCOPY TONE & EXAMPLES

Plain, warm, human, reassuring, respectful. Never technical, never salesy, never anxiety-inducing.

- The catch: *"Good news — we think you've seen him before."* / *"Worth a look: Rivky may have
  dated this person last year."*
- Empty Inbox: *"Nothing to file right now. When a shadchan sends a resume, share it here and it'll
  land in your Inbox."*
- Low confidence: *"We weren't sure about this one — please check it."*
- AI lock: *"Auto-fill is part of the AI features. You can add this by hand for free, or turn AI back
  on any time."*
- Privacy: *"🔒 Private to you. Rivky can't see this."* / *"Your data is never shared or pooled."*
- Billing: *"MyShadchan is run at cost, not for profit. Here's exactly what you're paying for."*
- Child portal: *"Here's what's being looked into for you right now."* (calm, never a resume dump).

Provide the same key strings in **Hebrew** for the RTL screen(s).

---

# 10. OUTPUT FORMAT & DELIVERABLE

- Produce each screen as a **self-contained, responsive artifact** (HTML + Tailwind, using the token
  palette in §4.1 and shadcn component patterns). Group by the sections above (A–O).
- For hero screens, present **mobile and desktop side by side** (or clearly labeled).
- Use the **realistic bilingual sample data** from §7. Label each screen with its number, name,
  surface(s), and the state shown.
- Keep everything on-brand with the **seven emotional laws** and the "Calm Ledger" system — if a
  choice would make the app feel like a dating app, a hospital, or a SaaS funnel, choose differently.
- Where a detail is unspecified, **make the calmest, most humane choice** and note it briefly.

---

# 11. PRIORITY ORDER (if you can't render everything at once)

Do the **heroes first** — they carry the product's soul. Two tiers:

**Tier 1 — ★★ signature heroes** (highest fidelity, mobile *and* desktop, multiple states each):
1. **Share-target capture + link-it (9)** — the front door; WhatsApp/SMS → *her* app → which
   shadchan / which child, resolved at capture (UJ-1 start).
2. **The Duplicate / Already-Dated Catch (14)** — the signature relief moment (UJ-1 payoff).
3. **The Pipeline Board (16)** — the spine of the parent's day (Deals Kanban → 7 states).
4. **The 360° Suggestion View (18)** — the "whole picture, one screen."
5. **The Privacy & Transparency + Data-Ownership center (37, 38)** — the wedge the whole product
   stands on.

**Tier 2 — ★ core heroes** (high fidelity):
6. **The Unified Inbox (11)** — the calm staging pile (+ the unattributed queue, 12).
7. **The Auto-parse Review + confidence flags (13)** — assistive, human-in-the-loop.
8. **The Reference diligence workspace (24, 25)** — on-call capture + cross-reference **gaps** ("did
   we actually check him out?").
9. **The Reminders hub (26, 27)** — follow-through, calm and phone-less-inclusive.
10. **The Child portal — home (40) + give-input (41)** — the dignity experience, UJ-2.
11. **The Dashboard (6)** and **Billing transparency + graceful lock (33, 36)** — honest, never salesy.

Then fill in the rest (A–O), then the cross-cutting states (empty / loading / offline / locked /
**Hebrew RTL**).

**Now design the screens.**
