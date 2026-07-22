import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, type AuthProvider } from "ra-core";
import { Notification } from "@/components/admin/notification";
import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import { GoogleSignInButton } from "./GoogleSignInButton";

// Minimal AuthProvider stub: only `login` matters for these tests, the other
// methods are never exercised by GoogleSignInButton but are required by the
// AuthProvider type.
const buildAuthProvider = (loginError: unknown): AuthProvider => ({
  login: () => Promise.reject(loginError),
  logout: async () => undefined,
  checkAuth: async () => undefined,
  checkError: async () => undefined,
});

const renderButton = (loginError: unknown) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <CoreAdminContext
      authProvider={buildAuthProvider(loginError)}
      i18nProvider={testI18nProvider}
    >
      {children}
      <Notification />
    </CoreAdminContext>
  );

  return render(<GoogleSignInButton />, { wrapper: Wrapper });
};

describe("GoogleSignInButton", () => {
  beforeEach(() => {
    // The button only exists when the deployment declares the provider
    // configured; every test below is about how it behaves once it does.
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders nothing when the deployment has not enabled the provider", async () => {
    // Arrange: no VITE_ENABLE_GOOGLE_OAUTH, which is the default. Rendering the
    // button then would offer a control that can only fail after the redirect
    // with "Unsupported provider: provider is not enabled".
    vi.stubEnv("VITE_ENABLE_GOOGLE_OAUTH", "");

    // Act
    const screen = await renderButton(new Error());

    // Assert
    await expect
      .element(screen.getByRole("button", { name: /google/i }))
      .not.toBeInTheDocument();
  });

  it("surfaces the real Supabase error when the Google provider is not enabled", async () => {
    // Arrange: the Supabase project has the button visible (VITE_ENABLE_GOOGLE_OAUTH=true)
    // but the Google provider itself is disabled/unconfigured, which is exactly the
    // message GoTrue returns from its /auth/v1/authorize endpoint in that case.
    const screen = await renderButton(
      new Error("Unsupported provider: provider is not enabled"),
    );

    // Act
    await screen.getByRole("button", { name: /sign in with google/i }).click();

    // Assert
    await expect
      .element(
        screen.getByText("Unsupported provider: provider is not enabled"),
      )
      .toBeInTheDocument();
  });

  it("falls back to a clear configuration message when the rejection carries no message", async () => {
    // Arrange: a rejection without a usable message (e.g. a client-side failure) must
    // not surface react-admin's generic "Authentication failed, please retry" default,
    // which wrongly suggests retrying would help.
    const screen = await renderButton(new Error());

    // Act
    await screen.getByRole("button", { name: /sign in with google/i }).click();

    // Assert
    await expect
      .element(screen.getByText(/google sign-in is not configured/i))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/authentication failed, please retry/i))
      .not.toBeInTheDocument();
  });
});
