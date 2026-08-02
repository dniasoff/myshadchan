import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import type * as UseViewerRole from "../entity360/useViewerRole";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { Account, MemberRole, MyContext } from "../types";
import { CommunicationSection } from "./CommunicationSection";

/**
 * Story 7.2 (AC-5, AC-6c): the household's own default-visibility control.
 * Pins the cases the story's Task 6 names — renders for a non-single role,
 * does not render for `single`, renders nothing while the role is still
 * resolving, and a change issues the expected
 * `dataProvider.update("accounts", …)` call.
 *
 * Review finding F1: the "Private" choice is disabled until Story 7.3
 * ships enforcement (see `CommunicationSection.tsx`'s header comment) — the
 * selection test below now starts from `'private'` and switches to
 * `'open'`, the one direction the control still allows, plus a dedicated
 * test proving the disabled option is inert.
 *
 * Review finding F2: `useViewerRole` is mocked (module-level, with a
 * passthrough default to the REAL implementation — same pattern as
 * `shadchanim/ShadchanCardGrid.test.tsx`'s `useGetList` mock) so the
 * "still resolving" case can be asserted with `isPending: true` WHILE the
 * account is already cached and resolvable. Before this fix, the suite's
 * only "still resolving" test passed `contexts: undefined`, which ALSO
 * makes `activeContext` (and therefore the account fetch) unresolved — so
 * deleting the `isRolePending` guard from `CommunicationSection.tsx` left
 * every test green, because the later `if (!account) return null` silently
 * covered for it. The new test below decouples the two: role pending,
 * account already available — it fails red without the guard.
 */

const { useViewerRoleMock, setRealUseViewerRole, resetUseViewerRoleMock } =
  vi.hoisted(() => {
    type ViewerRoleResult = { role: unknown; isPending: boolean };
    let real: (() => ViewerRoleResult) | undefined;
    const mock = vi.fn(() => real?.());
    return {
      useViewerRoleMock: mock,
      setRealUseViewerRole: (fn: () => ViewerRoleResult) => {
        real = fn;
      },
      resetUseViewerRoleMock: () => {
        mock.mockReset();
        mock.mockImplementation(() => real?.());
      },
    };
  });

vi.mock("../entity360/useViewerRole", async (importOriginal) => {
  const actual = await importOriginal<typeof UseViewerRole>();
  setRealUseViewerRole(actual.useViewerRole);
  return { ...actual, useViewerRole: useViewerRoleMock };
});

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
  beforeEach(() => {
    resetUseViewerRoleMock();
  });

  it("renders the open/private control for a parent_admin, with private disabled", async () => {
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
    const privateRadio = screen.getByRole("radio", { name: /Private/ });
    await expect.element(privateRadio).not.toBeChecked();
    await expect.element(privateRadio).toBeDisabled();
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

  it("renders nothing while contexts have not resolved at all", async () => {
    // Arrange / Act
    const { screen } = await renderSection({ contexts: undefined });

    // Assert
    expect(screen.container.querySelector('[data-slot="item-group"]')).toBe(
      null,
    );
  });

  it("renders nothing while the role is pending, even though the account and contexts are already resolved (F2)", async () => {
    // Arrange — decouple `isRolePending` from `activeContext`/`account`
    // being unresolved: contexts and account are both cached and ready,
    // only the mocked role resolution is still pending.
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin" as MemberRole,
      isPending: true,
    });

    // Act
    const { screen } = await renderSection({
      contexts: [HOUSEHOLD_CONTEXT],
      account: buildAccount("open"),
    });

    // Assert
    expect(screen.container.querySelector('[data-slot="item-group"]')).toBe(
      null,
    );
  });

  it("switching from private back to open calls dataProvider.update with the new visibility", async () => {
    // Arrange — start from 'private' (the one direction the disabled
    // "Private" radio still permits: away from it, never into it).
    // `getOne` must also resolve to 'private' — `buildDataProvider`'s
    // default resolves 'open', and `useGetOne`'s default-`staleTime`
    // background refetch would otherwise silently overwrite the seeded
    // cache before the click fires, making the two values match and the
    // change a no-op.
    const update = vi.fn().mockResolvedValue({ data: buildAccount("open") });
    const getOne = vi.fn().mockResolvedValue({ data: buildAccount("private") });
    const { screen } = await renderSection({
      contexts: [HOUSEHOLD_CONTEXT],
      account: buildAccount("private"),
      dataProviderOverrides: { update, getOne },
    });

    // Act
    await screen.getByRole("radio", { name: /Open/ }).click();

    // Assert
    expect(update).toHaveBeenCalledExactlyOnceWith("accounts", {
      id: 1,
      data: { default_thread_visibility: "open" },
      previousData: { id: 1 },
    });
  });

  it("clicking the disabled Private option never calls update (F1)", async () => {
    // Arrange
    const update = vi.fn().mockResolvedValue({ data: buildAccount("open") });
    const { screen } = await renderSection({
      contexts: [HOUSEHOLD_CONTEXT],
      account: buildAccount("open"),
      dataProviderOverrides: { update },
    });

    // Act — a disabled radio does not fire onValueChange; this proves it,
    // rather than trusting the `disabled` attribute alone.
    await screen.getByRole("radio", { name: /Private/ }).click({
      force: true,
    });

    // Assert
    expect(update).not.toHaveBeenCalled();
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
