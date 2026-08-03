import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { CURRENT_MEMBER_ID_QUERY_KEY } from "../threads/useCurrentMemberId";
import type { Listing, Single } from "../types";
import { WithdrawSingleListingButton } from "./WithdrawSingleListingButton";

/**
 * Story 9.3 (AC-1): "a single with a login may always withdraw their own
 * listing, regardless of who published it." Self-gated on
 * `useCurrentMemberId()` vs `single.member_id` — the RLS policy
 * (`supabase/tests/listings.sql`) is the real boundary; this proves the UI
 * offers the control to the right viewer and calls the right primitive.
 *
 * `useCurrentMemberId()` is pre-seeded via `CURRENT_MEMBER_ID_QUERY_KEY`
 * (the same technique `SingleLoginInvite.test.tsx` uses for
 * `MY_CONTEXTS_QUERY_KEY`) so its resolution is synchronous — the ONLY
 * still-async dependency this component has is `useListingUpsert`'s own
 * `getList("listings", ...)`.
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

const buildListing = (overrides: Partial<Listing> = {}): Listing => ({
  id: 500,
  account_id: ACCOUNT_ID,
  listing_type: "single",
  single_id: 1,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

/** `vitest-browser-react`'s `screen` has no `getAllByRole` —
 * `SingleListingSection.test.tsx`'s own convention for "how many of
 * these". */
const buttonsNamed = (
  screen: { container: HTMLElement },
  text: string,
): HTMLButtonElement[] =>
  Array.from(screen.container.querySelectorAll("button")).filter(
    (button) => button.textContent?.trim() === text,
  );

describe("WithdrawSingleListingButton — self-gating (AC-1)", () => {
  it("renders ONLY for the single themselves, and ONLY when a listing exists to withdraw", async () => {
    // Arrange — three singles under the SAME viewer (member_id 55):
    //   selfWithListing: the viewer's own record, has a listing -> shows,
    //     even though a `single` role never had insert/update rights over
    //     that row (9.2 never granted them).
    //   sibling: a DIFFERENT single's record (member_id 56), has a listing
    //     -> never shows, regardless of who published it.
    //   selfNoListing: the viewer's own record, no listing yet -> nothing
    //     to withdraw, so no button either.
    const selfWithListing = buildSingle({ id: 1, member_id: 55 });
    const sibling = buildSingle({ id: 2, member_id: 56 });
    const selfNoListing = buildSingle({ id: 3, member_id: 55 });
    const listingsBySingleId: Record<number, Listing> = {
      1: buildListing({ id: 501, single_id: 1 }),
      2: buildListing({ id: 502, single_id: 2 }),
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(CURRENT_MEMBER_ID_QUERY_KEY, 55);
    const dataProvider = {
      getList: vi.fn((resource: string, params: any) => {
        if (resource !== "listings") {
          return Promise.resolve({ data: [], total: 0 });
        }
        const match = listingsBySingleId[params.filter?.single_id];
        return Promise.resolve({
          data: match ? [match] : [],
          total: match ? 1 : 0,
        });
      }),
    } as unknown as CrmDataProvider;

    // Act
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <WithdrawSingleListingButton
            single={selfWithListing}
            accountId={ACCOUNT_ID}
          />
          <WithdrawSingleListingButton
            single={sibling}
            accountId={ACCOUNT_ID}
          />
          <WithdrawSingleListingButton
            single={selfNoListing}
            accountId={ACCOUNT_ID}
          />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    // Assert — polls the FINAL settled count, so both a wrongly-rendered
    // extra button and a false negative from a still-pending fetch fail
    // this assertion (it can only ever settle at exactly 1 if the gate is
    // right).
    await expect
      .poll(() => buttonsNamed(screen, "Withdraw listing").length)
      .toBe(1);
  });
});

describe("WithdrawSingleListingButton — clicking withdraws (AC-1)", () => {
  const renderButton = async (
    deleteImpl?: () => Promise<{ data: Listing }>,
  ) => {
    const single = buildSingle({ id: 1, member_id: 55 });
    const listing = buildListing({ id: 777, single_id: 1 });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(CURRENT_MEMBER_ID_QUERY_KEY, 55);
    const dataProvider = {
      getList: vi.fn().mockResolvedValue({ data: [listing], total: 1 }),
      delete:
        deleteImpl ??
        vi.fn((_resource: string, params: any) =>
          Promise.resolve({ data: { id: params.id } }),
        ),
    } as unknown as CrmDataProvider;

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <WithdrawSingleListingButton single={single} accountId={ACCOUNT_ID} />
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    return { screen, dataProvider };
  };

  it("calls dataProvider.delete with the listing's own id, regardless of who published it", async () => {
    // Arrange
    const { screen, dataProvider } = await renderButton();

    // Act
    await screen.getByRole("button", { name: "Withdraw listing" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.delete as ReturnType<typeof vi.fn>).mock.calls.length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.delete).toHaveBeenCalledWith(
      "listings",
      expect.objectContaining({ id: 777 }),
    );
  });

  it("shows an error notification when the delete is refused", async () => {
    // Arrange
    const { screen } = await renderButton(
      vi.fn().mockRejectedValue(new Error("refused")),
    );

    // Act
    await screen.getByRole("button", { name: "Withdraw listing" }).click();

    // Assert
    await expect
      .element(screen.getByText("Couldn't withdraw your listing. Try again."))
      .toBeInTheDocument();
  });
});
