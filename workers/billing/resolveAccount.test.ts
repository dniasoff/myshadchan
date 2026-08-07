import { describe, expect, it, vi } from "vitest";
import { recordStripeEvent, resolveAccountForCustomer } from "./resolveAccount";

const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const insert = vi.fn();
const from = vi.fn((table: string) =>
  table === "subscription" ? { select } : { insert },
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
  it("returns the account id for a known Stripe customer", async () => {
    // Arrange
    maybeSingle.mockResolvedValueOnce({
      data: { account_id: 42 },
      error: null,
    });

    // Act
    const accountId = await resolveAccountForCustomer("cus_known", env);

    // Assert
    expect(accountId).toBe(42);
    expect(from).toHaveBeenCalledWith("subscription");
    expect(select).toHaveBeenCalledWith("account_id");
    expect(eq).toHaveBeenCalledWith("stripe_customer_id", "cus_known");
  });

  it("returns null, never throws, for an unknown Stripe customer", async () => {
    // Arrange
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    // Act
    const accountId = await resolveAccountForCustomer("cus_unknown", env);

    // Assert
    expect(accountId).toBeNull();
  });

  it("returns null, never throws, when the query itself errors", async () => {
    // Arrange
    maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "connection reset" },
    });

    // Act
    const accountId = await resolveAccountForCustomer("cus_error", env);

    // Assert
    expect(accountId).toBeNull();
  });
});

describe("recordStripeEvent", () => {
  it("reports 'recorded' on a clean insert", async () => {
    // Arrange
    insert.mockResolvedValueOnce({ error: null });

    // Act
    const result = await recordStripeEvent(
      {
        eventId: "evt_1",
        type: "checkout.session.completed",
        accountId: 1,
        livemode: false,
      },
      env,
    );

    // Assert
    expect(result).toEqual({ outcome: "recorded" });
    expect(insert).toHaveBeenCalledWith({
      event_id: "evt_1",
      type: "checkout.session.completed",
      account_id: 1,
      livemode: false,
    });
  });

  it("records a null account_id for an unresolved customer, without guessing", async () => {
    // Arrange
    insert.mockResolvedValueOnce({ error: null });

    // Act
    const result = await recordStripeEvent(
      {
        eventId: "evt_2",
        type: "invoice.payment_failed",
        accountId: null,
        livemode: false,
      },
      env,
    );

    // Assert
    expect(result).toEqual({ outcome: "recorded" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: null }),
    );
  });

  it("reports 'duplicate' — not an error — on a 23505 unique violation", async () => {
    // Arrange
    insert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value" },
    });

    // Act
    const result = await recordStripeEvent(
      {
        eventId: "evt_1",
        type: "checkout.session.completed",
        accountId: 1,
        livemode: false,
      },
      env,
    );

    // Assert
    expect(result).toEqual({ outcome: "duplicate" });
  });

  it("reports 'error' with the message for any other insert failure", async () => {
    // Arrange
    insert.mockResolvedValueOnce({
      error: { code: "08006", message: "connection reset" },
    });

    // Act
    const result = await recordStripeEvent(
      {
        eventId: "evt_1",
        type: "checkout.session.completed",
        accountId: 1,
        livemode: false,
      },
      env,
    );

    // Assert
    expect(result).toEqual({ outcome: "error", message: "connection reset" });
  });
});
