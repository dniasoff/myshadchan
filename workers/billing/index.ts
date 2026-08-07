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
import { recordStripeEvent, resolveAccountForCustomer } from "./resolveAccount";
import {
  applyEvent,
  applySubscriptionPatch,
  isHandledStripeEventType,
  stripeIdOf,
} from "./subscriptionState";

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
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json(fail("missing Authorization header"), 401);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json(fail("invalid request body"), 400);
  }
  const bodyResult = CheckoutBodySchema.safeParse(rawBody);
  if (!bodyResult.success) {
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
    return c.json(fail("billing not configured"), 500);
  }

  const supabase = createCallerClient(authHeader, c.env);
  const { data: accountIdRaw, error: contextError } =
    await supabase.rpc("current_context_id");
  const accountId = accountIdRaw as number | null;
  if (contextError || accountId == null) {
    return c.json(fail("no active context"), 403);
  }

  // AC-8: never a second Stripe customer for the same account — reuse the
  // one already on file, if any.
  const scoped = forAccount(String(accountId), c.env);
  const { data: existing } = (await scoped
    .from("subscription")
    .select("stripe_customer_id")
    .maybeSingle()) as { data: SubscriptionCustomerRow | null };
  const existingCustomerId = existing?.stripe_customer_id ?? undefined;

  const stripe = createStripeClient(STRIPE_SECRET_KEY);
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(accountId),
      metadata: { account_id: String(accountId) },
      ...(existingCustomerId ? { customer: existingCustomerId } : {}),
      success_url: `${APP_ORIGIN}/billing?checkout=success`,
      cancel_url: `${APP_ORIGIN}/billing?checkout=cancelled`,
    });
  } catch {
    return c.json(fail("failed to create checkout session"), 500);
  }

  if (!session.url) {
    return c.json(fail("failed to create checkout session"), 500);
  }

  // This route writes NO entitlement (AC-8's own failing condition) — only
  // ever `stripe_customer_id`, and only when Stripe assigned a NEW one (a
  // brand-new Checkout Session for an account that had none on file yet).
  // `plan`/`status` are never present in this upsert payload.
  const newCustomerId = stripeIdOf(session.customer);
  if (newCustomerId && newCustomerId !== existingCustomerId) {
    await scoped
      .from("subscription")
      .upsert(
        { stripe_customer_id: newCustomerId },
        { onConflict: "account_id" },
      );
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
      return_url: `${APP_ORIGIN}/billing`,
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
  } catch {
    // Signature mismatch or a stale timestamp — NO database call of any
    // kind happens above this line.
    return c.json(fail("invalid signature"), 400);
  }

  // checkout.session.completed is the one event that carries
  // client_reference_id — the account<->customer binding is established
  // HERE. Every other event resolves the account through the customer id
  // alone (resolveAccountForCustomer, AC-11's one named carve-out).
  let accountId: number | null = null;
  if (event.type === "checkout.session.completed") {
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
      accountId = await resolveAccountForCustomer(customerId, c.env);
    }
  }

  // AC-5: insert-first idempotency guard. A duplicate delivery fails
  // unique_violation on event_id and is answered as a cheap no-op, never an
  // error — Stripe retries a non-2xx for up to 3 days.
  const recorded = await recordStripeEvent(
    {
      eventId: event.id,
      type: event.type,
      accountId,
      livemode: event.livemode,
    },
    c.env,
  );

  if (recorded.outcome === "error") {
    return c.json(fail("failed to record webhook event"), 500);
  }
  if (recorded.outcome === "duplicate") {
    return c.json(ok({ deduped: true }));
  }

  // An event for a customer this worker cannot resolve to any account (Task
  // 5: "record it in stripe_events with a null account_id and return 200; do
  // not guess") — recorded above, nothing left to do.
  if (accountId === null) {
    return c.json(ok({ ignored: true }));
  }

  // Any type outside the five this worker acts on: recorded above, answered
  // 200 — never 400, never 500 (an unhandled type returning non-2xx puts the
  // endpoint into Stripe's retry-and-disable loop).
  if (!isHandledStripeEventType(event.type)) {
    return c.json(ok({ handled: false }));
  }

  const scoped = forAccount(String(accountId), c.env);

  const patch = applyEvent(event);
  if (!patch) {
    // Unreachable given the isHandledStripeEventType guard above — kept as
    // a fail-closed backstop rather than asserting/throwing into Stripe's
    // retry loop over a defect that would need a code fix either way.
    return c.json(ok({ handled: false }));
  }

  // AC-5 ordering guard, applied atomically (review fix — see
  // applySubscriptionPatch()'s own comment for why the previous
  // select-then-upsert shape here left a real TOCTOU race between
  // concurrent deliveries). A mutation only ever applies when this event's
  // `created` timestamp is >= the account's own last-applied event; an
  // older, out-of-order or re-delivered event writes nothing.
  const eventCreatedAt = new Date(event.created * 1000);
  const applyResult = await applySubscriptionPatch(
    scoped,
    patch,
    eventCreatedAt,
  );
  if (applyResult.outcome === "error") {
    return c.json(fail("failed to update subscription"), 500);
  }
  if (applyResult.outcome === "stale") {
    return c.json(ok({ stale: true }));
  }

  return c.json(ok({ applied: true }));
});

export default app;
