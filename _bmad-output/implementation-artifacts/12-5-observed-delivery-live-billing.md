# Story 12.5: Observed delivery & live-mode billing

Status: ready-for-dev

## Story

As the platform owner,
I want the three things this epic has only ever argued to be working to be **watched** working,
and the paid tier to be able to take an actual pound of an actual person's money,
So that "operational readiness" stops being a claim about code that landed and becomes a record of behaviour that happened.

## Acceptance Criteria

### AC-1: Observed reminder email delivery

**Given** the deployed cron Worker and a reminder due within the sweep window
**When** the sweep runs against production
**Then** an email is observed arriving at a real inbox, and the observation is recorded with the occurrence id, the `task_notifications` row it settled, and the Resend message id
**And** a second sweep over the same occurrence sends nothing (the settle/idempotency path is watched, not inferred)

### AC-2: Observed live-mode Stripe billing

**Given** live-mode Stripe objects — their own product, both prices, webhook endpoint and secrets
**When** a real card completes Checkout against the running Worker
**Then** the signed event is observed reaching the webhook and writing the matching `subscription` and `stripe_events` rows, with `livemode = true` and the Worker's own mode check passing
**And** a **test-mode** event POSTed at the same live endpoint is refused and recorded terminally
**And** an unsigned forged event is refused with a 400
**And** the account's entitlement is observed changing only because the webhook wrote — not the checkout return

### AC-3: Observed public surface probes

**Given** the four public surfaces (both Worker health routes, the webhook, the SPA)
**When** they are probed from outside the deploy pipeline
**Then** each answers, and the probe is the artefact — a workflow's own green is not one of the observations this story accepts.

## Why the negative halves are acceptance criteria and not extras

`.claude/rules/migration-guard-integrity.md` is in this repo because a guard nobody has watched fail is not evidence. The same standard applies to a delivery path nobody has watched refuse: the second-sweep-sends-nothing check, the test-mode refusal and the forged-event 400 are what distinguish "it worked once" from "it works".

## Dependencies

**Depends on Story 14.1** for the live-mode half only — Stripe activation requires published terms and privacy URLs on the business's own site, and there are none (see `phase1-completeness-audit-2026-08-09.md` §C1). The reminder half and the probe half have no dependency and should not wait for it.

## This story owns no source file by default

If any observation fails, the fix is a defect against 12.2 or 12.4 and is made there; 12.5 records the observation either way. A story whose success condition is "nothing was wrong" must still be able to report that something was.

## Tasks / Subtasks

- [ ] **Task 1 — Provision live-mode Stripe objects** (AC: 2)
  - [ ] Create live-mode Stripe product for the AI tier
  - [ ] Create live-mode quarterly price ($6 / 3 months) and yearly price ($24 / year)
  - [ ] Register live-mode webhook endpoint pointing at the deployed billing Worker URL
  - [ ] Add live-mode secrets to GitHub Actions: `STRIPE_SECRET_KEY_LIVE`, `STRIPE_WEBHOOK_SECRET_LIVE`, `STRIPE_PRICE_ID_QUARTERLY_LIVE`, `STRIPE_PRICE_ID_YEARLY_LIVE`
  - [ ] Verify webhook endpoint is reachable from the public internet (not localhost)

- [ ] **Task 2 — Enable cron Worker schedule and verify delivery** (AC: 1)
  - [ ] Uncomment `[triggers]` in `workers/cron/wrangler.toml` to enable the `*/15` cron schedule
  - [ ] Deploy the cron Worker with the schedule enabled
  - [ ] Create a test reminder in production with `delivery_channels` including `email`, due within the next sweep window
  - [ ] Observe the sweep running (check `cron_heartbeat` for `last_ok_at` update)
  - [ ] Observe the email arriving at the real inbox
  - [ ] Record: occurrence id, `task_notifications` row id, Resend message id
  - [ ] Trigger a second sweep (or wait for next tick) and verify no second email is sent for the same occurrence

- [ ] **Task 3 — Verify live-mode Stripe webhook end-to-end** (AC: 2)
  - [ ] Using a real card in Stripe live mode, complete a Checkout session against the deployed billing Worker
  - [ ] Observe the signed `checkout.session.completed` event reaching the webhook
  - [ ] Verify `subscription` row is written with `plan='ai'`, `status='active'`, `provisioning_source='stripe'`, `livemode=true`
  - [ ] Verify `stripe_events` row is written with the event id, type, account_id, `livemode=true`
  - [ ] POST a test-mode event to the live endpoint and verify it is refused (400 or 200 with refusal recorded)
  - [ ] POST an unsigned forged event and verify 400 response
  - [ ] Verify entitlement (`ai_entitlement()`) reflects the change only after webhook processing, not from checkout return

- [ ] **Task 4 — Probe all four public surfaces from outside the pipeline** (AC: 3)
  - [ ] Probe cron Worker health: `GET https://myshadchan-cron.myshadchan.workers.dev/health`
  - [ ] Probe billing Worker health: `GET https://myshadchan-billing.myshadchan.workers.dev/health`
  - [ ] Probe billing webhook: `POST https://myshadchan-billing.myshadchan.workers.dev/webhook` (with valid signature)
  - [ ] Probe SPA: `GET https://myshadchan.space` (or production domain)
  - [ ] Record each response as the artefact (save the HTTP response, not just the CI green check)

- [ ] **Task 5 — Document observations** (AC: 1, 2, 3)
  - [ ] Create an observation record (markdown file in `_bmad-output/observations/`) with:
    - Timestamp of each observation
    - For reminder: occurrence id, `task_notifications` row id, Resend message id, second-sweep result
    - For billing: Stripe event id, `subscription` row state, `stripe_events` row, test-mode refusal, forged-event refusal, entitlement change verification
    - For probes: HTTP response for each of the four surfaces
    - Any failures or deviations from expected behaviour

## Dev Notes

### Context from Story 12.2 (Reminder Delivery)

Story 12.2 built the reminder delivery infrastructure:
- `task_notifications` queue table with idempotency key `(task_id, channel, due_date)`
- `cron_heartbeat` table for sweep visibility
- `workers/shared/resend.ts` transport with Resend `Idempotency-Key` header
- `workers/cron/sweepReminders.ts` sweep implementation
- `claim_due_task_notifications()` / `settle_task_notification()` / `enqueue_due_task_notifications()` / `record_cron_heartbeat()` RPCs
- `ReminderDeliveryStatus.tsx` in Settings showing sweep health

**Known issues from adversarial review (epic-12-adversarial-review-report-2026-08-07.md):**
1. **At-most-once, not exactly-once**: Crash between claim and settle can cause duplicate sends; Resend idempotency key prevents inbox duplicates but database may show multiple `sent` rows for same occurrence
2. **No retry on transient Resend failures**: Non-2xx settled immediately as `failed` with no retry schedule
3. **Heartbeat lies**: `sweepReminders()` returns normally on individual send failures; heartbeat records success whenever function returns, regardless of `result.failed`
4. **Archived members can receive reminders**: Delivery query joins `tasks.member_id` to `public.members` checking only `disabled=false`, not active `account_members` membership
5. **Disabled users assignable but undeliverable**: UI pickers don't filter `members.disabled`, only delivery fails later

### Context from Story 12.4 (Stripe Billing)

Story 12.4 built the Stripe billing infrastructure:
- `subscription` table gains Stripe columns: `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `last_stripe_event_at`, `provisioning_source`
- `stripe_events` ledger table with PK on `event_id` for idempotency
- `workers/billing/subscriptionState.ts` with `mapStripeStatus()` pure function
- `workers/billing/resolveAccount.ts` for account discovery from Stripe customer id
- `workers/shared/cors.ts` for browser routes
- Checkout, Portal, and webhook routes in `workers/billing/index.ts`
- SPA components: `SubscribeButton`, `BillingReturnNotice`, `ManageSubscriptionButton`

**Known issues from adversarial review:**
1. **Test-mode events can grant production entitlement**: `event.livemode` stored but never checked before applying subscription patch
2. **Webhook ledger poisons retries**: Event inserted before mutation; mutation failure → 500 → retry → deduped without retrying mutation
3. **Transient account resolution errors become permanent ignores**: `resolveAccountForCustomer()` returns `null` for both unknown customer and query errors
4. **Same-second events incorrectly treated as stale**: Uses `<` not `<=` for timestamp comparison; Stripe second precision causes collisions
5. **Checkout grants before delayed payment succeeds**: Maps `checkout.session.completed` to `active` without checking `payment_status` or handling async events
6. **Concurrent checkout can create multiple Stripe customers**: Read-then-create race; unique constraint on non-null customer ids only
7. **`single` role can pay but never use entitlement**: No role guard on billing route or Worker
8. **Manual subscribers shown broken Manage button**: `provisioning_source='manual'` rows render `ManageSubscriptionButton` but `/portal` returns 404
9. **Stripe return URLs bypass HashRouter**: Built as `/billing...` not `/#/billing...`
10. **Preview deployments cannot exercise billing**: CORS allowlist hard-coded, doesn't derive from `APP_ORIGIN`
11. **No live-mode objects exist**: Product `prod_V1bIMx10dzcDFB` and both prices are test-mode only

### Architecture Constraints

- **AD-7 (Compute Home)**: Workers are the compute home for cron and billing. All tenant table access must go through `forAccount(accountId, env)` scoped client. The webhook carve-out is `resolveAccountForCustomer()` — exactly one unscoped query to discover account from Stripe customer id.
- **AD-13 (Reminders)**: Email is the guaranteed floor via Resend; no outbound SMS ever. Reminders are polymorphic (`target_type ∈ {shadchan, shidduch, reference, single}`).
- **AD-16 (Billing)**: Stripe webhook signature-verified; card data never touches us (hosted Checkout + Portal, PCI SAQ-A). Provider is synced source of truth for `subscription` row.
- **AD-17 (Abuse Prevention)**: Fail-closed on paid paths. Rate-limiting on expensive surfaces via Upstash Redis token-bucket.

### Deployment Prerequisites (Epic 12 Gate G1)

Gate G1 is **discharged** — Cloudflare Workers now deploy:
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist as GitHub secrets
- `myshadchan.workers.dev` subdomain registered
- First green `deploy-workers` run: 30743735202
- All five Workers (`ingest`, `parse`, `match`, `ai`, `cron`) uploaded and live at `https://myshadchan-<worker>.myshadchan.workers.dev/health`

**Still required for this story:**
- `RESEND_FROM` secret (verified sending domain in Resend) — absent as of 2026-08-02
- Cron Worker schedule enabled (`[triggers]` uncommented in `workers/cron/wrangler.toml`)
- Live-mode Stripe objects and secrets (depends on Story 14.1 for legal URLs)
- Billing Worker URL pinned (custom domain or explicit `workers_dev`)

### Testing Standards

- **Frontend**: `vitest-browser-react` in real Chromium with ra-core's `TestMemoryRouter`. React Testing Library is NOT a dependency. Components must mount inside `<CoreAdminContext>` / `<TestMemoryRouter>`.
- **Workers**: Node project (`npm run test:unit:workers`); Hono apps exercised via `app.request()`.
- **Database**: `npm run test:unit:db` shells out to `psql`, skips when local stack down, throws in CI. Uses `bailIfDbUnreachable()` pattern.
- **E2E**: Playwright specs in `e2e/`; deterministic waits (`waitForResponse` / `expect(locator).toBeVisible()`), never `waitForTimeout`.
- **No test may contact live Stripe or Resend**. Signatures generated locally with `stripe.webhooks.generateTestHeaderString`; Stripe client mocked at module level.

### File Structure Notes

This story creates **observation artefacts**, not source code. Any fixes required by failed observations are defects against:
- Story 12.2 (reminder delivery): `workers/cron/`, `workers/shared/resend.ts`, `supabase/schemas/02_functions.sql` (RPCs), `reminders/ReminderDeliveryStatus.tsx`
- Story 12.4 (Stripe billing): `workers/billing/`, `workers/shared/cors.ts`, `workers/shared/forAccount.ts`, `billing/` SPA components

The observation record should be created at:
```
_bmad-output/observations/12-5-observed-delivery-live-billing-<YYYY-MM-DD>.md
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md:1711-1756] — Story 12.5 definition in Epic 12
- [Source: _bmad-output/planning-artifacts/phase1-completeness-audit-2026-08-09.md§A] — Three unobserved items: 12.2 AC-10, 12.4 AC-14, live-mode billing
- [Source: _bmad-output/epic-12-adversarial-review-report-2026-08-07.md] — 19 findings on Epic 12 implementation
- [Source: _bmad-output/implementation-artifacts/12-2-reminder-delivery.md] — Story 12.2 context, known issues, completion notes
- [Source: _bmad-output/implementation-artifacts/12-4-stripe-billing.md] — Story 12.4 context, known issues, completion notes
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-7] — Compute home, scoped client rule
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-13] — Reminders polymorphic, email floor
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-16] — Billing provider sync, Checkout + webhook
- [Source: .claude/rules/migration-guard-integrity.md] — Guard nobody watched fail is not evidence
- [Source: .claude/rules/security-triggers.md] — Security review triggers (RLS, grants, migration, auth headers, external APIs, payment code)
- [Source: .claude/rules/testing.md] — AAA, isolation, deterministic Playwright waits
- [Source: AGENTS.md] — Column-order trap, empty-table trap, `--db-url` trap, migration safety

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List