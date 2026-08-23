# Blind Hunter review packet: sign-in no-account recovery

Invoke the `bmad-review-adversarial-general` skill on the implementation described
below. Review the code as if you have no prior conversation context. Report only
actionable findings, with file and line references, consequence, and a minimal fix.

## Baseline

`433840faa7956594343d610763b1b0a2b0f1e8e3`

## Human intent

When a visitor signs in with an email that has no account, the app must say that no
account was found and offer account creation instead of hanging on a code step. The
same recovery must exist for Google sign-in. The app is intentionally passwordless:
the email path sends a code. Account creation remains explicit through `/register`.

## Changed files

- `src/components/atomic-crm/providers/commons/authErrors.ts`
- `src/components/atomic-crm/providers/supabase/authProvider.ts`
- `src/components/atomic-crm/providers/supabase/oauthCallback.ts`
- `src/components/atomic-crm/login/LoginPage.tsx`
- `src/components/atomic-crm/login/GoogleSignInButton.tsx`
- `src/components/admin/authentication.tsx`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- The corresponding auth tests plus `src/components/admin/authentication.test.tsx`

## Diff inspection

Inspect the complete diff from the baseline for the listed files, including the
untracked files above:

```bash
git diff 433840faa7956594343d610763b1b0a2b0f1e8e3 -- \
  src/components/admin/authentication.tsx \
  src/components/atomic-crm/login/GoogleSignInButton.test.tsx \
  src/components/atomic-crm/login/GoogleSignInButton.tsx \
  src/components/atomic-crm/login/LoginPage.test.tsx \
  src/components/atomic-crm/login/LoginPage.tsx \
  src/components/atomic-crm/providers/commons/englishCrmMessages.ts \
  src/components/atomic-crm/providers/supabase/authProvider.test.ts \
  src/components/atomic-crm/providers/supabase/authProvider.ts \
  src/components/atomic-crm/providers/supabase/oauthCallback.test.ts \
  src/components/atomic-crm/providers/supabase/oauthCallback.ts
```

Also inspect the three untracked files listed above directly.
