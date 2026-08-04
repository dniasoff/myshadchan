import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
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

/** Fills the email field and checks the 18+ box, without pressing Continue —
 * every test that needs to reach the code step starts from here. */
const fillDetailsStep = async (
  screen: Awaited<ReturnType<typeof renderRegisterFlow>>,
  email: string,
) => {
  await screen.getByLabelText(/email/i).fill(email);
  await screen.getByRole("checkbox").click();
};

describe("RegisterFlow", () => {
  it("requests a code with allowSignup and the age affirmation, plus a captcha token", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderRegisterFlow(login);
    await fillDetailsStep(screen, "ada@example.com");

    // Act
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert: this is the one screen allowed to create a user (mirroring
    // InviteAcceptance) — allowSignup, the age affirmation in meta, AND the
    // captcha token, all forwarded on the same call.
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();
    expect(login).toHaveBeenCalledExactlyOnceWith({
      email: "ada@example.com",
      requestOtp: true,
      allowSignup: true,
      meta: { age_affirmed: true },
      captchaToken: FAKE_CAPTCHA_TOKEN,
    });
  });

  it("does not request a code until the age checkbox is checked", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderRegisterFlow(login);

    // Act: fill the email but never check the box — AgeAffirmation disables
    // its own Continue button until checked (see AgeAffirmation.tsx), so
    // there is no click that could ever reach handleContinue here.
    await screen.getByLabelText(/email/i).fill("ada@example.com");

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Continue" }))
      .toBeDisabled();
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

  it("resends a code reusing the same email, allowSignup and age affirmation", async () => {
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
      meta: { age_affirmed: true },
      captchaToken: FAKE_CAPTCHA_TOKEN,
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
    // Arrange — restarting means re-affirming age, not just picking a new
    // email (RegisterFlow's own doc comment; OtpCodeStep's own doc comment
    // records the same reasoning).
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
});
