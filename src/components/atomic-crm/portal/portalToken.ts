/** The parts of `window.location` the portal entry needs, so it can be tested. */
export interface PortalUrl {
  pathname: string;
  search: string;
  hash: string;
}

/**
 * The public portal lives at exactly `/portal`. Vercel rewrites every path to
 * `index.html` (vercel.json), so this pathname reaches the SPA; App.tsx renders
 * the portal for it BEFORE the CRM, so no authenticated route ever mounts here.
 */
export const PORTAL_PATH = "/portal";

/** True when the URL is the public portal entry point. */
export const isPortalUrl = (url: PortalUrl): boolean =>
  url.pathname === PORTAL_PATH || url.pathname === `${PORTAL_PATH}/`;

/**
 * The token rides in the URL FRAGMENT by default (`/portal#<token>`): a fragment
 * is never sent to the server, so the bearer secret stays out of access logs and
 * Referer headers — the correct place for a capability token. A `?t=` query param
 * is accepted as a fallback for tools that strip fragments.
 */
export const readPortalToken = (url: PortalUrl): string | null => {
  const fromHash = url.hash.replace(/^#/, "").trim();
  if (fromHash) {
    return fromHash;
  }
  const fromQuery = new URLSearchParams(url.search).get("t")?.trim();
  return fromQuery ? fromQuery : null;
};

/** Build the shareable portal URL for a token (fragment form). */
export const buildPortalUrl = (origin: string, token: string): string =>
  `${origin}${PORTAL_PATH}#${token}`;
