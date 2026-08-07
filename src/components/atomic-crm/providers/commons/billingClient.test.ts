import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callBillingWorker } from "./billingClient";

const getSession = vi.fn();

vi.mock("../supabase/supabase", () => ({
  getSupabaseClient: () => ({
    auth: { getSession },
  }),
}));

/**
 * Mirrors `aiWorkerClient.test.ts`'s own suite — same envelope contract,
 * same session-forwarding behavior — but exercised against
 * `callBillingWorker` directly, since the story deliberately keeps the two
 * clients separate (see `billingClient.ts`'s own doc comment).
 */
describe("callBillingWorker", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the bearer token from the current session", async () => {
    // Arrange
    getSession.mockResolvedValue({
      data: { session: { access_token: "token-abc" } },
      error: null,
    });
    fetchMock.mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: true,
          data: { url: "https://checkout.stripe.com/session/xyz" },
        }),
    });

    // Act
    const result = await callBillingWorker("http://localhost/checkout", {
      cadence: "quarterly",
    });

    // Assert
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost/checkout",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token-abc",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cadence: "quarterly" }),
      }),
    );
    expect(result).toEqual({ url: "https://checkout.stripe.com/session/xyz" });
  });

  it("throws 'Not authenticated' when there is no session", async () => {
    // Arrange
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    // Act / Assert
    await expect(
      callBillingWorker("http://localhost/checkout", { cadence: "yearly" }),
    ).rejects.toThrow("Not authenticated");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws the server's error string on success:false", async () => {
    // Arrange
    getSession.mockResolvedValue({
      data: { session: { access_token: "token-abc" } },
      error: null,
    });
    fetchMock.mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: false,
          error: "no subscription",
        }),
    });

    // Act / Assert
    await expect(
      callBillingWorker("http://localhost/portal", {}),
    ).rejects.toThrow("no subscription");
  });

  it("falls back to a generic message when the server omits an error string", async () => {
    // Arrange
    getSession.mockResolvedValue({
      data: { session: { access_token: "token-abc" } },
      error: null,
    });
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ success: false }),
    });

    // Act / Assert
    await expect(
      callBillingWorker("http://localhost/portal", {}),
    ).rejects.toThrow("Billing request failed");
  });

  it("propagates a rejected fetch", async () => {
    // Arrange
    getSession.mockResolvedValue({
      data: { session: { access_token: "token-abc" } },
      error: null,
    });
    fetchMock.mockRejectedValue(new Error("Network failure"));

    // Act / Assert
    await expect(
      callBillingWorker("http://localhost/checkout", { cadence: "quarterly" }),
    ).rejects.toThrow("Network failure");
  });
});
