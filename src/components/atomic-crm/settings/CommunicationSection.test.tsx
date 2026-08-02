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
 * Review finding F1 (Story 7.2, resolved by Story 7.5): the "Private"
 * choice used to be disabled pending Story 7.3's enforcement; 7.3 shipped
 * and this file's own end-to-end sibling
 * (`CommunicationSection.endToEnd.test.tsx`) proves the setting actually
 * takes effect on a real dataProvider, not just that the control is
 * selectable. Both radios are exercised in both directions below (open ->
 * private, private -> open) against a MOCKED dataProvider — this file only
 * proves the control calls `dataProvider.update(...)` with the right
 * arguments.
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
    // Story 7.5: PushNotificationsItem's usePushSubscription() always
    // resolves `useCurrentMemberId()` on mount now — an unstubbed call
    // would throw "Unknown dataProvider function" through
    // useDataProvider()'s own proxy on every test in this file, whether or
    // not that test cares about push at all.
    getCurrentMemberId: vi.fn().mockResolvedValue(1),
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

  it("renders the open/private control for a parent_admin, both options selectable (7.3 enforcement is live)", async () => {
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
    await expect.element(privateRadio).not.toBeDisabled();
  });

  // Story 7.5: the default-visibility control still hides for `single`
  // (every `accounts` write is denied to that role at RLS) — but the
  // section itself, and the push opt-in inside it, no longer disappear
  // with it: push is a device-level setting, not a household-wide one (see
  // `CommunicationSection.tsx`'s own header comment).
  it("hides the default-visibility control for a single-role member, but still renders the push opt-in", async () => {
    // Arrange / Act
    const { screen } = await renderSection({
      contexts: [SINGLE_CONTEXT],
      account: buildAccount("open"),
    });

    // Assert
    expect(screen.getByText("New conversations").query()).toBeNull();
    await expect
      .element(screen.getByText("Push notifications"))
      .toBeInTheDocument();
  });

  it("hides the default-visibility control while contexts have not resolved at all, but still renders the push opt-in", async () => {
    // Arrange / Act
    const { screen } = await renderSection({ contexts: undefined });

    // Assert
    expect(screen.getByText("New conversations").query()).toBeNull();
    await expect
      .element(screen.getByText("Push notifications"))
      .toBeInTheDocument();
  });

  it("hides the default-visibility control while the role is pending, even though the account and contexts are already resolved (F2)", async () => {
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
    expect(screen.getByText("New conversations").query()).toBeNull();
    await expect
      .element(screen.getByText("Push notifications"))
      .toBeInTheDocument();
  });

  it("switching from private back to open calls dataProvider.update with the new visibility", async () => {
    // Arrange — start from 'private'. `getOne` must also resolve to
    // 'private' — `buildDataProvider`'s default resolves 'open', and
    // `useGetOne`'s default-`staleTime` background refetch would otherwise
    // silently overwrite the seeded cache before the click fires, making
    // the two values match and the change a no-op.
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

  // Story 7.5 — review finding F1 (Story 7.2) is resolved: Story 7.3 shipped
  // `thread_is_readable()`'s private-branch enforcement, so this control no
  // longer has to withhold the choice it cannot yet back up. Replaces the
  // old "clicking the disabled Private option never calls update (F1)" test
  // with the mirror-image proof: clicking Private (now enabled) DOES call
  // update with 'private' — the direction that was blocked before this fix.
  it("switching from open to private calls dataProvider.update with 'private'", async () => {
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
