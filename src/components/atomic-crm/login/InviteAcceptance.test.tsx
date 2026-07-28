import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  type AuthProvider,
  type DataProvider,
} from "ra-core";
import { createMemoryRouter, RouterProvider } from "react-router";
import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import type { InvitePreview } from "../types";
import { InviteAcceptance } from "./InviteAcceptance";

/**
 * Pins Story 2.7 AC-4: the preview renders (never the inviting account's
 * own data), the 18+ affirmation gates the OTP request (`allowSignup: true`
 * with the invite token / affirmation riding in `meta` — the only caller in
 * the product that ever passes `allowSignup: true`), `email` is read-only
 * (never a typed field), and an invite that is not `pending` renders a
 * clear, specific message instead of the affirmation/OTP flow.
 */

const buildAuthProvider = (login: AuthProvider["login"]): AuthProvider => ({
  login,
  logout: async () => undefined,
  checkAuth: async () => undefined,
  checkError: async () => undefined,
});

const PENDING_INVITE: InvitePreview = {
  email: "ada@example.com",
  account_name: "The Klein Family",
  role: "helper",
  status: "pending",
  expires_at: "2099-01-01T00:00:00.000Z",
};

const renderInviteAcceptance = ({
  invite,
  login = vi.fn().mockResolvedValue(undefined),
  token = "test-token",
}: {
  invite: InvitePreview | null;
  login?: AuthProvider["login"];
  token?: string;
}) => {
  const dataProvider = {
    getInvitePreview: vi.fn().mockResolvedValue(invite),
  } as unknown as DataProvider;

  // The router must be the OUTERMOST element: CoreAdminContext's internal
  // AdminRouter only skips creating its own Router when it detects it is
  // already inside one (useInRouterContext()) — which requires the real
  // router to be an ANCESTOR of CoreAdminContext, not a descendant of it.
  const router = createMemoryRouter(
    [
      {
        path: "/accept-invite/:token",
        element: (
          <CoreAdminContext
            dataProvider={dataProvider}
            authProvider={buildAuthProvider(login)}
            i18nProvider={testI18nProvider}
          >
            <InviteAcceptance />
          </CoreAdminContext>
        ),
      },
    ],
    { initialEntries: [`/accept-invite/${token}`] },
  );

  return render(<RouterProvider router={router} />);
};

describe("InviteAcceptance", () => {
  it("renders the invite preview without an editable email field", async () => {
    // Arrange / Act
    const screen = await renderInviteAcceptance({ invite: PENDING_INVITE });

    // Assert (AC-4)
    await expect
      .element(screen.getByText("You've been invited"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/The Klein Family/))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("ada@example.com"))
      .toBeInTheDocument();
    // No email input anywhere — the address is read-only, taken from the
    // invite, never typed by the invitee.
    await expect
      .element(screen.getByLabelText(/email/i))
      .not.toBeInTheDocument();
  });

  it("does not request a code until the 18+ box is checked", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderInviteAcceptance({
      invite: PENDING_INVITE,
      login,
    });

    // Assert: the affirmation gate is present and login has not fired yet.
    await expect.element(screen.getByRole("checkbox")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("requests a code with allowSignup and the invite token/affirmation once affirmed", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderInviteAcceptance({
      invite: PENDING_INVITE,
      login,
      token: "the-real-token",
    });

    // Act
    await screen.getByRole("checkbox").click();
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert (AC-4) — the only caller in the product that ever passes
    // allowSignup: true, with the token/affirmation in meta.
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();
    expect(login).toHaveBeenCalledExactlyOnceWith({
      email: "ada@example.com",
      requestOtp: true,
      allowSignup: true,
      meta: { invite_token: "the-real-token", age_affirmed: true },
    });
  });

  it("verifies the typed code against the invite's own email", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderInviteAcceptance({
      invite: PENDING_INVITE,
      login,
    });
    await screen.getByRole("checkbox").click();
    await screen.getByRole("button", { name: "Continue" }).click();
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

  it("shows a clear, specific message for an expired invite, never a generic error", async () => {
    // Arrange / Act
    const screen = await renderInviteAcceptance({
      invite: { ...PENDING_INVITE, status: "expired" },
    });

    // Assert
    await expect
      .element(screen.getByText("This invite has expired"))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows a clear, specific message for an invite with no matching row", async () => {
    // Arrange / Act
    const screen = await renderInviteAcceptance({ invite: null });

    // Assert
    await expect
      .element(screen.getByText("This invite link isn't valid"))
      .toBeInTheDocument();
  });

  it("shows a clear, specific message for an already-accepted invite", async () => {
    // Arrange / Act
    const screen = await renderInviteAcceptance({
      invite: { ...PENDING_INVITE, status: "accepted" },
    });

    // Assert
    await expect
      .element(screen.getByText("This invite has already been used"))
      .toBeInTheDocument();
  });

  it("shows a clear, specific message for a revoked invite", async () => {
    // Arrange / Act
    const screen = await renderInviteAcceptance({
      invite: { ...PENDING_INVITE, status: "revoked" },
    });

    // Assert
    await expect
      .element(screen.getByText("This invite has been revoked"))
      .toBeInTheDocument();
  });
});
