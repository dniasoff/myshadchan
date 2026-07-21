---
title: MyShadchan.space — Product Requirements Document
status: draft
created: 2026-07-21
updated: 2026-07-21
---

# MyShadchan.space — Product Requirements Document

> A private, mobile-first CRM for a parent (or single) to manage the entire shidduch
> process across many shadchanim — every suggestion, resume, reference call, and date in
> one place, with resumes captured from the channels they actually arrive on.
> **Free, community-shared, privacy-by-default. Not a matchmaking service.**

_Status: **draft** — Journey-led coaching in progress._
**Release scope: all capabilities target the first release — no phased MVP.** Epics sequence
the *build order* only, not what's in or out.

**Surfaces: dual first-class.** An installable **mobile PWA** *and* a full **desktop web** app
from one responsive codebase. A meaningful share of users are **phone-less** (kosher/basic
phones or desktop-only) and iPhone/Android is a real split — so **no core action may require a
smartphone**, and both surfaces are first-class: mobile for smartphone users (Chani), desktop
for the phone-less.

**Jurisdiction: US product — US-hosted, US compliance.** (Supersedes the brief's UK/GDPR note.)

The document is now content-complete; next step is **Finalize** (review + polish).

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
- **Core wedge — privacy & data ownership.** No public or networked database; the family's data is
  theirs, fully exportable and deletable. The community's #1 concern and the pillar the whole
  product is built on (§4).
- **Positioning.** **Free** and community-shared — no monetisation, no salesy funnel, no
  rabbinic-endorsement gate. **Not** a matchmaking engine. **v1 is parent-side** — the landing page
  says "not a shadchan tool" — but a **shadchan interface is Phase 2** (near-term: shadchanim
  interacting with parents, redding shidduchim in-platform, tracking conversations), so the
  architecture is **provisioned for it now** (see Roadmap + addendum). The privacy wedge still holds:
  any shadchan↔parent sharing is **scoped and consent-based**, never exposing a parent's private
  data. **US product, US-hosted.**

---

## 2. Primary User & Journeys

**Persona (inline): Chani** — a mother in **[community / city — TBD]** with **[# — TBD]** child(ren)
in shidduchim. Hugely disorganised, "can't remember anything," messages scattered across
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
   and corrects**; extraction is assistive, never authoritative.
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
- **FR6** — On capture, **auto-parse** (OCR + LLM) extracts the single's identity — name (Eng +
  Heb), parents, seminary/yeshiva, **Shul**, **location** — plus the full schema (§13). **Assistive,
  not authoritative:** review/correct before saving; manual entry always available.
- **FR7** — Filing routes the item into a **suggestion**: assign candidate → confirm/create
  shadchan → resolve duplicate/history flags → place on the board.
- **FR8** — An item can be **dismissed/archived** without becoming a suggestion.
- **FR9** — A non-resume message can be filed as an **interaction/note** against a shadchan or
  suggestion instead of a new suggestion.

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

- **FR19 — Reference extraction → contacts.** Auto-parse extracts each **reference** (name,
  relationship, phone) and creates a **reference contact** linked to the resume — via the confirm
  screen.
- **FR20 — Reference de-duplication.** Extracted references are matched against the account's
  **reference book**; a match **links to the existing contact** (surfacing prior conversations)
  rather than duplicating.
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
- **PRV-2 · No networked database (the wedge).** Each account's data is its own. **No pooling
  across families** (incl. references); no public/community DB. Full **export/backup**;
  **hard-delete** that truly purges (backups + third parties).
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
  these guarantees accepted; self-hosted not required.
- **PRV-7 · Channel routing safety.** Shared-SMS: an **unrecognised sender is never attributed**
  (holding queue, never mis-routed). Forwarded-email low-confidence recovery is **flagged, never
  silently wrong**.
- **PRV-8 · Sharing controls.** Resume/photo shares use **revocable, expiring, per-recipient,
  access-logged** links — never static files that spread uncontrolled.
- **PRV-9 · Authentication.** Passwordless (magic-link / passkeys) for non-technical, sometimes
  phone-less users; safe recovery; secure sessions on both surfaces.
- **PRV-10 · Encryption & hosting.** In transit + at rest; **field-level encryption for the most
  sensitive fields (health, photos)**; **US region**.
- **PRV-11 · The data subject (the single).** Singles never consented to being in the CRM. Stance
  (voluntary — not required under US law): never sell/share/train on their data; honour a **purge
  request** if a single asks to be removed. Kept as a values differentiator.
- **PRV-12 · US compliance & governance.** US **state-privacy-law patchwork** (CCPA/CPRA and peers,
  mostly threshold-gated for a free non-selling app); **breach-notification** process;
  **sensitive-data** handling for health. **All users must be 18+**, stated clearly in the UI (age
  affirmation at signup) — no under-18 accounts, so **COPPA / teen rules do not apply**.

---

## 5. Channels (safe ingestion)

Inbound items come **to** the app; it never reads your accounts. Every inbound lands in the
**Inbox** (§3.2) → auto-parse → dedupe/history → file. Routing safety per PRV-7.

### 5.1 Email

- **FR22** — Each account has a **private inbound address** (`you@in.myshadchan.space`); inbound
  email + attachments are parsed via webhook and land in the Inbox, attributed by the address.
- **FR23 — CC mode.** Account address **CC'd** on a shadchan's email → sender **is** the shadchan →
  auto-match or create the shadchan.
- **FR24 — Forward mode.** Parent **forwards** → recover the **original sender** (shadchan) from
  headers/quoted body; low-confidence **flagged for confirmation** (PRV-7).
- **FR25** — PDF/image **attachments** captured automatically.
- **FR26 — Zero-touch (optional).** User sets an **auto-forward rule** in their own mail provider;
  the app never reads the rest of the mailbox.

### 5.2 WhatsApp

- **FR27 — Share-target only.** **Share → MyShadchan** (Android 1-tap; iPhone via Share → Mail).
  **No** unofficial automation, **no** auto-reading of chats (Meta ToS → banned numbers).

### 5.3 SMS / MMS

- **FR28** — A single **shared inbound number** (Twilio) receives SMS/MMS for all accounts; MMS
  **images** captured to the Inbox.
- **FR29 — Sender-lookup routing.** Routed to the account with the matching **verified linked
  phone** (`account_phone`). Linking a phone is **required** for SMS; multiple phones per account.
- **FR30 — No mis-routing.** **Unrecognised sender → unattributed queue**, never mis-routed (PRV-7).
  SMS is a **parent-forwarding** channel, not shadchan-texts-in.

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
- **FR38** — A **unified suggestion view** shows state, first-suggester, references, dating flags,
  reminders, and external links in one place.

## 8. Reference System

- **FR39** — References are **reusable contacts** (name, phone, relationship, **school**, **grad
  year**) **within the account**, linked to every resume they appear on. Never pooled across families
  (PRV-2).
- **FR40** — Per reference-on-a-resume, track **call-status**: Answered / No answer / Call back /
  They will call back.
- **FR41** — Capture **what the reference said** and **who they are** per call; keep a **conversation
  log** across calls.
- **FR42 — Repeat-reference recognition.** A recurring reference (by name/phone) surfaces prior
  conversations across singles (auto-linked at parse time, FR20).
- **FR43** — Set **reference follow-up reminders** (see §9). *(No reference "analytics" — dropped.)*

## 9. Reminders & Follow-ups

- **FR44** — Set **reminders/tasks** against a **shadchan, suggestion, or reference** ("call Mrs. X
  back Thursday", "chase reference").
- **FR45** — Reminders carry a **due date/time** and a linked entity; a list surfaces **upcoming and
  overdue**.
- **FR46 — Delivery.** In-app + **email (primary — reaches phone-less users)** + **push** (installed-
  PWA smartphones) + optional SMS. **No delivery depends on a smartphone.**

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

- **FR55 — Extraction schema.** Single: name (Eng + Heb), DOB/age, height, **location**, **Shul**;
  family: parents' names, father's occupation, community/affiliation; schools: seminary/yeshiva, high
  school, camps; **references** (name/relationship/phone → contacts, FR19); **preserved section text**
  (bold section titles → sections).
- **FR56** — OCR handles **PDF and photo/image**; extraction via an LLM to a **fixed JSON schema**.
- **FR57** — Always show a **review/confirm** screen; every field editable; assistive not
  authoritative (PRV-6).
- **FR58** — **Low-confidence fields flagged** for attention.

## 14. AI Research Assistant (due-diligence)

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

## 15. Non-Functional Requirements

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
- **NFR-9 · Cost-efficiency.** Free product → per-user costs (OCR/LLM, Twilio, email) must be
  bounded and sustainable (cheap models / caching / batching where possible). *(Detail → addendum.)*
- **NFR-10 · Data portability.** One-click export/backup of an account's full data.

## 16. Success Metrics & Counter-metrics

_Free community tool → success is adoption + value delivered, not revenue._

- **North star.** Families running their *whole* process in-app — **weekly-active parents filing
  items**.
- **Value moments.** Duplicate / already-dated catches **confirmed**; **% of resumes captured via
  channels**; **reference calls logged per suggestion**; time-to-file an inbound resume.
- **Adoption.** **Activated families** (≥1 child + ≥1 suggestion); **4-week retention**;
  **referrals** (it's meant to be shared).
- **Counter-metrics (guardrails).** Cross-account data leaks = **0**; mis-routed channel items =
  **0**; **false-positive duplicate-flag rate low** (don't cry wolf); child **"felt surveilled"**
  reports (dignity); **AI-extraction correction rate** (trust in auto-parse).

## 17. Epic List (build sequence — all in first-release scope)

_Epics order the build; they are **not** scope gates. Privacy behaviour (PRV-1…12) is an acceptance
criterion within every epic._

1. **Foundation & multi-tenant auth** — fork Atomic CRM scaffold; accounts; **parent + child (+
   helper / self-manager) roles, RBAC, row-level security**; passwordless auth; dual-surface shell;
   multi-child setup; dashboard shell; privacy foundations (tenant isolation, encryption,
   export/delete).
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
   address, CC/forward, auto-forward), WhatsApp share-target, shared SMS + sender-lookup.
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

---

## Roadmap — Phase 2 (next after v1)

- **Shadchan interface (Phase 2 — near-term, not long-term).** A shadchan-facing surface where
  shadchanim **interact with parents**, **redd shidduchim** (send suggestions directly into a
  connected parent's pipeline), and **track their own conversations**. **v1 stays parent-side**
  ("not a shadchan tool" on the landing page); because Phase 2 is close, the architecture is
  **provisioned for it now** (shadchan as a first-class user/role; in-platform suggestion
  origination; per-relationship consent-based scoping — see addendum). **Privacy wedge holds:** a
  shadchan sees **only** the interaction/suggestion thread they are party to — **never** the
  parent's private notes, references, dating history, other shadchanim's suggestions, or the
  child's data. PRV-2's "no networked pool" is preserved (consent-based messaging, not DB exposure).

## Deferred / Revisit later

- **Native iOS wrapper** — a thin native shell (e.g. a Share Extension) giving iPhone users true
  1-tap WhatsApp → MyShadchan capture. Deferred (stay pure-PWA for now); revisit if the iPhone
  segment proves large and the email-share path too clunky.

## Open Items (running)

- **Persona blanks** — Chani's community/city and number of children (minor; fill anytime).
- **Confirm** — FR34 "progressed" definition; the §7 grouping (both flagged for your glance).

---

## Status

All sections drafted — Vision · UJ-1/UJ-2 · FR1–63 · PRV-1–12 · NFR-1–10 · Metrics · Epics 1–11.
**Next: Finalize** (memlog audit · input reconciliation · reviewer gate · triage · polish).
