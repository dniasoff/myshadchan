import { useQuery } from "@tanstack/react-query";

import { getSupabaseClient } from "../providers/supabase/supabase";

/**
 * Review fix (B7, Epic 12 adversarial review). `BillingPage` used to render
 * `ManageSubscriptionButton` for every entitled/lapsed account based only on
 * `ai_entitlement()`'s limited payload — but the migration that backfilled
 * `provisioning_source` deliberately left every pre-existing, hand-provisioned
 * subscription (`provisioning_source = 'manual'`) with NO Stripe customer id,
 * and `POST /portal` 404s ("no subscription") for exactly those rows
 * (`workers/billing/index.ts`). A manual subscriber therefore saw a button
 * that could only ever fail.
 *
 * `ai_entitlement()` (`supabase/schemas/02_functions.sql`) is out of scope
 * for this story (AC-1: byte-identical) and was never going to be widened to
 * expose this — instead, this reads `public.subscription` directly, which is
 * ALREADY readable by the account owner under the same RLS policy
 * `ai_entitlement()` itself reads through ("Subscription readable within
 * account", 05_policies.sql — denies `single`, same as the entitlement read).
 * No new backend surface, no Worker route, no schema change: the row was
 * already there to read.
 */
export type SubscriptionStatus = {
  /** Whether a Stripe customer id is on file — i.e. whether `/portal` can
   * plausibly return anything other than 404. */
  hasStripeCustomer: boolean;
  provisioningSource: "manual" | "stripe";
};

/** Fails closed toward "no portal, manual" — the honest-copy branch, never
 * the button that could 404 — whenever the row cannot be read at all (RLS
 * denial, network error, or genuinely no row yet). */
const UNKNOWN_STATUS: SubscriptionStatus = {
  hasStripeCustomer: false,
  provisioningSource: "manual",
};

export const SUBSCRIPTION_STATUS_QUERY_KEY = [
  "billingSubscriptionStatus",
] as const;

type SubscriptionStatusRow = {
  stripe_customer_id: string | null;
  provisioning_source: "manual" | "stripe" | null;
};

export function useSubscriptionStatus(): {
  status: SubscriptionStatus;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: SUBSCRIPTION_STATUS_QUERY_KEY,
    queryFn: async (): Promise<SubscriptionStatus> => {
      const { data, error } = await getSupabaseClient()
        .from("subscription")
        .select("stripe_customer_id, provisioning_source")
        .maybeSingle<SubscriptionStatusRow>();

      if (error || !data) {
        return UNKNOWN_STATUS;
      }

      return {
        hasStripeCustomer: data.stripe_customer_id != null,
        provisioningSource: data.provisioning_source ?? "manual",
      };
    },
  });

  return { status: data ?? UNKNOWN_STATUS, isLoading };
}
