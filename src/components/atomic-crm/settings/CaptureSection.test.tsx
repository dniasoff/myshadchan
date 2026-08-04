import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { Account, MyContext } from "../types";
import { CaptureSection } from "./CaptureSection";

/**
 * Epic 11: the per-household capture address, read from
 * `accounts.inbound_email_token` via the active context — replaces the
 * retired `VITE_INBOUND_EMAIL` env-var path this section used to render.
 * Mirrors `ConnectionSection.test.tsx`'s own harness (a query client
 * pre-seeded with `MY_CONTEXTS_QUERY_KEY`, a mocked `CrmDataProvider`).
 */

const householdContext: MyContext = {
  account_id: 1,
  kind: "household",
  name: "The Klein Family",
  role: "parent_admin",
  is_active: true,
};

const shadchanusContext: MyContext = {
  account_id: 9,
  kind: "shadchanus",
  name: "Golden Matches Shadchanus",
  role: "shadchan",
  is_active: true,
};

const buildAccount = (overrides: Partial<Account> = {}): Account =>
  ({
    id: 1,
    name: "The Klein Family",
    transparency_level: "shared",
    kind: "household",
    default_thread_visibility: "open",
    inbound_email_token: "a1b2c3d4e5f6",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Account;

const renderSection = async (
  context: MyContext,
  account: Account | null = buildAccount(),
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [context]);

  const dataProvider = {
    getOne: vi.fn(async (resource: string, params: { id: unknown }) => {
      if (resource === "accounts" && account && params.id === account.id) {
        return { data: account };
      }
      throw new Error(`Unexpected getOne: ${resource} ${String(params.id)}`);
    }),
  } as unknown as CrmDataProvider;

  const screen = await render(
    <TestMemoryRouter initialEntries={["/settings"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <CaptureSection />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("CaptureSection", () => {
  it("renders this household's own capture address, built from inbound_email_token, with a copy button", async () => {
    // Arrange / Act
    const { screen } = await renderSection(householdContext);

    // Assert
    await expect
      .element(screen.getByRole("textbox"))
      .toHaveValue("a1b2c3d4e5f6@myshadchan.space");
    await expect
      .element(screen.getByRole("button", { name: "Copy" }))
      .toBeInTheDocument();
  });

  it("explains that an unrecognized sender's mail waits for review before sharing the address", async () => {
    // Arrange / Act
    const { screen } = await renderSection(householdContext);

    // Assert
    await expect
      .element(screen.getByText(/mail from a sender we don't recognize waits/i))
      .toBeInTheDocument();
  });

  it("renders nothing for a shadchanus account — no household inbox to capture into", async () => {
    // Arrange / Act
    const { screen, dataProvider } = await renderSection(
      shadchanusContext,
      null,
    );

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Copy" }))
      .not.toBeInTheDocument();
    // The account is never even fetched for a shadchanus context — the
    // `enabled` guard is what keeps a broken address from ever being built.
    expect(dataProvider.getOne).not.toHaveBeenCalled();
  });

  it("renders nothing while the account hasn't loaded yet, rather than a blank or broken address", async () => {
    // Arrange
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [householdContext]);
    const dataProvider = {
      getOne: vi.fn(() => new Promise(() => {})), // never resolves
    } as unknown as CrmDataProvider;

    // Act
    const screen = await render(
      <TestMemoryRouter initialEntries={["/settings"]}>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <CaptureSection />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Copy" }))
      .not.toBeInTheDocument();
  });

  it("renders nothing when the household account somehow carries no token — fails closed, never shows a broken address", async () => {
    // Arrange / Act
    const { screen } = await renderSection(
      householdContext,
      buildAccount({ inbound_email_token: null }),
    );

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Copy" }))
      .not.toBeInTheDocument();
  });

  it("shows 'Copied' after the copy button is clicked", async () => {
    // Arrange
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const { screen } = await renderSection(householdContext);

    // Act
    await screen.getByRole("button", { name: "Copy" }).click();

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Copied" }))
      .toBeInTheDocument();
  });
});
