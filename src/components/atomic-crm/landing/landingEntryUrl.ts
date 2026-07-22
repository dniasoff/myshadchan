/** The parts of `window.location` the landing gate needs, so it can be tested. */
export interface LandingUrl {
  pathname: string;
  search: string;
  hash: string;
}

/**
 * Query parameters and hash fragments Supabase hands back on the way home from
 * an OAuth, magic-link or recovery flow. They land on `/`, and they belong to
 * the app's callback handling — never to the landing page.
 */
const CALLBACK_PARAMS = ["code", "token_hash", "error", "error_description"];
const CALLBACK_HASH_FRAGMENTS = ["access_token", "error_description"];

/**
 * The app routes on the hash, so `#/shidduchim` is somebody deep-linking into
 * the app rather than arriving at the front door. `#/` alone is the app root,
 * which is the front door.
 */
const APP_ROUTE_HASH = /^#\/.+/;

/**
 * True when the URL is the plain public entry point: exactly `/`, with no app
 * route in the hash and no auth callback payload.
 */
export const isPublicEntryUrl = (url: LandingUrl): boolean => {
  if (url.pathname !== "/") {
    return false;
  }
  if (APP_ROUTE_HASH.test(url.hash)) {
    return false;
  }
  const params = new URLSearchParams(url.search);
  if (CALLBACK_PARAMS.some((param) => params.has(param))) {
    return false;
  }
  return !CALLBACK_HASH_FRAGMENTS.some((fragment) =>
    url.hash.includes(fragment),
  );
};
