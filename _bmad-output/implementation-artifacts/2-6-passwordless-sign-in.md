# Story 2.6: Passwordless Sign-In

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a non-technical user,
I want to sign in with an emailed code instead of a password,
so that I never have to create, remember or reset one.

## Dependencies

Independent of 2.1–2.5. **Feeds Story 2.7** directly: invite acceptance reuses this
story's OTP primitives (`sendOtp`/`verifyOtp`) rather than building a second passwordless
path — 2.7 does not re-implement email-OTP, it adds invite-token verification *around*
what this story builds.

## Decision — email-OTP (code entry), not a clickable magic link

AD-11 names both ("magic-link / email-OTP is the load-bearing native path") as options
under one umbrella, not two mandatory mechanisms. **This story implements the
code-entry form** (enter email → receive a 6-digit code → type it back in), not a
clickable link, for one concrete reason: a magic link opened in a different tab, a
different browser, or forwarded by the "share to a spouse's phone" pattern this product
already leans on elsewhere breaks the session-continuity a link-based flow assumes,
while a typed-back code has no such constraint. This also gives the whole product one
canonical passwordless shape (NFR-14 — one code path per behaviour) instead of two. Both
directions call the same Supabase primitive (`auth.signInWithOtp`); the difference is
purely which email template is served and how the client verifies (`auth.verifyOtp`).

## Acceptance Criteria

1. **Login is a two-step email-OTP form, not a password form.** `login/LoginPage.tsx`:
   step one collects an email and calls `login({ email, requestOtp: true })`; step two
   collects the 6-digit code and calls `login({ email, token, verifyOtp: true })`. Both
   route through the **same** `authProvider.login()` entry point, extended with the two
   new boolean flags, following the exact pattern `params.oauthProvider` /
   `params.ssoDomain` already establish in `providers/supabase/authProvider.ts` — not a
   second, parallel auth seam.

2. **Password sign-in is deleted, not hidden.** Every password-specific file is removed
   outright: `login/PasswordInput.tsx`, `login/PasswordToggleButton.tsx`,
   `settings/ChangePasswordButton.tsx`, `src/components/supabase/set-password-page.tsx`,
   `src/components/supabase/forgot-password-page.tsx`, and the
   `supabase/functions/update_password/` edge function. Every import of any of them is
   removed, not commented out. `disableEmailPasswordAuthentication` (the config flag
   `LoginPage.tsx`/`SignupPage.tsx` currently branch on) is deleted from
   `root/ConfigurationContext.tsx`/`defaultConfiguration.ts` — the branch it guarded no
   longer exists, so the flag guarding it is dead, not merely defaulted to `true`.

3. **Google sign-in is deleted, not hidden.** `login/GoogleSignInButton.tsx` (+
   `.test.tsx`), `login/googleOAuth.ts`, and `[auth.external.google]` in
   `supabase/config.toml` (removed entirely, not set `enabled = false` — a disabled-but-present
   block is exactly the "aliased/dormant" shape NFR-14 forbids) are all deleted.
   `authProvider.ts`'s `params.oauthProvider` branch (the generic OAuth-provider login
   path `GoogleSignInButton` was the only caller of) is removed with it.

4. **The Google Workspace SSO path is deleted too, and this is a deliberate reading of
   "no second authentication path."** `login/SSOAuthButton.tsx`, `authProvider.ts`'s
   `params.ssoDomain` branch, `[auth.oauth_server]`'s SAML-domain SSO usage, and the
   `googleWorkplaceDomain` configuration option are removed. FR118 names only "Google
   sign-in"; AD-11's stronger, general statement — "there is no second authentication
   path" — is what actually settles it: a domain-based SAML SSO login is a second path
   by any reading, regardless of which identity provider backs it. See Dev Notes
   "Why SSO goes too" for the full reasoning, since this is this story's own inference,
   not a verbatim quote.

5. **`[auth.oauth_server]` itself is explicitly untouched — a different feature, not
   confused with AD-11's target.** This app acting as an **OAuth provider** for a third
   party (the `oauth-consent-page.tsx` / `getAuthorizationDetails`/`approveAuthorization`
   /`denyAuthorization` surface, feeding the `mcp` edge function) is unrelated to how a
   *user* authenticates *into* this app — AD-11 governs the latter. Do not delete
   `src/components/supabase/oauth-consent-page.tsx` or the `[auth.oauth_server]` config
   block; flag any confusion between the two in review rather than acting on it.

6. **The email-OTP flow works end to end locally.** `[auth.email.template.magic_link]`
   is added to `supabase/config.toml`, pointing at a new
   `supabase/templates/magic_link.html` that surfaces `{{ .Token }}` (the 6-digit code)
   prominently — matching the existing `invite.html`/`recovery.html` template precedent
   already in `supabase/templates/`. Tested via Inbucket
   (`http://localhost:54324/`, per AGENTS.md).

7. **No fallback authentication path remains anywhere.** `grep -rniE
   "signInWithPassword|signInWithOAuth|signInWithSSO|PasswordInput|GoogleSignInButton|SSOAuthButton"
   src/` returns zero hits (`oauth-consent-page.tsx`'s unrelated OAuth-server surface is
   the one deliberate exception to the broader "no OAuth" reading — it contains none of
   these specific tokens anyway, so the grep does not need to allow-list it).

8. **Toolchain green**: `make typecheck && npm run lint && make test`. This story
   touches no RLS/schema, so `npm run test:unit:db` is unaffected but must still pass
   (it depends on 2.1/2.2's suites remaining green, not on anything this story adds).

## Tasks / Subtasks

- [ ] **Task 1 — authProvider: OTP request + verify** (AC: 1)
  - [ ] `providers/supabase/authProvider.ts`: extend `login()` — `params.requestOtp`
        calls `getSupabaseClient().auth.signInWithOtp({ email: params.email })`;
        `params.verifyOtp` calls `getSupabaseClient().auth.verifyOtp({ email:
        params.email, token: params.token, type: "email" })` (confirm the exact `type`
        value against the pinned `@supabase/supabase-js` 2.110.8 API before
        implementing — it has shifted across SDK versions).
  - [ ] Remove the `params.oauthProvider` and `params.ssoDomain` branches (AC-3, AC-4)
        and the `getAuthorizationDetails`/`approveAuthorization`/`denyAuthorization`
        pass-throughs stay (AC-5 — unrelated feature, do not remove).

- [ ] **Task 2 — `LoginPage.tsx` rewrite** (AC: 1)
  - [ ] Two-step form per AC-1: email step, then code step. Reuse
        `AUTH_FIELD_CLASSNAME`/`PRIMARY_CTA_CLASSNAME` for visual consistency with the
        rest of `login/`.
  - [ ] Remove the `googleEnabled`/`googleWorkplaceDomain` branches and every reference
        to `GoogleSignInButton`/`SSOAuthButton`/`isGoogleOAuthEnabled`.
  - [ ] Remove the `/set-password` / `/forgot-password` special-casing inside
        `authProvider.ts`'s `checkAuth()` — those routes no longer exist (Task 4).

- [ ] **Task 3 — Delete every password/Google/SSO file** (AC: 2, 3, 4)
  - [ ] `git rm login/PasswordInput.tsx login/PasswordToggleButton.tsx
        login/GoogleSignInButton.tsx login/GoogleSignInButton.test.tsx
        login/googleOAuth.ts login/SSOAuthButton.tsx settings/ChangePasswordButton.tsx`.
  - [ ] `git rm src/components/supabase/set-password-page.tsx
        src/components/supabase/forgot-password-page.tsx`.
  - [ ] `git rm -r supabase/functions/update_password`.
  - [ ] Remove `dataProvider.updatePassword()` from both `providers/supabase/dataProvider.ts`
        and `providers/fakerest/dataProvider.ts`, and its sole caller in
        `settings/ProfileSection.tsx` (verify the exact call site — grep before editing).

- [ ] **Task 4 — Route cleanup** (AC: 2)
  - [ ] `root/CRM.tsx`: remove both `<Route path={SetPasswordPage.path} …>` /
        `<Route path={ForgotPasswordPage.path} …>` pairs (desktop and mobile — the file
        registers each twice, per the current grep) and their imports. Remove the
        `<Link to={"/forgot-password"}>` in the old `LoginPage.tsx` (superseded by
        Task 2's rewrite).

- [ ] **Task 5 — Config** (AC: 3, 4, 6)
  - [ ] `supabase/config.toml`: delete `[auth.external.google]` entirely; delete the
        `googleWorkplaceDomain` / SSO-domain configuration surface (check
        `root/defaultConfiguration.ts` and `root/ConfigurationContext.tsx` for where it
        is declared).
  - [ ] Add `[auth.email.template.magic_link]` + `supabase/templates/magic_link.html`
        per AC-6.
  - [ ] Delete `disableEmailPasswordAuthentication` from
        `root/ConfigurationContext.tsx`/`defaultConfiguration.ts` and every read of it.

- [ ] **Task 6 — `SignupPage.tsx`** (AC: 1)
  - [ ] Do **not** rewrite `SignupPage.tsx`'s signup gating logic in this story — that
        is Story 2.7's (the `isInitialized` gate and the invite-token check are one
        connected change). This story only removes the password field and
        Google/SSO buttons from it (mirroring Task 2's `LoginPage.tsx` changes),
        leaving a `// TODO(2.7)`-free but otherwise still-gated signup form for 2.7 to
        finish. State this boundary explicitly in the PR description so 2.7 is not
        surprised by a half-migrated file.

- [ ] **Task 7 — Verify** (AC: 7, 8)
  - [ ] Run the AC-7 grep; confirm zero hits.
  - [ ] `make typecheck && npm run lint && make test`.
  - [ ] Manual smoke via Inbucket: request a code, receive it, sign in.

## Dev Notes

### Why SSO goes too — this story's own inference, flagged as such

FR118 says "Password and Google sign-in deleted" — read narrowly, that is silent on
`SSOAuthButton`'s Google-Workspace-domain SAML path. AD-11's stronger clause — "there is
no second authentication path" — is what actually resolves it: a domain-gated SSO login
is structurally a second path regardless of which identity provider sits behind it, and
leaving it would mean this story's own AC-7 verification grep ("no fallback
authentication path remains") is false the moment it ships. This is presented as a
reasoned decision, not a verbatim requirement — flag it in review if the epic owner
intended `SSOAuthButton` to survive for an enterprise/B2B path not otherwise described
anywhere in the SPEC or PRD amendment (nothing found suggests one exists).

### The `oauth-consent-page.tsx` line this story must not cross

`src/components/supabase/oauth-consent-page.tsx`, `[auth.oauth_server]` in
`config.toml`, and `authProvider.ts`'s `getAuthorizationDetails` /
`approveAuthorization` / `denyAuthorization` methods implement this app as an **OAuth
provider** — something else (the `mcp` edge function, per `supabase/functions/mcp/`)
authenticates *against* this app using OAuth. That is orthogonal to how a *user* logs
into this app, which is what AD-11 and this story govern. Confusing the two and
deleting the OAuth-server surface would break MCP integration for a reason unrelated to
passwordless auth — a real, easy-to-make mistake given how much OAuth-flavoured code
this story otherwise removes.

### Verified current state

- `login/LoginPage.tsx` (161 lines): password form + `GoogleSignInButton` +
  `SSOAuthButton` + `/forgot-password` link, gated by `disableEmailPasswordAuthentication`.
- `login/SignupPage.tsx` (238 lines): password-based signup, `isInitialized`-gated
  (Story 2.7's to finish rewiring; Task 6 above only strips the password/Google/SSO UI).
- `providers/supabase/authProvider.ts:95-120`: the exact `login()` branch structure
  (`oauthProvider` / `ssoDomain` / fallback to `baseAuthProvider.login`) this story
  extends with `requestOtp`/`verifyOtp` and then narrows by removing the other two
  branches.
- `root/CRM.tsx:14-15,256-259,333-336`: the two duplicated `SetPasswordPage`/
  `ForgotPasswordPage` route registrations (desktop + mobile sections of the same file).
- `supabase/config.toml:143-160`: `[auth.external.google]`, with its own inline
  commentary on why `enabled` is a literal boolean, not `env(...)`-indirected — read it
  before deleting the block, since the same care (no `env()` on a boolean key) applies
  to any other config this story touches.
- `supabase/functions/update_password/index.ts` — confirm it has no other caller before
  deleting (grep for `"update_password"` across `src/`; the only expected hit is
  `providers/supabase/dataProvider.ts`'s `updatePassword` method, itself removed by
  Task 3).

### Testing standards

Component tests for the two-step `LoginPage` (request → verify), matching existing
`*.test.tsx` conventions. No SQL in this story.

### Project Structure Notes

Net file-count reduction: `PasswordInput.tsx`, `PasswordToggleButton.tsx`,
`GoogleSignInButton.tsx` (+ test), `googleOAuth.ts`, `SSOAuthButton.tsx`,
`ChangePasswordButton.tsx`, `set-password-page.tsx`, `forgot-password-page.tsx`, and the
whole `update_password/` function directory are deleted; no new files beyond
`supabase/templates/magic_link.html`.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-11] — "magic-link / email-OTP is the load-bearing
  native path … Password and Google sign-in are deleted, not wound down … there is no
  second authentication path."
- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.6] — the story's own AC
  text.
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Constraints] — "Authentication is
  passwordless and invite-only, with an 18+ affirmation."

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
