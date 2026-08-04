import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, type AuthProvider } from "ra-core";
import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import { GoogleSignInButton } from "./GoogleSignInButton";
import * as signupIntentModule from "./signupIntent";

// GoogleSignInButton records a signup_intents row directly through the
// Supabase client (recordSignupIntent) before ever calling login() — mocking
// this module is what lets these tests assert that ordering without a real
// network call. See signupIntent.ts's own doc comment for why this must
// happen before signInWithOAuth() redirects the browser away.
vi.mock("./signupIntent", () => ({
  recordSignupIntent: vi.fn(),
}));

const mockedRecordSignupIntent = vi.mocked(
  signupIntentModule.recordSignupIntent,
);

const buildAuthProvider = (login: AuthProvider["login"]): AuthProvider => ({
  login,
  logout: async () => undefined,
  checkAuth: async () => undefined,
  checkError: async () => undefined,
});

const renderGoogleSignInButton = (login: AuthProvider["login"]) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <CoreAdminContext
      authProvider={buildAuthProvider(login)}
      i18nProvider={testI18nProvider}
    >
      {children}
    </CoreAdminContext>
  );

  return render(<GoogleSignInButton />, { wrapper: Wrapper });
};

describe("GoogleSignInButton", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockedRecordSignupIntent.mockReset();
  });

  it("renders nothing when Google OAuth is not enabled", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);

    // Act
    const screen = await renderGoogleSignInButton(login);

    // Assert: VITE_ENABLE_GOOGLE_OAUTH is unset here — isGoogleOAuthEnabled()
    // (googleOAuth.ts) must gate the button off entirely.
    await expect
      .element(screen.getByRole("button", { name: "Continue with Google" }))
      .not.toBeInTheDocument();
  });

  it("renders the button when Google OAuth is enabled", async () => {
    // Arrange
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const login = vi.fn().mockResolvedValue(undefined);

    // Act
    const screen = await renderGoogleSignInButton(login);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Continue with Google" }))
      .toBeInTheDocument();
  });

  it("records a signup intent for the entered email before redirecting via OAuth", async () => {
    // Arrange
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    mockedRecordSignupIntent.mockResolvedValue(undefined);
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderGoogleSignInButton(login);
    await screen.getByRole("button", { name: "Continue with Google" }).click();
    await screen.getByLabelText(/email/i).fill("ada@example.com");

    // Act
    await screen.getByRole("checkbox").click();
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert: recordSignupIntent must be called (and settle) before login()
    // — signInWithOAuth() navigates the browser away, so there is no
    // "after" to record anything in once that happens (signupIntent.ts).
    await vi.waitFor(() => {
      expect(login).toHaveBeenCalledExactlyOnceWith({
        oauthProvider: "google",
        loginHint: "ada@example.com",
      });
    });
    expect(mockedRecordSignupIntent).toHaveBeenCalledExactlyOnceWith(
      "ada@example.com",
    );
    const recordOrder = mockedRecordSignupIntent.mock.invocationCallOrder[0];
    const loginOrder = login.mock.invocationCallOrder[0];
    expect(recordOrder).toBeLessThan(loginOrder);
  });

  it("does not redirect via OAuth when the age box is checked but no email was entered", async () => {
    // Arrange — the Continue button's disabled state only tracks the age
    // checkbox (AgeAffirmation.tsx); handleContinue itself is what refuses
    // an empty email (GoogleSignInButton.tsx), so this has to be proven by
    // clicking through, not by the button being disabled.
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderGoogleSignInButton(login);
    await screen.getByRole("button", { name: "Continue with Google" }).click();
    await screen.getByRole("checkbox").click();

    // Act: never fill in an email.
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert: neither the intent nor the OAuth redirect ever fires.
    expect(mockedRecordSignupIntent).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("does not redirect via OAuth when recording the signup intent fails", async () => {
    // Arrange
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    mockedRecordSignupIntent.mockRejectedValue(
      new Error("Could not reach the server"),
    );
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderGoogleSignInButton(login);
    await screen.getByRole("button", { name: "Continue with Google" }).click();
    await screen.getByLabelText(/email/i).fill("ada@example.com");
    await screen.getByRole("checkbox").click();

    // Act
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert: never falls through to login() when the intent could not be
    // recorded, and the visitor is left able to retry (Continue reappears
    // once the pending state clears).
    await vi.waitFor(() => {
      expect(mockedRecordSignupIntent).toHaveBeenCalledExactlyOnceWith(
        "ada@example.com",
      );
    });
    await expect
      .element(screen.getByRole("button", { name: "Continue" }))
      .toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });
});
