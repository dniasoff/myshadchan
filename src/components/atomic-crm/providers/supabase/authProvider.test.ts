import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks the Supabase client entirely so `login()`'s two OTP branches can be
// exercised without a real backend. `getBaseAuthProvider()` only touches
// `client.auth.*` lazily (inside methods, never at construction time), so a
// minimal `auth` surface is enough. `vi.hoisted` is required here (not plain
// module-scope `const`) because `vi.mock`'s factory itself is hoisted above
// every import/declaration in this file.
const { signInWithOtp, verifyOtp } = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("./supabase", () => ({
  getSupabaseClient: () => ({
    auth: {
      signInWithOtp,
      verifyOtp,
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: null }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(),
  }),
}));

import { getAuthProvider } from "./authProvider";

describe("getAuthProvider().login", () => {
  beforeEach(() => {
    signInWithOtp.mockReset();
    verifyOtp.mockReset();
  });

  it("requests an OTP without creating a user by default", async () => {
    // Arrange
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    const authProvider = getAuthProvider();

    // Act
    await authProvider.login({ email: "ada@example.com", requestOtp: true });

    // Assert: AC-1 — the login form can never create a user.
    expect(signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "ada@example.com",
      options: { shouldCreateUser: false, data: undefined },
    });
  });

  it("forwards allowSignup and meta only when the caller passes them (2.7's invite-acceptance seam)", async () => {
    // Arrange
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    const authProvider = getAuthProvider();

    // Act
    await authProvider.login({
      email: "ada@example.com",
      requestOtp: true,
      allowSignup: true,
      meta: { invite_token: "tok" },
    });

    // Assert
    expect(signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "ada@example.com",
      options: { shouldCreateUser: true, data: { invite_token: "tok" } },
    });
  });

  it("swallows GoTrue's otp_disabled rejection so an unknown email is indistinguishable from a known one", async () => {
    // Arrange: verified live against the local stack — `shouldCreateUser:
    // false` against an unknown email rejects with exactly this code
    // ("Signups not allowed for otp"), not the more obviously-named
    // "signup_disabled".
    signInWithOtp.mockResolvedValue({
      data: {},
      error: { code: "otp_disabled", message: "Signups not allowed for otp" },
    });
    const authProvider = getAuthProvider();

    // Act / Assert: resolves like a known email would — no account-existence
    // oracle.
    await expect(
      authProvider.login({ email: "nobody@example.com", requestOtp: true }),
    ).resolves.toBeUndefined();
  });

  it("rethrows any other requestOtp failure", async () => {
    // Arrange
    const error = {
      code: "over_email_send_rate_limit",
      message: "Too many requests",
    };
    signInWithOtp.mockResolvedValue({ data: {}, error });
    const authProvider = getAuthProvider();

    // Act / Assert
    await expect(
      authProvider.login({ email: "ada@example.com", requestOtp: true }),
    ).rejects.toBe(error);
  });

  it("verifies a code with type 'email'", async () => {
    // Arrange
    verifyOtp.mockResolvedValue({ data: {}, error: null });
    const authProvider = getAuthProvider();

    // Act
    await authProvider.login({
      email: "ada@example.com",
      token: "123456",
      verifyOtp: true,
    });

    // Assert
    expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({
      email: "ada@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("rethrows a verifyOtp failure (e.g. an expired or wrong code)", async () => {
    // Arrange
    const error = { message: "Token has expired or is invalid" };
    verifyOtp.mockResolvedValue({ data: {}, error });
    const authProvider = getAuthProvider();

    // Act / Assert
    await expect(
      authProvider.login({
        email: "ada@example.com",
        token: "000000",
        verifyOtp: true,
      }),
    ).rejects.toBe(error);
  });

  it("throws on any other login shape instead of falling through to password sign-in", async () => {
    // Arrange
    const authProvider = getAuthProvider();

    // Act / Assert: AC-8's non-greppable assertion — ra-supabase-core's
    // password login (`baseAuthProvider.login`) must be unreachable.
    await expect(
      authProvider.login({ email: "ada@example.com", password: "hunter2" }),
    ).rejects.toThrow("Unsupported login request.");
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
