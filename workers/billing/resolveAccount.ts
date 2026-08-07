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
 * `subscription` upsert). The ledger functions below are the other
 * operations kept here rather than routed through `forAccount()`:
 * `stripe_events.account_id` is nullable BY DESIGN (an event for a customer
 * this worker cannot resolve to any account is still recorded — Task 5's
 * "do not guess" instruction — and `forAccount()` refuses an empty accountId
 * outright), and the table itself has zero RLS policies to bypass carefully
 * (05_policies.sql) — there is no tenant-isolation concern `forAccount()`'s
 * scoping exists to enforce here the way there is for `subscription`. Every
 * function below shares ONE client-construction call site (`serviceClient`
 * below) rather than each minting its own, which is what keeps this file's
 * total raw-client surface at exactly one line for a source sweep to find.
 */
function serviceClient(env: BaseEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export type ResolveAccountResult =
  | { outcome: "found"; accountId: number }
  | { outcome: "not_found" }
  | { outcome: "error"; message: string };

/**
 * The one query this carve-out exists for:
 * `select account_id from subscription where stripe_customer_id = $1`.
 *
 * Review fix (B3): this used to collapse "no matching row" and "the query
 * itself failed" onto the same `null` return, which made a transient
 * database/transport error indistinguishable from a genuinely unknown
 * customer. The caller needs to tell them apart — "unknown customer" is a
 * business outcome the webhook may safely record and dedupe forever;
 * "could not query the mapping" is an operational failure that MUST stay
 * retryable, or a database blip on delivery #1 permanently strands that
 * event's account binding even after the database recovers, because a
 * later manual resend of the SAME event id would already be in the ledger.
 * Three explicit outcomes replace the single nullable return so the caller
 * can never conflate them again.
 */
export async function resolveAccountForCustomer(
  customerId: string,
  env: BaseEnv,
): Promise<ResolveAccountResult> {
  const { data, error } = await serviceClient(env)
    .from("subscription")
    .select("account_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) {
    return { outcome: "error", message: error.message };
  }
  if (!data) {
    return { outcome: "not_found" };
  }
  return { outcome: "found", accountId: data.account_id as number };
}

export interface ClaimStripeEventInput {
  eventId: string;
  type: string;
  livemode: boolean;
}

export type ClaimStripeEventResult =
  | { outcome: "claimed" }
  | { outcome: "retry" }
  | { outcome: "done" }
  | { outcome: "error"; message: string };

/**
 * Review fix (B2): the old `recordStripeEvent()` inserted the ledger row
 * BEFORE the domain mutation was even attempted, and treated any later
 * unique-violation as an unconditional "deduped, nothing left to do." That
 * conflated two different states under one primary key: "Stripe has
 * delivered this event id before" and "this event was fully, successfully
 * processed." A mutation failure after the insert left the ledger row
 * behind with nothing recorded about that failure — the next delivery
 * (Stripe's own automatic retry) hit the same primary key, was told
 * `{deduped:true}`, and the failed mutation was never retried. A transient
 * database error thus became permanent entitlement drift.
 *
 * `stripe_events.status` (`'received' | 'done'`, migration
 * 20260807_billing_ledger_status or similar — see 01_tables.sql) makes the
 * two states explicit and this function is the ONLY writer of `'received'`:
 *
 * - No existing row -> INSERT one at `status = 'received'` and report
 *   `"claimed"`: this delivery owns processing end-to-end.
 * - An existing row still at `'received'` -> report `"retry"`: an earlier
 *   attempt for this exact event id claimed it but never reached
 *   `markStripeEventDone()`, so this delivery (Stripe's own retry, or a
 *   manual resend) must reprocess from scratch rather than being told it
 *   already happened. Reprocessing is safe: every downstream step this
 *   event can reach (`resolveAccountForCustomer`, `applySubscriptionPatch`)
 *   is itself idempotent/order-safe.
 * - An existing row at `'done'` -> report `"done"`: a genuinely completed
 *   delivery. THIS is the only case that may answer `{deduped:true}` without
 *   doing any further work.
 */
export async function claimStripeEvent(
  input: ClaimStripeEventInput,
  env: BaseEnv,
): Promise<ClaimStripeEventResult> {
  const { error } = await serviceClient(env).from("stripe_events").insert({
    event_id: input.eventId,
    type: input.type,
    livemode: input.livemode,
    status: "received",
  });

  if (!error) {
    return { outcome: "claimed" };
  }
  if (error.code !== "23505") {
    return { outcome: "error", message: error.message };
  }

  const { data, error: selectError } = await serviceClient(env)
    .from("stripe_events")
    .select("status")
    .eq("event_id", input.eventId)
    .maybeSingle();

  if (selectError) {
    return { outcome: "error", message: selectError.message };
  }
  if (!data) {
    // The row that just caused our insert to conflict is gone by the time
    // we re-read it — never observed, kept as a fail-closed backstop rather
    // than treating an impossible state as a silent dedupe.
    return {
      outcome: "error",
      message: "stripe_events row vanished after a conflicting insert",
    };
  }

  return (data as { status: string }).status === "done"
    ? { outcome: "done" }
    : { outcome: "retry" };
}

export type MarkStripeEventDoneResult =
  { ok: true } | { ok: false; message: string };

/**
 * The ONLY writer of `status = 'done'` — called once this event has reached
 * a genuinely terminal outcome (a mutation applied, a mutation correctly
 * declined as stale, or a legitimate no-op: an unresolvable customer, an
 * unhandled event type, or a mode mismatch). `accountId` is written here
 * too — never at claim time — so a row claimed before account resolution
 * completes still ends up with the right tenant link once resolution
 * succeeds.
 */
export async function markStripeEventDone(
  eventId: string,
  accountId: number | null,
  env: BaseEnv,
): Promise<MarkStripeEventDoneResult> {
  const { error } = await serviceClient(env)
    .from("stripe_events")
    .update({ status: "done", account_id: accountId })
    .eq("event_id", eventId);

  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}
