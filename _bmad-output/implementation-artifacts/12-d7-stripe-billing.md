# Story 12.D7: Stripe billing — checkout, webhook, and the subscription lifecycle

Status: blocked — becomes ready-for-dev the moment the deployment prerequisite below is
discharged. Everything else in the story is buildable and testable today.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the platform owner,
I want an account to be able to pay for the AI tier through Stripe, and Stripe's own subscription
state to be synced into the `subscription` row that `ai_entitlement()` already reads,
so that the paid tier stops being a "contact us" stub — without adding a second thing that can
decide whether an account is entitled.

## Identifier — why `12.D7`

This is not an Epic 1-11 story. It comes from the mobile gap analysis's **Category D** (orphaned
gaps: present in the mockups, absent from the app, owned by no story), item **D7**, which the owner
has since adopted. Four D-items were adopted in the same pass and are being written concurrently by
sibling agents.

The corpus convention is `<epic>-<n>-<slug>.md`. A flat `12-1-…` would have four agents racing for
the same slot in the same wave, so each adopted orphan takes its **own gap-brief ID** as the story
number: `12-d7-stripe-billing.md` → "Story 12.D7". The D-numbers are unique by construction, they
are traceable back to the analysis that produced them, and they sort cleanly. **Epic 12** is
proposed as *Commerce & Operational Readiness* — the home for the adopted orphans that are neither
a 360 surface nor an AI surface. A later agent owns placing these in `epics.md` and may renumber
`12.D7` → `12.N`; nothing inside this file depends on the number.

## Blocking dependency — the billing Worker has never deployed. Read this first.

**There is no running billing Worker, so there is nowhere for a Stripe webhook to arrive.** This is
not a caveat at the end of the story; it is the first thing that has to be true, and it is an
owner/infrastructure action, not a coding task.

The evidence, from the repo (verified 2026-07-30):

- `.github/workflows/deploy.yml:222-288` — the `deploy-workers` job runs a 7-way matrix
  (`ingest, parse, match, ai, share, cron, billing`). **Every** step that does anything is guarded
  by `if: ${{ env.IS_CLOUDFLARE_CONFIGURED }}`, where
  `IS_CLOUDFLARE_CONFIGURED: ${{ secrets.CLOUDFLARE_API_TOKEN && secrets.CLOUDFLARE_ACCOUNT_ID }}`
  (`:241`). With either secret absent, the only step that runs is
  `Cloudflare deployment skipped` (`:285-288`) — which writes a warning to the job summary and
  **exits 0**. The job is green. Seven workers have "deployed" green, seven times, and shipped
  nothing.
- The Stripe secrets are pushed by a step gated *twice over* — on `IS_CLOUDFLARE_CONFIGURED`
  **and** on `env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET` (`:278-283`). Missing Stripe
  secrets are also a silent skip.
- No `wrangler.toml` in `workers/*` declares `routes` or `workers_dev`
  (`grep -n "route\|workers_dev" workers/*/wrangler.toml` → no matches). **Nothing in the repo
  pins the URL the worker would answer on.** A Stripe webhook endpoint is registered once, by
  hand, against a specific URL; that URL has to be a decision, not a default nobody wrote down.

**What must exist before this story's webhook half can be verified end to end** (owner actions):

1. A Cloudflare account, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set as GitHub
   Actions secrets.
2. A decided, stable public URL for `myshadchan-billing`: either a custom-domain `route` in
   `workers/billing/wrangler.toml` (e.g. `billing.myshadchan.space`) or an explicit
   `workers_dev = true` and the resulting `myshadchan-billing.<subdomain>.workers.dev`. Task 1
   writes whichever the owner picks into the file — it is not left to wrangler's default.
3. A Stripe account in **test mode first**, with a Product and two Prices for the AI tier
   ($2/month, $24/year — `billing/billingPlans.ts:8-9`), and the price IDs available as secrets.
   AD-16's fee posture (bank debit preferred over cards, because 2.9%+30¢ is ≈18% of $2) is a
   Stripe *payment-method configuration* choice made in the dashboard, not code — record which
   methods are enabled.
4. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as GitHub Actions secrets (the CI step at
   `:278-283` already pushes both to the billing worker; no workflow edit is needed for them),
   plus `STRIPE_PRICE_ID_MONTHLY` / `STRIPE_PRICE_ID_YEARLY` and `APP_ORIGIN`, which **do** need a
   new CI step (Task 1).
5. A webhook endpoint registered in Stripe pointing at `<worker URL>/webhook`, subscribed to the
   five event types in AC-6.
6. `VITE_BILLING_WORKER_URL` set in the Vercel project (production + preview) and in
   `.env.development` / `.env.e2e`.

**Do not design around this.** The alternative that would dodge it — moving checkout and the
webhook into a Supabase Edge Function, since `deploy-supabase` (`.github/workflows/deploy.yml:13-49`)
*does* deploy — is explicitly rejected: AD-16 names a `billing/` Worker, the worker exists with its
health route, its test file, its wrangler config and its CI secret-push step already written, and
the other six workers are blocked on exactly the same two secrets. Solving it once unblocks all
seven. Record the decision; do not quietly relocate the code.

**What is buildable before the prerequisite lands:** everything except AC-14. The worker's routes,
the signature verification, the idempotency ledger, the status mapping and the SPA half are all
unit-testable offline (AC-11) against `app.request()` and mocked Stripe, exactly as
`workers/billing/index.test.ts` already tests the stub. Build it, land it, and let AC-14 be the
gate on calling the story done.

## The invariant this story must not weaken

The entitlement model is already built, already server-authoritative, and already hardened. **This
story adds a writer, not a decider.**

- `public.ai_entitlement()` (`supabase/schemas/02_functions.sql:2874-2929`) is the single answer to
  "may this account spend inference?". It is `STABLE`, security **invoker**, resolves the account
  with `current_context_id()`, and returns `is_entitled` only when `plan = 'ai' AND status =
  'active'` (`:2911`). `'lapsed'` is explicitly **not** entitled.
- `public.subscription` (`01_tables.sql:541-554`) is one row per account
  (`subscription_account_id_key`, `:771-772`), with `plan in ('free','ai')` and
  `status in ('active','lapsed','none')`.
- It is **SELECT-only** for `authenticated`: RLS is on with a single SELECT policy and *no*
  insert/update/delete policy (`05_policies.sql:534-540`), and grants are
  `revoke all … ; grant select … to authenticated; grant all … to service_role`
  (`06_grants.sql:698-700`). There is no RPC, no policy and no grant by which a browser sets
  `plan='ai'`.
- `accounts.stripe_customer_id / subscription_status / plan / current_period_end / trial_end`
  (`01_tables.sql:117-121`) are a **decoy**: legacy schema-readiness columns, unused, and
  deliberately made non-writable by clients (`06_grants.sql:662-686` revokes table UPDATE and
  re-grants it on `name, transparency_level, data_region` only). `grep` confirms **nothing in
  `src/`, `supabase/schemas/`, `workers/` or `scripts/` reads them.**

So: Stripe becomes the source of truth **for the `subscription` row**. The row remains the only
gate. AD-16's own wording ("syncs to `accounts` (`stripe_customer_id`/`subscription_status`/
`plan`/`current_period_end`/`trial_end`)") describes a schema this codebase deliberately superseded
in E4 — the shipped `subscription` table won that argument, and its table comment says why
(`01_tables.sql:533-540`). **Follow the schema, not AD-16's column list**, and write nothing to the
five `accounts` columns. AC-1 asserts this.

## Acceptance Criteria

1. **The entitlement authority does not move, and the decoy stays a decoy.** After this story:
   `public.ai_entitlement()`'s function body in `supabase/schemas/02_functions.sql` is
   byte-identical to before; `subscription`'s RLS policy set and grants are unchanged (still one
   SELECT policy, still no write grant to `authenticated`); and no new RPC, policy or grant gives a
   browser any write path to `plan`/`status`. The billing worker writes **only** to
   `public.subscription` and `public.stripe_events` — never to `public.accounts`.
   **Failing looks like:** `git diff` on the story's branch shows any change inside
   `CREATE OR REPLACE FUNCTION "public"."ai_entitlement"()`; or
   `grep -rn "stripe_customer_id\|subscription_status\|trial_end" workers/billing/` returns a hit
   against `public.accounts`; or `npm run test:unit:db` reports a failure in
   `billing_entitlement.sql`'s "no client-callable path lets a member self-grant entitlement"
   checks (`supabase/tests/billing_entitlement.sql`, the INSERT/UPDATE-refused block).

2. **One migration adds Stripe identity to `subscription` — and backfills the pre-existing rows in
   the same file.** `subscription` gains:
   `stripe_customer_id text`, `stripe_subscription_id text`, `stripe_price_id text`,
   `last_stripe_event_at timestamptz`, and
   `provisioning_source text not null check (provisioning_source in ('manual','stripe'))`.
   The `provisioning_source` column is added **`default 'manual'` and then re-defaulted** in the
   same migration:

   ```sql
   alter table public.subscription
       add column provisioning_source text not null default 'manual';
   alter table public.subscription
       alter column provisioning_source set default 'stripe';
   ```

   Two unique partial indexes: `unique (stripe_customer_id) where stripe_customer_id is not null`
   and `unique (stripe_subscription_id) where stripe_subscription_id is not null`.
   **Why the two-step default is mandatory, not stylistic:** every `subscription` row that exists
   today was written by hand under `service_role` — that is literally what the shipped Billing page
   tells users to ask for ("Contact us to turn on the AI tier for your account",
   `billing/BillingPage.tsx:157-160`). Adding the column with `default 'stripe'` labels every one of
   those accounts as Stripe-owned, and the first reconciliation pass (AC-10) then finds no matching
   Stripe subscription and lapses a paying customer. This is the `member_state` failure shape
   exactly: a fail-closed rule shipped without backfilling the rows that predate it.
   **Failing looks like:** after `npx supabase migration up --local` against a database seeded with
   one hand-provisioned row,
   `select provisioning_source from public.subscription where stripe_subscription_id is null;`
   returns `stripe`.

3. **The same migration adds a service-role-only event ledger.**
   `public.stripe_events (event_id text primary key, type text not null, account_id bigint
   references public.accounts(id) on delete set null, received_at timestamptz not null default
   now(), livemode boolean not null default false)`. RLS **enabled with zero policies**;
   `revoke all on table public.stripe_events from anon, authenticated;`
   `grant all on table public.stripe_events to service_role;` — and the same treatment for its
   sequence if one exists. The table is new and empty, so — unlike AC-2 — it needs no backfill;
   state that in the migration comment rather than leaving a reader to wonder.
   The primary key on `event_id` **is** the idempotency mechanism (AC-5); it is not decoration.
   **Failing looks like:** a `psql` session with `set local role authenticated` and a valid JWT
   claim can `select * from public.stripe_events` (it must error or return zero rows by RLS, and
   the grant revoke must make it error).

4. **`POST /webhook` verifies the Stripe signature before it parses anything.** In
   `workers/billing/index.ts`, replacing today's 501 stub (`workers/billing/index.ts:17-22`):
   - No `stripe-signature` header → `400` `fail("missing stripe-signature header")` — the existing
     behaviour and the existing test in `workers/billing/index.test.ts:17-27` stay green.
   - `STRIPE_WEBHOOK_SECRET` unset → `500` `fail("billing not configured")`. There is **no** code
     path that skips verification when the secret is missing.
   - The handler reads `await c.req.text()` and passes that raw string to
     `stripe.webhooks.constructEventAsync(raw, sig, secret, undefined, Stripe.createSubtleCryptoProvider())`.
     `c.req.json()` is never called on this route: parsing before verifying is the classic bypass,
     and it also destroys the exact bytes the HMAC covers.
   - Signature mismatch, or a timestamp outside Stripe's default tolerance → `400`
     `fail("invalid signature")`, with **no** database call of any kind.
   **Failing looks like:** `grep -n "req.json()" workers/billing/index.ts` returns a line inside the
   webhook handler; or a unit test that mutates one byte of a validly-signed body still gets a 2xx.

5. **Replays and out-of-order deliveries change nothing.** On a verified event, the handler first
   inserts `{event_id, type, account_id, livemode}` into `stripe_events`. A unique-key violation
   (Postgres `23505`, surfaced by PostgREST as HTTP 409) → return `200` `ok({ deduped: true })`
   **without touching `subscription`**. Stripe retries a non-2xx for up to 3 days, so a duplicate
   must be a cheap, successful no-op, not an error.
   Ordering: the handler applies a subscription mutation only when
   `to_timestamp(event.created) >= coalesce(subscription.last_stripe_event_at, '-infinity')`; an
   older event returns `200` `ok({ stale: true })` and writes nothing. Every applied mutation sets
   `last_stripe_event_at = to_timestamp(event.created)` in the same update.
   **Failing looks like:** posting the identical signed payload twice and observing
   `subscription.updated_at` change on the second call; or delivering
   `customer.subscription.deleted` (created=T+10) followed by a re-delivered
   `customer.subscription.updated` with `status: "active"` (created=T) and finding
   `ai_entitlement().is_entitled = true`.

6. **The Stripe→domain status map is one exported pure function, total over Stripe's enum.**
   `mapStripeStatus(status: string): { plan: SubscriptionPlan; status: SubscriptionStatus }` in a
   new `workers/billing/subscriptionState.ts`:

   | Stripe subscription status | → `plan` | → `status` |
   |---|---|---|
   | `active`, `trialing` | `ai` | `active` |
   | `past_due`, `unpaid`, `canceled`, `incomplete_expired`, `paused` | `ai` | `lapsed` |
   | `incomplete` | `free` | `none` |
   | anything else (unknown / future Stripe value) | `free` | `none` |

   Handled event types, and nothing else:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`. Any other event type is recorded in
   `stripe_events` and answered `200` — never 400, never 500 (an unhandled type returning non-2xx
   puts the endpoint into Stripe's retry-and-disable loop).
   The function's codomain is constrained by the database: `subscription_plan_check` and
   `subscription_status_check` (`01_tables.sql:552-553`) permit only those five literals, so any
   other return value is a check-constraint violation at write time, not a silent wrong state.
   **Failing looks like:** a unit test that iterates Stripe's documented status list and finds a
   value the map does not handle explicitly; or `past_due` mapping to `active`; or the map being
   inlined as a `switch` inside the request handler where it cannot be tested without a request.

   *Ruling recorded here so it is not re-litigated mid-build:* `past_due` **pauses entitlement
   immediately** rather than holding a grace window. AD-17 is explicit — "fail-closed on the paid
   AI paths" — and the pause is fully reversible: Stripe's own dunning continues, and a successful
   retry emits `customer.subscription.updated` with `status: active`, which flips the row back
   within seconds. The user-facing copy for this state already exists and already says the right
   thing (`BillingPage.tsx:83-95`: "Your AI tier has paused… Nothing is lost… Renew whenever you
   like."). If the owner later prefers a grace window, it is a one-row change in the table above
   plus its test — do not build a second mechanism for it.

7. **A lapse is a pause, never a deletion.** `customer.subscription.deleted` **updates** the row to
   `plan='ai', status='lapsed'` and clears `stripe_subscription_id`; it never `DELETE`s the
   `subscription` row and never touches `public.ai_usage`. Deleting the row would reset the account
   to the no-row default, which `ai_entitlement()` reports as `plan='free', status='none'`
   (`02_functions.sql:2909-2910`) — and `BillingPage`'s lapsed banner keys on
   `info.status === "lapsed"` (`BillingPage.tsx:35`), so the calm "your AI tier has paused" message
   would silently never render for anyone who actually lapsed.
   **Failing looks like:** after a `customer.subscription.deleted` event,
   `select count(*) from public.subscription where account_id = <acct>` is 0, or
   `ai_entitlement() ->> 'status'` is `'none'` rather than `'lapsed'`; or the account's
   `ai_usage` row for the current period disappeared.

8. **`POST /checkout` creates a session and grants nothing.** Authenticated by the caller's own
   JWT: `Authorization: Bearer <token>` required (`401` `fail("missing Authorization header")`
   otherwise); the worker builds a caller-scoped Supabase client with the **publishable** key and
   the forwarded header, and resolves the account with `.rpc("current_context_id")` — which is
   `SECURITY DEFINER` and granted to `authenticated` (`06_grants.sql:224-227`), and is the same
   account `ai_entitlement()` will later read (`02_functions.sql:2890`). A null result → `403`
   `fail("no active context")`.
   It then creates a Stripe Checkout Session: `mode: "subscription"`, the price selected from
   `{monthly|yearly}` in the request body, `client_reference_id: String(accountId)`,
   `metadata: { account_id: String(accountId) }`, `customer` reused when the account already has a
   `stripe_customer_id` (never a second customer for the same account),
   `success_url: ${APP_ORIGIN}/billing?checkout=success`,
   `cancel_url: ${APP_ORIGIN}/billing?checkout=cancelled`. Response: `ok({ url })`.
   **This route writes no entitlement.** It may write `stripe_customer_id` onto the account's
   `subscription` row; it must never write `plan` or `status`.
   **Failing looks like:** completing a Checkout with the webhook endpoint disabled in Stripe and
   finding `ai_entitlement().is_entitled === true`. (`false` is the correct outcome there — if it
   is `true`, `/checkout` is granting entitlement and must be reverted.) Also failing: a second
   Checkout by the same account creating a second Stripe customer.

   *Known and intended consequence, stated so nobody reads it as a bug:* `current_context_id()`
   returns the caller's **active context**, which post-Epic-2 may be a shadchanus context as well as
   a household. Payment therefore entitles the context that was active at checkout. That is the
   same scoping `ai_entitlement()` already uses, and `subscription`'s own table comment records the
   open question deliberately (`01_tables.sql:576`). Do not invent a different rule here.

9. **`POST /portal` is the only upgrade / downgrade / cancel / card-update surface.** Same JWT
   authentication as AC-8; returns `ok({ url })` for a Stripe Billing Portal session bound to the
   account's `stripe_customer_id`, with `return_url: ${APP_ORIGIN}/billing`. An account with no
   `stripe_customer_id` → `404` `fail("no subscription")`; the route never creates a customer.
   Consequently **no plan-change, cancel, or payment-method UI is built in the SPA** — that is what
   keeps card data out of our systems (PCI SAQ-A, AD-16) and what makes downgrade/cancel free
   rather than four more screens. Every lifecycle change made in the portal comes back as a
   `customer.subscription.updated` / `.deleted` webhook and lands via AC-6.
   **Failing looks like:** any component under `src/components/atomic-crm/billing/` rendering a
   Cancel, Change-plan, or card-entry control that calls anything other than the `/portal` redirect;
   or Stripe.js / `@stripe/*` appearing in `package.json` (a hosted-redirect flow needs neither, and
   pulling in Elements would put card fields on our origin and change the PCI posture).

10. **Reconciliation never touches hand-provisioned rows.** If the story ships any reconciliation —
    a scheduled sweep that lapses a `subscription` whose Stripe counterpart is gone (`workers/cron`
    is the natural home) — its query is `where provisioning_source = 'stripe'`, full stop. An
    account with `provisioning_source = 'manual'` is out of scope for every automated lapse.
    If no sweep ships in this story, this AC is satisfied by there being no such query at all —
    but the column and its backfill (AC-2) still ship, because the sweep is inevitable and the
    backfill must predate it.
    **Failing looks like:** `grep -rn "provisioning_source" workers/` finding a lapse/update query
    that does not filter on `= 'stripe'`.

11. **Exactly one unscoped tenant query exists in the worker, and it is named.** AD-7 makes
    `forAccount(accountId, env)` (`workers/shared/forAccount.ts:31`) "the only way a Worker touches
    a tenant table". A webhook cannot obey that literally: it arrives holding a Stripe customer id
    and must *discover* the account before it can scope anything. The carve-out is a single
    purpose-built helper, `resolveAccountForCustomer(customerId, env): Promise<number | null>` in a
    new `workers/billing/resolveAccount.ts`, which is the only place in `workers/billing/` that
    calls `createClient(...)` with `SUPABASE_SERVICE_ROLE_KEY`, and which issues exactly one query:
    `select account_id from subscription where stripe_customer_id = $1`. Everything downstream goes
    through `forAccount(accountId, env)`. `forAccount`'s `ScopedTable` gains an `upsert(values, {
    onConflict })` that injects `account_id` exactly as `insert` does — needed because
    `subscription.account_id` is unique and a select-then-insert would race a concurrent event.
    **Failing looks like:** `grep -n "createClient(" workers/billing/*.ts | grep -v "\.test\."`
    returning more than one line; or a `.from("subscription")` call in the worker that is not
    reached through `forAccount`.

12. **CORS is opened for the browser routes and closed for the webhook.** The SPA runs on
    `myshadchan.space` and the worker on another origin, so `/checkout` and `/portal` need a real
    preflight answer: a new `workers/shared/cors.ts` middleware echoing an **allowlisted** origin
    (from an `APP_ORIGIN` binding), `Access-Control-Allow-Methods: POST, OPTIONS`,
    `Access-Control-Allow-Headers: Authorization, Content-Type`, and an `OPTIONS` responder. No
    worker has CORS today (`grep -rn "Access-Control" workers/` → no matches), so this is new shared
    code, and it composes with — does not replace — `securityHeaders`
    (`workers/shared/securityHeaders.ts`). `/webhook` is server-to-server and is **not** given CORS
    headers.
    **Failing looks like:** `Access-Control-Allow-Origin: *` anywhere in `workers/`; or the webhook
    route answering a preflight; or a browser `POST /checkout` from the production origin failing
    preflight (the symptom is a CORS console error and a Subscribe button that does nothing).

13. **The SPA reports entitlement; it never asserts it.** `SubscribeButton` POSTs `/checkout` and
    does `window.location.assign(url)`. On return, `/billing?checkout=success` renders a
    "confirming your payment…" notice and invalidates `AI_ENTITLEMENT_QUERY_KEY`
    (`references/useAiEntitlement.ts:34`) on a bounded schedule (at most 5 attempts, ~2s apart),
    then falls back to "this is taking longer than usual — it will appear here as soon as Stripe
    confirms". `?checkout=cancelled` renders a neutral "no charge was made" line. **At no point does
    any of this render the entitled state**: "You are on the AI tier" (`BillingPage.tsx:124-129`)
    and `isCurrent` both continue to derive solely from `info.is_entitled`, i.e. from
    `ai_entitlement()`.
    **Failing looks like:** with the `ai_entitlement` RPC stubbed to keep returning
    `is_entitled: false`, navigating to `/billing?checkout=success` shows the AI tier as the current
    plan, or hides the Subscribe control, or renders the thank-you copy. That is a client-side
    entitlement grant, which is the one thing E4 was built to prevent.

14. **Verified deployment — the story is not done until a real event arrives.** `GET <worker
    URL>/health` returns `{"success":true,"data":{"worker":"billing","status":"ok"}}` from the
    public internet, and the Stripe dashboard's webhook log shows a **delivered (2xx)**
    `checkout.session.completed` **test-mode** event to `<worker URL>/webhook`, with a matching row
    in `public.stripe_events`.
    **Failing looks like:** the `deploy-workers` job green with `Cloudflare deployment skipped` as
    the step that ran (`.github/workflows/deploy.yml:285-288`) — that is the exact false-green this
    story exists to end. Read the job summary, not the checkmark.

## Tasks / Subtasks

- [ ] **Task 1 — Deployment prerequisite and configuration** (AC: 14; blocking)
  - [ ] Confirm with the owner that `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist as
        repository secrets. If they do not, **stop and report** — the rest of the story can be
        built and unit-tested, but AC-14 cannot be satisfied and the story cannot be closed.
  - [ ] Pin the worker's public URL in `workers/billing/wrangler.toml`: either a `route`/
        `[[routes]]` entry for a custom domain, or `workers_dev = true`. Whichever is chosen,
        write it in the file and in the secrets comment block — the Stripe endpoint is registered
        against it once.
  - [ ] Extend `workers/billing/wrangler.toml`'s secrets comment with the new bindings:
        `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_YEARLY`, `APP_ORIGIN`,
        `SUPABASE_PUBLISHABLE_KEY`.
  - [ ] `.github/workflows/deploy.yml`: extend the existing billing secret-push step
        (`:278-283`) to push the four new values. Keep the existing double guard shape
        (`IS_CLOUDFLARE_CONFIGURED && matrix.worker == 'billing' && …`) — do not loosen it, and do
        not add an `always()`.
  - [ ] Add `VITE_BILLING_WORKER_URL` to `.env.development` and `.env.e2e` (and note that Vercel
        needs it for production and preview). Pick a local dev port for
        `wrangler dev` and record it in a `[dev] port = …` block, mirroring the convention Story
        11.1 introduces for `ai`/`parse` (8788/8789) — take the next free one, and do not take
        8787, which wrangler's default leaves for ad-hoc runs.

- [ ] **Task 2 — Migration: Stripe identity + event ledger + the backfill** (AC: 2, 3)
  - [ ] `supabase/schemas/01_tables.sql`: add the five columns to `public.subscription`, and the
        `public.stripe_events` table. Keep the existing E4 comment block above `subscription`
        intact and extend it — it is the record of *why* the table is SELECT-only, and it is what
        stops the next reader from "helpfully" adding a write policy.
  - [ ] `supabase/schemas/05_policies.sql`: `alter table public.stripe_events enable row level
        security;` and **no policy**. Add a comment saying the absence is deliberate (the same
        shape the billing block at `:526-540` already uses).
  - [ ] `supabase/schemas/06_grants.sql`: `revoke all on table public.stripe_events from anon,
        authenticated; grant all on table public.stripe_events to service_role;`. `subscription`'s
        existing table-level `grant select … to authenticated` (`:699`) already covers the new
        columns — no grant change there, but re-read the block and confirm it is table-level and
        not column-listed before assuming it.
  - [ ] Generate: `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase db diff --local -f
        stripe_billing_sync`, then
        `DBUS_SESSION_BUS_ADDRESS=/dev/null npx supabase migration up --local`. Never `db reset` /
        `db push`. (The `DBUS_SESSION_BUS_ADDRESS=/dev/null` prefix is not optional in this repo —
        without it every `npx supabase` call hangs on the keyring.)
  - [ ] **Hand-edit the generated migration for the backfill — `db diff` cannot produce it.** The
        declarative schema file states only the *final* shape, so it declares
        `provisioning_source text not null default 'stripe'`, and `db diff` will faithfully emit a
        single `add column … default 'stripe'` — which stamps every pre-existing, hand-provisioned
        row as Stripe-owned. That is the AC-2 failure. `db diff` emits **no** data statements
        (the same reason Story 5.9's `shadchanim.notes` backfill had to be hand-added), so open the
        generated file and replace that one line with the two-step form from AC-2:
        `add column … not null default 'manual';` followed by
        `alter column provisioning_source set default 'stripe';`, under a `-- MANUAL ADJUSTMENTS`
        comment explaining why. An equivalent `update public.subscription set provisioning_source =
        'manual' where stripe_subscription_id is null;` placed **after** the `add column` is
        acceptable; the two-step default is preferred because it cannot race a concurrent insert.
  - [ ] Then re-read the whole generated file. `db diff` also never re-emits `security_invoker` on
        a view and does not diff storage-bucket rows — neither applies here (no view, no bucket) —
        but confirm the diff touches nothing but `subscription`, `stripe_events` and their
        grants/policies. An unrelated object in the diff means the schema files were edited from a
        stale dump; re-dump per AGENTS.md before continuing.
  - [ ] Verify the backfill on a seeded row: insert a hand-provisioned `('ai','active')` row
        *before* applying, apply, and assert its `provisioning_source` is `manual` (AC-2's failing
        condition, run deliberately).

- [ ] **Task 3 — Worker: shared plumbing** (AC: 11, 12)
  - [ ] `workers/shared/env.ts`: add `SUPABASE_PUBLISHABLE_KEY: string` to `BaseEnv` **if Story
        11.1 has not already added it** — 11.1 AC-3 adds this exact field. Check first; if it is
        there, import and move on. Two stories adding the same field is a merge conflict on a
        four-line interface.
  - [ ] `workers/shared/cors.ts` (+ `.test.ts`): allowlisted-origin middleware and `OPTIONS`
        responder per AC-12.
  - [ ] `workers/shared/forAccount.ts`: add `upsert(values, { onConflict })` to `ScopedTable` and
        the returned object, injecting `account_id` exactly as `insert` does (`:48-55`). Extend
        `workers/shared/forAccount.test.ts` with a case proving `account_id` is injected on upsert
        and cannot be overridden by the caller's payload.
  - [ ] `workers/billing/resolveAccount.ts` (+ `.test.ts`): the single named service-role lookup
        (AC-11). Return `null`, never throw, when the customer is unknown — an unknown customer is
        a normal event (a Stripe test fixture, another environment sharing the account), and the
        webhook answers `200 ok({ ignored: true })` for it rather than 500ing into Stripe's retry
        loop.

- [ ] **Task 4 — Worker: `/checkout` and `/portal`** (AC: 8, 9)
  - [ ] Add `stripe` to `package.json` dependencies. Construct it with
        `new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() })` — the
        default Node HTTP client does not exist in workerd. `workers/billing/wrangler.toml` already
        sets `compatibility_flags = ["nodejs_compat"]`, so no config change is needed for it.
  - [ ] Implement both routes per AC-8/AC-9, including the caller-scoped client
        (publishable key + forwarded `Authorization`, `auth: { persistSession: false }` — the same
        constructor shape Story 11.1 specifies) and the `current_context_id()` resolution.
  - [ ] Both routes return the `{success,data?,error?}` envelope via `ok()`/`fail()`
        (`workers/shared/envelope.ts`) — the repo-wide Worker convention, and what the existing
        tests assert against.

- [ ] **Task 5 — Worker: the webhook** (AC: 4, 5, 6, 7, 10)
  - [ ] `workers/billing/subscriptionState.ts` (+ `.test.ts`): `mapStripeStatus` per AC-6, plus a
        small `applyEvent` reducer that takes the parsed event and returns the column patch to
        write — keeping the decision logic testable without a request or a database.
  - [ ] `workers/billing/index.ts`: replace the 501 stub with signature verification (AC-4), the
        `stripe_events` insert-first idempotency guard (AC-5), the `resolveAccountForCustomer` →
        `forAccount(...).upsert(...)` write path, and the five handled event types (AC-6). Keep the
        `/health` route and the missing-header 400 exactly as they are; both have live tests.
  - [ ] `checkout.session.completed` is the one event that carries `client_reference_id` — that is
        where the account↔customer binding is established. Every later event resolves the account
        through `resolveAccountForCustomer`. If an event arrives for an unknown customer *and*
        carries no `client_reference_id`, record it in `stripe_events` with a null `account_id` and
        return `200`; do not guess.
  - [ ] `customer.subscription.deleted` updates to `lapsed` and clears `stripe_subscription_id`
        (AC-7). No `DELETE` statement against `subscription` exists anywhere in this worker.

- [ ] **Task 6 — SPA: Subscribe, return states, manage** (AC: 13)
  - [ ] `src/components/atomic-crm/providers/commons/billingClient.ts` (+ `.test.ts`):
        `callBillingWorker<T>(path, body)` — reads the session via
        `getSupabaseClient().auth.getSession()`, POSTs with
        `Authorization: Bearer <access_token>`, parses the envelope, throws
        `new Error(error ?? "Billing request failed")` on `success:false`.
        **Do not route this through Story 11.1's `callAiWorker`.** That helper targets workers
        sitting behind `requireAiEntitlement`, which answers `402` to exactly the population trying
        to pay. They are different clients for different reasons; say so in a comment so a later
        tidy-up does not merge them.
  - [ ] `billing/SubscribeButton.tsx` — replaces `SubscribeStub` (`BillingPage.tsx:149-163`, delete
        it). Loading and error states; on success `window.location.assign(url)`.
  - [ ] `billing/BillingReturnNotice.tsx` — reads `?checkout=` via `useSearchParams`, renders the
        confirming / cancelled / timed-out states, and invalidates `AI_ENTITLEMENT_QUERY_KEY` on the
        bounded schedule in AC-13.
  - [ ] `billing/ManageSubscriptionButton.tsx` — visible only when `info.is_entitled` or
        `info.status === "lapsed"`; POSTs `/portal` and redirects.
  - [ ] **`references/entitlementGate.guard.test.ts` — update `ALLOWED` in the same diff.** That
        guard (`:26-31`) asserts only `useAiEntitlement.ts`, `ResearchAssistantPanel.tsx` and
        `BillingPage.tsx` may reference the entitlement hook, and it matches on the *file content*
        containing the string `useAiEntitlement` — which includes an import of
        `AI_ENTITLEMENT_QUERY_KEY`, since that constant lives in `useAiEntitlement.ts`. Any new
        billing component that imports it becomes an offender and reddens a guard that has nothing
        to do with this story's intent. Either add the new basenames to `ALLOWED`, or keep every
        hook/query-key reference inside `BillingPage.tsx` and pass props down. **Do not delete or
        weaken the guard** — its job (AI is the only paid surface) is precisely what this story
        must not erode.
  - [ ] i18n: the Billing surface currently carries **no** `crm.billing.*` keys in either catalogue
        (`grep -n "billing" providers/commons/englishCrmMessages.ts frenchCrmMessages.ts` → zero
        hits); every string is an inline `translate("crm.billing.…", { _: "default" })`. Follow that
        same pattern for the new copy. If you do add real catalogue entries, add them to **both**
        `englishCrmMessages.ts` and `frenchCrmMessages.ts` — never one. English-only content in a
        committed file is a rule violation regardless (`.claude/rules/english-only.md`), and a
        half-populated catalogue is how the French build starts rendering raw key paths.
  - [ ] No new route. Success/cancel return to the existing `/billing`
        (`BillingPage.path`, `BillingPage.tsx:165`) with a query parameter, so
        `root/routeManifest.ts` is **not** touched and no route-convention or AD-24 surface work is
        pulled in. Resist adding `/billing/success`.

- [ ] **Task 7 — Tests** (AC: 11 verification, and every AC's "failing looks like")
  - [ ] `workers/billing/index.test.ts` — extend, do not rewrite. Its three existing cases
        (`/health`, missing-signature 400, and the 501 stub) must be updated only where the stub
        case is now a real code path. Add: invalid signature → 400 with no DB call; a valid signed
        `checkout.session.completed` binds customer + subscription and writes `ai/active`; the same
        event replayed → `deduped`; an older `customer.subscription.updated` after a
        `.deleted` → `stale`, no write; `customer.subscription.deleted` → `lapsed`, row still
        present; an unhandled event type → 200.
        Sign fixtures with `stripe.webhooks.generateTestHeaderString({ payload, secret })` so the
        signature is real and locally computed — **no network, no live key, no charge**. Mock
        `@supabase/supabase-js` at module level exactly as `workers/shared/forAccount.test.ts`
        already does.
  - [ ] `workers/billing/subscriptionState.test.ts` — the mapping table from AC-6, iterated over
        Stripe's full documented status list plus one bogus value.
  - [ ] `workers/shared/cors.test.ts`, `workers/shared/forAccount.test.ts` (upsert case),
        `workers/billing/resolveAccount.test.ts`.
  - [ ] `supabase/tests/billing_entitlement.sql` **and** its runner
        `billing_entitlement.test.ts` — extend the existing pair; do not add a new one. The
        directory's rule is that every `<name>.sql` has a `<name>.test.ts` alongside it, and a
        `.sql` without a runner never executes. New checks: `authenticated` cannot select
        `stripe_events`; `authenticated` still cannot INSERT/UPDATE `subscription` after the new
        columns exist; a row with `provisioning_source = 'manual'` is untouched by the
        reconciliation predicate; `stripe_customer_id` is unique across accounts. Run with
        `npm run test:unit:db`.
  - [ ] Component tests run in **real Chromium via `vitest-browser-react`**, with
        `StoryWrapper` / `TestMemoryRouter` for anything reading the URL — `BillingReturnNotice`
        needs a router, so it needs `TestMemoryRouter`. **React Testing Library is not a dependency
        of this repo**; do not `import { render } from "@testing-library/react"`. Cover AC-13's
        failing condition explicitly: `ai_entitlement` stubbed unentitled + `?checkout=success` must
        still render the free plan as current.
  - [ ] `e2e/billing-checkout.spec.ts` (new) — `page.route()` fulfils the `/checkout` call with a
        fake URL so **Stripe is never contacted**; assert the button posts once, disables while
        in-flight, and surfaces a readable error on `success:false`. Use deterministic waits
        (`waitForResponse` / `expect(locator).toBeVisible()`), never `waitForTimeout`
        (`.claude/rules/testing.md`).
  - [ ] `npm run typecheck && npm run lint && npx vitest run && npm run test:unit:db`, plus one e2e
        run of the new spec. `npx prettier --config ./.prettierrc.json --check` over every file
        created or touched.

- [ ] **Task 8 — Security review** (AC: 1, 3, 4, 11, 12)
  - [ ] This diff touches RLS policies, grants, a migration, authentication headers, external API
        calls, and payment code — five of `.claude/rules/security-triggers.md`'s eight triggers.
        **Dispatch SECURITY-REVIEWER.** It is not optional here, and "when in doubt" does not apply
        — there is no doubt.

## Dev Notes

### What is already built, and must be reused rather than rebuilt

| Thing | Where | This story's relationship to it |
|---|---|---|
| `ai_entitlement()` | `supabase/schemas/02_functions.sql:2874-2929` | **Unchanged.** Called, never edited. |
| `subscription` table, RLS, grants | `01_tables.sql:541-554`, `05_policies.sql:534-540`, `06_grants.sql:698-700` | Gains columns; its SELECT-only posture is preserved exactly. |
| `ai_usage` meter | `01_tables.sql:560-568` | **Untouched.** A lapse does not reset usage. |
| Billing page, plan cards, usage meter | `billing/{BillingPage,PlanCard,UsageMeter,billingPlans}.tsx/ts` | Reused. Only `SubscribeStub` is replaced. |
| `useAiEntitlementInfo` + shared query key | `references/useAiEntitlement.ts:34-52` | Reused as the *only* read of entitlement in the SPA. |
| Billing worker skeleton, health route, envelope, security headers | `workers/billing/index.ts`, `workers/shared/{createApp,envelope,securityHeaders}.ts` | Reused; the 501 stub is replaced. |
| `forAccount()` | `workers/shared/forAccount.ts` | Reused; gains `upsert`. |
| DB test pair | `supabase/tests/billing_entitlement.{sql,test.ts}` | Extended, not duplicated. |

### Why the webhook, not the checkout return, is the only writer

Checkout's `success_url` is a browser redirect. It is trivially forgeable — anyone can type
`/billing?checkout=success` — and it also arrives *before* the webhook in a meaningful share of real
sessions. Treating it as a grant would reintroduce exactly the client-trusted entitlement AD-16
forbids and E4 spent a table, two policies, four grants and a database test suite eliminating. So
the return URL drives **copy only** (AC-13), the webhook drives **state**, and the gap between the
two is a spinner with a bounded life and an honest fallback message. If a reviewer asks "why not
just call a `confirm` RPC on return" — because that RPC would be the client-callable write path to
`plan='ai'` that `06_grants.sql:689-700` exists to prevent.

### `db diff` blind spots relevant here

The repo has been bitten and wrote it down: `supabase db diff` never re-emits
`with (security_invoker = on)` on a view, and it does not diff storage-bucket rows
(`supabase/migrations/20260724112600_add_summary_stats_views.sql`, the `MANUAL ADJUSTMENTS` block).
Neither applies to this story — it adds no view and no bucket — but two related habits do: `db diff`
emits **no data statements at all** and the declarative schema files can only state a final shape,
so the AC-2 backfill is unreachable by generation and must be **hand-added to the migration** —
exactly as Story 5.9's `shadchanim.notes` backfill was. And the generated file must be read, not
trusted: read it before applying it, every time.

### The AD-7 carve-out, stated once

`forAccount()` is the rule and this story keeps it, with a single named exception whose entire
surface is one `select account_id from subscription where stripe_customer_id = $1`. The reason the
exception is unavoidable: a webhook is the one inbound path that carries no tenant identity at all —
no JWT, no account id, only a Stripe customer. Something has to translate. Making that translation a
named, tested, single-query helper (AC-11) is the difference between a bounded carve-out and a
service-role client loose in a request handler.

### Concurrency and Epic 5

This story touches **zero** files in Epic 5's live paths — nothing under `entity360/**`,
`shidduchim/**`, `singles/**`, `shadchanim/**`, `references/**` (except the guard test named below),
and no `entityDescriptor.ts` or `<entity>/index.ts`. The overlaps that do exist and need a scheduling
decision:

- `types.ts` — Epic 5 stories edit it constantly. This story's need is small (see the file set) and
  could be avoided entirely by declaring the new types locally; prefer that if the wave is hot.
- `references/entitlementGate.guard.test.ts` — owned by nobody in Epic 5, but it lives under
  `references/`. Coordinate if 5.10/5.11 are in flight.
- `supabase/schemas/{01_tables,05_policies,06_grants}.sql` and `supabase/migrations/**` — every
  Epic 5 story with a migration writes these. **Do not schedule this story in the same wave as a
  migration-bearing Epic 5 story.** The loser of a concurrent `db diff` produces a migration
  containing the other story's changes, and that corruption surfaces on the innocent story.
- `workers/shared/env.ts` — Story 11.1 adds the same `SUPABASE_PUBLISHABLE_KEY` field. Whichever
  lands second must check before adding (Task 3).

### Testing standard

AAA, descriptive names, no shared mutable state, mocks reset in `beforeEach`
(`.claude/rules/testing.md`; 80% coverage on new paths is the bar). Project routing:
`workers/**/*.test.ts` → `npm run test:unit:workers` (plain Node, no Workers runtime — Hono apps are
exercised through `app.request()`); `src/**` component tests → the `app` project, **real Chromium via
`vitest-browser-react`**, with `TestMemoryRouter` for router-dependent components (React Testing
Library is not installed); `supabase/tests/*.test.ts` → `npm run test:unit:db`, which shells out to
`psql` and skips itself when the local stack is down (but throws in CI —
`supabase/tests/dbSuiteHelpers.ts:33-44`). Playwright specs live in `e2e/`.
**No test in this story may contact Stripe.** Signatures are generated locally with
`stripe.webhooks.generateTestHeaderString`; the Stripe client is mocked at module level. Test-mode
keys are for the manual AC-14 verification only, and even there nothing is charged — Stripe's test
cards are the tool for that.

### Project Structure Notes

New files: `workers/billing/{subscriptionState,resolveAccount}.ts` (+ their `.test.ts`),
`workers/shared/cors.ts` (+ `.test.ts`),
`src/components/atomic-crm/providers/commons/billingClient.ts` (+ `.test.ts`),
`src/components/atomic-crm/billing/{SubscribeButton,BillingReturnNotice,ManageSubscriptionButton}.tsx`
(+ tests), `e2e/billing-checkout.spec.ts`, one migration under `supabase/migrations/`.
Adding `.tsx` files under `src/components/atomic-crm/**` mutates `registry.json` —
`scripts/generate-registry.mjs` globs that tree (minus tests) and `.husky/pre-commit` regenerates it.
Declare it; do not run `make registry-gen` by hand during a shared-tree wave.

### Declared file set (the wave planner consumes this)

**Database**
- `supabase/schemas/01_tables.sql`, `05_policies.sql`, `06_grants.sql`
- `supabase/migrations/<generated>_stripe_billing_sync.sql`
- `supabase/tests/billing_entitlement.sql`, `supabase/tests/billing_entitlement.test.ts`

**Workers**
- `workers/billing/index.ts`, `index.test.ts`, `wrangler.toml`
- `workers/billing/subscriptionState.ts` + `.test.ts` *(new)*
- `workers/billing/resolveAccount.ts` + `.test.ts` *(new)*
- `workers/shared/cors.ts` + `.test.ts` *(new)*
- `workers/shared/forAccount.ts`, `forAccount.test.ts` (add `upsert`)
- `workers/shared/env.ts` (`SUPABASE_PUBLISHABLE_KEY`, only if 11.1 has not added it)

**SPA**
- `src/components/atomic-crm/billing/BillingPage.tsx` (remove `SubscribeStub`, mount the three new
  components)
- `src/components/atomic-crm/billing/SubscribeButton.tsx`, `BillingReturnNotice.tsx`,
  `ManageSubscriptionButton.tsx` (+ their tests) *(new)*
- `src/components/atomic-crm/providers/commons/billingClient.ts` + `.test.ts` *(new)*
- `src/components/atomic-crm/references/entitlementGate.guard.test.ts` — **the shared guard**; its
  `ALLOWED` set (`:26-31`) must be updated in the same diff if any new file references the
  entitlement hook or its query key
- `src/components/atomic-crm/types.ts` — only if the checkout/portal response types are exported
  app-wide; prefer local types and leave this file alone while Epic 5 is live
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` **and**
  `frenchCrmMessages.ts` — **both or neither**; today neither carries a `crm.billing.*` key and the
  page uses inline `_:` defaults, so the default outcome is *neither*
- `registry.json` — regenerated by the pre-commit hook because new `.tsx` files land under
  `src/components/atomic-crm/`

**Not touched, deliberately** — `root/routeManifest.ts` (no new route; the return is a query
parameter on the existing `/billing`), any `entityDescriptor.ts`, any `<entity>/index.ts`,
`entity360/**` (billing is not an entity and has no 360 surface, no `TabKey`, no `RecordLink`
target), `supabase/schemas/02_functions.sql` (AC-1), `supabase/schemas/07_storage.sql`,
`public/manifest.json`.

**Config / CI**
- `package.json` (+ `package-lock.json`) — add `stripe`
- `.github/workflows/deploy.yml` — extend the billing secret-push step
- `.env.development`, `.env.e2e` — `VITE_BILLING_WORKER_URL`

**E2E**
- `e2e/billing-checkout.spec.ts` *(new)*. `e2e/fixtures.ts` needs no change — the spec intercepts
  the worker call and does not need a new fixture; if a signed-in fixture is required, reuse the
  existing `signIn()` rather than adding a second sign-in path.

### Dependencies

**Hard, external, blocking:** the Cloudflare Workers deployment prerequisite in full (see the
section above). Without it AC-14 is unsatisfiable and no webhook has ever been received.

**Hard, in-repo:** none. Epic 4 is deployed; the `subscription`/`ai_usage`/`ai_entitlement()`
substrate is E4 and shipped. This story does **not** depend on Epic 5 or on Epic 11.

**Soft / sequencing:**
- Story 11.1 (`workers/shared` entitlement gate) shares `workers/shared/env.ts` — coordinate the
  `SUPABASE_PUBLISHABLE_KEY` field, and note that the billing worker is deliberately **not** behind
  `requireAiEntitlement`.
- Epic 11 as a whole is what makes the paid tier worth buying. Selling a tier whose only features
  (11.2 resume auto-parse, 11.3 diligence dossier) do not exist yet is an owner call, not a
  technical blocker. The gap brief's own recommendation for D7 was "defer explicitly, with a note
  that it gates Epic 11's launch" — the owner has since adopted it for build, so it is written; the
  *ordering* against Epic 11 is still the owner's to set.

### References

- [Source: supabase/schemas/01_tables.sql:103-121] — the `accounts` billing decoy columns and the
  comment forbidding them from feeding entitlement.
- [Source: supabase/schemas/01_tables.sql:530-577] — `subscription` and `ai_usage`, the
  default-unentitled posture, and the "every write is service_role" rule.
- [Source: supabase/schemas/01_tables.sql:769-779, 821-822] — the `subscription` unique/FK
  constraints and indexes the new upsert relies on.
- [Source: supabase/schemas/02_functions.sql:2874-2929] — `ai_entitlement()`; `is_entitled` requires
  exactly `plan='ai' AND status='active'`, `'lapsed'` is a graceful pause.
- [Source: supabase/schemas/02_functions.sql:201-221] — `current_context_id()`, the account the
  checkout route resolves.
- [Source: supabase/schemas/05_policies.sql:526-544] — SELECT-only RLS on `subscription`/`ai_usage`,
  and the deliberate absence of any write policy.
- [Source: supabase/schemas/06_grants.sql:224-227] — `current_context_id()` is executable by
  `authenticated`.
- [Source: supabase/schemas/06_grants.sql:662-719] — the `accounts` billing-column write revoke, the
  `subscription`/`ai_usage` grants, and the `ai_entitlement()` grants.
- [Source: supabase/tests/billing_entitlement.sql] + [supabase/tests/billing_entitlement.test.ts] —
  the existing DB pair this story extends; the paired-file rule for `supabase/tests/`.
- [Source: supabase/tests/dbSuiteHelpers.ts:33-44] — `bailIfDbUnreachable`, why the db suite skips
  locally and throws in CI.
- [Source: workers/billing/index.ts] — the 501 stub, `BillingEnv`, and the comment naming exactly
  this story's scope ("Checkout + a signature-verified, idempotent Stripe webhook").
- [Source: workers/billing/index.test.ts] — the three existing cases that must stay green.
- [Source: workers/billing/wrangler.toml] — `nodejs_compat` is already on; the secrets comment block
  to extend; no `route`/`workers_dev`.
- [Source: workers/shared/forAccount.ts:31-58] — AD-7's scoped client and the `insert` account_id
  injection the new `upsert` mirrors.
- [Source: workers/shared/{createApp,envelope,securityHeaders,env}.ts] — the Worker conventions:
  `/health`, the `{success,data?,error?,meta?}` envelope, the security headers, `BaseEnv`.
- [Source: .github/workflows/deploy.yml:222-288] — the `deploy-workers` job, `IS_CLOUDFLARE_CONFIGURED`,
  the billing secret-push step, and the green-on-skip step that is the blocking dependency's proof.
- [Source: src/components/atomic-crm/billing/BillingPage.tsx] — the shipped page: the lapsed banner
  (`:83-95`), the entitled copy (`:124-129`), `SubscribeStub` (`:149-163`), `path = "/billing"`
  (`:165`).
- [Source: src/components/atomic-crm/billing/billingPlans.ts:8-9] — `$2` / `$24`, the prices the
  Stripe Prices must match.
- [Source: src/components/atomic-crm/references/useAiEntitlement.ts:34-60] —
  `AI_ENTITLEMENT_QUERY_KEY`, `useAiEntitlementInfo`, and the fail-closed contract.
- [Source: src/components/atomic-crm/references/entitlementGate.guard.test.ts:26-31] — the `ALLOWED`
  set this story must update rather than weaken.
- [Source: src/components/atomic-crm/providers/supabase/dataProvider.ts:474-490] — the existing
  `aiEntitlement()` method and its "no client method here grants entitlement" comment.
- [Source: src/components/atomic-crm/providers/commons/aiEntitlement.ts] — `UNENTITLED_AI`, the
  fail-closed default.
- [Source: src/components/atomic-crm/root/routeManifest.ts:71-76] — `/billing` is already a
  registered custom route on both surfaces; no new route is needed.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-16]
  — provider is the source of truth, Checkout + signature-verified idempotent webhook, card data
  never touches us, the fee posture at $2. Its `accounts`-column sync list is superseded by the
  shipped `subscription` table; that deviation is flagged, not silently taken.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-17]
  — fail-closed on the paid paths; the authority behind the `past_due` ruling in AC-6.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md#AD-7]
  — `forAccount()` as the only Worker path to a tenant table; the carve-out in AC-11 is measured
  against it.
- [Source: _bmad-output/implementation-artifacts/11-1-server-side-entitlement-on-inference.md] —
  the caller-scoped-client pattern, `SUPABASE_PUBLISHABLE_KEY`, and the `[dev] port` convention this
  story mirrors; also why the billing worker is *not* behind that gate.
- [Source: .claude/rules/security-triggers.md] — five of eight triggers fire on this diff.
- [Source: .claude/rules/testing.md] — AAA, isolation, deterministic Playwright waits.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
