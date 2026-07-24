# MyShadchan — Gap Remediation Plan

_Companion to `gap-analysis-implementation-vs-mockup.md` (2026-07-24). This plan sequences the
work to close every gap between the running app and the approved mockup (`MyShadchan.dc.html`),
with **Hebrew/RTL re-introduced for the shidduch profile only** per the product decision._

---

## 0. Ground truth that shapes this plan

The schema was deliberately built to anticipate most deferred work, so several "missing" screens
are cheaper than they look:

| Existing groundwork | Unblocks |
|---|---|
| `shidduchim.name_he / parents_he / seminary_he / shul_he / location_he` columns + TS `*_he` types still present (Hebrew removal was **UI-only**, with a file-by-file reversal checklist in `remove-hebrew.md`) | **Epic 1** — no migration to re-add Hebrew to the profile |
| `shidduchim.visibility` = `shared \| private_parent \| private_child` (locked "for the deferred child portal") | **Epic 7** — portal access model |
| `shidduchim.origin` = `channel \| manual \| shadchan` (`channel` reserved for capture) | **Epic 2** — capture funnel provenance |
| Normalized match-key infra already used by references' match-on-entry (`*_norm`, consonant-skeleton folding, `01_tables.sql:532`) | **Epic 3** — dedupe reuses the same pattern |
| `supabase/functions/postmark` already parses inbound email + `extractAndUploadAttachments` | **Epic 2** — email ingress + attachment storage |
| `references/useAiEntitlement.ts` is a single-constant seam with an explicit "move server-side before AI ships" note | **Epic 4** — billing replaces the hook body |

**What was actually stripped for Hebrew:** only the render/collect UI **plus the font pipeline** —
`@fontsource-variable/heebo` (removed from `package.json`) and `--font-hebrew` in `src/index.css`
(removed, so the `font-hebrew` Tailwind utility no longer generates). Restoring those two is a
prerequisite for Epic 1.

---

## 1. Epics & sequencing at a glance

```
WAVE 1 (independent, small)     WAVE 2 (foundations)        WAVE 3 (the big funnel)     WAVE 4
─────────────────────────       ────────────────────        ───────────────────────     ──────
E1 Hebrew — shidduch profile    E3 Dedupe / catch engine    E2 Capture funnel           E7 Candidate portal
E5 Shadchan productivity        E4 Billing + server         (share → inbox → parse)     E8 Onboarding cluster
E6 Per-child counts                entitlement              depends on E3 (catch) +
E9 Polish pass                                              E4 (paid AI parse)
```

Wave 1 has no cross-dependencies and can ship immediately. Wave 2 unblocks Wave 3. Wave 4 is
independent and can start any time after its own migrations.

Effort key: **S** ≈ ≤1 day · **M** ≈ 2–4 days · **L** ≈ 1–2 weeks.

---

## Epic 1 — Hebrew / RTL for the shidduch profile _(Wave 1 · M · no data migration)_

**Product scope (explicit).** Hebrew/RTL returns **only on the shidduch profile** — the suggestion
detail view and the form that feeds it — so a suggested person's name and context can be recorded
and read bilingually. **Non-goals (stay English-only):** the board cards, dashboard, children,
shadchanim, and references. The board card is a summary tile, not the profile; re-enabling Hebrew
there later is a one-line toggle but is **out of scope** here.

**1a. Restore the font pipeline (prerequisite).**
- Re-add `@fontsource-variable/heebo` to `package.json`; import it (where Inter/Space Grotesk are
  imported).
- Re-add the `--font-hebrew` theme token in `src/index.css` so the `font-hebrew` utility regenerates.
- _These two files are otherwise "locked"; this is a deliberate, reviewed re-add — flag it as such._

**1b. Re-introduce Hebrew on the profile (reverse the `remove-hebrew.md` items, profile files only):**
- `shidduchim/ShidduchShowHeader.tsx` — restore the `name_he` span beside the English name
  (`font-hebrew`, `dir="rtl"`, a real gap — **never** `ms-*` on the RTL span).
- `shidduchim/ShidduchFactsCard.tsx` — restore the `he` prop on `FactRow` and
  `he={shidduch.*_he}` on the four bilingual facts (parents / seminary / shul / location); restore
  the `Boolean(shidduch.*_he)` terms in `hasAnyFact`.
- `shidduchim/ShidduchSchoolsSection.tsx` — restore the Hebrew school-name display **and** the
  `name_he` `TextInput`, plus `name_he` in `onAddSchool` (schools are part of the profile).
- `shidduchim/ShidduchInputs.tsx` (create/edit form) — add bilingual Hebrew inputs for `name_he`
  and the context `_he` fields, visibly **paired** with their English counterparts; `dir="rtl"` +
  `font-hebrew` on the Hebrew inputs.

**States:** profile with both names; profile with English-only (Hebrew absent → no empty span);
form entry of Hebrew; RTL layout correctness (logical properties throughout).
**Acceptance:** the suggestion profile displays and collects EN + HE; RTL renders correctly with
Heebo; **no Hebrew appears anywhere outside the profile**; `make typecheck` passes.
**Risk:** the `font-hebrew` utility must exist before any `font-hebrew` class renders — land 1a
before 1b. Keep the removal checklist as the exact inverse map.

---

## Epic 2 — Capture funnel: share → inbox → auto-parse _(Wave 3 · L · migration + edge fns)_

The mockup's front-of-funnel and the single biggest value gap. Build the **free manual path first**,
then layer AI on top behind the entitlement (Epic 4).

**2a. Inbox foundation (schema).** New `inbox_items` (account-scoped, RLS): raw payload, `source`
(`whatsapp|sms|email|photo|upload`), attachment refs (Storage), `parse_status`
(`unparsed|parsed|confirmed|dismissed`), tentative `child_id` / `shadchan_id`, created_at. Reuse
`origin='channel'` on the shidduch it eventually creates. _Schema-first in `supabase/schemas`,
generate a migration, apply at deploy._

**2b. Ingress paths.**
- **PWA share-target (`isShare`)** — add `share_target` to the web manifest + a `/share` route that
  receives shared text/files (Android 1-tap; WhatsApp/SMS/photo) and writes an `inbox_item`.
- **Private inbox email** — extend `supabase/functions/postmark` to file inbound mail (to the
  account's `you@in.myshadchan.space` address) as an `inbox_item`, storing attachments via the
  existing `extractAndUploadAttachments`. Desktop upload path = the same, minus the phone.

**2c. Inbox UI (`isInbox`).** A calm list of items "needing your confirmation — we won't guess":
each item shows the raw capture + attachment, and a **resolve step**: which shadchan · which child ·
or link to an existing suggestion (`isShare` link flow). Resolving creates/updates a shidduch via
the canonical `createShidduch` (AD-4). Skipping never loses it.

**2d. Auto-parse review (`isParse`) — paid.** An edge function (AI Gateway, gated server-side by
Epic 4) OCR/LLM-extracts a resume attachment into structured fields → an editable **"confirm the
details"** review. The **original file is kept as received, never edited**; an always-present
**"Enter myself"** button drops to the free manual form. Emits a shidduch on confirm.

**Dependencies:** 2c (manual) ships without AI; 2d requires Epic 4 (entitlement) + Epic 10-style AI
gateway. Catch-on-entry (below) fires here via Epic 3.
**Acceptance:** a resume shared/emailed/uploaded appears in the Inbox, resolves to a suggestion in
≤1 calm step, and never silently drops; AI parse works when entitled and degrades to manual when not.
**Risk:** attachment security/RLS; parse must never fabricate — unknown fields stay blank.

---

## Epic 3 — Dedupe "catch" engine + shidduch catch review _(Wave 2 · M · migration + RPC)_

**Mockup (`isCatch`):** "You've come across this person before" — high-confidence match on
name + DOB + mother's name, showing the prior suggestion **and** any prior dating outcome, with
Confirm / Dismiss and "nothing merges automatically."

**3a. Match keys (schema).** Add normalized match-key columns for shidduchim (name / parents-mother /
DOB-or-age), mirroring the references `*_norm` + consonant-skeleton folding already in the codebase;
index them.
**3b. Catch RPC.** On suggestion entry (manual create **and** capture-funnel resolve), detect prior
suggestions of the same person across **any** child, plus prior dating outcomes, and return a
confidence + evidence payload. Read-only; merges nothing automatically.
**3c. Surfaces.** Wire the deliberately-deferred `ShidduchCard.tsx` **catch-chip slot**; feed the
dashboard "needs your attention / to review" section; add the full **catch review** panel (Confirm
match / Dismiss — different person).

**Acceptance:** entering a previously-seen person raises a calm catch with real evidence; dismiss
and confirm both work; nothing merges without the user. Marked FREE (mockup lists the catch under
the free tier).
**Risk:** false positives — bias toward "surface, let the human decide"; never auto-merge.

---

## Epic 4 — Billing + server-side entitlement _(Wave 2 · M–L · migration + payments)_

**Mockup (`isBilling`):** "Run at cost, not for profit" — **Free forever** (CRM, manual entry, the
catch, reference tracking + reminders) and an **AI tier at $2/mo or $24/yr** (auto-parse OCR,
research assistant, cross-reference gaps), a usage meter (e.g. 34/100 resumes), and graceful lapse
("nothing is lost; AI auto-fill pauses, the free manual path stays").

**4a. Move entitlement server-side.** Per the explicit note in `useAiEntitlement.ts`, the decision
**must** move server-side before any AI inference ships (today it's a client-side bypass). Replace
the hook body with a server check (RPC / edge) and gate the AI edge functions there too.
**4b. Schema.** `subscription` (plan, status, renews_at) + AI `usage` metering (resumes parsed per
period). RLS account-scoped.
**4c. Billing UI.** Free-vs-AI tier comparison, usage meter, subscribe (annual/monthly), lapse copy.
**4d. Payments.** Stripe (or chosen provider); or, if payment is deferred, a "request access" stub
that flips entitlement manually — but the **server-side gate lands regardless**.

**Dependencies:** blocks Epic 2d (AI parse) and un-stubs the existing References AI assistant.
**Acceptance:** AI surfaces are gated server-side; usage metered; lapse degrades gracefully to the
free manual path; free features never paywalled (match-on-entry, catch, reminders, manual entry).

---

## Epic 5 — Shadchan productivity stats _(Wave 1 · M · migration)_

**Gap:** `isShadDetail` shows productivity tiles the app omits (no aggregate).
- Add a `shadchan_stats` view/aggregate: per shadchan — **# redts**, **# progressed** (reached
  Look-into or beyond), **# led to dates / Yes**.
- Render calm stat tiles on `shadchanim/ShadchanShow` above the existing "suggestions from this
  shadchan" list. **No fabricated numbers** — tiles appear only when the aggregate is real.
**Acceptance:** real per-shadchan stats render; zero-state is calm; typecheck passes.

---

## Epic 6 — Per-child pipeline counts _(Wave 1 · S–M · migration)_

**Gap:** child cards can't show "N in pipeline" without an N+1.
- Add a `children_summary` view (per-child counts by pipeline state).
- Surface counts on `children/ChildCard` and the child stat cards; feed the dashboard.
**Acceptance:** child cards show real per-child counts with no N+1; typecheck passes.

---

## Epic 7 — Candidate portal (read-only) _(Wave 4 · M · migration + RLS)_

**Mockup (`isChildhome`):** "Rivky's space / What's being looked into for you / Your thoughts? →"
- Leverage the existing `visibility` (`shared | private_parent | private_child`) columns.
- Token-scoped, **read-only** route for the child (magic link / invite token); RLS policies that
  honor `visibility` so only shared items appear.
- Optional lightweight "Your thoughts →" feedback capture back to the parent.
**Acceptance:** a child opens a private link and sees only shared suggestions, read-only; no write
paths; visibility respected by RLS (not just the client).
**Risk:** this is a **new external trust boundary** — RLS + token scoping must be airtight
(dispatch SECURITY-REVIEWER).

---

## Epic 8 — Onboarding cluster _(Wave 4 · M · maybe migration)_

**Gap (`isSignin` / Screens 1–5):** sign-in/sign-up are polished, but 18+ affirmation, invite
acceptance (multi-user family account), and first-run setup (name the account + add first child +
choose language) don't exist; `ConfirmationRequired` is stock.
- Build `AgeAffirmation`, `InviteAcceptance`, `FirstRunSetup` in `login/`; reskin
  `ConfirmationRequired` to the auth-cluster (LedgerMark, calm copy).
- Invite tokens / account-naming backend where missing (small migration if invites are added).
**Acceptance:** first run teaches the core loop in one step and lands on "add your first child";
`ConfirmationRequired` matches the cluster; one primary CTA each.

---

## Epic 9 — Polish & parity pass _(Wave 1 · S each)_

- **Dead route:** redirect desktop `/#/tasks` → `/reminders` (or drop the `tasks` list route in
  `root/CRM.tsx`); the tasks concept is fully realized by Reminders.
- **Primary-button consistency:** apply the gradient primary recipe to form saves (child &
  reference create/edit) so all primaries match the list/hero CTAs.
- **Desktop settings layout:** give `/settings` a proper desktop two-pane layout instead of the
  narrow centered mobile column; keep the off-brand Atomic-CRM plumbing (MCP/inbound cards) out.
- **Systematic state/theme parity:** per screen, verify empty / loading / error states + **dark
  mode** + **375px** and AA contrast (the parity checklist owed in `screens-plan.md`).
**Acceptance:** no dead routes; consistent primaries; desktop settings reads as desktop; each
screen passes the parity checklist in both themes.

---

## 2. Migrations roll-up (deploy-time)

| Epic | Migration |
|---|---|
| 1 | **none** (columns + types exist; only `index.css`/`package.json` font restore) |
| 2 | `inbox_items` table + Storage + RLS |
| 3 | shidduch match-key columns + index; catch RPC |
| 4 | `subscription` + AI `usage` tables + RLS; server-side entitlement fn |
| 5 | `shadchan_stats` view/aggregate |
| 6 | `children_summary` view |
| 7 | portal access tokens + visibility-honoring RLS policies |
| 8 | invite tokens (only if invites added) |

Follow the repo convention: edit `supabase/schemas/*` (source of truth) → `supabase db diff` →
apply. Group migrations per wave to minimize deploy rounds.

---

## 3. How this gets built (harness note)

Each epic is a **COMPLEX** change: it should enter the agent harness (dispatch `orchestrator`),
which will have the planner break it into lane tickets, run developer waves with peer review,
and a **deploy-time migration round** for the epics above (the developer never writes SQL during a
ticket; migrations are generated in the migration round). Security-sensitive epics — **2** (external
ingress + attachments), **4** (billing/entitlement), **7** (portal trust boundary) — must trigger
SECURITY-REVIEWER per `.claude/rules/security-triggers.md`.

**Recommended first cut:** ship **Wave 1** (E1 Hebrew profile, E5, E6, E9) as quick, independent
wins, then **E3 + E4** as the foundations that unlock the **E2** capture funnel — which delivers
the largest chunk of the mockup's remaining vision.
