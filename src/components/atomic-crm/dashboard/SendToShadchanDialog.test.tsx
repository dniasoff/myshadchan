import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ComponentProps } from "react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type {
  OutboundShareHistory,
  Resume,
  ResumePhoto,
  Shadchan,
  Single,
} from "../types";
import {
  SendToShadchanButton,
  SendToShadchanDialog,
} from "./SendToShadchanDialog";

const { useViewerRoleMock } = vi.hoisted(() => ({
  useViewerRoleMock: vi.fn(),
}));

vi.mock("../entity360/useViewerRole", () => ({
  useViewerRole: useViewerRoleMock,
}));

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
  contacts: {
    phone: "+15550100",
    whatsapp: "+15550101",
    email: "ronit@example.test",
  },
  created_at: "2026-01-01T00:00:00Z",
} as Shadchan;

const resume: Resume = {
  id: 33,
  account_id: 1,
  single_id: single.id,
  files: [
    {
      path: "1/resumes/single-11/latest-resume.pdf",
      filename: "Miriam-Cohen-resume.pdf",
      uploaded_at: "2026-01-03T00:00:00Z",
      uploaded_by: null,
      mime_type: "application/pdf",
      size: 12,
    },
  ],
  created_at: "2026-01-01T00:00:00Z",
};

const newestSharedPhoto: ResumePhoto = {
  id: 44,
  account_id: 1,
  resume_id: resume.id,
  path: "1/photos/shared/single-11/00000000-0000-0000-0000-000000000044-photo-family.png",
  uploaded_at: "2026-01-03T00:00:00Z",
  visibility: "shared",
  hidden_at: null,
};

const olderSharedPhoto: ResumePhoto = {
  ...newestSharedPhoto,
  id: 43,
  path: "1/photos/shared/single-11/00000000-0000-0000-0000-000000000043-old.jpg",
  uploaded_at: "2026-01-01T00:00:00Z",
};

const privatePhoto: ResumePhoto = {
  ...newestSharedPhoto,
  id: 45,
  uploaded_at: "2026-01-05T00:00:00Z",
  visibility: "private_parent",
};

const hiddenPhoto: ResumePhoto = {
  ...newestSharedPhoto,
  id: 46,
  path: "1/photos/shared/single-11/00000000-0000-0000-0000-000000000046-hidden.webp",
  uploaded_at: "2026-01-04T00:00:00Z",
  hidden_at: "2026-01-04T01:00:00Z",
};

const buildDataProvider = (options?: {
  photos?: ResumePhoto[];
  resume?: Resume[];
  shadchan?: Shadchan;
  shadchanim?: Shadchan[];
  fetchError?: boolean;
  rejectFetch?: "resume" | "photo";
  responseStatus?: { resume?: number; photo?: number };
  history?: OutboundShareHistory[];
}) => {
  const selectedShadchan = options?.shadchan ?? shadchan;
  const selectedShadchanim = options?.shadchanim ?? [selectedShadchan];
  const selectedResume = options?.resume ?? [resume];
  const create = vi.fn().mockResolvedValue({ data: { id: 1 } });
  const dataProvider = {
    getList: vi.fn((resource: string) => {
      if (resource === "shadchanim") {
        return Promise.resolve({
          data: selectedShadchanim,
          total: selectedShadchanim.length,
        });
      }
      if (resource === "resumes") {
        return Promise.resolve({
          data: selectedResume,
          total: selectedResume.length,
        });
      }
      if (resource === "resume_photos") {
        return Promise.resolve({
          data: options?.photos ?? [
            newestSharedPhoto,
            olderSharedPhoto,
            privatePhoto,
            hiddenPhoto,
          ],
          total: (
            options?.photos ?? [
              newestSharedPhoto,
              olderSharedPhoto,
              privatePhoto,
              hiddenPhoto,
            ]
          ).length,
        });
      }
      if (resource === "outbound_share_history") {
        return Promise.resolve({
          data: options?.history ?? [],
          total: options?.history?.length ?? 0,
        });
      }
      return Promise.resolve({ data: [], total: 0 });
    }),
    getMyContexts: vi.fn().mockResolvedValue([]),
    signResumeFileUrl: vi.fn().mockResolvedValue("https://signed.test/resume"),
    signResumePhotoUrl: vi.fn().mockResolvedValue("https://signed.test/photo"),
    create,
  } as unknown as CrmDataProvider;
  const fetchMock = vi.spyOn(window, "fetch").mockImplementation((input) => {
    const url = String(input);
    const kind = url.includes("photo") ? "photo" : "resume";
    if (options?.fetchError || options?.rejectFetch === kind) {
      return Promise.reject(new Error("network down"));
    }
    const status = options?.responseStatus?.[kind] ?? 200;
    return Promise.resolve(
      new Response(new Blob(["bytes"], { type: "application/octet-stream" }), {
        status,
      }),
    );
  });
  return { dataProvider, create, fetchMock };
};

const renderDialog = async (
  dataProvider: CrmDataProvider,
  props: Partial<ComponentProps<typeof SendToShadchanDialog>> = {},
) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <SendToShadchanDialog
          open
          onOpenChange={vi.fn()}
          single={single}
          viewerRole="parent_admin"
          {...props}
        />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

async function chooseRecipient(screen: Awaited<ReturnType<typeof render>>) {
  await screen.getByRole("combobox", { name: "Shadchan" }).click();
  await screen.getByRole("option", { name: "Aunty Ronit" }).click();
}

async function chooseRecipientAndChannel(
  screen: Awaited<ReturnType<typeof render>>,
) {
  await chooseRecipient(screen);
  await screen.getByRole("radio", { name: "WhatsApp" }).click();
}

describe("SendToShadchanDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useViewerRoleMock.mockReset();
    Reflect.deleteProperty(navigator, "canShare");
    Reflect.deleteProperty(navigator, "share");
  });

  it("requires explicit recipient/channel selection and shares only the newest eligible photo", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
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
    const { dataProvider, create, fetchMock } = buildDataProvider();
    const screen = await renderDialog(dataProvider);

    await expect
      .element(
        screen.getByRole("heading", { name: "Send files to a shadchan" }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Share resume and photo" }))
      .toBeDisabled();
    await expect
      .element(screen.getByText("Choose a shadchan to continue."))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "Please check the kid, shadchan, channel, and files. Once a file leaves MyShadchan, we can’t take it back.",
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Share resume and photo" }))
      .toHaveAttribute(
        "aria-describedby",
        expect.stringContaining("send-safety-notice"),
      );
    await expect
      .element(screen.getByText("photo-family.png · image/png"))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "old.jpg · image/jpeg · Size unavailable until download",
        ),
      )
      .not.toBeInTheDocument();

    await chooseRecipientAndChannel(screen);
    expect(dataProvider.signResumeFileUrl).not.toHaveBeenCalled();
    expect(dataProvider.signResumePhotoUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole("button", { name: "Share resume and photo" }))
      .toBeEnabled();
    await screen
      .getByRole("button", { name: "Share resume and photo" })
      .click();

    await expect.poll(() => share.mock.calls.length).toBe(1);
    expect(
      (share.mock.calls[0][0] as { files: File[] }).files.map(
        (file) => file.name,
      ),
    ).toEqual(["Miriam-Cohen-resume.pdf", "photo-family.png"]);
    expect(create).toHaveBeenCalledWith("outbound_share_history", {
      data: {
        single_id: single.id,
        shadchan_id: shadchan.id,
        channel: "whatsapp",
        file_kinds: ["resume", "photo"],
        outcome: "share_sheet_opened",
      },
    });
    await expect
      .element(
        screen.getByText(
          "Share sheet opened. MyShadchan can’t see whether the message was sent.",
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByText("Sent! Delivered successfully."))
      .not.toBeInTheDocument();
  });

  it("requires a second confirmation for resume-only handoff", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    const { dataProvider } = buildDataProvider({ photos: [] });
    const screen = await renderDialog(dataProvider);
    await chooseRecipientAndChannel(screen);
    await expect
      .element(
        screen.getByText(
          "Only the resume will be included because no photo is selected or available. Please confirm before continuing.",
        ),
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByRole("button", {
          name: "Download resume and prepare message",
        }),
      )
      .toBeDisabled();
    await screen
      .getByRole("button", { name: "Continue with resume only" })
      .click();
    await expect
      .element(
        screen.getByRole("button", {
          name: "Download resume and prepare message",
        }),
      )
      .toBeEnabled();
  });

  it("fails closed with an alert and no share when byte preparation fails", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    const share = vi.fn();
    Object.defineProperty(navigator, "canShare", {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    const { dataProvider, create } = buildDataProvider({ fetchError: true });
    const screen = await renderDialog(dataProvider);
    await chooseRecipientAndChannel(screen);
    await screen
      .getByRole("button", { name: "Share resume and photo" })
      .click();
    await expect
      .element(
        screen.getByText(
          "We couldn’t prepare these files. Nothing was handed off. Try again.",
        ),
      )
      .toBeVisible();
    expect(share).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      "outbound_share_history",
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "failed" }),
      }),
    );
  });

  it("treats native-share cancellation as a normal no-send result", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    Object.defineProperty(navigator, "canShare", {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: vi
        .fn()
        .mockRejectedValue(new DOMException("cancelled", "AbortError")),
      configurable: true,
    });
    const { dataProvider, create } = buildDataProvider();
    const screen = await renderDialog(dataProvider);
    await chooseRecipientAndChannel(screen);
    await screen
      .getByRole("button", { name: "Share resume and photo" })
      .click();
    await expect
      .element(screen.getByText("Share cancelled. Nothing was sent."))
      .toBeVisible();
    expect(create).toHaveBeenCalledWith(
      "outbound_share_history",
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "cancelled" }),
      }),
    );
  });

  it("offers an explicit download fallback when file sharing is unsupported", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    const canShare = vi.fn().mockReturnValue(false);
    const share = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    Object.defineProperty(navigator, "canShare", {
      value: canShare,
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    const { dataProvider, create } = buildDataProvider();
    const screen = await renderDialog(dataProvider);
    await chooseRecipientAndChannel(screen);
    await screen
      .getByRole("button", { name: "Share resume and photo" })
      .click();
    await expect
      .element(
        screen
          .getByText(
            "This device can’t share these files directly. Download them and attach them manually.",
          )
          .first(),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Download files" }))
      .toBeVisible();
    expect(click).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      "outbound_share_history",
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "unsupported" }),
      }),
    );
  });

  it("disables only channels whose contact value is missing", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    const shadchanWithoutWhatsApp = {
      ...shadchan,
      contacts: { phone: "+15550100", email: "ronit@example.test" },
    } as Shadchan;
    const { dataProvider } = buildDataProvider({
      shadchan: shadchanWithoutWhatsApp,
    });
    const screen = await renderDialog(dataProvider);
    await screen.getByRole("combobox", { name: "Shadchan" }).click();
    await screen.getByRole("option", { name: "Aunty Ronit" }).click();
    await expect
      .element(screen.getByRole("radio", { name: "WhatsApp" }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("radio", { name: "WhatsApp" }))
      .toHaveAttribute("aria-describedby", "send-whatsapp-reason");
    await expect
      .element(screen.getByText("No WhatsApp number saved for this shadchan."))
      .toBeVisible();
    await expect
      .element(screen.getByRole("radio", { name: "Text message" }))
      .toBeEnabled();
    await expect
      .element(screen.getByRole("radio", { name: "Email" }))
      .toBeEnabled();
  });

  it("keeps the channel unselected until the manager chooses one", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    Object.defineProperty(navigator, "canShare", {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: vi.fn(),
      configurable: true,
    });
    const { dataProvider } = buildDataProvider();
    const screen = await renderDialog(dataProvider);
    await chooseRecipient(screen);
    await expect
      .element(screen.getByRole("button", { name: "Share resume and photo" }))
      .toBeDisabled();
    await expect
      .element(screen.getByText("Choose a contact channel to continue."))
      .toBeVisible();
  });

  it.each([
    ["a non-OK resume response", { resume: 403 }],
    ["a non-OK photo response", { photo: 404 }],
  ] as const)("fails closed for %s", async (_label, responseStatus) => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    const share = vi.fn();
    const open = vi.spyOn(window, "open");
    Object.defineProperty(navigator, "canShare", {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    const { dataProvider, create } = buildDataProvider({ responseStatus });
    const screen = await renderDialog(dataProvider);
    await chooseRecipientAndChannel(screen);
    await screen
      .getByRole("button", { name: "Share resume and photo" })
      .click();
    await expect
      .element(
        screen.getByText(
          "We couldn’t prepare these files. Nothing was handed off. Try again.",
        ),
      )
      .toBeVisible();
    expect(share).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      "outbound_share_history",
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "failed" }),
      }),
    );
  });

  it("fails closed when the photo fetch rejects after the resume succeeds", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    const share = vi.fn();
    Object.defineProperty(navigator, "canShare", {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    const { dataProvider } = buildDataProvider({ rejectFetch: "photo" });
    const screen = await renderDialog(dataProvider);
    await chooseRecipientAndChannel(screen);
    await screen
      .getByRole("button", { name: "Share resume and photo" })
      .click();
    await expect
      .element(
        screen.getByText(
          "We couldn’t prepare these files. Nothing was handed off. Try again.",
        ),
      )
      .toBeVisible();
    expect(share).not.toHaveBeenCalled();
  });

  it("requires resume-only confirmation and omits a deselected photo", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "canShare", {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    const { dataProvider } = buildDataProvider();
    const screen = await renderDialog(dataProvider);
    await chooseRecipientAndChannel(screen);
    await screen.getByRole("checkbox", { name: "Photo" }).click();
    await expect
      .element(
        screen.getByRole("button", { name: "Continue with resume only" }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Share resume only" }))
      .toBeDisabled();
    await screen
      .getByRole("button", { name: "Continue with resume only" })
      .click();
    await screen.getByRole("button", { name: "Share resume only" }).click();
    await expect.poll(() => share.mock.calls.length).toBe(1);
    expect(
      (share.mock.calls[0][0] as { files: File[] }).files.map(
        (file) => file.name,
      ),
    ).toEqual(["Miriam-Cohen-resume.pdf"]);
  });

  it("clears a manual panel when Photo changes and rebuilds one current file", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    Object.defineProperty(navigator, "canShare", {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: vi.fn(),
      configurable: true,
    });
    vi.spyOn(window, "open").mockReturnValue(null);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const { dataProvider } = buildDataProvider();
    const screen = await renderDialog(dataProvider);
    await chooseRecipientAndChannel(screen);
    await screen
      .getByRole("button", { name: "Share resume and photo" })
      .click();
    await expect
      .element(screen.getByRole("button", { name: "Download files" }))
      .toBeVisible();

    await screen.getByRole("checkbox", { name: "Photo" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Download files" }))
      .not.toBeInTheDocument();
    await screen
      .getByRole("button", { name: "Continue with resume only" })
      .click();
    await screen.getByRole("button", { name: "Share resume only" }).click();
    await screen.getByRole("button", { name: "Download files" }).click();
    await expect
      .element(
        screen
          .getByText(
            "Files downloaded. Attach them to the message before you send.",
          )
          .first(),
      )
      .toBeVisible();
    expect(click).toHaveBeenCalledTimes(1);
    expect(dataProvider.signResumePhotoUrl).toHaveBeenCalledTimes(1);
  });

  it("downloads and opens the manual route on the first desktop click", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { dataProvider } = buildDataProvider();
    const screen = await renderDialog(dataProvider);
    await chooseRecipientAndChannel(screen);
    await screen
      .getByRole("button", { name: "Download files and prepare message" })
      .click();
    await expect
      .element(
        screen
          .getByText(
            "Files downloaded. Attach them to the message before you send.",
          )
          .first(),
      )
      .toBeVisible();
    expect(click).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("wa.me"),
      "_blank",
    );
    expect(dataProvider.signResumeFileUrl).toHaveBeenCalledTimes(1);
    expect(dataProvider.signResumePhotoUrl).toHaveBeenCalledTimes(1);
  });

  it("ignores a duplicate prepare click while files are preparing", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    const canShare = vi.fn().mockReturnValue(true);
    let releaseShare: (() => void) | undefined;
    const share = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseShare = resolve;
        }),
    );
    Object.defineProperty(navigator, "canShare", {
      value: canShare,
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    const { dataProvider } = buildDataProvider();
    const screen = await renderDialog(dataProvider);
    await chooseRecipientAndChannel(screen);

    const button = screen
      .getByRole("button", { name: "Share resume and photo" })
      .element() as HTMLButtonElement;
    button.click();
    button.click();

    await expect.poll(() => share.mock.calls.length).toBe(1);
    expect(dataProvider.signResumeFileUrl).toHaveBeenCalledTimes(1);
    expect(dataProvider.signResumePhotoUrl).toHaveBeenCalledTimes(1);
    releaseShare?.();
    await expect
      .element(
        screen
          .getByText(
            "Share sheet opened. MyShadchan can’t see whether the message was sent.",
          )
          .first(),
      )
      .toBeVisible();
  });

  it("shows the manual recovery copy when opening the composer throws", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    vi.spyOn(window, "open").mockImplementation(() => {
      throw new Error("popup blocked");
    });
    const { dataProvider } = buildDataProvider();
    const screen = await renderDialog(dataProvider);
    await chooseRecipientAndChannel(screen);
    await screen
      .getByRole("button", { name: "Download files and prepare message" })
      .click();
    await expect
      .element(
        screen
          .getByText(
            "The files were downloaded. Your message app did not open, so attach them manually.",
          )
          .first(),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Copy message" }))
      .toBeVisible();
  });

  it("clears the manual panel when the selected recipient changes", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    const secondShadchan = {
      ...shadchan,
      id: 23,
      name: "Shadchan B",
      contacts: {
        phone: "+15550200",
        whatsapp: "+15550201",
        email: "b@example.test",
      },
    } as Shadchan;
    Object.defineProperty(navigator, "canShare", {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: vi.fn(),
      configurable: true,
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    const { dataProvider } = buildDataProvider({
      shadchanim: [shadchan, secondShadchan],
    });
    const screen = await renderDialog(dataProvider);
    await chooseRecipientAndChannel(screen);
    await screen
      .getByRole("button", { name: "Share resume and photo" })
      .click();
    await expect
      .element(screen.getByRole("button", { name: "Download files" }))
      .toBeVisible();

    await screen.getByRole("combobox", { name: "Shadchan" }).click();
    await screen.getByRole("option", { name: "Shadchan B" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Download files" }))
      .not.toBeInTheDocument();
    await screen.getByRole("radio", { name: "Text message" }).click();
    await screen
      .getByRole("button", { name: "Share resume and photo" })
      .click();
    await screen.getByRole("button", { name: "Download files" }).click();
    await expect
      .element(
        screen
          .getByText(
            "Files downloaded. Attach them to the message before you send.",
          )
          .first(),
      )
      .toBeVisible();
    expect(open).toHaveBeenLastCalledWith(
      expect.stringContaining("sms:+15550200"),
      "_blank",
    );
    expect(decodeURIComponent(String(open.mock.calls.at(-1)?.[0]))).toContain(
      "Hi Shadchan B",
    );
  });

  it("does not enable sending when no resume is available", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    const { dataProvider } = buildDataProvider({ resume: [] });
    const screen = await renderDialog(dataProvider);
    await expect.element(screen.getByText("No resume available")).toBeVisible();
    await chooseRecipientAndChannel(screen);
    await expect
      .element(
        screen.getByRole("button", {
          name: "Download resume and prepare message",
        }),
      )
      .toBeDisabled();
  });

  it("shows the manager-only history without contacts", async () => {
    useViewerRoleMock.mockReturnValue({
      role: "parent_admin",
      isPending: false,
    });
    const history: OutboundShareHistory[] = [
      {
        id: 99,
        account_id: 1,
        single_id: single.id,
        shadchan_id: shadchan.id,
        actor_member_id: 1,
        channel: "whatsapp",
        file_kinds: ["resume", "photo"],
        outcome: "share_sheet_opened",
        created_at: "2026-01-04T12:00:00Z",
      },
    ];
    const { dataProvider } = buildDataProvider({ history });
    const screen = await renderDialog(dataProvider);
    await screen.getByRole("button", { name: "View send history" }).click();
    await expect.element(screen.getByText("Share sheet opened")).toBeVisible();
    await expect
      .element(screen.getByText("Aunty Ronit · WhatsApp · Resume + photo"))
      .toBeVisible();
    await expect.element(screen.getByText("+15550101")).not.toBeInTheDocument();
  });

  it("fails closed when a direct dialog invocation has a non-manager role", async () => {
    const { dataProvider } = buildDataProvider();
    const screen = await renderDialog(dataProvider, { viewerRole: "helper" });
    await expect
      .element(
        screen.getByText(
          "This action is available only to the household manager.",
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole("combobox", { name: "Shadchan" }))
      .not.toBeInTheDocument();
  });
});

describe("SendToShadchanButton role gate", () => {
  it.each([
    ["helper", false],
    ["shadchan", false],
    ["single", false],
    [undefined, false],
    ["parent_admin", true],
    ["self_manager", true],
  ] as const)("%s visibility", async (role, visible) => {
    useViewerRoleMock.mockReturnValue({ role, isPending: false });
    const { dataProvider } = buildDataProvider();
    const screen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          i18nProvider={testI18nProvider}
        >
          <SendToShadchanButton single={single} />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );
    if (visible) {
      await expect
        .element(screen.getByRole("button", { name: "Send resume and photo" }))
        .toBeVisible();
    } else {
      await expect
        .element(screen.getByRole("button", { name: "Send resume and photo" }))
        .not.toBeInTheDocument();
    }
  });
});
