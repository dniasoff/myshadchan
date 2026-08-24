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
 *
 * Also pins 2.7 review finding #4: `acceptInvite()` is called only AFTER
 * `verifyOtp()` succeeds, and only then does the flow navigate away — never
 * at the earlier OTP-request step.
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
  acceptInvite = vi.fn().mockResolvedValue(undefined),
  token = "test-token",
}: {
  invite: InvitePreview | null;
  login?: AuthProvider["login"];
  acceptInvite?: ReturnType<typeof vi.fn>;
  token?: string;
}) => {
  const dataProvider = {
    getInvitePreview: vi.fn().mockResolvedValue(invite),
    acceptInvite,
  } as unknown as DataProvider;

  // The router must be the OUTERMOST element: CoreAdminContext's internal
  // AdminRouter only skips creating its own Router when it detects it is
  // already inside one (useInRouterContext()) — which requires the real
  // router to be an ANCESTOR of CoreAdminContext, not a descendant of it.
  // A "/" route exists because a successful verify navigates there
  // (review finding #4) — without it, react-router logs an unmatched-route
  // warning even though nothing in these tests asserts on its content.
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
      { path: "/", element: <div>The signed-in app</div> },
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

  it("states the 18+ affirmation as a consequence of accepting, with no box to tick", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);

    // Act
    const screen = await renderInviteAcceptance({
      invite: PENDING_INVITE,
      login,
    });

    // Assert: the checkbox that used to gate this screen is gone, the
    // sentence it carried is not, and nothing has fired on mere arrival.
    await expect.element(screen.getByRole("checkbox")).not.toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          "By creating an account, you confirm you are 18 years of age or older.",
        ),
      )
      .toBeVisible();
    expect(login).not.toHaveBeenCalled();
  });

  it("requests a code with allowSignup and the invite token on Continue", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderInviteAcceptance({
      invite: PENDING_INVITE,
      login,
      token: "the-real-token",
    });

    // Act
    await screen.getByRole("button", { name: "Continue" }).click();

    // Assert (AC-4) — the only caller in the product that ever passes
    // allowSignup: true, with the token in meta. No `age_affirmed`:
    // check_signup_age()'s Auth Hook is retired, so nothing reads it.
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();
    expect(login).toHaveBeenCalledExactlyOnceWith({
      email: "ada@example.com",
      requestOtp: true,
      allowSignup: true,
      meta: { invite_token: "the-real-token" },
    });
  });

  it("verifies the typed code against the invite's own email", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const screen = await renderInviteAcceptance({
      invite: PENDING_INVITE,
      login,
    });
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

  it("calls acceptInvite() only after verifyOtp() succeeds, then navigates away (review finding #4)", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const acceptInvite = vi.fn().mockResolvedValue(undefined);
    const screen = await renderInviteAcceptance({
      invite: PENDING_INVITE,
      login,
      acceptInvite,
      token: "the-real-token",
    });
    await screen.getByRole("button", { name: "Continue" }).click();

    // Act
    await screen.getByLabelText(/code/i).fill("123456");
    await screen.getByRole("button", { name: "Sign in" }).click();

    // Assert: bound to the SAME token the page was reached with, and the
    // app shell only renders once acceptInvite() has resolved.
    await expect.element(screen.getByText("The signed-in app")).toBeVisible();
    expect(acceptInvite).toHaveBeenCalledExactlyOnceWith("the-real-token");
  });

  it("does not call acceptInvite() when verifyOtp() itself fails", async () => {
    // Arrange
    const login = vi
      .fn()
      .mockResolvedValueOnce(undefined) // the requestOtp call
      .mockRejectedValueOnce(new Error("Invalid code")); // the verifyOtp call
    const acceptInvite = vi.fn().mockResolvedValue(undefined);
    const screen = await renderInviteAcceptance({
      invite: PENDING_INVITE,
      login,
      acceptInvite,
    });
    await screen.getByRole("button", { name: "Continue" }).click();

    // Act
    await screen.getByLabelText(/code/i).fill("000000");
    await screen.getByRole("button", { name: "Sign in" }).click();

    // Assert: a rejected verifyOtp must never reach acceptInvite() — there
    // is no session yet for it to bind against.
    await expect
      .element(screen.getByRole("button", { name: "Sign in" }))
      .toBeInTheDocument();
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it("surfaces acceptInvite()'s own error when verifyOtp() succeeds but binding fails", async () => {
    // Arrange
    const login = vi.fn().mockResolvedValue(undefined);
    const acceptInvite = vi
      .fn()
      .mockRejectedValue(
        new Error("This invite is invalid, expired, or has already been used."),
      );
    const screen = await renderInviteAcceptance({
      invite: PENDING_INVITE,
      login,
      acceptInvite,
    });
    await screen.getByRole("button", { name: "Continue" }).click();

    // Act
    await screen.getByLabelText(/code/i).fill("123456");
    await screen.getByRole("button", { name: "Sign in" }).click();

    // Assert: verifyOtp succeeded (a real session exists) but the app shell
    // must not render on an acceptInvite() failure.
    await expect
      .element(screen.getByText("The signed-in app"))
      .not.toBeInTheDocument();
    expect(acceptInvite).toHaveBeenCalledExactlyOnceWith("test-token");
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
    await expect
      .element(screen.getByRole("button", { name: "Continue" }))
      .not.toBeInTheDocument();
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
