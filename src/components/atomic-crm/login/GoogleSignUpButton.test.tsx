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

const renderGoogleSignUpButton = (login: AuthProvider["login"] | undefined) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <CoreAdminContext
      authProvider={login ? buildAuthProvider(login) : undefined}
      i18nProvider={testI18nProvider}
    >
      {children}
      <NotificationProbe />
    </CoreAdminContext>
  );

  return render(<GoogleSignUpButton />, { wrapper: Wrapper });
};

describe("GoogleSignUpButton", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("renders nothing when Google OAuth is not enabled", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);

    // Act
    const screen = await renderGoogleSignUpButton(login);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Continue with Google" }))
      .not.toBeInTheDocument();
  });

  it("redirects via OAuth without collecting anything first", async () => {
    // Arrange: nothing is typed and nothing is ticked. This button used to
    // require both — the 18+ affirmation had to reach the server, and its
    // only channel across an OAuth redirect was a signup_intents row keyed
    // on an email we therefore had to ask for. That gate is retired, so
    // there is no email, no affirmation state, and no pre-redirect write.
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderGoogleSignUpButton(login);
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const initialUrl = window.location.href;

    // Act
    await screen.getByRole("button", { name: "Continue with Google" }).click();

    // Assert: no `loginHint` either — it only ever existed to steer Google's
    // consent screen toward the email the intent row was keyed on.
    await vi.waitFor(() => {
      expect(login).toHaveBeenCalledExactlyOnceWith({
        oauthProvider: "google",
      });
    });
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.href).toBe(initialUrl);
  });

  it("restores retry when OAuth rejects", async () => {
    // Arrange
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const login = vi.fn().mockRejectedValue(new Error("provider disabled"));
    const screen = await renderGoogleSignUpButton(login);

    // Act
    await screen.getByRole("button", { name: "Continue with Google" }).click();

    // Assert
    await vi.waitFor(() => {
      expect(login).toHaveBeenCalledExactlyOnceWith({
        oauthProvider: "google",
      });
    });
    await expect.element(screen.getByText("provider disabled")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Continue with Google" }))
      .not.toBeDisabled();
  });

  it("shows the configuration error when no auth provider exists", async () => {
    // Arrange
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const screen = await renderGoogleSignUpButton(undefined);
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
});
