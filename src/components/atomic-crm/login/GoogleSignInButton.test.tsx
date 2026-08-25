import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  type AuthProvider,
  useNotificationContext,
} from "ra-core";
import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import {
  GoogleSignInButton,
  GOOGLE_OAUTH_REDIRECT_TIMEOUT_MS,
} from "./GoogleSignInButton";

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
    // Arrange: nothing is collected before the redirect — see
    // GoogleSignInButton.tsx's own doc comment.
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

  it("disarms the timer as soon as the browser starts navigating away", async () => {
    // Arrange — THE regression guard for this component's real defect.
    //
    // `signInWithOAuth()` is network-free (auth-js builds the URL locally and
    // calls `window.location.assign()`), so the timer below can only observe
    // whether a new document has committed — it cannot tell "the redirect was
    // blocked" from "the redirect is slow". It used to assume the former and
    // show an ERROR toast over a sign-in that was working: reproduced against
    // production, toast at click+10.01s, Google reached at click+10.65s.
    //
    // `beforeunload` fires when the navigation STARTS (measured: 10 seconds
    // before the timer fired), so the fix is to disarm on it. This asserts
    // exactly that, and fails on the pre-fix code, which attached no such
    // listener and therefore never called `clearTimeout`.
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const TIMER_ID = 4242;
    vi.spyOn(window, "setTimeout").mockImplementation(
      () => TIMER_ID as unknown as ReturnType<typeof window.setTimeout>,
    );
    const clearTimeoutSpy = vi
      .spyOn(window, "clearTimeout")
      .mockImplementation(() => undefined);
    const login = vi.fn(() => new Promise<void>(() => undefined));
    const screen = await renderGoogleSignInButton(login);

    // Act — click, then let the browser announce that it is leaving.
    await screen.getByRole("button", { name: "Continue with Google" }).click();
    expect(clearTimeoutSpy).not.toHaveBeenCalledWith(TIMER_ID);
    window.dispatchEvent(new Event("beforeunload"));

    // Assert — the pending timer was cancelled, so nothing can claim failure.
    await expect
      .poll(() => clearTimeoutSpy.mock.calls.some(([id]) => id === TIMER_ID))
      .toBe(true);
  });

  it("recovers the button, without claiming failure, if nothing has happened yet", async () => {
    // Arrange: a stalled provider call represents a blocked or interrupted
    // browser hand-off. It must not leave the visitor with an infinite spinner.
    // The message is INFO, not error: on iOS Safari neither `beforeunload` nor
    // `pagehide` reliably fires before commit, so this can still run while the
    // redirect is genuinely in flight, and the copy must not assert otherwise.
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    let timeoutCallback: (() => void) | undefined;
    const setTimeoutSpy = vi
      .spyOn(window, "setTimeout")
      .mockImplementation((handler) => {
        timeoutCallback = handler as () => void;
        return 1 as unknown as ReturnType<typeof window.setTimeout>;
      });
    const login = vi.fn(() => new Promise<void>(() => undefined));
    const screen = await renderGoogleSignInButton(login);
    const button = screen.getByRole("button", { name: "Continue with Google" });

    // Act
    await button.click();
    await expect.element(button).toBeDisabled();
    expect(setTimeoutSpy).toHaveBeenCalledWith(
      expect.any(Function),
      GOOGLE_OAUTH_REDIRECT_TIMEOUT_MS,
    );
    expect(timeoutCallback).toBeDefined();
    timeoutCallback?.();

    // Assert
    await expect.element(button).not.toBeDisabled();
    await expect
      .element(screen.getByText(/Still opening Google sign-in/i))
      .toBeVisible();
  });
});
