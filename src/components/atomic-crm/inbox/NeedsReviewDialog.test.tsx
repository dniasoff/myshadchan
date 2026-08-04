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
 *     account and `sender_email` (the persisted envelope address), and
 *     closes on success.
 *   - The button is withheld — and an explanatory notice shown instead —
 *     when `inbox_items.sender_email` is `null` (an item ingested before
 *     that column existed; see this dialog's own doc comment).
 *   - `inbox_items.sender` (the FR24-recovered display name / original
 *     sender) never gates the button, and is never what gets trusted —
 *     only `sender_email` is.
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
  sender_email: "newcontact@example.com",
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
  it("calls dataProvider.trustSender with the held item's account and its envelope sender_email", async () => {
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

  it("trusts the envelope sender_email, NOT the FR24 display-name sender, when the two differ", async () => {
    // Arrange — a forwarded email: `sender` is the FR24-recovered display
    // name ("Mrs. Feldman"), completely different from `sender_email` (the
    // real envelope address). This would fail if the button were ever wired
    // to send `item.sender` instead of `item.sender_email`.
    const item = buildItem({
      sender: "Mrs. Feldman",
      sender_email: "envelope-address@example.com",
    });
    const dataProvider = buildDataProvider(item);
    const { screen } = await renderDialog(item, dataProvider);

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
      email: "envelope-address@example.com",
    });
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

  it("still offers Trust sender when the FR24 sender is a display name, as long as sender_email is a real address", async () => {
    // Arrange — the FR24 forwarded-sender recovery case: `sender` holds
    // "Mrs. Feldman", never an email — but that no longer gates Trust,
    // since `sender_email` (the envelope address) is what's used now.
    const item = buildItem({
      sender: "Mrs. Feldman",
      sender_email: "mrs.feldman@example.com",
    });
    const dataProvider = buildDataProvider(item);
    const { screen } = await renderDialog(item, dataProvider);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Trust sender" }))
      .toBeInTheDocument();
  });

  it("offers Trust sender for a direct, non-forwarded email — sender is null but sender_email is set (the bug this fix closes)", async () => {
    // Arrange — the common case the whole fix exists for: a direct email has
    // no FR24-recovered original sender at all, yet the envelope address was
    // still captured.
    const item = buildItem({
      sender: null,
      sender_email: "direct@example.com",
    });
    const dataProvider = buildDataProvider(item);
    const { screen } = await renderDialog(item, dataProvider);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Trust sender" }))
      .toBeInTheDocument();
  });

  it("does not offer Trust sender when sender_email is null — an item ingested before that column existed", async () => {
    // Arrange
    const item = buildItem({ sender_email: null });
    const dataProvider = buildDataProvider(item);
    const { screen } = await renderDialog(item, dataProvider);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Trust sender" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByText(/don't have a return address on file/))
      .toBeInTheDocument();
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
    const item = buildItem({ sender: null, sender_email: null });
    const dataProvider = buildDataProvider(item);
    const { screen } = await renderDialog(item, dataProvider);

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Discard" }))
      .toBeInTheDocument();
  });
});
