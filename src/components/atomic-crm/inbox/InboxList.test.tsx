import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { render } from "vitest-browser-react";
import { CoreAdminContext, memoryStore, TestMemoryRouter } from "ra-core";
import type { Store } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import type { InboxItem, MyContext } from "../types";
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

const renderInboxList = async (
  inboxItems: InboxItem[],
  initialEntries: string[] = ["/inbox_items"],
  store: Store = memoryStore(),
  role: MyContext["role"] | null = "parent_admin",
  pending = false,
) => {
  const dataProvider = fakeDataProvider({ inbox_items: inboxItems });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (pending) {
    dataProvider.getMyContexts = vi.fn(
      () => new Promise<MyContext[]>(() => undefined),
    );
  } else {
    queryClient.setQueryData(
      MY_CONTEXTS_QUERY_KEY,
      role
        ? [
            {
              account_id: 7,
              kind: "household",
              name: "Fixture household",
              role,
              is_active: true,
            } satisfies MyContext,
          ]
        : [],
    );
  }
  const deleteInboxItem = vi.fn().mockResolvedValue(undefined);
  Object.assign(dataProvider, { deleteInboxItem });
  const getList = vi.spyOn(dataProvider, "getList");
  const screen = await render(
    <TestMemoryRouter initialEntries={initialEntries}>
      <CoreAdminContext
        store={store}
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <InboxList />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, getList, queryClient, deleteInboxItem };
};

describe("InboxList — delete and undo", () => {
  it("hides the item immediately and restores it without calling final delete on Undo", async () => {
    const { screen, deleteInboxItem } = await renderInboxList([
      UNRESOLVED_ITEM,
    ]);

    await screen.getByRole("button", { name: "Delete this item" }).click();
    await expect
      .element(screen.getByRole("dialog"))
      .toHaveTextContent("Delete this item?");
    await screen.getByRole("button", { name: "Delete", exact: true }).click();

    await expect
      .element(screen.getByText("A working-inbox suggestion"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Item deleted.")).toBeInTheDocument();

    await screen.getByRole("button", { name: "Undo" }).click();

    await expect
      .element(screen.getByText("A working-inbox suggestion"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Item restored."))
      .toBeInTheDocument();
    expect(deleteInboxItem).not.toHaveBeenCalled();
  });
});

describe("InboxList — the working inbox tab (regression guard)", () => {
  it("shows an unresolved item and does NOT show a held item — the whole design depends on this", async () => {
    // Arrange / Act
    const { screen } = await renderInboxList([UNRESOLVED_ITEM, HELD_ITEM]);

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
    const { screen } = await renderInboxList([HELD_ITEM]);

    // Assert
    await expect
      .element(screen.getByText("No files or notes are waiting yet"))
      .toBeInTheDocument();
  });
});

describe("InboxList — the Needs-review tab", () => {
  it("shows held items and only held items once the tab is opened", async () => {
    // Arrange
    const { screen } = await renderInboxList([UNRESOLVED_ITEM, HELD_ITEM]);

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
    const { screen } = await renderInboxList(
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
    const { screen } = await renderInboxList(
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
    const { screen } = await renderInboxList([UNRESOLVED_ITEM, HELD_ITEM]);

    // Assert
    await expect
      .element(screen.getByRole("tab", { name: /Needs review/ }))
      .toHaveTextContent("1");
  });

  it("shows no count at all when there are no held items", async () => {
    // Arrange / Act
    const { screen } = await renderInboxList([UNRESOLVED_ITEM]);

    // Assert — the tab's own label, with nothing appended.
    const tab = screen.getByRole("tab", { name: "Needs review" });
    await expect.element(tab).toBeInTheDocument();
    await expect.element(tab).not.toHaveTextContent(/\d/);
  });
});

describe("InboxList — role and pending query gate", () => {
  it.each(["single", null] as const)(
    "does not mount Inbox queries for role=%s",
    async (role) => {
      const { getList } = await renderInboxList(
        [],
        ["/inbox_items"],
        memoryStore(),
        role,
      );
      expect(getList).not.toHaveBeenCalled();
    },
  );

  it("does not mount Inbox queries while the active role is pending", async () => {
    const { getList, queryClient } = await renderInboxList(
      [],
      ["/inbox_items"],
      memoryStore(),
      "parent_admin",
      true,
    );
    expect(getList).not.toHaveBeenCalled();
    await queryClient.cancelQueries({ queryKey: MY_CONTEXTS_QUERY_KEY });
  });
});
