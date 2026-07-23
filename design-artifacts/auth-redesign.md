# Auth Screens Redesign — "Quiet Luminance"

Concrete redesign for the MyShadchan authentication screens (login, first-run
signup, forgot-password, set-password, confirmation). Replaces the flat blue
split-screen with a single centered glass auth card floating on an atmospheric,
softly-glowing ground. **Visual/layout only — every piece of auth logic and OAuth
wiring stays exactly as-is.** Authoritative design references:
`DESIGN-DIRECTION.md` + `design-language.md` (both win on any conflict).

---

## 1. Why the current screen fails

From the two QA screenshots (`qa-login-dark.png`, `qa-login-light.png`):

- **Flat, cold, off-brand split-screen.** The left panel is a generic blue
  gradient (`linear-gradient(160deg, --primary → --st-look → --landing-band)`)
  that reads like a templated SaaS login — none of the indigo-night depth, glass,
  or glow the rest of the app has.
- **The 7 pipeline-state chips are shown to a logged-out visitor** — meaningless
  noise to someone who hasn't signed in; they leak the product's internal
  vocabulary and clutter the hero.
- **A large empty void on the form side** — the form floats in dead space with no
  card, no depth, no focal composition.
- **Missing affordances**: no password show/hide toggle; inputs are the default
  36px (`h-9`) height; no explicit `autocomplete`; no loading state on the Sign-in
  button; no footer / route back to the landing page.

---

## 2. Target composition

One **centered glass auth card** on a full-bleed **atmospheric ground** — no split
screen. The same shell serves login, signup, forgot-password, set-password, and
the confirmation screen, so the whole auth cluster reads as one product moment.

```
┌───────────────────────────────────────────────┐
│  atmospheric ground (fixed):                    │
│   · --wash radial bloom (existing)              │
│   · 3 slow, low-opacity glow blobs              │
│     (indigo · violet · honey hint)              │
│   · subtle vignette                             │
│                                                 │
│            ┌───────────────────────┐            │
│            │  ▮ MyShadchan          │  ← lockup  │
│            │                        │            │
│            │  Welcome back          │  ← heading │
│            │  Sign in to your…      │  ← sub     │
│            │  רישום השידוכים  (rtl) │  ← accent  │
│            │                        │            │
│            │  [ G  Continue w/ … ]  │  ← OAuth   │
│            │  ───────  or  ───────  │  ← divider │
│            │  Email                 │            │
│            │  [____________]        │            │
│            │  Password        (eye) │  ← toggle  │
│            │  [____________]        │            │
│            │  [   Sign in   ]       │  ← CTA     │
│            │  Forgot password?      │            │
│            └───────────────────────┘            │
│         Private to your family · ← landing       │
└───────────────────────────────────────────────┘
```

- **Glass card is legitimate here.** `design-language.md` §1.2 / §6.4 permits glass
  on *chrome and overlays* (modals, sheets, popovers) — the auth card is exactly
  that kind of non-scrolling overlay surface, not a dense reading surface. The
  inputs *inside* it stay solid/opaque for readability (§6.4). This mirrors how a
  modal is glass while its form controls are solid.
- **Blobs vs. the "one wash" rule.** §6.1 asks for one ambient wash per *content*
  screen; the auth ground is a full-bleed atmospheric moment (like `LandingBackdrop`,
  which already ships two low-opacity blobs). We keep the existing `--wash` and add
  2–3 **very low-opacity, slow** blobs — calm and alive, not a rainbow mesh. This is
  a deliberate, scoped departure documented here.

---

## 3. Files — create / modify / retire

### Create

| File | Purpose |
| --- | --- |
| `src/components/atomic-crm/login/AuthLayout.tsx` | The shared shell: atmospheric ground (`AuthBackdrop`) + centered **glass `AuthCard`** wrapper with brand lockup at top and a quiet footer slot. Renders `children` (the specific form). Exports `AuthLayout`. |
| `src/components/atomic-crm/login/BrandLockup.tsx` | New stable home for **`LedgerMark`** (moved out of the retiring `AuthHero`) plus a `BrandLockup` (mark + "My**Shadchan**" wordmark) used at the top of every auth card. Re-exports `LedgerMark`. |
| `src/components/atomic-crm/login/PasswordInput.tsx` | ra-core admin-kit-style password field (mirrors `admin/text-input.tsx`: `useInput` + `FormField/FormControl/FormLabel/FormError`) with a trailing **show/hide toggle**. Used by `LoginPage` + `SetPasswordPage`. |
| `src/components/atomic-crm/login/PasswordToggleButton.tsx` | Presentational eye / eye-off icon button (Lucide `Eye`/`EyeOff`), 44px hit area, `aria-label`, positioned inline-end. Shared by `PasswordInput` (ra-core) and `SignupPage` (RHF) so there is one toggle implementation. |
| `src/components/atomic-crm/login/authFieldClassName.ts` | `AUTH_FIELD_CLASSNAME` constant (input styling: `h-11`, `rounded-lg`, focus ring/glow) — same pattern as `primaryCtaClassName.ts`; reused by every auth input for consistent 44px fields. |

### Modify

| File | Change |
| --- | --- |
| `src/components/atomic-crm/login/LoginPage.tsx` | Replace the `lg:grid` split + `<AuthHero/>` with `<AuthLayout>`. Heading "Welcome back". OAuth block + "or" divider + Email (`TextInput`, `autoComplete="email"`) + `PasswordInput` (`autoComplete="current-password"`) + gradient CTA with **loading spinner** + "Forgot password?" link. Footer: "Private to your family" + landing link. **Keep `handleSubmit`, `useLogin`, the recovery-notification `useEffect`, `disableEmailPasswordAuthentication` / `googleWorkplaceDomain` branches unchanged.** |
| `src/components/atomic-crm/login/SignupPage.tsx` | Same shell via `<AuthLayout>`. Heading "Create your family's record" + calm subtitle. Keep the RHF `useForm`/`register`, `useMutation` signup + `isInitialized` `<Navigate>` guard, first/last-name/email/password fields — restyle via `AUTH_FIELD_CLASSNAME`, add `autoComplete` (`given-name`/`family-name`/`email`/`new-password`) and the password toggle (`PasswordToggleButton` + local `useState`). Keep the "Create account"/"Creating…" loading state. |
| `src/components/atomic-crm/login/ConfirmationRequired.tsx` | Repoint `LedgerMark` import to `./BrandLockup`; optionally wrap its centered card in `<AuthLayout>` for one consistent ground (keep its Mail-icon content). |
| `src/components/atomic-crm/login/AgeAffirmation.tsx`, `FirstRunSetup.tsx`, `InviteAcceptance.tsx` | Repoint `LedgerMark` import from `./AuthHero` → `./BrandLockup`. No visual change required (out of scope), but they may adopt `AuthLayout` later. |
| `src/components/atomic-crm/landing/LandingBrand.tsx` | Repoint `LedgerMark` import from `../login/AuthHero` → `../login/BrandLockup`. |
| `src/components/supabase/forgot-password-page.tsx` | Swap the off-brand `supabase/layout.tsx` `Layout` (zinc-900 split) for `<AuthLayout>`. Keep `useResetPassword`, `submit`, the `TextInput` + `autoComplete="email"`, redirect on success. CTA uses `PRIMARY_CTA_CLASSNAME`. |
| `src/components/supabase/set-password-page.tsx` | Same `Layout` → `<AuthLayout>` swap. Keep token logic + `validate` mismatch check; use `PasswordInput` for both password fields (`autoComplete="new-password"`). |
| `src/index.css` | Add one `@keyframes ql-drift` for the blobs + a `.auth-blob` helper, guarded by the existing `prefers-reduced-motion` block. Nothing else — all colours reuse existing tokens. |

### Retire

| File | Action |
| --- | --- |
| `src/components/atomic-crm/login/AuthHero.tsx` | **Delete the `AuthHero` split-panel component** (the blue hero + the 7 chips). First move `LedgerMark` to `BrandLockup.tsx` and repoint all 6 importers (listed above). `AuthHero`'s local `LockIcon` and the `PIPELINE_STATES` import go with it. |

`StartPage.tsx` (login-vs-signup router) and `googleOAuth.ts` / `GoogleSignInButton.tsx` / `SSOAuthButton.tsx` are **unchanged** — `StartPage` still resolves `isInitialized` → `<Navigate to="/sign-up">` or `<LoginPage/>`, and `CRM.tsx` routing is untouched.

---

## 4. `AuthLayout` structure

```tsx
// AuthLayout.tsx  (structure, not final copy)
export const AuthLayout = ({ children, footer }: AuthLayoutProps) => (
  <div
    className="relative flex min-h-screen flex-col items-center justify-center
      overflow-hidden bg-background p-6"
    style={{ backgroundImage: "var(--wash)" }}
  >
    <AuthBackdrop />                               {/* blobs + vignette */}
    <div className="ql-enter relative z-10 w-full max-w-md">
      <div
        className="rounded-[20px] border p-7 sm:p-8
          bg-[--glass-bg] backdrop-blur-[var(--glass-blur)]
          border-[--glass-border] shadow-lg"
      >
        <BrandLockup className="mb-6" />          {/* mark + wordmark */}
        {children}
      </div>
      {footer ? (
        <div className="mt-5 text-center text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
    <Notification />
  </div>
);
```

- Card: `rounded-[20px]` (§1.5 allows the ~20px overlay radius), `--glass-bg` +
  `backdrop-blur(var(--glass-blur))` + hairline `--glass-border` + `shadow-lg`
  (§3 chrome = glass + `shadow-lg`).
- `max-w-md` (~28rem) keeps one focused column; `ql-enter` gives the card the
  existing rise-in entrance (already reduced-motion-guarded in `index.css`).
- `<Notification/>` moves into the layout so every screen keeps ra-core toasts.
- `footer` is a slot so login can pass "Private to your family · Back to home"
  and signup/forgot can pass their own quiet note.

### `AuthBackdrop` — ambient-glow ground (existing tokens only)

```tsx
const AuthBackdrop = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
    {/* indigo — top-start */}
    <div className="auth-blob absolute -top-40 -start-32 h-[38rem] w-[38rem]
      rounded-full opacity-[0.16] blur-3xl"
      style={{ background: "var(--accent-grad-from)" }} />
    {/* violet — bottom-end */}
    <div className="auth-blob absolute -bottom-48 -end-32 h-[34rem] w-[34rem]
      rounded-full opacity-[0.14] blur-3xl"
      style={{ background: "var(--accent-grad-to)", animationDelay: "-6s" }} />
    {/* honey hint — low, behind the card */}
    <div className="auth-blob absolute bottom-[-8rem] start-1/3 h-[22rem] w-[22rem]
      rounded-full opacity-[0.08] blur-3xl"
      style={{ background: "var(--landing-accent-hi)", animationDelay: "-12s" }} />
    {/* vignette — darkens the edges, focuses the card */}
    <div className="absolute inset-0"
      style={{ background:
        "radial-gradient(120% 120% at 50% 42%, transparent 55%, oklch(0 0 0 / 0.16) 100%)" }} />
  </div>
);
```

- **Tokens only**: indigo `--accent-grad-from`, violet `--accent-grad-to`, honey
  `--landing-accent-hi` — all resolve per theme, so dark is the luminous showpiece
  and light is a soft warm-tinted bloom automatically. Opacities are deliberately
  low (`0.08–0.16`) — "calm and alive, not a rainbow mesh."
- The vignette uses `oklch(0 0 0 / 0.16)`, the same pure-black-with-alpha idiom the
  `--shadow-*` tokens already use (not a hardcoded hex) — subtle in both themes.
- **Motion** (§4): `.auth-blob` runs a slow `ql-drift` (transform/opacity only);
  the reduced-motion guard freezes it.

`index.css` additions (append near the existing `ql-*` keyframes):

```css
@keyframes ql-drift {
  0%,100% { transform: translate3d(0,0,0) scale(1); }
  50%     { transform: translate3d(2%, -2%, 0) scale(1.06); }
}
.auth-blob { animation: ql-drift 22s var(--ease-spring) infinite; }
@media (prefers-reduced-motion: reduce) {
  .auth-blob { animation: none; }     /* add to the existing reduced-motion block */
}
```

---

## 5. Card contents & states

### Brand lockup (top)
`BrandLockup` = `LedgerMark` in a `--primary`-tinted rounded tile + "My**Shadchan**"
wordmark (`font-display`, `--primary` on the second half) — the compact mark the
mobile view already used, now the single lockup for all widths.

### Heading + subtitle + Hebrew accent
- **Login**: `font-display text-2xl font-bold` "Welcome back" · sub
  "Sign in to your records." (via `crm.auth.*` translate keys, keep existing).
- **Signup (first-run)**: "Create your family's record" · sub "Set up the first
  account for your household." (`crm.auth.welcome_title` / `signup.create_first_user`
  keys — update the English defaults).
- **Hebrew accent line** (RTL-correct, not jammed): a single quiet line under the
  subtitle — `font-hebrew text-sm text-muted-foreground` `dir="rtl"` with
  `רישום השידוכים`. One line, its own row, not crammed beside English.

### Google button + divider
Keep `GoogleSignInButton` (its own loading spinner intact) as the prominent
tasteful OAuth action, plus `SSOAuthButton` when `googleWorkplaceDomain` is set.
"or" divider (`border-t` + centered `bg-card`/glass-aware label). Both auth-method
branches (`googleEnabled`, `disableEmailPasswordAuthentication`) preserved.

### Inputs
- Email: `TextInput type="email"` + `autoComplete="email"`, `AUTH_FIELD_CLASSNAME`
  → `h-11` (≥44px), visible label, inline `FormError` below the field.
- Password: `PasswordInput` + `autoComplete="current-password"` (login) /
  `"new-password"` (signup/set-password), with the **show/hide toggle** on the
  inline-end. Toggle: `Eye`/`EyeOff` Lucide, `aria-label` "Show password" /
  "Hide password", `aria-pressed`, 44px target, `type="button"` (never submits).
- `AUTH_FIELD_CLASSNAME` gives all fields `focus-visible:ring-2 ring-ring`
  (existing `--ring`) so focus is a clear indigo glow in both themes.

### Primary CTA — states
Reuse `PRIMARY_CTA_CLASSNAME` (indigo→violet gradient, `--glow-accent` halo,
`active:scale-[0.97]`, focus ring). One primary CTA per screen.
- **default**: "Sign in" / "Create account" / "Reset password".
- **loading**: `disabled` + Lucide `Loader2 animate-spin` + "Signing in…" /
  "Creating…" (signup already does this — mirror it on login using the existing
  `loading` state).
- **error**: field-level errors render inline under the field (`FormError`); auth
  failures keep surfacing through the existing `notify(...)` → `<Notification/>`
  toast. No logic change.

### Forgot-password link + footer
- "Forgot password?" link under the CTA (login only), `text-muted-foreground
  hover:text-foreground`.
- Footer slot: small "Private to your family" note (a Lucide `Lock` size-3.5 +
  text) and/or a "Back to home" link to the landing entry (`landingEntryUrl`).

---

## 6. Motion

- Card entrance: existing `.ql-enter` rise+fade (`--dur-enter`, `--ease-out`,
  reduced-motion-guarded).
- Blobs: `ql-drift` slow loop (§4 above), frozen under reduced-motion.
- Buttons: `PRIMARY_CTA_CLASSNAME` press `scale-[0.97]` + glow transition
  (`--ease-spring`, `--dur-micro`); toggle/link hovers 150–300ms colour only.
- **transform/opacity only**; nothing >500ms; `prefers-reduced-motion` honoured
  everywhere.

---

## 7. Bilingual / RTL

- Logical properties throughout: `-start-*/-end-*`, `ps-/pe-`, `ms-/me-`,
  `text-start`. No `left/right`. Password toggle sits inline-end (mirrors under RTL).
- Hebrew accent line: `font-hebrew dir="rtl"`, its own row.
- Existing `crm.auth.*` / `ra.auth.*` / `ra-supabase.*` translate keys kept;
  only English `_` defaults for the two new headings are updated.

---

## 8. Acceptance criteria

- [ ] No split screen anywhere in auth — one centered glass card on the atmospheric
      ground, in login, signup, forgot-password, set-password, confirmation.
- [ ] **The 7 pipeline-state chips no longer appear on any logged-out screen**;
      `AuthHero.tsx` is deleted and `LedgerMark` lives in `BrandLockup.tsx` with all
      6 importers repointed (build clean).
- [ ] Ground shows the `--wash` bloom + 2–3 low-opacity indigo/violet/honey blobs +
      vignette; blobs drift slowly and **freeze under `prefers-reduced-motion`**.
- [ ] Card is glass (backdrop-blur, `--glass-border` hairline, `shadow-lg`,
      ~20px radius); inputs inside are solid and legible.
- [ ] Password field has a working **show/hide toggle** (`aria-label`,
      `type="button"`, 44px), on both login and signup.
- [ ] Inputs ≥44px (`h-11`), correct `autocomplete` (`email` / `current-password` /
      `new-password` / name fields), visible focus ring, inline field errors.
- [ ] Primary CTA: indigo→violet gradient + glow + `scale-[0.97]` press +
      **loading state** on submit; exactly one primary CTA per screen.
- [ ] Google/SSO buttons, "or" divider, "Forgot password?" link, quiet footer with
      landing link all present; footer note "Private to your family".
- [ ] **Tokens only** — no hardcoded hex/px colour added to components; only
      `ql-drift`/`.auth-blob` added to `index.css`; no existing token value changed.
- [ ] All auth **logic untouched**: `StartPage` router, `useLogin`/`login()` submit,
      RHF signup mutation + `isInitialized` guard, recovery-notify `useEffect`,
      `useResetPassword`/`useSetPassword`, `googleOAuth.ts` behaviour.
- [ ] WCAG AA both themes (text ≥4.5:1, focus visible, borders visible); dark is the
      luminous showpiece, light is warm-tinted (not cold blue).
- [ ] `make typecheck` passes; existing `GoogleSignInButton.test.tsx` still green.
- [ ] Verified with Playwright screenshots (login + first-run signup, dark + light)
      under `…/scratchpad`.
```
