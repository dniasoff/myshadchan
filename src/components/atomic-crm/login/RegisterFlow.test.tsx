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
import { RegisterFlow } from "./RegisterFlow";
import type { TurnstileWidgetHandle } from "./TurnstileWidget";

// Same deterministic fake as LoginPage.test.tsx — RegisterFlow keeps one
// TurnstileWidget mounted across both its steps and forwards whatever token
// it reports on every requestOtp call (see RegisterFlow's own doc comment).
const FAKE_CAPTCHA_TOKEN = "test-captcha-token";
vi.mock("./TurnstileWidget", () => ({
  TurnstileWidget: forwardRef<
    TurnstileWidgetHandle,
    { onToken: (token: string | null) => void }
  >(({ onToken }, ref) => {
    useImperativeHandle(ref, () => ({ reset: vi.fn() }));
    useEffect(() => {
      onToken(FAKE_CAPTCHA_TOKEN);
    }, [onToken]);
    return null;
  }),
}));

const buildAuthProvider = (login: AuthProvider["login"]): AuthProvider => ({
  login,
  logout: async () => undefined,
  checkAuth: async () => undefined,
  checkError: async () => undefined,
});

const renderRegisterFlow = (login: AuthProvider["login"]) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <CoreAdminContext
      authProvider={buildAuthProvider(login)}
      i18nProvider={testI18nProvider}
    >
      {children}
    </CoreAdminContext>
  );

  return render(<RegisterFlow />, { wrapper: Wrapper });
};

/** Fills the email field, without pressing Continue — every test that needs
 * to reach the code step starts from here. */
const fillDetailsStep = async (
  screen: Awaited<ReturnType<typeof renderRegisterFlow>>,
  email: string,
) => {
  await screen.getByLabelText(/email/i).fill(email);
};

describe("RegisterFlow", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requests a code with allowSignup plus a captcha token", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderRegisterFlow(login);
    await fillDetailsStep(screen, "ada@example.com");

    // Act
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert: this is the one screen allowed to create a user (mirroring
    // InviteAcceptance) — allowSignup AND the captcha token, forwarded on
    // the same call. No `meta.age_affirmed`: nothing reads it now that
    // check_signup_age()'s Auth Hook is retired, and sending it would
    // record an affirmation nobody made.
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();
    expect(login).toHaveBeenCalledExactlyOnceWith({
      email: "ada@example.com",
      requestOtp: true,
      allowSignup: true,
      captchaToken: FAKE_CAPTCHA_TOKEN,
    });
  });

  it("states the 18+ affirmation as a consequence of creating an account", async () => {
    // Arrange: it used to be a checkbox that gated this screen's Continue
    // button. The gate is gone — what remains has to still SAY what
    // creating an account affirms, or the affirmation is nowhere at all.
    const login = vi.fn().mockResolvedValue(undefined);

    // Act
    const screen = await renderRegisterFlow(login);

    // Assert
    await expect.element(screen.getByRole("checkbox")).not.toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          "By creating an account, you confirm you are 18 years of age or older.",
        ),
      )
      .toBeVisible();
  });

  it("refuses to request a code with an empty email, and says so", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderRegisterFlow(login);

    // Act: press Continue having typed nothing. The button is no longer
    // disabled by an affirmation checkbox, so this path is reachable now
    // and handleContinue's own guard is what has to hold.
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert
    await expect
      .element(screen.getByText("Enter your email to continue."))
      .toBeVisible();
    expect(login).not.toHaveBeenCalled();
  });

  it("verifies the typed code without allowSignup or a captcha token", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderRegisterFlow(login);
    await fillDetailsStep(screen, "ada@example.com");
    await screen.getByRole("button", { name: "Continue" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();

    // Act
    await screen.getByLabelText(/code/i).fill("123456");
    await screen.getByRole("button", { name: "Sign in" }).click();

    // Assert: verifyOtp never needs allowSignup or a captcha token — the
    // account was already created by the request step above.
    expect(login).toHaveBeenLastCalledWith({
      email: "ada@example.com",
      token: "123456",
      verifyOtp: true,
    });
  });

  it("resends a code reusing the same email and allowSignup", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderRegisterFlow(login);
    await fillDetailsStep(screen, "ada@example.com");
    await screen.getByRole("button", { name: "Continue" }).click();
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
      allowSignup: true,
      captchaToken: undefined,
    });
  });

  it("shows an error and stays on the details step when the request fails", async () => {
    // Arrange
    const login = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("An account with this email already exists"),
      );
    const screen = await renderRegisterFlow(login);
    await fillDetailsStep(screen, "ada@example.com");

    // Act
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert: the real error surfaces, and the visitor stays on the details
    // step (no premature move to a code step that was never reached).
    await expect
      .element(screen.getByText("An account with this email already exists"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Continue" }))
      .toBeInTheDocument();
  });

  it("does not offer a 'use a different email' link on the code step", async () => {
    // Arrange — see OtpCodeStep's own doc comment for the reasoning.
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderRegisterFlow(login);
    await fillDetailsStep(screen, "ada@example.com");
    await screen.getByRole("button", { name: "Continue" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Use a different email" }))
      .not.toBeInTheDocument();
  });

  it("tells a brand-new signup where the code went exactly once, and never greets them with 'Welcome back'", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderRegisterFlow(login);
    await fillDetailsStep(screen, "ada@example.com");

    // Act
    await screen.getByRole("button", { name: "Continue" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();

    // Assert: this screen's own header used to stay mounted alongside
    // OtpCodeStep's, so the code step printed "We sent a 6-digit code to…"
    // twice, under a "Welcome back" that belongs to signing in — not to an
    // account that was created thirty seconds ago. A second matching
    // element fails this assertion, which is the point of it.
    await expect
      .element(screen.getByText("We sent a 6-digit code to ada@example.com."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Welcome back"))
      .not.toBeInTheDocument();
  });

  it("shows a link back to sign-in for a visitor who already has an account", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);

    // Act
    const screen = await renderRegisterFlow(login);

    // Assert
    const signInLink = screen.getByRole("link", { name: "Sign in" });
    await expect.element(signInLink).toBeInTheDocument();
    await expect
      .element(signInLink)
      .toHaveAttribute("href", expect.stringContaining("/login"));
  });

  it("does not render a Google entry point when Google OAuth is disabled", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);

    // Act
    const screen = await renderRegisterFlow(login);

    // Assert: VITE_ENABLE_GOOGLE_OAUTH is unset in this test — the button
    // must not appear (isGoogleOAuthEnabled() gates it — googleOAuth.ts).
    await expect
      .element(screen.getByRole("button", { name: "Continue with Google" }))
      .not.toBeInTheDocument();
  });

  it("redirects via Google with no email typed and nothing ticked", async () => {
    // Arrange: this is the whole point of the change. Both an email and a
    // ticked box used to be mandatory here, because the affirmation had to
    // reach the server and a Google redirect's only channel for it was a
    // signup_intents row keyed on an email we therefore had to collect.
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderRegisterFlow(login);

    // Act
    await screen.getByRole("button", { name: "Continue with Google" }).click();

    // Assert
    await vi.waitFor(() => {
      expect(login).toHaveBeenCalledExactlyOnceWith({
        oauthProvider: "google",
      });
    });
  });
});
