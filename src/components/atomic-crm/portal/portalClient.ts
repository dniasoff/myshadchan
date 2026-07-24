import type { ChildPortalData } from "../types";
import { getSupabaseClient } from "../providers/supabase/supabase";

/**
 * Loads a child's portal through the anon Supabase client (there is no session —
 * the portal is unauthenticated). public.get_child_portal() is a SECURITY DEFINER
 * RPC that performs ALL scoping server-side (token -> child, visibility='shared',
 * child-visible state) and returns only child-safe fields, so an anon caller can
 * safely reach exactly that slice and nothing else.
 *
 * An unknown or revoked token comes back as `null`. A transport/config error is
 * thrown so the page can present it as an inactive link rather than a stack trace.
 */
export const loadChildPortal = async (
  token: string,
): Promise<ChildPortalData | null> => {
  const { data, error } = await getSupabaseClient().rpc("get_child_portal", {
    p_token: token,
  });
  if (error) {
    throw new Error(error.message || "Failed to load the portal");
  }
  return (data ?? null) as ChildPortalData | null;
};
