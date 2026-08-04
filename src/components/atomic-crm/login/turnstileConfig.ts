/**
 * Cloudflare Turnstile site key for the sign-in / register forms.
 *
 * This is the PUBLIC half of the widget — Turnstile site keys are designed
 * to be embedded in client-side code (unlike the secret key, which lives
 * only in Supabase's auth config and GitHub's `TURNSTILE_SECRET_KEY`
 * repo secret, never here). Safety comes from the widget being
 * domain-locked on the Cloudflare side, not from keeping this value private.
 *
 * Provisioned once, by hand, in the Cloudflare dashboard (widget name
 * `myshadchan-signup`, mode `managed`), allowed on exactly:
 * `www.myshadchan.space`, `myshadchan.space`, and `localhost` (so local
 * dev keeps working). There is no per-environment variant — the same key
 * is used everywhere the domain list already covers.
 *
 * `security_captcha_enabled` on the Supabase project is a separate,
 * SEPARATE toggle — it starts `false` (see authProvider.ts's `login()` for
 * why) and must only flip to `true` in the same change that ships this
 * token end-to-end, or every unmodified deployment locks itself out the
 * moment the flag goes live.
 */
export const TURNSTILE_SITE_KEY = "0x4AAAAAAEGcSU4O7xVZgKor";
