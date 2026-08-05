/**
 * Repairs a GoTrue OAuth redirect corrupted by this app's own HashRouter.
 *
 * `authProvider.ts`'s `login()` points `signInWithOAuth()`'s `redirectTo` at
 * `${origin}/#/auth-callback` — a URL that already ends in a `#` fragment, so
 * the HashRouter has somewhere to land a rejected/cancelled attempt (see that
 * file's own doc comment). On a SUCCESSFUL sign-in, GoTrue appends the
 * session as its own `#access_token=...&refresh_token=...&...` fragment
 * directly onto that string — producing a URL with a literal SECOND `#`
 * (confirmed against the real `Location` response header:
 * `.../#/auth-callback#access_token=...`).
 *
 * A URL only has ONE fragment delimiter — everything from the first `#`
 * onward, including that second literal `#`, is one opaque string. Consumed
 * as a query string (which is exactly what `@supabase/auth-js`'s own
 * `parseParametersFromURL` does — see `node_modules/@supabase/auth-js/dist/main/lib/helpers.js`),
 * the FIRST key becomes the corrupted `/auth-callback#access_token` instead
 * of `access_token`, and the session can never be recovered — the app's auth
 * guard finds no session and bounces to `/login`. This never surfaced before
 * because the Google provider was disabled in Supabase until it was
 * reconfigured, so nobody had exercised a full successful round-trip.
 *
 * This function only detects and repairs THAT one shape (a real second `#`
 * appearing after the first) — it leaves every other URL, including GoTrue's
 * OWN error-redirect shape (`#/auth-callback&error=...`, a single `#` with
 * `&`-glued params, handled entirely separately by `oauthCallback.ts`'s
 * `readOAuthCallbackError` — that shape parses correctly today and needs no
 * fix), untouched (returns `null`).
 *
 * Must run before ANY app code touches `window.location` — most importantly
 * before the Supabase client is ever constructed, since its own
 * `_initialize()` reads `window.location.href` to recover the session and
 * would otherwise see the corrupted string first. `getSupabaseClient()`'s
 * singleton is lazy, but by the time any bundled module's top-level code
 * runs, its whole import graph has already been evaluated — too late to
 * guarantee this runs first. The one point that is unconditionally
 * guaranteed to run before any bundled module (including all of its
 * imports) is a plain, non-`module` inline `<script>` earlier in
 * `index.html`'s source than the `type="module"` entry point — module
 * scripts always defer to after the document is parsed, classic scripts run
 * immediately. That is why this same logic is duplicated, by necessity, as
 * plain JS directly inside `index.html`'s `<head>`: Vite does not transpile
 * a classic inline script, so it cannot import this file. This module exists
 * so that logic has an isolated, unit-tested, single source of truth to
 * mirror by hand — keep the two in sync.
 */
export function fixDoubleHashOAuthCallback(href: string): string | null {
  const firstHash = href.indexOf("#");
  if (firstHash === -1) {
    return null;
  }
  const afterFirstHash = href.slice(firstHash + 1);
  const secondHash = afterFirstHash.indexOf("#");
  if (secondHash === -1) {
    return null;
  }
  const tokenFragment = afterFirstHash.slice(secondHash + 1);
  return `${href.slice(0, firstHash)}#${tokenFragment}`;
}
