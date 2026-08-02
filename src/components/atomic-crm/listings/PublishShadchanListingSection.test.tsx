import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { Listing } from "../types";
import { PublishShadchanListingSection } from "./PublishShadchanListingSection";

/**
 * Story 9.1 (AC-1, AC-2, AC-3, AC-5): the "Publish my listing" panel's own
 * client-side behaviour — the part no database suite can exercise. The
 * server-side half of every rule asserted here (the CHECK constraint behind
 * AC-2, the partial unique index behind AC-3, the RLS delete behind AC-5)
 * has its own proof in supabase/tests/listings.sql; this file is the UI
 * layer only.
 */

const ACCOUNT_ID = 9;

const buildListing = (overrides: Partial<Listing> = {}): Listing => ({
  id: 500,
  account_id: ACCOUNT_ID,
  listing_type: "shadchan",
  shadchan_name: "Rivka the Shadchan",
  shadchan_area: null,
  shadchan_contact_info: null,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

type ListByResource = Record<string, { data: unknown[]; total: number }>;

const buildDataProvider = (
  lists: ListByResource = {},
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getList: vi.fn((resource: string) =>
      Promise.resolve(lists[resource] ?? { data: [], total: 0 }),
    ),
    create: vi.fn((_resource: string, params: any) =>
      Promise.resolve({ data: { id: 501, ...params.data } }),
    ),
    update: vi.fn((_resource: string, params: any) =>
      Promise.resolve({ data: { id: params.id, ...params.data } }),
    ),
    delete: vi.fn((_resource: string, params: any) =>
      Promise.resolve({ data: { id: params.id } }),
    ),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderSection = async (
  lists: ListByResource = {},
  overrides: Partial<CrmDataProvider> = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const dataProvider = buildDataProvider(lists, overrides);

  const screen = await render(
    <TestMemoryRouter initialEntries={["/settings"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <PublishShadchanListingSection accountId={ACCOUNT_ID} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("PublishShadchanListingSection — no listing published yet", () => {
  it("AC-1 — shows three toggles, all off by default, and no Withdraw button", async () => {
    // Arrange / Act
    const { screen } = await renderSection({
      listings: { data: [], total: 0 },
    });

    // Assert
    await expect
      .element(screen.getByRole("switch", { name: "Name" }))
      .not.toBeChecked();
    await expect
      .element(screen.getByRole("switch", { name: "Area" }))
      .not.toBeChecked();
    await expect
      .element(screen.getByRole("switch", { name: "How to reach me" }))
      .not.toBeChecked();
    await expect
      .element(screen.getByRole("button", { name: "Withdraw listing" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Publish my listing" }))
      .toBeInTheDocument();
  });

  it("AC-2 — refuses client-side when Name is off, without calling the dataProvider", async () => {
    // Arrange
    const { screen, dataProvider } = await renderSection({
      listings: { data: [], total: 0 },
    });

    // Act
    await screen.getByRole("button", { name: "Publish my listing" }).click();

    // Assert
    await expect
      .element(
        screen.getByText('Turn on "Name" and enter a name before publishing.'),
      )
      .toBeInTheDocument();
    expect(dataProvider.create).not.toHaveBeenCalled();
  });

  it("AC-1/AC-2 — publishing with only Name on writes shadchan_name and leaves area/contact null", async () => {
    // Arrange
    const { screen, dataProvider } = await renderSection({
      listings: { data: [], total: 0 },
    });

    // Act
    await screen.getByRole("switch", { name: "Name" }).click();
    await screen
      .getByRole("textbox", { name: "Name" })
      .fill("Rivka the Shadchan");
    await screen.getByRole("button", { name: "Publish my listing" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.create as ReturnType<typeof vi.fn>).mock.calls.length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.create).toHaveBeenCalledWith("listings", {
      data: {
        listing_type: "shadchan",
        shadchan_name: "Rivka the Shadchan",
        shadchan_area: null,
        shadchan_contact_info: null,
      },
    });
  });
});

describe("PublishShadchanListingSection — an existing listing", () => {
  it("AC-3 — initializes toggles/fields from the existing row and republishing UPDATEs the same row", async () => {
    // Arrange
    const existing = buildListing({ shadchan_area: "Lakewood" });
    const { screen, dataProvider } = await renderSection({
      listings: { data: [existing], total: 1 },
    });

    // Assert (initial state mirrors the existing row)
    await expect
      .element(screen.getByRole("switch", { name: "Name" }))
      .toBeChecked();
    await expect
      .element(screen.getByRole("switch", { name: "Area" }))
      .toBeChecked();
    await expect
      .element(screen.getByRole("switch", { name: "How to reach me" }))
      .not.toBeChecked();
    await expect
      .element(screen.getByRole("button", { name: "Update listing" }))
      .toBeInTheDocument();

    // Act — republish unchanged
    await screen.getByRole("button", { name: "Update listing" }).click();

    // Assert — an UPDATE on the SAME id, never a second CREATE
    await expect
      .poll(
        () =>
          (dataProvider.update as ReturnType<typeof vi.fn>).mock.calls.length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.update).toHaveBeenCalledWith(
      "listings",
      expect.objectContaining({
        id: existing.id,
        data: expect.objectContaining({
          shadchan_name: "Rivka the Shadchan",
          shadchan_area: "Lakewood",
        }),
      }),
    );
    expect(dataProvider.create).not.toHaveBeenCalled();
  });

  it("AC-5 — Withdraw calls delete with the listing's id", async () => {
    // Arrange
    const existing = buildListing();
    const { screen, dataProvider } = await renderSection({
      listings: { data: [existing], total: 1 },
    });

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
      expect.objectContaining({ id: existing.id }),
    );
  });
});
