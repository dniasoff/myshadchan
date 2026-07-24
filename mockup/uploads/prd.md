---
title: MyShadchan.space — Product Requirements Document
status: final
created: 2026-07-21
updated: 2026-07-21
---

# MyShadchan.space — Product Requirements Document

> A private, mobile-first CRM for a parent (or single) to manage the entire shidduch
> process across many shadchanim — every suggestion, resume, reference call, and date in
> one place, with resumes captured from the channels they actually arrive on.
> **Free core, low-cost AI tier (non-profit cost-recovery), source-available, privacy-by-default.
> Not a matchmaking service.**

_Status: **final** — independently reviewed, reconciled with the architecture, and polished._
**Release scope: all capabilities target the first release — no phased MVP.** Epics sequence
the *build order* only, not what's in or out.

**Surfaces: dual first-class.** An installable **mobile PWA** *and* a full **desktop web** app
from one responsive codebase. A meaningful share of users are **phone-less** (kosher/basic
phones or desktop-only) and iPhone/Android is a real split — so **no core action may require a
smartphone**, and both surfaces are first-class: mobile for smartphone users (Chani), desktop
for the phone-less.

**Jurisdiction: US-first — US-hosted, US compliance.** International (UK, Israel) is a deferred
internationalisation fast-follow — live once UK-GDPR / EU-GDPR / Israeli-privacy compliance is added
(see Deferred).

This document is **final** — independently reviewed, reconciled, and polished.

---

## Glossary

- **Shadchan** — a matchmaker the parent deals with.
- **Redt / suggestion** — a proposed match (a single suggested by a shadchan for a candidate); the
  central pipeline object.
- **Candidate / child** — the parent's son or daughter in shidduchim.
- **Resume ("shidduch resume")** — the profile document for a suggested single (bio, family,
  schools, references).
- **Reference** — a person listed on a resume who can be called about the single.
- **Dating history** — record of who a candidate dated, when, and what happened.
- **Shul** — synagogue (a community / identity signal).

---

## 1. Vision & Background

In the Orthodox Jewish community, a parent redting shidduchim for their children speaks to many
shadchanim and receives a constant stream of resumes — yet there is **no tool built for the
parent's side** of this. Existing products serve *singles* (matchmaking networks), *resume
building*, or *shadchanim* managing their pool — leaving parents on Google Sheets, WhatsApp chats,
Notes, and physical binders. The result is a **"crisis of process"**: they lose track of which
shadchan suggested what, the status of each suggestion, what references said, whether a person was
already suggested by someone else, and whether their child already dated them.

**MyShadchan is the single source of truth for that process** — the organised memory for an
inherently disorganised, high-volume, emotionally charged job. It captures resumes from the
channels they actually arrive on, remembers everything against the right person, and catches
duplicates and already-dateds before they get embarrassing.

- **Primary user:** a parent managing shidduchim for one or more children — non-technical,
  phone-first, always on WhatsApp. **Secondary:** an older single managing their own process, or a
  helper (e.g. a married sibling). The child/candidate is also a first-class user (UJ-2).
- **Core wedge — privacy & data ownership.** No **public or pooled** database of families; your
  private data is never shared or networked **without your consent**, and is fully exportable and
  deletable. The community's #1 concern and the pillar the whole product is built on (§4).
  *(Phase 2's shadchan↔parent connections are consent-based and scoped — never a pool.)*
- **Positioning.** **Free core, funded at cost, not for profit.** The **core CRM is free forever**;
  only the **AI-powered features** (auto-parse, the AI research assistant) require a low
  **cost-recovery** subscription (**~$2/mo USD**, adjusted only to track real hosting + AI cost as usage
  grows) — **no profit, no salesy funnel, no rabbinic-endorsement gate**. **Source-available** under a
  non-compete license (**FSL** — converts to Apache-2.0 two years after each release), **never a networked pool**.
  **Not** a matchmaking engine. **v1 is built for the parent's side** of the process — so it isn't mistaken for a matchmaking
  service or a shadchan's pool-management tool. **Shadchanim are valued partners, not outsiders:**
  **Phase 2 gives them their own interface** (interacting with parents, redding shidduchim,
  tracking conversations), making MyShadchan a **consent-based two-sided network**; the v1
  architecture is **designed so Phase 2 adds a shadchan role with no rework**. The privacy wedge still holds:
  any shadchan↔parent sharing is **scoped and consent-based**, never exposing a parent's private
  data. **US product, US-hosted.**

---

## 2. Primary User & Journeys

**Persona (inline): Chani** — a **Lakewood** mother with **two** children in shidduchim. Hugely
disorganised, "can't remember anything," messages scattered across
WhatsApp, email, and texts. Non-technical, phone-first, does this between everything else.
She is not an edge case — she is *the* user. (Device reality: her wider community is a real
iPhone/Android split, and **many are phone-less** — desktop-only or on kosher/basic phones.)

### UJ-1 · "Have I seen him before?" — the core loop

**Current state (today).** A shadchan WhatsApps a resume at 9pm → Chani half-remembers the
name → hunts across WhatsApp chats, the Google Sheet, a binder → search fails (Hebrew vs
English spelling) → no reliable answer → she leaves it in the chat → by morning it's buried;
if it *was* a repeat she never finds out, and the same boy gets "freshly" suggested again.
_(Validated against the owner's handwritten spec: "when a new resume comes in it shall say if
it has the same name of any resume he dated.")_

**Future state (with MyShadchan).**

1. **Ping → capture.** The shadchan WhatsApps a resume. On Android Chani taps **Share →
   MyShadchan** (1 tap); on iPhone she shares it to her MyShadchan email address; phone-less,
   she forwards the email or uploads from her desktop. Either way it lands in her **Inbox**,
   tagged with the shadchan.
2. **Auto-parse fills it in.** MyShadchan reads the resume (OCR + extraction) and pre-fills the
   single's identity — **name, parents, seminary/yeshiva, Shul, location**. Chani only **reviews
   and corrects**; extraction is assistive, never authoritative. *(Auto-parse is the **paid** AI
   accelerator after a free trial — §16; the free path is quick **manual entry**, and the duplicate
   catch in step 4 works either way.)*
3. **The app remembers for her.** It checks those fields against every past suggestion **and**
   her child's dating history — on **name + parents + seminary/yeshiva + Shul + location**, across
   Hebrew/English spellings.
4. **The catch.** A banner: *"⚠ Mrs. Klein suggested him 3 months ago — you said For-sure-not"* /
   *"⚠ [child] may have dated this person (Feb 2026 — 'not for us')"* — with a confidence level.
   Confirm or dismiss; nothing auto-merges. _(The "oh thank goodness" moment.)_
5. **File in seconds.** Confirm shadchan, assign child, onto the board — or straight to
   For-sure-not.
6. **Nothing is lost.** A tracked suggestion; first-suggester on record; filed to the right child.

### UJ-2 · The single's own "amazing" experience — *Rivky* (Chani's daughter, in shidduchim)

_Shidduchim can make a single feel like a product being shopped around. Rivky's login makes her a
**partner in her own process** — informed, in control, dignified — without dumping the churn on her._

1. **She logs in (desktop or phone) to a calm, curated view** — only the suggestions actually being
   *pursued* for her and where each stands. **Not** the pile of gut-rejections; **not** her mother's
   private notes.
2. **"Anything new for me?"** — a gentle indicator of live prospects and their stage, never an
   overwhelming resume dump.
3. **She gives input on her terms** — on a live suggestion she can flag **interested / not for me /
   want to know more**, and leave a private note or question for her mother. Heard, not just handled.
4. **She sets her own preferences once**, in her words — so the process reflects *her*.
5. **She sees reference diligence at a dignified distance** — that it's happening, without every
   candid word being exposed.
6. **A space that's hers** — her notes/preferences stay private unless she shares; her mother's
   working notes stay her mother's. (Realised by PRV-4.)
7. **Calm, never anxiety-gamified** — the emotional tone *is* the feature.

---

## 3. Functional Requirements — Core Loop (Capture → Inbox → Dedupe → Triage)

_IDs are global and stable. Tech choices (share-target APIs, OCR/LLM, providers) live in the
addendum, not here._

### 3.1 Capture

- **FR1 — Universal capture (no smartphone required).** A resume reaches the Inbox from **any**
  device via **manual upload** and **email forward/CC** to the account's private inbox address —
  the baseline for iPhone, basic/kosher-phone, and desktop-only users. *(Email channel: §5.)*
- **FR2 — WhatsApp share-target accelerator.** On **Android** (installed PWA), 1-tap **Share →
  MyShadchan**. On **iPhone**, **WhatsApp → Share → Mail → account inbox** (FR1). Native iOS
  wrapper for true 1-tap is **deferred**.
- **FR3 — Manual Add (+).** Add a resume directly, recording **which shadchan** sent it and **how**.

### 3.2 Inbox & Filing

- **FR4** — Every captured item enters a unified **Inbox** as an *unfiled* item — a staging area
  **distinct from the triage pipeline**; nothing auto-lands in a decision state.
- **FR5** — An Inbox item shows its **source channel**, attached file(s), and the known/detected
  shadchan (confidence indicator when inferred).
- **FR6** — On capture, **auto-parse** extracts the single's identity — name (Eng +
  Heb), parents, seminary/yeshiva, **Shul**, **location** — plus the full schema (§13). **Assistive,
  not authoritative:** review/correct before saving; manual entry always available.
- **FR7** — Filing routes the item into a **suggestion**: assign candidate → confirm/create
  shadchan → resolve duplicate/history flags → place on the board.
- **FR8** — An item can be **dismissed/archived** without becoming a suggestion.
- **FR9** — A non-resume message can be filed as an **interaction/note** against a shadchan or
  suggestion instead of a new suggestion.
- **FR78 — Optional quick-link at capture (searchable).** On share/capture (especially the PWA
  share-target, FR27), the app **optionally** offers a fast step to link the item — **search your
  shadchan book** (typeahead) for **which shadchan** (the app can't infer who texted you; you can)
  **and/or select the candidate** (which child), or attach to an **existing suggestion** (a boy/girl
  already on the board — filing the share as a note/update on it). **Not found → add the shadchan
  inline.** Pre-filled where inferable; **1-tap-skippable** → the item simply stays an **unfiled Inbox**
  item (FR4). Optional and fast — **never a blocking form**.

### 3.3 Duplicate & Dating-History Detection

- **FR10** — On capture/filing, the system automatically checks the single against prior
  **suggestions** and the candidate's **dating history**.
- **FR11** — Matching uses **multiple identity signals** — name + parents + seminary/yeshiva +
  **Shul** + **location** — with **Hebrew↔English** variant handling. **Never name-only.**
  *(Age/height are **not** used for matching — too unreliable on resumes; kept as informational
  fields only.)*
- **FR12** — Possible matches surface with a **confidence indicator** and deciding facts
  (first-suggested-by + date; or prior date + outcome). User **confirms or dismisses**; **never
  auto-merges**.
- **FR13** — For a confirmed duplicate, the **first-suggested-by** shadchan and date are recorded
  and shown.

### 3.4 Triage Pipeline

- **FR14** — A suggestion is tied to exactly one **candidate** and occupies exactly one **state**.
- **FR15** — Pipeline states (single board, both phases): **Triage** — New / Look-into / Not-sure /
  For-sure-not; **Decision** (post-investigation, from Look-into) — Yes / Unsure / No.
- **FR16** — A gut **For-sure-not** is distinct from a post-investigation **No**; both preserved.
- **FR17** — Move a suggestion between allowed states — drag-drop on desktop, mobile-native
  quick-move on phone.
- **FR18** — Every suggestion always shows **which shadchan** it came from.

### 3.5 Auto-parse Extraction (references → contacts)

_**FR19 & FR21 are paid-AI** (auto-parse, §13/§16, after the free trial); **manual entry stays free**,
and the reference-book matching itself (FR20/FR42) is **free** either way._

- **FR19 — Reference extraction → contacts.** Auto-parse extracts each **reference** (name,
  relationship, phone) and creates a **reference contact** linked to the resume — via the confirm
  screen.
- **FR20 — Reference de-duplication.** References are matched against the account's **reference book**;
  a match **links to the existing contact** (surfacing prior conversations) rather than duplicating.
  Matching runs on **manual entry too (free)** — auto-parse just does it automatically; the
  reference↔reference-book match itself is **not** a paid-AI feature.
- **FR21 — Full field extraction.** Beyond identity (FR6), auto-parse populates the resume schema
  (§13); all fields editable on the confirm screen.

---

## 4. Trust, Privacy & Security (first-class pillar)

Privacy is the product, not a setting. **Every feature ships with its privacy behaviour
specified** (as acceptance criteria). Least-exposure by default; users opt **into** sharing, never
**out**. **Jurisdiction: US product, US-hosted, US compliance** — HIPAA does not apply (consumer
app). Legal specifics → confirm with counsel.

- **PRV-1 · What we protect.** Highest-sensitivity data — **photos**, references' **candid words**,
  **health** notes, **dating outcomes**, family details. Risk model = *communal/reputational harm*,
  not merely regulatory.
- **PRV-2 · No pooled or public database (the wedge).** Each account's data is its own. **No pooling
  across families** (incl. references); no public/community DB. Full **export/backup**. **Deletion**
  purges the **live system immediately**, clears **backups within the retention window**, and
  instructs **sub-processors to delete per contract** — we promise only what is enforceable.
- **PRV-3 · Tenant isolation.** Enforced at the **database** (row-level security), not just the app.
- **PRV-4 · RBAC + parent↔child transparency.** Roles: parent/admin, child/candidate, helper,
  self-managing single. Transparency **configurable per family. Default = private both ways** — the
  child sees the curated, *live* slice of their process (never gut-rejections or the parent's private
  notes); the parent sees the full board but not the child's private notes/prefs unless shared. A
  family may dial **up** to fully open, but **never below a dignity floor**: the child always sees
  their live prospects and can give input.
- **PRV-5 · Sensitive media / photos.** Photos **are shareable** (sharing resumes is core) — but
  only via the controlled mechanism (PRV-8): access-controlled storage, no public URLs, **watermark
  + expiry available**, access-logged. Your **own** candidate's photo is yours to share; a
  **received** single's photo is shareable but the controls exist because it's someone else's image.
- **PRV-6 · Third-party & AI exposure.** OCR + LLM process photos/resumes; email/SMS relay them.
  Stance: minimise + **disclose sub-processors**; **contractual no-training**; **US region**; redact
  where feasible; the AI assistant does **no outward web-scraping of individuals**. Cloud AI with
  these guarantees accepted; self-hosted not required. **Payment processing uses Stripe** (a disclosed
  sub-processor); **card data lives only with Stripe** — we keep a customer/subscription reference,
  never card numbers.
- **PRV-7 · Channel routing safety.** **Share-based capture lands in the sharer's own authenticated
  account** — no cross-account routing to get wrong. For **email**, forwarded low-confidence
  original-sender recovery is **flagged, never silently wrong**, and an unresolved item waits in a
  **holding queue**, never mis-attributed. Channel ingestion is **rate-limited against flooding**
  (NFR-13).
- **PRV-8 · Sharing controls.** Resume/photo shares use **revocable, expiring, per-recipient,
  access-logged** links — never static files that spread uncontrolled.
- **PRV-9 · Authentication.** Passwordless (magic-link / passkeys) for non-technical, sometimes
  phone-less users; safe recovery; secure sessions on both surfaces.
- **PRV-10 · Encryption & hosting.** In transit + at rest; **field-level encryption for the most
  sensitive fields (health, photos)**; **US region**.
- **PRV-11 · The data subject (the single).** Singles never consented to being in the CRM. Stance
  (voluntary — not required under US law): never sell/share/train on their data; honour a **purge
  request** if a single asks to be removed. Kept as a values differentiator.
- **PRV-12 · US compliance & governance.** **v1 is US-only for compliance.** US **state-privacy-law
  patchwork** (CCPA/CPRA and peers, mostly threshold-gated; we **never sell personal data** — the
  ~$2/mo AI fee is cost-recovery, not data monetisation); **breach-notification** process;
  **sensitive-data** handling for health. **All users must be 18+**, stated clearly in the UI (age
  affirmation at signup) — no under-18 accounts, so **COPPA / teen rules do not apply**.
  *(International (UK/Israel) users would bring UK-GDPR / EU-GDPR / Israeli privacy law into scope —
  **deferred** with internationalisation; the architecture provisions the mechanics, AD-1/AD-15.)*

---

## 5. Channels (safe ingestion)

Inbound items come **to** the app; it never reads your accounts. Every inbound lands in the
**Inbox** (§3.2) → auto-parse → dedupe/history → file. Routing safety per PRV-7.

### 5.1 Email

- **FR22** — Each account has a **private inbound address** (`you@in.myshadchan.space`); inbound
  email + attachments are parsed and land in the Inbox, attributed by the address.
- **FR23 — CC mode.** Account address **CC'd** on a shadchan's email → sender **is** the shadchan →
  auto-match or create the shadchan.
- **FR24 — Forward mode.** Parent **forwards** → recover the **original sender** (shadchan) from
  headers/quoted body; low-confidence **flagged for confirmation** (PRV-7).
- **FR25** — PDF/image **attachments** captured automatically.
- **FR26 — Zero-touch (optional).** User sets an **auto-forward rule** in their own mail provider;
  the app never reads the rest of the mailbox.

### 5.2 Share-based capture (WhatsApp · SMS · any app)

- **FR27 — Share-target (any messaging app).** The shadchan's message — **WhatsApp, the SMS/Messages
  app, or anything else** — is captured by **Sharing it into MyShadchan**: **Android** 1-tap
  **Share → MyShadchan** (installed-PWA share-target, **text *and* images**); **iPhone** **Share → Mail
  → account inbox** (§5.1; a native Share Extension for true 1-tap is the deferred iOS wrapper). Capture
  lands in the parent's **own authenticated** Inbox, filed with context **in-session** — so "which
  shadchan / which boy" is resolved at capture, not lost — via an **optional quick-link** (FR78). **No** unofficial automation, **no**
  auto-reading of chats (Meta ToS → banned numbers).

### 5.3 SMS (via Share)

- **FR28 — SMS captured by Share.** SMS is captured by **Sharing the message into MyShadchan** (FR27):
  the shadchan's **text *or* photo** in the Messages app →
  **Share → MyShadchan** (Android share-target) or **Share → Mail → inbox** (iPhone) → the parent's own
  **authenticated** Inbox, filed with context **in-session**. This resolves "which shadchan / which
  boy" at capture and **captures images too** (no MMS dependency).
- **FR29 — Basic/kosher phones use desktop.** Users who can't Share (basic/kosher phones) capture via
  **desktop** email-forward / upload — their existing path.
- **FR30 — No shared number, no outbound.** There is **no shared inbound SMS number** and **no outbound
  SMS**; shared content lands only in the sharer's **own** account — no cross-account routing to
  mis-fire (PRV-7).

---

## 6. Shadchan Management

- **FR31** — Create/edit/delete a **shadchan**: name, state/location, contact info (phone, email,
  WhatsApp), free-text notes.
- **FR32** — Track **responsiveness / relationship** notes per shadchan.
- **FR33** — View **all suggestions** that came from a given shadchan.
- **FR34** — Per-shadchan **productivity stats**: # redts, # progressed (reached Look-into/Decision),
  # led to dates — so the parent learns which shadchanim are productive.

## 7. Suggestion & Resume Detail

- **FR35** — Each suggestion has a **resume record/folder**: file(s) + photo(s), extracted fields
  (FR6/§13), and links to its shadchan and candidate.
- **FR36** — **Notes** on the suggestion/resume overall, plus a timestamped **interaction** log.
- **FR37 — External shidduch-site links.** Attach one or more URLs to the single's profile on common
  platforms (ZUUG, ClickShadchan, Yismach, Canopy, SawYouAtSinai…); accept any URL, auto-label
  common domains, open in place. *Minimal — no data pull; deep integration deferred.*
- **FR38 — 360° shidduch view.** A single pane aggregating **everything** known about one
  suggestion: the single's details + resume/photo; pipeline state + decision; who **first
  suggested** it (and any duplicate links); all **references** with call-status, what-they-said,
  and track record; the candidate's **dating-history** flags; **external** shidduch-site links;
  **notes** + the full **interaction timeline**; **reminders**; the AI **research dossier** (§14);
  and the **candidate's own input** (§15). One screen, the whole picture.

## 8. Reference System

- **FR39** — References are **reusable contacts** (name, phone, relationship, **school**, **grad
  year**) **within the account**, linked to every resume they appear on. Never pooled across families
  (PRV-2).
- **FR40** — Per reference-on-a-resume, track **call-status**: Answered / No answer / Call back /
  They will call back.
- **FR41** — Capture **what the reference said** and **who they are** per call; keep a **conversation
  log** across calls.
- **FR42 — Repeat-reference recognition.** A recurring reference (by name/phone) surfaces prior
  conversations across singles — matched by FR20 on **both manual entry (free)** and auto-parse
  (automatic); this recognition is **free**, not gated behind the paid AI tier.
- **FR43** — Set **reference follow-up reminders** (see §9).

## 9. Reminders & Follow-ups

- **FR44** — Set **reminders/tasks** against a **shadchan, suggestion, or reference** ("call Mrs. X
  back Thursday", "chase reference").
- **FR45** — Reminders carry a **due date/time** and a linked entity; a list surfaces **upcoming and
  overdue**.
- **FR46 — Delivery.** In-app + **email (primary — reaches phone-less users, the guaranteed floor)** +
  **push** (installed-PWA smartphones). **No outbound SMS** (SMS is an inbound-only capture channel,
  §5.3). **No delivery depends on a smartphone.**

## 10. Resume Sharing (revocable links)

- **FR47** — Share a resume via a **link that always shows the latest version** and is **revocable**.
- **FR48** — Shares are **per-recipient, expiring, access-logged**; **photo inclusion is the sharer's
  choice** (PRV-5); watermark available.
- **FR49** — Revoking a link **cuts access immediately**; the sharer sees **who accessed and when**.

## 11. Multi-child

- **FR50** — Support **multiple candidates (children)**, each with its own pipeline, dating history,
  and resume set, with an easy **switcher**.
- **FR51** — A **shared shadchan book and reference book** span all children within the account.
- **FR52** — Per-child **isolation of suggestions/history** while sharing the common books.

## 12. Search & Dashboard

- **FR53 — Global search** across shadchanim, singles, references, and notes.
- **FR54 — Per-child dashboard:** counts by pipeline state, upcoming reminders, recently added
  resumes, flagged duplicates/history matches.

## 13. Auto-parse (full extraction schema)

_**Paid AI feature.** Auto-parse runs OCR + LLM, so it requires the **AI tier** (§16) after the free
trial. **Manual entry (FR6/FR57) is always free**, so a non-paying account is never blocked here._

- **FR55 — Extraction schema.** Single: name (Eng + Heb), DOB/age, height, **location**, **Shul**;
  family: parents' names, father's occupation, community/affiliation; schools: seminary/yeshiva, high
  school, camps; **references** (name/relationship/phone → contacts, FR19); **preserved section text**
  (bold section titles → sections).
- **FR56** — Handles **PDF and photo/image**; extraction into a **structured schema**.
- **FR57** — Always show a **review/confirm** screen; every field editable; assistive not
  authoritative (PRV-6).
- **FR58** — **Low-confidence fields flagged** for attention.

## 14. AI Research Assistant (due-diligence)

_**Paid AI feature.** The AI generation/summarisation here requires the **AI tier** (§16) after the
free trial. Core reference tracking (§8) — call-status, what-they-said, conversation logs — stays
**free**; only the AI assistance is gated._

- **FR59** — Generate **tailored reference questions** by relationship type (teacher vs neighbour vs
  friend).
- **FR60** — Guided **call script / checklist** with inline capture.
- **FR61** — **Summarise + cross-reference** all references for a suggestion — consensus,
  contradictions, and **gaps** ("nobody asked about health/finances").
- **FR62** — Per-suggestion **research dossier** aggregating resume + references + dates + links +
  notes.
- **FR63 — Hard invariant:** the assistant **never judges compatibility / does matching** (non-goal);
  **no outward web-scraping of individuals** (PRV-6).

---

## 15. The Single's Experience (child login)

_Realises **UJ-2**; access governed by **PRV-4** (private both ways, dignity floor)._

- **FR64** — The candidate has their **own login** (passwordless, fully usable on desktop — PRV-9),
  RBAC-scoped to their own process.
- **FR65** — The candidate sees a **curated, live view** — only suggestions actively being pursued
  for them, and each one's stage — **never** gut-rejections or the parent's private notes.
- **FR66** — On a live suggestion, the candidate can **give input**: flag **interested / not for me
  / want to know more**, and leave a private note or question for the parent.
- **FR67** — The candidate can **set their own preferences** (what matters, dealbreakers) in their
  own words.
- **FR68** — The candidate sees that **reference diligence is happening** at a dignified distance —
  progress, not the candid reference content.
- **FR69** — The candidate has a **private space** (notes/prefs) not visible to the parent unless
  shared; the parent's working notes are likewise private (PRV-4).
- **FR70** — The experience is **calm and low-pressure** by design (emotional tone is a feature).

## 16. Billing, AI Tier & Rate Limits (cost-recovery)

_The product is **free to use**; only the **generative-AI features** — auto-parse (§13) and the AI
Research Assistant (§14) — are paid, at **cost-recovery** pricing. Nothing here gates the core CRM,
manual entry, or the duplicate / already-dated **wedge** (§3.3), which stay **free forever**. Access
and entitlement are enforced **server-side** (not just in the UI), consistent with tenant isolation
(PRV-3)._

- **FR71 — Free core, paid AI only.** The entire CRM is **free**; the **only** paid capabilities are
  the generative-AI ones — **auto-parse** (§13) and the **AI Research Assistant** (§14). Everything
  else (capture, Inbox, triage, dedupe / already-dated, references, reminders, sharing, multi-child,
  child login, search) is free, and **manual entry is always the free fallback** for the AI features
  (FR6/FR57), so a non-paying account is **fully functional**.
- **FR72 — Free trial, then subscription.** AI features are **free during a trial window** (target
  **14 days** from first AI use; exact length tunable) and then require an active **AI subscription**.
  At trial end the AI features **lock** (FR75); the free core is untouched.
- **FR73 — Subscription & billing (Stripe).** A **parent/admin** manages a **per-account (family)**
  subscription (**~$2/mo USD** to start, **or ~$24/yr**) via **Stripe** (provider-agnostic). Card data
  lives only with Stripe — **no card data on our servers**. **Neither the child/candidate nor the
  helper role sees or manages billing** — parent/admin only (PRV-4); the `subscription` + usage rows
  are **RLS-scoped to the account** (PRV-3). To keep the fixed per-transaction fee from dominating at
  $2, **bank debit (ACH/SEPA/Bacs) is preferred, card as fallback** *(mechanics → addendum)*. Email
  receipts reach phone-less users — **no smartphone required** (NFR-2).
- **FR74 — AI rate limits.** AI usage is **rate-limited per account** to bound OCR/LLM cost (caps on
  auto-parses and assistant runs per period). Both the **limits and the price are revisitable** as real
  usage patterns emerge; changes are shown in-app.
- **FR75 — Graceful degradation & dunning (no data loss).** When the subscription is **inactive** or a
  rate limit is **reached**, AI features are **disabled with a clear, non-nagging cost-recovery
  explanation**; the core CRM and **manual entry stay fully available**, and **no data is lost or
  hidden**. A **failed payment** enters a **grace/retry window** (`past_due`) with reminders **before**
  the AI features lock — not an instant cut-off.
- **FR76 — Cost-recovery transparency.** The billing UI states plainly **what is free vs paid**, the
  account's **current AI usage vs its limit**, and the **non-profit, cost-recovery** rationale —
  trust-building, not a sales funnel (consistent with §1).
- **FR77 — Billing policy stance.** Named defaults *(confirm with counsel — §4)*: **cancel any time,
  access to period end, no refunds** on a cost-recovery product; **sales tax handled via the provider**
  (Stripe Tax); **one free trial per verified family** (guard against repeat-trial abuse via
  new/recreated accounts, NFR-13). Annual billing available (FR73).

---

## 17. Non-Functional Requirements

_Security & privacy are the dedicated pillar (§4); these are the remaining cross-cutting NFRs._

- **NFR-1 · Mobile-first, low-friction.** Large tap targets, minimal typing, 1–2-tap capture,
  one-handed use; the primary flows feel effortless on a phone.
- **NFR-2 · Dual-surface parity.** Full capability on installable **PWA** and **desktop web** from
  one codebase; **no core action requires a smartphone**.
- **NFR-3 · Offline-tolerant capture.** Add now, sync later where feasible.
- **NFR-4 · Performance.** Capture, Inbox, and the dedupe/history check feel instant on add.
- **NFR-5 · Auto-parse reliability.** Human-in-the-loop confirmation always; graceful handling of
  OCR errors and low-confidence fields.
- **NFR-6 · Bilingual by design.** Hebrew + English throughout — capture, display, search, and
  identity matching (variant/spelling aware).
- **NFR-7 · Accessibility.** Usable by non-technical users of varied ability on both surfaces.
- **NFR-8 · Availability & backups.** Reliable US hosting; regular backups; full data export (also
  PRV-2).
- **NFR-9 · Cost-efficiency & cost-recovery.** Per-account costs (OCR/LLM, Twilio, email) must be
  **bounded** (cheap models / caching / batching) **and**, for the AI features, **recovered** by the
  paid tier (§16) within the ~$2/mo price; non-AI running costs stay low enough to fund from the same
  pool. *(Detail → addendum.)*
- **NFR-10 · Data portability.** One-click export/backup of an account's full data.
- **NFR-11 · AI-usage governance.** AI features are **entitlement-gated and rate-limited**
  server-side (§16); limits and price are **operationally tunable** (ideally without a code change),
  so cost can track real usage patterns.
- **NFR-12 · UI internationalisation & bidirectional layout.** All UI text is **internationalised**
  (no hardcoded strings), **English + Hebrew** to start and **extensible** to more locales; the UI
  **auto-detects** the browser language (with a persisted user override) and is **bidirectional** —
  the layout mirrors for **Hebrew RTL**. *(This governs the **UI**; NFR-6 governs bilingual
  **data/matching**.)*
- **NFR-13 · Abuse prevention & rate-limiting.** Every expensive or abuse-prone surface is
  **rate-limited (per-account and per-IP)** — the **AI/parse pipeline** (cost/margin), **auth /
  magic-link / invite** (enumeration + spam), **channel ingestion** (flooding), **share-link access**
  (scraping), and **signup** (fakes) — **failing closed on the paid AI paths**.

## 18. Success Metrics & Counter-metrics

_A **free-core** community tool → success is **adoption + value delivered**, with a **sustainability**
floor: the AI tier must **cover its own cost**. Success is **not profit**._

- **North star.** Families running their *whole* process in-app — **weekly-active parents filing
  items**.
- **Value moments.** Duplicate / already-dated catches **confirmed**; **% of resumes captured via
  channels**; **reference calls logged per suggestion**; time-to-file an inbound resume.
- **Adoption.** **Activated families** (≥1 child + ≥1 suggestion); **4-week retention**;
  **referrals** (it's meant to be shared).
- **Sustainability (cost-recovery, not growth).** **Trial→paid conversion**; **share of AI cost
  recovered** by the tier; **AI cost per active family** (must stay within the recovery price). A floor
  to keep the lights on — never a revenue target.
- **Counter-metrics (guardrails).** Cross-account data leaks = **0**; mis-routed channel items =
  **0**; **false-positive duplicate-flag rate low** (don't cry wolf); child **"felt surveilled"**
  reports (dignity); **AI-extraction correction rate** (trust in auto-parse); **paywall friction** — **free-core users
  blocked from core value = 0** (the wedge never sits behind the paywall), and **trial-end churn** watched.

_Numeric launch **targets** are set once we have a baseline. **Measurement:** filing/pipeline and
dedupe-confirm events (product analytics); referrals via invite tracking; false-positive rate =
dismissed-duplicate-flags ÷ total-flags; "felt surveilled" via a lightweight in-app child sentiment
check._

## 19. Epic List (build sequence — all in first-release scope)

_Epics order the build; they are **not** scope gates. Privacy behaviour (PRV-1…12) is an acceptance
criterion within every epic._

1. **Foundation & multi-tenant auth** — fork Atomic CRM scaffold; accounts; **parent + child (+
   helper / self-manager) roles, RBAC, row-level security**; passwordless auth; dual-surface shell;
   multi-child setup; dashboard shell; **i18n + Hebrew RTL scaffolding (NFR-12)**; privacy foundations
   (tenant isolation, encryption, export/delete).
2. **Shadchanim & manual suggestion entry** — shadchan CRUD; add a suggestion manually; the triage
   **pipeline** (single board, 7 states); per-shadchan view + stats.
3. **Suggestion/resume detail & Reference system** — resume folder (file + photo), notes, external
   links; reusable **reference contacts**, call-status, conversation log, repeat-recognition.
4. **Dating history & duplicate detection** — date records; **multi-signal matching** (name +
   parents + seminary + Shul + location, Heb/Eng); duplicate + already-dated flags with
   confirm/dismiss; first-suggester.
5. **Auto-parse** — OCR + LLM extraction to the full schema (incl. references → contacts);
   human-review screen.
6. **Unified Inbox & channels (safe ingestion)** — Inbox filing station; email (per-account
   address, CC/forward, auto-forward); **Share-based capture** (WhatsApp · SMS · any app →
   share-target on Android, Share→Mail on iPhone), **text + images**.
7. **Reminders & follow-ups** — tasks vs shadchan/suggestion/reference; multi-channel delivery
   (email primary, reaches phone-less).
8. **Resume sharing** — revocable, always-current links; per-recipient, expiring, watermark,
   access-log; photo controls.
9. **The single's experience (UJ-2)** — child login UX; curated view; give-input; preferences;
   PRV-4 transparency controls.
10. **AI research assistant** — question generation, call script, cross-reference summary, dossier
    (never matching).
11. **Search, dashboard & polish** — global search; per-child dashboard; per-shadchan stats;
    export/backup; 18+ affirmation; informational landing page; mobile/desktop refinement.
12. **Billing, AI entitlements & rate-limiting (Stripe)** — free-trial → cost-recovery subscription
    (~$2/mo or ~$24/yr, per account); **server-side entitlement checks** gating auto-parse (Epic 5) +
    the AI assistant (Epic 10); **usage metering + rate limits**; parent-only billing management +
    **free-vs-paid / usage transparency (FR76-77)**; Stripe webhooks + **dunning**; graceful
    degradation to the free manual path. **Abuse / rate-limiting (NFR-13) is cross-cutting** — tightened
    as each surface lands. Privacy applies (billing data; Stripe a disclosed sub-processor, PRV-6).

---

## Risks & Assumptions

**Risks**
- **R1 · All-in-v1 delivery.** Shipping auto-parse + 3 channels + multi-tenant + child logins + the
  AI assistant together is a large first release with no de-scope lever. *Mitigation:* epics
  sequence the build; validate tenant isolation + privacy early; keep each epic internally shippable.
- **R2 · Auto-parse accuracy.** OCR + LLM extraction on varied resume formats may be unreliable.
  *Mitigation:* human-in-the-loop confirm (FR57), low-confidence flagging, manual fallback.
- **R3 · Hebrew↔English matching.** The dedupe's core value hinges on hard bilingual name matching.
  *Mitigation:* multi-signal (never name-only), confidence + confirm/dismiss, never auto-merge.
- **R4 · AI cost vs cost-recovery.** OCR/LLM (and Twilio/email) costs per account must be covered by
  the ~$2/mo AI tier. *Mitigation:* free-trial → paid gating (§16), per-account **rate limits** (FR74),
  cheap models / caching / batching (NFR-9); **price revisitable** by usage; watch cost-per-active-family.
- **R5 · iOS capture friction.** No WhatsApp share-target on iPhone. *Mitigation:* universal
  email-share/upload path; native wrapper deferred.
- **R6 · Community trust.** A privacy-sensitive community may distrust a new tool holding sensitive
  data. *Mitigation:* the privacy wedge itself — no networked pool, export/delete, transparency.
- **R7 · Paywall friction in a free-expecting community.** Charging even ~$2/mo for AI — and Stripe as
  a step for non-technical / phone-less users — may deter adoption. *Mitigation:* the **core CRM +
  manual entry stay free and fully functional**; the wedge is never paywalled; a low cost-recovery
  price framed honestly as non-profit; email receipts; a real free trial (§16). **Source-availability
  (FSL) protects the model from a cloned, undercutting competitor.**

**Assumptions**
- **A1** — All users are **18+** (PRV-12).
- **A2** — Shadchanim send resumes the parent can **forward/share**; the app never auto-reads accounts.
- **A3** — The **Phase-2** shadchan networking is acceptable to the community (revisit before Phase 2).
- **A4** — Families accept a **low, non-profit cost-recovery charge for AI features** given a free,
  fully-functional core (revisit if trial→paid conversion is very low).

## Roadmap — Phase 2 (next after v1)

- **Shadchan interface (Phase 2 — near-term, not long-term).** A shadchan-facing surface where
  shadchanim **interact with parents**, **redd shidduchim** (send suggestions directly into a
  connected parent's pipeline), and **track their own conversations**. Shadchanim are **partners**
  in the shidduch process; Phase 2 brings them in as first-class participants, making MyShadchan a
  **consent-based two-sided network**. **v1 is parent-side**, and the architecture is **designed so
  Phase 2 adds a shadchan role with no rework** (in-platform suggestion origination;
  per-relationship consent-based scoping — see addendum). **Privacy wedge holds:** a
  shadchan sees **only** the interaction/suggestion thread they are party to — **never** the
  parent's private notes, references, dating history, other shadchanim's suggestions, or the
  child's data. PRV-2's "no networked pool" is preserved (consent-based messaging, not DB exposure).

## Deferred / Revisit later

- **Internationalisation (UK, Israel).** v1 ships **US-only for compliance**; serving UK/Israel users
  is a **gated fast-follow** pending **UK-GDPR / EU-GDPR / Israeli-privacy** compliance + legal review.
  *(Hebrew UI, NFR-12, ships in v1 regardless — it serves the US community too.)*
- **Native iOS wrapper / Share Extension** — gives iPhone users **true 1-tap Share → MyShadchan** for
  WhatsApp / SMS / any app. Deferred (stay pure-PWA for now); revisit if the iPhone segment proves large
  and the email-share hop too clunky.

## Open Items (running)

- _Prior scope fully resolved (persona: Lakewood, two children; FR34 bar + §7 grouping blessed)._
- **AI trial length** — defaulted to **14 days**; confirm/tune before launch (FR72).
- **License copyright holder** — set to "Daniel Niasoff, 2026"; change to the project's legal entity if
  one is formed.
- **License file structure** — `LICENSE` (FSL) + retained `LICENSE.md` (MIT); optional tidy to a
  `NOTICE` file. Fork relicensing + non-profit status: **confirm with counsel**.
- **Internationalisation (UK/Israel)** — deferred; needs UK-GDPR / EU-GDPR / Israeli-privacy compliance
  + legal review before those users go live (architecture provisions the mechanics).
- **Billing policy** — cancel-to-period-end / no-refunds / Stripe Tax / one-trial-per-family are
  **named defaults** (FR77); confirm with counsel and tune before launch.
- **iOS 1-tap capture** — iPhone uses Share → Mail → inbox for now; a native Share Extension (deferred)
  gives true 1-tap.

---

## Status

**Final** — Vision · UJ-1/UJ-2 · FR1–78 · PRV-1–12 · NFR-1–13 · Billing/AI-tier (§16) · Metrics ·
Risks · Epics 1–12. **Free core; cost-recovery AI tier (Stripe); source-available (FSL); US-first;
capture-by-Share; UI i18n + Hebrew RTL.** Reviewed, reconciled with the architecture spine (18 ADs),
and polished. Next skills: `bmad-ux` · `bmad-architecture` · `bmad-create-epics-and-stories`.
