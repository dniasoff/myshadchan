# Stuck Reminder Queue Runbook

**Status:** Active  
**Last Updated:** 2026-08-10  
**Story:** 15.5 (NFR-8 Operational Runbooks)  
**Related:** S19 (Epic 15 unowned-work ledger)

---

## Overview

This runbook covers **reminders/notifications that have stopped going out, or are going out late**. The reminder-delivery sweep (`sweepReminders` in `workers/cron/sweepReminders.ts`) runs on a 15-minute Cloudflare cron schedule (`*/15 * * * *`, `workers/cron/wrangler.toml:62`) and writes a heartbeat to `public.cron_heartbeat` via `record_cron_heartbeat()` (`supabase/schemas/02_functions.sql:3260`) on every tick. That heartbeat — specifically the interplay of `last_run_at`, `last_ok_at`, `last_error`, and `last_failed_count` — is the **single source of truth** for distinguishing the three failure modes that look identical from outside (Settings shows "Paused" in all three).

> **Key insight:** A green heartbeat (`last_ok_at` fresh) does **not** prove anything was delivered. It proves the sweep's own RPCs (`claim_due_task_notifications`, `record_cron_heartbeat`) succeeded. A permanently failing send queue (missing/invalid Resend credentials) and a healthy sweep coexisted in this project's history (Epic 12 adversarial review, R3), which is exactly why `last_failed_count` exists.

---

## Symptoms

| User-Facing Signal | What It Means |
|--------------------|---------------|
| Settings → Preferences shows **"Paused"** under "Reminder emails" | Heartbeat stale (>30 min) or never successful |
| Settings → Preferences shows **"Delivery failing"** | Sweep runs, RPCs succeed, but ≥1 email failed last tick |
| Settings → Preferences shows **"Sending"** but user reports no emails | Possible silent failure — verify `last_failed_count` in SQL |
| Reminders created with past `due_date` never arrive | Queue stuck, sweep not claiming, or delivery failing |

---

## Immediate Triage (Run These First)

```bash
# 1. Check the heartbeat row — the canonical status
psql "postgresql://..." -c "SELECT * FROM public.cron_heartbeat WHERE worker = 'cron';"
#    Or in Supabase SQL Editor:
#    SELECT * FROM public.cron_heartbeat WHERE worker = 'cron';

# 2. Check if the Worker is deployed and its cron triggers are armed
#    Cloudflare Dashboard → Workers & Pages → myshadchan-cron → Triggers
#    Should show: "*/15 * * * *" and "0 3 * * *"

# 3. Check recent Worker logs for the REMINDER_SWEEP_CRON tick
#    Cloudflare Dashboard → Workers & Pages → myshadchan-cron → Logs
#    Filter by: cron.sweepReminders.ok / cron.sweepReminders.claimRpcError / etc.

# 4. Check pending task_notifications queue depth
psql "postgresql://..." -c "
  SELECT status, COUNT(*)
  FROM public.task_notifications
  GROUP BY status;
"
#    Expect mostly 'sent' — 'pending' should drain every 15 min.
#    'sending' rows older than ~5 min are stranded (lease timeout reclaims them).

# 5. Check if enqueue is populating the queue
psql "postgresql://..." -c "
  SELECT * FROM public.enqueue_due_task_notifications();
  -- Returns integer count of rows newly enqueued.
"
```

---

## Diagnosis: The Three Failure Modes

Read `cron_heartbeat` and classify into **exactly one** of these:

### (a) Worker Runs, RPCs Succeed, Delivery Fails — `last_ok_at` Fresh, `last_failed_count` > 0

**Most likely — cron triggers and secrets are verified present.** Start here.

```sql
-- Heartbeat shows green sweep, red delivery
SELECT
  last_run_at,
  last_ok_at,
  last_error,           -- NULL here (sweep RPCs succeeded)
  last_failed_count     -- > 0 = emails failed last tick
FROM public.cron_heartbeat
WHERE worker = 'cron';
```

| Indicator | Value |
|-----------|-------|
| `last_run_at` | < 15 minutes ago |
| `last_ok_at` | < 15 minutes ago (fresh) |
| `last_error` | `NULL` |
| `last_failed_count` | ≥ 1 |

**Root causes:**
- **Invalid `RESEND_API_KEY`** in Worker secrets (key present but revoked/expired — indistinguishable from missing at app level; shows as `last_failed_count > 0` with fresh `last_ok_at`)
- `RESEND_FROM` email not verified in Resend dashboard
- Resend rate limit (429) — retryable, re-arms at `next_attempt_at` (R2 backoff)
- Recipient email invalid / suppressed (terminal 4xx → settled `failed` after 5 attempts)
- `APP_ORIGIN` wrong → links broken but email still "sent"

> **VERIFIED 2026-08-10:** Both `RESEND_API_KEY` and `RESEND_FROM` **are set** as secrets on the `myshadchan-cron` Worker (names confirmed via Cloudflare API; values not readable, which is correct). "The secret is missing" is **not** a candidate cause. What **cannot** be verified from outside is whether the key is still **valid** — a revoked or expired key looks identical to a missing one from the app's perspective, and shows up as `last_failed_count > 0` with a fresh `last_ok_at`.

---

### (b) Worker Not Running At All — `last_run_at` is Stale

```sql
SELECT
  worker,
  last_run_at,
  last_ok_at,
  last_error,
  last_failed_count,
  EXTRACT(EPOCH FROM (now() - last_run_at))/60 AS minutes_since_run
FROM public.cron_heartbeat
WHERE worker = 'cron';
```

| Indicator | Value |
|-----------|-------|
| `last_run_at` | > 30 minutes ago (or `NULL` / row missing) |
| `last_ok_at` | `NULL` or equally stale |
| `last_error` | May be `NULL` (never ran) or last error code |
| `last_failed_count` | `0` or stale value |

**Root causes:**
- Worker deploy failed silently (check `deploy-workers` leg for `cron` in GitHub Actions)
- `CLOUDFLARE_API_TOKEN` expired → Worker not redeployed after secret change
- Worker code throws on startup (check Cloudflare logs for init errors)

> **VERIFIED 2026-08-10:** Cloudflare cron triggers **ARE enabled** on the deployed `myshadchan-cron` worker. Cloudflare API confirms two schedules: `*/15 * * * *` and `0 3 * * *`, created 2026-08-07. These match `workers/cron/wrangler.toml`'s `crons = ["*/15 * * * *", "0 3 * * *"]` exactly. "The worker isn't scheduled" is **not** a candidate cause — this saves a dead end at 3am.

---

### (c) Worker Runs Fine, Nothing Due — Everything Fresh, Zero Counts

```sql
-- Healthy idle state
SELECT
  last_run_at,
  last_ok_at,
  last_error,
  last_failed_count
FROM public.cron_heartbeat
WHERE worker = 'cron';
```

| Indicator | Value |
|-----------|-------|
| `last_run_at` | < 15 minutes ago |
| `last_ok_at` | < 15 minutes ago |
| `last_error` | `NULL` |
| `last_failed_count` | `0` |

**Verification:**
```sql
-- Confirm queue is genuinely empty
SELECT COUNT(*) FROM public.task_notifications WHERE status = 'pending';
-- Should be 0

-- Confirm no overdue tasks exist that should have been enqueued
SELECT * FROM public.enqueue_due_task_notifications();
-- Returns 0
```

If user *reports* missing reminders but this state shows healthy:
- Check the specific task's `due_date` and `account_id`
- Verify `is_deliverable_member()` predicate (Epic 12 R1) — archived household members excluded
- Check `task_notifications` for that `task_id` + `due_date` (unique constraint)

---

## Remediation

### For (b) Worker Not Running

| Step | Command / Action |
|------|------------------|
| 1. Verify Worker deployed | Cloudflare Dashboard → `myshadchan-cron` → Overview → recent deploy |
| 2. Verify cron triggers armed | Cloudflare Dashboard → `myshadchan-cron` → Triggers → shows both schedules |
| 3. If triggers missing | Re-deploy Worker: push no-op commit to `main` or re-run `deploy-workers` matrix leg `cron` |
| 4. If deploy fails | Check GitHub Actions `deploy-workers` log for `cron` leg — usually missing secret or `CLOUDFLARE_API_TOKEN` |
| 5. If Worker crashes on init | Cloudflare Logs → filter `cron.scheduled` → look for top-level throw |

### For (a) Delivery Failing

| Step | Command / Action |
|------|------------------|
| 1. Check Resend credentials | Cloudflare Dashboard → `myshadchan-cron` → Settings → Variables/Secrets → `RESEND_API_KEY`, `RESEND_FROM` |
| 2. Verify `RESEND_API_KEY` works | `curl -H "Authorization: Bearer $RESEND_API_KEY" https://api.resend.com/emails` (dry-run) |
| 3. Verify `RESEND_FROM` domain verified | Resend Dashboard → Domains → status "Verified" |
| 4. Check Worker logs for send errors | Cloudflare Logs → `cron.sweepReminders.rowProcessingError` / `sendEmail` errors |
| 5. If rate limited (429) | Wait for backoff — `RETRY_BACKOFF_MINUTES = [1,5,15,60,240]` in `sweepReminders.ts:166` |
| 6. If credentials wrong | Update secrets in GitHub → Settings → Secrets → Actions, then re-deploy `cron` Worker |
| 7. Manually re-arm stuck 'pending' rows | `SELECT public.enqueue_due_task_notifications();` (idempotent — unique constraint prevents dupes) |

### For (c) Healthy But User Reports Missing

| Step | Command / Action |
|------|------------------|
| 1. Find the specific task | `SELECT * FROM public.tasks WHERE id = <task_id>;` |
| 2. Check notification row | `SELECT * FROM public.task_notifications WHERE task_id = <task_id> AND channel = 'email';` |
| 3. Verify recipient is deliverable | `SELECT public.is_deliverable_member(<account_id>, <member_id>);` (must be `true`) |
| 4. If row missing entirely | `SELECT public.enqueue_due_task_notifications();` then re-check |
| 5. If row exists but 'pending' and `due_date` past | Wait for next sweep (≤15 min) or check `next_attempt_at` if retrying |

---

## How to Verify Recovery

| Check | Command | Expected |
|-------|---------|----------|
| Heartbeat fresh | `SELECT * FROM cron_heartbeat WHERE worker='cron';` | `last_run_at` < 5 min, `last_ok_at` < 5 min |
| Delivery healthy | Same query | `last_error` = `NULL`, `last_failed_count` = `0` |
| Queue draining | `SELECT status, COUNT(*) FROM task_notifications GROUP BY status;` | `pending` = 0 (or small, draining) |
| Test end-to-end | Create task with `due_date` = now - 1 hour in app | Email arrives within 15 min; Settings shows "Sending" |
| Settings UI | Visit `/settings` → Preferences | Badge shows **"Sending"** (green) |

---

## When to Escalate

| Condition | Escalation Path |
|-----------|-----------------|
| Worker deployed, triggers armed, but **no scheduled ticks fire** (Cloudflare Logs empty for `cron.scheduled`) | Cloudflare support — Worker cron trigger not invoking |
| `RESEND_API_KEY` valid, domain verified, but **all sends return 4xx/5xx** | Resend support — account/domain reputation issue |
| `task_notifications` rows stuck in `'sending'` beyond lease timeout (5 min default in `claim_due_task_notifications`) | Manual settle: `SELECT public.settle_task_notification(id, 'pending', NULL, NULL, NULL);` then wait for reclaim |
| `enqueue_due_task_notifications()` returns 0 but overdue tasks exist | Check `is_deliverable_member()` logic — may be excluding valid recipients (Epic 12 R1 regression) |
| `cron_heartbeat` row **missing entirely** (406 from `useGetOne`) and Worker logs show successful ticks | `record_cron_heartbeat()` RPC failing — check `last_error` in next tick, or Supabase RPC logs |

---

## Related Documents

| Document | Location |
|----------|----------|
| Cron Worker entry point | `workers/cron/index.ts` |
| Reminder sweep logic | `workers/cron/sweepReminders.ts` |
| Grace window sweep | `workers/cron/sweepGraceWindow.ts` |
| Worker config (cron triggers) | `workers/cron/wrangler.toml` |
| Heartbeat table schema | `supabase/schemas/01_tables.sql:216` |
| `record_cron_heartbeat()` RPC | `supabase/schemas/02_functions.sql:3260` |
| `claim_due_task_notifications()` RPC | `supabase/schemas/02_functions.sql:1081` |
| `enqueue_due_task_notifications()` RPC | `supabase/schemas/02_functions.sql:1895` |
| `settle_task_notification()` RPC | `supabase/schemas/02_functions.sql:4333` |
| Settings UI (reads heartbeat) | `src/components/atomic-crm/reminders/ReminderDeliveryStatus.tsx` |
| Epic 12 adversarial review (R1–R4) | `_bmad-output/epic-12-adversarial-review-report-2026-08-07.md` |
| Deploy workflow (Worker secrets) | `.github/workflows/deploy.yml` |

---

## Sign-Off

| Incident | Date | Resolved By | Verified By |
|----------|------|-------------|-------------|
| | | | |

---

## What Has Been Verified, and When

| Item | Verified | Date | Method |
|------|----------|------|--------|
| Cloudflare cron triggers enabled on deployed `myshadchan-cron` Worker | **Yes** — two schedules (`*/15 * * * *`, `0 3 * * *`) created 2026-08-07, matching `wrangler.toml` exactly | 2026-08-10 | Cloudflare API (`GET /accounts/:id/workers/scripts/myshadchan-cron/schedules`) |
| `RESEND_API_KEY` secret present on Worker | **Yes** — name confirmed | 2026-08-10 | Cloudflare API (`GET /accounts/:id/workers/scripts/myshadchan-cron/secrets`) |
| `RESEND_FROM` secret present on Worker | **Yes** — name confirmed | 2026-08-10 | Cloudflare API (`GET /accounts/:id/workers/scripts/myshadchan-cron/secrets`) |
| `RESEND_API_KEY` / `RESEND_FROM` **values** (validity, domain verification) | **Cannot be verified externally** — a revoked/expired key is indistinguishable from missing at app level; shows as `last_failed_count > 0` with fresh `last_ok_at` | — | — |

> **Note:** These verifications reflect the state as of **2026-08-10**. Re-verify if the Worker is redeployed, secrets are rotated, or cron schedules are changed.

(End of file)