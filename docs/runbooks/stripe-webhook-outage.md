# Stripe Webhook Outage Runbook

**Status:** Active  
**Last Updated:** 2026-08-10  
**Story:** 15.5 (NFR-8 Operational Runbooks)  
**Related:** S19 (Epic 15 unowned-work ledger)

---

## Overview

This runbook covers **Stripe webhooks failing, delayed, or being rejected** — causing the `public.subscription` table in our database to drift from Stripe's actual subscription state. The billing Worker (`workers/billing/index.ts`) is the **only** component that writes to `subscription`; it is a writer, never a decider. Entitlement is server-authoritative via `public.ai_entitlement()` — the `accounts.plan` columns are user-writable and **must never be trusted** to diagnose whether someone should have access.

### Architecture Summary

| Component | Role |
|-----------|------|
| `workers/billing/index.ts` | Webhook endpoint — signature verification, idempotency via `stripe_events`, applies patches to `subscription` |
| `workers/billing/subscriptionState.ts` | Pure functions: Stripe status → our `plan`/`status`, event → patch, ordering guard |
| `public.stripe_events` | Idempotency/replay ledger (PK = `event_id`, status = `received` | `done`) |
| `public.subscription` | One row per account; `status` CHECK permits only `active`, `past_due`, `lapsed`, `none` |
| `public.ai_entitlement()` | Single source of truth for entitlement — reads `subscription`, ignores `accounts.*` |

---

## Symptoms

- Users report AI features (resume parse, auto-fill) **stopped working** despite active Stripe subscription
- `public.ai_entitlement()` returns `is_entitled: false` for accounts that should be entitled
- `public.subscription` row shows `status = 'lapsed'` or `status = 'none'` while Stripe Dashboard shows `active` or `past_due`
- Worker logs show **constraint-violation errors** on `subscription_status_check` — a webhook tried to write a status the CHECK does not permit (e.g., `past_due` was rejected for weeks in this project; no grace window ever started)
- `stripe_events` has rows stuck at `status = 'received'` (mutation failed, never marked `done`)
- Stripe Dashboard → Webhooks shows **retries exhausted** or endpoint **disabled**
- `cron_heartbeat` for `worker = 'billing'` goes stale (if the Worker crashed entirely)

---

## Immediate Triage (Run These First)

```bash
# 1. Check recent webhook deliveries in Stripe Dashboard
#    https://dashboard.stripe.com/webhooks/<webhook_endpoint_id>
#    Look for: 4xx/5xx responses, "Retrying…", "Exhausted", "Endpoint disabled"

# 2. Query the ledger for stuck/failed events (run in Supabase SQL Editor)
SELECT event_id, type, account_id, received_at, status, livemode
FROM public.stripe_events
WHERE status = 'received'
ORDER BY received_at DESC
LIMIT 50;

# 3. Find subscriptions whose updated_at is older than the latest Stripe event for that account
WITH latest_event AS (
  SELECT se.account_id, max(se.received_at) AS latest_received
  FROM public.stripe_events se
  WHERE se.account_id IS NOT NULL
  GROUP BY se.account_id
)
SELECT s.account_id, s.plan, s.status, s.updated_at, le.latest_received
FROM public.subscription s
JOIN latest_event le ON s.account_id = le.account_id
WHERE s.updated_at < le.latest_received - interval '5 minutes';

# 4. Check for constraint violations in Worker logs (Cloudflare Dashboard → Workers → billing → Logs)
#    Search for: "check constraint", "subscription_status_check", "23514"
```

---

## Diagnosis

### A. Constraint Violation — Status Not Permitted by CHECK

| Evidence | Meaning |
|----------|---------|
| Worker log: `error: new row for relation "subscription" violates check constraint "subscription_status_check"` | Webhook tried to write a status value not in `('active','past_due','lapsed','none')` |
| `subscription.updated_at` **older** than `stripe_events.received_at` for same account | The mutation failed silently; row never updated |

**Root cause in this repo:** `mapStripeStatus()` in `subscriptionState.ts` maps Stripe `past_due` → our `past_due`, but the CHECK constraint **permits** `past_due` — the actual shipped bug was a mismatch between what the code produced and what the constraint allowed at that moment (a migration added the CHECK before the code handled the value). If the CHECK is missing a value the code emits, the write fails and the ledger row stays `received`.

### B. Signature Verification Failure

| Evidence | Meaning |
|----------|---------|
| Worker returns `400 { "error": "invalid signature" }` | `STRIPE_WEBHOOK_SECRET` in Worker env ≠ secret in Stripe Dashboard |
| Stripe Dashboard shows **400** responses, no retries | Stripe treats 4xx as "don't retry" — events are lost unless manually resent |

### C. Livemode Mismatch

| Evidence | Meaning |
|----------|---------|
| Worker log: `billing.webhook.modeMismatch` with `eventLivemode !== workerIsLive` | Test-mode event sent to live Worker (or vice versa). Worker answers 200 and records event, but **does not process it** — subscription never updated |

### D. Account Resolution Failure (Operational Error)

| Evidence | Meaning |
|----------|---------|
| Worker log: `"failed to resolve account"` + `stripe_events.status = 'received'` (stuck) | `resolveAccountForCustomer` hit a query/transport error (not "no row"). The ledger deliberately stays `received` so Stripe retry reprocesses — but if the DB is down, retries keep failing |

### E. Stripe Retries Exhausted / Endpoint Disabled

| Evidence | Meaning |
|----------|---------|
| Stripe Dashboard: "Retries exhausted" or "Endpoint disabled" | Stripe gave up. **No more automatic deliveries**. Missed events must be replayed manually from Stripe Dashboard or via API |

---

## Remediation

### 1. Fix the Root Cause First

| Cause | Action |
|-------|--------|
| Constraint violation (A) | If CHECK is missing a valid status: generate migration to add it to `subscription_status_check` in `01_tables.sql`, run `make check-migration-safety`, deploy. If code emits invalid value: fix `mapStripeStatus()` in `subscriptionState.ts`, deploy Worker. |
| Signature mismatch (B) | **UNVERIFIED — confirm with the owner:** The production `STRIPE_WEBHOOK_SECRET` value. Rotate in Stripe Dashboard → Webhooks → Signing secret → "Reveal" → update GitHub secret `STRIPE_WEBHOOK_SECRET` → re-deploy `billing` Worker. |
| Livemode mismatch (C) | Ensure Worker's `STRIPE_SECRET_KEY` prefix (`sk_live_` vs `sk_test_`) matches the Stripe account mode the webhook is configured for. **UNVERIFIED — confirm with the owner:** Which Stripe account (test/live) the production webhook endpoint is registered against. |
| Account resolution (D) | Check Supabase status. If DB was down, wait for recovery — Stripe retries will reprocess once `resolveAccountForCustomer` succeeds. |

### 2. Replay Missed Events (Safe, Idempotent)

The `stripe_events` ledger is the source of truth for what has been **fully processed** (`status = 'done'`). Events stuck at `received` were **claimed but not completed** — they are safe to reprocess.

#### Option A: Manual Replay via Stripe Dashboard (Preferred)
1. Go to Stripe Dashboard → Webhooks → [your endpoint] → **"Send test webhook"** is NOT sufficient — it sends a synthetic event.
2. For real events: Stripe Dashboard → **Developers → Events** → filter by date/type → click event → **"Resend"**
3. Resend each event that corresponds to a `stripe_events` row with `status = 'received'` (or events Stripe shows as failed)
4. Worker will re-claim (`outcome: "retry"`), reprocess, and mark `done`

#### Option B: Bulk Replay via Stripe API (If Many Events)
```bash
# UNVERIFIED — confirm with the owner: The live webhook endpoint URL (e.g. https://billing.myshadchan.workers.dev/webhook)
# List failed events via Stripe CLI (requires STRIPE_SECRET_KEY):
stripe events list --limit 100 --webhook-endpoint <WEBHOOK_ENDPOINT_ID> | jq '.data[] | select(.livemode==true) | .id'

# Resend each:
stripe webhook_endpoints resend <WEBHOOK_ENDPOINT_ID> <EVENT_ID>
```

#### Option C: Direct Database Replay (Last Resort — Use With Caution)
If Stripe event retention has expired (30 days) and you must reconstruct state:
```sql
-- 1. Identify the latest Stripe subscription state per account from Stripe Dashboard
-- 2. Manually construct the patch that applyEvent() would produce (see subscriptionState.ts)
-- 3. Apply directly via service_role, respecting the ordering guard:
UPDATE public.subscription
SET
  plan = 'ai',
  status = 'active',           -- or 'past_due', 'lapsed', 'none'
  stripe_customer_id = 'cus_...',
  stripe_subscription_id = 'sub_...',
  stripe_price_id = 'price_...',
  current_period_end = '2026-09-01T00:00:00Z',
  last_stripe_event_at = '2026-08-10T12:00:00Z',  -- use the Stripe event's created timestamp
  grace_ends_at = NULL         -- omit or set explicitly for past_due
WHERE account_id = <account_id>
  AND (last_stripe_event_at IS NULL OR last_stripe_event_at <= '2026-08-10T12:00:00Z');

-- 4. Mark corresponding stripe_events rows as done
UPDATE public.stripe_events
SET status = 'done', account_id = <account_id>
WHERE event_id IN (<list of event_ids>) AND status = 'received';
```
> **WARNING:** This bypasses the Worker's ordering guard and signature verification. Only use when Stripe replay is impossible. Always prefer Option A or B.

### 3. Backfill Grace Window for `past_due`

If `past_due` was rejected by the CHECK constraint for a period, accounts that should have had a grace window (`grace_ends_at` set) never got it.

```sql
-- Find accounts with subscription.status = 'past_due' but grace_ends_at IS NULL
-- and a corresponding stripe_events row for invoice.payment_failed or subscription.updated to past_due
SELECT s.account_id, s.updated_at, se.received_at, se.type
FROM public.subscription s
JOIN public.stripe_events se ON se.account_id = s.account_id
WHERE s.status = 'past_due'
  AND s.grace_ends_at IS NULL
  AND se.type IN ('invoice.payment_failed', 'customer.subscription.updated')
  AND se.status = 'done'
  AND se.received_at > s.updated_at;

-- For each, set grace_ends_at = received_at + interval '7 days' (or your grace period)
UPDATE public.subscription
SET grace_ends_at = '2026-08-17T12:00:00Z', updated_at = now()
WHERE account_id = <account_id>;
```

---

## Verification

| Check | Command / Method | Expected |
|-------|------------------|----------|
| All stuck `received` events cleared | `SELECT count(*) FROM stripe_events WHERE status = 'received';` | 0 (or only events from last few minutes) |
| Subscription rows match Stripe | Compare `subscription.status` per account with Stripe Dashboard | `active` ↔ Stripe `active`/`trialing`, `past_due` ↔ Stripe `past_due`, `lapsed` ↔ Stripe `canceled`/`unpaid`/`incomplete_expired`/`paused` |
| Entitlement correct | In app: `await supabase.rpc('ai_entitlement')` for affected accounts | `is_entitled: true` for `active`/`past_due`; `false` for `lapsed`/`none` |
| Worker healthy | Cloudflare Dashboard → Workers → billing → Logs | 200 responses on `/webhook`, no critical alerts |
| Stripe endpoint re-enabled | Stripe Dashboard → Webhooks → [endpoint] | Status: **Enabled**, no "Exhausted" |
| `cron_heartbeat` for billing | `SELECT * FROM cron_heartbeat WHERE worker = 'billing';` | `last_ok_at` < 5 min ago, `last_failed_count = 0` |

---

## Escalation

1. **Stripe Support** — If endpoint is disabled and cannot be re-enabled via Dashboard, or if events are missing from Stripe's event log (retention: 30 days).
   - **UNVERIFIED — confirm with the owner:** Stripe account ID and support plan level.

2. **Supabase Support** — If `stripe_events` or `subscription` tables show corruption, or if RLS/policies block service_role writes.
   - Check `supabase/schemas/06_grants.sql:883-896` for grants on `subscription`; `912-919` for `stripe_events`.

3. **Engineering On-Call** — If the root cause is a code defect in `subscriptionState.ts` or `index.ts` that requires a Worker redeploy.

---

## Related Documents

| Document | Location |
|----------|----------|
| Billing Worker (webhook handler) | `workers/billing/index.ts` |
| Status mapping & handled events | `workers/billing/subscriptionState.ts` |
| Account resolution & ledger | `workers/billing/resolveAccount.ts` |
| Subscription table schema | `supabase/schemas/01_tables.sql:1007` |
| Stripe events table schema | `supabase/schemas/01_tables.sql:1125` |
| ai_entitlement() function | `supabase/schemas/02_functions.sql:648` |
| Grants on billing tables | `supabase/schemas/06_grants.sql:876` |
| Deploy workflow (Worker redeploy) | `.github/workflows/deploy.yml` |
| Epic 15 ledger (S19) | `_bmad-output/planning-artifacts/epics.md` |

---

## Sign-Off

| Incident | Date | Resolved By | Verified By |
|----------|------|-------------|-------------|
| | | | |

---

## UNVERIFIED Items Flagged in This Runbook

1. **The production webhook signing secret** — `STRIPE_WEBHOOK_SECRET` value in production Worker env vs Stripe Dashboard
2. **Whether the Stripe Dashboard shows retries exhausted** — exact state of the webhook endpoint in Stripe Dashboard
3. **The live endpoint URL** — e.g. `https://billing.myshadchan.workers.dev/webhook` or similar
4. **Which Stripe account (test/live) the production webhook endpoint is registered against**
5. **Stripe account ID and support plan level** (for escalation)