import { QueryClient } from "@tanstack/react-query";
import { page } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import {
  MAX_INBOX_TOTAL_BYTES,
  MAX_INBOX_FILES,
} from "../providers/commons/inboxAttachmentValidation";
import type { CrmDataProvider } from "../providers/types";
import { MY_CONTEXTS_QUERY_KEY } from "../root/useMyContexts";
import { AddToInboxDialog } from "./AddToInboxDialog";

const pdfFile = (name = "resume.pdf") =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], name, {
    type: "application/pdf",
  });

const pictureFile = (name = "portrait.jpg") =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], name, {
    type: "image/jpeg",
  });

const largePdfFile = (name: string) => {
  const bytes = new Uint8Array(8 * 1024 * 1024);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  return new File([bytes], name, { type: "application/pdf" });
};

afterEach(async () => {
  await page.viewport(1280, 720);
});

const buildProvider = () => {
  const dataProvider = fakeDataProvider({
    accounts: [
      {
        id: 7,
        name: "Fixture household",
        kind: "household",
        inbound_email_token: "a1b2c3d4e5f6",
      },
    ],
    inbox_items: [],
  }) as unknown as CrmDataProvider;
  dataProvider.getMyContexts = vi.fn().mockResolvedValue([
    {
      account_id: 7,
      kind: "household",
      name: "Fixture household",
      role: "parent_admin",
      is_active: true,
    },
  ]);
  return dataProvider;
};

const renderDialog = async (dataProvider: CrmDataProvider) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(MY_CONTEXTS_QUERY_KEY, [
    {
      account_id: 7,
      kind: "household",
      name: "Fixture household",
      role: "parent_admin",
      is_active: true,
    },
  ]);
  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <AddToInboxDialog open onClose={vi.fn()} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("AddToInboxDialog — manual files", () => {
  it("stores the optional sender phone with the captured Inbox item", async () => {
    const dataProvider = buildProvider();
    const create = vi.spyOn(dataProvider, "create");
    const screen = await renderDialog(dataProvider);

    await screen.getByLabelText("What arrived").fill("A resume was sent");
    await screen.getByLabelText("From (optional)").fill("Sara Cohen");
    await screen
      .getByLabelText("Phone number (optional)")
      .fill(" +1 347-555-0182 ");
    await screen.getByRole("button", { name: "Add to inbox" }).click();

    await expect.poll(() => create.mock.calls.length).toBe(1);
    expect(create).toHaveBeenCalledWith(
      "inbox_items",
      expect.objectContaining({
        data: expect.objectContaining({
          sender: "Sara Cohen",
          sender_phone: "+1 347-555-0182",
        }),
      }),
    );
  });

  it("blocks a sender phone that violates the shared database checks", async () => {
    const dataProvider = buildProvider();
    const create = vi.spyOn(dataProvider, "create");
    const screen = await renderDialog(dataProvider);

    await screen.getByLabelText("What arrived").fill("A resume was sent");
    await screen.getByLabelText("Phone number (optional)").fill("x".repeat(41));
    await screen.getByRole("button", { name: "Add to inbox" }).click();

    expect(create).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Use 40 characters or fewer for a phone number");
  });

  it("lists several files with kind and size, and removes one before saving", async () => {
    const screen = await renderDialog(buildProvider());
    const fileInput = screen.getByLabelText("Add files or photos");

    await fileInput.upload([pdfFile(), pictureFile()]);

    await expect.element(screen.getByText("resume.pdf")).toBeInTheDocument();
    await expect.element(screen.getByText("portrait.jpg")).toBeInTheDocument();
    await expect.element(screen.getByText(/Resume · 5 B/)).toBeInTheDocument();
    await expect.element(screen.getByText(/Picture · 3 B/)).toBeInTheDocument();

    await screen.getByRole("button", { name: "Remove portrait.jpg" }).click();
    await expect
      .element(screen.getByText("portrait.jpg"))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("resume.pdf")).toBeInTheDocument();
  });

  it("keeps an unsupported file out of the selection", async () => {
    const screen = await renderDialog(buildProvider());

    await screen
      .getByLabelText("Add files or photos")
      .upload(new File(["plain text"], "notes.txt", { type: "text/plain" }));

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("That file type isn't supported");
    await expect.element(screen.getByText("notes.txt")).not.toBeInTheDocument();
  });

  it("limits one add to ten files and forty MiB in total", async () => {
    const screen = await renderDialog(buildProvider());
    const fileInput = screen.getByLabelText("Add files or photos");

    await fileInput.upload(
      Array.from({ length: MAX_INBOX_FILES + 1 }, (_, index) =>
        pdfFile(`resume-${index}.pdf`),
      ),
    );
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("You can add up to 10 files at once");

    await fileInput.upload(
      Array.from({ length: 6 }, (_, index) =>
        largePdfFile(`large-${index}.pdf`),
      ),
    );
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Choose files totaling 40 MiB or less");
    expect(MAX_INBOX_TOTAL_BYTES).toBe(40 * 1024 * 1024);
  });

  it("cleans up the row and completed uploads when a later upload fails", async () => {
    const dataProvider = buildProvider();
    const upload = vi
      .fn()
      .mockResolvedValueOnce({
        title: "resume.pdf",
        type: "application/pdf",
        path: "7/inbox/1/resume.pdf",
        src: "blob:resume",
        size: 5,
      })
      .mockRejectedValueOnce(new Error("second upload failed"));
    const remove = vi.fn().mockResolvedValue(undefined);
    dataProvider.uploadInboxAttachment = upload;
    dataProvider.removeInboxAttachment = remove;
    const removeRow = vi.spyOn(dataProvider, "delete");
    const screen = await renderDialog(dataProvider);

    await screen
      .getByLabelText("Add files or photos")
      .upload([pdfFile(), pictureFile()]);
    await screen.getByRole("button", { name: "Add to inbox" }).click();

    await expect.poll(() => upload.mock.calls.length).toBe(2);
    expect(remove).toHaveBeenCalledWith("7/inbox/1/resume.pdf");
    expect(removeRow).toHaveBeenCalledWith(
      "inbox_items",
      expect.objectContaining({ id: expect.anything() }),
    );
    await expect
      .element(
        screen.getByText(
          "Could not add the files. Nothing was changed. Check the files and try again.",
        ),
      )
      .toBeInTheDocument();
  });

  it("retries cleanup once before reporting that nothing changed", async () => {
    const dataProvider = buildProvider();
    const upload = vi
      .fn()
      .mockResolvedValueOnce({
        title: "resume.pdf",
        type: "application/pdf",
        path: "7/inbox/1/resume.pdf",
        src: "blob:resume",
        size: 5,
      })
      .mockRejectedValueOnce(new Error("upload failed"));
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary cleanup failure"))
      .mockResolvedValue(undefined);
    dataProvider.uploadInboxAttachment = upload;
    dataProvider.removeInboxAttachment = remove;
    const removeRow = vi
      .spyOn(dataProvider, "delete")
      .mockRejectedValueOnce(new Error("temporary row cleanup failure"))
      .mockResolvedValue({ data: { id: 1 } });
    const screen = await renderDialog(dataProvider);

    await screen
      .getByLabelText("Add files or photos")
      .upload([pdfFile(), pictureFile()]);
    await screen.getByRole("button", { name: "Add to inbox" }).click();

    await expect.poll(() => upload.mock.calls.length).toBe(2);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(removeRow).toHaveBeenCalledTimes(2);
    await expect
      .element(
        screen.getByText(
          "Could not add the files. Nothing was changed. Check the files and try again.",
        ),
      )
      .toBeInTheDocument();
  });

  it("does not claim nothing changed when cleanup still fails after retry", async () => {
    const dataProvider = buildProvider();
    const upload = vi
      .fn()
      .mockResolvedValueOnce({
        title: "resume.pdf",
        type: "application/pdf",
        path: "7/inbox/1/resume.pdf",
        src: "blob:resume",
        size: 5,
      })
      .mockRejectedValueOnce(new Error("upload failed"));
    const remove = vi.fn().mockRejectedValue(new Error("cleanup failed"));
    dataProvider.uploadInboxAttachment = upload;
    dataProvider.removeInboxAttachment = remove;
    const removeRow = vi
      .spyOn(dataProvider, "delete")
      .mockRejectedValue(new Error("row cleanup failed"));
    const screen = await renderDialog(dataProvider);

    await screen
      .getByLabelText("Add files or photos")
      .upload([pdfFile(), pictureFile()]);
    await screen.getByRole("button", { name: "Add to inbox" }).click();

    await expect.poll(() => remove.mock.calls.length).toBe(2);
    expect(removeRow).toHaveBeenCalledTimes(2);
    await expect
      .element(
        screen.getByText(
          "Could not add the files. Please check the Inbox before trying again.",
        ),
      )
      .toBeInTheDocument();
  });
});

describe("AddToInboxDialog — capture guidance", () => {
  it("shows the household capture address and privacy note", async () => {
    const screen = await renderDialog(buildProvider());

    await expect
      .element(screen.getByLabelText("Household MyShadchan email address"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/Pictures stay private/))
      .toBeInTheDocument();
  });

  it("uses the bottom sheet at 390px and the dialog at 1280px", async () => {
    await page.viewport(390, 844);
    const mobileScreen = await renderDialog(buildProvider());
    await expect
      .poll(() => document.querySelector('[data-slot="sheet-content"]'))
      .toBeTruthy();
    await expect
      .element(mobileScreen.getByText("Add a note or files."))
      .toBeInTheDocument();
    await expect
      .element(
        mobileScreen.getByText(
          "This opens Photos or Files on your phone. Each file should be 8 MiB or smaller.",
        ),
      )
      .toBeInTheDocument();
    mobileScreen.unmount();

    await page.viewport(1280, 844);
    const desktopScreen = await renderDialog(buildProvider());
    await expect
      .poll(() => document.querySelector('[data-slot="dialog-content"]'))
      .toBeTruthy();
    await expect
      .element(
        desktopScreen.getByText(
          "On your computer this opens Explorer or Finder. Choose a resume and a picture together.",
        ),
      )
      .toBeInTheDocument();
    desktopScreen.unmount();
  });
});
