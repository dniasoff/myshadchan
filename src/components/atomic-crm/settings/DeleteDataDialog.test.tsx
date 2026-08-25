import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { AuthProvider, DataProvider } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { DeleteDataDialog } from "./DeleteDataDialog";

/**
 * This dialog had no tests, and both of its defects were "the whole flow is
 * unreachable" rather than anything subtle:
 *
 * 1. The primary buttons passed `asChild` with a plain string child. Radix
 *    `Slot` throws on that ("Expected a single React element child"), so
 *    merely OPENING the dialog crashed into the app-shell ErrorBoundary and
 *    account deletion could not be started at all. The first test is
 *    therefore literally "open it and click through" — it fails by throwing
 *    if `asChild` ever comes back.
 * 2. Every step nested a second `<DialogContent>` inside the outer one.
 *    `ui/dialog.tsx` makes `DialogContent` render its own portal + a
 *    full-screen `z-50` overlay, so that stacked a second modal over this
 *    dialog's own footer and the Cancel/Confirm buttons could not be tapped
 *    on a phone. The count assertion below is the falsifiable form of that:
 *    one open `Dialog` must produce exactly one `[data-slot=dialog-content]`.
 */

const buildAuthProvider = (): AuthProvider =>
  ({
    checkAuth: () => Promise.resolve(),
    checkError: () => Promise.resolve(),
    getPermissions: () => Promise.resolve(),
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    getIdentity: () => Promise.resolve({ id: "auth-uid-1", fullName: "Rivka" }),
  }) as unknown as AuthProvider;

const buildDataProvider = (custom: ReturnType<typeof vi.fn>): DataProvider =>
  ({ custom }) as unknown as DataProvider;

const renderDialog = async () => {
  // Resolves `current_context_id` first, then `delete_account_data`.
  const custom = vi
    .fn()
    .mockResolvedValueOnce({ data: 42 })
    .mockResolvedValue({ data: true });

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        authProvider={buildAuthProvider()}
        dataProvider={buildDataProvider(custom)}
        queryClient={new QueryClient()}
        i18nProvider={testI18nProvider}
      >
        <DeleteDataDialog />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, custom };
};

const openDialogCount = () =>
  document.querySelectorAll('[data-slot="dialog-content"]').length;

describe("DeleteDataDialog", () => {
  it("opens without crashing and reaches the confirmation step", async () => {
    // Arrange
    const { screen } = await renderDialog();

    // Act
    await screen.getByRole("button", { name: "Delete my data" }).click();

    // Assert — the first step's own copy renders...
    await expect
      .element(screen.getByText("Deleting your family's data"))
      .toBeVisible();

    // Act — ...and its footer button is reachable and works.
    await screen.getByRole("button", { name: "Confirm deletion" }).click();

    // Assert
    await expect
      .element(screen.getByText("Please confirm deletion"))
      .toBeVisible();
  });

  it("renders exactly one dialog panel per step, never a nested second one", async () => {
    // Arrange
    const { screen } = await renderDialog();

    // Act
    await screen.getByRole("button", { name: "Delete my data" }).click();
    await expect
      .element(screen.getByText("Deleting your family's data"))
      .toBeVisible();

    // Assert — a nested DialogContent would portal a second panel (and a
    // second full-screen overlay over this one's footer).
    expect(openDialogCount()).toBe(1);

    // Act
    await screen.getByRole("button", { name: "Confirm deletion" }).click();
    await expect
      .element(screen.getByText("Please confirm deletion"))
      .toBeVisible();

    // Assert
    expect(openDialogCount()).toBe(1);
  });

  it("calls the deletion RPC only after the second, explicit confirmation", async () => {
    // Arrange
    const { screen, custom } = await renderDialog();

    // Act
    await screen.getByRole("button", { name: "Delete my data" }).click();
    await screen.getByRole("button", { name: "Confirm deletion" }).click();

    // Assert — reaching the confirm step alone deletes nothing.
    expect(custom).not.toHaveBeenCalled();

    // Act — the confirm step's own destructive button. Radix marks the rest
    // of the document `aria-hidden` while a modal dialog is open, so the
    // identically-labelled trigger behind it is out of the accessibility
    // tree and this resolves to exactly one element.
    await screen.getByRole("button", { name: "Delete my data" }).click();

    // Assert
    await expect
      .poll(() =>
        custom.mock.calls.some(
          ([args]) => args?.url === "/rpc/delete_account_data",
        ),
      )
      .toBe(true);
  });
});
