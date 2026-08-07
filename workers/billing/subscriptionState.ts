import type Stripe from "stripe";
import type { ScopedClient } from "../shared/forAccount";

/**
 * Story 12.4 (AC-6): the Stripe subscription status -> our domain status map,
 * as one exported pure function, total over Stripe's documented enum (plus
 * anything Stripe adds later, or sends by mistake) rather than a `switch`
 * inlined in the request handler where it could not be unit-tested without a
 * live request. The function's codomain is additionally constrained by the
 * database itself: `subscription_plan_check` / `subscription_status_check`
 * (01_tables.sql) permit only `plan in ('free','ai')` and
 * `status in ('active','lapsed','none')` — a bug here that returned anything
 * else would surface as a check-constraint violation at write time, not a
 * silent wrong state.
 */
export type SubscriptionPlan = "free" | "ai";
export type SubscriptionStatus = "active" | "lapsed" | "none";

export interface MappedSubscriptionState {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
}

const ENTITLED_STRIPE_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
]);

// past_due/unpaid/canceled/incomplete_expired/paused all PAUSE entitlement
// (AC-6's own ruling, recorded so it is not re-litigated mid-build):
// `past_due` pauses immediately rather than holding a grace window — AD-17
// is explicit ("fail-closed on the paid AI paths") and the pause is fully
// reversible: a successful dunning retry emits `customer.subscription.updated`
// with `status: active`, which flips the row back within seconds.
const LAPSED_STRIPE_STATUSES: ReadonlySet<string> = new Set([
  "past_due",
  "unpaid",
  "canceled",
  "incomplete_expired",
  "paused",
]);

/**
 * Maps a Stripe subscription status string onto our domain (plan, status)
 * pair. Total: `incomplete` and any value this function does not recognise
 * (a future Stripe status, or a malformed/unexpected string) both fall
 * through to the free/unentitled default — AD-17's fail-closed posture
 * applied to an unknown value, not just a known-bad one.
 */
export function mapStripeStatus(status: string): MappedSubscriptionState {
  if (ENTITLED_STRIPE_STATUSES.has(status)) {
    return { plan: "ai", status: "active" };
  }
  if (LAPSED_STRIPE_STATUSES.has(status)) {
    return { plan: "ai", status: "lapsed" };
  }
  return { plan: "free", status: "none" };
}

/** Every Stripe event type this worker acts on. Any other type is recorded
 * in stripe_events and answered 200 — never 400, never 500 (AC-6). */
export const HANDLED_STRIPE_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

export type HandledStripeEventType =
  (typeof HANDLED_STRIPE_EVENT_TYPES)[number];

export function isHandledStripeEventType(
  type: string,
): type is HandledStripeEventType {
  return (HANDLED_STRIPE_EVENT_TYPES as readonly string[]).includes(type);
}

/** Duck-typed — deliberately not `Stripe.Checkout.Session |
 * Stripe.Subscription | Stripe.Invoice`, because all three event payloads
 * carry `customer` in the same `string | { id: string } | null` shape and a
 * structural read is both simpler and more resilient to the exact Stripe API
 * version's nested typing than three separate casts would be. */
export function stripeIdOf(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function isoOrNull(unixSeconds: number | null | undefined): string | null {
  return typeof unixSeconds === "number"
    ? new Date(unixSeconds * 1000).toISOString()
    : null;
}

/**
 * The column patch to write to `public.subscription` for one verified,
 * handled Stripe event — a pure reducer, deliberately separate from
 * `mapStripeStatus` so the "which Stripe fields feed which columns" decision
 * is testable without a request or a database (Task 5). Every branch always
 * sets `last_stripe_event_at`, the AC-5 ordering guard's own write; every
 * other key is OMITTED (not set to `null`) unless this event genuinely knows
 * that value, so an `upsert()` never clobbers a column a different event type
 * already populated correctly.
 */
export type SubscriptionPatch = Partial<{
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_end: string | null;
}> & { last_stripe_event_at: string };

export function applyEvent(event: Stripe.Event): SubscriptionPatch | null {
  const lastStripeEventAt = new Date(event.created * 1000).toISOString();

  switch (event.type) {
    // The one event that carries `client_reference_id` — index.ts uses it to
    // establish the account<->customer binding before this function ever
    // runs. A completed subscription-mode Checkout Session means payment
    // succeeded, so this writes ai/active directly rather than waiting for
    // the `customer.subscription.created` event that follows it — price and
    // period are left unset here (not yet known from this payload) and get
    // filled in by that follow-on event.
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        plan: "ai",
        status: "active",
        stripe_customer_id: stripeIdOf(session.customer),
        stripe_subscription_id: stripeIdOf(session.subscription),
        last_stripe_event_at: lastStripeEventAt,
      };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const mapped = mapStripeStatus(subscription.status);
      const item = subscription.items?.data?.[0];
      return {
        ...mapped,
        stripe_customer_id: stripeIdOf(subscription.customer),
        stripe_subscription_id: subscription.id,
        stripe_price_id: item ? stripeIdOf(item.price) : null,
        current_period_end: item ? isoOrNull(item.current_period_end) : null,
        last_stripe_event_at: lastStripeEventAt,
      };
    }

    // AC-7: a lapse is a pause, never a deletion — this row is UPDATED to
    // plan='ai', status='lapsed', never DELETEd. `stripe_subscription_id` is
    // explicitly cleared (a canceled subscription id must not be reused as
    // if it were still live); NOT routed through mapStripeStatus — Stripe's
    // own status on a deleted subscription is 'canceled', which the table
    // above already maps to ai/lapsed, but that mapping alone cannot express
    // "and clear the subscription id", which AC-7 additionally requires.
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      return {
        plan: "ai",
        status: "lapsed",
        stripe_customer_id: stripeIdOf(subscription.customer),
        stripe_subscription_id: null,
        last_stripe_event_at: lastStripeEventAt,
      };
    }

    // AD-17 fail-closed: a failed payment pauses entitlement immediately —
    // the same outcome 'past_due' produces above — but an Invoice carries no
    // subscription-status field of its own to run through mapStripeStatus.
    // price/period are left untouched (omitted, not nulled): whatever the
    // last successful `customer.subscription.updated` wrote for them is
    // still the best-known value.
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      return {
        plan: "ai",
        status: "lapsed",
        stripe_customer_id: stripeIdOf(invoice.customer),
        last_stripe_event_at: lastStripeEventAt,
      };
    }

    default:
      return null;
  }
}

export type ApplySubscriptionPatchResult =
  | { outcome: "applied" }
  | { outcome: "stale" }
  | { outcome: "error"; message: string };

/**
 * AC-5's ordering guard, made atomic (review fix). The original shape of
 * this guard was a select of `last_stripe_event_at` followed, in a SEPARATE
 * round-trip, by an unconditional `upsert()` — two concurrent webhook
 * deliveries for the same account could both read the same pre-write value,
 * both decide in application memory that they were not stale, and then race
 * at the upsert with whichever request's write committed last winning,
 * regardless of which event actually carried the newer `created` timestamp.
 * Stripe explicitly does not guarantee delivery order, which is the entire
 * reason this ordering guard exists, so that race is a real gap, not a
 * hypothetical one.
 *
 * This closes it WITHOUT a stored procedure: `supabase/schemas/02_functions.sql`
 * is declared out of scope for this story (AC-1's "byte-identical
 * `ai_entitlement()`", and the story's own "not touched, deliberately" file
 * list) — everything below is built from the plain update/insert primitives
 * `forAccount()` already exposes, each of which Postgres executes as a
 * single statement under one row lock:
 *
 * 1. Try a single conditional `UPDATE ... WHERE last_stripe_event_at IS NULL
 *    OR last_stripe_event_at < event.created`. A second writer that blocks on
 *    that row's lock re-evaluates this WHERE clause against the FIRST
 *    writer's already-committed row once it acquires the lock (ordinary READ
 *    COMMITTED semantics) — never against a value either of them read before
 *    the other wrote, which is exactly the window the old select-then-upsert
 *    left open.
 * 2. Zero rows updated means either no row exists yet, or the existing row
 *    already holds an event at least as new as this one. Attempt a plain
 *    INSERT — cheap and correct when no row exists; a no-op-with-error
 *    (`23505`, `subscription_account_id_key`) when one does.
 * 3. On that conflict, retry step 1 once — a row now provably exists, so
 *    this retry's result (rows updated, or not) is the true, final answer:
 *    "applied" if this event turned out to be the newer one after all,
 *    "stale" if it did not.
 */
export async function applySubscriptionPatch(
  scoped: ScopedClient,
  patch: SubscriptionPatch,
  eventCreatedAt: Date,
): Promise<ApplySubscriptionPatchResult> {
  const staleFilter = `last_stripe_event_at.is.null,last_stripe_event_at.lt.${eventCreatedAt.toISOString()}`;

  const attemptConditionalUpdate = async (): Promise<{
    rows: unknown[];
    error: { message: string } | null;
  }> => {
    const { data, error } = await scoped
      .from("subscription")
      .update(patch)
      .or(staleFilter)
      .select("account_id");
    return { rows: (data as unknown[] | null) ?? [], error };
  };

  const first = await attemptConditionalUpdate();
  if (first.error) {
    return { outcome: "error", message: first.error.message };
  }
  if (first.rows.length > 0) {
    return { outcome: "applied" };
  }

  // No existing row matched the staleness predicate. Try to create one —
  // correct when the account has no subscription row yet; a cheap,
  // expected conflict (never a real error) when it already does.
  const { error: insertError } = await scoped
    .from("subscription")
    .insert(patch);
  if (!insertError) {
    return { outcome: "applied" };
  }
  if (insertError.code !== "23505") {
    return { outcome: "error", message: insertError.message };
  }

  // A row exists (created concurrently just now, or existed all along and
  // simply failed the staleness check above) — resolve it with one more
  // conditional update, just as atomic as the first.
  const retry = await attemptConditionalUpdate();
  if (retry.error) {
    return { outcome: "error", message: retry.error.message };
  }
  return retry.rows.length > 0 ? { outcome: "applied" } : { outcome: "stale" };
}
