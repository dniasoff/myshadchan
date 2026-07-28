import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { Invite, MyContext } from "../types";
import { InvitesSection } from "./InvitesSection";

/**
 * Pins Story 2.8's Task 6 requirements: AC-1's role selector options mirror
 * the caller's own `role_authority()` (a `helper` sees no invitable options
 * — and no send form at all); AC-3/AC-4's revoke button appears only for a
 * `pending` (and not-yet-expired) invite.
 */

const parentContext: MyContext = {
  account_id: 1,
  kind: "household",
  name: "The Klein Family",
  role: "parent_admin",
  is_active: true,
};

const helperContext: MyContext = {
  account_id: 1,
  kind: "household",
  name: "The Klein Family",
  role: "helper",
  is_active: true,
};

const buildInvite = (overrides: Partial<Invite> = {}): Invite => ({
  id: 1,
  token: "11111111-1111-1111-1111-111111111111",
  email: "friend@example.com",
  account_id: 1,
  role: "helper",
  invited_by: 1,
  status: "pending",
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  accepted_at: null,
  created_at: new Date().toISOString(),
  ...overrides,
});

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    createInvite: vi.fn(),
    revokeInvite: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderSection = async (
  context: MyContext,
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [context]);
  const dataProvider = buildDataProvider({
    getMyContexts: vi.fn().mockResolvedValue([context]),
    ...dataProviderOverrides,
  });

  const screen = await render(
    <TestMemoryRouter initialEntries={["/settings"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <InvitesSection />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, queryClient, dataProvider };
};

describe("InvitesSection", () => {
  it("offers exactly the roles a parent_admin's own authority permits (household context)", async () => {
    // Arrange / Act
    const { screen } = await renderSection(parentContext);
    await screen.getByRole("combobox").click();

    // Assert — parent_admin (authority 3) may invite parent_admin/helper/
    // single (all <= 3, all valid in a household-kind account) but never
    // shadchan (invalid in a household-kind account regardless of authority).
    await expect
      .element(screen.getByRole("option", { name: "Parent / admin" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("option", { name: "Helper" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("option", { name: "Single" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("option", { name: "Shadchan" }))
      .not.toBeInTheDocument();
  });

  it("shows no invitable options — and no send form at all — for a non-owning caller (helper)", async () => {
    // Arrange / Act — helper is not in role_authority()'s invite-capable
    // set at all, so invitableRoles() returns [] and the form never renders,
    // rather than rendering an empty/disabled selector.
    const { screen } = await renderSection(helperContext);

    // Assert
    await expect.element(screen.getByRole("combobox")).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Send invite" }))
      .not.toBeInTheDocument();
  });

  it("shows a Revoke button only for a still-pending, not-yet-expired invite", async () => {
    // Arrange
    const invites = [
      buildInvite({ id: 1, status: "pending", email: "pending@example.com" }),
      buildInvite({
        id: 2,
        status: "accepted",
        email: "accepted@example.com",
      }),
      buildInvite({ id: 3, status: "revoked", email: "revoked@example.com" }),
      buildInvite({
        id: 4,
        status: "pending",
        email: "expired@example.com",
        expires_at: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    ];

    // Act
    const { screen } = await renderSection(parentContext, {
      getList: vi
        .fn()
        .mockResolvedValue({ data: invites, total: invites.length }),
    });

    // Assert — all four rows render...
    await expect
      .element(screen.getByText("pending@example.com"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("expired@example.com"))
      .toBeInTheDocument();
    // ...but exactly one Revoke button (the genuinely pending, unexpired row).
    await expect
      .poll(
        () => screen.getByRole("button", { name: "Revoke" }).elements().length,
      )
      .toBe(1);
  });

  it("shows no Revoke button for a non-owning caller (helper), even on pending invites (review finding #1)", async () => {
    // Arrange — a helper cannot revoke server-side (is_invite_capable_role()
    // excludes it), so the button must not render at all rather than fail on
    // click.
    const invites = [
      buildInvite({ id: 1, status: "pending", email: "pending@example.com" }),
    ];

    // Act
    const { screen } = await renderSection(helperContext, {
      getList: vi
        .fn()
        .mockResolvedValue({ data: invites, total: invites.length }),
    });

    // Assert
    await expect
      .element(screen.getByText("pending@example.com"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Revoke" }))
      .not.toBeInTheDocument();
  });

  it("clicking Revoke calls dataProvider.revokeInvite with that invite's id", async () => {
    // Arrange
    const revokeInvite = vi.fn().mockResolvedValue(undefined);
    const invites = [buildInvite({ id: 42, status: "pending" })];
    const { screen } = await renderSection(parentContext, {
      getList: vi.fn().mockResolvedValue({ data: invites, total: 1 }),
      revokeInvite,
    });

    // Act
    await screen.getByRole("button", { name: "Revoke" }).click();

    // Assert
    await expect.poll(() => revokeInvite.mock.calls.length).toBeGreaterThan(0);
    expect(revokeInvite).toHaveBeenCalledWith(42);
  });
});
