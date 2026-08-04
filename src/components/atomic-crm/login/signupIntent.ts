import { getAnonSupabaseClient } from "../providers/supabase/supabase";

/**
 * Records a short-lived, single-use signup intent for `email` — the
 * fallback `check_signup_age()` (02_functions.sql) reads when an OAuth
 * signup's `user_metadata` carries no `age_affirmed` (Google's redirect
 * never lets us set that ourselves, since `signInWithOAuth()`'s
 * `queryParams` go to Google, not to Supabase).
 *
 * MUST be called — and awaited — before `signInWithOAuth()` redirects the
 * browser away, never after: there is no "after" once the tab has
 * navigated to Google.
 *
 * Uses the anon-only client (never the possibly-signed-in default one —
 * see `getAnonSupabaseClient`'s own comment) because this insert has to
 * behave identically whether or not some other tab on this device happens
 * to be signed in, and because the table's RLS policy only grants INSERT
 * to `anon` in the first place.
 *
 * Safety of an anon-writable, email-keyed table: `check_signup_age()` only
 * ever consumes an intent for the EXACT email GoTrue verified ownership of
 * via Google's own consent flow. Recording an intent for an address you
 * don't control cannot let anyone complete OAuth as that address (see
 * `signup_intents`' own comment in `01_tables.sql`) — worst case here is a
 * mismatched intent that simply never gets consumed and expires unused.
 */
export async function recordSignupIntent(email: string): Promise<void> {
  const { error } = await getAnonSupabaseClient()
    .from("signup_intents")
    .insert({ email });
  if (error) {
    throw error;
  }
}
