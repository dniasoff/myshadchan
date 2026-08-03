import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { CreateShidduchInput, InboxItem } from "../types";
import { useResolveInboxItem } from "./useResolveInboxItem";

/**
 * Story 10.1 (Task 5, AC 5/6/7): `InboxResolveDialog.tsx`'s own test
 * (`InboxResolveDialog.test.tsx`) covers the "create a new suggestion" path
 * through the UI; this suite exercises `useResolveInboxItem.ts`'s three
 * functions directly, against a mocked `dataProvider`, since `ShareTarget.tsx`
 * is the OTHER caller and the shared module's own contract (which
 * dataProvider calls each function makes, in which order) deserves coverage
 * independent of either screen.
 */

const buildItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 1,
  account_id: 1,
  created_at: "2026-01-01T00:00:00Z",
  source: "whatsapp",
  raw_text: "Chaim Berkowitz, BMG",
  subject: null,
  sender: null,
  sender_needs_confirmation: false,
  attachments: null,
  status: "unresolved",
  single_id: null,
  shadchan_id: null,
  resolved_shidduchim_id: null,
  connection_id: null,
  ...overrides,
});

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    createShidduch: vi.fn().mockResolvedValue({ id: 99 }),
    create: vi.fn().mockResolvedValue({ data: { id: 100 } }),
    update: vi.fn().mockResolvedValue({ data: {} }),
    ...overrides,
  }) as unknown as CrmDataProvider;

function ResolveProbe({ item }: { item: InboxItem }) {
  const { resolveAsNewShidduch, resolveAsLinkToExisting, dismissInboxItem } =
    useResolveInboxItem();
  const [result, setResult] = useState("idle");

  const run = async (action: () => Promise<string>) => {
    try {
      setResult(await action());
    } catch (error) {
      setResult(`error:${error instanceof Error ? error.message : "unknown"}`);
    }
  };

  return (
    <div>
      <span>result:{result}</span>
      <button
        onClick={() =>
          run(async () => {
            const input: CreateShidduchInput = {
              single_id: 5,
              shadchan_id: 7,
            };
            const created = await resolveAsNewShidduch(item, input);
            return `new:${created.id}`;
          })
        }
      >
        resolveAsNewShidduch
      </button>
      <button
        onClick={() =>
          run(async () => {
            await resolveAsLinkToExisting(item, 42);
            return "linked";
          })
        }
      >
        resolveAsLinkToExisting
      </button>
      <button
        onClick={() =>
          run(async () => {
            await dismissInboxItem(item);
            return "dismissed";
          })
        }
      >
        dismissInboxItem
      </button>
    </div>
  );
}

const renderProbe = async (
  item: InboxItem,
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides);
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResolveProbe item={item} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, dataProvider };
};

describe("useResolveInboxItem — resolveAsNewShidduch (AC 7: the sole createShidduch path)", () => {
  it("creates via dataProvider.createShidduch, then marks the item resolved and linked", async () => {
    // Arrange
    const item = buildItem();
    const { screen, dataProvider } = await renderProbe(item);

    // Act
    await screen.getByRole("button", { name: "resolveAsNewShidduch" }).click();

    // Assert
    await expect.element(screen.getByText("result:new:99")).toBeInTheDocument();
    expect(dataProvider.createShidduch).toHaveBeenCalledWith(
      expect.objectContaining({ single_id: 5, shadchan_id: 7 }),
    );
    expect(dataProvider.update).toHaveBeenCalledWith("inbox_items", {
      id: item.id,
      data: {
        status: "resolved",
        resolved_shidduchim_id: 99,
        single_id: 5,
        shadchan_id: 7,
      },
      previousData: item,
    });
  });
});

describe("useResolveInboxItem — resolveAsLinkToExisting (AC 5: never a second suggestion)", () => {
  it("inserts a note interaction against the chosen shidduch and marks the item resolved, without ever calling createShidduch", async () => {
    // Arrange
    const item = buildItem({ raw_text: "Chaim Berkowitz" });
    const { screen, dataProvider } = await renderProbe(item);

    // Act
    await screen
      .getByRole("button", { name: "resolveAsLinkToExisting" })
      .click();

    // Assert
    await expect.element(screen.getByText("result:linked")).toBeInTheDocument();
    expect(dataProvider.create).toHaveBeenCalledWith("interactions", {
      data: {
        target_type: "shidduch",
        target_id: 42,
        kind: "note",
        body: "Chaim Berkowitz",
        scope: "shidduch",
        reference_link_id: null,
        metadata: { source: "inbox_item", inbox_item_id: item.id },
      },
    });
    expect(dataProvider.createShidduch).not.toHaveBeenCalled();
    expect(dataProvider.update).toHaveBeenCalledWith("inbox_items", {
      id: item.id,
      data: { status: "resolved", resolved_shidduchim_id: 42 },
      previousData: item,
    });
  });

  it("falls back to an empty body when the captured item has no raw_text (e.g. a photo-only share)", async () => {
    // Arrange
    const item = buildItem({ raw_text: null });
    const { screen, dataProvider } = await renderProbe(item);

    // Act
    await screen
      .getByRole("button", { name: "resolveAsLinkToExisting" })
      .click();

    // Assert
    await expect.element(screen.getByText("result:linked")).toBeInTheDocument();
    expect(dataProvider.create).toHaveBeenCalledWith(
      "interactions",
      expect.objectContaining({ data: expect.objectContaining({ body: "" }) }),
    );
  });
});

describe("useResolveInboxItem — dismissInboxItem (InboxResolveDialog's Dismiss, never lets the item disappear)", () => {
  it("marks the item dismissed, never deletes it", async () => {
    // Arrange
    const item = buildItem();
    const { screen, dataProvider } = await renderProbe(item);

    // Act
    await screen.getByRole("button", { name: "dismissInboxItem" }).click();

    // Assert
    await expect
      .element(screen.getByText("result:dismissed"))
      .toBeInTheDocument();
    expect(dataProvider.update).toHaveBeenCalledWith("inbox_items", {
      id: item.id,
      data: { status: "dismissed" },
      previousData: item,
    });
  });
});
