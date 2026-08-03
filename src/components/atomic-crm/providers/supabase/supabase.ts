import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null = null;

export const getSupabaseClient = () => {
  if (!supabaseClient) {
    supabaseClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SB_PUBLISHABLE_KEY,
    );
  }
  return supabaseClient;
};

let anonSupabaseClient: SupabaseClient | null = null;

/**
 * A second Supabase client that can NEVER carry a signed-in session,
 * regardless of what is in the browser's `localStorage` or the current
 * URL — for surfaces that must behave identically to `anon` even when a
 * member happens to already be signed in elsewhere in the app (Story 9.4
 * review finding F2: `getSupabaseClient()`'s singleton hydrates ANY
 * persisted session by default via `persistSession: true`, so a signed-in
 * visitor hitting an unauthenticated public page silently gets
 * `authenticated`-scoped results instead of `anon`-scoped ones — wrong,
 * and dangerous to test, since manual QA done while signed in would look
 * like the page working). `persistSession`, `autoRefreshToken` and
 * `detectSessionInUrl` are all explicitly disabled so this instance never
 * reads, writes, or upgrades to a session under any circumstance — every
 * request through it goes out with only the anon `apikey`.
 */
export const getAnonSupabaseClient = () => {
  if (!anonSupabaseClient) {
    anonSupabaseClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SB_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
  }
  return anonSupabaseClient;
};
