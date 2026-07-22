/**
 * The landing page renders before the app's router exists, so every link out of
 * it is a real navigation into the authenticated app rather than a client-side
 * route change.
 */
export const SIGN_IN_PATH = "/login";

/**
 * In-page target for the hero's second action. It stays a fragment rather than
 * a route: the app routes on `#/`, so a bare `#what` never reads as a deep link
 * into the app.
 */
export const WHAT_ANCHOR = "#what";

/** Heading id a section's `<h2>` must carry, so the section is labelled by it. */
export const landingHeadingId = (id: string): string => `${id}-title`;
