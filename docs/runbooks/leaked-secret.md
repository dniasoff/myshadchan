# Leaked Secret Rotation Runbook

**Status:** Active  
**Last Updated:** 2026-08-09  
**Story:** 15.5 (Credential Rotation)  
**Related:** S19 (Epic 15 unowned-work ledger)

---

## Overview

This runbook documents the exact steps to rotate the two credentials that were exposed in GitHub Actions logs prior to commit `af2074e` (2026-07-29). Both credentials are **live exposed** and must be rotated immediately.

| Credential | Provider | GitHub Secret | Supabase Config | Used By |
|------------|----------|---------------|-----------------|---------|
| SMTP password | Resend | `RESEND_API_KEY` | Management API PATCH (custom SMTP) | Cron worker (reminders), Edge Functions |
| Google OAuth client secret | Google Cloud | `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | `supabase/config.toml:144` | Supabase Auth (external provider) |

---

## Prerequisites

- Access to Resend dashboard (SMTP/API keys)
- Access to Google Cloud Console (OAuth 2.0 credentials)
- GitHub repository `Settings > Secrets and variables > Actions` write access
- Supabase project access (for verification)

---

## Rotation Procedure: SMTP Password (Resend API Key)

### 1. Generate New API Key in Resend
1. Log into [Resend Dashboard](https://resend.com/api-keys)
2. Click **Create API Key**
3. Name: `myshadchan-production-<YYYY-MM-DD>`
4. Permissions: **Sending access** (minimum)
5. Copy the new key (format: `re_...`) — **save immediately, cannot be retrieved later**

### 2. Update GitHub Secret
1. Go to GitHub repo → **Settings > Secrets and variables > Actions**
2. Find `RESEND_API_KEY` → **Update** → paste new key → **Save**
3. Verify the secret shows as updated (timestamp changes)

### 3. Invalidate Old Resend API Key
1. In Resend Dashboard, find the **old** key (used before rotation date)
2. Click **Revoke** / **Delete**
3. Confirm revocation

### 4. Verify Email Delivery
1. Trigger a test deploy: push a no-op commit to `main` or run workflow manually
2. Wait for deploy to complete green
3. Test reminder email: in the app, create a task with `due_date` in the past, trigger cron sweep manually, or wait for next scheduled run
4. Verify email arrives at recipient inbox

---

## Rotation Procedure: Google OAuth Client Secret

### 1. Create New OAuth Client Secret in Google Cloud Console
1. Go to [Google Cloud Console > APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials)
2. Select project: `myshadchan` (or your project ID)
3. Find the existing **OAuth 2.0 Client ID** for Supabase Auth (name: `myshadchan-auth` or similar)
4. Click **Edit** (pencil icon)
5. Click **Add Secret** → **Generate new client secret**
6. Copy the new secret — **save immediately**
7. **Do not delete the old secret yet** — wait for deploy verification

### 2. Update GitHub Secret
1. Go to GitHub repo → **Settings > Secrets and variables > Actions**
2. Find `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` → **Update** → paste new secret → **Save**

### 3. Update Supabase Auth Config
The new secret is pushed to Supabase via the deploy workflow's `patch-supabase-auth-config.sh` script on the next deploy. No manual Management API call needed.

### 4. Revoke Old Client Secret
1. After successful deploy and verification (step 5 below), return to Google Cloud Console
2. Edit the same OAuth 2.0 Client ID
3. Click **Delete** next to the **old** client secret
4. Confirm deletion

### 5. Verify Google OAuth Sign-In
1. Trigger a test deploy (push to `main` or manual workflow run)
2. Wait for deploy to complete green
3. In production app, click **Sign in with Google**
4. Complete OAuth flow — verify redirect back to app with authenticated session
5. Test with a fresh incognito window to ensure no cached credentials

---

## Verification: No Secret Leakage in Actions Logs

Run a test deploy and scan the Actions logs for the following strings (should find **zero** occurrences):

```bash
# In the Actions log UI, search for:
smtp_pass
external_google_secret
RESEND_API_KEY
GOOGLE_CLIENT_SECRET
re_  # Resend API key prefix
```

**Expected:** No matches in any step output.

**Protections in place (do not remove):**
- `scripts/ci/patch-supabase-auth-config.sh` captures response body to temp file, never prints on success
- `supabase secrets set` reads from `${{ env.RESEND_API_KEY }}` — GitHub masks automatically
- `wrangler secret put` pipes via `echo "$SECRET" | npx wrangler secret put` — value never in command line
- `wrangler versions upload --secrets-file` writes to chmod 600 temp file

---

## Full Deploy Validation Checklist

After both rotations complete, run a full deploy and verify:

| Check | Method | Expected |
|-------|--------|----------|
| All workflow jobs green | GitHub Actions UI | ✅ All steps pass |
| Supabase Auth config updated | Supabase Dashboard > Auth > Providers | Google provider shows "Enabled" |
| Custom SMTP configured | Supabase Dashboard > Auth > SMTP Settings | Shows Resend host/port |
| Magic link email delivery | App: request magic link | Email arrives, link works |
| Google OAuth sign-in | App: click "Sign in with Google" | Redirects, completes, session created |
| Cron worker reminder emails | Create overdue task, wait for sweep | Email delivered via Resend |
| No secret in Actions logs | Search logs (see above) | Zero matches |

---

## Emergency Rollback

If a rotation causes production outage:

### SMTP (Resend)
1. In Resend Dashboard, **re-create the old API key** if still within recovery window, OR generate a new one
2. Update `RESEND_API_KEY` in GitHub secrets
3. Trigger hotfix deploy

### Google OAuth
1. In Google Cloud Console, **re-create the old client secret** (if not permanently deleted)
2. Update `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in GitHub secrets
3. Trigger hotfix deploy

> **Note:** GitHub Actions secrets are updated instantly — no deploy needed for the secret value itself, but a deploy is required to push the new secret to Supabase Auth config and Workers.

---

## Related Documents

| Document | Location |
|----------|----------|
| Deploy workflow | `.github/workflows/deploy.yml` |
| Auth config patch script | `scripts/ci/patch-supabase-auth-config.sh` |
| Supabase config | `supabase/config.toml` |
| Epic 15 ledger (S19) | `_bmad-output/planning-artifacts/epics.md` |

---

## Sign-Off

| Rotation | Date | Rotated By | Verified By |
|----------|------|------------|-------------|
| SMTP (Resend) | | | |
| Google OAuth | | | |