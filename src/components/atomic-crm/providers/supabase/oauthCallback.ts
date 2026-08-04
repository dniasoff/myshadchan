/** The parts of `window.location` this module reads — narrowed so the URL
 * parsing below is testable without touching the real browser location
 * (same shape convention as `landing/landingEntryUrl.ts`'s `LandingUrl`). */
export interface CallbackLocation {
  search: string;
  hash: string;
}

export interface OAuthCallbackError {
  /** Used as BOTH the i18n lookup key and the `_` fallback default, exactly
   * like `LoginPage.tsx`'s `resolveErrorNotification` — a real catalogue
   * entry wins when one exists (the three named cases below), and the
   * fallback text renders unchanged when it doesn't (the age-gate
   * passthrough case, whose text comes from the database, not a catalogue). */
  messageKey: string;
  defaultMessage: string;
}

/**
 * Reads one query-string-shaped param from either the real query string or
 * a HashRouter's fragment — GoTrue redirects with the error in whichever of
 * the two `redirectTo` already used (see `authProvider.ts`'s `login()`),
 * and may prefix the fragment with our own `/auth-callback` route path
 * (e.g. `#/auth-callback&error=access_denied&...`). `URLSearchParams`
 * tolerates that leading no-`=` segment the same way `@supabase/auth-js`'s
 * own `parseParametersFromURL` does — verified by reading that source
 * rather than assumed, since a wrong assumption here would ALSO reappear
 * as supabase-js's own successful-session parsing silently breaking.
 */
function readParam(location: CallbackLocation, key: string): string | null {
  const searchParams = new URLSearchParams(location.search);
  if (searchParams.has(key)) {
    return searchParams.get(key);
  }
  const rawHash = location.hash.startsWith("#")
    ? location.hash.slice(1)
    : location.hash;
  const hashQuery = rawHash.includes("?") ? rawHash.split("?")[1] : rawHash;
  return new URLSearchParams(hashQuery).get(key);
}

/**
 * `null` when the callback URL carries no GoTrue error at all (the plain
 * success case — nothing for `handleCallback()` to do beyond letting
 * supabase-js's own `detectSessionInUrl` finish its work).
 */
export function readOAuthCallbackError(
  location: CallbackLocation,
): OAuthCallbackError | null {
  const error = readParam(location, "error");
  const errorDescription = readParam(location, "error_description");
  const errorCode = readParam(location, "error_code");
  if (error == null && errorDescription == null && errorCode == null) {
    return null;
  }
  return mapOAuthCallbackError({ error, errorCode, errorDescription });
}

interface RawOAuthError {
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
}

/**
 * Turns whatever GoTrue put in the URL into a calm, cause-accurate message —
 * never the raw technical string by default, so a visitor who was turned
 * away sees something a person would actually say to them.
 */
function mapOAuthCallbackError({
  error,
  errorDescription,
}: RawOAuthError): OAuthCallbackError {
  const description = errorDescription ?? "";

  // Our own before_user_created age gate (check_signup_age(), 02_functions.sql)
  // rejects with a message written to be shown to a person already — safe
  // to relay verbatim. Matched by content, not by error/error_code: GoTrue
  // relays every Auth Hook rejection the same generic way regardless of
  // which hook raised it, so there is no structured code to switch on here.
  if (/\b18\b/.test(description) && /age/i.test(description)) {
    return { messageKey: description, defaultMessage: description };
  }

  // The visitor closed Google's consent screen, or pressed "Cancel" —
  // nothing went wrong, they just didn't finish.
  if (error === "access_denied") {
    return {
      messageKey: "crm.auth.oauth_callback.cancelled",
      defaultMessage:
        "You closed the Google sign-in window before finishing. No account was created — come back and try again whenever you're ready.",
    };
  }

  // The Google provider isn't enabled/configured on this deployment's
  // Supabase project — a deployment-configuration problem, not something
  // the visitor did.
  if (/not enabled|unsupported provider/i.test(description)) {
    return {
      messageKey: "crm.auth.oauth_callback.not_configured",
      defaultMessage:
        "Google sign-in isn't available right now. Please sign in with your email instead.",
    };
  }

  return {
    messageKey: "crm.auth.oauth_callback.generic",
    defaultMessage:
      "We couldn't complete that sign-in. Please try again, or use your email instead.",
  };
}
