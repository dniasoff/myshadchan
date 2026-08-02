import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { Account, MyContext } from "../types";
import { CommunicationSection } from "./CommunicationSection";

/**
 * Story 7.2 (AC-5, AC-6c): the household's own default-visibility control.
 * Pins the four cases the story's Task 6 names — renders for a non-single
 * role, does not render for `single`, renders nothing while the role is
 * still resolving, and a change issues the expected
 * `dataProvider.update("accounts", …)` call.
 */

const HOUSEHOLD_CONTEXT: MyContext = {
  account_id: 1,
  kind: "household",
  name: "The Klein Family",
  role: "parent_admin",
  is_active: true,
};

const SINGLE_CONTEXT: MyContext = {
  ...HOUSEHOLD_CONTEXT,
  role: "single",
};

const buildAccount = (
  visibility: Account["default_thread_visibility"] = "open",
): Account => ({
  id: 1,
  name: "The Klein Family",
  transparency_level: "shared",
  kind: "household",
  default_thread_visibility: visibility,
  created_at: "2026-01-01T00:00:00Z",
});

const ACCOUNTS_GET_ONE_KEY = (id: number) => [
  "accounts",
  "getOne",
  { id: String(id), meta: undefined },
];

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getOne: vi.fn().mockResolvedValue({ data: buildAccount() }),
    update: vi.fn().mockResolvedValue({ data: buildAccount() }),
    ...overrides,
  }) as unknown as CrmDataProvider;

/** `contexts === undefined` mirrors `useMyContexts()` genuinely in flight
 * (no cache entry, `getMyContexts` never resolving) — the same shape
 * `ProfileSection.test.tsx` uses for an unresolved identity. */
const renderSection = async ({
  contexts,
  account,
  dataProviderOverrides = {},
}: {
  contexts: MyContext[] | undefined;
  account?: Account;
  dataProviderOverrides?: Partial<CrmDataProvider>;
}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (contexts !== undefined) {
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, contexts);
  }
  if (account !== undefined) {
    queryClient.setQueryData(
      ACCOUNTS_GET_ONE_KEY(account.id as number),
      account,
    );
  }

  const getMyContexts =
    contexts === undefined
      ? vi.fn().mockReturnValue(new Promise<never>(() => {}))
      : vi.fn().mockResolvedValue(contexts);

  const dataProvider = buildDataProvider({
    getMyContexts,
    ...dataProviderOverrides,
  });

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <CommunicationSection />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("CommunicationSection", () => {
  it("renders the open/private control for a parent_admin", async () => {
    // Arrange / Act
    const { screen } = await renderSection({
      contexts: [HOUSEHOLD_CONTEXT],
      account: buildAccount("open"),
    });

    // Assert
    await expect.element(screen.getByText("Communication")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("radio", { name: /Open/ }))
      .toBeChecked();
    await expect
      .element(screen.getByRole("radio", { name: /Private/ }))
      .not.toBeChecked();
  });

  it("does not render for a single-role member", async () => {
    // Arrange / Act
    const { screen } = await renderSection({
      contexts: [SINGLE_CONTEXT],
      account: buildAccount("open"),
    });

    // Assert
    expect(screen.container.querySelector('[data-slot="item-group"]')).toBe(
      null,
    );
  });

  it("renders nothing while the role is still resolving", async () => {
    // Arrange / Act
    const { screen } = await renderSection({ contexts: undefined });

    // Assert
    expect(screen.container.querySelector('[data-slot="item-group"]')).toBe(
      null,
    );
  });

  it("changing the selection calls dataProvider.update with the new visibility", async () => {
    // Arrange
    const update = vi.fn().mockResolvedValue({ data: buildAccount("private") });
    const { screen } = await renderSection({
      contexts: [HOUSEHOLD_CONTEXT],
      account: buildAccount("open"),
      dataProviderOverrides: { update },
    });

    // Act
    await screen.getByRole("radio", { name: /Private/ }).click();

    // Assert
    expect(update).toHaveBeenCalledExactlyOnceWith("accounts", {
      id: 1,
      data: { default_thread_visibility: "private" },
      previousData: { id: 1 },
    });
  });

  it("a no-op change (same value) never calls update", async () => {
    // Arrange
    const update = vi.fn().mockResolvedValue({ data: buildAccount("open") });
    const { screen } = await renderSection({
      contexts: [HOUSEHOLD_CONTEXT],
      account: buildAccount("open"),
      dataProviderOverrides: { update },
    });

    // Act
    await screen.getByRole("radio", { name: /Open/ }).click();

    // Assert
    expect(update).not.toHaveBeenCalled();
  });
});
