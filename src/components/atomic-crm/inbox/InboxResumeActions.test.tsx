import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { InboxItem } from "../types";
import {
  AMBIGUOUS_READ_COPY,
  InboxResumeActionButtons,
  InboxResumeActionsDialog,
  NEW_SUGGESTION_SUCCESS_COPY,
} from "./InboxResumeActions";

const item = (attachments: InboxItem["attachments"]): InboxItem => ({
  id: 1,
  created_at: "2026-01-01T00:00:00Z",
  source: "upload",
  sender_needs_confirmation: false,
  attachments,
  status: "unresolved",
});

const documentAttachment = {
  title: "resume.pdf",
  type: "application/pdf",
  path: "1/inbox/resume.pdf",
  src: "https://example.test/resume.pdf",
};

const shadchanItem = {
  id: 7,
  account_id: 1,
  created_at: "2026-01-01T00:00:00Z",
  source: "shadchan",
  raw_text: "Rivka the Shadchan",
  subject: null,
  sender: "Rivka the Shadchan",
  sender_needs_confirmation: false,
  attachments: [documentAttachment],
  status: "unresolved",
  single_id: null,
  shadchan_id: null,
  resolved_shidduchim_id: null,
  connection_id: 7,
} as InboxItem;

const renderResumeDialog = async (
  action: "new" | "attach" = "new",
  getList = vi.fn().mockResolvedValue({ data: [], total: 0 }),
) => {
  const dataProvider = {
    getList,
  } as unknown as CrmDataProvider;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const screen = await render(
    <TestMemoryRouter initialEntries={["/inbox_items"]}>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <InboxResumeActionsDialog
          item={shadchanItem}
          open
          action={action}
          onClose={vi.fn()}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, dataProvider };
};

describe("Inbox resume action buttons", () => {
  it("filters linked and selectable shadchan lookups to active rows", async () => {
    const { dataProvider } = await renderResumeDialog();

    await expect
      .poll(() =>
        (dataProvider.getList as ReturnType<typeof vi.fn>).mock.calls.some(
          ([resource, params]) =>
            resource === "shadchanim" &&
            params.filter?.connection_id === 7 &&
            params.filter?.["archived_at@is"] === null,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        (dataProvider.getList as ReturnType<typeof vi.fn>).mock.calls.some(
          ([resource, params]) =>
            resource === "shadchanim" &&
            params.filter?.connection_id === undefined &&
            params.filter?.["archived_at@is"] === null,
        ),
      )
      .toBe(true);
  });

  it("does not list archived suggestions in the attach picker", async () => {
    const getList = vi.fn().mockImplementation((resource, params) => {
      if (resource !== "shidduchim") {
        return Promise.resolve({ data: [], total: 0 });
      }
      const rows = [
        { id: 1, name_en: "Active suggestion", created_at: "2026-01-02" },
        { id: 2, name_en: "Archived suggestion", created_at: "2026-01-01" },
      ];
      const data =
        params.filter?.["archived_at@is"] === null ? [rows[0]] : rows;
      return Promise.resolve({ data, total: data.length });
    });
    const { screen } = await renderResumeDialog("attach", getList);

    await expect
      .poll(() =>
        getList.mock.calls.some(
          ([resource, params]) =>
            resource === "shidduchim" &&
            params.filter?.["archived_at@is"] === null,
        ),
      )
      .toBe(true);
    await expect
      .element(screen.getByRole("option", { name: /Active suggestion/ }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("option", { name: /Archived suggestion/ }))
      .not.toBeInTheDocument();
  });

  it("offers exactly the two approved actions for a resume document", async () => {
    const onChoose = vi.fn();
    const screen = await render(
      <InboxResumeActionButtons
        item={item([documentAttachment])}
        enabled
        onChoose={onChoose}
      />,
    );

    await expect
      .element(screen.getByRole("button", { name: "Attach to a suggestion" }))
      .toBeEnabled();
    await expect
      .element(screen.getByRole("button", { name: "Make a new suggestion" }))
      .toBeEnabled();

    await screen.getByRole("button", { name: "Make a new suggestion" }).click();
    expect(onChoose).toHaveBeenCalledWith("new");
  });

  it("disables both actions with the safe file-first copy for picture-only items", async () => {
    const screen = await render(
      <InboxResumeActionButtons
        item={item([
          {
            title: "photo.jpg",
            type: "image/jpeg",
            path: "1/inbox/photo.jpg",
            src: "https://example.test/photo.jpg",
          },
        ])}
        enabled
        onChoose={vi.fn()}
      />,
    );

    await expect
      .element(screen.getByRole("button", { name: /Attach to a suggestion/ }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: /Make a new suggestion/ }))
      .toBeDisabled();
    await expect
      .element(screen.getByText("Add a resume file first."))
      .toBeInTheDocument();
  });

  it("keeps held items disabled until the sender is trusted", async () => {
    const screen = await render(
      <InboxResumeActionButtons
        item={item([documentAttachment])}
        enabled={false}
        onChoose={vi.fn()}
      />,
    );

    await expect
      .element(screen.getByRole("button", { name: /Attach to a suggestion/ }))
      .toBeDisabled();
    await expect
      .element(screen.getByText("Trust sender first."))
      .toBeInTheDocument();
  });

  it("keeps the nameless success notification static and filename-free", () => {
    expect(NEW_SUGGESTION_SUCCESS_COPY).toBe("Created. Open it");
    expect(NEW_SUGGESTION_SUCCESS_COPY).not.toContain("resume.pdf");
    expect(AMBIGUOUS_READ_COPY).not.toContain("resume.pdf");
  });
});
