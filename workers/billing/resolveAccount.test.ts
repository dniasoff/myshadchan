import { describe, expect, it, vi } from "vitest";
import {
  claimStripeEvent,
  markStripeEventDone,
  resolveAccountForCustomer,
} from "./resolveAccount";

const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const insert = vi.fn();
const updateEq = vi.fn();
const update = vi.fn(() => ({ eq: updateEq }));
const from = vi.fn((table: string) =>
  table === "subscription" ? { select } : { insert, select, update },
);

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from }),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
};

describe("resolveAccountForCustomer", () => {
  it("returns 'found' with the account id for a known Stripe customer", async () => {
    // Arrange
    maybeSingle.mockResolvedValueOnce({
      data: { account_id: 42 },
      error: null,
    });

    // Act
    const result = await resolveAccountForCustomer("cus_known", env);

    // Assert
    expect(result).toEqual({ outcome: "found", accountId: 42 });
    expect(from).toHaveBeenCalledWith("subscription");
    expect(select).toHaveBeenCalledWith("account_id");
    expect(eq).toHaveBeenCalledWith("stripe_customer_id", "cus_known");
  });

  it("returns 'not_found' — a legitimate, terminal business outcome — for an unknown Stripe customer", async () => {
    // Arrange
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    // Act
    const result = await resolveAccountForCustomer("cus_unknown", env);

    // Assert
    expect(result).toEqual({ outcome: "not_found" });
  });

  // B3: this is the review fix's own reproduction. The pre-fix
  // implementation collapsed this case onto the SAME `null` return as
  // "not_found" above — a caller could not tell an operational failure
  // (must stay retryable) from a business outcome (safe to dedupe forever).
  it("returns 'error' — never conflated with 'not_found' — when the query itself fails", async () => {
    // Arrange
    maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "connection reset" },
    });

    // Act
    const result = await resolveAccountForCustomer("cus_error", env);

    // Assert
    expect(result).toEqual({ outcome: "error", message: "connection reset" });
    expect(result).not.toEqual({ outcome: "not_found" });
  });
});

describe("claimStripeEvent", () => {
  it("reports 'claimed' and inserts at status='received' on a clean insert", async () => {
    // Arrange
    insert.mockResolvedValueOnce({ error: null });

    // Act
    const result = await claimStripeEvent(
      { eventId: "evt_1", type: "checkout.session.completed", livemode: false },
      env,
    );

    // Assert
    expect(result).toEqual({ outcome: "claimed" });
    expect(insert).toHaveBeenCalledWith({
      event_id: "evt_1",
      type: "checkout.session.completed",
      livemode: false,
      status: "received",
    });
  });

  it("reports 'error' for a non-conflict insert failure", async () => {
    // Arrange
    insert.mockResolvedValueOnce({
      error: { code: "08006", message: "connection reset" },
    });

    // Act
    const result = await claimStripeEvent(
      { eventId: "evt_1", type: "checkout.session.completed", livemode: false },
      env,
    );

    // Assert
    expect(result).toEqual({ outcome: "error", message: "connection reset" });
  });

  // B2's own reproduction: a duplicate insert (23505) alone must NEVER be
  // read as "already fully processed" — it only proves Stripe delivered
  // this event id before. What happened to that earlier delivery decides
  // the outcome, which is why this function re-reads `status`.
  it("reports 'retry' — NOT 'done' — when a duplicate insert finds an existing row still at status='received'", async () => {
    // Arrange
    insert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value" },
    });
    maybeSingle.mockResolvedValueOnce({
      data: { status: "received" },
      error: null,
    });

    // Act
    const result = await claimStripeEvent(
      { eventId: "evt_1", type: "checkout.session.completed", livemode: false },
      env,
    );

    // Assert — an earlier attempt claimed this event but never finished:
    // this delivery must reprocess, not be told "deduped".
    expect(result).toEqual({ outcome: "retry" });
  });

  it("reports 'done' when a duplicate insert finds an existing row already at status='done'", async () => {
    // Arrange
    insert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value" },
    });
    maybeSingle.mockResolvedValueOnce({
      data: { status: "done" },
      error: null,
    });

    // Act
    const result = await claimStripeEvent(
      { eventId: "evt_1", type: "checkout.session.completed", livemode: false },
      env,
    );

    // Assert
    expect(result).toEqual({ outcome: "done" });
  });

  it("reports 'error' — a fail-closed backstop — when the row vanishes after a conflicting insert", async () => {
    // Arrange
    insert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value" },
    });
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    // Act
    const result = await claimStripeEvent(
      { eventId: "evt_1", type: "checkout.session.completed", livemode: false },
      env,
    );

    // Assert
    expect(result).toEqual({
      outcome: "error",
      message: "stripe_events row vanished after a conflicting insert",
    });
  });

  it("reports 'error' when the post-conflict status re-read itself fails", async () => {
    // Arrange
    insert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value" },
    });
    maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "statement timeout" },
    });

    // Act
    const result = await claimStripeEvent(
      { eventId: "evt_1", type: "checkout.session.completed", livemode: false },
      env,
    );

    // Assert
    expect(result).toEqual({ outcome: "error", message: "statement timeout" });
  });
});

describe("markStripeEventDone", () => {
  it("updates status='done' and the resolved account_id on success", async () => {
    // Arrange
    updateEq.mockResolvedValueOnce({ error: null });

    // Act
    const result = await markStripeEventDone("evt_1", 42, env);

    // Assert
    expect(result).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ status: "done", account_id: 42 });
    expect(updateEq).toHaveBeenCalledWith("event_id", "evt_1");
  });

  it("writes a null account_id for an event that never resolved to one", async () => {
    // Arrange
    updateEq.mockResolvedValueOnce({ error: null });

    // Act
    const result = await markStripeEventDone("evt_2", null, env);

    // Assert
    expect(result).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ status: "done", account_id: null });
  });

  it("reports failure without throwing when the update errors", async () => {
    // Arrange
    updateEq.mockResolvedValueOnce({
      error: { message: "connection reset" },
    });

    // Act
    const result = await markStripeEventDone("evt_1", 1, env);

    // Assert
    expect(result).toEqual({ ok: false, message: "connection reset" });
  });
});
