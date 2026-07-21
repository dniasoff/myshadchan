# PRD Quality Review — MyShadchan.space (2026-07-21)

_Independent rubric review of `prd.md` + `addendum.md`. Tough-but-fair. Organised by the 8 rubric
points; every finding carries a section/FR anchor and a one-line fix._

## Gate verdict: **MAJOR-GAPS**

Not because the doc is weak — it is above-average: all core sections present, UJ-1 traces cleanly,
privacy is genuinely first-class, and the counter-metrics are unusually thoughtful. The gate is
MAJOR-GAPS because four items need *decisions or new content*, not polish, before this is a reliable
build spec:

1. The "no networked database" wedge vs the Phase-2 shadchan interface — the reconciliation holds to
   the letter but not the spirit, **and** the v1 architecture it mandates (shadchan role) is absent
   from every v1 scope artifact (Epic 1 / PRV-4 / FRs). [rubric 5, 7]
2. UJ-2 (the entire single's experience) has **zero functional requirements** — a first-class
   journey and a whole epic (Epic 9) with no testable FR behind them. [rubric 3]
3. No Risks/Assumptions section for an 11-epic, 63-FR "all-in-v1" whose epics are explicitly "not
   scope gates" — the de-scoping lever is removed with the delivery risk unacknowledged. [rubric 4, 8]
4. PRV-2's "hard-delete that truly purges (backups + third parties)" over-promises on the
   load-bearing privacy claim. [rubric 4, 5]

Severity roll-up: **1 CRITICAL, 4 HIGH, ~9 MEDIUM, ~3 LOW.**

---

## 1. Completeness

**Strong.** All core sections present and mostly substantive: Glossary, Vision (§1), Persona +
UJ-1/UJ-2 (§2), FR1–63 (§3–14), NFR-1–10 (§15), PRV-1–12 (§4), Metrics (§16), Epics 1–11 (§17),
Roadmap, Deferred, Open Items. Privacy is a dedicated pillar rather than an afterthought.

- **[HIGH] No Risks/Assumptions section anywhere.** For an "all-in-v1" of this size the absence is a
  completeness gap, not just a scope one (see rubric 4/8). — *Fix: add a Risks & Assumptions section
  carrying the load-bearing bets and their mitigations.*
- **[MEDIUM] No consolidated Non-Goals section.** Positioning-critical exclusions ("not a
  matchmaking engine," "not a shadchan tool," no web-scraping, reference-analytics dropped, no phased
  MVP) are scattered across header/§1/FR63/§8. — *Fix: add a single Non-Goals list; positioning this
  central deserves one anchor.*
- **[LOW] "Content-complete" (line 27) with open TBDs.** Persona `[community/city — TBD]` and
  `[# — TBD]`, plus two "Confirm" items, remain open. — *Fix: soften to "content-complete pending
  Open Items," or close the blanks.*
- **[LOW] FRs carry no acceptance criteria** though §4 asserts "every feature ships with its privacy
  behaviour specified (as acceptance criteria)." The ACs are claimed but not present. — *Fix: state
  that ACs are produced downstream, or stop implying they already exist.*

## 2. Requirement quality

Most FRs are well-formed, testable capabilities (FR7, FR11, FR14–16, FR40, FR47–49 are exemplary —
concrete and verifiable). Two systemic issues:

- **[MEDIUM] Implementation detail leaks into FRs, contradicting the doc's own rule** ("Tech
  choices… live in the addendum, not here," line 135). Offenders: **FR6/FR19/FR21/FR55/FR56**
  ("OCR + LLM," "extraction via an LLM to a fixed JSON schema"), **FR28** (names **Twilio**),
  **FR22** ("parsed via **webhook**"), **FR29** (leaks the data-model field **`account_phone`**). —
  *Fix: restate as capabilities ("auto-extracts identity fields," "a shared inbound SMS number,"
  "inbound email is ingested and attributed") and move vendor/mechanism names to the addendum.*
- **[MEDIUM] Unmeasurable NFRs.** **NFR-4** "feel instant on add," **NFR-1** "feel effortless,"
  **NFR-5** "graceful handling" have no thresholds. — *Fix: attach numbers (e.g. capture→Inbox p95
  < Xs; dedupe result < Ys) so they're testable.*
- **[LOW] FR34 "progressed" undefined** (self-flagged in Open Items). — *Fix: define "progressed =
  reached Look-into or Decision" inline and remove the open item.*
- **[LOW] FR61** ("consensus, contradictions, gaps") is fuzzy to test. — *Fix: specify the minimum
  outputs that constitute a pass (e.g. lists agreements, disagreements, and named un-asked topics).*

## 3. Traceability

- **[HIGH] UJ-2 has no FRs.** Every beat of the single's experience — curated live-only view,
  "anything new for me" indicator, flag *interested / not-for-me / want-to-know-more*, private
  note/question to the parent, set-preferences-once, reference-diligence-at-a-distance — maps only to
  **PRV-4** (a privacy requirement, as prose) and **Epic 9**. There is no FR for child login, the
  curated view, child input, or child preferences. Epic 9 therefore references capabilities that no
  FR defines. — *Fix: add an FR group "§ The single's experience (FR64…)" enumerating child-view,
  input actions, private notes, and preferences; wire Epic 9 to it.*
- **[MEDIUM] The "middle of the process" is undramatised.** Whole FR groups have no journey beat
  exercising them: **reference-calling (FR40–42)**, **resume-sharing (FR47–49)**, **AI assistant
  (FR59–62)**, **reminders (FR44–46)**. UJ-1 is capture/dedupe; UJ-2 is the child. Nobody in a
  journey actually works a reference, shares a resume, or uses the assistant. — *Fix: add a short
  UJ-3 "due-diligence loop" (call references → capture → assistant summary → decision → optional
  share) so the largest untested FR groups have narrative traceability.*
- UJ-1 → FR traceability is otherwise tight (capture FR1–3/27; parse FR6/55–57; check FR10–11;
  catch FR12–13; file FR7/14–17; record FR13/18). No orphaned UJ-1 beats. Good.

## 4. Scope coherence & risk

- **[HIGH] "All-in-v1" + "epics are not scope gates" removes the only de-scoping lever, and the
  risk is never surfaced.** The first release ships multi-tenant RLS/RBAC, dual-surface PWA+desktop,
  child logins, 3 ingestion channels (email CC/forward/auto-forward, WhatsApp share-target, shared
  SMS + sender-lookup), full OCR+LLM auto-parse incl. reference extraction, bilingual Heb↔Eng
  identity matching, dating-history dedupe, reminders, revocable sharing, multi-child, **and** an AI
  assistant — for a free product. There is no Risks section, no MVP fallback, no dependency-risk
  note. — *Fix: add a Risks section; either designate a cuttable inner ring or explicitly accept the
  all-in delivery risk in writing.*
- **[HIGH] PRV-2 over-promises: "hard-delete that truly purges (backups + third parties)."**
  Truly purging from immutable/rolling backups and every sub-processor (OCR, LLM, email, SMS relays)
  on demand is operationally very hard to guarantee, and it's a *load-bearing* claim for a
  privacy-wedge product. — *Fix: reword to "delete removes data from live systems immediately and
  from backups within the retention window; sub-processor purge is requested per contract" — promise
  what you can enforce.*
- **[MEDIUM] The hardest technical bets aren't flagged as risks:** Heb↔English fuzzy identity
  matching (the UJ-1 "magic," NFR-6/FR11) and auto-parse accuracy on wildly varied bilingual resumes
  (FR6/56). Both are asserted; only the downstream counter-metric ("false-positive rate low") hints
  at the risk. — *Fix: list both as explicit risks with a fallback (manual-first if confidence low).*
- **[MEDIUM] Free + no-monetisation + intended-viral + real per-user cloud costs has no
  sustainability model.** NFR-9 asserts costs "must be bounded and sustainable" but gives no
  mechanism or funding answer. — *Fix: state the funding/sustainability stance (grant, donation,
  cost ceiling per family, throttle) rather than asserting sustainability.*

## 5. Privacy/security rigor

PRV-1–12 are mostly internally consistent and unusually thorough (RLS at DB, opt-in-not-out,
sub-processor disclosure, no-training contracts, dignity floor in PRV-4, voluntary purge in PRV-11).
The critical question — does the Phase-2 shadchan interface contradict the wedge? — resolves as
**partly**:

- **[CRITICAL] The Phase-2 reconciliation holds to the letter but not the spirit, and the v1
  provisioning it mandates is missing from v1 scope.**
  - *Letter:* the addendum's guarantee (a shadchan sees only their own thread; no family-A→family-B
    leakage; "consent-based messaging, not database exposure") genuinely differs from a pooled public
    DB, so parent-to-parent isolation (PRV-2) can be preserved.
  - *Spirit:* a shadchan who connects with many families accumulates a **cross-family view inside the
    same system** — the addendum itself calls it "a lightweight CRM on the shadchan's side." That is
    a networked, two-sided aggregation of exactly the kind the wedge ("no networked database," "not a
    shadchan tool," "the pillar the whole product is built on") is marketed against. The
    reconciliation addresses parent↔parent leakage but not the fact that the product *becomes* a
    two-sided network with third parties holding cross-family data.
  - *Concrete v1 contradiction:* the addendum mandates the shadchan role be "designed into the
    RLS/RBAC model from v1… without rework," yet **Epic 1** (line 408) and **PRV-4** (line 214) list
    only parent/child/helper/self-manager — **no shadchan role**, and no FR provisions in-platform
    suggestion origination. So it is either silent v1 scope creep (contradicting the capability-level
    PRD) or Phase 2 will need the rework the addendum says it won't.
  — *Fix: pick one and write it down — (a) drop the absolutist "no networked database"/"not a
  shadchan tool" language in favour of "your data is never pooled or exposed to other families," and
  (b) either add the shadchan role + suggestion-origination provisioning to v1 Epic 1/PRV-4 as
  explicit scope, or state plainly that Phase 2 accepts schema rework.*
- **[MEDIUM] 18+ relies on self-affirmation in a parent-manages-child product with child logins**
  (PRV-12 vs UJ-2 "Rivky, Chani's daughter"). Candidates sit right at the age boundary; a signup
  checkbox is thin COPPA insurance. — *Fix: note the residual risk and add "counsel to confirm
  self-attestation is sufficient" (the doc already defers legal specifics — extend it here).*
- **[MEDIUM] Field-level encryption for photos (PRV-10) is undercut by PRV-6 (photos sent to
  OCR/LLM) and FR48 (photos rendered into share links).** The at-rest guarantee is real but partial;
  the doc reads as if encryption fully protects photos. — *Fix: state that encryption covers at-rest
  storage and that processing/sharing decrypts under sub-processor/no-training controls.*
- **[MEDIUM] SMS sender-ID spoofing not addressed.** PRV-7/FR30 handle an *unrecognised* sender
  (unattributed queue) but not a *spoofed recognised* sender — SMS caller-ID is forgeable, and
  routing is by matching `account_phone`, so a spoof could inject into a real account. — *Fix: add a
  requirement that SMS attribution is treated as low-trust (confirmation before it affects a
  suggestion), or verify via a challenge.*
- **[LOW] "Truly purges" + shareable photos/links is self-limiting:** a recipient can screenshot a
  watermarked, expiring photo, which no purge (PRV-11) can recall. — *Fix: acknowledge that sharing
  controls reduce, not eliminate, downstream copies.*

## 6. Success metrics

Directionally strong; the **counter-metrics are the best part of the doc** — cross-account leaks = 0,
mis-routed = 0, false-positive dup-flag rate, "felt surveilled" reports (dignity), extraction
correction rate. These guard the product's real failure modes rather than being generic.

- **[MEDIUM] No numeric targets or baselines anywhere.** "Weekly-active parents," "4-week
  retention," "referrals" have no thresholds, so none is yet measurable in the SMART sense. — *Fix:
  attach launch targets even if provisional (e.g. WAU filing ≥ X, W4 retention ≥ Y%).*
- **[MEDIUM] Two counter-metrics lack a measurement instrument.** "False-positive duplicate-flag
  rate **low**" needs a numerator/denominator and a target; "**felt surveilled** reports" needs a
  capture method (survey? support tag?). — *Fix: define the formula and source for each.*

## 7. Internal consistency

The doc is careful — several things that could have been contradictions are actually handled well:

- **Clean:** age/height are explicitly dropped from matching but retained as info fields (FR11 /
  FR55 / addendum index all agree — *not* a contradiction). The anti-scrape stance is consistent
  throughout ("never reads your accounts," FR26/FR27/FR63 — no ingestion path implies scraping).
  "Not a matchmaking service" vs dedupe/AI is cleanly held by FR63's hard invariant.

Genuine tensions:

- **[HIGH] Epic 1 / PRV-4 roles vs addendum shadchan-role mandate** — see rubric 5 (CRITICAL). This
  is also a plain consistency defect between the PRD body and its own addendum. — *Fix: reconcile the
  role list in one place.*
- **[MEDIUM] "Mobile-first" (NFR-1) vs "dual first-class / parity" (header line 20, NFR-2).** The
  primary-capture concern is actually the *phone-less* user, yet NFR-1 leads with "mobile-first." The
  intent is reconciled in prose but the vocabulary conflicts. — *Fix: pick one framing — "dual-surface,
  no core action requires a smartphone" — and make NFR-1 a sub-point of it.*
- **[MEDIUM] Photos highest-sensitivity (PRV-1) vs shareable (PRV-5/FR48) vs "truly purges"
  (PRV-2).** Reconciled via controlled links, but the purge promise and screenshot reality remain in
  tension (see rubric 5). — *Fix: as above, soften the purge claim.*

## 8. Honesty of open items / [ASSUMPTION] tags

Good hygiene on the *small* stuff: explicit deferrals (native iOS wrapper; deep site integration;
reference analytics "dropped"), two "Confirm" items, and persona `[TBD]` blanks are all flagged. But
there are **no `[ASSUMPTION]` tags**, and the *load-bearing* bets are stated as settled facts:

- **[HIGH] Big assumptions asserted, not flagged:** (a) auto-parse is accurate enough on bilingual,
  photographed resumes to be trusted (FR6/56); (b) Heb↔Eng identity matching is accurate enough to
  catch dups without crying wolf (FR11/NFR-6); (c) the free model stays cost-bounded (NFR-9); (d)
  Phase 2 is buildable "without rework" (addendum) despite no v1 provisioning; (e) non-technical
  parents will adopt the forward/CC/share-target capture habit; (f) 18+ self-attestation suffices;
  (g) "truly purges backups + third parties" is achievable. — *Fix: tag each as an explicit
  `[ASSUMPTION]` with a validation/mitigation, ideally inside the new Risks section.*
- **[LOW] "Provisioned for it now" (§1, roadmap) reads as settled but is unbudgeted.** The
  architectural cost of shadchan-role provisioning isn't in any epic. — *Fix: either scope it or mark
  it as an assumption to validate in `bmad-architecture`.*

---

## What's genuinely good (so it isn't lost in edits)

- UJ-1 → FR traceability is tight and the "have I seen him before" loop is crisp.
- Privacy is a real first-class pillar, not a checkbox; PRV-4's dignity floor and PRV-11's voluntary
  purge show unusual care for the non-consenting data subject.
- Counter-metrics are product-specific and honest about the product's own failure modes.
- Deferrals and "dropped" scope are stated plainly; the glossary is clear; age/height-drop and the
  anti-scrape stance are handled consistently where a weaker doc would have contradicted itself.

_Bottom line: a strong, above-average PRD that is **close**, but not yet ready to hand to
architecture — resolve the wedge/Phase-2 decision, give UJ-2 real FRs, add a Risks/Assumptions
section, and dial back the delete over-promise._
