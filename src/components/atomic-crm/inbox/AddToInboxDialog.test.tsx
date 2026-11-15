import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import fakeDataProvider from "ra-data-fakerest";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
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
});
