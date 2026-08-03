import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter, useGetList } from "ra-core";
import type { Identifier } from "ra-core";
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

const SETTLED_MARKER_TESTID = "listing-lock-fetch-settled";

/**
 * Review fix (F2): a settling anchor INDEPENDENT of
 * `ConsentToRepublishButton`'s own self/role gates. It calls the exact same
 * `listing_withdrawal_locks` read via `useGetList` and renders a marker once
 * that read resolves — regardless of viewer role or `member_id`.
 *
 * Why this is needed: for a `parent_admin` viewer, EVERY
 * `ConsentToRepublishButton` in this file renders `null` (that is the
 * behavior under test), so a poll for "button count is 0" is satisfied by
 * the very first render, before the async lock read ever resolves — it
 * would pass identically whether the role gate is present or deleted
 * entirely. Awaiting this marker FIRST forces the poll to wait for genuine
 * data resolution; only once it appears is asserting "still 0" meaningful.
 */
const SettledMarker = ({
  accountId,
  singleId,
}: {
  accountId: Identifier;
  singleId: Identifier;
}) => {
  const { isPending } = useGetList<ListingWithdrawalLock>(
    "listing_withdrawal_locks",
    {
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" as const },
      filter: { single_id: singleId, account_id: accountId },
    },
  );
  return isPending ? null : <span data-testid={SETTLED_MARKER_TESTID} />;
};

const waitForLockFetchToSettle = async (screen: {
  container: HTMLElement;
}): Promise<void> => {
  await expect
    .poll(
      () =>
        screen.container.querySelector(
          `[data-testid="${SETTLED_MARKER_TESTID}"]`,
        ) !== null,
    )
    .toBe(true);
};

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
            <SettledMarker accountId={ACCOUNT_ID} singleId={locked.id} />
          </CoreAdminContext>
        </TestMemoryRouter>,
      );

      // Assert — F2 fix: wait for the lock read to genuinely resolve
      // (the marker is unaffected by the role gate under test) BEFORE
      // reading the button count, so a `parent_admin`'s expected-0 cannot
      // be satisfied by a still-pending render.
      await waitForLockFetchToSettle(screen);
      const expectedCount = role === "parent_admin" ? 0 : 1;
      await expect
        .poll(() => buttonsNamed(screen, "Allow republishing").length)
        .toBe(expectedCount);
    }
  });

  it("renders nothing for a SIBLING's locked single, even with the matching role — self AND role are BOTH required", async () => {
    // Arrange — review fix (F2): neither existing test in this file ever
    // varied `member_id` away from `currentMemberId`, so removing `!isSelf`
    // from the gate entirely was UNCAUGHT (both siblings below share role
    // 'single' and an active lock; only their `member_id` differs). The
    // viewer (member_id 55) has a role-matching, GENUINELY LOCKED sibling
    // single (id 4, member_id 56) alongside their OWN, ALSO locked single
    // (id 5, member_id 55) — the sibling's button must never appear.
    const siblingsLocked = buildSingle({ id: 4, member_id: 56 });
    const ownLocked = buildSingle({ id: 5, member_id: 55 });
    const siblingLock = buildLock({ single_id: 4 });
    const ownLock = buildLock({ single_id: 5 });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [
      householdContext("single"),
    ]);
    queryClient.setQueryData(CURRENT_MEMBER_ID_QUERY_KEY, 55);
    const dataProvider = {
      getList: vi.fn(
        (_resource: string, params: { filter?: { single_id?: Identifier } }) =>
          Promise.resolve(
            params.filter?.single_id === 4
              ? { data: [siblingLock], total: 1 }
              : { data: [ownLock], total: 1 },
          ),
      ),
    } as unknown as CrmDataProvider;

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <ConsentToRepublishButton
            single={siblingsLocked}
            accountId={ACCOUNT_ID}
          />
          <ConsentToRepublishButton single={ownLocked} accountId={ACCOUNT_ID} />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert — the total can only settle at exactly 1 (the viewer's OWN
    // locked single) once both reads resolve AND the sibling's button
    // correctly stayed absent; either a still-pending fetch (0) or a
    // wrongly-shown sibling button (2) fails this poll.
    await expect
      .poll(() => buttonsNamed(screen, "Allow republishing").length)
      .toBe(1);
  });

  it("renders nothing when the single is not locked, even for the single themselves", async () => {
    // Arrange — two NOT-locked singles under test, plus a genuinely LOCKED
    // anchor single (id 99) sharing the exact same self+role gates. The
    // mock differentiates by `single_id` (review fix F2: the previous
    // version returned the SAME empty result for every call, so the
    // "control" button could never actually turn positive — the poll below
    // settled on its OWN pending-state default of 0, not on real data).
    const notLocked = buildSingle({ id: 2, member_id: 55 });
    const alsoNotLocked = buildSingle({ id: 3, member_id: 55 });
    const anchorLocked = buildSingle({ id: 99, member_id: 55 });
    const anchorLock = buildLock({ single_id: 99 });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [
      householdContext("single"),
    ]);
    queryClient.setQueryData(CURRENT_MEMBER_ID_QUERY_KEY, 55);
    const dataProvider = {
      getList: vi.fn(
        (_resource: string, params: { filter?: { single_id?: Identifier } }) =>
          Promise.resolve(
            params.filter?.single_id === 99
              ? { data: [anchorLock], total: 1 }
              : { data: [], total: 0 },
          ),
      ),
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
          <ConsentToRepublishButton
            single={alsoNotLocked}
            accountId={ACCOUNT_ID}
          />
          <ConsentToRepublishButton
            single={anchorLocked}
            accountId={ACCOUNT_ID}
          />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert — the total can only settle at exactly 1 (the genuinely
    // locked anchor) once every read has resolved AND the two not-locked
    // siblings correctly stayed absent; either a still-pending fetch (0)
    // or a wrongly-shown not-locked button (2 or 3) fails this poll.
    await expect
      .poll(() => buttonsNamed(screen, "Allow republishing").length)
      .toBe(1);
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
