import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appReturnUrl, isEligibleForBilling } from "./checkoutHelpers";

describe("appReturnUrl", () => {
  it("builds a HashRouter URL, never a bare server path (B6)", () => {
    // Arrange / Act
    const url = appReturnUrl(
      "https://www.myshadchan.space",
      "/billing?checkout=success",
    );

    // Assert
    expect(url).toBe("https://www.myshadchan.space/#/billing?checkout=success");
  });
});

function fakeSupabase(rpcResult: {
  data: unknown;
  error: unknown;
}): SupabaseClient {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as unknown as SupabaseClient;
}

describe("isEligibleForBilling", () => {
  it("reports eligible for a non-single role", async () => {
    // Arrange
    const supabase = fakeSupabase({ data: "parent_admin", error: null });

    // Act
    const result = await isEligibleForBilling(supabase);

    // Assert
    expect(result).toEqual({ eligible: true });
  });

  it("reports ineligible for the 'single' role — the same population subscription/ai_usage RLS denies", async () => {
    // Arrange
    const supabase = fakeSupabase({ data: "single", error: null });

    // Act
    const result = await isEligibleForBilling(supabase);

    // Assert
    expect(result).toEqual({
      eligible: false,
      message: "billing is not available for this role",
    });
  });

  it("reports ineligible (never silently eligible) when the role RPC itself errors", async () => {
    // Arrange
    const supabase = fakeSupabase({
      data: null,
      error: { message: "connection reset" },
    });

    // Act
    const result = await isEligibleForBilling(supabase);

    // Assert
    expect(result).toEqual({
      eligible: false,
      message: "failed to resolve role",
    });
  });
});
