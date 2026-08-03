import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { Listing, Single } from "../types";
import { PublishSingleListingSection } from "./PublishSingleListingSection";

/**
 * Story 9.2 (AC-1, AC-2, AC-3, AC-4, AC-6): the single-branch publish
 * form's own client-side behaviour. The server-side half of every rule
 * asserted here (the CHECK constraint behind AC-2, the partial unique
 * index behind AC-6, RLS behind AC-3/AC-8) has its own proof in
 * supabase/tests/listings.sql; this file is the UI layer only.
 */

const ACCOUNT_ID = 1;

const buildSingle = (overrides: Partial<Single> = {}): Single => ({
  id: 7,
  account_id: ACCOUNT_ID,
  first_name_en: "Rivky",
  last_name_en: "Klein",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const buildListing = (overrides: Partial<Listing> = {}): Listing => ({
  id: 500,
  account_id: ACCOUNT_ID,
  listing_type: "single",
  single_id: 7,
  single_first_name_en: "Rivky",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

type ListByResource = Record<string, { data: unknown[]; total: number }>;

const buildDataProvider = (lists: ListByResource = {}): CrmDataProvider =>
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
  }) as unknown as CrmDataProvider;

const renderSection = async (
  lists: ListByResource = {},
  single: Single = buildSingle(),
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const dataProvider = buildDataProvider(lists);

  const screen = await render(
    <TestMemoryRouter initialEntries={["/settings"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <PublishSingleListingSection single={single} accountId={ACCOUNT_ID} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("PublishSingleListingSection — field set (AC-4, Dev Notes 'Field set decision')", () => {
  it("offers exactly the seven Dev-Notes fields, all off by default, and no others", async () => {
    // Arrange / Act
    const { screen } = await renderSection({
      listings: { data: [], total: 0 },
    });

    // Assert — the exact offered set.
    const offeredLabels = [
      "First name (English)",
      "First name (Hebrew)",
      "Age",
      "Height",
      "Community",
      "Location",
      "Summary",
    ];
    for (const label of offeredLabels) {
      await expect
        .element(screen.getByRole("switch", { name: label }))
        .not.toBeChecked();
    }

    // Assert — AC-4's "no others", enforced structurally: exactly one
    // switch per Dev-Notes field, never more. A denylist of banned words
    // (below) cannot catch an EIGHTH toggle under a name nobody thought to
    // ban (Review F4); a raw count of every `switch` on the page can, and
    // does not depend on any toggle's accessible name resolving correctly.
    expect(screen.getByRole("switch").elements().length).toBe(
      offeredLabels.length,
    );

    // Assert — AC-4: the working record, family, and photo are never
    // offered as options at all, not merely unchecked.
    const excludedText = [
      "Last name",
      "Pipeline",
      "Marital status",
      "Photo",
      "Father",
      "Mother",
      "Shul",
      "Yeshiva",
      "Medical",
    ];
    for (const text of excludedText) {
      expect(screen.container.textContent ?? "").not.toContain(text);
    }

    // Assert — no withdrawal action anywhere on this form (Story 9.3's).
    expect(screen.container.textContent ?? "").not.toContain(
      "Withdraw listing",
    );
  });

  it("AC-2 — refuses client-side when neither first name is on, without calling the dataProvider", async () => {
    // Arrange
    const { screen, dataProvider } = await renderSection({
      listings: { data: [], total: 0 },
    });

    // Act
    await screen.getByRole("button", { name: "Publish listing" }).click();

    // Assert
    await expect
      .element(
        screen.getByText(
          "Turn on an English or Hebrew first name and enter it before publishing.",
        ),
      )
      .toBeInTheDocument();
    expect(dataProvider.create).not.toHaveBeenCalled();
  });

  it("publishing with only the Hebrew first name on satisfies AC-2 (English is not mandatory)", async () => {
    // Arrange
    const { screen, dataProvider } = await renderSection({
      listings: { data: [], total: 0 },
    });

    // Act
    await screen.getByRole("switch", { name: "First name (Hebrew)" }).click();
    await screen
      .getByRole("textbox", { name: "First name (Hebrew)" })
      .fill("רבקה");
    await screen.getByRole("button", { name: "Publish listing" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.create as ReturnType<typeof vi.fn>).mock.calls.length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.create).toHaveBeenCalledWith("listings", {
      data: {
        listing_type: "single",
        single_first_name_en: null,
        single_first_name_he: "רבקה",
        single_age: null,
        single_height: null,
        single_community: null,
        single_location: null,
        single_summary: null,
        single_id: 7,
      },
    });
  });

  it("AC-1 — publishing with name and age on writes a parsed integer age, leaving every other field null", async () => {
    // Arrange
    const { screen, dataProvider } = await renderSection({
      listings: { data: [], total: 0 },
    });

    // Act
    await screen.getByRole("switch", { name: "First name (English)" }).click();
    await screen
      .getByRole("textbox", { name: "First name (English)" })
      .fill("Rivky");
    await screen.getByRole("switch", { name: "Age" }).click();
    await screen.getByRole("spinbutton", { name: "Age" }).fill("24");
    await screen.getByRole("button", { name: "Publish listing" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.create as ReturnType<typeof vi.fn>).mock.calls.length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.create).toHaveBeenCalledWith("listings", {
      data: {
        listing_type: "single",
        single_first_name_en: "Rivky",
        single_first_name_he: null,
        single_age: 24,
        single_height: null,
        single_community: null,
        single_location: null,
        single_summary: null,
        single_id: 7,
      },
    });
  });
});

describe("PublishSingleListingSection — an existing listing", () => {
  it("AC-6 — initializes from the existing row and republishing UPDATEs the SAME row, never a second CREATE", async () => {
    // Arrange
    const existing = buildListing({ single_community: "Yeshivish" });
    const { screen, dataProvider } = await renderSection({
      listings: { data: [existing], total: 1 },
    });

    // Assert (initial state mirrors the existing row)
    await expect
      .element(screen.getByRole("switch", { name: "First name (English)" }))
      .toBeChecked();
    await expect
      .element(screen.getByRole("switch", { name: "Community" }))
      .toBeChecked();
    await expect
      .element(screen.getByRole("switch", { name: "Age" }))
      .not.toBeChecked();
    await expect
      .element(screen.getByRole("button", { name: "Update listing" }))
      .toBeInTheDocument();

    // Act — republish unchanged
    await screen.getByRole("button", { name: "Update listing" }).click();

    // Assert
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
          single_first_name_en: "Rivky",
          single_community: "Yeshivish",
        }),
      }),
    );
    expect(dataProvider.create).not.toHaveBeenCalled();
  });
});
