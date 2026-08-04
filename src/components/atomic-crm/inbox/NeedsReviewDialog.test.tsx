import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter, type Identifier } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { InboxItem } from "../types";
import { NeedsReviewDialog } from "./NeedsReviewDialog";

/**
 * Epic 11's "Needs review" trust/discard action. Pins:
 *   - Trust sender calls `dataProvider.trustSender()` with the item's own
 *     account and email-shaped sender, and closes on success.
 *   - The button is withheld — and an explanatory notice shown instead —
 *     when `inbox_items.sender` isn't shaped like an address (the FR24
 *     display-name/null case this dialog's own doc comment explains).
 *   - Discard reuses `useResolveInboxItem`'s existing dismiss path (sets
 *     `dismissed`) and never calls `trustSender`.
 */

const buildItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 2,
  account_id: 7,
  created_at: "2026-07-21T09:00:00Z",
  source: "email",
  raw_text: "We haven't been in touch before, but I have a suggestion.",
  subject: "A possible shidduch",
  sender: "newcontact@example.com",
  sender_needs_confirmation: false,
  attachments: null,
  status: "held",
  single_id: null,
  shadchan_id: null,
  resolved_shidduchim_id: null,
  connection_id: null,
  resolution_attempt_id: null,
  resolution_input: null,
  ...overrides,
});

const buildDataProvider = (
  item: InboxItem,
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider => {
  let currentItem: InboxItem = { ...item };

  const getOne = vi.fn(async (resource: string, params: { id: Identifier }) => {
    if (resource === "inbox_items" && params.id === currentItem.id) {
      return { data: currentItem };
    }
    throw new Error(`Unexpected getOne: ${resource} ${String(params.id)}`);
  });

  const update = vi.fn(
    async (resource: string, params: { data: Partial<InboxItem> }) => {
      if (resource === "inbox_items") {
        currentItem = { ...currentItem, ...params.data };
        return { data: currentItem };
      }
      return { data: {} };
    },
  );

  return {
    getOne,
    update,
    trustSender: vi.fn().mockResolvedValue({
      trustedSender: {
        id: 1,
        account_id: 7,
        email: "newcontact@example.com",
        created_at: "2026-07-22T00:00:00Z",
      },
      releasedItemIds: [2],
    }),
    ...overrides,
  } as unknown as CrmDataProvider;
};

const renderDialog = async (item: InboxItem, dataProvider: CrmDataProvider) => {
  const onClose = vi.fn();
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <NeedsReviewDialog item={item} open onClose={onClose} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, onClose };
};

describe("NeedsReviewDialog — Trust sender", () => {
  it("calls dataProvider.trustSender with the held item's account and its email-shaped sender", async () => {
    // Arrange
    const item = buildItem();
    const dataProvider = buildDataProvider(item);
    const { screen, onClose } = await renderDialog(item, dataProvider);

    // Act
    await screen.getByRole("button", { name: "Trust sender" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.trustSender as ReturnType<typeof vi.fn>).mock.calls
            .length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.trustSender).toHaveBeenCalledWith({
      accountId: 7,
      email: "newcontact@example.com",
    });
    await expect.poll(() => onClose.mock.calls.length).toBeGreaterThan(0);
  });

  it("mentions the other released item when trustSender reports more than this one", async () => {
    // Arrange
    const item = buildItem();
    const dataProvider = buildDataProvider(item, {
      trustSender: vi.fn().mockResolvedValue({
        trustedSender: {
          id: 1,
          account_id: 7,
          email: "newcontact@example.com",
          created_at: "2026-07-22T00:00:00Z",
        },
        // id 2 is THIS item; id 3 is the "other" one being released too.
        releasedItemIds: [2, 3],
      }),
    });
    const { screen } = await renderDialog(item, dataProvider);

    // Act
    await screen.getByRole("button", { name: "Trust sender" }).click();

    // Assert
    await expect
      .element(screen.getByText(/1 other waiting item/))
      .toBeInTheDocument();
  });

  it("does not offer Trust sender when the sender is a display name, not an address", async () => {
    // Arrange — the FR24 forwarded-sender recovery case this dialog's own
    // doc comment explains: `sender` holds "Mrs. Feldman", never an email.
    const item = buildItem({ sender: "Mrs. Feldman" });
    const dataProvider = buildDataProvider(item);
    const { screen } = await renderDialog(item, dataProvider);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Trust sender" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText(/don't have a clear email address/))
      .toBeInTheDocument();
  });

  it("does not offer Trust sender when the sender is null (a direct, non-forwarded email)", async () => {
    // Arrange
    const item = buildItem({ sender: null });
    const dataProvider = buildDataProvider(item);
    const { screen } = await renderDialog(item, dataProvider);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Trust sender" }))
      .not.toBeInTheDocument();
  });

  it("shows an error and does not close when trustSender rejects — the partial-state case", async () => {
    // Arrange
    const item = buildItem();
    const dataProvider = buildDataProvider(item, {
      trustSender: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Trusted the sender, but couldn't release their held mail. Refresh to try again.",
          ),
        ),
    });
    const { screen, onClose } = await renderDialog(item, dataProvider);

    // Act
    await screen.getByRole("button", { name: "Trust sender" }).click();

    // Assert
    await expect
      .element(screen.getByText(/couldn't release their held mail/i))
      .toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("NeedsReviewDialog — Discard", () => {
  it("sets the item to dismissed and never calls trustSender", async () => {
    // Arrange
    const item = buildItem();
    const dataProvider = buildDataProvider(item);
    const { screen, onClose } = await renderDialog(item, dataProvider);

    // Act
    await screen.getByRole("button", { name: "Discard" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.update as ReturnType<typeof vi.fn>).mock.calls.length,
      )
      .toBeGreaterThan(0);
    const calls = (dataProvider.update as ReturnType<typeof vi.fn>).mock.calls;
    const finalCall = calls[calls.length - 1] as [
      string,
      { data: Partial<InboxItem> },
    ];
    expect(finalCall[1].data.status).toBe("dismissed");
    expect(dataProvider.trustSender).not.toHaveBeenCalled();
    await expect.poll(() => onClose.mock.calls.length).toBeGreaterThan(0);
  });

  it("is offered even when there is no usable sender address at all", async () => {
    // Arrange
    const item = buildItem({ sender: null });
    const dataProvider = buildDataProvider(item);
    const { screen } = await renderDialog(item, dataProvider);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Discard" }))
      .toBeInTheDocument();
  });
});
