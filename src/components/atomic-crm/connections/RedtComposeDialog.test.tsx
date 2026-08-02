import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import { RedtComposeDialog } from "./RedtComposeDialog";

/**
 * Story 8.3 (Task 6): the shadchan-side compose dialog. Pins the submit
 * path (`dataProvider.redtViaConnection`, called with the trimmed
 * subject/text and no attachments — see the component's own comment on why
 * attachment upload is deliberately not wired yet) and the friendly-error
 * behaviour every other dialog in this codebase follows
 * (ConnectionAccept.test.tsx's own precedent).
 */

const CONNECTION_ID = 7;

const renderDialog = ({
  redtViaConnection = vi.fn().mockResolvedValue({ id: 1 }),
  onClose = vi.fn(),
}: {
  redtViaConnection?: ReturnType<typeof vi.fn>;
  onClose?: () => void;
} = {}) => {
  const dataProvider = {
    redtViaConnection,
  } as unknown as CrmDataProvider;

  const screen = render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <RedtComposeDialog
          connectionId={CONNECTION_ID}
          open
          onClose={onClose}
        />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { dataProvider, onClose, screen };
};

describe("RedtComposeDialog", () => {
  it("renders the compose form when open", async () => {
    // Arrange / Act
    const { screen: screenPromise } = renderDialog();
    const screen = await screenPromise;

    // Assert
    await expect.element(screen.getByText("Send a redt")).toBeInTheDocument();
    await expect
      .element(screen.getByLabelText("The suggestion"))
      .toBeInTheDocument();
  });

  it("disables Send redt until the suggestion text is filled in", async () => {
    // Arrange / Act
    const { screen: screenPromise } = renderDialog();
    const screen = await screenPromise;

    // Assert
    await expect
      .element(screen.getByRole("button", { name: "Send redt" }))
      .toBeDisabled();
  });

  it("submitting calls redtViaConnection with the connection id, trimmed subject/text, and no attachments", async () => {
    // Arrange
    const redtViaConnection = vi.fn().mockResolvedValue({ id: 1 });
    const onClose = vi.fn();
    const { screen: screenPromise } = renderDialog({
      redtViaConnection,
      onClose,
    });
    const screen = await screenPromise;

    // Act
    await screen
      .getByLabelText("Subject (optional)")
      .fill("  A suggestion for Rivky  ");
    await screen
      .getByLabelText("The suggestion")
      .fill("  Dovid Berkowitz, BMG  ");
    await screen.getByRole("button", { name: "Send redt" }).click();

    // Assert
    expect(redtViaConnection).toHaveBeenCalledExactlyOnceWith({
      connection_id: CONNECTION_ID,
      subject: "A suggestion for Rivky",
      raw_text: "Dovid Berkowitz, BMG",
      attachments: null,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("submitting with no subject sends subject: null", async () => {
    // Arrange
    const redtViaConnection = vi.fn().mockResolvedValue({ id: 1 });
    const { screen: screenPromise } = renderDialog({ redtViaConnection });
    const screen = await screenPromise;

    // Act
    await screen.getByLabelText("The suggestion").fill("Dovid Berkowitz");
    await screen.getByRole("button", { name: "Send redt" }).click();

    // Assert
    expect(redtViaConnection).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ subject: null }),
    );
  });

  it("shows a translated error and keeps the dialog open when redtViaConnection fails", async () => {
    // Arrange
    const redtViaConnection = vi
      .fn()
      .mockRejectedValue(new Error("connection 7 is not an active connection"));
    const onClose = vi.fn();
    const { screen: screenPromise } = renderDialog({
      redtViaConnection,
      onClose,
    });
    const screen = await screenPromise;

    // Act
    await screen.getByLabelText("The suggestion").fill("Dovid Berkowitz");
    await screen.getByRole("button", { name: "Send redt" }).click();

    // Assert
    await expect
      .element(screen.getByText("connection 7 is not an active connection"))
      .toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
