import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { Listing } from "../types";
import { useListingUpsert } from "./useListingUpsert";

/**
 * Story 9.2 (Task 5, DRY): `useListingUpsert` is the create-vs-update
 * decision extracted out of Story 9.1's own `useShadchanListing.ts`
 * (`.claude/rules/coding-style.md`) — this suite proves the extracted
 * hook's own branch directly, independent of either branch's component.
 * `PublishShadchanListingSection.test.tsx` (unchanged since the refactor)
 * is the proof this extraction did not change the `shadchan` branch's own
 * observable behavior.
 */

function UpsertProbe({
  accountId,
  subjectId,
}: {
  accountId: number;
  subjectId?: number;
}) {
  const { listing, isPending, upsert, withdraw } = useListingUpsert(
    accountId,
    "single",
    subjectId,
  );
  return (
    <div>
      <span>
        isPending:{String(isPending)} hasListing:{String(listing != null)}
      </span>
      <button
        onClick={() => void upsert({ single_first_name_en: "Test Name" })}
      >
        Save
      </button>
      <button onClick={() => void withdraw()}>Withdraw</button>
    </div>
  );
}

type ListByResource = Record<string, { data: Listing[]; total: number }>;

const buildDataProvider = (lists: ListByResource = {}): CrmDataProvider =>
  ({
    getList: vi.fn((resource: string) =>
      Promise.resolve(lists[resource] ?? { data: [], total: 0 }),
    ),
    create: vi.fn((_resource: string, params: any) =>
      Promise.resolve({ data: { id: 900, ...params.data } }),
    ),
    update: vi.fn((_resource: string, params: any) =>
      Promise.resolve({ data: { id: params.id, ...params.data } }),
    ),
    delete: vi.fn((_resource: string, params: any) =>
      Promise.resolve({ data: { id: params.id } }),
    ),
  }) as unknown as CrmDataProvider;

const renderProbe = async (lists: ListByResource = {}, subjectId?: number) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const dataProvider = buildDataProvider(lists);

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <UpsertProbe accountId={9} subjectId={subjectId} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

const buildListing = (overrides: Partial<Listing> = {}): Listing => ({
  id: 501,
  account_id: 9,
  listing_type: "single",
  single_id: 42,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("useListingUpsert — no listing exists yet for this subject", () => {
  it("CREATEs, stamping listing_type and the given subjectId as single_id", async () => {
    // Arrange
    const { screen, dataProvider } = await renderProbe(
      { listings: { data: [], total: 0 } },
      42,
    );

    // Act
    await screen.getByText("Save").click();

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
        single_first_name_en: "Test Name",
        single_id: 42,
      },
    });
    expect(dataProvider.update).not.toHaveBeenCalled();
  });

  it("omits single_id from the payload when no subjectId is given (the shadchan branch's own shape)", async () => {
    // Arrange
    const { screen, dataProvider } = await renderProbe({
      listings: { data: [], total: 0 },
    });

    // Act
    await screen.getByText("Save").click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.create as ReturnType<typeof vi.fn>).mock.calls.length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.create).toHaveBeenCalledWith("listings", {
      data: { listing_type: "single", single_first_name_en: "Test Name" },
    });
  });
});

describe("useListingUpsert — a listing already exists for this subject", () => {
  it("UPDATEs the SAME row in place, never a second CREATE", async () => {
    // Arrange
    const existing = buildListing();
    const { screen, dataProvider } = await renderProbe(
      { listings: { data: [existing], total: 1 } },
      42,
    );

    // Act
    await screen.getByText("Save").click();

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
          listing_type: "single",
          single_first_name_en: "Test Name",
          single_id: 42,
        }),
      }),
    );
    expect(dataProvider.create).not.toHaveBeenCalled();
  });

  it("withdraw() deletes the existing row by id", async () => {
    // Arrange
    const existing = buildListing();
    const { screen, dataProvider } = await renderProbe(
      { listings: { data: [existing], total: 1 } },
      42,
    );

    // Act
    await screen.getByText("Withdraw").click();

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
