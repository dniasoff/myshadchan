import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { ScopedClient } from "../shared/forAccount";
import {
  applyEvent,
  applySubscriptionPatch,
  HANDLED_STRIPE_EVENT_TYPES,
  isHandledStripeEventType,
  isLiveStripeSecretKey,
  mapStripeStatus,
  stripeIdOf,
  type SubscriptionPatch,
} from "./subscriptionState";

// Stripe's full documented Subscription.Status enum
// (node_modules/stripe/cjs/resources/Subscriptions.d.ts), plus one bogus
// value standing in for a future/unknown status Stripe might one day send.
const STRIPE_DOCUMENTED_STATUSES = [
  "active",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "paused",
  "trialing",
  "unpaid",
];

describe("mapStripeStatus", () => {
  const table: Record<string, { plan: string; status: string }> = {
    active: { plan: "ai", status: "active" },
    trialing: { plan: "ai", status: "active" },
    past_due: { plan: "ai", status: "lapsed" },
    unpaid: { plan: "ai", status: "lapsed" },
    canceled: { plan: "ai", status: "lapsed" },
    incomplete_expired: { plan: "ai", status: "lapsed" },
    paused: { plan: "ai", status: "lapsed" },
    incomplete: { plan: "free", status: "none" },
  };

  for (const status of STRIPE_DOCUMENTED_STATUSES) {
    it(`maps documented status "${status}" to its declared (plan, status)`, () => {
      // Arrange
      const expected = table[status];

      // Act
      const result = mapStripeStatus(status);

      // Assert
      expect(result).toEqual(expected);
    });
  }

  it("maps an unknown/future Stripe status to free/none — total over the enum, fail-closed on the unknown value", () => {
    // Arrange / Act
    const result = mapStripeStatus("some_future_stripe_status");

    // Assert
    expect(result).toEqual({ plan: "free", status: "none" });
  });

  it("never maps past_due to active — the AD-17 fail-closed ruling this table encodes", () => {
    // Arrange / Act
    const result = mapStripeStatus("past_due");

    // Assert
    expect(result.status).not.toBe("active");
    expect(result).toEqual({ plan: "ai", status: "lapsed" });
  });
});

describe("isHandledStripeEventType / HANDLED_STRIPE_EVENT_TYPES", () => {
  it("lists exactly the seven event types this worker acts on (B9 added the two async Checkout events)", () => {
    // Arrange / Act / Assert
    expect(HANDLED_STRIPE_EVENT_TYPES).toEqual([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.payment_failed",
    ]);
  });

  it("recognizes a handled type", () => {
    // Arrange / Act / Assert
    expect(isHandledStripeEventType("customer.subscription.updated")).toBe(
      true,
    );
  });

  it("rejects an unhandled type", () => {
    // Arrange / Act / Assert
    expect(isHandledStripeEventType("customer.created")).toBe(false);
  });
});

describe("stripeIdOf", () => {
  it("returns a string id unchanged", () => {
    expect(stripeIdOf("cus_1")).toBe("cus_1");
  });

  it("extracts .id from an expanded object", () => {
    expect(stripeIdOf({ id: "cus_2" })).toBe("cus_2");
  });

  it("returns null for null/undefined", () => {
    expect(stripeIdOf(null)).toBeNull();
    expect(stripeIdOf(undefined)).toBeNull();
  });
});

// B1: the Worker's own mode, derived from the key it is actually configured
// with — never a second, independently-set boolean that could itself drift.
describe("isLiveStripeSecretKey", () => {
  it("reports live for a live secret key", () => {
    expect(isLiveStripeSecretKey("sk_live_abc123")).toBe(true);
  });

  it("reports live for a live restricted key", () => {
    expect(isLiveStripeSecretKey("rk_live_abc123")).toBe(true);
  });

  it("reports NOT live for a test secret key", () => {
    expect(isLiveStripeSecretKey("sk_test_abc123")).toBe(false);
  });

  it("reports NOT live for a test restricted key", () => {
    expect(isLiveStripeSecretKey("rk_test_abc123")).toBe(false);
  });

  it("fails closed (not live) for a malformed/unrecognized key shape", () => {
    expect(isLiveStripeSecretKey("not-a-real-key")).toBe(false);
  });
});

function buildEvent(
  type: string,
  object: Record<string, unknown>,
  created = 1_700_000_000,
): Stripe.Event {
  return {
    id: "evt_test",
    object: "event",
    api_version: "2026-01-01",
    created,
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type,
    data: { object },
  } as unknown as Stripe.Event;
}

describe("applyEvent", () => {
  it("checkout.session.completed with payment_status 'paid' writes ai/active and binds customer + subscription, leaving price/period unset", () => {
    // Arrange
    const event = buildEvent("checkout.session.completed", {
      customer: "cus_1",
      subscription: "sub_1",
      client_reference_id: "1",
      payment_status: "paid",
    });

    // Act
    const patch = applyEvent(event);

    // Assert
    expect(patch).toEqual({
      plan: "ai",
      status: "active",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      last_stripe_event_at: new Date(1_700_000_000 * 1000).toISOString(),
    });
  });

  it("checkout.session.completed with payment_status 'no_payment_required' also writes ai/active", () => {
    // Arrange
    const event = buildEvent("checkout.session.completed", {
      customer: "cus_1",
      subscription: "sub_1",
      client_reference_id: "1",
      payment_status: "no_payment_required",
    });

    // Act
    const patch = applyEvent(event);

    // Assert
    expect(patch?.plan).toBe("ai");
    expect(patch?.status).toBe("active");
  });

  // B9: the finding's own reproduction. checkout.session.completed does NOT
  // imply payment succeeded for a delayed method (e.g. bank debit, this
  // story's own stated fee-driven preference) — `payment_status` reads
  // 'unpaid' at this point, and granting entitlement here would be exactly
  // the bug: paying without the payment having cleared.
  it("checkout.session.completed with payment_status 'unpaid' (a delayed payment method) does NOT grant entitlement, but still binds customer/subscription", () => {
    // Arrange
    const event = buildEvent("checkout.session.completed", {
      customer: "cus_1",
      subscription: "sub_1",
      client_reference_id: "1",
      payment_status: "unpaid",
    });

    // Act
    const patch = applyEvent(event);

    // Assert — plan/status OMITTED (never written), matching this file's
    // own "omit what is not yet known" convention elsewhere. Customer and
    // subscription ids ARE bound so resolveAccountForCustomer can find the
    // account for the async follow-up event regardless of delivery order.
    expect(patch).toEqual({
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      last_stripe_event_at: new Date(1_700_000_000 * 1000).toISOString(),
    });
    expect(patch).not.toHaveProperty("plan");
    expect(patch).not.toHaveProperty("status");
  });

  it("checkout.session.async_payment_succeeded grants ai/active once the delayed payment clears", () => {
    // Arrange
    const event = buildEvent("checkout.session.async_payment_succeeded", {
      customer: "cus_1",
      subscription: "sub_1",
      client_reference_id: "1",
    });

    // Act
    const patch = applyEvent(event);

    // Assert
    expect(patch).toEqual({
      plan: "ai",
      status: "active",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      last_stripe_event_at: new Date(1_700_000_000 * 1000).toISOString(),
    });
  });

  it("checkout.session.async_payment_failed resolves explicitly to free/none — never entitled", () => {
    // Arrange
    const event = buildEvent("checkout.session.async_payment_failed", {
      customer: "cus_1",
      subscription: "sub_1",
      client_reference_id: "1",
    });

    // Act
    const patch = applyEvent(event);

    // Assert
    expect(patch).toEqual({
      plan: "free",
      status: "none",
      stripe_customer_id: "cus_1",
      last_stripe_event_at: new Date(1_700_000_000 * 1000).toISOString(),
    });
  });

  it("customer.subscription.updated maps status, price and current_period_end from the first item", () => {
    // Arrange
    const event = buildEvent("customer.subscription.updated", {
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      items: {
        data: [
          {
            price: { id: "price_quarterly_123" },
            current_period_end: 1_700_100_000,
          },
        ],
      },
    });

    // Act
    const patch = applyEvent(event);

    // Assert
    expect(patch).toEqual({
      plan: "ai",
      status: "active",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: "sub_1",
      stripe_price_id: "price_quarterly_123",
      current_period_end: new Date(1_700_100_000 * 1000).toISOString(),
      last_stripe_event_at: new Date(1_700_000_000 * 1000).toISOString(),
    });
  });

  it("customer.subscription.updated with past_due pauses entitlement (ai/lapsed), never active", () => {
    // Arrange
    const event = buildEvent("customer.subscription.updated", {
      id: "sub_1",
      customer: "cus_1",
      status: "past_due",
      items: { data: [] },
    });

    // Act
    const patch = applyEvent(event);

    // Assert
    expect(patch?.plan).toBe("ai");
    expect(patch?.status).toBe("lapsed");
  });

  it("customer.subscription.deleted UPDATES to ai/lapsed and clears stripe_subscription_id — never a delete", () => {
    // Arrange
    const event = buildEvent("customer.subscription.deleted", {
      id: "sub_1",
      customer: "cus_1",
      status: "canceled",
    });

    // Act
    const patch = applyEvent(event);

    // Assert
    expect(patch).toEqual({
      plan: "ai",
      status: "lapsed",
      stripe_customer_id: "cus_1",
      stripe_subscription_id: null,
      last_stripe_event_at: new Date(1_700_000_000 * 1000).toISOString(),
    });
  });

  it("invoice.payment_failed pauses entitlement (ai/lapsed) without touching price or period", () => {
    // Arrange
    const event = buildEvent("invoice.payment_failed", { customer: "cus_1" });

    // Act
    const patch = applyEvent(event);

    // Assert
    expect(patch).toEqual({
      plan: "ai",
      status: "lapsed",
      stripe_customer_id: "cus_1",
      last_stripe_event_at: new Date(1_700_000_000 * 1000).toISOString(),
    });
    expect(patch).not.toHaveProperty("stripe_price_id");
    expect(patch).not.toHaveProperty("current_period_end");
  });

  it("returns null for an event type this worker does not act on", () => {
    // Arrange
    const event = buildEvent("customer.created", { id: "cus_1" });

    // Act
    const patch = applyEvent(event);

    // Assert
    expect(patch).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applySubscriptionPatch — review fix: the atomic replacement for the old
// select-then-upsert ordering guard. A minimal hand-written fake stands in
// for ScopedClient here (rather than mocking @supabase/supabase-js, as
// index.test.ts does) because every branch below is about the SEQUENCE and
// ARGUMENTS of update()/insert() calls, which a fake makes directly
// assertable without reconstructing PostgREST's chain shape from scratch.
// ---------------------------------------------------------------------------
describe("applySubscriptionPatch", () => {
  type UpdateOutcome = {
    data: unknown[] | null;
    error: { message: string; code?: string } | null;
  };
  type InsertOutcome = { error: { message: string; code?: string } | null };

  function buildScopedClient(config: {
    updateOutcomes: UpdateOutcome[];
    insertOutcomes?: InsertOutcome[];
  }) {
    const calls = {
      updates: [] as SubscriptionPatch[],
      updateFilters: [] as string[],
      inserts: [] as SubscriptionPatch[],
    };
    let updateIndex = 0;
    let insertIndex = 0;

    const fakeTable = {
      select: () => {
        throw new Error(
          "fake ScopedTable: select() is not used by applySubscriptionPatch",
        );
      },
      delete: () => {
        throw new Error(
          "fake ScopedTable: delete() is not used by applySubscriptionPatch",
        );
      },
      upsert: () => {
        throw new Error(
          "fake ScopedTable: upsert() is not used by applySubscriptionPatch",
        );
      },
      insert: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        calls.inserts.push(values as SubscriptionPatch);
        const outcome = config.insertOutcomes?.[insertIndex] ?? { error: null };
        insertIndex += 1;
        return Promise.resolve(outcome);
      },
      update: (values: Record<string, unknown>) => {
        calls.updates.push(values as SubscriptionPatch);
        return {
          or: (filter: string) => {
            calls.updateFilters.push(filter);
            return {
              select: () => {
                const outcome =
                  config.updateOutcomes[updateIndex] ??
                  config.updateOutcomes[config.updateOutcomes.length - 1];
                updateIndex += 1;
                return Promise.resolve(outcome);
              },
            };
          },
        };
      },
    };

    const scoped = {
      accountId: "1",
      from: vi.fn(() => fakeTable),
    } as unknown as ScopedClient;

    return { scoped, calls };
  }

  const patch: SubscriptionPatch = {
    plan: "ai",
    status: "active",
    last_stripe_event_at: "2026-08-06T00:00:00.000Z",
  };
  const eventCreatedAt = new Date("2026-08-06T00:00:00.000Z");

  it("applies the patch on the first conditional update when the existing row is stale-eligible", async () => {
    // Arrange
    const { scoped, calls } = buildScopedClient({
      updateOutcomes: [{ data: [{ account_id: 1 }], error: null }],
    });

    // Act
    const result = await applySubscriptionPatch(scoped, patch, eventCreatedAt);

    // Assert
    expect(result).toEqual({ outcome: "applied" });
    expect(calls.updates).toEqual([patch]);
    // B8: `.lte.`, not `.lt.` — an event whose timestamp EQUALS the stored
    // one must still be eligible to apply (see applySubscriptionPatch's own
    // comment for the same-second-collision reasoning this implements).
    expect(calls.updateFilters).toEqual([
      "last_stripe_event_at.is.null,last_stripe_event_at.lte.2026-08-06T00:00:00.000Z",
    ]);
    expect(calls.inserts).toEqual([]);
  });

  // B8's own reproduction: two DISTINCT Stripe events sharing the exact same
  // second-precision `created` timestamp (e.g. checkout.session.completed
  // and customer.subscription.created for the same checkout) must NOT have
  // whichever lands second discarded as "not newer." A strict `.lt.` guard
  // would report "stale" here; `.lte.` correctly reports "applied".
  it("B8: an event whose timestamp EQUALS the existing row's last_stripe_event_at is still applied, not rejected as stale", async () => {
    // Arrange — the existing row's last_stripe_event_at is already exactly
    // this event's own timestamp (a same-second sibling event committed
    // first).
    const { scoped, calls } = buildScopedClient({
      updateOutcomes: [{ data: [{ account_id: 1 }], error: null }],
    });

    // Act
    const result = await applySubscriptionPatch(scoped, patch, eventCreatedAt);

    // Assert
    expect(result).toEqual({ outcome: "applied" });
    expect(calls.updateFilters).toEqual([
      "last_stripe_event_at.is.null,last_stripe_event_at.lte.2026-08-06T00:00:00.000Z",
    ]);
  });

  // The other half of B8's constraint — a GENUINELY older event must still
  // be rejected under the widened `.lte.` boundary — is exactly what
  // "reports stale — and writes nothing further…" below already proves;
  // `.lte.` only widens the boundary to include equality, it never admits
  // anything `.lt.` would have excluded, so that existing test's assertion
  // is unchanged by this fix and is not duplicated here.

  it("creates the row via insert when no subscription row exists yet for the account", async () => {
    // Arrange — the conditional update matches nothing (no row to match).
    const { scoped, calls } = buildScopedClient({
      updateOutcomes: [{ data: [], error: null }],
      insertOutcomes: [{ error: null }],
    });

    // Act
    const result = await applySubscriptionPatch(scoped, patch, eventCreatedAt);

    // Assert
    expect(result).toEqual({ outcome: "applied" });
    expect(calls.updates).toHaveLength(1);
    expect(calls.inserts).toEqual([patch]);
  });

  it("retries the conditional update after losing an insert race, and applies when this event is the newer one", async () => {
    // Arrange — first update: no row yet (from this request's point of
    // view). Insert then hits the unique constraint because a concurrent
    // delivery just created the row. The retried update succeeds, meaning
    // THIS event's `created` is newer than whatever the concurrent writer
    // just committed.
    const { scoped, calls } = buildScopedClient({
      updateOutcomes: [
        { data: [], error: null },
        { data: [{ account_id: 1 }], error: null },
      ],
      insertOutcomes: [
        {
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "subscription_account_id_key"',
          },
        },
      ],
    });

    // Act
    const result = await applySubscriptionPatch(scoped, patch, eventCreatedAt);

    // Assert
    expect(result).toEqual({ outcome: "applied" });
    expect(calls.updates).toHaveLength(2);
    expect(calls.inserts).toHaveLength(1);
  });

  it("reports stale — and writes nothing further — when the retried update also matches no rows", async () => {
    // Arrange — same race as above, but this event turns out to be the
    // OLDER one: even after a row provably exists (the insert's 23505), the
    // retried conditional update still matches zero rows, because the row
    // already committed a strictly newer last_stripe_event_at.
    const { scoped, calls } = buildScopedClient({
      updateOutcomes: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      insertOutcomes: [
        { error: { code: "23505", message: "duplicate key value" } },
      ],
    });

    // Act
    const result = await applySubscriptionPatch(scoped, patch, eventCreatedAt);

    // Assert — AC-5's own failing condition otherwise: no row was mutated.
    expect(result).toEqual({ outcome: "stale" });
    expect(calls.updates).toHaveLength(2);
    expect(calls.inserts).toHaveLength(1);
  });

  it("propagates a database error from the first conditional update without ever attempting an insert", async () => {
    // Arrange
    const { scoped, calls } = buildScopedClient({
      updateOutcomes: [{ data: null, error: { message: "connection reset" } }],
    });

    // Act
    const result = await applySubscriptionPatch(scoped, patch, eventCreatedAt);

    // Assert
    expect(result).toEqual({ outcome: "error", message: "connection reset" });
    expect(calls.inserts).toEqual([]);
  });

  it("propagates a non-conflict database error from the insert attempt, without retrying the update", async () => {
    // Arrange — a real error (not 23505) from the insert must not be
    // swallowed or misread as \"a row exists, retry\".
    const { scoped, calls } = buildScopedClient({
      updateOutcomes: [{ data: [], error: null }],
      insertOutcomes: [
        { error: { code: "42501", message: "permission denied" } },
      ],
    });

    // Act
    const result = await applySubscriptionPatch(scoped, patch, eventCreatedAt);

    // Assert
    expect(result).toEqual({ outcome: "error", message: "permission denied" });
    expect(calls.updates).toHaveLength(1);
  });

  it("propagates a database error from the retried conditional update", async () => {
    // Arrange
    const { scoped } = buildScopedClient({
      updateOutcomes: [
        { data: [], error: null },
        { data: null, error: { message: "statement timeout" } },
      ],
      insertOutcomes: [
        { error: { code: "23505", message: "duplicate key value" } },
      ],
    });

    // Act
    const result = await applySubscriptionPatch(scoped, patch, eventCreatedAt);

    // Assert
    expect(result).toEqual({ outcome: "error", message: "statement timeout" });
  });
});
