# Phase-1 Completeness Audit — 2026-08-09

What is left between the tree at `e3b2e69` and the product the PRD describes.

This is not a status roll-up of the story files. Story `Status:` headers in
`_bmad-output/implementation-artifacts/` are demonstrably stale — most say `review` for work
that shipped weeks ago, `11-4` says `in-progress` for code that landed in `895d435`, and two
ledger items below are recorded as *dropped* or *unowned* for work that is **shipped**. This
repo already has two standing rules about believing a written claim over a checked one
(`.claude/rules/gate-verification.md`, `.claude/rules/migration-guard-integrity.md`). This audit
follows them: every gap below was checked against the tree, and the check is cited.

**Method.** PRD FR1–FR78, PRV-1–12, NFR-1–13 and §16 billing, plus Amendment A2's FR79–FR119, read
against `supabase/schemas/`, `workers/`, `src/`, `.github/workflows/deploy.yml` and the route
manifest. Where a requirement is partly built, the audit states which half.

---

## Summary

| | Count |
|---|---|
| Epics closed and holding | 1, 2, 3, 4, 6, 8, 9, 10, 11 |
| Epics with a single open story | 5 (5.12), 7 (7.5's send half) |
| Epic code-complete, operationally unproven | 12 |
| Epic specification-only | 13 |
| **Requirements with no owner at all** | **19** (below) |

The nineteen unowned requirements are not polish. Four of them are the reason the product cannot
legally or practically be opened to a real user: there is no privacy policy, no terms, no
sub-processor disclosure, and no working deletion — in a product whose stated core wedge is
privacy and data ownership (PRD §1, PRV-2).

---

## A. Epic 12 — the three unobserved items, unchanged

Epic 12's own text already says this and it is upheld. Recorded here only to keep one list.

| Item | State |
|---|---|
| 12.2 AC-10 — a reminder email arriving at a real inbox | Never observed |
| 12.4 AC-14 — a signed Stripe event reaching the running webhook and writing `subscription` + `stripe_events` | Never observed |
| Live-mode billing | Does not exist. Product `prod_V1bIMx10dzcDFB` and both prices are **test mode**; live mode needs its own product, prices, webhook endpoint and six secrets |

The nineteen findings of `epic-12-adversarial-review-report-2026-08-07.md` were closed in
`f45afb4`, `6a50a25` and `14cc3c3` — including the two that were mishandling money (a test-mode
event granting production entitlement; a `single`-role user able to pay for entitlement RLS denies
them). Those fixes are **code**, and the same distinction the review itself drew applies to them:
code landing is not the same event as behaviour observed.

---

## B. Billing — §16 is half-built, and the missing half is the conversion mechanism

Story 12.4 built checkout, the webhook, and the subscription lifecycle. Three §16 requirements
were never storied by anyone.

### B1 — FR72, the free trial, does not exist *(unowned)*

`ai_entitlement()` (`supabase/schemas/02_functions.sql:3528`) entitles on exactly
`plan = 'ai' and status = 'active'`. There is no trial concept anywhere in the decision, and the
`subscription` table cannot express one: its status check is
`status in ('active','lapsed','none')` (`01_tables.sql:979-1027`) with no `trialing` value and no
trial timestamp column. The `accounts.trial_end` column at `01_tables.sql:297` is one of the five
documented decoy columns E4 revoked and nothing reads (`06_grants.sql:821`).

So today an account's only path to AI is to pay first, having never seen it work. The PRD does not
merely permit a trial — FR72 specifies one ("free during a trial window, target 14 days from first
AI use"), FR77 asks for "one free trial per verified family", and R7's mitigation for the single
biggest adoption risk in the document names "a real free trial (§16)" as the thing that answers it.

### B2 — FR75's grace window does not exist *(unowned)*

FR75 requires a failed payment to enter "a grace/retry window (`past_due`) with reminders
**before** the AI features lock — not an instant cut-off."

`mapStripeStatus()` maps `past_due` → `lapsed` immediately (`workers/billing/subscriptionState.ts`,
asserted by `subscriptionState.test.ts:62-68` as "the AD-17 fail-closed ruling"). Entitlement
therefore stops on the first failed charge, and no dunning email is sent by anything. The
fail-closed instinct is right for *inference spend* and wrong for *a family whose card expired*;
FR75 asks for both, and they are reconcilable (see Story 12.6).

### B3 — FR77's policy surface is unbuilt *(unowned)*

Cancel-any-time / access-to-period-end / no-refunds / Stripe Tax / one-trial-per-family are named
PRD defaults. Nothing in `billing/` states any of them to the user, and Stripe Tax is not
configured. This is also a live-mode activation dependency (§C1).

### B4 — NFR-11's "tunable without a code change" is a hard-coded constant *(unowned, small)*

`ai_monthly_resume_limit()` is `select 100;`. Moving the allowance is a migration and a deploy.
The function's own comment already anticipates this — it is declared `STABLE` rather than
`IMMUTABLE` specifically "to reserve room for a future per-plan or per-account limit without
changing either caller's call shape". Folded into Story 12.6 as one criterion rather than given a
story: the important property is that the number keeps resolving in exactly one place, so
`ai_entitlement()` and `claim_ai_parse_attempt()` can still never disagree.

**Not a gap:** FR76's cost-recovery transparency is genuinely built — `billingPlans.ts` carries the
"run at cost, not for profit" framing and `UsageMeter.tsx` shows usage against the limit.

---

## C. Trust, compliance and data rights — nothing is built *(all unowned)*

This is the largest hole in the product and the one most out of proportion to its cost.

### C1 — No legal surfaces at all

`root/routeManifest.ts` registers ten paths; none is `/privacy`, `/terms` or anything like them.
`landing/landingLinks.ts` exports exactly three links (`/login`, `/register`, `#what`) — the public
landing page of a product handling health notes and photographs of minors' families links to no
privacy policy.

Consequences, in order of bite:
1. **Stripe live-mode activation** normally requires published terms and privacy URLs on the
   business's own site. B-items above cannot ship without this one.
2. **PRV-6** commits the product to *disclosing sub-processors*. The real list is Supabase,
   Cloudflare, Vercel, Resend, Stripe and Google (Gemini). It is disclosed nowhere.
3. **PRV-12** commits to a breach-notification process. None is written.
4. **PRV-2** promises export and deletion in the same breath as the privacy wedge. Neither promise
   is stated anywhere a user can read it.

### C2 — Deletion is a `mailto:` *(PRV-2)*

`settings/DeleteDataDialog.tsx` is honest about itself — its own comment says it "does not pretend
to delete anything on click" and opens a pre-filled email to `support@myshadchan.space`. That was
the right call at the time. It is not FR-complete: PRV-2 promises deletion "purges the **live
system immediately**, clears backups within the retention window, and instructs sub-processors to
delete per contract." Nothing does any of the three, and `AGENTS.md`'s inherited fork stance
("user deletion is not supported… use account disabling instead") is the opposite of what this
product sold.

### C3 — Export covers four resources and no files *(NFR-10, PRV-2)*

`settings/exportFamilyData.ts:4-9` — `EXPORT_RESOURCES = ["singles","shidduchim","shadchanim","references"]`.
Absent: notes and interactions, reference call logs (the diligence record — arguably the single
most irreplaceable thing in the account), date records, redts, resumes and every uploaded file,
tasks and reminders, threads and messages, medical notes, listings and share links. "One-click
export of an account's **full** data" is not what this is.

### C4 — PRV-11, the data subject's purge request, has no mechanism

The suggested single is in the CRM without ever having consented. PRV-11 makes a voluntary promise
to honour a removal request from them. There is no path — not a form, not a documented process,
not an internal tool. It is also the one privacy commitment that cannot be satisfied by an account
owner acting on their own data, because the requester is not a user.

### C5 — Shares are not per-recipient, and there is no watermark *(FR48, PRV-5, PRV-8)*

`share_links` (`01_tables.sql:1499-1521`) has `token`, `include_photo`, `expires_at`,
`revoked_at`, `created_by_member_id` — and **no recipient column**. The word "watermark" does not
appear anywhere in `src/`, `workers/` or `supabase/`.

FR48 and PRV-8 both specify *per-recipient*; PRV-5 specifies *"watermark + expiry available"*.
Epic 9 shipped revocation, expiry, the access log and the photo choice correctly; what is missing
is the axis that makes the first of those mean much. With one link for everybody, revoking cuts off
everybody, and `share_access_log` records that *somebody* opened it. Assigned to **Story 14.6**.

### C6 — PRV-10's field-level encryption is not implemented

`medical_notes` (`01_tables.sql:655`) stores plaintext; photos are ordinary objects in the
`documents` bucket. Supabase encrypts at rest at the volume level, which is not what PRV-10 says
("field-level encryption for the most sensitive fields (health, photos)"). This one deserves an
explicit owner decision rather than silent inheritance — see Story 14.5.

---

## D. Operational readiness — the product cannot tell you when it is broken

### D1 — No error tracking, no alerting, anywhere *(unowned)*

No Sentry, no Rollbar, no equivalent, in the SPA, the seven Workers, or the Edge Functions
(searched `package.json`, `workers/`, `src/`). The tracing that exists is
`workers/shared/requestTracing.ts` — request-id logging into Cloudflare's own log stream, with
nobody watching it and no retention beyond the dashboard's default.

Concretely: the reminder sweep and the Stripe webhook are the two paths where silence is
indistinguishable from success. The Epic 12 review's own finding — *"Settings can say 'Reminder
emails — Sending' while every email attempt is failing"* — was fixed in the UI, but there is still
no channel by which anyone learns that it happened.

### D2 — No product analytics; PRD §18 is unmeasurable *(unowned)*

The PRD names a north star (weekly-active parents filing items), four value moments, a
false-positive duplicate rate, and a child "felt surveilled" check, and states the measurement plan
depends on product analytics. None exists. Every launch metric in §18 is currently uncollectable.
(A privacy-respecting, first-party option is the only kind consistent with PRV-2/PRV-6.)

### D3 — S2: `FORCE ROW LEVEL SECURITY` is 7 tables of ~40, and AD-1's CI assertion was never written

The oldest open item in the ledger, twice re-dated ("before Epic 3", then "before or alongside
Epic 9's production rollout"), and both deadlines have passed. The counter-metric it protects is
the sharpest one in the PRD: **cross-account data leaks = 0**. Twenty-plus `SECURITY DEFINER`
functions run as `postgres`, which bypasses unforced RLS on every table it touches.

The cheap half — the CI assertion plus a justified allowlist — is a day's work and has been
described as such since 2026-07-26. It is still not done, and its absence is why nobody noticed
the count drifting.

### D4 — NFR-13 rate limiting covers one of five surfaces

`workers/shared/rateLimit.ts` protects `/parse` and `/dossier`. NFR-13 requires per-account **and
per-IP** limits on: the AI pipeline ✅, **auth / magic-link / invite** ✗, **channel ingestion** ✗,
**share-link access** ✗, and **signup** ✗. The only thing standing in for four of them is
Supabase's own `rate_limit_email_sent: 20` pinned in `deploy.yml:156`. Share-link access is the
one that matters most for the privacy wedge: a bearer token with no access rate limit is a
scrapeable surface, and PRV-8 sells exactly the opposite.

### D5 — Backups are unrehearsed; there is no runbook *(NFR-8)*

Supabase takes backups. No restore has ever been performed, so the recovery time is unknown and the
promise in NFR-8 is untested. There is no runbook for: a failed deploy, a stuck reminder queue, a
Stripe webhook outage, a leaked secret (S19's two credentials **still need rotating** — the SMTP
password and Google OAuth client secret were printed into retained Actions logs).

### D6 — S20 is closed; the honest limit it recorded is not

Checked, not assumed: `deploy.yml:265` now reads `needs: deploy-supabase`, and `trigger-frontend`
at `:632` needs both backend jobs. The three pipelines are serialized. **S20 should be marked
closed.**

What survives is the limit S20 itself recorded and no story owns: ordering removes "new code
against old schema" and does nothing about the reverse window (new schema, old code), which is
closed only by expand/contract migrations. Those are required for rollback anyway, and nothing in
the repo asserts that a migration is expand/contract — `make check-migration-safety` proves a
migration does not destroy data, which is a different property.

---

## E. The single's experience — UJ-2 is two-thirds built

Epic 6 delivered the access model (FR64, FR65, FR90–93) and Story 6.4 delivered FR66's input. Three
of PRD §15's seven requirements were never storied.

| FR | Requirement | State |
|---|---|---|
| FR64 | Own passwordless login | ✅ Story 6.1 |
| FR65 | Curated live view, never gut-rejections | ✅ Stories 6.2/6.3 |
| FR66 | Give input on a live suggestion | ✅ Story 6.4 (`interactions.kind = 'single_input'`) |
| **FR67** | **Set their own preferences, in their own words** | **✗ no table, no UI, no story** |
| **FR68** | **See that diligence is happening, at a dignified distance** | **✗ the opposite is built** |
| **FR69** | **A private space the parent cannot see** | **✗ partial only** |
| FR70 | Calm, low-pressure tone | ✅ by design throughout |

**FR68 is inverted, not merely missing.** The shidduch's `diligence` tab excludes the `single`
role outright — `shidduchim/entityDescriptor.tsx:134-138`, whose own comment reads *"Story 6.3
(AC 9): reference_links / references deny `single` at [the database]"* — and RLS empties the
underlying tables for that role, so hiding the tab is correct rather than cosmetic. That correctly
protects the candid words (PRV-4, Story 6.3) — but the PRD asks for the
*presence* of a dignified signal, "progress, not the candid reference content", and the single
currently sees nothing at all. A single who knows references are being called and sees "4 of 6
spoken to" is the requirement; a single who sees an absent tab is what shipped.

**FR69 is partial.** `shidduchim.visibility` has a `private_single` value and Epic 7's private
threads exist, so a single can hold a private *conversation*. What does not exist is the private
*space* — notes and preferences of their own, structurally invisible to the parent, which is what
PRV-4's "private both ways" and FR69 describe.

---

## F. Communication — FR100's send half is unbuilt

Story 7.5 is the only open story in Epic 7 and says so plainly in its own header: the DB/queue
layer, in-app unread, the privacy posture control and the push opt-in UI are wired; **the Resend
transport, the message sweep and the `scheduled()` wiring are not**. It deferred them to Epic 12's
gate G1, which is now discharged, and to 12.2's delivery mechanism, which now exists
(`workers/shared/resend.ts`, `workers/cron/sweepReminders.ts`).

So the blocker 7.5 named is gone and nothing has been scheduled against it. Today a message on a
thread notifies in-app only; FR100 requires in-app + email + push.

---

## G. Epic 5 — Story 5.12 (FR60) never started

Guided Call mode is `ready-for-dev` and has been since 2026-07-30. It is the only unbuilt story in
Epic 5, it is explicitly **not** paywalled, and it carries a delivery note (delete the dead
`Log a call (coming soon)` stub at `layout/MobileNavigation.tsx:184-186`, plus its
`Scan a resume` sibling) that goes stale the longer it waits.

---

## H. Two ledger entries are wrong — the work shipped

Recorded because a stale ledger is worse than no ledger: these two are the reason to re-check the
others rather than trust them.

- **S8 — "Postmark → Cloudflare Email Routing migration"** is marked open. It is **done**.
  `workers/ingest/index.ts` is a Cloudflare Email Worker with an `email()` entry point,
  `17fba3f` removed the Postmark webhook, and `supabase/functions/postmark/` no longer exists.
- **S9 — "FR22 per-account private inbound address ❌ DELIBERATELY DROPPED"** is marked dropped.
  It is **built**. `accounts.inbound_email_token` exists (`01_tables.sql:345`) with a
  `kind = 'household'` constraint, a 12-character token, and account resolution derived only from
  `message.to` (`workers/ingest/resolveAccount.ts`). S9's own text said "revisit only when S8
  lands" — S8 landed and it was revisited, but the ledger was not.

Both should be marked closed with the commits that closed them, and the `trusted_senders` /
`Needs-review` inbox tab work (`da457f0`, `db7e3b4`) recorded alongside.

---

## I. The unowned ledger, re-checked

| Item | Verdict now |
|---|---|
| S2 — FORCE RLS + AD-1 CI assertion | **Open**, oldest item, → Epic 15 |
| S3 — invite-token-at-rest posture split (raw uuid vs SHA-256) | **Open**, → Epic 15 |
| S6 — AD-8 observability / AD-17 rate limiting | **Partly closed** by 11.4 for the AI Workers; the rest → Epic 15 |
| S8, S9 | **Closed by shipped work** — see §H |
| S11 — `TaskDeliveryChannel` vs `MessageNotificationChannel` | **Open**, cheapest alongside 7.5's send half |
| S13 — server-side `current_member_role()` helper | **Mostly closed** — `02_functions.sql:316` defines it, RLS uses it (`:1612`), threads use it (`:4322`), and `f45afb4` added the billing guard on it. Retiring the client-side boolean in `canAccess.ts` is the residue |
| S15 — the MCP assistant still enumerates and creates references | **Open and live.** `supabase/functions/mcp/` still ships; this is RULING 7 violated by the deployed assistant while the human UI obeys it |
| S16 / S17 — RULING 7 waves B and C | **Open** |
| S19 — deploy gate + **two credentials still to rotate** | **Rotation open** — do not let this sit |
| S20 — `deploy-workers` races `db push` | **Closed** — `deploy.yml:265` has `needs: deploy-supabase`. Its recorded residue (expand/contract migrations, unasserted) → Epic 15 |
| S21 — three date formatters + one false docstring | **Open** |
| S22 — pluralization strings | **Open** |
| S26 — four dead exemptions in `retired-names.json` | **Open** |
| S27 — Hebrew / RTL UI | **Dropped by owner.** Note NFR-12 is formally unmet and the PRD still asserts it — the PRD should carry the amendment, not the epic ledger alone |

**One live question the ledger does not raise.** The French catalogue
(`providers/commons/frenchCrmMessages.ts`) is fork residue in a US Orthodox-Jewish product. It is
a tabled shared artifact that every wave adding user-facing copy has to write twice, for a locale
with no users. Either delete it (and take NFR-12's i18n scaffolding down to English-only, honestly
recorded), or keep it deliberately. It is currently kept by inertia.

---

## J. What this becomes

| Gap | Goes to |
|---|---|
| §A three unobserved items, live-mode billing | **Story 12.5** |
| §B1–B4 trial, dunning grace, billing policy, tunable limit | **Story 12.6** |
| §C legal, deletion, export, purge, per-recipient shares, encryption | **Epic 14 — Trust, Compliance & Data Rights** |
| §D observability, analytics, RLS force, rate limits, backups/runbook, ledger sweep | **Epic 15 — Run It For Real** |
| §E FR67/68/69 and §F FR100's send half | **Epic 16 — The Single's Own Space & Message Delivery** |
| §G Story 5.12 | Stays in Epic 5, unblocked, schedule it |
| §H stale ledger entries | Corrected in `epics.md` in the same edit as this audit |

Epic 13 is unchanged in scope by this audit and blocked on its own fifteen product decisions; see
`epic-13-open-decisions.md`, which this round gives a shippable default per decision so the epic
can move without pre-empting the owner.

**Launch-blocking subset, in order:** 12.5 → 14.1 (legal surfaces — 12.5's live-mode activation
depends on it) → 15.3a (the RLS CI assertion) → 15.4 (rate limits on the four open surfaces) →
12.6. Everything else is real but not gating.

---

## K. Coverage after this round

Every requirement in the PRD, Amendment A2, and Epic 13's proposed FR120–125 now has exactly one
owner. Three are **deliberately not built**, and each is a recorded owner decision rather than an
omission:

| Deliberately not built | Where the decision lives |
|---|---|
| **NFR-12** — Hebrew catalogue, RTL layout, mirrored UI | S27 (2026-07-30). Bilingual *data* is unaffected and shipped. The PRD still asserts NFR-12 and should carry the amendment; Story 15.6 also decides the French catalogue's fate |
| **FR2 / FR27's iOS half** — a native Share Extension for true 1-tap | PRD "Deferred"; the email-share path is the shipped answer |
| **Internationalisation (UK/Israel)** | PRD "Deferred", gated on UK-GDPR / EU-GDPR / Israeli-privacy review |

**Two requirements are met by a mechanism narrower than their words, and both are now stories
rather than silent narrowings:** PRV-10's field-level encryption (Story 14.5, framed as a decision
between building it and amending the claim) and FR48/PRV-8's per-recipient sharing (Story 14.6).

**One requirement is unverified rather than known-missing:** NFR-3, offline-tolerant capture. A
service worker is registered by `vite-plugin-pwa`; whether "add now, sync later" actually holds for
the share target and manual upload has never been tested. Its own wording is "where feasible", so
it is recorded here as unverified rather than assigned a story — but somebody should try it on a
plane before launch, because the users this product exists for are the ones who will.

**What this audit does not cover.** It measures the product against what the PRD says. It does not
ask whether the PRD is still right — after nine shipped epics, some of it may not be, and the
place to raise that is a PRD amendment round, not a story.
