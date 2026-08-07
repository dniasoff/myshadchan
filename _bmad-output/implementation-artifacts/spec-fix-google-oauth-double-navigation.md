---
title: 'Fix Google OAuth double navigation across authentication pages'
type: 'bugfix'
created: '2026-08-07'
status: 'done'
review_loop_iteration: 1
baseline_commit: '14cc3c33917319448146b3a00f8f7f1dba9a3049'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Clicking “Continue with Google” starts Supabase’s external OAuth redirect and then React Admin’s `useLogin()` starts a second internal navigation. Under the app’s HashRouter, the absolute fallback URL becomes `#/login/https:/…`, producing hundreds of route changes, a visible flicker, and an unreliable handoff to Google.

**Approach:** Let Supabase own Google OAuth navigation exclusively. Both Google entry points will call the configured `authProvider.login()` directly, while OTP verification will retain `useLogin()` because that flow genuinely needs React Admin’s post-authentication navigation.

## Boundaries & Constraints

**Always:** Fix both returning-user sign-in and new-user Google signup; preserve signup-intent recording before OAuth; preserve pending, retry, notification, age-affirmation, callback, and `login_hint` behavior; audit every authentication page for the same navigation pattern; add a browser-backed regression that fails if clicking Google mutates the app URL after the provider call resolves.

**Ask First:** Any change to the Supabase callback URL, Google provider configuration, signup age gate, or the destination users reach after a completed OAuth callback.

**Never:** Disable Google OAuth; reintroduce Turnstile on the direct-Google path; delay navigation with timers; leave the promise unresolved to suppress `useLogin()`; alter OTP verification’s intended in-app redirect; perform a real Google account login in automated tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Returning-user Google sign-in | OAuth enabled; one button click | Exactly one provider login call; Supabase begins the external redirect; no React Router navigation | Provider rejection restores the button and shows the existing notification |
| New-user Google signup | Valid email and age affirmed | Signup intent settles before one provider login call with `login_hint`; no React Router navigation | Intent/provider failure restores retry behavior and shows the existing notification |
| Missing auth provider | Google button is rendered without a provider | No navigation occurs | Button is restored and the existing configuration error is shown |
| OTP verification | Valid emailed code | Existing `useLogin()` post-authentication navigation remains unchanged | Existing invalid-code behavior remains unchanged |

</frozen-after-approval>

## Code Map

- `src/components/atomic-crm/login/GoogleSignInButton.tsx` -- Returning-user OAuth entry point currently racing Supabase with `useLogin()` navigation.
- `src/components/atomic-crm/login/GoogleSignUpButton.tsx` -- Signup OAuth entry point with the same race after recording `signup_intents`.
- `src/components/atomic-crm/login/LoginPage.tsx` -- Sign-in host; OTP verification correctly retains `useLogin()`, while its Google redirect prop remains API-compatible but becomes a documented no-op.
- `src/components/atomic-crm/login/RegisterFlow.tsx` -- Signup host with the same OTP/OAuth distinction and compatibility boundary.
- `src/components/atomic-crm/login/GoogleSignInButton.test.tsx` -- Playwright-backed component coverage for direct provider invocation, URL stability, and errors.
- `src/components/atomic-crm/login/GoogleSignUpButton.test.tsx` -- Playwright-backed coverage for ordering, URL stability, and errors.
- `src/components/atomic-crm/providers/supabase/authProvider.ts` -- Supabase OAuth implementation already owning `window.location.assign()` and callback selection; unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `GoogleSignInButton.tsx`, `GoogleSignUpButton.tsx` -- replace `useLogin()` with direct `useAuthProvider()` calls while retaining the exported props and optional `redirect` fields as deprecated no-ops for registry compatibility; reject a missing provider before signup-intent side effects.
- [x] `LoginPage.tsx`, `RegisterFlow.tsx` -- leave OTP redirects intact and preserve existing Google component call shapes for downstream compatibility.
- [x] Google button tests -- prove provider call shapes, signup-intent ordering, provider/missing-provider recovery, notification identity, and zero browser-history mutations after a resolved provider call.
- [x] Playwright regression -- add a reproducible sign-in/signup test that intercepts the external handoff and asserts one OAuth request with zero same-origin route churn.
- [x] Authentication audit -- confirm no other OAuth/SSO entry point calls `useLogin()` and document why remaining uses are correct.

**Acceptance Criteria:**
- Given either Google entry point, when the user clicks once, then only Supabase owns navigation and no malformed hash route or same-origin redirect loop is created.
- Given all authentication pages, when their login calls are audited, then only completed OTP authentication uses React Admin’s automatic post-login navigation.

## Spec Change Log

- Review loop 1: adversarial review found that deleting `GoogleSignInButtonProps` and the optional Google `redirect` props would break registry consumers outside this repository. The implementation tasks now require those public shapes to remain as deprecated no-ops, avoiding a downstream TypeScript/API break. KEEP: direct provider invocation on both Google paths, Supabase as the sole navigation owner, signup-intent-before-OAuth ordering, OTP `useLogin()` behavior, pending/error recovery, and browser-backed regression coverage.

## Design Notes

`useLogin()` is appropriate when `authProvider.login()` finishes authentication in the current document. Supabase `signInWithOAuth()` instead calls `window.location.assign()` before resolving, so wrapping it with `useLogin()` creates two navigation owners. Direct provider invocation matches the existing `LoginPage.requestCode()` and `InviteAcceptance` precedent.

## Verification

**Commands:**
- `npm run test:unit:app -- src/components/atomic-crm/login/GoogleSignInButton.test.tsx src/components/atomic-crm/login/GoogleSignUpButton.test.tsx src/components/atomic-crm/login/LoginPage.test.tsx src/components/atomic-crm/login/RegisterFlow.test.tsx` -- all targeted browser tests pass.
- `npm run typecheck` -- TypeScript accepts direct-provider usage and the preserved compatibility props.
- `npx playwright test e2e/google-oauth-navigation.spec.ts --project=chromium` -- each Google entry point produces one outbound OAuth request and zero same-origin route/history changes before that request commits.
- `npm run lint` and `npm run build` -- lint, production compilation, and service-worker verification pass.
- `npx playwright test --project=chromium` -- the OAuth regression and 41 other scenarios pass; one unrelated invite test has a pre-existing ambiguous `input[readonly]` selector after a second read-only field was added elsewhere.

## Suggested Review Order

**Navigation ownership**

- Make Supabase the only navigation owner for returning-user Google OAuth.
  [`GoogleSignInButton.tsx:32`](../../src/components/atomic-crm/login/GoogleSignInButton.tsx#L32)

- Preserve signup intent and email hint while removing React Router's competing redirect.
  [`GoogleSignUpButton.tsx:33`](../../src/components/atomic-crm/login/GoogleSignUpButton.tsx#L33)

**Browser regression boundary**

- Hold the outbound request open and count history mutations in the live document.
  [`google-oauth-navigation.spec.ts:14`](../../e2e/google-oauth-navigation.spec.ts#L14)

- Prove intent completion, `login_hint`, and a single OAuth request on signup.
  [`google-oauth-navigation.spec.ts:172`](../../e2e/google-oauth-navigation.spec.ts#L172)

**Recovery and compatibility coverage**

- Verify sign-in call shape, history stability, missing-provider identity, and retry.
  [`GoogleSignInButton.test.tsx:83`](../../src/components/atomic-crm/login/GoogleSignInButton.test.tsx#L83)

- Verify signup ordering plus intent, provider, and configuration failure recovery.
  [`GoogleSignUpButton.test.tsx:109`](../../src/components/atomic-crm/login/GoogleSignUpButton.test.tsx#L109)

- Enable both public Google entry points in the browser-test environment.
  [`.env.e2e:6`](../../.env.e2e#L6)
