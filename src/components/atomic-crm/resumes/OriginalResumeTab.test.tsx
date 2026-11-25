import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  CoreAdminContext,
  RecordContextProvider,
  TestMemoryRouter,
} from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { InboxItem, ShidduchSummary } from "../types";
import { OriginalResumeTab } from "./OriginalResumeTab";

const { signInboxAttachmentUrl } = vi.hoisted(() => ({
  signInboxAttachmentUrl: vi.fn(),
}));

vi.mock("../providers/supabase/inboxAttachments", () => ({
  copyInboxAttachmentsToEntityFiles: vi.fn(),
  signInboxAttachmentUrl,
}));
vi.mock("../entity360/entityPaths", () => ({
  buildTabPath: () => "/shidduchim/7/resume",
}));
vi.mock("../entity360/useViewerRole", () => ({
  useViewerRole: () => ({ role: "parent_admin", isPending: false }),
}));
vi.mock("./ResumeDocument", () => ({
  ResumeDocument: () => null,
}));
vi.mock("../inbox/useParseResume", () => ({
  useParseResume: () => ({ parse: vi.fn() }),
}));

const buildCapture = (
  attachments: NonNullable<InboxItem["attachments"]>,
): InboxItem =>
  ({
    id: 42,
    account_id: 1,
    created_at: "2026-01-01T00:00:00Z",
    source: "whatsapp",
    raw_text: "*Miriam Cohen*\nBrooklyn",
    subject: null,
    sender: null,
    sender_needs_confirmation: false,
    attachments,
    status: "resolved",
    resolved_shidduchim_id: 7,
    resolution_input: { resume_source_inbox_item_id: 42 },
  }) as InboxItem;

const renderTab = async (capture: InboxItem) => {
  const dataProvider = {
    getList: vi.fn(async (resource: string) => {
      if (resource === "inbox_items") return { data: [capture], total: 1 };
      if (resource === "resumes") return { data: [], total: 0 };
      return { data: [], total: 0 };
    }),
    findResumePhotoBySource: vi.fn().mockResolvedValue(null),
  } as unknown as CrmDataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <RecordContextProvider
          value={
            {
              id: 7,
              name_en: "Miriam Cohen",
            } as unknown as ShidduchSummary
          }
        >
          <OriginalResumeTab />
        </RecordContextProvider>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, dataProvider };
};

describe("OriginalResumeTab WhatsApp picture handling", () => {
  it("re-signs a stale persisted source URL for the private preview", async () => {
    signInboxAttachmentUrl.mockReset().mockResolvedValue("fresh-picture-url");
    const capture = buildCapture([
      {
        path: "1/inbox/42/photo.jpg",
        src: "expired-picture-url",
        title: "photo.jpg",
        type: "image/jpeg",
      },
    ]);

    const { screen } = await renderTab(capture);

    await expect.poll(() => signInboxAttachmentUrl.mock.calls.length).toBe(1);
    expect(signInboxAttachmentUrl).toHaveBeenCalledWith("1/inbox/42/photo.jpg");
    await expect
      .element(
        screen.getByRole("img", {
          name: "Private picture from WhatsApp: photo.jpg",
        }),
      )
      .toHaveAttribute("src", "fresh-picture-url");
  });

  it("shows a plain retryable preview error when signing fails", async () => {
    signInboxAttachmentUrl.mockReset().mockRejectedValue(new Error("expired"));
    const capture = buildCapture([
      {
        path: "1/inbox/42/photo.jpg",
        src: "expired-picture-url",
        title: "photo.jpg",
        type: "image/jpeg",
      },
    ]);

    const { screen } = await renderTab(capture);

    await expect
      .element(screen.getByText("Couldn't show this picture, try again."))
      .toBeInTheDocument();
  });

  it("does not offer Photo promotion for HEIC or WebP captures", async () => {
    signInboxAttachmentUrl.mockReset().mockResolvedValue("fresh-picture-url");
    const capture = buildCapture([
      {
        path: "1/inbox/42/photo.heic",
        src: "expired-heic-url",
        title: "photo.heic",
        type: "image/heic",
      },
      {
        path: "1/inbox/42/photo.webp",
        src: "expired-webp-url",
        title: "photo.webp",
        type: "image/webp",
      },
    ]);

    const { screen } = await renderTab(capture);

    await expect
      .element(
        screen.getByText(
          "This picture type can't be used as the Photo yet; it stays safe in Files.",
        ),
      )
      .toBeInTheDocument();
    expect(
      screen.container.querySelectorAll('button:not([aria-hidden="true"])')
        .length,
    ).toBe(0);
  });
});
