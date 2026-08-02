import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type {
  Account,
  Connection,
  ConnectionInvite,
  MyContext,
} from "../types";
import { ConnectionSection } from "./ConnectionSection";

/**
 * Pins Story 8.2's Settings UI (review finding F7 — 360 lines with zero
 * tests) and, specifically, review finding F3's fix: the household panel's
 * connected list and its "End connection" button are driven by the
 * `connections` resource directly, never by `shadchanim.connection_id` — so
 * they must render correctly even when the dataProvider never returns a
 * `shadchanim` row at all (the deleted-book-row scenario the finding
 * proved).
 */

const householdContext: MyContext = {
  account_id: 1,
  kind: "household",
  name: "The Klein Family",
  role: "parent_admin",
  is_active: true,
};

const shadchanContext: MyContext = {
  account_id: 9,
  kind: "shadchanus",
  name: "Rivka the Shadchan",
  role: "shadchan",
  is_active: true,
};

const buildConnection = (overrides: Partial<Connection> = {}): Connection => ({
  id: 100,
  household_account_id: 1,
  shadchanus_account_id: 5,
  status: "accepted",
  ended_at: null,
  proposed_by_account_id: 1,
  accepted_at: "2026-01-01T00:00:00Z",
  ended_by_account_id: null,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const buildAccount = (overrides: Partial<Account> = {}): Account =>
  ({
    id: 5,
    name: "Rivka the Shadchan",
    transparency_level: "shared",
    kind: "shadchanus",
    default_thread_visibility: "open",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Account;

const buildInvite = (
  overrides: Partial<ConnectionInvite> = {},
): ConnectionInvite =>
  ({
    id: 7,
    inviter_account_id: 1,
    inviter_kind: "household",
    token_hash: "deadbeef",
    status: "pending",
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    accepted_by_account_id: null,
    accepted_at: null,
    revoked_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as ConnectionInvite;

type ListByResource = Record<string, { data: unknown[]; total: number }>;
type ManyByResource = Record<string, unknown[]>;

const buildDataProvider = (
  lists: ListByResource = {},
  many: ManyByResource = {},
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getList: vi.fn((resource: string) =>
      Promise.resolve(lists[resource] ?? { data: [], total: 0 }),
    ),
    getMany: vi.fn((resource: string) =>
      Promise.resolve({ data: many[resource] ?? [] }),
    ),
    createConnectionInvite: vi.fn().mockResolvedValue("plaintext-token"),
    endConnection: vi.fn().mockResolvedValue(undefined),
    revokeConnectionInvite: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderSection = async (
  context: MyContext,
  lists: ListByResource = {},
  many: ManyByResource = {},
  overrides: Partial<CrmDataProvider> = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [context]);
  const dataProvider = buildDataProvider(lists, many, overrides);

  const screen = await render(
    <TestMemoryRouter initialEntries={["/settings"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ConnectionSection />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, queryClient, dataProvider };
};

describe("ConnectionSection — household panel", () => {
  it("offers a 'Connect with a shadchan' action and no connected list when there is none", async () => {
    // Arrange / Act
    const { screen } = await renderSection(householdContext, {
      connections: { data: [], total: 0 },
    });

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Connect with a shadchan" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "End connection" }))
      .not.toBeInTheDocument();
  });

  it("clicking 'Connect with a shadchan' creates an invite and shows the copyable link", async () => {
    // Arrange
    const { screen, dataProvider } = await renderSection(householdContext, {
      connections: { data: [], total: 0 },
    });

    // Act
    await screen
      .getByRole("button", { name: "Connect with a shadchan" })
      .click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.createConnectionInvite as ReturnType<typeof vi.fn>).mock
            .calls.length,
      )
      .toBeGreaterThan(0);
    await expect
      .element(screen.getByRole("button", { name: "Copy" }))
      .toBeInTheDocument();
  });

  it("review finding F3 — renders the connected shadchan and an End connection button from `connections` alone, with NO shadchanim data at all", async () => {
    // Arrange — the dataProvider is never asked for (and never returns) a
    // `shadchanim` row; the panel must not depend on one.
    const { screen } = await renderSection(
      householdContext,
      { connections: { data: [buildConnection()], total: 1 } },
      { accounts: [buildAccount()] },
    );

    // Assert
    await expect
      .element(screen.getByText("Rivka the Shadchan"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "End connection" }))
      .toBeInTheDocument();
  });

  it("review finding F3 — the End connection button survives even after the household's shadchanim book row is gone (the deletable-record scenario)", async () => {
    // Arrange — same as above: no `shadchanim` resource call is even made
    // by this panel, so a deleted book row cannot remove this button.
    const { screen, dataProvider } = await renderSection(
      householdContext,
      { connections: { data: [buildConnection()], total: 1 } },
      { accounts: [buildAccount()] },
    );

    // Act
    await screen.getByRole("button", { name: "End connection" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.endConnection as ReturnType<typeof vi.fn>).mock.calls
            .length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.endConnection).toHaveBeenCalledWith(100);
  });

  it("shows no End connection button for an already-ended connection", async () => {
    // Arrange
    const { screen } = await renderSection(
      householdContext,
      {
        connections: {
          data: [
            buildConnection({
              status: "ended",
              ended_at: "2026-02-01T00:00:00Z",
            }),
          ],
          total: 1,
        },
      },
      { accounts: [buildAccount()] },
    );

    // Assert
    await expect
      .element(screen.getByText("Connection ended"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "End connection" }))
      .not.toBeInTheDocument();
  });

  it("review finding F8 — lists a pending outstanding invite with a Cancel invite button, and cancelling it calls revokeConnectionInvite", async () => {
    // Arrange
    const { screen, dataProvider } = await renderSection(householdContext, {
      connections: { data: [], total: 0 },
      connection_invites: { data: [buildInvite({ id: 7 })], total: 1 },
    });

    // Assert — the pending invite renders...
    await expect
      .element(screen.getByText("Invite link pending"))
      .toBeInTheDocument();

    // Act
    await screen.getByRole("button", { name: "Cancel invite" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.revokeConnectionInvite as ReturnType<typeof vi.fn>).mock
            .calls.length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.revokeConnectionInvite).toHaveBeenCalledWith(7);
  });

  it("shows no pending-invite section when there are none", async () => {
    // Arrange / Act
    const { screen } = await renderSection(householdContext, {
      connections: { data: [], total: 0 },
      connection_invites: { data: [], total: 0 },
    });

    // Assert
    await expect
      .element(screen.getByText("Invite link pending"))
      .not.toBeInTheDocument();
  });
});

describe("ConnectionSection — shadchan panel", () => {
  it("offers a 'Connect with a family' action and renders a connected household from `connections`", async () => {
    // Arrange
    const household = buildAccount({
      id: 1,
      name: "The Klein Family",
      kind: "household",
    });
    const connection = buildConnection({
      household_account_id: 1,
      shadchanus_account_id: 9,
    });

    // Act
    const { screen } = await renderSection(
      shadchanContext,
      { connections: { data: [connection], total: 1 } },
      { accounts: [household] },
    );

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Connect with a family" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("The Klein Family"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "End connection" }))
      .toBeInTheDocument();
  });

  it("clicking End connection calls dataProvider.endConnection with that connection's id", async () => {
    // Arrange
    const household = buildAccount({
      id: 1,
      name: "The Klein Family",
      kind: "household",
    });
    const connection = buildConnection({
      id: 200,
      household_account_id: 1,
      shadchanus_account_id: 9,
    });
    const { screen, dataProvider } = await renderSection(
      shadchanContext,
      { connections: { data: [connection], total: 1 } },
      { accounts: [household] },
    );

    // Act
    await screen.getByRole("button", { name: "End connection" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.endConnection as ReturnType<typeof vi.fn>).mock.calls
            .length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.endConnection).toHaveBeenCalledWith(200);
  });
});
