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
 * The token rides ONLY in the URL FRAGMENT (`/portal#<token>`): a fragment is
 * never sent to the server, so the bearer secret stays out of access logs and
 * Referer headers — the correct, and only accepted, place for a capability
 * token. A `?t=` query param is deliberately NOT accepted: query strings ARE
 * logged, so honouring one would risk leaking the token into Vercel access logs.
 * A link whose fragment was stripped fails safe (no access) rather than leaking.
 */
export const readPortalToken = (url: PortalUrl): string | null => {
  const fromHash = url.hash.replace(/^#/, "").trim();
  return fromHash ? fromHash : null;
};

/** Build the shareable portal URL for a token (fragment form). */
export const buildPortalUrl = (origin: string, token: string): string =>
  `${origin}${PORTAL_PATH}#${token}`;
