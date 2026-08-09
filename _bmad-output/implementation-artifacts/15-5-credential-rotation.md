# Story 15.5: Credential rotation

Status: ready-for-dev

## Story

As the platform owner,
I want the two live-exposed credentials (SMTP password and Google OAuth client secret) rotated,
so that the exposure from GitHub Actions logs is remediated and future deployments are safe.

## Acceptance Criteria

1. **SMTP password rotated**: A new SMTP password is generated, stored in GitHub secrets as `RESEND_API_KEY`, and the old password is invalidated at the provider (Resend).
2. **Google OAuth client secret rotated**: A new client secret is generated in Google Cloud Console, stored in GitHub secrets as `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, and the old secret is revoked.
3. **GitHub Actions logs no longer leak secrets**: The deploy workflow's `patch-supabase-auth-config.sh` script already captures response bodies to temp files (not stdout). Verify this holds for both PATCH calls (hook + mailer) and that no step prints `smtp_pass` or `external_google_secret`.
4. **Runbook updated**: The runbook for "leaked secret" (referenced in Story 15.5 AC) includes the exact rotation steps for these two credentials.
5. **Deploy succeeds with new secrets**: A full `main` push deploy completes green using the rotated credentials.
6. **No other credentials exposed**: Audit the deploy workflow for any other step that might print secrets (e.g., `supabase secrets set`, `wrangler secret put`, `wrangler versions upload --secrets-file`) and ensure they use file-based input or masking.

## Tasks / Subtasks

- [ ] Task 1: Rotate SMTP password (AC: 1, 3, 5)
  - [ ] Generate new API key in Resend dashboard
  - [ ] Update `RESEND_API_KEY` secret in GitHub repository settings
  - [ ] Invalidate old Resend API key
  - [ ] Trigger a test deploy and verify email delivery works
- [ ] Task 2: Rotate Google OAuth client secret (AC: 2, 3, 5)
  - [ ] Create new OAuth 2.0 client ID/secret in Google Cloud Console (same authorized redirect URIs)
  - [ ] Update `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` secret in GitHub repository settings
  - [ ] Update the client secret in Supabase Auth config via Management API (or wait for next deploy to push it)
  - [ ] Revoke old client secret in Google Cloud Console
  - [ ] Trigger a test deploy and verify Google OAuth sign-in works
- [ ] Task 3: Verify no secret leakage in Actions logs (AC: 3, 6)
  - [ ] Review `scripts/ci/patch-supabase-auth-config.sh` — confirm response body captured to temp file, never printed on success
  - [ ] Review `deploy.yml` steps that call `supabase secrets set` — confirm they read from env vars (already masked by GitHub)
  - [ ] Review `deploy.yml` steps that call `wrangler secret put` / `wrangler versions upload --secrets-file` — confirm secrets file is chmod 600 and not echoed
  - [ ] Run a test deploy and scan Actions logs for `smtp_pass`, `external_google_secret`, `RESEND_API_KEY`, `GOOGLE_CLIENT_SECRET`
- [ ] Task 4: Update leaked-secret runbook (AC: 4)
  - [ ] Locate or create the runbook document (likely in `docs/runbooks/` or similar)
  - [ ] Add step-by-step rotation procedures for SMTP password and Google OAuth client secret
  - [ ] Include: where to generate new values, which GitHub secrets to update, how to invalidate old values, verification steps
- [ ] Task 5: Full deploy validation (AC: 5)
  - [ ] Push to `main` (or trigger workflow manually) and confirm all jobs succeed
  - [ ] Verify production sign-in (magic link + Google OAuth) works end-to-end
  - [ ] Verify reminder emails (cron worker) send successfully

## Dev Notes

### Critical Context from Epic 15 (NFR-8)

This story addresses **S19** from the epic's unowned-work ledger: "the two credentials S19 named are rotated — the SMTP password and the Google OAuth client secret, both printed unmasked into retained Actions logs on every deploy before `af2074e` added `-o /dev/null`. This has been outstanding since 2026-07-29 and is a live exposure, not a chore."

The commit `af2074e` added output redirection to `/dev/null` for the Supabase Management API PATCH calls, but **the exposure already happened** — the old credentials are in historical Actions logs and must be rotated. The script `scripts/ci/patch-supabase-auth-config.sh` (introduced in Story 6.6) now captures response bodies to temp files and never prints them on success, which prevents *future* leakage, but does not remediate the *past* exposure.

### Architecture & Secrets Flow

**SMTP (Resend):**
- Used by: `cron` worker (reminder emails), `deploy-supabase` job (pushes `RESEND_API_KEY` as Supabase function secret)
- GitHub secret: `RESEND_API_KEY`
- Supabase config: Not in `config.toml` (custom SMTP configured via Management API PATCH in deploy workflow)
- Rotation: Generate new key in Resend dashboard → update GitHub secret → invalidate old key

**Google OAuth:**
- Used by: Supabase Auth (external provider `google`)
- GitHub secret: `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` (referenced in `supabase/config.toml` as `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)`)
- Supabase config: `supabase/config.toml` line 144: `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"`
- Rotation: Create new client secret in Google Cloud Console → update GitHub secret → update Supabase Auth config via Management API → revoke old secret

### Deploy Workflow Secrets Handling (`.github/workflows/deploy.yml`)

**Current protections (already in place):**
1. `patch-supabase-auth-config.sh` captures response body to temp file, exits 0 on 2xx without printing body (prevents `smtp_pass`/`external_google_secret` leakage)
2. `supabase secrets set` reads from `${{ env.RESEND_API_KEY }}` — GitHub masks secret values in logs automatically
3. `wrangler secret put` pipes secret via `echo "$SECRET" | npx wrangler secret put` — value not in command line
4. `wrangler versions upload --secrets-file` writes secrets to chmod 600 temp file, uploads atomically

**Areas to verify:**
- No `echo` or `cat` of secret values anywhere
- No `--env-file` pointing to a file that gets printed
- GitHub Actions secret masking works for all secret names used

### File Locations

| Purpose | Path |
|---------|------|
| Deploy workflow | `.github/workflows/deploy.yml` |
| Auth config patch script | `scripts/ci/patch-supabase-auth-config.sh` |
| Supabase local config | `supabase/config.toml` |
| Supabase Auth external Google config | `supabase/config.toml:144` |
| Runbook location (to create/update) | `docs/runbooks/leaked-secret.md` (or similar) |

### Testing Standards

- No unit tests required for this story (operational/secret rotation)
- Validation is via successful deploy and manual verification of:
  - Magic link email delivery (SMTP)
  - Google OAuth sign-in flow
  - Reminder email delivery (cron worker)
- Consider adding a smoke test script for future rotation verification

### Previous Story Intelligence (Story 15.4)

Story 15.4 ("Inbox inspector") is the previous story in Epic 15. Its implementation touched:
- `src/components/atomic-crm/inbox/` (UI components)
- No direct overlap with credential rotation, but established pattern of operational tooling in this epic.

### Git History Insights

Recent commits show:
- `af2074e`: Added `-o /dev/null` to suppress Management API response output (the fix that stopped *future* leakage)
- Story 6.6: Introduced `patch-supabase-auth-config.sh` with retry logic and response body capture
- Deploy workflow has evolved to use `wrangler versions upload --secrets-file` for atomic secret+code deployment (prevents partial-configuration windows)

### Latest Technical Specifics

- **Supabase CLI**: 2.111.0 (pinned in deploy.yml due to 2.112.0 regression)
- **GitHub Actions**: Uses `actions/checkout@v7`, `actions/setup-node@v7`, `supabase/setup-cli@v3`
- **Cloudflare Wrangler**: Latest in CI (via `npx wrangler`)
- **Resend API**: Current API key format; rotation via dashboard
- **Google Cloud Console**: OAuth 2.0 client credentials; rotation via "Credentials" page

## Architecture Compliance

- ✅ Follows existing secrets management pattern (GitHub secrets → env vars → CLI)
- ✅ Uses existing `patch-supabase-auth-config.sh` for Supabase Auth config updates
- ✅ No new infrastructure or code changes required — purely operational
- ✅ Aligns with NFR-8 (rehearsed recovery, runbooks, credential rotation)

## Library/Framework Requirements

- No new dependencies
- Uses existing: `supabase` CLI, `wrangler` CLI, `curl`, `jq`

## File Structure Requirements

- No new source files created
- May create/update: `docs/runbooks/leaked-secret.md`

## Testing Requirements

- Manual verification only (deploy + smoke test)
- No automated test additions required

## Project Context Reference

- **Epic**: 15 (NFR-8: Operational resilience)
- **Related Stories**: 15.1 (alerting), 15.2 (backup rehearsal), 15.3 (runbooks), 15.4 (inbox inspector), 15.6 (close ledger)
- **S-item**: S19 (live credential exposure)
- **Key Commit**: `af2074e` (stopped future leakage)
- **Key Script**: `scripts/ci/patch-supabase-auth-config.sh` (prevents response body leakage)

## Dev Agent Record

### Agent Model Used

N/A (story creation)

### Debug Log References

### Completion Notes List

### File List

- `.github/workflows/deploy.yml` (verify only)
- `scripts/ci/patch-supabase-auth-config.sh` (verify only)
- `supabase/config.toml` (reference only)
- `docs/runbooks/leaked-secret.md` (create/update)