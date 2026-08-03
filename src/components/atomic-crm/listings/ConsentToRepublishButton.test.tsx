import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import { CURRENT_MEMBER_ID_QUERY_KEY } from "../threads/useCurrentMemberId";
import type { ListingWithdrawalLock, MyContext, Single } from "../types";
import { ConsentToRepublishButton } from "./ConsentToRepublishButton";

/**
 * Story 9.3 (AC-4): "only the single may clear the lock — never the
 * parent, never any other role." Both `useViewerRole()` and
 * `useCurrentMemberId()` are pre-seeded via their own query keys (the same
 * technique `SingleLoginInvite.test.tsx` / `WithdrawSingleListingButton
 * .test.tsx` use), so the only still-async dependency is the
 * `listing_withdrawal_locks` read itself.
 *
 * The RPC's own role check (02_functions.sql) and the absent DML grant
 * (06_grants.sql) are the real boundary — proven in
 * `supabase/tests/listings.sql`; this file is the UI layer only
 * (`.claude/rules/security-triggers.md`'s own caution that a missing
 * button is not a security boundary).
 */

const ACCOUNT_ID = 9;

const buildSingle = (overrides: Partial<Single> = {}): Single => ({
  id: 1,
  account_id: ACCOUNT_ID,
  first_name_en: "Rivky",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const buildLock = (
  overrides: Partial<ListingWithdrawalLock> = {},
): ListingWithdrawalLock => ({
  id: 1,
  single_id: 1,
  account_id: ACCOUNT_ID,
  locked_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const householdContext = (role: MyContext["role"]): MyContext => ({
  account_id: ACCOUNT_ID,
  kind: "household",
  name: "The Klein Family",
  role,
  is_active: true,
});

const buttonsNamed = (
  screen: { container: HTMLElement },
  text: string,
): HTMLButtonElement[] =>
  Array.from(screen.container.querySelectorAll("button")).filter(
    (button) => button.textContent?.trim() === text,
  );

describe("ConsentToRepublishButton — self AND role gate (AC-4)", () => {
  it("renders ONLY for the single/self-manager themselves — never a parent_admin, even on the locked single's own row", async () => {
    // Arrange — three viewers, all with member_id 55 matching the SAME
    // locked single (id 1), differing only by role: `single` and
    // `self_manager` must see the button; `parent_admin` must NEVER see it,
    // even though every other condition (member_id match, lock exists) is
    // identical — the role gate is the thing under test here.
    const locked = buildSingle({ id: 1, member_id: 55 });
    const lock = buildLock({ single_id: 1 });

    for (const role of ["single", "self_manager", "parent_admin"] as const) {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [householdContext(role)]);
      queryClient.setQueryData(CURRENT_MEMBER_ID_QUERY_KEY, 55);
      const dataProvider = {
        getList: vi.fn().mockResolvedValue({ data: [lock], total: 1 }),
      } as unknown as CrmDataProvider;

      // Act
      const screen = await render(
        <TestMemoryRouter>
          <CoreAdminContext
            dataProvider={dataProvider}
            queryClient={queryClient}
            i18nProvider={testI18nProvider}
          >
            <ConsentToRepublishButton single={locked} accountId={ACCOUNT_ID} />
          </CoreAdminContext>
        </TestMemoryRouter>,
      );

      // Assert
      const expectedCount = role === "parent_admin" ? 0 : 1;
      await expect
        .poll(() => buttonsNamed(screen, "Allow republishing").length)
        .toBe(expectedCount);
    }
  });

  it("renders nothing when the single is not locked, even for the single themselves", async () => {
    // Arrange
    const notLocked = buildSingle({ id: 2, member_id: 55 });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [
      householdContext("single"),
    ]);
    queryClient.setQueryData(CURRENT_MEMBER_ID_QUERY_KEY, 55);
    const dataProvider = {
      getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    } as unknown as CrmDataProvider;

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <ConsentToRepublishButton single={notLocked} accountId={ACCOUNT_ID} />
          {/* A control proving the render settled: mount a second, genuinely
              locked single alongside so the poll below can only reach "1"
              once both queries have resolved. */}
          <ConsentToRepublishButton
            single={buildSingle({ id: 3, member_id: 55 })}
            accountId={ACCOUNT_ID}
          />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert — the second button never appears either (getList resolves the
    // SAME empty result for every call in this mock), proving the settled
    // state genuinely has zero, not merely "not yet resolved".
    await expect
      .poll(() => buttonsNamed(screen, "Allow republishing").length)
      .toBe(0);
  });
});

describe("ConsentToRepublishButton — clicking consents (AC-4)", () => {
  const renderButton = async (consentImpl?: () => Promise<void>) => {
    const single = buildSingle({ id: 1, member_id: 55 });
    const lock = buildLock({ single_id: 1 });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [
      householdContext("single"),
    ]);
    queryClient.setQueryData(CURRENT_MEMBER_ID_QUERY_KEY, 55);
    const dataProvider = {
      getList: vi.fn().mockResolvedValue({ data: [lock], total: 1 }),
      consentToRepublishListing:
        consentImpl ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as CrmDataProvider;

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <ConsentToRepublishButton single={single} accountId={ACCOUNT_ID} />
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    return { screen, dataProvider };
  };

  it("calls dataProvider.consentToRepublishListing with the single's own id", async () => {
    // Arrange
    const { screen, dataProvider } = await renderButton();

    // Act
    await screen.getByRole("button", { name: "Allow republishing" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.consentToRepublishListing as ReturnType<typeof vi.fn>)
            .mock.calls.length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.consentToRepublishListing).toHaveBeenCalledWith(1);
  });

  it("shows an error notification when the RPC call fails", async () => {
    // Arrange
    const { screen } = await renderButton(
      vi.fn().mockRejectedValue(new Error("network error")),
    );

    // Act
    await screen.getByRole("button", { name: "Allow republishing" }).click();

    // Assert
    await expect
      .element(screen.getByText("Couldn't process your consent. Try again."))
      .toBeInTheDocument();
  });
});
