# Epic 12 Adversarial Review Report

Date: 2026-08-07

Skill used: `bmad-review-adversarial-general`

## Scope Reviewed

Epic 12 was reviewed as a completed implementation package rather than as a planning document in
isolation:

- Epic contract: `_bmad-output/planning-artifacts/epics.md`, Epic 12
- Story 12.1: `_bmad-output/implementation-artifacts/12-1-dashboard-reminders-card.md`
- Story 12.2: `_bmad-output/implementation-artifacts/12-2-reminder-delivery.md`
- Story 12.3: `_bmad-output/implementation-artifacts/12-3-family-shared-tasks.md`
- Story 12.4: `_bmad-output/implementation-artifacts/12-4-stripe-billing.md`
- Landed commits: `f1a6b4c`, `47cc239`, `4446540`, `a623503`, and reconciliation commit
  `3ead2a6`
- Current frontend, Worker, declarative-schema, migration, deployment-workflow, and targeted test
  implementation at `HEAD` (`3ead2a6`)

The findings below are intentionally unranked, as required by the selected review skill.

## Findings

- **The epic declares its infrastructure gate discharged while explicitly admitting that the
  operational definition of done is unmet.** The section is titled “Phase-1 Completion &
  Operational Readiness,” calls G1 discharged, and then states that neither Worker has deployed
  since the code landed, no live reminder email has arrived, and no Stripe event has reached the
  running webhook. Story 12.2 AC-10 and Story 12.4 AC-14 remain unsatisfied. Credentials existing
  is not the same event as deployment working, and changing a blocking gate into “three remaining
  definition-of-done items” does not close it. Epic status should remain incomplete until the
  public health checks, one real inbox delivery, one real signed Stripe event, and the matching
  database rows are observed. References: `_bmad-output/planning-artifacts/epics.md:1453-1503`,
  `_bmad-output/implementation-artifacts/12-2-reminder-delivery.md:828-836`,
  `_bmad-output/implementation-artifacts/12-4-stripe-billing.md:878-885`.

- **Archiving a household member can send that former member future household reminders.** The
  assignment story deliberately keeps historical `tasks.member_id` after
  `account_members.status` becomes `archived`, but the delivery query resolves recipients by
  joining `tasks.member_id` directly to `public.members` and checks only `members.disabled =
  false`. It never proves that the recipient still has an active membership in the task's own
  `account_id`. A removed spouse therefore remains a valid email recipient as long as their global
  member row is enabled. The queue query must join active `account_members` on both user and task
  account, and the test suite needs an archived-but-not-disabled recipient case. References:
  `supabase/schemas/02_functions.sql:4882-4903`,
  `_bmad-output/implementation-artifacts/12-3-family-shared-tasks.md:220-231`.

- **Disabled users remain visible and assignable even though delivery later treats them as an
  invalid recipient.** `context_members` filters membership status but not `members.disabled`,
  and `validate_task_assignee()` repeats the same omission. A disabled account can therefore
  appear in every picker and pass the database guard as an “active member”; only when the reminder
  becomes due does Story 12.2 classify the assignment as failed. The roster view and validator
  must share the delivery system's enabled-member definition, or the product is knowingly
  accepting assignments it cannot execute. References: `supabase/schemas/03_views.sql:413-424`,
  `supabase/schemas/02_functions.sql:2562-2585`,
  `supabase/schemas/02_functions.sql:4898-4900`.

- **The “exactly once, idempotent by construction” reminder guarantee is false across the
  external email boundary.** The database marks as many as 100 rows `sending`, the Worker calls
  Resend, and only afterward performs a separate settle RPC. A crash before the send strands the
  row without sending; a crash after Resend accepts the email but before settlement strands a
  delivered row as `sending`. There is no recovery lease for `sending`, and adding one without a
  provider idempotency key would create duplicate-email risk. Worse, one settlement failure aborts
  the loop after the entire batch has already been claimed, stranding every not-yet-processed row
  in that batch. This is at-most-once in some failure paths and unknown-once in others, not exactly
  once. References: `_bmad-output/planning-artifacts/epics.md:1551-1557`,
  `supabase/schemas/02_functions.sql:4936-4967`, `workers/cron/sweepReminders.ts:172-216`.

- **Every transient Resend failure is converted into a permanent delivery failure.** A non-2xx or
  transport error is settled immediately as `failed`; the claim RPC selects only `pending`; and
  the unique `(task_id, channel, due_date)` key prevents the same due occurrence from being
  enqueued again. There is no retry schedule, retryable/terminal classification, next-attempt
  timestamp, or user-visible recovery action. A momentary Resend outage therefore silently defeats
  the story's core promise that reminders reach the user. References:
  `workers/cron/sweepReminders.ts:199-213`, `supabase/schemas/02_functions.sql:4947-4953`,
  `supabase/schemas/01_tables.sql:149-180`.

- **Settings can say “Reminder emails — Sending” while every email attempt is failing.**
  `sweepReminders()` returns normally when individual sends fail, and the scheduled handler records
  a successful heartbeat whenever the function returns, regardless of `result.failed`. The UI
  derives “Sending” solely from a recent `last_ok_at`; it exposes neither failed counts nor the
  transport state. Missing/invalid Resend credentials can consequently produce a green heartbeat
  and a permanently failed queue. The heartbeat needs to distinguish sweep liveness from delivery
  health, and the UI copy must not claim delivery when it has only proved that the cron callback
  ran. References: `workers/cron/sweepReminders.ts:180-216`, `workers/cron/index.ts:82-99`,
  `src/components/atomic-crm/reminders/ReminderDeliveryStatus.tsx:86-134`.

- **The deployment workflow publishes cron and billing code before validating or attaching their
  required secrets, and missing secrets do not fail either matrix leg.** Plain `wrangler deploy`
  runs first for both Workers. The later secret steps are conditional skips when any binding is
  absent, not fail-loud preflight checks; each `wrangler secret put` also creates another live,
  partially configured version. The workflow already documents and fixes this exact class for
  `ai`/`parse` but explicitly leaves cron and billing on the unsafe path. On a first cron deploy,
  the armed schedule can claim and permanently fail reminders before Resend is configured. On a
  billing deploy, a registered Stripe endpoint can receive 500s during the configuration window.
  Both Workers need required-secret validation before upload and one atomic upload/promotion.
  References: `.github/workflows/deploy.yml:364-382`, `.github/workflows/deploy.yml:500-542`.

- **The Stripe event ledger poisons retries when subscription mutation fails.** The handler inserts
  `event.id` into `stripe_events` before attempting the subscription update. If the later mutation
  fails, the handler returns 500, correctly prompting Stripe to retry; the retry then hits the
  ledger's primary key and returns 200 `{deduped:true}` without retrying the failed mutation. A
  transient database failure thus becomes permanent entitlement drift. Recording “received” and
  recording “processed successfully” must be distinct states, or the ledger insertion and domain
  mutation must be one database transaction. References: `workers/billing/index.ts:269-286`,
  `workers/billing/index.ts:303-329`, `workers/billing/resolveAccount.ts:77-102`. Stripe's own
  webhook guidance describes duplicate suppression in terms of events already **processed**, not
  events merely received: <https://docs.stripe.com/webhooks>.

- **A transient account-resolution error is silently converted into a permanently ignored Stripe
  event.** `resolveAccountForCustomer()` deliberately returns `null` for both a genuine unknown
  customer and any query/transport error. The caller then records the event with `account_id =
  null` and returns 200 `{ignored:true}`. Because the event id is now in the ledger, even a manual
  resend after the database recovers is deduplicated. “Unknown customer” is a business outcome;
  “could not query the mapping” is an operational failure and must remain retryable. References:
  `workers/billing/resolveAccount.ts:40-60`, `workers/billing/index.ts:259-293`.

- **Distinct Stripe events created in the same second are incorrectly treated as stale.** The
  epic says an event applies when its timestamp is greater than or equal to the last timestamp,
  but the implementation uses only `last_stripe_event_at < event.created`. Stripe's `event.created`
  value has second precision, so `checkout.session.completed` and
  `customer.subscription.created`, or two legitimate updates, can collide. Whichever event lands
  second is discarded even though it is not older; this can leave price/period fields unset or
  ignore a real status transition. A timestamp alone is not a total event order, and equality
  needs an explicit deterministic rule or object-state reconciliation. References:
  `_bmad-output/implementation-artifacts/12-4-stripe-billing.md:263-274`,
  `workers/billing/subscriptionState.ts:216-279`. Stripe explicitly states that webhook delivery
  order is not guaranteed: <https://docs.stripe.com/webhooks#event-ordering>.

- **Stripe returns users to URLs that bypass the application's HashRouter.** Checkout success,
  checkout cancellation, and Billing Portal return URLs are built as `/billing...`, while this app
  routes billing at `/#/billing`. The reminder Worker correctly uses `/#/reminders`, and the billing
  e2e test's mocked redirect also uses `/#/billing`, thereby masking the production Worker defect.
  A real Stripe return lands at the server path with an empty route fragment, so the billing page
  and `BillingReturnNotice` need not mount at all. References: `workers/billing/index.ts:128-135`,
  `workers/billing/index.ts:195-201`, `workers/cron/sweepReminders.ts:161-169`,
  `e2e/billing-checkout.spec.ts:36-41`.

- **Checkout can grant entitlement before a delayed payment succeeds and never handles the
  corresponding async success/failure events.** `checkout.session.completed` is mapped directly
  to `plan='ai', status='active'` without checking `payment_status`, and the endpoint subscribes to
  neither `checkout.session.async_payment_succeeded` nor
  `checkout.session.async_payment_failed`. This matters because the story explicitly prefers bank
  debit, which is a delayed payment method. Stripe instructs integrations to inspect
  `payment_status` and handle the async events for delayed methods. Either restrict Checkout to
  immediate methods and prove that configuration, or provision only after the appropriate paid
  signal. References: `workers/billing/subscriptionState.ts:120-139`,
  `_bmad-output/implementation-artifacts/12-4-stripe-billing.md:126-143`,
  [Stripe fulfillment guidance](https://docs.stripe.com/checkout/fulfillment#immediate-versus-delayed-payment-methods).

- **Concurrent or partially failed checkout creation can create multiple Stripe customers for one
  account despite AC-8's explicit prohibition.** `/checkout` performs a read-then-create sequence:
  two household members or browser tabs can both observe no stored customer and each create a
  session without `customer`. The unique database constraint is on non-null customer ids, not on
  Stripe's side, so both remote customers already exist before either local upsert wins. The
  handler also discards both the initial select error and the customer-id upsert error, returning a
  successful Checkout URL anyway. Customer creation needs a serialized account-level claim or a
  durable pending-checkout/customer binding, and every database result must be checked. References:
  `workers/billing/index.ts:116-159`,
  `_bmad-output/implementation-artifacts/12-4-stripe-billing.md:310-345`.

- **A `single`-role user can pay through the unguarded billing route but can never observe or use
  the entitlement purchased.** `/billing` has no context/role guard, the Worker authorizes any JWT
  with a current context, and the webhook writes with service role. Yet subscription and AI-usage
  RLS explicitly deny the `single` role; `ai_entitlement()` therefore returns the unentitled
  default for that caller. A direct-route visit can show Subscribe, take payment, and leave the
  purchaser locked out. The UI route and Worker must enforce the same eligible-role contract as
  the entitlement read. References: `src/components/atomic-crm/root/routeManifest.ts:99-104`,
  `workers/billing/index.ts:77-114`, `supabase/schemas/05_policies.sql:1075-1094`.

- **Existing hand-provisioned subscribers are shown a management control that cannot work.** The
  migration deliberately labels every pre-existing subscription `provisioning_source='manual'` and
  leaves it without a Stripe customer id. The Billing page nevertheless renders
  `ManageSubscriptionButton` for every entitled or lapsed account based only on the limited
  `ai_entitlement()` payload. `/portal` then returns 404 for exactly those manual rows. The
  entitlement payload or a dedicated billing-status read must expose whether a Stripe portal is
  available, and manual subscribers need honest alternate copy/action. References:
  `supabase/migrations/20260806235226_stripe_billing_sync.sql:24-45`,
  `src/components/atomic-crm/billing/BillingPage.tsx:143-156`,
  `src/components/atomic-crm/billing/ManageSubscriptionButton.tsx:23-45`,
  `workers/billing/index.ts:185-193`.

- **Test-mode Stripe events can grant entitlement in the production database, and live billing is
  not configured.** `event.livemode` is stored for audit but never checked before applying a
  subscription patch. The story's completion record says the configured product and prices are
  test-mode and that live-mode prices do not exist. If those test secrets are attached to the
  production Worker, a test-card checkout writes a real active subscription into the production
  entitlement table. Environment/mode must be an enforced invariant, not an informational ledger
  column, and operational readiness cannot be claimed before separate live objects and secrets are
  provisioned. References: `workers/billing/index.ts:272-279`,
  `workers/billing/resolveAccount.ts:85-102`,
  `_bmad-output/implementation-artifacts/12-4-stripe-billing.md:878-885`.

- **The dashboard knowingly violates the epic's “each linking to its entity” criterion for
  connection-targeted reminders.** `connection` is a valid `TaskTargetType`, but the dashboard
  resolves only shidduch, shadchan, single, and reference. Its own comment acknowledges that a
  connection-targeted task can exist in the household context and intentionally renders it as
  plain text with no entity label or link. That may be a graceful fallback, but it is not the
  acceptance criterion the epic claims was delivered. Either resolve connections or amend the
  epic criterion explicitly. References: `_bmad-output/planning-artifacts/epics.md:1524-1531`,
  `src/components/atomic-crm/types.ts:84-104`,
  `src/components/atomic-crm/dashboard/useDueReminders.ts:286-313`.

- **Reference resolution on the dashboard is globally truncated and can choose “no link” for a
  reference that has valid links.** Up to three reference ids are queried together, sorted by
  creation time, with one global `perPage: 100`. If one heavily reused reference occupies the
  newest 100 rows, links for the other visible reminders are absent from the response and those
  rows become inert or lose their names even though the database contains valid shidduch links.
  The “best link per reference” rule requires a per-reference top-one query or a database view/RPC,
  not a globally paginated candidate pool. References:
  `src/components/atomic-crm/dashboard/useDueReminders.ts:195-235`,
  `src/components/atomic-crm/dashboard/useDueReminders.ts:267-283`.

- **Nullable due dates remain a deliberately false TypeScript contract and are rendered as 1 Jan
  1970 in the Reminders hub.** The schema permits null and the universal Tasks tab can create a
  task without `due_date`, but `Task.due_date` and all predicates still claim `string`.
  `new Date(null)` is the Unix epoch—not “Invalid Date,” contrary to the source comment—so the hub
  classifies a no-date task as overdue and renders `Since 1 Jan, 12:00 AM`; snoozing it bases the
  new date on now only because the same false overdue result happens to take that branch. The type
  must be widened and every predicate/render path must define the no-due state honestly. References:
  `src/components/atomic-crm/types.ts:109-120`,
  `src/components/atomic-crm/entity360/tabs/TasksTab.tsx:105-125`,
  `src/components/atomic-crm/tasks/tasksPredicate.ts:21-45`,
  `src/components/atomic-crm/reminders/useReminders.ts:192-226`,
  `src/components/atomic-crm/reminders/ReminderCard.tsx:75-84`.

- **Preview deployments cannot exercise billing even though the story requires a preview Worker
  URL.** CORS is hard-coded to the two production domains and two localhost origins; it does not
  derive from `APP_ORIGIN` and cannot admit Vercel preview origins. A preview bundle with
  `VITE_BILLING_WORKER_URL` configured still fails the browser preflight. Either preview billing is
  intentionally unsupported and the story/configuration claims must say so, or the allowlist needs
  a safe preview-origin strategy. References: `workers/shared/cors.ts:56-65`,
  `workers/shared/cors.ts:85-121`,
  `_bmad-output/implementation-artifacts/12-4-stripe-billing.md:139-145`.

## Validation Notes

- `npm run typecheck` passed.
- Targeted Worker tests passed: 8 files, 93 tests (`workers/cron`, `workers/billing`).
- Targeted app tests passed: 22 files, 128 tests (Epic 12 dashboard, task, reminder-status, and
  billing paths).
- Targeted database suites against the shared local stack on port 54322 did not run green because
  that database has not applied the Epic 12 migrations: `task_notifications`, `cron_heartbeat`,
  and `stripe_events` are absent and the physical `subscription` shape predates the Stripe columns.
  This is consistent with the epic's own statement that the pending code has not deployed; it is
  not treated above as independent proof of a source defect.
- No source or test files were changed by this review.
