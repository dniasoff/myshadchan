import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BaseEnv } from "../shared/env";

/**
 * Story 12.4 (AC-11): the single named carve-out from AD-7's rule that
 * `forAccount(accountId, env)` is "the only way a Worker touches a tenant
 * table". A webhook arrives holding a Stripe customer id and no tenant
 * identity at all — no JWT, no account id — so something has to translate
 * one into the other BEFORE `forAccount()` can be used for anything else in
 * this request; that translation is `resolveAccountForCustomer` below.
 *
 * This file is the only place under `workers/billing/` (outside its own
 * test) that builds a raw service-role client keyed on
 * `SUPABASE_SERVICE_ROLE_KEY` — everything downstream of a RESOLVED account
 * id goes through `forAccount(accountId, env)` instead (index.ts's
 * `subscription` upsert). `recordStripeEvent` below is the one other
 * operation kept here rather than routed through `forAccount()`:
 * `stripe_events.account_id` is nullable BY DESIGN (an event for a customer
 * this worker cannot resolve to any account is still recorded — Task 5's
 * "do not guess" instruction — and `forAccount()` refuses an empty accountId
 * outright), and the table itself has zero RLS policies to bypass carefully
 * (05_policies.sql) — there is no tenant-isolation concern `forAccount()`'s
 * scoping exists to enforce here the way there is for `subscription`. Both
 * functions share ONE client-construction call site (`serviceClient` below)
 * rather than each minting its own, which is what keeps this file's total
 * raw-client surface at exactly one line for a source sweep to find.
 */
function serviceClient(env: BaseEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * The one query this carve-out exists for:
 * `select account_id from subscription where stripe_customer_id = $1`.
 * Returns `null`, never throws, when the customer is unknown — an unknown
 * customer is a normal event (a Stripe test fixture, another environment
 * sharing the Stripe account, or an event that legitimately arrives before
 * `checkout.session.completed` has ever bound this customer to an account),
 * and the webhook answers `200 ok({ ignored: true })` for it rather than
 * 500ing into Stripe's retry-and-disable loop. A real query error (a
 * transport failure, a malformed customerId) is treated the same way, for
 * the same reason — this function's whole contract is "never throw".
 */
export async function resolveAccountForCustomer(
  customerId: string,
  env: BaseEnv,
): Promise<number | null> {
  const { data, error } = await serviceClient(env)
    .from("subscription")
    .select("account_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data.account_id as number;
}

export interface RecordStripeEventInput {
  eventId: string;
  type: string;
  /** Null when the event's customer could not be resolved to any account
   * (Task 5: "record it in stripe_events with a null account_id"). */
  accountId: number | null;
  livemode: boolean;
}

export type RecordStripeEventResult =
  | { outcome: "recorded" }
  | { outcome: "duplicate" }
  | { outcome: "error"; message: string };

/**
 * AC-5's insert-first idempotency guard: `stripe_events.event_id` is the
 * primary key, so a duplicate delivery attempts a duplicate INSERT and fails
 * `unique_violation` (Postgres 23505, surfaced by PostgREST as HTTP 409) —
 * treated here as a normal, expected outcome (`"duplicate"`), never an
 * error, because Stripe retries a non-2xx for up to 3 days and a duplicate
 * must be a cheap, successful no-op.
 */
export async function recordStripeEvent(
  input: RecordStripeEventInput,
  env: BaseEnv,
): Promise<RecordStripeEventResult> {
  const { error } = await serviceClient(env).from("stripe_events").insert({
    event_id: input.eventId,
    type: input.type,
    account_id: input.accountId,
    livemode: input.livemode,
  });

  if (!error) {
    return { outcome: "recorded" };
  }
  if (error.code === "23505") {
    return { outcome: "duplicate" };
  }
  return { outcome: "error", message: error.message };
}
