# Story 2.6: Passwordless Sign-In

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- REFRESHED against the post-Epic-1 tree (2026-07-28). Every file path, line
     number and count below was re-verified against `main` at commit c711266.
     Epic 1 landed `sales`→`members`, `children`→`singles`, the fossil-resource
     deletion, the token-portal retirement, and — the one that matters most here —
     the route **manifest** (`root/routeManifest.ts`): there is no hand-written
     `<Route>`/`<Resource>` JSX in `root/CRM.tsx` to edit any more. -->

## Story

As a non-technical user,
I want to sign in with an emailed code instead of a password,
so that I never have to create, remember or reset one.

## Dependencies

Independent of 2.1–2.5. **Feeds Story 2.7** directly: invite acceptance reuses this
story's OTP primitives (the `requestOtp`/`verifyOtp` login flags, plus the
`allowSignup`/`meta` passthrough built for exactly that hand-off — AC-2) rather than
building a second passwordless path — 2.7 does not re-implement email-OTP, it adds
invite-token verification *around* what this story builds.

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

## Scope boundary with Story 2.7 — read this before deleting anything

2.7 owns `login/SignupPage.tsx` **entirely** (its own Task 6: `git rm login/SignupPage.tsx`,
`git rm login/StartPage.tsx`, `git rm login/ConfirmationRequired.tsx`, and removal of
`dataProvider.signUp()` / `isInitialized()`). This story therefore **does not** touch
`SignupPage.tsx`'s password field, and **does not** delete
`login/PasswordToggleButton.tsx` — see AC-3's carve-out. Sign-**in** goes passwordless
here; sign-**up** is 2.7's, in one connected change.

## Acceptance Criteria

1. **Login is a two-step email-OTP form, not a password form.**
   `src/components/atomic-crm/login/LoginPage.tsx` (197 lines today): step one collects
   an email and calls `login({ email, requestOtp: true })`; step two collects the
   6-digit code and calls `login({ email, token, verifyOtp: true })`. Both route through
   the **same** `authProvider.login()` entry point, extended with the two new flags,
   following the exact pattern `params.oauthProvider` / `params.ssoDomain` already
   establish at `providers/supabase/authProvider.ts:95-120` — not a second, parallel
   auth seam. **The login path never creates a user**: the `requestOtp` branch passes
   `options: { shouldCreateUser: false }` — without it, `signInWithOtp`'s default
   (`true`) turns the login form into open self-signup for any typed email, which the
   SPEC forbids outright ("no open self-signup"). An unknown email gets the same neutral
   "check your email" step as a known one (no account-existence oracle); it simply never
   receives a code.
   **Scope of that guarantee, stated honestly:** `shouldCreateUser: false` is a
   *client-side* argument. `[auth] enable_signup = true` (`supabase/config.toml:83`,
   `config.e2e.toml:84`) and `[auth.email] enable_signup = true` (`config.toml:94`,
   `config.e2e.toml:90`) are both still on, so a hand-rolled POST to `/auth/v1/otp` with
   `create_user: true` would still mint a user. Closing that server-side is **Story 2.7's
   `before-user-created` Auth Hook**, not this story's — do not silently claim otherwise,
   and do not flip `enable_signup = false` here (2.7's invite acceptance needs GoTrue to
   be able to create users; the hook is what decides *which*).
   Decided by: `grep -n "shouldCreateUser" src/components/atomic-crm/providers/supabase/authProvider.ts`
   returns exactly one hit, with `params.allowSignup === true` as its only source of `true`.

2. **The `login()` seam carries what 2.7 needs, so 2.7 adds no second auth path.** The
   `requestOtp` branch accepts two optional params and forwards them to
   `signInWithOtp`: `params.allowSignup` → `options.shouldCreateUser` (default
   `false`), and `params.meta` → `options.data` (the metadata payload GoTrue stores in
   `raw_user_meta_data` — the same `options.data` mechanism the fork's password
   `signUp()` uses for `first_name`/`last_name` today at
   `providers/supabase/dataProvider.ts:117-127`, the `options` object itself on lines
   121-126). This story's own `LoginPage` passes neither; Story 2.7's
   `InviteAcceptance` passes both (`invite_token`, `age_affirmed`). Building the seam
   here keeps 2.7's "reuses this story's OTP primitives" literally true.

3. **Password sign-in is deleted, not hidden.** Every password-*sign-in* file is removed
   outright:
   - `src/components/atomic-crm/login/PasswordInput.tsx`
   - `src/components/atomic-crm/settings/ChangePasswordButton.tsx`
   - `src/components/supabase/set-password-page.tsx` (`SetPasswordPage.path = "set-password"`, line 126)
   - `src/components/supabase/forgot-password-page.tsx` (`ForgotPasswordPage.path = "forgot-password"`, line 105)
   - `supabase/functions/update_password/` (whole directory), **plus** its two config
     registrations: `[functions.update_password]` at `supabase/config.toml:184-185` and
     `supabase/config.e2e.toml:161-162`.

   **Deliberate carve-out — `login/PasswordToggleButton.tsx` SURVIVES this story.** It has
   two importers today: `login/PasswordInput.tsx` (deleted here) and
   `login/SignupPage.tsx:21` (used at line 208), which 2.7 deletes. Deleting it now would
   break `SignupPage.tsx`, which this story must leave working — see the scope-boundary
   section. It goes out with `SignupPage.tsx` in 2.7. State this in the PR description.

   **`ChangePasswordButton`'s real call sites** are `settings/SettingsPage.tsx:16,88` and
   `settings/SettingsPageMobile.tsx:8,44` — **not** `settings/ProfileSection.tsx` (which
   does not reference it; verified by grep). Its data path
   `dataProvider.updatePassword()` is removed from both providers:
   `providers/supabase/dataProvider.ts:195-208` and
   `providers/fakerest/dataProvider.ts:554`.

   `disableEmailPasswordAuthentication` — the config flag `LoginPage.tsx`, `SignupPage.tsx`
   and `login/StartPage.tsx` branch on — is deleted along with **every** read (9 lines
   across 4 files today: `root/ConfigurationContext.tsx:15` (the type field),
   `root/CRM.tsx:113-114` (the `VITE_DISABLE_EMAIL_PASSWORD_AUTHENTICATION` default) and
   `root/CRM.tsx:142` (the store seed), `login/StartPage.tsx:12,27`,
   `login/LoginPage.tsx:28,140,152,184`), including `StartPage.tsx`'s
   `if (disableEmailPasswordAuthentication) return <LoginPage />` branch — the branch it
   guarded no longer exists, so the flag is dead, not merely defaulted to `true`.
   **Correction to the pre-Epic-1 draft:** the flag is **not** declared in
   `root/defaultConfiguration.ts` — that file declares only `taskTypes`, `title`,
   `darkModeLogo`, `lightModeLogo`. Do not go looking for it there.
   (`StartPage` itself — the `isInitialized`-routing `loginPage` wrapper wired at
   `root/CRM.tsx:204` — survives this story and is deleted by 2.7 together with
   `isInitialized`; here it only loses the flag read.)

   **The framework's own password login page** — `src/components/admin/login-page.tsx`
   (password field at lines 78-80, `<Link to={"/forgot-password"}>` at lines 93-96) — is
   a *mutable dependency* (AGENTS.md: "modify files in `src/components/admin` directly").
   It never renders today because `root/CRM.tsx:204` passes `loginPage={StartPage}`, but
   it is still exported from `src/components/admin/index.ts:45` and is
   `<Admin>`'s default (`src/components/admin/admin.tsx:11,61,118,144`). Its password form
   and its now-dead `/forgot-password` link are removed too. AC-8's grep does **not**
   catch this file (it contains none of the six tokens) — it is called out here precisely
   because a token grep cannot decide it.

4. **Google sign-in is deleted, not hidden.**
   - `login/GoogleSignInButton.tsx` (117 lines) + `login/GoogleSignInButton.test.tsx` (95 lines)
   - `login/googleOAuth.ts` (the `isGoogleOAuthEnabled()` / `VITE_ENABLE_GOOGLE_OAUTH` gate)
   - `[auth.external.google]` at `supabase/config.toml:143-160` — removed **entirely**,
     not set `enabled = false`: a disabled-but-present block is exactly the
     "aliased/dormant" shape NFR-14 forbids. Read the block's own inline commentary
     (lines 144-153) before deleting: it explains why `enabled` is a literal boolean and
     never `env(...)`-indirected, and the same care applies to any other config key this
     story touches. **Note the drift:** that comment says "Kept `false` by default", but
     the committed value on line 154 is `enabled = true`. There is no
     `[auth.external.google]` block in `supabase/config.e2e.toml` — nothing to delete there.
   - `VITE_ENABLE_GOOGLE_OAUTH=true` at `.env.development:11`.
   - `doc/src/content/docs/developers/google-oauth.mdx` (the whole page).
   - `authProvider.ts:99-108`'s `params.oauthProvider` branch (the generic OAuth-provider
     login path `GoogleSignInButton` was the only caller of).
   - i18n key `crm.auth.google_oauth_not_configured` in **both**
     `providers/commons/englishCrmMessages.ts:127-128` and
     `providers/commons/frenchCrmMessages.ts:130-131`.

   **The out-of-repo half, which the in-repo greps cannot decide.** Google sign-in is
   *live in production*: `VITE_ENABLE_GOOGLE_OAUTH=true` is set on the Vercel project
   (Production + Preview + Development), and the Google provider is enabled with a real
   client id/secret in the **hosted Supabase dashboard** (project ref
   `krlqkxlczxlgienjunmd`). Deleting the code does not disable the provider server-side —
   `https://krlqkxlczxlgienjunmd.supabase.co/auth/v1/authorize?provider=google` keeps
   working. So this AC is decided by two steps, both required:
   (a) in-repo: AC-8's grep is clean; (b) deploy-time: `npx vercel env rm
   VITE_ENABLE_GOOGLE_OAUTH production|preview|development` and the Google provider
   toggled **off** in the hosted Supabase dashboard (Auth → Providers → Google), verified
   by that `authorize` URL returning GoTrue's `400 {"msg":"Unsupported provider: provider
   is not enabled"}`. Record (b) in the PR description as a deploy checklist item — it is
   not a code change and will not appear in the diff.

5. **The Google Workspace SSO path is deleted too, and this is a deliberate reading of
   "no second authentication path."** What actually exists and goes:
   - `login/SSOAuthButton.tsx` (67 lines)
   - `authProvider.ts:110-118`'s `params.ssoDomain` branch (`auth.signInWithSSO`)
   - the `googleWorkplaceDomain` configuration option — **11** reads across 4 files today
     (re-run `grep -rn "googleWorkplaceDomain" src/`): `root/ConfigurationContext.tsx:14`,
     `root/CRM.tsx:112,141`, `login/LoginPage.tsx:28,125,130,133`,
     `login/SignupPage.tsx:28,132,137,140` — plus the `VITE_GOOGLE_WORKPLACE_DOMAIN` env
     var it defaults from
   - `doc/src/content/docs/developers/sso.mdx` (documents both
     `VITE_GOOGLE_WORKPLACE_DOMAIN` at lines 104-107 and
     `VITE_DISABLE_EMAIL_PASSWORD_AUTHENTICATION` at lines 110-113)
   - i18n key `crm.auth.sign_in_google_workspace` in `englishCrmMessages.ts:126` and
     `frenchCrmMessages.ts:129`.

   **Correction to the pre-Epic-1 draft:** it claimed "`[auth.oauth_server]`'s SAML-domain
   SSO usage" is deleted. That is wrong twice over — it contradicts AC-6, and there is no
   SSO/SAML config to delete at all: `grep -niE "saml|sso" supabase/config.toml
   supabase/config.e2e.toml` returns **zero** hits. `signInWithSSO({ domain })` is purely a
   runtime call driven by the `googleWorkplaceDomain` prop; nothing in `config.toml`
   backs it. `[auth.oauth_server]` is a different feature entirely — see AC-6.

   FR118 names only "Google sign-in"; AD-11's stronger, general statement — "there is no
   second authentication path" — is what settles SSO: a domain-based SSO login is a second
   path by any reading, regardless of which identity provider backs it. See Dev Notes
   "Why SSO goes too" — this is this story's own inference, not a verbatim quote.

6. **`[auth.oauth_server]` itself is explicitly untouched — a different feature, not
   confused with AD-11's target.** This app acting as an **OAuth provider** for a third
   party (`src/components/supabase/oauth-consent-page.tsx`, `OAuthConsentPage.path =
   "/oauth/consent"` at line 228, registered in `root/routeManifest.ts:74-79`; the
   `getAuthorizationDetails` / `approveAuthorization` / `denyAuthorization` methods at
   `providers/supabase/authProvider.ts:172-184`; the `[auth.oauth_server]` block at
   `supabase/config.toml:87-90`; feeding `supabase/functions/mcp/`) is unrelated to how a
   *user* authenticates *into* this app — AD-11 governs the latter. Do not delete any of
   them; flag any confusion between the two in review rather than acting on it.
   Decided by: after the change, `grep -n "oauth" src/components/atomic-crm/providers/supabase/authProvider.ts`
   still shows the three `auth.oauth.*` pass-throughs and nothing else, and
   `routeManifest.ts` still registers `OAuthConsentPage.path`.

7. **The email-OTP flow works end to end locally.** `[auth.email.template.magic_link]` is
   added to **both** `supabase/config.toml` (next to the existing
   `[auth.email.template.invite]` at 101-103 and `[auth.email.template.recovery]` at
   105-107) **and** `supabase/config.e2e.toml` (its siblings at 97-99 and 101-103) —
   the e2e stack is a *separate* Supabase instance built from `config.e2e.toml`
   (`makefile:63-74` copies `supabase/templates/` into `.supabase-e2e/`, but the config is
   a distinct committed file). Without the block on the e2e side, GoTrue serves its
   built-in magic-link template, which renders a `{{ .ConfirmationURL }}` link and **no
   6-digit code**, and AC-9 cannot pass.

   Both blocks point at a new `supabase/templates/magic_link.html` that surfaces
   `{{ .Token }}` (the 6-digit code) prominently.
   **Correction to the pre-Epic-1 draft:** `invite.html` (70 lines) and `recovery.html`
   (75 lines) are the precedent for the *HTML shell* — branding, layout, the
   `auth-callback.html` suffix convention — but **neither surfaces `{{ .Token }}`**; both
   use `{{ .ConfirmationURL }}` only (`invite.html:61`, `recovery.html:63`).
   `magic_link.html` is the first template in this repo to print the token.

   **The mail catcher is Mailpit, not Inbucket.** AGENTS.md says Inbucket and the config
   key is still `[inbucket]` (legacy naming the Supabase CLI kept), but the running
   service on the configured port is **Mailpit v1.30.2** — verified by
   `curl -s http://127.0.0.1:54324/api/v1/info` returning `{"Version":"v1.30.2",…}`.
   Ports: **54324** for the dev stack (`[inbucket]` at `supabase/config.toml:55-58`),
   **54344** for the e2e stack (`supabase/config.e2e.toml:56-59`). Use Mailpit's API
   (`GET /api/v1/search?query=to:<address>` → `GET /api/v1/message/{ID}`), not Inbucket's
   `/api/v1/mailbox/{name}`.
   Decided by: request a code for a seeded member, read it out of Mailpit on 54324, type
   it into the form, land signed-in.

8. **No fallback authentication path remains anywhere.** The pre-Epic-1 grep is kept but
   **widened** — it under-covered in two ways, both verified today:
   - it scanned only `src/`, missing `supabase/`, `e2e/`, `doc/` and `.env*`;
   - `signInWithPassword` has **0 hits in the whole repo already** and always did — the
     fork's password login runs inside `ra-supabase-core`'s `supabaseAuthProvider`, reached
     through `baseAuthProvider.login(params)` at `authProvider.ts:119`. Grepping for a
     token that was never present is not a check.

   The replacement, which must return **zero** hits:

   ```
   grep -rniE "signInWithPassword|signInWithOAuth|signInWithSSO|PasswordInput|GoogleSignInButton|SSOAuthButton|googleOAuth|isGoogleOAuthEnabled|googleWorkplaceDomain|disableEmailPasswordAuthentication|updatePassword|update_password|forgot-password|set-password|VITE_ENABLE_GOOGLE_OAUTH|VITE_GOOGLE_WORKPLACE_DOMAIN|VITE_DISABLE_EMAIL_PASSWORD_AUTHENTICATION" \
     src/ e2e/ supabase/ doc/src/ .env.development .env.e2e
   ```

   **Baselines, both re-run today (do not take either number on faith — run them):**
   the six original tokens over `src/` alone → **33 lines across 10 files**; the widened
   pattern over the paths above → **107 lines across 29 files**.

   The widened pattern deliberately does **not** include `PasswordToggleButton` (AC-3
   keeps the component) and does not include the bare word `password` (`SignupPage.tsx`
   legitimately still has one until 2.7; a bare-`password` sweep hits 136 lines across
   35 files today, almost all noise).

   **Four files that survive this story carry stale doc-comments that the widened grep
   catches** — they are not incidental, they name components that will no longer exist, so
   updating them is required work, not grep-appeasement:
   `login/PasswordToggleButton.tsx:16` ("Shared by `PasswordInput` … and `SignupPage`"),
   `login/authFieldClassName.ts:6`, `login/AuthLayout.tsx:13`, `login/BrandLockup.tsx:25`
   (all three enumerate "forgot/set-password" among the auth screens). See Task 10.

   Two things the grep provably cannot decide, so they are asserted separately here:
   - `src/components/admin/login-page.tsx` — handled by AC-3's explicit clause; verify by
     reading the file, not by grep.
   - `baseAuthProvider.login(params)` must no longer be reachable with an
     `{ email, password }` payload: after the change `authProvider.login()` handles
     `requestOtp` / `verifyOtp` and throws on anything else, rather than falling through
     to `ra-supabase-core`. Verify by reading `login()`.

   `oauth-consent-page.tsx`'s OAuth-*server* surface is the one deliberate exception to the
   broader "no OAuth" reading (AC-6) — it contains none of these tokens anyway, so the
   grep needs no allow-list.

9. **The e2e suite still signs in.**
   **Correction to the pre-Epic-1 draft:** there is no "shared e2e sign-in helper in
   `e2e/fixtures.ts`". `e2e/` holds exactly two files after Story 1.6 —
   `fixtures.ts` (132 lines) and `pipeline.spec.ts` (41 lines). The password sign-in is
   **inline in the spec**, at `e2e/pipeline.spec.ts:25-34`
   (`page.goto("http://localhost:5175/#/login")` → `getByLabel("Email")` →
   `locator('input[autocomplete="current-password"]')` → `getByRole("button", { name:
   "Sign in" })`). What lives in `fixtures.ts` is `createMember({ first_name, last_name,
   email, password })` at lines 33-66, which calls
   `adminSupabase.auth.admin.createUser({ email, password, email_confirm: true })` at
   lines 45-49 — the `password` parameter is what goes dead.

   Story 1.6's actual AC text (`1-6-tidy-code-baseline.md:288-289`): the spec "seeds a
   member and **one single** through `e2e/fixtures.ts`, then signs that user in through
   the email/password form on `/#/login`". Deleting password auth breaks it, and leaving
   it red is not an option (NFR-14: the replaced thing's dependents move in the same
   change).

   Rework:
   - `e2e/fixtures.ts`: drop `password` from `createMember`'s signature and from the
     `admin.createUser` call (keep `email_confirm: true` — the user must be confirmed for
     `shouldCreateUser: false` OTP to reach them). Export a new `signIn(page, email)`
     helper that drives the two-step OTP form, so later epics have one place to reuse.
   - `e2e/pipeline.spec.ts`: call the helper. Delete the obsolete 5-line comment at
     lines 28-32 explaining the `getByLabel("Password")` / `PasswordInput` Slot quirk —
     `PasswordInput.tsx` no longer exists.
   - Read the code from **Mailpit on port 54344** (the e2e stack's — *not* 54324):
     poll `GET http://127.0.0.1:54344/api/v1/search?query=to:<address>` with
     `expect.poll`, then `GET /api/v1/message/{ID}` for the body. Deterministic waits
     only — never `waitForTimeout` (`.claude/rules/testing.md`).
   - The e2e app origin stays `http://localhost:5175` (`makefile:44-45`, `.env.e2e`).

   Decided by: `make test-e2e-ci` (target at `makefile:114-116`) exits 0, with ≥1 passing
   test on each of the two Playwright projects (`chromium`, `Mobile Chrome`).

10. **Toolchain green.** All of:
    - `make typecheck` (`makefile:125-126` → `npm run typecheck`)
    - `npm run lint`
    - `make test` (`makefile:108-109` → `npm run test` → `vitest --config vitest.config.ts --run`).
      **Correction to the pre-Epic-1 draft:** this already runs **all five** vitest projects
      — `app`, `functions`, `workers`, `db`, `scripts` (`vitest.config.ts:37,96,105,114,126`).
      `npm run test:unit:db` is a *subset* of it, not a separate gate; it needs the e2e
      Supabase stack up (`make start-supabase-e2e`, then
      `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54342/postgres`, per the
      `test-db` job in `.github/workflows/check.yml`). This story touches no
      schema/RLS/policies, so the `db` project must stay green **unchanged**.
    - `node scripts/check-retired-names.mjs` — Story 1.6's AD-23 CI guard — reports no
      violations (nothing added here may reintroduce a retired name).
    - `make test-e2e-ci` (AC-9).

## Tasks / Subtasks

- [x] **Task 1 — authProvider: OTP request + verify** (AC: 1, 2, 6, 8)
  - [x] `providers/supabase/authProvider.ts`: extend `login()` — `params.requestOtp`
        calls `getSupabaseClient().auth.signInWithOtp({ email: params.email, options:
        { shouldCreateUser: params.allowSignup === true, data: params.meta } })`
        (AC-1/AC-2 — `shouldCreateUser` defaults hard to `false`; only 2.7's
        invite-acceptance flow ever passes `allowSignup`); `params.verifyOtp` calls
        `getSupabaseClient().auth.verifyOtp({ email: params.email, token: params.token,
        type: "email" })`.
        **The `type` value is settled, not a guess:** the pinned
        `@supabase/supabase-js` **2.110.8** ships `auth-js` whose
        `EmailOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' |
        'email' | (string & {})` (`node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:693`),
        and its own JSDoc example is `verifyOtp({ email, token, type: 'email' })`
        (`GoTrueClient.d.ts:1119`). Use `"email"`.
  - [x] Remove the `params.oauthProvider` branch (lines 99-108, AC-4) and the
        `params.ssoDomain` branch (lines 110-118, AC-5).
  - [x] Replace the `return baseAuthProvider.login(params)` fallback (line 119) with an
        explicit throw — AC-8's second non-greppable assertion. `ra-supabase-core`'s
        password login must be unreachable.
  - [x] **Keep** `getAuthorizationDetails` / `approveAuthorization` / `denyAuthorization`
        (lines 172-184) — AC-6, unrelated feature.
  - [x] Remove the `/set-password` and `/forgot-password` special-cases in `checkAuth()`
        (lines 126-139). **Keep** the `#/sign-up` case (lines 140-146) — 2.7 removes it
        with `SignupPage`.

- [x] **Task 2 — `LoginPage.tsx` rewrite** (AC: 1)
  - [x] Two-step form per AC-1: email step, then code step. Reuse
        `AUTH_FIELD_CLASSNAME` (`login/authFieldClassName.ts`) and
        `PRIMARY_CTA_CLASSNAME` (`login/primaryCtaClassName.ts`) for visual consistency
        with the rest of `login/`; keep the existing `AuthLayout` shell and footer.
  - [x] Remove the `googleEnabled` / `googleWorkplaceDomain` branches (lines 125-150) and
        every reference to `GoogleSignInButton` / `SSOAuthButton` / `isGoogleOAuthEnabled`
        (imports at lines 11-14).
  - [x] Remove the `passwordRecoveryEmailSent` effect (lines 32, 39-64) and the
        `/forgot-password` `<Link>` (lines 184-193) — both are dead once
        `forgot-password-page.tsx` is gone.

- [x] **Task 3 — Delete the password / Google / SSO files** (AC: 3, 4, 5)
  - [x] `git rm src/components/atomic-crm/login/PasswordInput.tsx
        src/components/atomic-crm/login/GoogleSignInButton.tsx
        src/components/atomic-crm/login/GoogleSignInButton.test.tsx
        src/components/atomic-crm/login/googleOAuth.ts
        src/components/atomic-crm/login/SSOAuthButton.tsx
        src/components/atomic-crm/settings/ChangePasswordButton.tsx`.
  - [x] **Do NOT** `git rm login/PasswordToggleButton.tsx` — AC-3 carve-out; it still has
        a live importer in `login/SignupPage.tsx:21,208`, which 2.7 owns.
  - [x] `git rm src/components/supabase/set-password-page.tsx
        src/components/supabase/forgot-password-page.tsx`.
  - [x] `git rm -r supabase/functions/update_password`.
  - [x] Remove `updatePassword` from `providers/supabase/dataProvider.ts:195-208` and
        `providers/fakerest/dataProvider.ts:554`, and its two render sites
        `settings/SettingsPage.tsx:16,88` and `settings/SettingsPageMobile.tsx:8,44`.
  - [x] `src/components/admin/login-page.tsx`: remove the password field (lines 78-80)
        and the `/forgot-password` link (lines 93-96) — AC-3's mutable-dependency clause.
        If nothing meaningful remains, delete the file and its
        `src/components/admin/index.ts:45` export, and point
        `src/components/admin/admin.tsx`'s `loginPage` default at the CRM `LoginPage`.

- [x] **Task 4 — Route manifest cleanup** (AC: 3)
  - [x] **This is `root/routeManifest.ts`, not `root/CRM.tsx`.** Epic 1 (story 1.5)
        replaced every hand-written `<Route>` / `<Resource>` with the manifest;
        `CRM.tsx` now only maps over it (`renderCustomRoutes` at lines 45-49, applied at
        226-231 desktop / 271-276 mobile). Nothing route-shaped in `CRM.tsx` needs editing
        for this story.
  - [x] `root/routeManifest.ts`: delete the `SetPasswordPage` entry (lines 62-67) and the
        `ForgotPasswordPage` entry (lines 68-73), plus their imports (lines 4 and 6).
        **Keep** the `OAuthConsentPage` entry (lines 74-79) — AC-6.
  - [x] `root/routeManifest.test.ts` (140 lines) asserts on manifest *shape*, not on those
        two paths (verified — no `set-password` / `forgot-password` reference in it). It
        should keep passing untouched; if it does not, fix the test, do not weaken it.

- [x] **Task 5 — Config** (AC: 3, 4, 5, 7)
  - [x] `supabase/config.toml`: delete `[auth.external.google]` (lines 143-160) entirely,
        including its comment block; delete `[functions.update_password]` (lines 184-185).
  - [x] `supabase/config.e2e.toml`: delete `[functions.update_password]` (lines 161-162).
        (No `[auth.external.google]` block exists there.)
  - [x] Add `[auth.email.template.magic_link]` to **both** config files, plus
        `supabase/templates/magic_link.html` surfacing `{{ .Token }}` — AC-7. Subject line
        in English (`.claude/rules/english-only.md`); do not copy the fork's
        "Atomic CRM" wording — the other two templates' subjects still say it, but new
        content uses "MyShadchan".
  - [x] Delete `disableEmailPasswordAuthentication` from `root/ConfigurationContext.tsx:15`
        and `root/CRM.tsx:113-114,142`, and `googleWorkplaceDomain` from
        `root/ConfigurationContext.tsx:14` and `root/CRM.tsx:112,141`. `CRMProps`
        (`CRM.tsx:59-66`) picks both up via `& Partial<ConfigurationContextValue>` — no
        separate edit needed there, but typecheck confirms it.
  - [x] `.env.development:11`: delete `VITE_ENABLE_GOOGLE_OAUTH=true`.

- [x] **Task 6 — `SignupPage.tsx`: Google/SSO only** (AC: 4, 5, 8)
  - [x] Remove **only** the `GoogleSignInButton` / `SSOAuthButton` / `isGoogleOAuthEnabled`
        / `googleWorkplaceDomain` block (imports at lines 18-20, hook at 28, `googleEnabled`
        at 105, JSX at 132-155). This is forced by AC-8's grep, not by a UI decision.
  - [x] **Leave the password field (lines 197-213), `PasswordToggleButton`, the
        `isInitialized` gate and `dataProvider.signUp()` exactly as they are.** Removing
        the password field here would break signup outright: `SignupPage` calls
        `dataProvider.signUp(data)` (line 42) → `auth.signUp({ email, password, … })`
        (`dataProvider.ts:118-127`), then immediately `login({ email, password })`
        (lines 45-49). Story 2.7 Task 6 deletes the whole file, `signUp()` and
        `isInitialized()` together. State this boundary explicitly in the PR description.

- [x] **Task 7 — i18n** (AC: 4, 5)
  - [x] Each key below was traced to its *only* reader; the verdict is not a judgement
        call. Remove from `providers/commons/englishCrmMessages.ts` (line numbers today)
        and mirror in `providers/commons/frenchCrmMessages.ts`:

        | key | en | fr | sole reader | verdict |
        |---|---|---|---|---|
        | `crm.action.reset_password` | 115 | 118 | `forgot-password-page.tsx:95` (deleted) | **remove** |
        | `crm.auth.confirm_password` | 120 | 123 | `set-password-page.tsx:106` (deleted) | **remove** |
        | `crm.auth.recovery_email_sent` | 123-124 | 126-127 | `LoginPage.tsx:48` (rewritten) | **remove** |
        | `crm.auth.sign_in_google_workspace` | 126 | 129 | `LoginPage.tsx:135`, `SignupPage.tsx:142` | **remove** |
        | `crm.auth.google_oauth_not_configured` | 127-128 | 130-131 | `GoogleSignInButton.tsx:48` (deleted) | **remove** |
        | `crm.auth.show_password` / `hide_password` | 129-130 | 132-133 | `PasswordToggleButton.tsx:25` (**survives**) | **keep** |
        | `crm.auth.confirmation_required` | 121-122 | 124-125 | `ConfirmationRequired.tsx:36` (**survives**, 2.7 deletes) | **keep** |

  - [x] Both files must stay structurally identical — a key present in one and not the
        other is a typecheck failure. (`ra-supabase.reset_password.*`, read at
        `forgot-password-page.tsx:66,71`, comes from `ra-supabase-core`'s own bundle —
        nothing to remove on our side.)
  - [x] Add the new OTP strings (email step, code step, "check your email", resend,
        invalid/expired code) to **both** files.

- [x] **Task 8 — Docs** (AC: 4, 5)
  - [x] `git rm doc/src/content/docs/developers/google-oauth.mdx` and
        `doc/src/content/docs/developers/sso.mdx`. Check `doc/astro.config.mjs` for an
        explicit sidebar entry pointing at either (it is autogenerated today — confirm,
        do not assume) and remove it if present.

- [x] **Task 9 — e2e rework** (AC: 9)
  - [x] `e2e/fixtures.ts`: drop `password` from `createMember` (lines 33-49); add a
        `signIn(page, email)` OTP helper reading Mailpit on **54344**.
  - [x] `e2e/pipeline.spec.ts`: use the helper; delete lines 12, 17, 28-33's password
        machinery and its now-false comment.

- [x] **Task 10 — Stale doc-comments in surviving files** (AC: 8)
  - [x] `login/PasswordToggleButton.tsx:16` — "Shared by `PasswordInput` (ra-core auth
        forms) and `SignupPage` (RHF)" → `SignupPage` only (until 2.7 takes both).
  - [x] `login/authFieldClassName.ts:6`, `login/AuthLayout.tsx:13`,
        `login/BrandLockup.tsx:25` — each enumerates "forgot/set-password" among the auth
        screens the shared styling covers. Rewrite the enumeration for the surviving set
        (login OTP, signup, confirmation, onboarding). These four are the only AC-8 grep
        hits that live in files this story keeps.

- [x] **Task 11 — Verify** (AC: 8, 9, 10)
  - [x] Run AC-8's widened grep; confirm zero hits. Read `admin/login-page.tsx` and
        `authProvider.login()` by hand for the two non-greppable assertions.
  - [x] `make typecheck && npm run lint && make test && node scripts/check-retired-names.mjs && make test-e2e-ci`.
  - [x] Manual smoke on the dev stack: request a code, read it from Mailpit
        (`http://localhost:54324/`), sign in.
  - [x] Write the AC-4(b) deploy checklist (Vercel env var + hosted Supabase Google
        provider) into the PR description.

## Dev Notes

### Why SSO goes too — this story's own inference, flagged as such

FR118 says "Password and Google sign-in deleted" — read narrowly, that is silent on
`SSOAuthButton`'s Google-Workspace-domain path. AD-11's stronger clause — "there is
no second authentication path" — is what actually resolves it: a domain-gated SSO login
is structurally a second path regardless of which identity provider sits behind it, and
leaving it would mean this story's own AC-8 verification grep ("no fallback
authentication path remains") is false the moment it ships. This is presented as a
reasoned decision, not a verbatim requirement — flag it in review if the epic owner
intended `SSOAuthButton` to survive for an enterprise/B2B path not otherwise described
anywhere in the SPEC or PRD amendment (nothing found suggests one exists).

Note also that the SSO path is *config-less*: unlike Google OAuth, there is nothing in
`supabase/config.toml` or the hosted dashboard to unwind — `grep -niE "saml|sso"` over
both config files returns zero. Deleting `SSOAuthButton.tsx`, the `ssoDomain` branch and
the `googleWorkplaceDomain` option removes the feature completely.

### The `oauth-consent-page.tsx` line this story must not cross

`src/components/supabase/oauth-consent-page.tsx`, `[auth.oauth_server]` at
`supabase/config.toml:87-90`, and `authProvider.ts:172-184`'s `getAuthorizationDetails` /
`approveAuthorization` / `denyAuthorization` methods implement this app as an **OAuth
provider** — something else (the `mcp` edge function, `supabase/functions/mcp/`)
authenticates *against* this app using OAuth. That is orthogonal to how a *user* logs
into this app, which is what AD-11 and this story govern. Confusing the two and
deleting the OAuth-server surface would break MCP integration for a reason unrelated to
passwordless auth — a real, easy-to-make mistake given how much OAuth-flavoured code
this story otherwise removes. (`[auth.oauth_server]` is absent from `config.e2e.toml`, so
the consent route is registered but the server is off under e2e. Pre-existing; not this
story's to change.)

### Verified current state (re-verified 2026-07-28 against `main` @ c711266)

- `login/LoginPage.tsx` — **197** lines (the pre-Epic-1 draft said 194): password form +
  `GoogleSignInButton` + `SSOAuthButton` + `/forgot-password` link, gated by
  `disableEmailPasswordAuthentication`.
- `login/SignupPage.tsx` — 238 lines: password-based signup, `isInitialized`-gated.
  **2.7's, not this story's**, apart from the Google/SSO block (Task 6).
- `providers/supabase/authProvider.ts:95-120` — the `login()` branch structure
  (`oauthProvider` 99-108 / `ssoDomain` 110-118 / `baseAuthProvider.login` fallback 119)
  this story extends with `requestOtp`/`verifyOtp` and then narrows to only those two.
- `root/routeManifest.ts:4,6` (imports) and `:62-73` (the two entries) — **this replaces
  the pre-Epic-1 draft's `root/CRM.tsx:14-15,256-259,333-336`, which no longer exists.**
  Story 1.5 made the manifest the single registration point; `CRM.tsx` writes `<Route>`
  in exactly one generic place (lines 45-49).
- `supabase/config.toml:143-160` — `[auth.external.google]`, `enabled = true` on line 154
  despite its own comment claiming `false`. Its inline commentary (144-153) on why
  `enabled` is never `env(...)`-indirected is worth reading before touching any other
  boolean config key.
- `supabase/functions/update_password/index.ts` — its only caller chain is
  `dataProvider.updatePassword()` → `ChangePasswordButton` → `SettingsPage` /
  `SettingsPageMobile`. Confirmed by
  `grep -rn "updatePassword\|update_password" src/ supabase/ e2e/` (9 hits, all on that
  chain plus the two `[functions.update_password]` config blocks).
- `e2e/` holds exactly two files — `fixtures.ts` (132) and `pipeline.spec.ts` (41).
- Mail catcher: Mailpit v1.30.2 (not Inbucket) — 54324 dev, 54344 e2e.
- `@supabase/supabase-js` resolves to **2.110.8**; `verifyOtp`'s `type: "email"` is valid
  in that version (see Task 1).

### Already-satisfied / impossible ACs — nothing was silently dropped

- **Nothing in this story was made impossible by Epic 1.** Every file the pre-Epic-1 draft
  named still exists (verified by `ls`), except that the *route registration mechanism*
  moved from JSX in `CRM.tsx` to `routeManifest.ts` — retargeted in Task 4, not dropped.
- **One half-satisfied check:** AC-8's `signInWithPassword` token returns 0 hits **today,
  before any work** — it never matched anything in this fork, because password sign-in
  lives inside `ra-supabase-core`. The token is kept in the grep (as a regression guard
  against someone hand-rolling it later) but it is explicitly *not* evidence of anything,
  and AC-8 now carries a separate hand-verified assertion for the real path.
- **One AC narrowed rather than deleted:** the pre-Epic-1 Task 6 asked to strip the
  password field from `SignupPage.tsx`. Doing so would leave signup permanently broken
  (`dataProvider.signUp()` requires a password, and 2.7 — not 2.6 — replaces it). Task 6
  is narrowed to the Google/SSO block only, and AC-3 gains an explicit carve-out keeping
  `PasswordToggleButton.tsx` alive for `SignupPage`'s sake. Both are stated, not silent.
- **One AC that cannot be closed in-repo:** AC-4 (Google sign-in deleted). The hosted
  Supabase project has the Google provider enabled with real credentials, and Vercel
  carries `VITE_ENABLE_GOOGLE_OAUTH=true`. The code deletion is necessary but not
  sufficient; AC-4 therefore names both the in-repo grep and the two deploy actions, with
  a concrete server-side verification (`/auth/v1/authorize?provider=google` → 400).

### Testing standards

Component tests for the two-step `LoginPage` (request → verify → error on bad code),
matching the existing `*.test.tsx` conventions in `login/` (the deleted
`GoogleSignInButton.test.tsx` is the closest structural model — `vi.stubEnv`, a
`Wrapper` with a stub authProvider, AAA blocks). No SQL in this story: the `db` vitest
project must stay green **unchanged**.

### Project Structure Notes

Net file-count change: **11 deleted (12 if `admin/login-page.tsx` goes), 1 added.**
Deleted — `login/PasswordInput.tsx`, `login/GoogleSignInButton.tsx`,
`login/GoogleSignInButton.test.tsx`, `login/googleOAuth.ts`, `login/SSOAuthButton.tsx`,
`settings/ChangePasswordButton.tsx`, `src/components/supabase/set-password-page.tsx`,
`src/components/supabase/forgot-password-page.tsx`,
`supabase/functions/update_password/index.ts` (its whole directory — it holds exactly
that one file), `doc/src/content/docs/developers/google-oauth.mdx`,
`doc/src/content/docs/developers/sso.mdx`. Conditionally —
`src/components/admin/login-page.tsx` (Task 3's last bullet).
Added — `supabase/templates/magic_link.html`.
Explicitly **not** deleted — `login/PasswordToggleButton.tsx` (2.7),
`login/SignupPage.tsx` (2.7), `login/StartPage.tsx` (2.7),
`supabase/oauth-consent-page.tsx` (AC-6).

### References

- [Source: ARCHITECTURE-SPINE.md#AD-11] — "authentication is **passwordless** —
  **magic-link / email-OTP is the load-bearing native path** … **Password and Google
  sign-in are deleted, not wound down** (NFR-14) — there is no second authentication
  path." (line 111 of
  `_bmad-output/planning-artifacts/architecture/architecture-myshadchan-2026-07-21/ARCHITECTURE-SPINE.md`)
- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.6 (lines 407-419)] — "**Then**
  I receive a magic link / OTP that signs me in **And** password and Google sign-in are
  removed from the codebase entirely **And** no fallback authentication path remains."
- [Source: _bmad-output/planning-artifacts/epics.md (lines 1267-1269)] — the epic's own
  open issue: "Story 2.6 deletes password auth, making `e2e/fixtures.ts`'s password
  helpers dead. Story 1.6's smoke spec does not specify an auth approach… the hand-off
  should be pinned." AC-9 pins it here.
- [Source: _bmad-output/implementation-artifacts/1-6-tidy-code-baseline.md (lines 286-289)]
  — the e2e smoke spec's password sign-in this story replaces.
- [Source: _bmad-output/implementation-artifacts/2-7-invite-only-signup-with-18-plus-affirmation.md
  (Task 6, Task 8)] — the scope boundary: 2.7 deletes `SignupPage.tsx`, `StartPage.tsx`,
  `ConfirmationRequired.tsx`, `signUp()` and `isInitialized()`, and rewrites
  `InviteAcceptance.tsx` onto this story's OTP form.
- [Source: _bmad-output/specs/spec-myshadchan/SPEC.md#Constraints] — "Authentication is
  passwordless and invite-only, with an 18+ affirmation."

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (claude-opus-5)

### Debug Log References

- `make typecheck` — green (`tsconfig.app.json`, `tsconfig.workers.json`, `tsconfig.node.json`).
- `npm run lint` / `npm run prettier` — green.
- `node scripts/check-retired-names.mjs` — "Retired-name guard OK."
- `npm run test` (all 5 vitest projects) — 754 passed / 65 files. The `db`
  project (272 tests, local Supabase) is unchanged, as required (no schema
  touched).
  **Re-run after the review-round-2 fixes below: 755 passed / 65 files**
  (net +1: two new `authProvider.test.ts` cases, minus one retired
  `i18nProvider.test.ts` case for the deleted password-reset override).
- `make test-e2e-ci` — 2 passed (chromium, Mobile Chrome) against the fresh
  e2e Supabase stack (real Mailpit read on 54344).
  **Re-run after the review-round-2 fixes** (`config.e2e.toml` lost its
  `[auth.email.template.recovery]` block, so the e2e stack was rebuilt
  fresh from it): **2 passed (chromium, Mobile Chrome)**, unchanged. Stack
  torn down afterward (`make stop-supabase-e2e`); dev stack (54321-54324)
  untouched and confirmed healthy.
- Manual smoke on the local dev stack (`curl` against GoTrue directly,
  bypassing the browser): `POST /auth/v1/otp` with `create_user:false` for a
  known member → Mailpit (54324) message subject "Your MyShadchan sign-in
  code" containing the 6-digit `{{ .Token }}` → `POST /auth/v1/verify` with
  `type:"email"` returned a real `access_token`. Also reproduced the
  unknown-email case directly against GoTrue (see Completion Notes).
- AC-8 widened grep (`src/ e2e/ supabase/ doc/src/ .env.development
  .env.e2e`): 0 hits.

### Completion Notes List

- Implemented the two-step email-OTP login (`LoginPage.tsx`) and extended
  `providers/supabase/authProvider.ts`'s `login()` with `requestOtp` /
  `verifyOtp` branches, replacing the `oauthProvider` / `ssoDomain` branches
  and the `baseAuthProvider.login(params)` fallback (now an explicit throw).
  `getAuthorizationDetails` / `approveAuthorization` / `denyAuthorization`
  (AC-6, the unrelated OAuth-*server* surface) are untouched.
- **Story-text correction, found by live verification, not by reading
  docs:** AC-1's own narrative and my first draft assumed GoTrue rejects a
  `shouldCreateUser:false` request against an unknown email with the
  `signup_disabled` error code (the name `@supabase/auth-js`'s own
  `error-codes.ts` union type would suggest). Curling the local dev stack's
  `POST /auth/v1/otp` directly for a non-existent email returned
  `error_code: "otp_disabled"` (message "Signups not allowed for otp"), a
  *different* code from the same union type. `authProvider.ts` swallows
  `"otp_disabled"`, not `"signup_disabled"` — verified reliably against two
  different unknown addresses. This was covered by a new
  `authProvider.test.ts` unit test and would otherwise have shipped as a
  silent account-existence oracle (the exact leak AC-1 forbids) despite
  every grep and typecheck passing.
- **Deliberate, stated gap (Task 6 vs. AC-8 tension):** `SignupPage.tsx`'s
  post-signup `login({ email, password, redirectTo: "/" })` call (kept
  exactly as-is per Task 6's explicit instruction, since 2.7 — not this
  story — replaces the whole file/`signUp()`/`isInitialized()`) now rejects
  with `authProvider.login()`'s new unconditional throw for any non-OTP
  shape, per AC-8's equally explicit "throws on anything else" requirement.
  In practice: `auth.signUp()` already persists a session client-side when
  email confirmations are disabled (`enable_confirmations = false`), so the
  account and session are not lost — but the redundant post-signup `login()`
  call now shows a spurious "Failed to log in." toast and navigates back to
  `/login` instead of `/`. This is a real, narrow regression in the
  soon-to-be-deleted signup flow, not a broken account-creation path. Both
  ACs cannot be simultaneously satisfied to the letter without touching
  `SignupPage.tsx`, which Task 6 explicitly forbids beyond the Google/SSO
  block; flagging here per the story's own "state this boundary explicitly"
  instruction rather than silently choosing one AC over the other. 2.7
  deletes this code path entirely.
- `src/components/admin/login-page.tsx`: removing the password field left a
  non-functional single-field form (this component never actually renders —
  `CRM.tsx` always passes `loginPage={StartPage}` — but it is still
  `<Admin>`'s own default). Took the story's documented "if nothing
  meaningful remains" branch: deleted the file and its `index.ts` export,
  and pointed `admin.tsx`'s `loginPage` default at the CRM's own
  (now-passwordless) `LoginPage`.
- Also removed three i18n keys the story's Task 7 table didn't name because
  they were never wired to `LoginPage`/`SignupPage`: `crm.profile.password.
  change`, `crm.profile.password_reset_sent`, `crm.profile.record_not_found`
  — all three were `ChangePasswordButton.tsx`'s own strings and became
  orphaned the moment it was deleted (verified: no other reader in either
  catalogue's namespace).
- e2e: `e2e/fixtures.ts` gained a `signIn(page, email)` fixture that polls
  Mailpit on **54344** (`expect.poll`, no `waitForTimeout`) and a typed
  `MailpitSearchResponse` / `MailpitMessage` shape for the two endpoints
  used. `createMember` no longer takes `password`; `email_confirm: true` is
  kept.
- Google sign-in and the Google Workspace SSO path are deleted in-repo only.
  **Deploy checklist (not in this diff):**
  (a) `npx vercel env rm VITE_ENABLE_GOOGLE_OAUTH production preview
  development` on the hosted Vercel project;
  (b) toggle the Google provider **off** in the hosted Supabase dashboard
  (project `krlqkxlczxlgienjunmd`, Auth → Providers → Google);
  (c) verify `https://krlqkxlczxlgienjunmd.supabase.co/auth/v1/authorize?provider=google`
  returns GoTrue's `400 {"msg":"Unsupported provider: provider is not
  enabled"}` afterward;
  (d) `npx supabase functions delete update_password --project-ref
  krlqkxlczxlgienjunmd` — removing `supabase/functions/update_password/`
  from the repo does not undeploy it, and `supabase functions deploy` only
  pushes what is present, so the already-deployed function otherwise stays
  live and reachable (gated only by its own in-code `AuthMiddleware`,
  itself calling `resetPasswordForEmail`) until explicitly deleted.
  `[auth] enable_signup` / `[auth.email] enable_signup` stay `true` in
  `config.toml` — closing self-signup server-side is Story 2.7's
  `before-user-created` Auth Hook, not this story's, per AC-1's own scope
  note.
- No `supabase/schemas/*` changes; the `db` vitest project and
  `supabase/tests/` are untouched, as required.

### Review Findings — Round 2 (addressed 2026-07-28)

A NEEDS-FIX review found a real account-existence oracle plus three smaller
dormant/live-surface issues. Fixed:

- **Should-fix 1 — resend-triggered oracle.** `authProvider.ts`'s
  `requestOtp` branch only swallowed GoTrue's `otp_disabled`; a *second*
  request for a known email (the Resend button, or a retry) surfaces
  `over_email_send_rate_limit` (429) instead, which an unknown email never
  does — two clicks classified any address as registered or not. Now both
  codes are swallowed via a shared `SILENT_OTP_ERROR_CODES` set (any other
  error still throws). New test: "swallows GoTrue's
  over_email_send_rate_limit rejection…"; the old test asserting the 429
  was rethrown was rewritten to assert the opposite, and a new
  `unexpected_failure` case takes over as the "genuine failure still
  throws" regression guard. No `LoginPage.tsx` change needed — the swallow
  lives entirely below the interface it calls.
- **Should-fix 2 — dormant `setPassword`/`resetPassword`.** `getAuthProvider()`
  spread `...baseAuthProvider` wholesale, so `ra-supabase-core`'s
  `setPassword`/`resetPassword` (→ `auth.updateUser`/`resetPasswordForEmail`)
  still resolved on the app's auth seam even though only `login` was
  narrowed. Now destructured out explicitly
  (`const { setPassword: _setPassword, resetPassword: _resetPassword, ...baseAuthProvider }`).
  New test asserts both are `undefined` on the returned provider. Confirmed
  no in-repo caller (`useSetPassword`/`useResetPassword` from
  `ra-supabase-core`): 0 hits in `src/`.
- **Should-fix 3 — recovery template/i18n residue.** Removed
  `[auth.email.template.recovery]` from both `supabase/config.toml` and
  `supabase/config.e2e.toml`, deleted `supabase/templates/recovery.html`,
  and removed the dead `ra-supabase.auth.password_reset` override (and its
  now-invalid test) from `providers/commons/i18nProvider.ts` — all three
  existed only to serve `set-password-page.tsx`, which this story already
  deleted.
  **Residual gap, stated honestly rather than overclaimed:** this closes
  the *branding/copy* remnants, not the GoTrue endpoint itself.
  `supabase/config.toml` exposes no toggle that disables `/auth/v1/recover`
  independently of `[auth.email]` as a whole (which OTP also depends on) —
  removing the custom template only makes GoTrue fall back to its own
  built-in recovery template; the endpoint keeps accepting requests and
  a clicked recovery link still establishes a session. Fully closing it
  needs either a Supabase Auth Hook (e.g. a "Send Email" hook filtering
  `email_action_type = "recovery"`) or a deploy-time action analogous to
  AC-4(b)'s Google toggle. That is new surface, not a review-findings fix;
  flagging it as a follow-up rather than silently declaring the second
  auth path closed.
- **Should-fix 4 — first-run signup regression.** `SignupPage.tsx`'s
  `onSuccess` called `login({ email, password, redirectTo: "/" })` after
  `dataProvider.signUp()`, which now rejects with `authProvider.login()`'s
  unconditional throw on non-OTP shapes (this story's own AC-8 change) —
  the very first administrator on a fresh deployment saw "Failed to log
  in." and was bounced to `/login`. Removed the redundant `login()` call;
  `auth.signUp()` already persists a session client-side
  (`enable_confirmations = false`), so `onSuccess` now just notifies and
  navigates to `/`. This also orphaned the `email_not_confirmed` catch
  branch (dead once `login()` is gone) and the `crm.auth.sign_in_failed`
  i18n key it used exclusively — both removed from both locale catalogues
  in the same change (no other reader in either namespace).

Left open, by design (all "note" severity, not "should-fix", and outside
this story's file list):
- Finding 5 (unauthenticated `dataProvider.getConfiguration()` round-trip
  on every "Send code" click, via `useAuthProvider()`'s wrapper) and
  finding 6 (layering inversion — `admin/admin.tsx` importing
  `atomic-crm/login/LoginPage`) are both structural/wasteful, not
  incorrect, and the review itself notes finding 6 "the story sanctioned
  it." Not touched, to avoid expanding scope beyond should-fixes.
- Finding 7's password residue (`fakerest/authProvider.ts`'s unused
  `login`/`setPassword`/`resetPassword` stubs and `password: "demo"` seed,
  `supabase/functions/users/index.ts`'s `password` field on member
  creation, `MemberCreate.tsx`'s stale "set their password" copy, and the
  disabled-but-present `[auth.external.apple]` block) all belong to the
  member-creation / invite flow this story does not touch (2.7/2.8
  territory) or are pre-existing fork config unrelated to sign-**in**.
  Flagged for a future pass, not fixed here.
- Finding 8 (the deploy checklist missing `update_password`'s function
  deletion) — fixed by adding item (d) to the AC-4(b)/checklist bullet
  above (`npx supabase functions delete update_password`).

Verification after the fix: `npm run typecheck`, `npm run lint`,
`npm run prettier`, `npm run test` (all 5 vitest projects, `db` included
via the live local dev stack), `node scripts/check-retired-names.mjs`,
AC-8's widened grep (still 0 hits), and `make test-e2e-ci` were all re-run
green — see "Debug Log References" above for exact counts.

### File List

**Added**
- `supabase/templates/magic_link.html`
- `src/components/atomic-crm/login/LoginPage.test.tsx`
- `src/components/atomic-crm/providers/supabase/authProvider.test.ts`

**Modified**
- `src/components/atomic-crm/login/LoginPage.tsx` (full rewrite: two-step email-OTP)
- `src/components/atomic-crm/login/SignupPage.tsx` (Google/SSO block removed only)
- `src/components/atomic-crm/login/StartPage.tsx` (dropped `disableEmailPasswordAuthentication` read/branch)
- `src/components/atomic-crm/login/PasswordToggleButton.tsx` (doc-comment only)
- `src/components/atomic-crm/login/authFieldClassName.ts` (doc-comment only)
- `src/components/atomic-crm/login/AuthLayout.tsx` (doc-comment only)
- `src/components/atomic-crm/login/BrandLockup.tsx` (doc-comment only)
- `src/components/atomic-crm/providers/supabase/authProvider.ts` (OTP request/verify branches, removed oauth/sso branches and the password fallback, removed set-password/forgot-password `checkAuth` cases)
- `src/components/atomic-crm/providers/supabase/dataProvider.ts` (removed `updatePassword`)
- `src/components/atomic-crm/providers/fakerest/dataProvider.ts` (removed `updatePassword`)
- `src/components/atomic-crm/settings/SettingsPage.tsx` (removed `ChangePasswordButton`)
- `src/components/atomic-crm/settings/SettingsPageMobile.tsx` (removed `ChangePasswordButton`)
- `src/components/atomic-crm/root/routeManifest.ts` (removed `SetPasswordPage` / `ForgotPasswordPage` entries and imports)
- `src/components/atomic-crm/root/ConfigurationContext.tsx` (removed `googleWorkplaceDomain` / `disableEmailPasswordAuthentication`)
- `src/components/atomic-crm/root/CRM.tsx` (removed the same two config reads/seeds)
- `src/components/atomic-crm/providers/commons/englishCrmMessages.ts` (removed dead auth/profile keys, added OTP strings)
- `src/components/atomic-crm/providers/commons/frenchCrmMessages.ts` (mirrored)
- `src/components/admin/admin.tsx` (`loginPage` default repointed to the CRM `LoginPage`)
- `src/components/admin/index.ts` (removed `./login-page` re-export)
- `supabase/config.toml` (removed `[auth.external.google]` and `[functions.update_password]`, added `[auth.email.template.magic_link]`)
- `supabase/config.e2e.toml` (removed `[functions.update_password]`, added `[auth.email.template.magic_link]`)
- `.env.development` (removed `VITE_ENABLE_GOOGLE_OAUTH`)
- `e2e/fixtures.ts` (dropped `password` from `createMember`, added the `signIn` OTP fixture)
- `e2e/pipeline.spec.ts` (uses the `signIn` fixture; dropped the stale password-login comment)
- `registry.json` (regenerated via `make registry-gen`)

**Deleted**
- `src/components/atomic-crm/login/PasswordInput.tsx`
- `src/components/atomic-crm/login/GoogleSignInButton.tsx`
- `src/components/atomic-crm/login/GoogleSignInButton.test.tsx`
- `src/components/atomic-crm/login/googleOAuth.ts`
- `src/components/atomic-crm/login/SSOAuthButton.tsx`
- `src/components/atomic-crm/settings/ChangePasswordButton.tsx`
- `src/components/supabase/set-password-page.tsx`
- `src/components/supabase/forgot-password-page.tsx`
- `supabase/functions/update_password/` (whole directory)
- `src/components/admin/login-page.tsx`
- `doc/src/content/docs/developers/google-oauth.mdx`
- `doc/src/content/docs/developers/sso.mdx`
