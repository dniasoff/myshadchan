---
title: 'Recover cleanly when sign-in finds no account'
type: 'bugfix'
created: '2026-08-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: '433840faa7956594343d610763b1b0a2b0f1e8e3'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The sign-in screen is passwordless in this app: it requests an email
code rather than accepting a password. For an email with no account, Supabase
returns `otp_disabled`, the auth provider currently hides that result, and the UI
advances to a code step that can never succeed. Google sign-in can similarly return
from the signup guard with no account-oriented recovery or create-account action.

**Approach:** Keep the passwordless architecture and expose a typed no-account
outcome only for the sign-in flow. Show a calm inline recovery with a direct
create-account link, and map an unknown Google sign-in callback to the same recovery
experience while preserving the existing single-owner OAuth navigation and timeout.

## Boundaries & Constraints

**Always:** Keep sign-in from creating accounts automatically; only the explicit
register flow may create one. Keep known-account OTP, wrong-code, provider-error,
cancelled-OAuth, and rate-limit behavior intact. Use translated copy and leave every
failed action retryable.

**Ask First:** Changes to Supabase provider settings, signup policy, callback hosts,
or introducing a real password-authentication path are outside this fix and require
separate approval.

**Never:** Do not add password authentication to this passwordless app, silently
advance an unknown email to the code step, expose raw Supabase error text, create a
user from the sign-in screen, reintroduce competing `useLogin()` OAuth navigation,
or perform a real Google login in automated tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unknown email-code sign-in | Sign-in `requestOtp` returns `otp_disabled` | Stay on email step; show “No account has been found. Would you like to create a new account?” and a `/register` action | Send-code control is enabled again; no code spinner/step |
| Existing email-code sign-in | Sign-in `requestOtp` succeeds | Keep the existing code step and verification behavior | Existing retry/resend handling remains unchanged |
| Unknown Google sign-in | Google callback carries the sign-in marker and the signup age guard rejection | Auth error page explains no account was found and offers create-account and sign-in actions | No raw age-hook text is shown |
| Google provider failure or cancellation | Callback is disabled-provider, cancellation, or another error | Keep the existing mapped Google message | Do not show a false no-account claim |
| Google handoff fails locally | Provider rejects or browser handoff stalls | Existing error/timeout message appears and the button can be retried | No permanent pending state |

</frozen-after-approval>

## Code Map

- `src/components/atomic-crm/providers/supabase/authProvider.ts` -- classify the sign-in OTP result and preserve the signup-only creation seam; mark the Google sign-in callback without changing OAuth ownership.
- `src/components/atomic-crm/providers/commons/authErrors.ts` -- define the stable app-level no-account error contract shared by the provider and login UI.
- `src/components/atomic-crm/login/LoginPage.tsx` -- render the inline no-account recovery and keep the request state recoverable.
- `src/components/atomic-crm/providers/supabase/oauthCallback.ts` -- map the marked Google signup-guard rejection to the no-account outcome.
- `src/components/admin/authentication.tsx` -- provide a create-account action on the callback error page while retaining sign-in.
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` -- add the user-facing translated strings.
- `src/components/atomic-crm/login/*test.tsx`, `src/components/atomic-crm/providers/supabase/*test.ts` -- cover both entry points and preserve existing error boundaries.

## Tasks & Acceptance

**Execution:**
- [x] `authProvider.ts`, `authErrors.ts`, `oauthCallback.ts` -- carry explicit no-account signals for email-code sign-in and marked Google callbacks without changing signup permissions.
- [x] `LoginPage.tsx`, `authentication.tsx`, `englishCrmMessages.ts` -- show the no-account message and direct create-account action, with retryable controls and accessible alert semantics.
- [x] Auth tests -- prove unknown email does not enter the code step, known email still does, Google unknown-account recovery is offered, unrelated Google errors are not mislabeled, and both loading states recover.

**Acceptance Criteria:**
- Given an email not linked to an account, when sign-in requests a code, then the user immediately sees the no-account recovery and can open account creation.
- Given a Google account not registered in MyShadchan, when the sign-in callback returns, then the user sees the same recovery choice instead of a blank/hanging error page.
- Given a valid account or an unrelated auth failure, when the corresponding action runs, then existing success/error behavior remains unchanged and no control is left spinning indefinitely.

## Design Notes

The current email path is intentionally OTP-only; the user-visible “Send code” flow
is the requested password-sign-in recovery surface. Supabase’s `otp_disabled` result
is converted to a domain outcome at the auth seam rather than displaying its raw
message. Google’s callback needs an explicit sign-in marker because the same age
guard also protects the separately approved signup flow.

## Verification

**Commands:**
- `npm run test:unit:app -- src/components/atomic-crm/login/LoginPage.test.tsx src/components/atomic-crm/login/GoogleSignInButton.test.tsx src/components/atomic-crm/providers/supabase/authProvider.test.ts src/components/atomic-crm/providers/supabase/oauthCallback.test.ts` -- expected: targeted auth tests pass.
- `npm run typecheck` -- expected: no TypeScript errors.
- `npm run lint` -- expected: auth files pass lint; unrelated pre-existing worktree formatting is reported separately.
- `npm run build` -- expected: production bundle succeeds.

## Suggested Review Order

**OAuth callback ownership and routing**

- Keep the sign-in flow marker out of the Supabase redirect URL while preserving callback ownership.
  [`authProvider.ts:240`](../../src/components/atomic-crm/providers/supabase/authProvider.ts#L240)

- Normalize GoTrue error fragments before HashRouter and Supabase parse the callback.
  [`index.html:163`](../../index.html#L163)

- Map only the trusted signup age rejection to no-account recovery.
  [`oauthCallback.ts:49`](../../src/components/atomic-crm/providers/supabase/oauthCallback.ts#L49)

- Provide both registration and sign-in actions for the callback error page.
  [`authentication.tsx:66`](../../src/components/admin/authentication.tsx#L66)

**Email OTP recovery and retryability**

- Convert unknown-email OTP responses into a typed outcome and reset the request state.
  [`LoginPage.tsx:116`](../../src/components/atomic-crm/login/LoginPage.tsx#L116)

- Guard resend requests so a single-use captcha and concurrent clicks remain recoverable.
  [`LoginPage.tsx:158`](../../src/components/atomic-crm/login/LoginPage.tsx#L158)

**Supporting contract and tests**

- Keep the no-account error contract stable across provider and UI layers.
  [`authErrors.ts:1`](../../src/components/atomic-crm/providers/commons/authErrors.ts#L1)

- Verify callback normalization and representative GoTrue error shapes.
  [`oauthCallbackHashFix.test.ts:1`](../../src/components/atomic-crm/providers/supabase/oauthCallbackHashFix.test.ts#L1)

- Verify email, Google, callback, and error-page behavior without real OAuth.
  [`LoginPage.test.tsx:94`](../../src/components/atomic-crm/login/LoginPage.test.tsx#L94)
