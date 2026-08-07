import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "./index";

// ---------------------------------------------------------------------------
// Supabase mock — module-level, exactly as workers/shared/forAccount.test.ts
// and workers/ai/index.test.ts already do. `forAccount()`, `createCallerClient()`
// and resolveAccount.ts's own service client all resolve to this SAME mocked
// `createClient()`, keyed by table name so `subscription` and `stripe_events`
// each get their own controllable chain.
// ---------------------------------------------------------------------------
const subscriptionMaybeSingle = vi.fn();
const subscriptionEq = vi.fn(() => ({ maybeSingle: subscriptionMaybeSingle }));
const subscriptionSelect = vi.fn(() => ({ eq: subscriptionEq }));
const subscriptionUpsert = vi.fn();
// AC-5's ordering guard (applySubscriptionPatch, subscriptionState.ts) writes
// through this update().eq().or().select() chain instead of the old
// select-then-upsert — see that file's own comment. Default: the first
// conditional update always "succeeds" (a non-empty row is returned), so
// existing tests that don't care about the ordering guard's own
// insert/retry fallback never need to touch subscriptionInsert.
const subscriptionUpdateSelect = vi.fn();
const subscriptionUpdateOr = vi.fn(() => ({
  select: subscriptionUpdateSelect,
}));
const subscriptionUpdateEq = vi.fn(() => ({ or: subscriptionUpdateOr }));
const subscriptionUpdate = vi.fn((_values: Record<string, unknown>) => ({
  eq: subscriptionUpdateEq,
}));
const subscriptionInsert = vi.fn();

// stripe_events: `insert` is claimStripeEvent()'s claim attempt;
// `select().eq().maybeSingle()` is its post-conflict status re-read;
// `update().eq()` is markStripeEventDone() (resolveAccount.ts).
const stripeEventsInsert = vi.fn();
const stripeEventsMaybeSingle = vi.fn();
const stripeEventsEq = vi.fn(() => ({ maybeSingle: stripeEventsMaybeSingle }));
const stripeEventsSelect = vi.fn(() => ({ eq: stripeEventsEq }));
const stripeEventsUpdateEq = vi.fn();
const stripeEventsUpdate = vi.fn(() => ({ eq: stripeEventsUpdateEq }));

const rpc = vi.fn();

const from = vi.fn((table: string) => {
  if (table === "subscription") {
    return {
      select: subscriptionSelect,
      upsert: subscriptionUpsert,
      update: subscriptionUpdate,
      insert: subscriptionInsert,
    };
  }
  if (table === "stripe_events") {
    return {
      insert: stripeEventsInsert,
      select: stripeEventsSelect,
      update: stripeEventsUpdate,
    };
  }
  throw new Error(`billing/index.test.ts mock: unexpected table "${table}"`);
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from, rpc }),
}));

/** `current_context_id` and `current_member_role` are both plain RPCs on the
 * SAME mocked client — a blanket `rpc.mockResolvedValue()` can no longer
 * express "context ok, role X" independently, so every test drives this one
 * helper instead. Defaults: account id 1, a role billing is eligible for. */
function mockRpcResponses(
  overrides: {
    context?: unknown;
    contextError?: unknown;
    role?: unknown;
    roleError?: unknown;
  } = {},
) {
  // `??` cannot express "explicitly null" vs "not provided" (both are
  // nullish) — `context: null` (the "no active context" case) must NOT fall
  // back to the default account id, so every field is read with an explicit
  // `in` check instead.
  const context = "context" in overrides ? overrides.context : 1;
  const contextError =
    "contextError" in overrides ? overrides.contextError : null;
  const role = "role" in overrides ? overrides.role : "parent_admin";
  const roleError = "roleError" in overrides ? overrides.roleError : null;

  rpc.mockImplementation((name: string) => {
    if (name === "current_context_id") {
      return Promise.resolve({ data: context, error: contextError });
    }
    if (name === "current_member_role") {
      return Promise.resolve({ data: role, error: roleError });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

function resetSupabaseMocks() {
  subscriptionMaybeSingle
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  subscriptionEq.mockClear();
  subscriptionSelect.mockClear();
  subscriptionUpsert.mockReset().mockResolvedValue({ data: null, error: null });
  subscriptionUpdate.mockClear();
  subscriptionUpdateEq.mockClear();
  subscriptionUpdateOr.mockClear();
  subscriptionUpdateSelect
    .mockReset()
    .mockResolvedValue({ data: [{ account_id: 1 }], error: null });
  subscriptionInsert.mockReset().mockResolvedValue({ error: null });
  stripeEventsInsert.mockReset().mockResolvedValue({ error: null });
  stripeEventsSelect.mockClear();
  stripeEventsEq.mockClear();
  stripeEventsMaybeSingle.mockReset();
  stripeEventsUpdate.mockClear();
  stripeEventsUpdateEq.mockReset().mockResolvedValue({ error: null });
  rpc.mockReset();
  mockRpcResponses();
  from.mockClear();
}

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  STRIPE_SECRET_KEY: "sk_test_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_test_dummy",
  STRIPE_PRICE_ID_QUARTERLY: "price_quarterly_123",
  STRIPE_PRICE_ID_YEARLY: "price_yearly_123",
  APP_ORIGIN: "https://example.test",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("billing worker", () => {
  it("responds to GET /health", async () => {
    // Arrange / Act
    const res = await app.request("/health");

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { worker: "billing", status: "ok" },
    });
  });

  it("rejects a webhook POST with no stripe-signature header", async () => {
    // Arrange / Act
    const res = await app.request("/webhook", { method: "POST" });

    // Assert
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "missing stripe-signature header",
    });
  });
});

// ---------------------------------------------------------------------------
// POST /webhook
// ---------------------------------------------------------------------------
describe("POST /webhook", () => {
  const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;

  function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  function buildEvent(input: {
    id: string;
    type: string;
    created?: number;
    livemode?: boolean;
    object: Record<string, unknown>;
  }) {
    return {
      id: input.id,
      object: "event",
      api_version: "2026-01-01",
      created: input.created ?? nowSeconds(),
      livemode: input.livemode ?? false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: input.type,
      data: { object: input.object },
    };
  }

  function sign(eventObj: unknown, options?: { timestamp?: number }) {
    const payload = JSON.stringify(eventObj);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
      timestamp: options?.timestamp,
    });
    return { payload, signature };
  }

  function postWebhook(payload: string, signature: string, overrideEnv = env) {
    return app.request(
      "/webhook",
      {
        method: "POST",
        headers: { "stripe-signature": signature },
        body: payload,
      },
      overrideEnv,
    );
  }

  afterEach(() => {
    resetSupabaseMocks();
  });

  it("responds 500 'billing not configured' when STRIPE_WEBHOOK_SECRET is unset — no code path skips verification", async () => {
    // Arrange
    const unconfiguredEnv = { ...env, STRIPE_WEBHOOK_SECRET: undefined };

    // Act
    const res = await app.request(
      "/webhook",
      { method: "POST", headers: { "stripe-signature": "t=1,v1=abc" } },
      unconfiguredEnv,
    );

    // Assert
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: "billing not configured",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a tampered body with 400 'invalid signature' and makes NO database call", async () => {
    // Arrange — sign one payload, send a DIFFERENT one under the same header.
    const event = buildEvent({
      id: "evt_tampered",
      type: "checkout.session.completed",
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: "1",
        payment_status: "paid",
      },
    });
    const { signature } = sign(event);
    const tamperedPayload = JSON.stringify({
      ...event,
      id: "evt_a_different_event",
    });

    // Act
    const res = await postWebhook(tamperedPayload, signature);

    // Assert
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "invalid signature",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp with 400 'invalid signature' and makes NO database call", async () => {
    // Arrange — signed correctly, but well outside Stripe's default 300s tolerance.
    const event = buildEvent({
      id: "evt_stale",
      type: "checkout.session.completed",
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: "1",
        payment_status: "paid",
      },
    });
    const { payload, signature } = sign(event, {
      timestamp: nowSeconds() - 1000,
    });

    // Act
    const res = await postWebhook(payload, signature);

    // Assert
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "invalid signature",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("binds customer + subscription and writes ai/active for a valid checkout.session.completed", async () => {
    // Arrange
    const event = buildEvent({
      id: "evt_checkout_1",
      type: "checkout.session.completed",
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: "1",
        payment_status: "paid",
      },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { applied: true },
      meta: undefined,
    });
    // B2: the claim insert happens BEFORE account resolution and carries no
    // account_id — only status='received'. account_id is written later, by
    // the markStripeEventDone() UPDATE once processing actually finishes.
    expect(stripeEventsInsert).toHaveBeenCalledWith({
      event_id: "evt_checkout_1",
      type: "checkout.session.completed",
      livemode: false,
      status: "received",
    });
    expect(stripeEventsUpdate).toHaveBeenCalledWith({
      status: "done",
      account_id: 1,
    });
    // AC-5's ordering guard (applySubscriptionPatch) writes through the
    // atomic conditional update, not the old plain upsert — see that
    // function's own comment. The default mock (resetSupabaseMocks) reports
    // a matching row on the first attempt, so no insert is ever needed here.
    expect(subscriptionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "ai",
        status: "active",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
      }),
    );
    expect(subscriptionUpdateOr).toHaveBeenCalledWith(
      expect.stringMatching(
        /^last_stripe_event_at\.is\.null,last_stripe_event_at\.lte\./,
      ),
    );
    expect(subscriptionInsert).not.toHaveBeenCalled();
    expect(subscriptionUpsert).not.toHaveBeenCalled();
  });

  // B9's own reproduction: a delayed payment method (e.g. bank debit)
  // reports payment_status 'unpaid' on checkout.session.completed — this
  // must NOT grant entitlement.
  it("checkout.session.completed with an unpaid (delayed) payment_status binds the customer but writes no entitlement", async () => {
    // Arrange
    const event = buildEvent({
      id: "evt_checkout_delayed",
      type: "checkout.session.completed",
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: "1",
        payment_status: "unpaid",
      },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { applied: true },
      meta: undefined,
    });
    const patchArg = subscriptionUpdate.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(patchArg).not.toHaveProperty("plan");
    expect(patchArg).not.toHaveProperty("status");
    expect(patchArg.stripe_customer_id).toBe("cus_1");
  });

  it("checkout.session.async_payment_succeeded grants ai/active once the delayed payment clears", async () => {
    // Arrange
    const event = buildEvent({
      id: "evt_async_succeeded",
      type: "checkout.session.async_payment_succeeded",
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: "1",
      },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature);

    // Assert
    expect(res.status).toBe(200);
    expect(subscriptionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "ai", status: "active" }),
    );
  });

  it("checkout.session.async_payment_failed resolves to free/none — never entitled", async () => {
    // Arrange
    const event = buildEvent({
      id: "evt_async_failed",
      type: "checkout.session.async_payment_failed",
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: "1",
      },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature);

    // Assert
    expect(res.status).toBe(200);
    expect(subscriptionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "free", status: "none" }),
    );
  });

  // -------------------------------------------------------------------------
  // B1: livemode enforcement
  // -------------------------------------------------------------------------
  it("B1: rejects a LIVE event delivered to a Worker configured with a TEST secret key, recorded and answered 200 (never retried)", async () => {
    // Arrange — env.STRIPE_SECRET_KEY is sk_test_…; the event claims livemode.
    const event = buildEvent({
      id: "evt_live_on_test_worker",
      type: "checkout.session.completed",
      livemode: true,
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: "1",
        payment_status: "paid",
      },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { rejected: "mode_mismatch" },
      meta: undefined,
    });
    // Recorded (never silently dropped)...
    expect(stripeEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: "evt_live_on_test_worker" }),
    );
    expect(stripeEventsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done" }),
    );
    // ...but NEVER mutated — this is the live-risk finding: a mismatched
    // event must never reach the subscription table at all.
    expect(subscriptionUpdate).not.toHaveBeenCalled();
    expect(subscriptionUpsert).not.toHaveBeenCalled();
    expect(subscriptionInsert).not.toHaveBeenCalled();
  });

  it("B1: rejects a TEST event delivered to a Worker configured with a LIVE secret key", async () => {
    // Arrange
    const liveEnv = { ...env, STRIPE_SECRET_KEY: "sk_live_dummy" };
    const event = buildEvent({
      id: "evt_test_on_live_worker",
      type: "checkout.session.completed",
      livemode: false,
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: "1",
        payment_status: "paid",
      },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature, liveEnv);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { rejected: "mode_mismatch" },
      meta: undefined,
    });
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // B2: the ledger's 'received' vs 'done' split
  // -------------------------------------------------------------------------
  it("B2: leaves the ledger row at status='received' (never marks done) when the subscription mutation fails — the retry must reprocess, not dedupe", async () => {
    // Arrange — the ordering guard's conditional update itself errors.
    subscriptionUpdateSelect.mockReset().mockResolvedValueOnce({
      data: null,
      error: { message: "statement timeout" },
    });
    const event = buildEvent({
      id: "evt_mutation_fails",
      type: "checkout.session.completed",
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: "1",
        payment_status: "paid",
      },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature);

    // Assert — 500, correctly asking Stripe to retry...
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: "failed to update subscription",
    });
    // ...and the ledger was claimed but NEVER marked done.
    expect(stripeEventsInsert).toHaveBeenCalled();
    expect(stripeEventsUpdate).not.toHaveBeenCalled();
  });

  it("B2: a redelivery of an event whose earlier attempt never finished ('received') reprocesses instead of being deduped", async () => {
    // Arrange — the claim insert conflicts (Stripe already delivered this
    // event id once), and the existing row is still at status='received'
    // (the earlier attempt never reached markStripeEventDone).
    stripeEventsInsert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value" },
    });
    stripeEventsMaybeSingle.mockResolvedValueOnce({
      data: { status: "received" },
      error: null,
    });
    const event = buildEvent({
      id: "evt_retry_received",
      type: "checkout.session.completed",
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: "1",
        payment_status: "paid",
      },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature);

    // Assert — reprocessed to completion, exactly like a first delivery.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { applied: true },
      meta: undefined,
    });
    expect(subscriptionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "ai", status: "active" }),
    );
    expect(stripeEventsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done" }),
    );
  });

  // -------------------------------------------------------------------------
  // B3: resolution error stays retryable, distinct from "unknown customer"
  // -------------------------------------------------------------------------
  it("B3: an account-resolution query error returns 500 (retryable) and never marks the ledger row done", async () => {
    // Arrange — resolveAccountForCustomer's own subscription.select().maybeSingle()
    // call fails transiently (not merely "no row").
    subscriptionMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "connection reset" },
    });
    const event = buildEvent({
      id: "evt_resolve_error",
      type: "invoice.payment_failed",
      object: { customer: "cus_transient_error" },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature);

    // Assert
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: "failed to resolve account",
    });
    expect(stripeEventsInsert).toHaveBeenCalled();
    expect(stripeEventsUpdate).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });

  it("updates a lapse to plan=ai/status=lapsed and clears stripe_subscription_id on customer.subscription.deleted — the row is UPDATED, never deleted", async () => {
    // Arrange — resolveAccountForCustomer's own subscription.select().maybeSingle()
    // call is the customer -> account lookup. The ordering guard's own
    // conditional update falls through to resetSupabaseMocks()'s default (a
    // matching row on the first attempt, so not stale and no insert needed).
    subscriptionMaybeSingle.mockResolvedValueOnce({
      data: { account_id: 1 },
      error: null,
    });
    const event = buildEvent({
      id: "evt_deleted_1",
      type: "customer.subscription.deleted",
      object: { id: "sub_1", customer: "cus_1", status: "canceled" },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { applied: true },
      meta: undefined,
    });
    expect(subscriptionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "ai",
        status: "lapsed",
        stripe_subscription_id: null,
      }),
    );
    expect(subscriptionUpsert).not.toHaveBeenCalled();
  });

  it("returns 'stale' and writes nothing for an older event delivered after a newer one already applied", async () => {
    // Arrange — first select: resolveAccountForCustomer's customer -> account
    // lookup. The ordering guard's conditional update matches no row on
    // BOTH its first attempt and its post-insert-conflict retry — the
    // insert in between fails with 23505, proving a row already exists,
    // committed with a last_stripe_event_at at least as new as this event's.
    subscriptionMaybeSingle.mockResolvedValueOnce({
      data: { account_id: 1 },
      error: null,
    });
    subscriptionUpdateSelect
      .mockReset()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    subscriptionInsert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value" },
    });
    const event = buildEvent({
      id: "evt_updated_stale",
      type: "customer.subscription.updated",
      created: nowSeconds(),
      object: {
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        items: { data: [] },
      },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { stale: true },
      meta: undefined,
    });
    expect(subscriptionUpdate).toHaveBeenCalledTimes(2);
    expect(subscriptionInsert).toHaveBeenCalledTimes(1);
    expect(subscriptionUpsert).not.toHaveBeenCalled();
    // A stale outcome is still a TERMINAL success of processing this event
    // — the ledger row is marked done, not left at 'received'.
    expect(stripeEventsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done", account_id: 1 }),
    );
  });

  it("records and answers 200 for an event type this worker does not act on", async () => {
    // Arrange — a resolvable customer/account, so this test isolates the
    // "unhandled type" branch from the separate "unresolved account" branch
    // covered below.
    subscriptionMaybeSingle.mockResolvedValueOnce({
      data: { account_id: 1 },
      error: null,
    });
    const event = buildEvent({
      id: "evt_unhandled",
      type: "customer.created",
      object: { id: "cus_1", customer: "cus_1" },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { handled: false },
      meta: undefined,
    });
    expect(stripeEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ type: "customer.created" }),
    );
    expect(stripeEventsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done", account_id: 1 }),
    );
    expect(subscriptionUpsert).not.toHaveBeenCalled();
  });

  it("records an event for an unresolvable customer with a null account_id and answers 'ignored' — never guesses", async () => {
    // Arrange — no client_reference_id (not a checkout event), and the
    // customer lookup finds no matching account (resolveAccountForCustomer's
    // own subscription.select().maybeSingle() call).
    subscriptionMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const event = buildEvent({
      id: "evt_unknown_customer",
      type: "invoice.payment_failed",
      object: { customer: "cus_unknown" },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { ignored: true },
      meta: undefined,
    });
    expect(stripeEventsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done", account_id: null }),
    );
    expect(subscriptionUpsert).not.toHaveBeenCalled();
  });

  it("replays the identical event id as a cheap no-op — 'deduped', without touching subscription — once the earlier delivery reached status='done'", async () => {
    // Arrange — the insert-first idempotency guard reports a unique_violation,
    // and the existing row is already fully processed.
    stripeEventsInsert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value" },
    });
    stripeEventsMaybeSingle.mockResolvedValueOnce({
      data: { status: "done" },
      error: null,
    });
    const event = buildEvent({
      id: "evt_checkout_1",
      type: "checkout.session.completed",
      object: {
        customer: "cus_1",
        subscription: "sub_1",
        client_reference_id: "1",
        payment_status: "paid",
      },
    });
    const { payload, signature } = sign(event);

    // Act
    const res = await postWebhook(payload, signature);

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { deduped: true },
      meta: undefined,
    });
    expect(subscriptionUpsert).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /checkout
// ---------------------------------------------------------------------------
describe("POST /checkout", () => {
  afterEach(() => {
    resetSupabaseMocks();
  });

  /** Queues one Stripe HTTP response per call, in order — B4's fix makes
   * `/checkout` issue TWO Stripe requests (`customers.create` then
   * `checkout.sessions.create`) whenever no customer is on file yet, where
   * it used to issue only one. */
  function stubStripeFetch(
    responses: Array<{ body: unknown; status?: number }>,
  ) {
    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      const response = responses[Math.min(callIndex, responses.length - 1)];
      callIndex += 1;
      return new Response(JSON.stringify(response.body), {
        status: response.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function postCheckout(body: unknown, overrideEnv: Partial<typeof env> = env) {
    return app.request(
      "/checkout",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      overrideEnv,
    );
  }

  it("returns 401 when the Authorization header is missing", async () => {
    // Arrange / Act
    const res = await app.request(
      "/checkout",
      { method: "POST", body: JSON.stringify({ cadence: "quarterly" }) },
      env,
    );

    // Assert
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "missing Authorization header",
    });
  });

  it("returns 400 for a 'monthly' cadence — there is no monthly cadence", async () => {
    // Arrange / Act
    const res = await postCheckout({ cadence: "monthly" });

    // Assert
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "invalid request body",
    });
  });

  it("returns 500 'billing not configured' when a required price id is missing", async () => {
    // Arrange
    const unconfiguredEnv = { ...env, STRIPE_PRICE_ID_QUARTERLY: undefined };

    // Act
    const res = await postCheckout({ cadence: "quarterly" }, unconfiguredEnv);

    // Assert
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: "billing not configured",
    });
  });

  it("returns 403 when the caller has no active context", async () => {
    // Arrange
    mockRpcResponses({ context: null });

    // Act
    const res = await postCheckout({ cadence: "quarterly" });

    // Assert
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: "no active context",
    });
  });

  // B5: same eligible-role contract subscription/ai_usage RLS enforces.
  it("returns 403 when the caller's active role is 'single' — the entitlement read would never see the row either", async () => {
    // Arrange
    mockRpcResponses({ role: "single" });

    // Act
    const res = await postCheckout({ cadence: "quarterly" });

    // Assert
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: "billing is not available for this role",
    });
    expect(subscriptionSelect).not.toHaveBeenCalled();
  });

  it("refuses (403, same as an ineligible role) rather than proceeding when the role RPC itself errors", async () => {
    // Arrange — mirrors this route's existing convention for
    // `current_context_id`: an RPC error and a genuine "no active context"
    // both fold onto the SAME 403, never silently falling through to
    // "assume eligible."
    mockRpcResponses({ roleError: { message: "connection reset" } });

    // Act
    const res = await postCheckout({ cadence: "quarterly" });

    // Assert
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: "failed to resolve role",
    });
  });

  // B4: the initial subscription lookup's error must not be discarded.
  it("returns 500 when the initial subscription lookup errors, rather than silently falling through to 'create a new customer'", async () => {
    // Arrange
    subscriptionMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "connection reset" },
    });

    // Act
    const res = await postCheckout({ cadence: "quarterly" });

    // Assert
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: "failed to look up subscription",
    });
  });

  it("creates a subscription-mode Checkout Session via an explicit, idempotency-keyed customer.create — writes no entitlement, and persists the NEW stripe_customer_id", async () => {
    // Arrange
    subscriptionMaybeSingle.mockResolvedValueOnce({ data: null, error: null }); // no existing customer
    const fetchMock = stubStripeFetch([
      { body: { id: "cus_new_1", object: "customer" } },
      {
        body: {
          id: "cs_test_1",
          url: "https://checkout.stripe.com/pay/cs_test_1",
          customer: "cus_new_1",
        },
      },
    ]);

    // Act
    const res = await postCheckout({ cadence: "quarterly" });

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { url: "https://checkout.stripe.com/pay/cs_test_1" },
      meta: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // B4: the customer.create call carries a DETERMINISTIC idempotency key
    // derived from accountId alone — the mechanism that lets two concurrent
    // callers for the SAME account converge on ONE Stripe customer.
    const [customerCreateUrl, customerCreateInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(String(customerCreateUrl)).toContain("/v1/customers");
    // Stripe's fetch client sends headers as an array of [key, value]
    // tuples (`FetchHttpClient.makeRequest`), not a plain object.
    const customerCreateHeaders = customerCreateInit.headers as Array<
      [string, string]
    >;
    const idempotencyKeyHeader = customerCreateHeaders.find(
      ([key]) => key === "Idempotency-Key",
    );
    expect(idempotencyKeyHeader?.[1]).toBe("billing-customer-account-1");

    // The checkout.sessions.create call references that customer explicitly
    // (never omitted — B4 removes Stripe's own implicit auto-creation) and
    // returns via the app's HashRouter (B6).
    const [, sessionCreateInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    const sentBody = String(sessionCreateInit.body);
    expect(sentBody).toContain(encodeURIComponent("price_quarterly_123"));
    expect(sentBody).toContain(`client_reference_id=1`);
    expect(sentBody).toContain(`customer=${encodeURIComponent("cus_new_1")}`);
    expect(sentBody).toContain(
      encodeURIComponent("https://example.test/#/billing?checkout=success"),
    );
    expect(sentBody).toContain(
      encodeURIComponent("https://example.test/#/billing?checkout=cancelled"),
    );

    // AC-8's own failing condition: never writes plan/status. Persisted
    // BEFORE the checkout session is created (a failed session-create still
    // leaves the customer usably on file for next time).
    expect(subscriptionUpsert).toHaveBeenCalledWith(
      [{ stripe_customer_id: "cus_new_1", account_id: "1" }],
      { onConflict: "account_id" },
    );
    const upsertPayload = (
      subscriptionUpsert.mock.calls[0][0] as Record<string, unknown>[]
    )[0];
    expect(upsertPayload).not.toHaveProperty("plan");
    expect(upsertPayload).not.toHaveProperty("status");
  });

  // B4: the upsert's error must not be discarded either.
  it("returns 500 when persisting the newly created customer id fails, rather than returning a Checkout URL for an unrecorded customer", async () => {
    // Arrange
    subscriptionMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    subscriptionUpsert.mockResolvedValueOnce({
      data: null,
      error: { message: "connection reset" },
    });
    stubStripeFetch([{ body: { id: "cus_new_1", object: "customer" } }]);

    // Act
    const res = await postCheckout({ cadence: "quarterly" });

    // Assert
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: "failed to persist stripe customer",
    });
  });

  it("returns 500 when Stripe customer creation itself fails", async () => {
    // Arrange
    subscriptionMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    stubStripeFetch([{ body: { error: { message: "boom" } }, status: 500 }]);

    // Act
    const res = await postCheckout({ cadence: "quarterly" });

    // Assert
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: "failed to create customer",
    });
    expect(subscriptionUpsert).not.toHaveBeenCalled();
  });

  it("reuses the account's existing Stripe customer — never creates a second one, never calls customers.create", async () => {
    // Arrange
    subscriptionMaybeSingle.mockResolvedValueOnce({
      data: { stripe_customer_id: "cus_existing_1" },
      error: null,
    });
    const fetchMock = stubStripeFetch([
      {
        body: {
          id: "cs_test_2",
          url: "https://checkout.stripe.com/pay/cs_test_2",
          customer: "cus_existing_1",
        },
      },
    ]);

    // Act
    const res = await postCheckout({ cadence: "yearly" });

    // Assert
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/v1/checkout/sessions");
    const sentBody = String(requestInit.body);
    expect(sentBody).toContain(
      `customer=${encodeURIComponent("cus_existing_1")}`,
    );
    // Same customer came back — nothing new to persist.
    expect(subscriptionUpsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /portal
// ---------------------------------------------------------------------------
describe("POST /portal", () => {
  afterEach(() => {
    resetSupabaseMocks();
  });

  function stubStripeFetch(responseBody: unknown, status = 200) {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify(responseBody), {
          status,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("returns 401 when the Authorization header is missing", async () => {
    // Arrange / Act
    const res = await app.request("/portal", { method: "POST" }, env);

    // Assert
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "missing Authorization header",
    });
  });

  // B5: same eligible-role contract as /checkout.
  it("returns 403 when the caller's active role is 'single'", async () => {
    // Arrange
    mockRpcResponses({ role: "single" });

    // Act
    const res = await app.request(
      "/portal",
      { method: "POST", headers: { Authorization: "Bearer token" } },
      env,
    );

    // Assert
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: "billing is not available for this role",
    });
  });

  it("returns 404 'no subscription' — and never creates a customer — when the account has none on file", async () => {
    // Arrange
    subscriptionMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    // Act
    const res = await app.request(
      "/portal",
      { method: "POST", headers: { Authorization: "Bearer token" } },
      env,
    );

    // Assert
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      success: false,
      error: "no subscription",
    });
  });

  it("creates a Billing Portal session for the account's existing customer, with a HashRouter return_url (B6)", async () => {
    // Arrange
    subscriptionMaybeSingle.mockResolvedValueOnce({
      data: { stripe_customer_id: "cus_existing_1" },
      error: null,
    });
    const fetchMock = stubStripeFetch({
      url: "https://billing.stripe.com/session/test_1",
    });

    // Act
    const res = await app.request(
      "/portal",
      { method: "POST", headers: { Authorization: "Bearer token" } },
      env,
    );

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { url: "https://billing.stripe.com/session/test_1" },
      meta: undefined,
    });
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = String(requestInit.body);
    expect(sentBody).toContain(
      encodeURIComponent("https://example.test/#/billing"),
    );
  });
});
