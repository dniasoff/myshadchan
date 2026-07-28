import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, type AuthProvider } from "ra-core";
import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import { LoginPage } from "./LoginPage";

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
  it("requests a code without asking to create a user, then moves to the code step", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderLoginPage(login);

    // Act
    await screen.getByLabelText(/email/i).fill("ada@example.com");
    await screen.getByRole("button", { name: "Send code" }).click();

    // Assert: no `allowSignup` — the login form never creates a user (AC-1).
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();
    expect(login).toHaveBeenCalledExactlyOnceWith({
      email: "ada@example.com",
      requestOtp: true,
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
    });
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();
  });
});
