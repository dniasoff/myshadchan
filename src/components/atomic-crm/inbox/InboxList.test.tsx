import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, memoryStore, TestMemoryRouter } from "ra-core";
import type { Store } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { InboxItem } from "../types";
import { InboxList } from "./InboxList";

/**
 * Epic 11 — the "Needs review" tab split. The FIRST test here is the
 * regression test for the whole design (per this feature's own report): it
 * must fail the moment the working inbox's `status: 'unresolved'` filter is
 * loosened or removed, since that is exactly the failure mode the settled
 * design exists to prevent (held mail leaking into the working inbox).
 */

const UNRESOLVED_ITEM: InboxItem = {
  id: 1,
  account_id: 7,
  created_at: "2026-07-20T10:12:00.000Z",
  source: "whatsapp",
  sender: "Mrs. Feldman",
  sender_needs_confirmation: false,
  subject: "A working-inbox suggestion",
  raw_text: "Should be visible on the working inbox tab.",
  attachments: null,
  status: "unresolved",
  single_id: null,
  shadchan_id: null,
  resolved_shidduchim_id: null,
  connection_id: null,
  resolution_attempt_id: null,
  resolution_input: null,
};

const HELD_ITEM: InboxItem = {
  id: 2,
  account_id: 7,
  created_at: "2026-07-21T09:00:00.000Z",
  source: "email",
  sender: "newcontact@example.com",
  sender_needs_confirmation: false,
  subject: "An unreviewed sender's message",
  raw_text: "Should be held for review, never in the working inbox.",
  attachments: null,
  status: "held",
  single_id: null,
  shadchan_id: null,
  resolved_shidduchim_id: null,
  connection_id: null,
  resolution_attempt_id: null,
  resolution_input: null,
};

const renderInboxList = (
  inboxItems: InboxItem[],
  initialEntries: string[] = ["/inbox_items"],
  store: Store = memoryStore(),
) =>
  render(
    <TestMemoryRouter initialEntries={initialEntries}>
      <CoreAdminContext
        store={store}
        dataProvider={fakeDataProvider({ inbox_items: inboxItems })}
        i18nProvider={testI18nProvider}
      >
        <InboxList />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("InboxList — the working inbox tab (regression guard)", () => {
  it("shows an unresolved item and does NOT show a held item — the whole design depends on this", async () => {
    // Arrange / Act
    const screen = await renderInboxList([UNRESOLVED_ITEM, HELD_ITEM]);

    // Assert
    await expect
      .element(screen.getByText("A working-inbox suggestion"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("An unreviewed sender's message"))
      .not.toBeInTheDocument();
  });

  it("shows the calm empty state when there is nothing unresolved, even while items are held", async () => {
    // Arrange / Act
    const screen = await renderInboxList([HELD_ITEM]);

    // Assert
    await expect
      .element(screen.getByText("Nothing to confirm"))
      .toBeInTheDocument();
  });
});

describe("InboxList — the Needs-review tab", () => {
  it("shows held items and only held items once the tab is opened", async () => {
    // Arrange
    const screen = await renderInboxList([UNRESOLVED_ITEM, HELD_ITEM]);

    // Act
    await screen.getByRole("tab", { name: /Needs review/ }).click();

    // Assert
    await expect
      .element(screen.getByText("An unreviewed sender's message"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("A working-inbox suggestion"))
      .not.toBeInTheDocument();
  });

  it("is directly reachable via ?tab=needs-review — URL as state survives a fresh load", async () => {
    // Arrange / Act
    const screen = await renderInboxList(
      [UNRESOLVED_ITEM, HELD_ITEM],
      ["/inbox_items?tab=needs-review"],
    );

    // Assert — no tab click needed; the held item is already visible.
    await expect
      .element(screen.getByText("An unreviewed sender's message"))
      .toBeInTheDocument();
  });

  it("shows its own calm empty state when there is nothing held", async () => {
    // Arrange
    const screen = await renderInboxList(
      [UNRESOLVED_ITEM],
      ["/inbox_items?tab=needs-review"],
    );

    // Act / Assert
    await expect
      .element(screen.getByText("Nothing waiting on review"))
      .toBeInTheDocument();
  });
});

describe("InboxList — the Needs-review badge", () => {
  it("shows a count when held items exist", async () => {
    // Arrange / Act
    const screen = await renderInboxList([UNRESOLVED_ITEM, HELD_ITEM]);

    // Assert
    await expect
      .element(screen.getByRole("tab", { name: /Needs review/ }))
      .toHaveTextContent("1");
  });

  it("shows no count at all when there are no held items", async () => {
    // Arrange / Act
    const screen = await renderInboxList([UNRESOLVED_ITEM]);

    // Assert — the tab's own label, with nothing appended.
    const tab = screen.getByRole("tab", { name: "Needs review" });
    await expect.element(tab).toBeInTheDocument();
    await expect.element(tab).not.toHaveTextContent(/\d/);
  });
});
