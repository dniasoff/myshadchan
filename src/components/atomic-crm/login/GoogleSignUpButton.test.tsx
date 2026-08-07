import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  type AuthProvider,
  useNotificationContext,
} from "ra-core";
import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import { GoogleSignUpButton } from "./GoogleSignUpButton";
import * as signupIntentModule from "./signupIntent";

// GoogleSignUpButton records a signup_intents row directly through the
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

const NotificationProbe = () => {
  const { notifications } = useNotificationContext();
  const latest = notifications.at(-1);
  if (!latest) return null;

  return (
    <output
      data-testid="notification"
      data-message={String(latest.message)}
      data-type={latest.type}
    >
      {latest.notificationOptions?.messageArgs?._ ?? String(latest.message)}
    </output>
  );
};

const buildAuthProvider = (login: AuthProvider["login"]): AuthProvider => ({
  login,
  logout: async () => undefined,
  checkAuth: async () => undefined,
  checkError: async () => undefined,
});

const renderGoogleSignUpButton = (
  login: AuthProvider["login"] | undefined,
  props: { email: string; disabled: boolean },
) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <CoreAdminContext
      authProvider={login ? buildAuthProvider(login) : undefined}
      i18nProvider={testI18nProvider}
    >
      {children}
      <NotificationProbe />
    </CoreAdminContext>
  );

  return render(<GoogleSignUpButton {...props} />, { wrapper: Wrapper });
};

describe("GoogleSignUpButton", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    mockedRecordSignupIntent.mockReset();
  });

  it("renders nothing when Google OAuth is not enabled", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);

    // Act
    const screen = await renderGoogleSignUpButton(login, {
      email: "ada@example.com",
      disabled: false,
    });

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Continue with Google" }))
      .not.toBeInTheDocument();
  });

  it("stays disabled until the age affirmation above it is confirmed", async () => {
    // Arrange: RegisterFlow passes disabled={!ageAffirmed} — a genuinely
    // disabled button cannot be clicked by a real visitor, so a real
    // disabled attribute (asserted below) is the proof itself; attempting a
    // click on it would just time out waiting for it to become actionable.
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderGoogleSignUpButton(login, {
      email: "ada@example.com",
      disabled: true,
    });

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Continue with Google" }))
      .toBeDisabled();
    expect(mockedRecordSignupIntent).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("records a signup intent for the already-entered email before redirecting via OAuth", async () => {
    // Arrange
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    mockedRecordSignupIntent.mockResolvedValue(undefined);
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderGoogleSignUpButton(login, {
      email: "ada@example.com",
      disabled: false,
    });
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const initialUrl = window.location.href;

    // Act
    await screen.getByRole("button", { name: "Continue with Google" }).click();

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
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.href).toBe(initialUrl);
    const recordOrder = mockedRecordSignupIntent.mock.invocationCallOrder[0];
    const loginOrder = login.mock.invocationCallOrder[0];
    expect(recordOrder).toBeLessThan(loginOrder);
  });

  it("does not redirect via OAuth when recording the signup intent fails", async () => {
    // Arrange
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    mockedRecordSignupIntent.mockRejectedValue(
      new Error("Could not reach the server"),
    );
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderGoogleSignUpButton(login, {
      email: "ada@example.com",
      disabled: false,
    });

    // Act
    await screen.getByRole("button", { name: "Continue with Google" }).click();

    // Assert: never falls through to login() when the intent could not be
    // recorded, and the visitor is left able to retry.
    await vi.waitFor(() => {
      expect(mockedRecordSignupIntent).toHaveBeenCalledExactlyOnceWith(
        "ada@example.com",
      );
    });
    await expect
      .element(screen.getByRole("button", { name: "Continue with Google" }))
      .not.toBeDisabled();
    expect(login).not.toHaveBeenCalled();
    await expect
      .element(screen.getByText("Could not reach the server"))
      .toBeVisible();
    await expect
      .element(screen.getByTestId("notification"))
      .toHaveAttribute("data-message", "Could not reach the server");
    await expect
      .element(screen.getByTestId("notification"))
      .toHaveAttribute("data-type", "error");
  });

  it("restores retry when OAuth rejects after recording the signup intent", async () => {
    // Arrange
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    mockedRecordSignupIntent.mockResolvedValue(undefined);
    const login = vi.fn().mockRejectedValue(new Error("provider disabled"));
    const screen = await renderGoogleSignUpButton(login, {
      email: "ada@example.com",
      disabled: false,
    });

    // Act
    await screen.getByRole("button", { name: "Continue with Google" }).click();

    // Assert
    await vi.waitFor(() => {
      expect(login).toHaveBeenCalledExactlyOnceWith({
        oauthProvider: "google",
        loginHint: "ada@example.com",
      });
    });
    await expect.element(screen.getByText("provider disabled")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Continue with Google" }))
      .not.toBeDisabled();
  });

  it("does not record an intent and shows the configuration error when no auth provider exists", async () => {
    // Arrange
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const screen = await renderGoogleSignUpButton(undefined, {
      email: "ada@example.com",
      disabled: false,
    });
    const pushState = vi.spyOn(window.history, "pushState");
    const initialUrl = window.location.href;

    // Act
    await screen.getByRole("button", { name: "Continue with Google" }).click();

    // Assert
    expect(mockedRecordSignupIntent).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.href).toBe(initialUrl);
    await expect
      .element(screen.getByText(/Google sign-in is not configured/i))
      .toBeVisible();
    await expect
      .element(screen.getByTestId("notification"))
      .toHaveAttribute("data-message", "crm.auth.google_oauth_not_configured");
    await expect
      .element(screen.getByTestId("notification"))
      .toHaveAttribute("data-type", "error");
    await expect
      .element(screen.getByRole("button", { name: "Continue with Google" }))
      .not.toBeDisabled();
  });
});
