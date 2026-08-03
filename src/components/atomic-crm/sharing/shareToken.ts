/** The parts of `window.location` the shared-profile page needs, so it can
 * be tested without a real browser navigation. Mirrors the deleted portal's
 * `portal/portalToken.ts#PortalUrl` exactly. */
export interface ShareUrl {
  pathname: string;
  search: string;
  hash: string;
}

/**
 * The public share entry lives at exactly `/share`, no trailing slash
 * (`vite.config.ts` builds with `base: "./"`; a trailing-slash path would
 * resolve this page's asset URLs one directory too deep and fall through
 * `vercel.json`'s catch-all rewrite to `index.html` where a JS module was
 * expected — the exact trap Story 9.4's own review finding F9 already
 * closed for `/find`, so `/share` starts strict rather than repeating it).
 */
export const SHARE_PATH = "/share";

/** True when the URL is the public share entry point — `/share` EXACTLY. */
export const isShareUrl = (url: ShareUrl): boolean =>
  url.pathname === SHARE_PATH;

/**
 * The token rides ONLY in the URL FRAGMENT (`/share#<token>`), never a
 * `?t=` query param — this token IS a bearer secret (Dev Notes "Why this
 * token is fragment-only and 9.4's query isn't"): a fragment is never sent
 * to any server automatically, so it never reaches Vercel access logs or a
 * Referer header on an embedded resource. This is the exact discipline the
 * deleted portal's `portal/portalToken.ts#readPortalToken` documented —
 * word for word applicable here, unlike Story 9.4's `/find`, whose search
 * query is meant to be shared and bookmarked and so belongs in the query
 * string instead.
 */
export const readShareToken = (url: ShareUrl): string | null => {
  const fromHash = url.hash.replace(/^#/, "").trim();
  return fromHash ? fromHash : null;
};

/** Builds the shareable link for a token (fragment form) — what
 * `CreateShareLinkDialog.tsx` shows the sharer to copy/send. */
export const buildShareUrl = (origin: string, token: string): string =>
  `${origin}${SHARE_PATH}#${token}`;
