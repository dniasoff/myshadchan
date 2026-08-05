import { describe, expect, it } from "vitest";
import { shouldPrefetchConfigOnLogin } from "./adminRouteBuilders";

describe("shouldPrefetchConfigOnLogin", () => {
  it("returns true for a completed OTP sign-in (verifyOtp)", () => {
    // Arrange
    const params = {
      email: "ada@example.com",
      token: "123456",
      verifyOtp: true,
    };

    // Act
    const result = shouldPrefetchConfigOnLogin(params);

    // Assert
    expect(result).toBe(true);
  });

  it("returns false for the OTP send-code step (requestOtp) — no session exists yet", () => {
    // Arrange
    const params = { email: "ada@example.com", requestOtp: true };

    // Act
    const result = shouldPrefetchConfigOnLogin(params);

    // Assert
    expect(result).toBe(false);
  });

  it("returns false for an OAuth login click — the page is about to navigate away", () => {
    // Arrange
    const params = { oauthProvider: "google" };

    // Act
    const result = shouldPrefetchConfigOnLogin(params);

    // Assert
    expect(result).toBe(false);
  });

  it("returns false for null or non-object params", () => {
    expect(shouldPrefetchConfigOnLogin(null)).toBe(false);
    expect(shouldPrefetchConfigOnLogin(undefined)).toBe(false);
    expect(shouldPrefetchConfigOnLogin("not an object")).toBe(false);
  });
});
