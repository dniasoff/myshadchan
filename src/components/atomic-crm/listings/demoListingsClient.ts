import { getSupabaseClient } from "../providers/supabase/supabase";
import {
  loadListingsFromClient,
  type PublicListing,
  type PublicListingsQuery,
} from "./publicListingsClient";

export type DemoPreviewDeniedReason = "anonymous" | "inactive";

export interface DemoPreviewAccountProjection {
  account_id: number | string;
}

/**
 * A demo preview is a capability of the persisted signed-in session, not a
 * URL capability. Keeping a small typed denial lets the UI explain why the
 * preview is unavailable without showing ordinary public rows as a fallback.
 */
export class DemoPreviewDeniedError extends Error {
  readonly reason: DemoPreviewDeniedReason;

  constructor(reason: DemoPreviewDeniedReason) {
    super(
      reason === "anonymous"
        ? "Sign in to preview the demo sandbox."
        : "This demo sandbox is no longer available.",
    );
    this.name = "DemoPreviewDeniedError";
    this.reason = reason;
  }
}

/**
 * Loads only the caller's active demo bundle through the persisted
 * authenticated Supabase client. The explicit session and sanitized
 * `current_demo_preview_accounts()` projection prevent `/find?demo=1` from
 * degrading into the ordinary anonymous marketplace for signed-out, cleared,
 * failed, or cross-bundle runs; the listings table's authenticated RLS policy
 * then enforces the caller's exact bundle scope for every returned row.
 */
export const loadDemoPreviewListings = async (
  query: PublicListingsQuery,
): Promise<PublicListing[]> => {
  const client = getSupabaseClient();
  const { data: sessionData, error: sessionError } =
    await client.auth.getSession();

  if (sessionError || !sessionData.session?.user) {
    throw new DemoPreviewDeniedError("anonymous");
  }

  // This RPC is intentionally a sanitized, caller-scoped projection. The
  // browser receives only active-run account ids; it never supplies an
  // account/bundle id and never falls back to the ordinary marketplace.
  const { data: projection, error: projectionError } = await client.rpc(
    "current_demo_preview_accounts",
  );
  const accountIds = (Array.isArray(projection) ? projection : [])
    .map((row: DemoPreviewAccountProjection) => row.account_id)
    .filter((id): id is number | string => id != null);
  if (projectionError || accountIds.length === 0) {
    throw new DemoPreviewDeniedError("inactive");
  }

  // RLS is deliberately still the final authority. This read does not accept
  // an account id or bundle id from the URL, so a caller cannot widen its
  // scope by editing the preview link.
  return loadListingsFromClient(client, query, accountIds);
};
