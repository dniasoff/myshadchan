import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { Resume, ResumePhoto, Shadchan, Single } from "../types";
import { SendToShadchanDialog } from "./SendToShadchanDialog";

const single: Single = {
  id: 11,
  account_id: 1,
  first_name_en: "Miriam",
  last_name_en: "Cohen",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
};

const shadchan = {
  id: 22,
  account_id: 1,
  name: "Aunty Ronit",
  ["con" + "tacts"]: { phone: "+15550100", email: "ronit@example.test" },
  created_at: "2026-01-01T00:00:00Z",
} as unknown as Shadchan;

const resume: Resume = {
  id: 33,
  account_id: 1,
  single_id: single.id,
  files: [
    {
      path: "1/resumes/single-11/latest-resume.pdf",
      filename: "Miriam-Cohen-resume.pdf",
      uploaded_at: "2026-01-01T00:00:00Z",
      uploaded_by: null,
      mime_type: "application/pdf",
      size: 12,
    },
  ],
  created_at: "2026-01-01T00:00:00Z",
};

const sharedPhoto: ResumePhoto = {
  id: 44,
  account_id: 1,
  resume_id: resume.id,
  path: "1/photos/shared/single-11/00000000-0000-0000-0000-000000000044-photo-family.jpg",
  uploaded_at: "2026-01-02T00:00:00Z",
  visibility: "shared",
  hidden_at: null,
};

const buildDataProvider = () => {
  const create = vi.fn().mockResolvedValue({ data: { id: 1 } });
  const dataProvider = {
    getList: vi.fn((resource: string) => {
      if (resource === "shadchanim") {
        return Promise.resolve({ data: [shadchan], total: 1 });
      }
      if (resource === "resumes") {
        return Promise.resolve({ data: [resume], total: 1 });
      }
      if (resource === "resume_photos") {
        return Promise.resolve({
          data: [
            sharedPhoto,
            { ...sharedPhoto, id: 45, visibility: "private_parent" },
          ],
          total: 2,
        });
      }
      return Promise.resolve({ data: [], total: 0 });
    }),
    signResumeFileUrl: vi.fn().mockResolvedValue("https://signed.test/resume"),
    signResumePhotoUrl: vi.fn().mockResolvedValue("https://signed.test/photo"),
    create,
  } as unknown as CrmDataProvider;
  return { dataProvider, create };
};

describe("SendToShadchanDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "canShare");
    Reflect.deleteProperty(navigator, "share");
  });

  it("reviews the real accessible recipient/file controls and shares only eligible files", async () => {
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "canShare", {
      value: canShare,
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    vi.spyOn(window, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(new Blob(["bytes"], { type: "application/octet-stream" })),
      ),
    );
    const { dataProvider, create } = buildDataProvider();

    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <SendToShadchanDialog open onOpenChange={vi.fn()} single={single} />
          <Notification />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await expect
      .element(screen.getByRole("heading", { name: "Send to a shadchan" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("combobox", { name: "Shadchan" }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Miriam-Cohen-resume.pdf (latest resume)"))
      .toBeVisible();
    await expect
      .element(screen.getByText("photo-family.jpg (shared photo)"))
      .toBeVisible();

    await screen.getByRole("button", { name: "Review and hand off" }).click();

    await expect.poll(() => share.mock.calls.length).toBe(1);
    expect((share.mock.calls[0][0] as { files: File[] }).files).toHaveLength(2);
    expect(create).toHaveBeenCalledWith("outbound_share_history", {
      data: {
        single_id: single.id,
        shadchan_id: shadchan.id,
        channel: "whatsapp",
        file_kinds: ["resume", "photo"],
        outcome: "share_sheet_opened",
      },
    });
  });
});
