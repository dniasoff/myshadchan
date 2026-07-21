---
title: Architecture Spine Review — Rubric + Brownfield-Ratification Lens
target: ARCHITECTURE-SPINE.md (MyShadchan v1)
reviewer: spine-reviewer (read-only)
date: 2026-07-21
verdict: CONDITIONAL-PASS — strong, factually-accurate brownfield ratification; fix a few unhomed capabilities before build
---

# Spine Review — MyShadchan v1

**One-line verdict.** A strong, tight spine: 14 well-chosen invariants that fix the real
divergence points for all 11 epics, and — the part I weighted hardest — its factual claims
about the Atomic CRM fork check out almost everywhere against the actual code. The defects are
*omissions of home* (data export/delete/retention lifecycle, and the operational envelope living
outside the binding doc), plus an undecided version posture — all fixable, none fatal.

Severities: **[critical]** blocks build · **[high]** fix before the affected epic · **[medium]**
fix before it bites · **[low]** polish.

---

## 0. Brownfield ratification scorecard (checklist item 5 — weighted hardest)

I checked every fork claim the spine makes against the real code. Result: the ratification is
**accurate**. This matters — a brownfield spine that misdescribes the base it forks is worse than
useless. This one does not.

| Spine claim | Verdict | Evidence |
|---|---|---|
| dataProvider two-seam pattern (custom-methods overlay + `ResourceCallbacks[]`) — AD-10 | ✅ accurate | `providers/supabase/dataProvider.ts:47` `getDataProviderWithCustomMethods()` spreads base + adds `signUp/salesCreate/mergeContacts/unarchiveDeal/getConfiguration/…`; `:260` `const lifeCycleCallbacks: ResourceCallbacks[]`; `:367` `withLifecycleCallbacks(...)`. Exactly the two seams named. |
| Build-time provider selection (`main.tsx`=supabase, `demo/main.tsx`=fakerest) — AD-10 | ✅ accurate | `src/main.tsx`→`src/App.tsx`→ default `getDataProvider` from `providers/supabase` (`root/CRM.tsx:31,126`); `demo/main.tsx`→`demo/App.tsx:2-5` imports `providers/fakerest`; second build via `vite.demo.config.ts` + `package.json` script `dev:demo`/`build:demo`. |
| `*_summary` views routed through the provider — AD-1/AD-10 | ✅ accurate | `03_views.sql:74` `companies_summary` + `:102` `contacts_summary`, both `with (security_invoker = on)`; provider routes `getList/getOne` `companies→companies_summary`, `contacts→contacts_summary` (`dataProvider.ts:52-88`). Spine's `security_invoker=on` "ratified" claim (AD-1) is literally true. |
| `auth.users → app-user` trigger sync — AD-2/AD-11 target it | ✅ accurate | `04_triggers.sql:73-80` `on_auth_user_created/updated` → `handle_new_user()/handle_update_user()`; bodies at `02_functions.sql:227,249` insert into `public.sales(... administrator)`. This is the exact model AD-2/AD-11 say to retire. |
| Existing RLS is `to authenticated using(true)` (replace, not extend) — AD-1 | ✅ accurate | `05_policies.sql:19-69` — **every** policy on companies/contacts/deals/notes/tasks/tags is `to authenticated using (true)` / `with check (true)`. Zero tenancy: no `account_id`, no `accounts`, no `account_members` anywhere in `supabase/schemas/`. AD-1's "the fork's `using(true)` policies are **replaced**" is precisely right. |
| Single-tenant `is_admin()` / `isInitialized` model — AD-2/AD-11 retire it | ✅ accurate | `02_functions.sql:265` `is_admin()`; `03_views.sql:130` `init_state with (security_invoker = off)` (the first-user gate); used in provider `isInitialized()` (`dataProvider.ts:209`). |
| vite-plugin-pwa state (SW + maskable + standalone manifest; `share_target` absent) — AD-14 | ✅ accurate | `vite.config.ts:30-37` `VitePWA({ registerType:"autoUpdate", manifest:false })`; `public/manifest.json` `display:standalone` + maskable icon set; **no `share_target`** anywhere (net-new, as AD-14 says). |
| `@supabase/supabase-js` is transitive → "make direct dep, stay 2.x" (Stack) | ✅ accurate | Not in `package.json` dependencies; only reachable via `ra-supabase-core ^3.5.2`. Correct call. |
| Upstash "declared-but-unused" (SD §2) | ✅ accurate | `deploy.yml:24-25,54-56` provisions `UPSTASH_REDIS_REST_URL/TOKEN` secrets, but **no** `@upstash/*` npm dep and no code references it. |
| Cloudflare/Workers/Hono/Wrangler/Anthropic/Langfuse/PostHog/Twilio all greenfield (SD §2) | ✅ accurate | None present in `package.json`. `workers/` tree does not exist. |
| Node `24.18.0` ".nvmrc already correct" (Stack) | ✅ accurate | `.nvmrc` = `v24.18.0`, exact match. |
| Fork ≈ 0% domain adaptation ("Atomic CRM" ~33×) (SD §2) | ✅ ~accurate | 30 occurrences across 23 files in `src/`; `public/manifest.json` still names the app "Atomic CRM". |

**Bottom line on ratification:** the spine *ratifies* the fork rather than contradicting it. Every
"ratified from the fork" tag I checked is true, and every "net-new / replaced" tag is also true.
The findings below are about what the spine **doesn't** home — not about anything it gets wrong
about the code.

---

## 1. Does it fix the real divergence points for the 11 epics, and miss none?

**Mostly yes.** The 14 ADs plus the Capability→Architecture Map (spine §"Capability → Architecture
Map") give every epic at least one governing invariant, and the choices are the right ones:
one tenancy boundary (AD-1), one membership model (AD-2), one visibility policy (AD-3), one central
`suggestion` object + state machine (AD-4), one `matchIdentity()` (AD-5), one `inbox_item` staging
convergence (AD-6), one compute-home rule (AD-7), one AI seam (AD-8), one media-access service
(AD-9), one CRUD seam (AD-10). These are exactly the seams where independent builders of E1–E11
would otherwise diverge. Good spine instinct.

**Miss — the data-lifecycle divergence point (see §6 for full treatment).** Export / delete /
retention / per-single purge is a genuine multi-unit divergence surface (cascade vs soft-delete vs
sub-processor purge vs backup purge) with **no AD**. Flagged high in §6.

**Minor divergence gaps (low):**
- **AD-13 vs the fork's `tasks` shape.** AD-13 wants polymorphic `target_type ∈
  {shadchan,suggestion,reference}`, but the fork's `tasks.contact_id` is a **NOT NULL FK to
  contacts** (`01_tables.sql:113,166`). "tasks rework" (SD §12/E7) therefore means dropping a
  not-null FK and repointing — a real migration the spine's data model shows as already-polymorphic
  without flagging the obstacle. **[low]**
- **Global search (FR53)** across bilingual, RLS-scoped resources has no dedicated invariant, but is
  adequately covered-by-composition (AD-12 bilingual data + AD-5 normalization module). Acceptable.

---

## 2. Is every AD's Rule enforceable, and does it actually prevent its stated divergence?

**Largely yes.** AD-1 (RLS predicate per table), AD-4 (fixed 7-state enum), AD-7 (service-role
re-assert, backed by SD §5's lint+review+cross-account-write tests), AD-10 (provider seam) are all
enforceable and self-policing.

**AD-3 — enforcement mechanism is underspecified (the one real "is it enforceable?" doubt). [medium]**
AD-3's Rule says visibility is derived by "**a single** policy module" but is "enforced twice — in
RLS predicates **and** in curated views" (spine AD-3; SD §5 names it `visibility.ts`). RLS and the
curated views are **both SQL (Postgres)**; a TypeScript `visibility.ts` cannot enforce either. So
the "single module" that guarantees the child-login and the triage-board can't diverge is exactly
the thing left unspecified: is it a SQL function both RLS and views call, a codegen source, or two
hand-kept copies? As written, "enforced twice" invites the very drift AD-3 exists to prevent (child
sees a gut-reject / `private_parent`). Pin the single SQL source of truth (e.g. a
`SECURITY DEFINER` predicate function that both RLS `USING` and the curated views invoke) so there
is one enforcement point, not two that can diverge.

**AD-8 hard guardrail is well-constructed.** "Never judges compatibility / no outward scraping"
(FR63) is enforced by *scope* (SD §8: the `ai/` Worker has no web-fetch capability for person
lookups), not just prompt text. That's a real enforcement, not a wish.

---

## 3. Could anything under Deferred let two units diverge?

**No — the deferral discipline is good.** The load-bearing anti-divergence move is that the
Phase-2 shadchan capability is *provisioned in v1* (AD-2 reserves the `shadchan` role in the enum +
RLS; AD-4 reserves `origin='shadchan'`), so deferring the shadchan **UI** cannot cause a schema
fork later (SD §14). Native iOS, Cloudflare consolidation (Queues/KV/Pages vs Upstash/Vercel),
Sentry, Workers-AI, and deep shidduch-site integration are all genuinely additive and cannot make
two v1 units disagree.

**One soft spot [medium]:** "Numeric SLOs / launch targets — set once a usage baseline exists"
defers *all* of availability/backup targets by silence, and PRV-2's "retention window" has no
number. Deferring the *targets* is fine; deferring the *existence of a backup/retention mechanism*
is not (see §6/§7).

---

## 4. Is every named technology verified-current and a real fit?

**Fit: yes.** The genuinely architectural technology choices are correct and correctly reasoned:
- **Cloudflare AI Gateway is a base-URL proxy** (override the provider SDK's `baseURL`), explicitly
  distinguished from Vercel AI Gateway (spine Stack note; SD §8). Correct — this is a real and
  common source of confusion, and the spine gets it right.
- **Langfuse via the OTel SDK** (`@langfuse/tracing` + `@langfuse/otel`), "not legacy monolithic
  `langfuse` 3.x" (Stack:172). Correct direction.
- **R2 zero-egress** as the platform-split justification (SD §3) is a sound, load-bearing rationale
  for a free, media-heavy product.
- `nodejs_compat` needing `compatibility_date ≥ 2024-09-23`; Workers = V8-isolate not full Node
  (SD §3) — accurate constraints.

**Currency: I cannot independently confirm the live version numbers** (no network in this review),
and the spine's specific patch pins (React 19.2.8, TanStack 5.101.4, Zod 4.4.3, Wrangler 4.113.0,
etc.) are asserted as "verified live 2026-07-21." I can only confirm they are all **ahead of what is
installed** (`package.json`: React ^19.1.0, TanStack ^5.101.0, Zod ^4.1.12, Vite ^7.3.2, TS ~5.8.3,
react-router ^7.17.0, ESLint ^9, Storybook ^9, shadcn ^3, marked ^17, lucide ^0.542). That gap is
the substance of the next finding.

**[medium] Version posture is undecided in a document whose job is to decide.** The Stack table
pins **six simultaneous majors** — TS 7.0.2 (`tsgo`), Vite 8, react-router 8, ESLint 10,
Storybook 10, shadcn 4 — each with a `⚠` and a "hold =" fallback, while SD Open-Q #7 leaves
"aggressive-latest vs hold the risky majors" **unresolved**. A binding Stack that lists both a
pinned value *and* a hold-fallback for its riskiest rows, with the choice punted, is not a decision:
two developers reading it will pick differently, and TS7-vs-TS5.8 / Vite8-vs-Vite7 are not
cosmetic. For a from-scratch domain rebuild layered on the fork, stacking six major migrations on
top of the *actual* work multiplies risk for no product reason. **Recommendation:** make the spine
default the `⚠` rows to their **hold** column (Vite 7.3.6, react-router 7.18.1, TS 5.8.3, ESLint 9,
Storybook 9, shadcn 3 — all already installed), and treat each jump as an explicit, individually-
gated opt-in. That turns the Stack back into a decision. (The non-`⚠` minor/patch bumps are fine.)

---

## 5. Brownfield: does it RATIFY the fork rather than contradict it?

Full scorecard in §0 — **it ratifies, accurately.** Two brownfield-accuracy corrections and two
fork-constraint call-outs the spine should absorb:

**[low/medium] Email provider is mischaracterized as an open binary.** Stack:174 lists
"Email inbound: `[ASSUMPTION]` Postmark 5.1.0 (vs Resend 6.18.0)" and Open-Q #3 frames it as
"keep Postmark vs move to Resend." But the fork already runs **both, in different directions**:
- **Postmark inbound-parse** is real, substantial code: `supabase/functions/postmark/` — full
  webhook with CC-mode, `forwardedParser.ts` (recover original sender), and
  `extractAndUploadAttachments.ts`, gated on `POSTMARK_WEBHOOK_USER/PASSWORD/AUTHORIZED_IPS`.
- **Resend** is already an **outbound** secret provisioned in the deploy pipeline
  (`deploy.yml:23,54` `RESEND_API_KEY`).

So it isn't "Postmark *or* Resend" for one slot — it's Postmark(in) + Resend(out) today. The spine
should model two slots (inbound parse vs outbound send), not one either/or; and note that AD-6's
`ingest/` Worker "ports the postmark logic" (spine AD-7 `[ASSUMPTION]`) is porting *inbound* code,
independent of the outbound choice.

**[low] `handle_new_user` trigger + `anon` grant collide with AD-11 invite-only.** The fork's
`handle_new_user()` auto-creates a `sales` row (and, via the `init_state`/first-user pattern, an
admin) for **any** `auth.users` insert, and is `grant all … to anon` (`06_grants.sql:44`). AD-11's
"join by invitation into an account membership" + "retire the `isInitialized` gate" is conceptually
right, but the spine should explicitly name that **this trigger and its `anon` grant must be
reworked** (a new auth user must resolve to a pre-existing *invited* membership, not self-provision
an account/admin) — otherwise open self-signup survives the rewrite. Security-sensitive; worth an
explicit line rather than leaving it implied.

**[low] AD-14 "extend the fork's mobile React-Query persistence" understates the gap.** The fork's
persistence (`root/CRM.tsx:286-304`, **`MobileAdmin` only** — `DesktopAdmin` has none, confirming
SD §10's "today only mobile has it") is `PersistQueryClientProvider` + `createAsyncStoragePersister`
over **`localStorage`**, persisting the **query cache (reads)** with `networkMode:"offlineFirst"`.
AD-14 wants a **durable IndexedDB mutation outbox + Background Sync** so *capture writes* survive
offline — a different mechanism, not an "extend." The spine is honest (it tags the outbox
`[ASSUMPTION]`), but "extend the fork's persistence" could mislead a builder into treating a
net-new offline-write queue as a small config change. Say "add" not "extend."

**[low] Privacy regression the spine leaves in place: the marmelab telemetry beacon.**
`root/CRM.tsx:147` fires an outbound `Image` beacon to
`https://atomic-crm-telemetry.marmelab.com/...?domain=<hostname>` on every production load (unless
`disableTelemetry`). For a product whose entire wedge is privacy (PRV-1/6), an unmentioned
third-party beacon inherited from the fork should be an explicit "remove" in the migration path
(SD §12/E1). The spine adds PostHog but never says to cut the marmelab call.

---

## 6. Does it cover the PRD (FR1-70, PRV-1-12, NFR-1-10)? Any capability with no home?

Coverage is broad and the Capability→Architecture Map is honest for E1–E11. **One capability has no
architectural home, and it is a privacy-pillar one:**

**[high] Data export / deletion / retention / per-single purge lifecycle — PRV-2, PRV-11, NFR-8,
NFR-10 — is unhomed, and collides with a hard fork constraint.**
- PRV-2 requires deletion that "purges the **live system immediately**, clears **backups within the
  retention window**, and instructs **sub-processors to delete per contract**," plus full
  export/backup. PRV-11 requires honoring a **single's purge request** (delete one person across
  suggestions/resumes/references/dates). NFR-10 requires one-click full-account export.
- **No AD governs any of this.** The Capability map assigns E11's "PRV-2/NFR-10" to **AD-1 and
  AD-10** — but AD-1 is tenant *isolation* and AD-10 is the CRUD *seam*; neither specifies
  delete-cascade semantics, soft-vs-hard delete, retention windows, backup purge, or sub-processor
  purge orchestration. Export of an RLS-scoped, R2-backed, field-encrypted account (resumes in R2,
  health/photo fields encrypted per AD-9) is a real cross-cutting design, not a CRUD call.
- **Direct brownfield collision:** the fork's stated stance is "**User deletion is not supported to
  avoid data loss; use account disabling instead**" (AGENTS.md), realized as `sales.disabled`
  (`01_tables.sql:100`) and the account-disabling edge function. That is the **opposite** of PRV-2's
  hard-delete promise. The spine must decide and home this contradiction (a real DELETE path, cascade
  design across R2 + encrypted fields + Upstash + sub-processors), or PRV-2/PRV-11 — the product's
  #1 wedge — ships on an architecture that structurally can't delete.

**Adequately homed (spot-check):** FR1-30 capture/inbox/channels → AD-6/AD-7 ✓; FR10-13/FR42
dedupe → AD-5/AD-12 ✓; FR14-18 pipeline → AD-4 ✓; FR35/47-49 resume+sharing → AD-9 ✓;
FR44-46 reminders → AD-13 ✓; FR55-63 auto-parse+AI → AD-6/AD-8 ✓; FR64-70 child portal → AD-3 ✓;
PRV-3/4/5/6/7/9 → AD-1/3/9/8/6/11 ✓. **Lower-weight thin spots:** NFR-7 accessibility has no
invariant despite the PRD's heavy "non-technical / phone-less" emphasis (convention-level only —
acceptable for a spine, worth noting **[low]**); PRV-11 per-single purge folds into the §6 delete
gap.

---

## 7. Is every initiative-altitude dimension decided/deferred/open — especially the operational envelope?

**The operational envelope is decided, but in the wrong document, and two sub-dimensions are silent.
[high/medium]**

- **Where it lives is the structural problem.** Deploy topology, environments (dev/preview/prod, US
  region), secret placement, and deploy-time migrations are all worked out — but **only in
  SOLUTION-DESIGN §3**, not in the binding spine. The spine's binding content (ADs, Conventions,
  Stack) contains **no operational invariant**: AD-7 fixes *where code runs*, nothing fixes *how it
  deploys, is backed up, retained, or monitored in production*. And the spine's own front-matter says
  `companions: []` (**ARCHITECTURE-SPINE.md:16**) — it doesn't even reference the companion that
  holds the operations. Since the docs' own rule is "**where they disagree, the spine wins**"
  (SD §Purpose), the operational envelope is currently governed by the doc that loses. Either add an
  operational AD (AD-15: deployment/environments/backup/observability) or at minimum fix
  `companions:` to bind SOLUTION-DESIGN so §3 is authoritative.

- **Silent sub-dimensions inside the envelope:**
  - **Backup / restore / DR (NFR-8).** Nowhere — SD §3 covers *migrations* (schema), not data
    backup or restore. No RPO/RTO, no backup mechanism named. **[medium/high]**
  - **Retention windows (PRV-2).** Referenced ("within the retention window") with no value or
    owner. **[medium]** — ties to §6.
  - **Production error monitoring for the compute plane.** Sentry is explicitly deferred to Phase 2;
    "v1 error tracking = PostHog" (spine Deferred). PostHog is **product analytics**, not error/
    exception monitoring. So the **security-critical service-role Workers** (AD-7 — the "single most
    dangerous seam," SD §5) ship with **no exception alerting**. For code that bypasses RLS and must
    re-assert `account_id` on every query, no prod error monitoring is a real operational gap. **[medium]**

- **Decided/covered dimensions (credit where due):** compute topology (AD-7), data plane (Supabase),
  static host (Vercel), CI/CD tracks (existing `deploy.yml` for Supabase + a new `wrangler deploy`
  job), secrets discipline (Worker secrets + GH Actions, `VITE_*`-only to client), rate-limiting
  (Upstash), AI-cost observability (Langfuse), product analytics (PostHog), region (US). This is a
  well-populated envelope — the issue is *location* (companion, not spine) + *three silent cells*
  (backup/DR, retention, prod error-monitoring), not wholesale absence.

---

## Top findings (ranked)

1. **[high] Data export/delete/retention/purge has no architectural home and contradicts the fork.**
   PRV-2/PRV-11/NFR-8/NFR-10 — the product's #1 privacy wedge — are assigned to AD-1/AD-10 which
   don't specify delete semantics, while the fork bakes in "user deletion not supported"
   (AGENTS.md; `sales.disabled`, `01_tables.sql:100`). Needs its own AD covering hard-delete cascade
   across R2 + encrypted fields + sub-processors, export, and retention.

2. **[high/medium] Operational envelope is outside the binding doc, and backup/DR + retention +
   prod error-monitoring are silent.** It lives only in SOLUTION-DESIGN §3, and the spine's
   `companions: []` (**ARCHITECTURE-SPINE.md:16**) doesn't even bind that companion; "the spine wins"
   then governs operations with an AD-less doc. Sentry deferred → the service-role Workers (AD-7) have
   no exception monitoring.

3. **[medium] Version posture is undecided in a binding Stack.** Six simultaneous majors
   (TS7/`tsgo`, Vite8, react-router8, ESLint10, Storybook10, shadcn4) are pinned *and* given "hold ="
   fallbacks, with the choice left to SD Open-Q #7. Default the `⚠` rows to their hold column
   (all already installed) and make each jump an explicit opt-in.

4. **[medium] AD-3's "single policy module, enforced twice (RLS + views)" is mechanically
   underspecified.** RLS and curated views are both SQL; a TS `visibility.ts` can't drive either.
   Name one SQL source of truth (a predicate function both RLS `USING` and the views call) or the
   child/parent divergence AD-3 exists to prevent can re-enter through two enforcement points.

5. **[low/medium] Email is mischaracterized as Postmark-vs-Resend for one slot.** The fork already
   runs Postmark **inbound** (`supabase/functions/postmark/`, full CC+forward+attachment parser) and
   Resend **outbound** (`deploy.yml:23,54`). Model two slots, not an either/or (Stack:174, Open-Q #3).

*(Also worth folding in: the marmelab telemetry beacon `root/CRM.tsx:147` should be an explicit
"remove" for a privacy-first product; the `handle_new_user` trigger + `anon` grant
`06_grants.sql:44` must be reworked for AD-11 invite-only; AD-14 should say "add" an offline
mutation outbox, not "extend" the fork's read-cache persistence; AD-13 vs the fork's not-null
`tasks.contact_id` FK `01_tables.sql:113` is an unflagged migration.)*

---

## What the spine gets right (so it isn't lost in the findings)

The invariant set is genuinely good: one tenancy boundary, one membership model, one visibility
policy, one central `suggestion` + state machine, one `matchIdentity()`, one inbox convergence, one
compute-home rule, one AI seam, one media-access service, one CRUD seam. The Phase-2 provisioning
via reserved enum values (AD-2/AD-4) is the correct no-rework move. And the brownfield claims are
**accurate to the code** — the reason this is a conditional *pass*, not a rewrite: the gaps are
things to *add*, not things to *correct*.
