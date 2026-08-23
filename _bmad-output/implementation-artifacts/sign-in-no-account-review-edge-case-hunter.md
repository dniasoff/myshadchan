# Edge Case Hunter review packet: sign-in no-account recovery

Invoke the `bmad-review-edge-case-hunter` skill on the implementation described
below. Walk every branch and boundary condition without relying on prior
conversation context. Report only unhandled edge cases, with file and line
references, triggering state, consequence, and a minimal fix.

## Baseline

`433840faa7956594343d610763b1b0a2b0f1e8e3`

## Required behavior

- An unknown email on the passwordless `requestOtp` sign-in path must stay on the
  email step, show “No account has been found. Would you like to create a new
  account?”, and offer `/register`.
- A returning-user Google OAuth callback rejected by the signup age guard must show
  the same recovery, while signup callbacks retain their age message.
- Existing-account OTP, wrong-code, rate-limit, provider-error, cancellation, and
  Google timeout/retry behavior must remain intact.
- No automatic signup, raw backend error text, competing OAuth navigation, or real
  Google login in tests.

## Changed files

Review these files and their tests against baseline commit
`433840faa7956594343d610763b1b0a2b0f1e8e3`:

- `src/components/atomic-crm/providers/commons/authErrors.ts`
- `src/components/atomic-crm/providers/supabase/authProvider.ts`
- `src/components/atomic-crm/providers/supabase/oauthCallback.ts`
- `src/components/atomic-crm/login/LoginPage.tsx`
- `src/components/atomic-crm/login/GoogleSignInButton.tsx`
- `src/components/admin/authentication.tsx`
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts`
- The corresponding auth tests plus `src/components/admin/authentication.test.tsx`

Use the complete tracked diff with:

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

Inspect the three untracked files listed above directly as well.
