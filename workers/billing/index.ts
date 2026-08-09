import Stripe from "stripe";
import { z } from "zod";
import { createWorkerApp } from "../shared/createApp";
import { createCallerClient } from "../shared/aiEntitlementGate";
import {
  BILLING_WORKER_ALLOWED_HEADERS,
  BILLING_WORKER_ALLOWED_ORIGINS,
  createCorsMiddleware,
} from "../shared/cors";
import { ok, fail } from "../shared/envelope";
import type { BaseEnv } from "../shared/env";
import { forAccount } from "../shared/forAccount";
import { appReturnUrl, isEligibleForBilling } from "./checkoutHelpers";
import {
  claimStripeEvent,
  markStripeEventDone,
  resolveAccountForCustomer,
} from "./resolveAccount";
import {
  applyEvent,
  applySubscriptionPatch,
  isHandledStripeEventType,
  isLiveStripeSecretKey,
  stripeIdOf,
} from "./subscriptionState";
import { alertOnSilence, createErrorAlerter } from "../shared/alerting";

// Story 12.4: Stripe billing. Checkout + a signature-verified, idempotent
// Stripe webhook syncing `public.subscription` and `public.stripe_events` —
// and NOTHING ELSE. Earlier revisions of this file's own header comment
// described "syncing `accounts`" (the AD-16 design); that was superseded by
// E4's shipped `subscription` table (01_tables.sql's own comment above it
// explains why) before this story ever wrote a line of webhook code, and the
// entitlement authority, `public.ai_entitlement()`, is UNCHANGED and
// UNTOUCHED by this story (AC-1) — this worker is a writer, never a decider.
export interface BillingEnv extends BaseEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID_QUARTERLY?: string;
  STRIPE_PRICE_ID_YEARLY?: string;
  APP_ORIGIN?: string;
}

function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
}

// `forAccount()`'s ScopedTable is deliberately untyped against a Database
// schema (workers/shared/forAccount.ts has none to offer), so a `.select()`
// result resolves to `{}` rather than a shape TS can check property access
// against. This narrows the exact column this file ever reads back out of
// `subscription` — a cast at the query boundary, not a `no-any` escape hatch
// spread through the route bodies.
type SubscriptionCustomerRow = { stripe_customer_id: string | null };

const app = createWorkerApp<BillingEnv>("billing");

// AC-12: CORS is opened for the two browser routes and closed for /webhook —
// registered per-route (never `app.use("*", …)`, unlike every other Worker
// in this repo) precisely BECAUSE /webhook must answer with no
// Access-Control-* headers at all: it is server-to-server (Stripe, not a
// browser) and giving it CORS headers is this AC's own failing condition.
const billingCors = createCorsMiddleware({
  origins: BILLING_WORKER_ALLOWED_ORIGINS,
  methods: ["POST"],
  allowHeaders: [...BILLING_WORKER_ALLOWED_HEADERS],
});
app.use("/checkout", billingCors);
app.use("/portal", billingCors);

const CheckoutBodySchema = z.object({
  // Story 12.4 pricing amendment: there is no monthly cadence. Using
  // "monthly" here would be a silent 400 — the Worker would look up a price
  // env var (STRIPE_PRICE_ID_MONTHLY) that was never pushed.
  cadence: z.enum(["quarterly", "yearly"]),
});

/**
 * AC-8: creates a Checkout Session and grants nothing. Resolves the caller's
 * account the same way `ai_entitlement()` will later read it
 * (`current_context_id()`, SECURITY DEFINER, granted to `authenticated`) so
 * payment entitles the same context that was active at checkout.
 */
app.post("/checkout", async (c) => {
  const requestId = crypto.randomUUID();
  const alerter = createErrorAlerter(c.env, "billing", "/checkout", requestId);

  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json(fail("missing Authorization header"), 401);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch (error) {
    await alerter(error, "warning");
    return c.json(fail("invalid request body"), 400);
  }
  const bodyResult = CheckoutBodySchema.safeParse(rawBody);
  if (!bodyResult.success) {
    await alerter(new Error("invalid request body"), "warning");
    return c.json(fail("invalid request body"), 400);
  }

  const {
    STRIPE_SECRET_KEY,
    STRIPE_PRICE_ID_QUARTERLY,
    STRIPE_PRICE_ID_YEARLY,
    APP_ORIGIN,
  } = c.env;
  const priceId =
    bodyResult.data.cadence === "quarterly"
      ? STRIPE_PRICE_ID_QUARTERLY
      : STRIPE_PRICE_ID_YEARLY;
  if (!STRIPE_SECRET_KEY || !APP_ORIGIN || !priceId) {
    await alerter(new Error("billing not configured"), "critical");
    return c.json(fail("billing not configured"), 500);
  }

  const supabase = createCallerClient(authHeader, c.env);
  const { data: accountIdRaw, error: contextError } =
    await supabase.rpc("current_context_id");
  const accountId = accountIdRaw as number | null;
  if (contextError || accountId == null) {
    await alerter(contextError ?? new Error("no active context"), "warning");
    return c.json(fail("no active context"), 403);
  }

  const eligibility = await isEligibleForBilling(supabase);
  if (!eligibility.eligible) {
    await alerter(new Error(eligibility.message), "warning");
    return c.json(fail(eligibility.message), 403);
  }

  // AC-8: never a second Stripe customer for the same account — reuse the
  // one already on file, if any.
  //
  // Review fix (B4): the initial select's error was previously discarded
  // outright (only `data` was read), so a transient read failure fell
  // through to the "no existing customer" branch below and could create a
  // customer the account may already have one for.
  const scoped = forAccount(String(accountId), c.env);
  const { data: existing, error: selectError } = (await scoped
    .from("subscription")
    .select("stripe_customer_id")
    .maybeSingle()) as {
    data: SubscriptionCustomerRow | null;
    error: { message: string } | null;
  };
  if (selectError) {
    await alerter(new Error(selectError.message), "critical");
    return c.json(fail("failed to look up subscription"), 500);
  }
  const existingCustomerId = existing?.stripe_customer_id ?? undefined;

  const stripe = createStripeClient(STRIPE_SECRET_KEY);
  let customerId = existingCustomerId;

  if (!customerId) {
    // Review fix (B4): concurrent creation. Two `/checkout` calls for the
    // SAME account (two household members, two tabs) can both reach this
    // branch having both observed no stored customer — a plain
    // read-then-create race the DB's unique index on
    // `subscription.stripe_customer_id` cannot prevent, because it only
    // stops two LOCAL rows from holding the same remote id; it does nothing
    // to stop two DIFFERENT remote Stripe customers from being created in
    // the first place.
    //
    // A DETERMINISTIC idempotency key derived from `accountId` alone (never
    // a random UUID) closes this at the one place that can actually
    // serialize it: Stripe itself. Two concurrent `customers.create()` calls
    // carrying the identical key AND identical params (this body never
    // varies per call) are deduplicated by Stripe — both requests resolve to
    // the SAME customer object, never two. The key stays valid for Stripe's
    // idempotency window regardless of how this request's own database
    // write below fares, so a retried `/checkout` after a failed upsert
    // reuses the same customer rather than minting another.
    let customer: Stripe.Customer;
    try {
      customer = await stripe.customers.create(
        { metadata: { account_id: String(accountId) } },
        { idempotencyKey: `billing-customer-account-${accountId}` },
      );
    } catch (error) {
      await alerter(error, "critical");
      return c.json(fail("failed to create customer"), 500);
    }
    customerId = customer.id;

    // Review fix (B4): this upsert's error was previously discarded
    // outright — a failed write here used to still return a successful
    // Checkout URL, silently leaving the new customer unrecorded (the next
    // `/checkout` call would then have no stored id to reuse and rely
    // entirely on the SAME idempotency key to avoid creating yet another
    // Stripe customer).
    const { error: upsertError } = await scoped
      .from("subscription")
      .upsert({ stripe_customer_id: customerId }, { onConflict: "account_id" });
    if (upsertError) {
      await alerter(new Error(upsertError.message), "critical");
      return c.json(fail("failed to persist stripe customer"), 500);
    }
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(accountId),
      metadata: { account_id: String(accountId) },
      customer: customerId,
      success_url: appReturnUrl(APP_ORIGIN, "/billing?checkout=success"),
      cancel_url: appReturnUrl(APP_ORIGIN, "/billing?checkout=cancelled"),
    });
  } catch (error) {
    await alerter(error, "critical");
    return c.json(fail("failed to create checkout session"), 500);
  }

  if (!session.url) {
    await alerter(new Error("failed to create checkout session"), "critical");
    return c.json(fail("failed to create checkout session"), 500);
  }

  return c.json(ok({ url: session.url }));
});

/**
 * AC-9: the only upgrade / downgrade / cancel / card-update surface. Never
 * creates a Stripe customer — an account with none on file gets a plain 404.
 */
app.post("/portal", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json(fail("missing Authorization header"), 401);
  }

  const { STRIPE_SECRET_KEY, APP_ORIGIN } = c.env;
  if (!STRIPE_SECRET_KEY || !APP_ORIGIN) {
    return c.json(fail("billing not configured"), 500);
  }

  const supabase = createCallerClient(authHeader, c.env);
  const { data: accountIdRaw, error: contextError } =
    await supabase.rpc("current_context_id");
  const accountId = accountIdRaw as number | null;
  if (contextError || accountId == null) {
    return c.json(fail("no active context"), 403);
  }

  // Review fix (B5): same eligible-role contract as /checkout above.
  const eligibility = await isEligibleForBilling(supabase);
  if (!eligibility.eligible) {
    return c.json(fail(eligibility.message), 403);
  }

  const scoped = forAccount(String(accountId), c.env);
  const { data: existing } = (await scoped
    .from("subscription")
    .select("stripe_customer_id")
    .maybeSingle()) as { data: SubscriptionCustomerRow | null };
  const customerId = existing?.stripe_customer_id;
  if (!customerId) {
    return c.json(fail("no subscription"), 404);
  }

  const stripe = createStripeClient(STRIPE_SECRET_KEY);
  let session: Stripe.BillingPortal.Session;
  try {
    session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: appReturnUrl(APP_ORIGIN, "/billing"),
    });
  } catch {
    return c.json(fail("failed to create billing portal session"), 500);
  }

  return c.json(ok({ url: session.url }));
});

/**
 * AC-4/5/6/7/10: signature-verified, idempotent Stripe webhook. No CORS
 * (registered above only on /checkout and /portal) — this route is
 * server-to-server.
 */
app.post("/webhook", async (c) => {
  const requestId = crypto.randomUUID();
  const alerter = createErrorAlerter(c.env, "billing", "/webhook", requestId);

  const sig = c.req.header("stripe-signature");
  if (!sig) {
    return c.json(fail("missing stripe-signature header"), 400);
  }

  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = c.env;
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return c.json(fail("billing not configured"), 500);
  }

  // AC-4: the raw body, read BEFORE anything parses it — `c.req.json()` is
  // never called on this route. Parsing before verifying is the classic
  // signature-check bypass, and it would also destroy the exact bytes the
  // HMAC covers.
  const raw = await c.req.text();
  const stripe = createStripeClient(STRIPE_SECRET_KEY);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      raw,
      sig,
      STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    // Signature mismatch or a stale timestamp — NO database call of any
    // kind happens above this line.
    await alerter(error, "warning");
    return c.json(fail("invalid signature"), 400);
  }

  // Emit silence-detection heartbeat for Stripe webhook
  c.executionCtx.waitUntil(
    alertOnSilence(
      c.env,
      "stripe-webhook",
      60,
      new Date().toISOString(),
      "billing",
    ),
  );

  // Review fix (B1): mode is an ENFORCED invariant, checked before any
  // database call — never merely stored for later audit. A mismatched event
  // (a test-mode event delivered to a Worker configured with a live secret
  // key, or vice versa) can NEVER become valid on retry — the Worker's mode
  // is a static fact of its own configuration, not a transient condition —
  // so it is answered 200 (never 500) to stop Stripe from retrying it
  // forever, and recorded rather than silently dropped.
  const workerIsLive = isLiveStripeSecretKey(STRIPE_SECRET_KEY);
  if (event.livemode !== workerIsLive) {
    const claimed = await claimStripeEvent(
      { eventId: event.id, type: event.type, livemode: event.livemode },
      c.env,
    );
    if (claimed.outcome === "error") {
      await alerter(new Error("failed to record webhook event"), "critical");
      return c.json(fail("failed to record webhook event"), 500);
    }
    if (claimed.outcome !== "done") {
      const marked = await markStripeEventDone(event.id, null, c.env);
      if (!marked.ok) {
        await alerter(new Error("failed to record webhook event"), "critical");
        return c.json(fail("failed to record webhook event"), 500);
      }
    }
    console.error("billing.webhook.modeMismatch", {
      eventId: event.id,
      eventType: event.type,
      eventLivemode: event.livemode,
      workerIsLive,
    });
    return c.json(ok({ rejected: "mode_mismatch" }));
  }

  // Review fix (B2): claim the ledger row BEFORE resolving the account or
  // attempting any mutation — "received" (this delivery owns processing,
  // whether for the first time or because an earlier attempt never reached
  // a terminal state) and "done" (a genuinely completed delivery, safe to
  // dedupe forever) are now distinct, see resolveAccount.ts's own comment.
  // Only a "done" claim may short-circuit to `{deduped:true}` — a "claimed"
  // or "retry" outcome both continue processing exactly the same way below.
  const claimed = await claimStripeEvent(
    { eventId: event.id, type: event.type, livemode: event.livemode },
    c.env,
  );
  if (claimed.outcome === "error") {
    await alerter(new Error("failed to record webhook event"), "critical");
    return c.json(fail("failed to record webhook event"), 500);
  }
  if (claimed.outcome === "done") {
    return c.json(ok({ deduped: true }));
  }

  // checkout.session.completed and its two async siblings are the events
  // that carry client_reference_id — the account<->customer binding is
  // established HERE. Every other event resolves the account through the
  // customer id alone (resolveAccountForCustomer, AC-11's one named
  // carve-out).
  let accountId: number | null = null;
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.async_payment_failed"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    const parsed = session.client_reference_id
      ? Number(session.client_reference_id)
      : NaN;
    accountId = Number.isFinite(parsed) ? parsed : null;
  }
  if (accountId === null) {
    const eventObject = event.data.object as {
      customer?: string | { id: string } | null;
    };
    const customerId = stripeIdOf(eventObject.customer);
    if (customerId) {
      const resolution = await resolveAccountForCustomer(customerId, c.env);
      if (resolution.outcome === "error") {
        // Review fix (B3): an operational failure (a query/transport error),
        // not a business outcome — the ledger row stays at status
        // 'received' (never marked done), so a Stripe redelivery of this
        // SAME event id reprocesses from scratch instead of being told it
        // was already handled.
        await alerter(new Error(resolution.message), "critical");
        return c.json(fail("failed to resolve account"), 500);
      }
      accountId = resolution.outcome === "found" ? resolution.accountId : null;
    }
  }

  // An event for a customer this worker cannot resolve to any account (Task
  // 5: "record it in stripe_events with a null account_id and return 200; do
  // not guess") — a genuine, terminal "unknown customer" outcome, distinct
  // from the operational failure handled above (B3).
  if (accountId === null) {
    const marked = await markStripeEventDone(event.id, null, c.env);
    if (!marked.ok) {
      await alerter(new Error("failed to record webhook event"), "critical");
      return c.json(fail("failed to record webhook event"), 500);
    }
    return c.json(ok({ ignored: true }));
  }

  // Any type outside the ones this worker acts on: recorded above, answered
  // 200 — never 400, never 500 (an unhandled type returning non-2xx puts the
  // endpoint into Stripe's retry-and-disable loop).
  if (!isHandledStripeEventType(event.type)) {
    const marked = await markStripeEventDone(event.id, accountId, c.env);
    if (!marked.ok) {
      await alerter(new Error("failed to record webhook event"), "critical");
      return c.json(fail("failed to record webhook event"), 500);
    }
    return c.json(ok({ handled: false }));
  }

  const scoped = forAccount(String(accountId), c.env);

  const patch = applyEvent(event);
  if (!patch) {
    // Unreachable given the isHandledStripeEventType guard above — kept as
    // a fail-closed backstop rather than asserting/throwing into Stripe's
    // retry loop over a defect that would need a code fix either way.
    const marked = await markStripeEventDone(event.id, accountId, c.env);
    if (!marked.ok) {
      await alerter(new Error("failed to record webhook event"), "critical");
      return c.json(fail("failed to record webhook event"), 500);
    }
    return c.json(ok({ handled: false }));
  }

  // AC-5 ordering guard, applied atomically (review fix — see
  // applySubscriptionPatch()'s own comment for why the previous
  // select-then-upsert shape here left a real TOCTOU race between
  // concurrent deliveries, and for B8's same-second tie-break). A mutation
  // only ever applies when this event's `created` timestamp is >= the
  // account's own last-applied event; a genuinely older, out-of-order event
  // writes nothing.
  const eventCreatedAt = new Date(event.created * 1000);
  const applyResult = await applySubscriptionPatch(
    scoped,
    patch,
    eventCreatedAt,
  );
  if (applyResult.outcome === "error") {
    // Review fix (B2): the ledger row is deliberately left at status
    // 'received' here — NOT marked done — so a Stripe retry of this exact
    // event id reprocesses the mutation instead of being deduped past it.
    await alerter(new Error("failed to update subscription"), "critical");
    return c.json(fail("failed to update subscription"), 500);
  }

  // Both "applied" and "stale" are terminal successes of THIS event's own
  // processing — a stale event correctly wrote nothing because a newer one
  // already won the ordering guard, which is not a failure to retry.
  const marked = await markStripeEventDone(event.id, accountId, c.env);
  if (!marked.ok) {
    await alerter(new Error("failed to record webhook event"), "critical");
    return c.json(fail("failed to record webhook event"), 500);
  }

  if (applyResult.outcome === "stale") {
    return c.json(ok({ stale: true }));
  }
  return c.json(ok({ applied: true }));
});

export default app;
