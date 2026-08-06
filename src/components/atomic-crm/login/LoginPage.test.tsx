import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  type ReactNode,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, type AuthProvider } from "ra-core";
import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import { LoginPage } from "./LoginPage";
import type { TurnstileWidgetHandle } from "./TurnstileWidget";

// LoginPage keeps one `TurnstileWidget` mounted for the whole screen and
// forwards whatever token it reports on every `requestOtp` call — see
// LoginPage's own doc comment. The real widget loads Cloudflare's script
// over the network, which the test environment can't rely on, so every test
// here gets a fake that reports a fixed, known token immediately on mount —
// deterministic, and lets each test assert the exact call shape `login()`
// receives.
const FAKE_CAPTCHA_TOKEN = "test-captcha-token";
vi.mock("./TurnstileWidget", () => ({
  TurnstileWidget: forwardRef<
    TurnstileWidgetHandle,
    { onToken: (token: string | null) => void }
  >(({ onToken }, ref) => {
    useImperativeHandle(ref, () => ({ reset: vi.fn() }));
    useEffect(() => {
      onToken(FAKE_CAPTCHA_TOKEN);
      // `onToken` is the parent's `setCaptchaToken` state setter — stable
      // across renders, so this fires exactly once per mount.
    }, [onToken]);
    // A detectable stand-in for the real widget's own `data-testid` — lets
    // tests below assert whether LoginPage mounted it at all, which is
    // exactly the lazy-mount behavior (`wantsOtp`) those tests exercise.
    return <div data-testid="turnstile-widget" />;
  }),
}));

// Minimal AuthProvider stub driven by a caller-supplied `login` mock — the
// other methods are never exercised by LoginPage but are required by the
// AuthProvider type.
const buildAuthProvider = (login: AuthProvider["login"]): AuthProvider => ({
  login,
  logout: async () => undefined,
  checkAuth: async () => undefined,
  checkError: async () => undefined,
});

const renderLoginPage = (login: AuthProvider["login"]) => {
  // No extra <Notification/> in this wrapper: LoginPage renders inside
  // AuthLayout, which already mounts one.
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <CoreAdminContext
      authProvider={buildAuthProvider(login)}
      i18nProvider={testI18nProvider}
    >
      {children}
    </CoreAdminContext>
  );

  return render(<LoginPage />, { wrapper: Wrapper });
};

describe("LoginPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requests a code without asking to create a user, but does send a captcha token", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderLoginPage(login);

    // Act
    await screen.getByLabelText(/email/i).fill("ada@example.com");
    await screen.getByRole("button", { name: "Send code" }).click();

    // Assert: no `allowSignup` — the login form never creates a user (AC-1)
    // — but the Turnstile token IS forwarded (the highest-risk wiring gap:
    // Supabase's captcha gate is project-wide, so sign-in must already send
    // a token before it's ever turned on — see LoginPage's own doc comment).
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();
    expect(login).toHaveBeenCalledExactlyOnceWith({
      email: "ada@example.com",
      requestOtp: true,
      captchaToken: FAKE_CAPTCHA_TOKEN,
    });
  });

  it("verifies the typed code against the same email that requested it", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderLoginPage(login);
    await screen.getByLabelText(/email/i).fill("ada@example.com");
    await screen.getByRole("button", { name: "Send code" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();

    // Act
    await screen.getByLabelText(/code/i).fill("123456");
    await screen.getByRole("button", { name: "Sign in" }).click();

    // Assert
    expect(login).toHaveBeenLastCalledWith({
      email: "ada@example.com",
      token: "123456",
      verifyOtp: true,
    });
  });

  it("shows an error and stays on the code step when the code is wrong", async () => {
    // Arrange
    const login = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Token has expired or is invalid"));
    const screen = await renderLoginPage(login);
    await screen.getByLabelText(/email/i).fill("ada@example.com");
    await screen.getByRole("button", { name: "Send code" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();

    // Act
    await screen.getByLabelText(/code/i).fill("000000");
    await screen.getByRole("button", { name: "Sign in" }).click();

    // Assert: the real Supabase error surfaces, and the user stays on the
    // code step (no navigation away, no crash back to the email step).
    await expect
      .element(screen.getByText("Token has expired or is invalid"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();
  });

  it("returns to the email step, without re-requesting a code, when the user picks a different email", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderLoginPage(login);
    await screen.getByLabelText(/email/i).fill("ada@example.com");
    await screen.getByRole("button", { name: "Send code" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();

    // Act
    await screen.getByRole("button", { name: "Use a different email" }).click();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Send code" }))
      .toBeInTheDocument();
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("resends a code for the same email without leaving the code step", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderLoginPage(login);
    await screen.getByLabelText(/email/i).fill("ada@example.com");
    await screen.getByRole("button", { name: "Send code" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();

    // Act
    await screen.getByRole("button", { name: "Resend code" }).click();

    // Assert
    expect(login).toHaveBeenCalledTimes(2);
    expect(login).toHaveBeenLastCalledWith({
      email: "ada@example.com",
      requestOtp: true,
      captchaToken: FAKE_CAPTCHA_TOKEN,
    });
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();
  });

  it("does not render the Google sign-in entry point when Google OAuth is disabled", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);

    // Act
    const screen = await renderLoginPage(login);

    // Assert: VITE_ENABLE_GOOGLE_OAUTH is unset in this test — the button
    // must not appear (isGoogleOAuthEnabled() gates it — googleOAuth.ts).
    await expect
      .element(screen.getByRole("button", { name: "Continue with Google" }))
      .not.toBeInTheDocument();
  });

  it("renders the Google sign-in entry point when Google OAuth is enabled", async () => {
    // Arrange
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const login = vi.fn().mockResolvedValue(undefined);

    // Act
    const screen = await renderLoginPage(login);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Continue with Google" }))
      .toBeInTheDocument();
  });

  it("does not mount Turnstile on initial load, before the visitor has shown any OTP intent", async () => {
    // Arrange — a visitor who only ever intends to click "Continue with
    // Google" must never trigger Cloudflare's challenge machinery on this
    // page at all (see LoginPage's own doc comment on `wantsOtp`).
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const login = vi.fn().mockResolvedValue(undefined);

    // Act
    const screen = await renderLoginPage(login);

    // Assert
    await expect
      .element(screen.getByTestId("turnstile-widget"))
      .not.toBeInTheDocument();
  });

  it("mounts Turnstile once the email field is focused", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderLoginPage(login);
    await expect
      .element(screen.getByTestId("turnstile-widget"))
      .not.toBeInTheDocument();

    // Act — a real focus event, not a value change: showing OTP intent by
    // clicking into the field is enough, before anything is even typed.
    await screen.getByLabelText(/email/i).click();

    // Assert
    await expect
      .element(screen.getByTestId("turnstile-widget"))
      .toBeInTheDocument();
  });

  it("still sends a captcha token when the email field was focused before sending a code", async () => {
    // Arrange — proves the lazy mount leaves enough time for a real widget
    // to solve its challenge before the visitor can possibly submit: this
    // fake mounts and reports its token synchronously, but the ordering
    // (focus/fill, then submit) is the same shape a real solve would need.
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderLoginPage(login);

    // Act
    await screen.getByLabelText(/email/i).fill("ada@example.com");
    await screen.getByRole("button", { name: "Send code" }).click();

    // Assert
    await vi.waitFor(() => {
      expect(login).toHaveBeenCalledExactlyOnceWith({
        email: "ada@example.com",
        requestOtp: true,
        captchaToken: FAKE_CAPTCHA_TOKEN,
      });
    });
  });

  it("shows a visible link to the register flow so a new visitor can see how to create an account", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);

    // Act
    const screen = await renderLoginPage(login);

    // Assert
    const registerLink = screen.getByRole("link", { name: "Create one" });
    await expect.element(registerLink).toBeInTheDocument();
    await expect
      .element(registerLink)
      .toHaveAttribute("href", expect.stringContaining("/register"));
  });
});
