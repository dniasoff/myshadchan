import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, type DataProvider } from "ra-core";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { ChildGrant, ChildGrantPreview } from "../types";
import { GrantAccept } from "./GrantAccept";
// Side-effect import — registers the real singlesDescriptor, needed because
// a successful accept navigates via `buildRecordPath("singles", …)`
// (`entityDescriptor.test.tsx`'s own precedent for why this import exists).
import "./entityDescriptor";

/**
 * Pins Story 13.1's missing half (the accept screen at
 * /accept-grant/:token — see `GrantAccept.tsx`'s own header comment) with
 * a mocked data provider, mirroring `ConnectionAccept.test.tsx`: a valid
 * preview renders the offered access tier prominently, a null preview
 * renders the one generic invalid message, and a rejected
 * `acceptChildGrant` shows a generic message rather than the raw
 * Postgres error.
 */

const PENDING_PREVIEW: ChildGrantPreview = {
  proposer_name: "The Klein Family",
  target_single_name_en: "Chaya",
  target_single_name_he: null,
  status: "pending",
  access_level: "comment",
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
};

const ACCEPTED_GRANT: ChildGrant = {
  id: 5,
  proposer_account_id: 1,
  target_single_id: 42,
  token_hash: "irrelevant-in-this-mock",
  status: "accepted",
  access_level: "comment",
  expires_at: PENDING_PREVIEW.expires_at,
  grantee_account_id: 9,
  accepted_at: new Date().toISOString(),
  revoked_at: null,
  severed_by_account_id: null,
  severed_at: null,
  copy_on_sever: true,
  created_at: new Date().toISOString(),
};

const renderAccept = ({
  preview,
  acceptChildGrant = vi.fn().mockResolvedValue(ACCEPTED_GRANT),
  token = "test-token",
}: {
  preview: ChildGrantPreview | null;
  acceptChildGrant?: ReturnType<typeof vi.fn>;
  token?: string;
}) => {
  const dataProvider = {
    previewChildGrant: vi.fn().mockResolvedValue(preview),
    acceptChildGrant,
  } as unknown as DataProvider;

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  // The router must be the OUTERMOST element — see InviteAcceptance.test.tsx's
  // (and ConnectionAccept.test.tsx's) own comment on why.
  const router = createMemoryRouter(
    [
      {
        path: "/accept-grant/:token",
        element: (
          <CoreAdminContext
            dataProvider={dataProvider}
            queryClient={queryClient}
            i18nProvider={testI18nProvider}
          >
            <GrantAccept />
            <Notification />
          </CoreAdminContext>
        ),
      },
      { path: "/singles/:id", element: <div>The single's own record</div> },
    ],
    { initialEntries: [`/accept-grant/${token}`] },
  );

  return { dataProvider, render: render(<RouterProvider router={router} />) };
};

describe("GrantAccept", () => {
  it("renders the proposer's name, the single's name, and the offered access level for a valid pending grant", async () => {
    // Arrange / Act
    const { render: screenPromise } = renderAccept({
      preview: PENDING_PREVIEW,
    });
    const screen = await screenPromise;

    // Assert
    await expect
      .element(screen.getByText("Share access to Chaya"))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          "The Klein Family would like to share Chaya's record with your household.",
        ),
      )
      .toBeInTheDocument();
    // The offered tier is shown prominently, not folded into the
    // description sentence — this is a real consent moment.
    await expect
      .element(screen.getByText("You're being offered: Can view and comment"))
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
      .element(screen.getByText("This link isn't valid"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Accept" }))
      .not.toBeInTheDocument();
  });

  it("clicking Accept calls acceptChildGrant with the token, then routes to the now-shared single's own record", async () => {
    // Arrange
    const acceptChildGrant = vi.fn().mockResolvedValue(ACCEPTED_GRANT);
    const { render: screenPromise } = renderAccept({
      preview: PENDING_PREVIEW,
      acceptChildGrant,
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
      .element(screen.getByText("The single's own record"))
      .toBeVisible();
    expect(acceptChildGrant).toHaveBeenCalledExactlyOnceWith("the-real-token");
  });

  it("a raw Postgres error from acceptChildGrant never reaches the user; one generic, translated message shows instead", async () => {
    // Arrange — the exact shape a re-accept of an already-accepted grant
    // produces server-side (a check-constraint violation), which also
    // contains a literal `%` risk if ever used as a raw i18n key.
    const acceptChildGrant = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'new row for relation "child_grants" violates check constraint "child_grants_status_check"',
        ),
      );
    const { render: screenPromise } = renderAccept({
      preview: PENDING_PREVIEW,
      acceptChildGrant,
    });
    const screen = await screenPromise;
    await expect
      .element(screen.getByRole("button", { name: "Accept" }))
      .toBeInTheDocument();

    // Act
    await screen.getByRole("button", { name: "Accept" }).click();

    // Assert — the friendly, translated message renders...
    await expect
      .element(
        screen.getByText(
          "Couldn't accept that grant. It may already be used or something changed — try the link again.",
        ),
      )
      .toBeInTheDocument();
    // ...and the raw database error string is nowhere on the page.
    await expect
      .element(screen.getByText(/child_grants_status_check/))
      .not.toBeInTheDocument();
    // The failed attempt does not navigate away.
    await expect
      .element(screen.getByRole("button", { name: "Accept" }))
      .toBeInTheDocument();
  });
});
