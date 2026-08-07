import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  type AuthProvider,
  useNotificationContext,
} from "ra-core";
import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import { GoogleSignInButton } from "./GoogleSignInButton";

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

const renderGoogleSignInButton = (login?: AuthProvider["login"]) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <CoreAdminContext
      authProvider={login ? buildAuthProvider(login) : undefined}
      i18nProvider={testI18nProvider}
    >
      {children}
      <NotificationProbe />
    </CoreAdminContext>
  );

  return render(<GoogleSignInButton />, { wrapper: Wrapper });
};

describe("GoogleSignInButton", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
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

  it("redirects to Google immediately on click, with no email or age step", async () => {
    // Arrange: signing in never creates an account, so there is nothing to
    // collect first — see GoogleSignInButton.tsx's own doc comment.
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderGoogleSignInButton(login);
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const initialUrl = window.location.href;

    // Act
    await screen.getByRole("button", { name: "Continue with Google" }).click();

    // Assert: no email field, no age checkbox — just the OAuth call.
    await vi.waitFor(() => {
      expect(login).toHaveBeenCalledExactlyOnceWith({
        oauthProvider: "google",
      });
    });
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.href).toBe(initialUrl);
    await expect.element(screen.getByRole("checkbox")).not.toBeInTheDocument();
  });

  it("does not navigate and shows the configuration error when no auth provider exists", async () => {
    // Arrange
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const screen = await renderGoogleSignInButton();
    const pushState = vi.spyOn(window.history, "pushState");
    const initialUrl = window.location.href;

    // Act
    await screen.getByRole("button", { name: "Continue with Google" }).click();

    // Assert
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

  it("re-enables the button and shows an error when the OAuth call rejects", async () => {
    // Arrange
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const login = vi.fn().mockRejectedValue(new Error("provider disabled"));
    const screen = await renderGoogleSignInButton(login);

    // Act
    await screen.getByRole("button", { name: "Continue with Google" }).click();

    // Assert: the visitor is left able to retry.
    await vi.waitFor(() => {
      expect(login).toHaveBeenCalledOnce();
    });
    await expect.element(screen.getByText("provider disabled")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Continue with Google" }))
      .not.toBeDisabled();
  });
});
