import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Review fix (B6, Epic 12 adversarial review): the app routes with a
 * `HashRouter` — every real screen lives at `/#/…` (e.g. `/#/reminders`,
 * which `workers/cron`'s own return URLs already get right). `APP_ORIGIN`
 * is the bare origin (`https://www.myshadchan.space`, no path), so every
 * Stripe-facing return URL `workers/billing/index.ts` builds MUST go
 * through this one helper rather than interpolating `${APP_ORIGIN}/billing…`
 * ad hoc — a bare server path has an EMPTY route fragment under a
 * HashRouter, so the SPA mounts whatever "no route" renders (the
 * dashboard), never `BillingPage`/`BillingReturnNotice`, and a real Stripe
 * return silently lands nowhere useful.
 */
export function appReturnUrl(origin: string, hashPath: string): string {
  return `${origin}/#${hashPath}`;
}

export type BillingEligibility =
  { eligible: true } | { eligible: false; message: string };

/**
 * Review fix (B5, Epic 12 adversarial review): the ONE role check both
 * `/checkout` and `/portal` share. `subscription`/`ai_usage` RLS
 * (05_policies.sql) denies the `single` role outright
 * (`current_member_role() <> 'single'`), so a `single` caller who reaches
 * Checkout can pay and then NEVER observe or use what they bought —
 * `ai_entitlement()` reads through that same denied policy and always
 * reports unentitled for them, regardless of what the webhook writes. The
 * Worker must refuse the SAME callers the entitlement read already refuses,
 * not merely the ones the (separate, client-side-only) route guard
 * catches. `current_member_role()` is an existing RPC (02_functions.sql,
 * untouched by this story) already granted to `authenticated` — reused
 * here, not reimplemented.
 *
 * An RPC error is treated the same way as the ineligible-role case (both
 * refuse, never fall through to "assume eligible") — mirroring this
 * route's own existing convention for `current_context_id()`, whose error
 * is already folded into the same "no active context" 403 rather than
 * distinguished into a separate status.
 */
export async function isEligibleForBilling(
  supabase: SupabaseClient,
): Promise<BillingEligibility> {
  const { data: role, error } = await supabase.rpc("current_member_role");
  if (error) {
    return { eligible: false, message: "failed to resolve role" };
  }
  if (role === "single") {
    return {
      eligible: false,
      message: "billing is not available for this role",
    };
  }
  return { eligible: true };
}
