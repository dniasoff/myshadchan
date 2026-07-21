# Finalize-Gate Review — Billing (§16) + Source-Available Licensing change

**Scope:** ADVERSARIAL review of ONLY the change that added (a) the freemium cost-recovery AI
billing tier (§16, FR71–76, NFR-11, R7, A4, Epic 12, PRV-6/PRV-12 edits, metrics edits) and (b) the
FSL-1.1-ALv2 source-available license over the MIT-licensed Atomic CRM fork. Pre-existing content
was not re-litigated.

**Files reviewed:** `prd.md`, `addendum.md`, `LICENSE` (FSL), `LICENSE.md` (upstream MIT).

## Gate verdict: **MINOR-GAPS**

No hard contradiction, no broken cross-reference, no ID collision, no accidental core-value paywall,
and the licensing construction is coherent. The core guarantees introduced by the change all hold:
free core, server-side entitlement, no data loss on downgrade, Stripe disclosed as sub-processor,
child login excluded from billing, wedge never paywalled. What remains are **billing-lifecycle
omissions a thorough PRD should at least name** (dunning, refunds, tax, trial-abuse, currency) and a
few **boundary/clarity** issues. None blocks finalization for a $2/mo cost-recovery tier; all should
be logged for the architecture/epics phase.

---

## 1. Contradiction — does any text still imply the WHOLE product is free / no monetisation?

**No hard contradiction.** Every monetisation statement is qualified, and §16/FR71 are explicit that
only generative AI is paid. Two skimmable-but-qualified headlines are worth a light touch:

- `prd.md`§1 line 69 — the **bold** lead "**Free to use, funded at cost, not for profit.**" reads as
  whole-product-free to a skimmer; it is corrected in the very next clause ("only the AI-powered
  features … require a … subscription"). **Low.** Consider "**Free core**, funded at cost…" to match
  the accurate one-liner at line 13.
- `prd.md`§18 line 470 — "A free-to-use community tool" — same pattern, immediately qualified by "the
  AI tier must cover its own cost." **Low.**

No unqualified "no monetisation" / "not revenue" / "never charge" claim exists. The old positioning
was fully reconciled.

## 2. Paywall-boundary consistency (only generative AI paid; wedge + manual entry FREE)

**Largely consistent and well-guarded.** The boundary is stated in §16 intro, FR71, the §13/§14
paid-headers, UJ-1 step 2 ("the duplicate catch in step 4 works either way"), the §18 counter-metric
("free-core users blocked from core value = 0 — the wedge never sits behind the paywall"), and Epic
12 (gates **only** Epic 5 auto-parse + Epic 10 AI assistant, leaving Epic 2 manual entry and Epic 4
dedupe free). UJ-1 (core loop), the dedupe FRs (FR10–13), search/dashboard (FR53–54), reminders,
sharing, multi-child, and child login are all free. **The wedge is genuinely free** because FR11
matching runs on manually-entered identity fields, not only on parsed ones.

Issues:

- **`prd.md` FR42 (§8) ↔ FR20 (§3.5) — repeat-reference recognition routed through PAID parse.**
  `MED.` §14's header promises "Core reference tracking (§8) … stays free," and FR42
  (repeat-reference recognition) sits in §8 — yet FR42 line 328 describes the mechanism as
  "auto-linked **at parse time**, FR20," and FR20 is an **auto-parse (paid)** function. As written, a
  non-paying user who **manually** adds a reference has no stated path to repeat-reference
  matching/dedup against their reference book. This risks downstream (architecture/epics) gating a
  §8-free feature behind paid auto-parse. **Fix:** state that reference↔reference-book matching runs
  on manual entry too (free); auto-parse merely performs it automatically at parse time.

- **`prd.md` §3.5 (FR19–21) lack the paid/free-fallback marker that §13 and §14 carry.** `LOW.`
  §3.5 "Auto-parse Extraction (references → contacts)" IS auto-parse (paid per FR71) but sits inside
  the "Core Loop" section and carries no "paid AI; manual entry free" annotation (unlike FR6, §13,
  §14). A reader could mistake reference extraction for free core. **Fix:** add a one-line
  paid-AI/manual-free note to §3.5, mirroring §13/§14.

No FR, journey, NFR, or epic accidentally paywalls the core value.

## 3. Billing completeness — items a PRD should at least name

**Covered well:** downgrade/data-retention behaviour — FR75 explicitly "no data is lost or hidden"
when inactive or rate-limited, core + manual stay available (so previously-parsed resumes and
generated dossiers remain **visible**, only new generation stops); cancellation implied via
Stripe-managed subscription (status `canceled` in the data model); receipts (FR73 "email receipts
reach phone-less users"); billing accessibility for phone-less/non-technical (FR73 desktop/email, no
smartphone — NFR-2; R7 acknowledges Stripe friction).

**Named-but-under-specified / unnamed (gaps):**

- **Dunning / `past_due` behaviour — `MED`.** The data model (`addendum.md` line 76) includes a
  `past_due` subscription status, but **no FR defines the behaviour**: does AI lock immediately on a
  failed payment, or is there a retry/grace window and dunning email before FR75 degradation kicks
  in? FR72/FR75 only describe trial-end and "inactive." **Fix:** add one line to FR75 (or a new
  sub-point) defining the `past_due` grace/retry policy before AI locks.
- **Refunds — `MED` (as part of the lifecycle cluster).** Not mentioned anywhere. Even a "no refunds;
  cancel anytime, access runs to period end" line closes it. **Fix:** name a refund/cancellation-timing
  stance in §16.
- **Tax / sales tax — `MED` (cluster).** US SaaS sales tax is state-dependent; unmentioned. A "prices
  shown may exclude applicable tax; handled via Stripe Tax" note suffices at PRD level. **Fix:** name it.
- **Trial abuse (repeat free trials per family) — `MED` (cluster).** FR72 ties the 14-day trial to
  "first AI use" per **account**, but nothing deters a family from creating multiple accounts (or
  delete/recreate) to renew the trial. **Fix:** name the anti-abuse stance (e.g. trial bound to
  verified email/account identity; one trial per family).
- **Currency — `LOW`.** "~$2/mo" implies USD (US product) but is never stated. **Fix:** state USD.
- **Invoices for a non-profit — adequately handled.** Because "non-profit" is only an operating stance
  (not a 501(c)(3) — addendum line 122–124), donation/tax-deductible receipts are N/A; plain email
  receipts (FR73) suffice.

## 4. Privacy / security of billing

**Strong.** All four required properties are present:

- **Stripe disclosed as sub-processor (PRV-6):** yes — `prd.md` line 238–240 ("Payment processing
  uses Stripe (a disclosed sub-processor); card data lives only with Stripe … never card numbers").
- **Server-side entitlement:** yes, repeatedly — §16 intro line 415–416 ("enforced server-side (not
  just in the UI)"), FR71, NFR-11 ("entitlement-gated and rate-limited server-side"), addendum line
  63–64 ("enforced server-side (RLS / edge, not just UI)").
- **Billing excluded from child/candidate login (PRV-4):** yes — FR73 line 428 ("The child/candidate
  login never sees or manages billing (PRV-4)").
- **Card data never on our servers:** yes — FR73 + PRV-6.

Residual, lower-severity:

- **RLS on the new `subscription` / `ai_usage_meter` tables not stated explicitly. `LOW–MED`.** The
  addendum data model says the subscription is "managed by parent/admin only," and PRV-3 is a blanket
  "tenant isolation at the database (RLS)," so it is covered by principle — but neither §16 nor the
  addendum explicitly states these new tables are RLS-scoped to the account **and** unreadable by the
  child role. For a security-sensitive gate, name it. **Fix:** one line — subscription + usage tables
  are RLS-scoped per account, readable/writable by parent/admin only, never the child role.
- **Helper role billing permission unspecified. `LOW`.** FR73 names "parent/admin" as the manager;
  whether the `helper` role can view/manage billing is not stated. **Fix:** state that helper cannot
  manage billing (or can view-only).
- **Webhook authenticity** (signature verification) is an implementation detail flagged in the
  addendum; not a PRD-gate concern. Per `.claude/rules/security-triggers.md`, the Epic-12 billing +
  RLS work should route through a security review at build time.

## 5. Licensing soundness

**Coherent as written.**

- **FSL + retained upstream MIT (fork) construction is sound.** MIT permits sublicensing, so the
  combined work can ship under FSL provided the upstream MIT notice is retained. That is exactly what
  is implemented: `LICENSE` (FSL-1.1-ALv2, © 2026 Daniel Niasoff) governs MyShadchan as a whole and
  its own contributions; its "Third-Party Software" appendix (lines 109–116) points to the retained
  Marmelab MIT notice in `LICENSE.md`; `LICENSE.md` carries the verbatim MIT text (© 2024-present
  Francois Zaninotto, Marmelab). `addendum.md` lines 116–119 describe this correctly. Two-root-files
  structure matches the open item at `prd.md` line 585–586.
- **"open source" is NOT misused.** The phrase appears only in the addendum's terminology-honesty
  guards (lines 105, 121), each stating the product is source-available and **not** OSI "open source,"
  and instructing landing copy to say "source-available." The 2-year auto-flip to Apache-2.0 is
  described as the future OSS state, which is accurate. `prd.md` line 73 "converts to a permissive OSS
  license over time" refers to that future Apache-2.0 state — accurate, though "over time" is vague.
- **No positioning/landing statement contradicts source-available + non-compete.** The privacy-wedge
  "no pooled/public database" claims are about **data**, not code, so they do not conflict with
  publishing source. R7 correctly cites FSL as the anti-clone protection for the cost-recovery model.

Lower-severity notes:

- **`addendum.md` line 112–113 "full … self-host rights" is slightly over-broad. `LOW`.** Under FSL,
  self-hosting for **internal use** is a Permitted Purpose, but self-hosting to run the software **as a
  service for other families** would likely be a "Competing Use" (offering substantially similar
  functionality). **Fix:** qualify as "self-host **for their own use**."
- **`prd.md` line 73 "converts to a permissive OSS license over time." `LOW`.** Pair with the specific
  mechanics ("Apache-2.0, two years after each release") so it does not read as an imminent full-OSS
  flip.
- **Public "non-profit" branding without a legal entity. `LOW`.** The doc consistently uses
  "non-profit" as an operating stance and the addendum explicitly disclaims entity formation and defers
  to counsel — good. Ensure landing copy says "operated at cost / not-for-profit **stance**," not "a
  non-profit," to avoid a marketing-claims risk. (Already flagged "confirm with counsel," §4 / addendum.)

## 6. Metrics coherence

**Coherent and non-contradictory with the "not profit" framing.**

- The new **Sustainability** metric (§18 line 479–481: trial→paid conversion; share of AI cost
  recovered; AI cost per active family) is explicitly a **floor** ("to keep the lights on — never a
  revenue target"), consistent with "Success is not profit" (line 471) and the cost-recovery framing.
  Measuring conversion is a means to cost-recovery, not a growth/profit target — no contradiction.
- The new **counter-metric** "paywall friction — free-core users blocked from core value = 0" (line
  484–485) is a strong guard that reinforces the §2 paywall boundary; "trial-end churn watched" is the
  complement of trial→paid conversion, not a contradiction.
- Minor: "share of AI cost recovered" has no defined threshold of what counts as sustainable (100%?),
  but the doc defers all numeric targets to a post-baseline pass (line 487). Acceptable. **LOW/none.**

## 7. Structural integrity

**Clean.**

- Section numbering is a clean **1..19**, in order, no skip/dupe (verified: headings at lines 47…492).
- New IDs are unique and well-formed: **FR71–FR76** (continue a gapless FR1–76 run), **NFR-11**
  (after NFR-1–10), **R7** (after R1–6), **A4** (after A1–3). No collisions.
- Every §-cross-reference resolves. The nine "§16" citations all point to Billing; §13→Auto-parse,
  §14→AI assistant, §3.3→Dedupe, §8→References, §15→Child login, §4→Privacy, §5→Channels, §7→Detail,
  §9→Reminders, §3.2→Inbox, §1→Vision all correct. No dangling "§17/§18/§19" citations exist (those
  numbers appear only as headings, which is fine).
- The Status line (line 592) "FR1–76 · PRV-1–12 · NFR-1–11 · Epics 1–12" matches the actual counts.
- **Epic 12 vs the FR set — mostly consistent, one omission. `LOW`.** Epic 12 reflects FR71
  (entitlement gating), FR72 (trial→subscription), FR73 (parent-only, Stripe), FR74 (metering + rate
  limits), FR75 (graceful degradation). **FR76** (the cost-recovery **transparency UI**: what's
  free vs paid, usage vs limit, non-profit rationale) is not explicitly reflected in Epic 12 or the
  Epic 11 landing page. **Fix:** add "billing transparency UI (FR76)" to Epic 11 or 12.
- Minor: **trial start timing.** FR72 pins the trial to "first AI use," while the addendum's
  `subscription` model has `trialing` status + `trial_ends_at`; when that row is created (signup vs
  first AI use) is left ambiguous for downstream. **LOW.** Worth a one-line clarification in the data
  model.

---

## Consolidated fix list (ranked)

1. `MED` — Define `past_due`/dunning behaviour (grace/retry before AI lock) — FR75 / addendum.
2. `MED` — Clarify FR42 repeat-reference recognition is free on manual entry, not only paid parse (FR20).
3. `MED` — Name refunds, tax/sales-tax, and trial-abuse (repeat-trial) stances in §16.
4. `LOW–MED` — Explicitly RLS-scope `subscription` + `ai_usage_meter` tables to parent/admin, exclude child.
5. `LOW` — Add paid-AI/manual-free marker to §3.5 (FR19–21); state currency (USD); specify helper billing rights.
6. `LOW` — Soften "Free to use" bold headlines (§1, §18) to "Free core"; add FR76 to an epic; qualify
   "self-host for their own use" and "non-profit stance" in addendum; pin the 2-year Apache flip
   mechanics beside "OSS over time."
