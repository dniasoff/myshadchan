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
export type SubscriptionStatus = "active" | "past_due" | "lapsed" | "none";

export interface MappedSubscriptionState {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
}

const ENTITLED_STRIPE_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
]);

// FR75: past_due gets a grace window — map to our 'past_due' status (not 'lapsed').
// unpaid/canceled/incomplete_expired/paused lapse immediately with no grace.
const LAPSED_STRIPE_STATUSES: ReadonlySet<string> = new Set([
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
  if (status === "past_due") {
    return { plan: "ai", status: "past_due" };
  }
  if (LAPSED_STRIPE_STATUSES.has(status)) {
    return { plan: "ai", status: "lapsed" };
  }
  return { plan: "free", status: "none" };
}

/** Every Stripe event type this worker acts on. Any other type is recorded
 * in stripe_events and answered 200 — never 400, never 500 (AC-6).
 *
 * Review fix (B9): `checkout.session.async_payment_succeeded` /
 * `..._failed` were added alongside `checkout.session.completed` because a
 * delayed payment method (bank debit — this story's own stated fee-driven
 * preference) does NOT settle synchronously. `applyEvent()` below never
 * grants ai/active from `checkout.session.completed` unless Stripe's own
 * `payment_status` on that session already reads `paid` — a delayed method
 * reports `unpaid` at that point, and entitlement is granted only once one
 * of these two async events resolves it either way. */
export const HANDLED_STRIPE_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
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

/**
 * Review fix (B1): `event.livemode` was stored in `stripe_events` for audit
 * but never checked against anything — so a test-mode Stripe event, sent to
 * a Worker that happens to be running test-mode secrets in production
 * (exactly the deployed state at the time of this finding), could write a
 * real `active` subscription into the production entitlement table.
 *
 * The Worker's own mode must be an ENFORCED invariant, derived from
 * something that cannot silently drift from what it actually talks to —
 * never a second, independently-set boolean env var, which could itself be
 * misconfigured the same way `STRIPE_SECRET_KEY` was. Stripe secret (and
 * restricted) keys are self-describing: `sk_live_…`/`rk_live_…` vs.
 * `sk_test_…`/`rk_test_…`. Deriving the Worker's mode from the KEY IT IS
 * ACTUALLY CONFIGURED WITH means there is no second setting to forget, and
 * "which mode is this Worker in" always answers "whichever mode its own
 * secret key would authenticate against at Stripe" — the same fact Stripe
 * itself would use.
 */
export function isLiveStripeSecretKey(secretKey: string): boolean {
  return secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");
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
  grace_ends_at: string | null;
}> & { last_stripe_event_at: string };

export function applyEvent(event: Stripe.Event): SubscriptionPatch | null {
  const lastStripeEventAt = new Date(event.created * 1000).toISOString();

  switch (event.type) {
    // The one event that carries `client_reference_id` — index.ts uses it to
    // establish the account<->customer binding before this function ever
    // runs, for this event AND for its two async siblings below (they carry
    // the same field on the same Checkout Session object).
    //
    // Review fix (B9): a completed Checkout Session does NOT always mean
    // payment succeeded — `payment_status` is `'unpaid'` for a delayed
    // payment method (e.g. bank debit) until the async event resolves it.
    // Only `'paid'`/`'no_payment_required'` grants ai/active here; otherwise
    // plan/status are OMITTED (never written), leaving the row at its
    // existing/default unentitled state while still binding
    // stripe_customer_id/stripe_subscription_id — REQUIRED so
    // `resolveAccountForCustomer` can resolve the account for the async
    // follow-up event regardless of which one Stripe delivers first (Stripe
    // does not guarantee delivery order). price/period stay unset either
    // way — not yet known from this payload — and get filled in by the
    // `customer.subscription.created` event that follows.
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const paidNow =
        session.payment_status === "paid" ||
        session.payment_status === "no_payment_required";
      return {
        ...(paidNow ? { plan: "ai" as const, status: "active" as const } : {}),
        stripe_customer_id: stripeIdOf(session.customer),
        stripe_subscription_id: stripeIdOf(session.subscription),
        last_stripe_event_at: lastStripeEventAt,
      };
    }

    // B9: the delayed payment actually cleared — grant entitlement now,
    // exactly as the synchronous `'paid'` branch above does.
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        plan: "ai",
        status: "active",
        stripe_customer_id: stripeIdOf(session.customer),
        stripe_subscription_id: stripeIdOf(session.subscription),
        last_stripe_event_at: lastStripeEventAt,
      };
    }

    // B9: the delayed payment failed — this Checkout attempt never became a
    // paid subscription, so the row is written explicitly to free/none
    // (never merely left alone) rather than reusing the 'lapsed' status
    // `invoice.payment_failed` below uses for an ALREADY-active
    // subscription's failed renewal. "Lapsed" means "was paid, now expired";
    // this attempt was never paid in the first place.
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        plan: "free",
        status: "none",
        stripe_customer_id: stripeIdOf(session.customer),
        last_stripe_event_at: lastStripeEventAt,
      };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const mapped = mapStripeStatus(subscription.status);
      const item = subscription.items?.data?.[0];
      const patch: SubscriptionPatch = {
        ...mapped,
        stripe_customer_id: stripeIdOf(subscription.customer),
        stripe_subscription_id: subscription.id,
        stripe_price_id: item ? stripeIdOf(item.price) : null,
        current_period_end: item ? isoOrNull(item.current_period_end) : null,
        last_stripe_event_at: lastStripeEventAt,
      };
      // FR75: when subscription recovers to active, clear grace_ends_at
      // Per the field-omission principle (see lines 132-136), we omit the field
      // entirely rather than setting it to null, to avoid clobbering values
      // set by other event types.
      if (mapped.status === "active") {
        // Intentionally omit grace_ends_at to clear any existing value
        // (do not add the field to the patch at all)
      }
      return patch;
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
  // Review fix (B8): `event.created` has SECOND precision, so two distinct
  // events (e.g. `checkout.session.completed` and
  // `customer.subscription.created` for the same checkout, or two
  // legitimate updates) can carry the identical timestamp. A strict `.lt.`
  // here treated a tie as "not newer" and silently dropped whichever event
  // lost the race to be applied first — even though it was not older, just
  // simultaneous. `.lte.` implements the epic's own stated rule ("applies
  // when its timestamp is greater than or equal to the last one") instead:
  // an event with a timestamp EQUAL to the stored one is still eligible to
  // apply.
  //
  // What this guarantees: a genuinely OLDER event (`created` strictly less
  // than the stored value) is still always rejected — `.lte.` only widens
  // the boundary to include equality, it never admits anything `.lt.` would
  // have excluded for being older. What it does NOT guarantee: a total
  // order between two same-second events — Stripe does not provide one, and
  // no timestamp-only rule can invent one. Both same-second events are
  // instead allowed to apply, in WHATEVER order they are delivered, and
  // correctness falls out of `applyEvent()`'s own field-omission
  // convention: each event's patch OMITS (never nulls) any field it does
  // not know, so two same-second patches with disjoint field sets (e.g.
  // `checkout.session.completed`'s customer/subscription ids and
  // `customer.subscription.created`'s price/period) both land regardless of
  // arrival order, rather than the second one clobbering the first's
  // fields with nulls. A genuine conflict between two same-second events
  // that both set the SAME field differently is not resolved by this
  // guard — it resolves to "whichever committed last," which is the same
  // guarantee `.lt.` already gave for a strictly-newer event racing an
  // in-flight older write.
  const staleFilter = `last_stripe_event_at.is.null,last_stripe_event_at.lte.${eventCreatedAt.toISOString()}`;

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
