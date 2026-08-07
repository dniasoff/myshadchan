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
// select-then-upsert — see that file's own comment for why. Default: the
// first conditional update always "succeeds" (a non-empty row is returned),
// so existing tests that don't care about the ordering guard's own
// insert/retry fallback never need to touch subscriptionInsert.
const subscriptionUpdateSelect = vi.fn();
const subscriptionUpdateOr = vi.fn(() => ({
  select: subscriptionUpdateSelect,
}));
const subscriptionUpdateEq = vi.fn(() => ({ or: subscriptionUpdateOr }));
const subscriptionUpdate = vi.fn(() => ({ eq: subscriptionUpdateEq }));
const subscriptionInsert = vi.fn();
const stripeEventsInsert = vi.fn();
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
    return { insert: stripeEventsInsert };
  }
  throw new Error(`billing/index.test.ts mock: unexpected table "${table}"`);
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from, rpc }),
}));

function resetSupabaseMocks() {
  subscriptionMaybeSingle
    .mockReset()
    .mockResolvedValue({ data: null, error: null });
  subscriptionUpsert.mockReset().mockResolvedValue({ data: null, error: null });
  subscriptionUpdate.mockClear();
  subscriptionUpdateEq.mockClear();
  subscriptionUpdateOr.mockClear();
  subscriptionUpdateSelect
    .mockReset()
    .mockResolvedValue({ data: [{ account_id: 1 }], error: null });
  subscriptionInsert.mockReset().mockResolvedValue({ error: null });
  stripeEventsInsert.mockReset().mockResolvedValue({ error: null });
  rpc.mockReset();
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
    expect(stripeEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: "evt_checkout_1", account_id: 1 }),
    );
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
        /^last_stripe_event_at\.is\.null,last_stripe_event_at\.lt\./,
      ),
    );
    expect(subscriptionInsert).not.toHaveBeenCalled();
    expect(subscriptionUpsert).not.toHaveBeenCalled();
  });

  it("replays the identical event id as a cheap no-op — 'deduped', without touching subscription", async () => {
    // Arrange — the insert-first idempotency guard reports a unique_violation.
    stripeEventsInsert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value" },
    });
    const event = buildEvent({
      id: "evt_checkout_1",
      type: "checkout.session.completed",
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
    expect(await res.json()).toEqual({
      success: true,
      data: { deduped: true },
      meta: undefined,
    });
    expect(subscriptionUpsert).not.toHaveBeenCalled();
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
    expect(stripeEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: null }),
    );
    expect(subscriptionUpsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /checkout
// ---------------------------------------------------------------------------
describe("POST /checkout", () => {
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
    const res = await app.request(
      "/checkout",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cadence: "monthly" }),
      },
      env,
    );

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
    const res = await app.request(
      "/checkout",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cadence: "quarterly" }),
      },
      unconfiguredEnv,
    );

    // Assert
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: "billing not configured",
    });
  });

  it("returns 403 when the caller has no active context", async () => {
    // Arrange
    rpc.mockResolvedValue({ data: null, error: null });

    // Act
    const res = await app.request(
      "/checkout",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cadence: "quarterly" }),
      },
      env,
    );

    // Assert
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: "no active context",
    });
  });

  it("creates a subscription-mode Checkout Session, writes no entitlement, and persists a NEW stripe_customer_id", async () => {
    // Arrange
    rpc.mockResolvedValue({ data: 1, error: null });
    subscriptionMaybeSingle.mockResolvedValueOnce({ data: null, error: null }); // no existing customer
    const fetchMock = stubStripeFetch({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/pay/cs_test_1",
      customer: "cus_new_1",
    });

    // Act
    const res = await app.request(
      "/checkout",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cadence: "quarterly" }),
      },
      env,
    );

    // Assert
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { url: "https://checkout.stripe.com/pay/cs_test_1" },
      meta: undefined,
    });
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = String(requestInit.body);
    expect(sentBody).toContain(encodeURIComponent("price_quarterly_123"));
    expect(sentBody).toContain(`client_reference_id=1`);
    // AC-8's own failing condition: never writes plan/status.
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

  it("reuses the account's existing Stripe customer — never creates a second one", async () => {
    // Arrange
    rpc.mockResolvedValue({ data: 1, error: null });
    subscriptionMaybeSingle.mockResolvedValueOnce({
      data: { stripe_customer_id: "cus_existing_1" },
      error: null,
    });
    const fetchMock = stubStripeFetch({
      id: "cs_test_2",
      url: "https://checkout.stripe.com/pay/cs_test_2",
      customer: "cus_existing_1",
    });

    // Act
    const res = await app.request(
      "/checkout",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cadence: "yearly" }),
      },
      env,
    );

    // Assert
    expect(res.status).toBe(200);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
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

  it("returns 404 'no subscription' — and never creates a customer — when the account has none on file", async () => {
    // Arrange
    rpc.mockResolvedValue({ data: 1, error: null });
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

  it("creates a Billing Portal session for the account's existing customer", async () => {
    // Arrange
    rpc.mockResolvedValue({ data: 1, error: null });
    subscriptionMaybeSingle.mockResolvedValueOnce({
      data: { stripe_customer_id: "cus_existing_1" },
      error: null,
    });
    stubStripeFetch({ url: "https://billing.stripe.com/session/test_1" });

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
  });
});
