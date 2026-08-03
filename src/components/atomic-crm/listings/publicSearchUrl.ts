/** The parts of `window.location` the public search page needs, so it can
 * be tested without a real browser navigation. */
export interface PublicSearchUrl {
  pathname: string;
  search: string;
}

/**
 * The public search page (Story 9.4) lives at exactly `/find`. `App.tsx`
 * renders it BEFORE `<LandingGate>`/`<CRM>` ever mount (Task 1), the same
 * position the retired pre-Epic-1 token-based public page occupied (deleted
 * by Epic 1 Story 1.4) — so no authenticated route ever mounts for this
 * request.
 *
 * That retired page carried its capability token in the URL FRAGMENT: a
 * fragment is never sent to the server, which matters for a bearer secret.
 * A search query protects nothing — it is meant to be shareable and
 * bookmarkable (`/find?q=...`), and only an ordinary query parameter, not a
 * fragment, reliably reconstructs client-side state when a shared link's
 * destination loads fresh. Do not "fix" this to a fragment to match that
 * precedent; the two have opposite requirements.
 */
export const PUBLIC_SEARCH_PATH = "/find";

/**
 * True when the URL is the public search entry point — `/find` EXACTLY,
 * no trailing slash (Story 9.4 review finding F9). `vite.config.ts` builds
 * with `base: "./"`, so this page's asset URLs resolve relative to the
 * current path; at a trailing-slash `/find/` they would resolve to
 * `/find/assets/...`, which does not exist as a static file and falls
 * through `vercel.json`'s catch-all `/(.*) → /index.html` rewrite — the
 * browser gets HTML back where it expected a JS module and refuses to
 * load it, a blank page. `/find` (no slash) has no such problem: its
 * relative asset URLs resolve at the site root, same as every other route.
 */
export const isPublicSearchUrl = (url: PublicSearchUrl): boolean =>
  url.pathname === PUBLIC_SEARCH_PATH;
