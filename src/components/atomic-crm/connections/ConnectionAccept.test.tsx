import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, type DataProvider } from "ra-core";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { ConnectionInvitePreview, MyContext } from "../types";
import { ConnectionAccept } from "./ConnectionAccept";

/**
 * Pins Story 8.2's accept screen (review finding F7 — zero tests) and,
 * specifically, review finding F9's fix: a raw Postgres error from
 * `acceptConnectionInvite()` (e.g. the unique-constraint message re-inviting
 * an already-connected pair produces) must never reach the user — one
 * generic, translated message always shows instead.
 */

const HOUSEHOLD_CONTEXT: MyContext = {
  account_id: 1,
  kind: "household",
  name: "The Klein Family",
  role: "parent_admin",
  is_active: true,
};

const SHADCHAN_CONTEXT: MyContext = {
  account_id: 9,
  kind: "shadchanus",
  name: "Rivka the Shadchan",
  role: "shadchan",
  is_active: true,
};

const PENDING_PREVIEW: ConnectionInvitePreview = {
  inviter_name: "The Klein Family",
  inviter_kind: "household",
  status: "pending",
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
};

const renderAccept = ({
  preview,
  acceptConnectionInvite = vi.fn().mockResolvedValue(undefined),
  activeContext = SHADCHAN_CONTEXT,
  token = "test-token",
}: {
  preview: ConnectionInvitePreview | null;
  acceptConnectionInvite?: ReturnType<typeof vi.fn>;
  activeContext?: MyContext | null;
  token?: string;
}) => {
  const dataProvider = {
    previewConnectionInvite: vi.fn().mockResolvedValue(preview),
    acceptConnectionInvite,
    getMyContexts: vi
      .fn()
      .mockResolvedValue(activeContext ? [activeContext] : []),
  } as unknown as DataProvider;

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  // The router must be the OUTERMOST element — see InviteAcceptance.test.tsx's
  // own comment on why (CoreAdminContext only skips its internal Router when
  // it detects it is already inside one).
  const router = createMemoryRouter(
    [
      {
        path: "/connect/:token",
        element: (
          <CoreAdminContext
            dataProvider={dataProvider}
            queryClient={queryClient}
            i18nProvider={testI18nProvider}
          >
            <ConnectionAccept />
            <Notification />
          </CoreAdminContext>
        ),
      },
      { path: "/shadchanim", element: <div>The shadchanim book</div> },
      { path: "/connections", element: <div>The connections list</div> },
    ],
    { initialEntries: [`/connect/${token}`] },
  );

  return { dataProvider, render: render(<RouterProvider router={router} />) };
};

describe("ConnectionAccept", () => {
  it("renders the inviter's name and an Accept button for a valid pending invite", async () => {
    // Arrange / Act
    const { render: screenPromise } = renderAccept({
      preview: PENDING_PREVIEW,
    });
    const screen = await screenPromise;

    // Assert
    await expect
      .element(screen.getByText("Connect with The Klein Family"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Accept" }))
      .toBeInTheDocument();
  });

  it("shows one generic 'not valid' message for a null preview (unknown, expired, revoked and consumed are all indistinguishable)", async () => {
    // Arrange / Act
    const { render: screenPromise } = renderAccept({ preview: null });
    const screen = await screenPromise;

    // Assert
    await expect
      .element(screen.getByText("This invite link isn't valid"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Accept" }))
      .not.toBeInTheDocument();
  });

  it("clicking Accept calls acceptConnectionInvite with the token, then routes the SHADCHAN side to /connections", async () => {
    // Arrange
    const acceptConnectionInvite = vi.fn().mockResolvedValue(undefined);
    const { render: screenPromise } = renderAccept({
      preview: PENDING_PREVIEW,
      acceptConnectionInvite,
      activeContext: SHADCHAN_CONTEXT,
      token: "the-real-token",
    });
    const screen = await screenPromise;
    await expect
      .element(screen.getByRole("button", { name: "Accept" }))
      .toBeInTheDocument();

    // Act
    await screen.getByRole("button", { name: "Accept" }).click();

    // Assert
    await expect
      .element(screen.getByText("The connections list"))
      .toBeVisible();
    expect(acceptConnectionInvite).toHaveBeenCalledExactlyOnceWith(
      "the-real-token",
    );
  });

  it("clicking Accept routes the HOUSEHOLD side to /shadchanim", async () => {
    // Arrange
    const { render: screenPromise } = renderAccept({
      preview: PENDING_PREVIEW,
      activeContext: HOUSEHOLD_CONTEXT,
    });
    const screen = await screenPromise;
    await expect
      .element(screen.getByRole("button", { name: "Accept" }))
      .toBeInTheDocument();

    // Act
    await screen.getByRole("button", { name: "Accept" }).click();

    // Assert
    await expect.element(screen.getByText("The shadchanim book")).toBeVisible();
  });

  it("review finding F9 — a raw Postgres error from acceptConnectionInvite never reaches the user; one generic, translated message shows instead", async () => {
    // Arrange — the exact shape a re-invite of an already-connected pair
    // produces over PostgREST (a unique-constraint violation), which also
    // contains a literal `%` risk if ever used as a raw i18n key.
    const acceptConnectionInvite = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'duplicate key value violates unique constraint "connections_live_pair_idx"',
        ),
      );
    const { render: screenPromise } = renderAccept({
      preview: PENDING_PREVIEW,
      acceptConnectionInvite,
    });
    const screen = await screenPromise;
    await expect
      .element(screen.getByRole("button", { name: "Accept" }))
      .toBeInTheDocument();

    // Act
    await screen.getByRole("button", { name: "Accept" }).click();

    // Assert — the friendly, translated message renders...
    await expect
      .element(screen.getByText("Couldn't accept that invite. Try again."))
      .toBeInTheDocument();
    // ...and the raw database error string is nowhere on the page.
    await expect
      .element(screen.getByText(/connections_live_pair_idx/))
      .not.toBeInTheDocument();
    // The failed attempt does not navigate away.
    await expect
      .element(screen.getByRole("button", { name: "Accept" }))
      .toBeInTheDocument();
  });
});
