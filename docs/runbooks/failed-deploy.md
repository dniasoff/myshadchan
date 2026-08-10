# Failed Deploy Runbook

**Status:** Active  
**Last Updated:** 2026-08-10  
**Story:** 15.5 (NFR-8 Operational Runbooks)  
**Related:** S19 (Epic 15 unowned-work ledger)

---

## Overview

This runbook covers a **failed production deploy** in the GitHub Actions `deploy` workflow (`.github/workflows/deploy.yml`). The workflow has three sequential phases:

1. **deploy-supabase** — runs migrations, pushes edge functions, sets Supabase secrets
2. **deploy-workers** (7 parallel legs) — deploys Cloudflare Workers (ingest, parse, match, ai, cron, share, billing)
3. **trigger-frontend** — fires a Vercel Deploy Hook to rebuild the React app

A failure in ANY phase leaves production in a mixed state. The workflow's `needs:` chain and `if: always()` gate are designed so a failed migration blocks the frontend, but a failed Worker leg does **not** block the frontend. Read the "What failed" column first, then jump to the corresponding section.

---

## Quick Triage: What Failed?

| Phase | Job Name | Log Marker | What It Means |
|-------|----------|------------|---------------|
| 1 | `deploy-supabase` | `📡 Push supabase migrations` | **Schema not applied** — production DB still on old migration. Frontend deploy blocked. |
| 1 | `deploy-supabase` | `📡 Deploy supabase functions` | Edge functions not updated. Secrets may or may not be pushed. |
| 1 | `deploy-supabase` | `🧹 Remove edge functions deleted from the repo` | Orphaned functions still live in production. |
| 2 | `deploy-workers` (any leg) | `🚀 wrangler deploy` / `🚀 Upload Worker version` | That specific Worker not deployed. Others may be live. |
| 2 | `deploy-workers` (any leg) | `🔑 Push base secrets` | Worker deployed but missing `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. |
| 3 | `trigger-frontend` | `🚀 Trigger the Vercel production build` | Backend is live; frontend still on previous build. |

> **VERIFIED:** The workflow's failure message at `deploy.yml:655` documents the exact path: **Vercel → Project → Settings → Git → Deploy Hooks**, branch `main`, stored as the `VERCEL_DEPLOY_HOOK_URL` repo secret. `vercel.json` sets `git.deploymentEnabled.main = false` — **pushing to main does NOT build anything**. The CI deploy hook is the only trigger for a production build. If the secret is missing, the workflow warns (not fails) and production silently keeps serving the previous build (`deploy.yml:652-656`). A dashboard "Redeploy" re-runs an **existing** deployment; it does NOT pick up a new commit because git builds are disabled. It is useful only for retrying a failed build of the same commit, and useless for shipping new code.

---

## Phase 1: Supabase Deploy Failed

### Symptoms
- GitHub Actions job `deploy-supabase` shows red
- Error in `📡 Push supabase migrations` step (exit code from `npx supabase db push`)
- OR error in `📡 Deploy supabase functions` step
- OR error in `🧹 Remove edge functions deleted from the repo` step

### Immediate Triage

```bash
# 1. Check the Actions log for the exact error
#    Look for: "Error: Failed to push migrations", "relation already exists",
#    "column does not exist", "check constraint violated", or CLUPEST error

# 2. Verify the migration that failed
npx supabase migration list --project-ref <PROJECT_ID>
#    The last migration shown as "pending" is the one that failed

# 3. Check if it's a data-safety issue (empty-table trap)
#    Run locally against a seeded stack:
make check-migration-safety BASE_REF=<last-known-good-deploy-sha>
#    If this fails, the migration destroys data — DO NOT RETRY
```

### Diagnosis

| Error Pattern | Likely Cause |
|---------------|--------------|
| `relation "..." already exists` | Migration created object that already exists (manual fix applied to prod, not in migration) |
| `column "..." does not exist` | Migration references column dropped in earlier migration; column-order trap (see AGENTS.md) |
| `check constraint "..." is violated by some row` | Data in prod violates new constraint — migration assumes clean data |
| `could not serialize access due to concurrent update` | Long-running migration hit concurrent write — retry may work |
| `CLUPEST` / disk full | Supabase project storage limit hit |

### Remediation

#### A. Migration Failed — Data-Safety Violation (check-migration-safety RED)
1. **DO NOT** re-run `db push`
2. Revert the migration locally: edit `supabase/schemas/` to remove the breaking change
3. Generate a **new** migration that adds columns before dropping, backfills, then asserts:
   ```bash
   npx supabase db diff --local -f fix_<description>
   ```
4. Run `make check-migration-safety` again — must pass GREEN
5. Push the fix migration

#### B. Migration Failed — Transient / Schema Drift
1. Check if the object already exists in production (manual hotfix):
   ```sql
   -- In Supabase SQL Editor
   SELECT * FROM information_schema.tables WHERE table_name = '<name>';
   ```
2. If it exists, create a migration that `DROP ... IF EXISTS` then `CREATE` (or `ALTER` if column-order trap)
3. Re-run the workflow: push a no-op commit or use "Re-run jobs" in Actions UI

#### C. Edge Function Deploy Failed
1. Check `npx supabase functions list --project-ref <PROJECT_ID>` — see what's deployed
2. If a specific function failed, check its logs in Supabase Dashboard → Edge Functions → Logs
3. Re-run the `deploy-supabase` job (it re-runs `functions deploy`)

#### D. Orphaned Function Cleanup Failed
1. List live functions: `curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_ID/functions"`
2. Manually delete orphans via Supabase Dashboard → Edge Functions

### Verification
- `deploy-supabase` job shows green
- `npx supabase migration list --project-ref <PROJECT_ID>` shows all migrations "applied"
- Edge Functions list matches `supabase/functions/` directories (no `_` prefix)

---

## Phase 2: Cloudflare Worker Deploy Failed

### Symptoms
- One or more `deploy-workers` matrix legs red
- Job summary shows `:rotating_light: **Cloudflare Workers deployment FAILED**`
- Common markers: `wrangler deploy` failed, `versions upload` failed, `versions deploy` failed, or required-secrets check failed

> **FACT (Cloudflare API, 2026-08-10):** **Seven workers are deployed** — `myshadchan-ai`, `-billing`, `-cron`, `-ingest`, `-match`, `-parse`, `-share`. The `deploy-workers` matrix covers all seven. This runbook's "Diagnosis by Worker" table covers six; **`myshadchan-match` appears in no runbook** — this is a documentation gap, not an indication that it doesn't exist.

### Immediate Triage

```bash
# 1. Identify which worker(s) failed from the matrix leg name
# 2. Open the failed step log — look for:
#    - "Authentication error [code: 10000]" / "Invalid access token [code: 9109]" → CLOUDFLARE_API_TOKEN issue
#    - "missing required secret(s): ..." → repo secret not set
#    - "could not parse Worker Version ID" → upload succeeded but promotion failed
#    - "R2 bucket not enabled" (share worker only) → R2 not enabled on Cloudflare account

# 3. Check Cloudflare Dashboard → Workers & Pages → Overview → the worker name
#    Is there a recent deployment? What version is active?
```

### Diagnosis by Worker

| Worker | Critical Secrets | Failure Impact |
|--------|-----------------|----------------|
| `cron` | `RESEND_API_KEY`, `RESEND_FROM`, `APP_ORIGIN`, `VAPID_*`, `SUPABASE_*` | **Reminders & grace sweep stop** — `cron_heartbeat` goes stale, Settings shows "Paused" |
| `billing` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_*`, `APP_ORIGIN`, `SUPABASE_*` | **Stripe webhook returns 500** — Stripe retries then disables endpoint; subscriptions stop syncing |
| `ai` / `parse` | `SUPABASE_*`, `AI_GATEWAY_*`, `GOOGLE_AI_STUDIO_API_KEY` | AI features (dossier, parse) return 500 — entitlement gate fails |
| `ingest` / `match` / `share` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Email ingest, matching, share links return 500 |

### Remediation

#### A. `CLOUDFLARE_API_TOKEN` Invalid / Expired (ALL legs fail)
1. Generate new token in Cloudflare Dashboard → My Profile → API Tokens
   - Permissions: `Account > Workers Scripts > Edit`, `Account > Workers KV Storage > Edit` (if used), `Zone > Zone > Read` (if custom domains)
2. Update GitHub secret `CLOUDFLARE_API_TOKEN`
3. Re-run failed `deploy-workers` legs (use "Re-run jobs" in Actions UI)

#### B. Required Secret Missing (specific leg fails at "🔎 Required Worker secrets present?")
1. Identify missing secret(s) from error: `missing required secret(s): RESEND_API_KEY ...`
2. Add secret in GitHub → Settings → Secrets and variables → Actions
3. Re-run that specific matrix leg

#### C. `wrangler versions upload` Succeeded but `versions deploy` Failed
1. The version ID is in the upload log: `Worker Version ID: <id>`
2. Manually promote:
   ```bash
   cd workers/<worker>
   npx wrangler versions deploy <version_id>@100 --yes --message "Manual promotion"
   ```
3. Verify in Cloudflare Dashboard → Workers → the worker → Versions

#### D. `share` Worker — R2 Not Enabled (RULING, not unknown)
- `workers/share/wrangler.toml:6-14` states it outright: **"NO R2 binding. R2 is not enabled on this Cloudflare account (10042 'Please enable R2 through the Cloudflare Dashboard')"** — every upload writes to Supabase Storage's `documents` bucket via the ordinary `@supabase/supabase-js` client.
- The deployed worker's bindings confirm this: only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present.
- If a deploy fails on a missing R2 binding, it means someone re-introduced an `[[r2_buckets]]` block against the ruling. Remove it.

### Verification
- All 7 `deploy-workers` legs show green (or skipped with warning)
- Cloudflare Dashboard → each worker shows recent deployment with correct version
- `cron` worker: next scheduled tick fires (check `cron_heartbeat.last_run_at` in Supabase)
- `billing` worker: Stripe webhook endpoint responds 200 (test in Stripe Dashboard → Webhooks → Send test)

---

## Phase 3: Vercel Frontend Deploy Failed

### Symptoms
- `trigger-frontend` job red
- Error: `Vercel deploy hook failed — production was NOT rebuilt`
- OR warning: `VERCEL_DEPLOY_HOOK_URL secret is missing`

### Immediate Triage

```bash
# 1. If secret missing:
#    - Go to Vercel Dashboard → Project → Settings → Git → Deploy Hooks
#    - Create hook for branch "main", copy URL
#    - Add as GitHub secret VERCEL_DEPLOY_HOOK_URL
#    - Re-run trigger-frontend job

# 2. If hook POST failed:
#    - Check /tmp/vercel-hook.json in Actions log for response body
#    - Common: 401 (hook URL rotated), 404 (hook deleted), 429 (rate limited)
```

### Remediation

#### A. Hook URL Rotated / Deleted
1. Create new Deploy Hook in Vercel Dashboard
2. Update `VERCEL_DEPLOY_HOOK_URL` secret
3. Re-run `trigger-frontend` job

#### B. Vercel Build Failed (hook returned 200 but build fails)
1. Check Vercel Dashboard → Deployments → latest → Build Logs
2. Common causes:
   - TypeScript error (`npm run build` fails)
   - Supabase schema drift (frontend expects column that migration didn't create)
   - Missing env var in Vercel Project Settings → Environment Variables
3. Fix code / add env var / ensure migration applied, then re-run hook

#### C. Manual Redeploy — Useless for New Code
- Vercel Dashboard → Deployments → "..." menu → "Redeploy" re-runs an **existing** deployment. It does NOT pick up a new commit because `vercel.json` sets `git.deploymentEnabled.main = false`. It is useful only for retrying a failed build of the same commit, and useless for shipping new code. To deploy a new commit, you must POST the Deploy Hook URL (or push a commit once the hook secret is configured).

### Verification
- `trigger-frontend` job green
- Vercel Dashboard → Deployments shows new production deployment with commit SHA matching `main`
- Visit production URL — app loads, no console errors

---

## Mixed-State Recovery (Most Dangerous)

### Scenario: Supabase Migrations Applied, Workers Failed, Frontend Deployed
- **State:** New schema live, old Workers serving, new frontend calling new schema
- **Risk:** Frontend makes RPC calls that don't exist; Workers write to columns that don't exist
- **Action:**
  1. **Immediately** disable the Vercel Deploy Hook (delete secret or pause in Vercel) to stop further frontend deploys
  2. Fix and re-deploy Workers (`deploy-workers` legs)
  3. Only then re-enable frontend deploy

### Scenario: Workers Deployed, Supabase Migration Failed, Frontend Blocked (Correct)
- **State:** Old schema, new Workers (may crash on missing columns), old frontend
- **Action:** Fix migration (Phase 1), re-run `deploy-supabase`, then `trigger-frontend` runs automatically

### Scenario: Everything Green but Production Broken
- **Check:** `cron_heartbeat` in Supabase SQL Editor:
  ```sql
  SELECT * FROM public.cron_heartbeat;
  -- last_ok_at should be < 30 min ago for worker='cron'
  -- last_failed_count should be 0
  ```
- **Check:** `stripe_events` for recent webhook processing:
  ```sql
  SELECT * FROM public.stripe_events ORDER BY received_at DESC LIMIT 20;
  -- status should be 'done', not stuck at 'received'
  ```

---

## Escalation / Rollback

### Supabase Rollback
- **No native rollback** — Supabase migrations are forward-only
- To "roll back": create a new migration that reverses the change (add column back, drop new constraint, etc.)
- Run `make check-migration-safety` on the reversal migration
- Push and deploy

### Cloudflare Worker Rollback
```bash
# List versions
npx wrangler versions list --config workers/<worker>/wrangler.toml

# Promote previous version to 100%
npx wrangler versions deploy <previous_version_id>@100 --yes --message "Rollback"
```

### Vercel Rollback
- Vercel Dashboard → Deployments → "..." on previous working deployment → "Promote to Production"
- Or re-run the Deploy Hook for a known-good commit SHA (if you have the hook URL)

---

## Related Documents

| Document | Location |
|----------|----------|
| Deploy workflow | `.github/workflows/deploy.yml` |
| Supabase config | `supabase/config.toml` |
| Worker configs | `workers/*/wrangler.toml` |
| Migration safety script | `scripts/check-migration-data-safety.mjs` |
| Cron heartbeat schema | `supabase/schemas/01_tables.sql:216` |
| Stripe events schema | `supabase/schemas/01_tables.sql:1125` |
| Epic 15 ledger (S19) | `_bmad-output/planning-artifacts/epics.md` |

---

## Sign-Off

| Incident | Date | Resolved By | Verified By |
|----------|------|-------------|-------------|
| | | | |

(End of file)