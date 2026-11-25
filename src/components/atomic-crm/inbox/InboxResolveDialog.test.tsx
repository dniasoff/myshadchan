import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter, type Identifier } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { InboxAttachment, InboxItem, Shadchan } from "../types";
import { InboxResolveDialog } from "./InboxResolveDialog";
// The production route builder deliberately requires the real descriptor;
// register it just as the app boot does so the legacy-file action test follows
// the actual navigation path instead of mocking buildNewPath.
import "../shidduchim/entityDescriptor";

/**
 * Story 10.3 review fix (F-B, BLOCKING): `signInboxAttachmentUrl` is called
 * directly from `InboxResolveDialog.tsx` (not through the mocked
 * `CrmDataProvider` above — see that module's own comment for why), so it
 * needs its own `vi.mock`, the `entityFiles.test.ts` idiom.
 */
const { signInboxAttachmentUrl } = vi.hoisted(() => ({
  signInboxAttachmentUrl: vi.fn(),
}));

vi.mock("../providers/supabase/inboxAttachments", () => ({
  signInboxAttachmentUrl,
}));

/**
 * Story 8.3 review fix (Finding 1): AC-3 (the locked `shadchan_id` field)
 * and AC-4 (origin selection) had zero automated coverage — the story's own
 * "Testing standard" named exactly these two. Also pins Finding 2's fix:
 * the lock must fail CLOSED (disabled with no value) when the connection's
 * linked `shadchanim` row cannot be found, never fail open to a freely
 * editable field.
 */

const buildItem = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  id: 1,
  account_id: 1,
  created_at: "2026-01-01T00:00:00Z",
  source: "email",
  raw_text: "Dovid Berkowitz, BMG",
  subject: null,
  sender: null,
  sender_needs_confirmation: false,
  attachments: null,
  status: "unresolved",
  single_id: 42,
  shadchan_id: null,
  resolved_shidduchim_id: null,
  connection_id: null,
  ...overrides,
});

const buildShadchan = (overrides: Partial<Shadchan> = {}): Shadchan =>
  ({
    id: 55,
    account_id: 9,
    name: "Rivka the Shadchan",
    connection_id: 7,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as Shadchan;

const buildDataProvider = (
  linkedShadchanim: Shadchan[],
  item: InboxItem,
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider => {
  const update = vi.fn(
    (_resource: string, params: { data: Record<string, unknown> }) => {
      Object.assign(item, params.data);
      return Promise.resolve({ data: item });
    },
  );

  const updateInboxItemResolution = vi.fn(async (params: any) => {
    const lockAcquiredAt = (
      item.resolution_input as { lock_acquired_at?: unknown } | null
    )?.lock_acquired_at;
    if (
      item.status !== params.status ||
      (params.expectedResolutionAttemptId !== undefined &&
        item.resolution_attempt_id !== params.expectedResolutionAttemptId) ||
      (params.expectedLockAcquiredAt !== undefined &&
        lockAcquiredAt !== params.expectedLockAcquiredAt) ||
      (params.expectedLockAcquiredAtIsNull && lockAcquiredAt != null) ||
      (params.staleBefore !== undefined &&
        (typeof lockAcquiredAt !== "string" ||
          lockAcquiredAt >= params.staleBefore))
    ) {
      return null;
    }
    const result = await update("inbox_items", {
      data: params.data,
    });
    return result.data;
  });

  return {
    // The two ReferenceInputs (single_id, shadchan_id) fetch their own choice
    // lists via a plain getList (no connection_id filter)
    // — stubbed empty, since no test asserts on them. InboxResolveDialog's
    // OWN lookup (Task 4) filters by connection_id — distinguished here the
    // same way the real dataProvider distinguishes any other filtered
    // getList call.
    getList: vi.fn(
      (resource: string, params: { filter?: Record<string, unknown> }) => {
        if (
          resource === "shadchanim" &&
          params.filter?.connection_id !== undefined
        ) {
          return Promise.resolve({
            data: linkedShadchanim,
            total: linkedShadchanim.length,
          });
        }
        return Promise.resolve({ data: [], total: 0 });
      },
    ),
    getMany: vi.fn().mockResolvedValue({ data: [] }),
    getOne: vi.fn((resource: string, params: { id: Identifier }) => {
      if (resource === "inbox_items" && params.id === item.id) {
        return Promise.resolve({ data: item });
      }
      if (resource === "shidduchim" && params.id === 99) {
        return Promise.resolve({ data: { id: 99 } });
      }
      return Promise.resolve({ data: {} });
    }),
    createShidduch: vi.fn().mockResolvedValue({ id: 99 }),
    aiEntitlement: vi.fn().mockResolvedValue({
      is_entitled: false,
      plan: "free",
      status: "none",
      resumes_used: 0,
      resumes_limit: 0,
    }),
    create: vi.fn().mockResolvedValue({ data: {} }),
    update,
    updateInboxItemResolution,
    copyInboxAttachmentsToEntityFiles: vi.fn().mockResolvedValue([]),
    copyInboxAttachmentToResumeFile: vi.fn().mockResolvedValue({
      storagePath: "1/resumes/99/copied-resume.pdf",
      size: 54321,
    }),
    removeResumeFileObjects: vi.fn(),
    removeInboxAttachment: vi.fn(),
    ...overrides,
  } as unknown as CrmDataProvider;
};

const renderDialog = async (
  item: InboxItem,
  linkedShadchanim: Shadchan[] = [],
  dataProviderOverrides: Partial<CrmDataProvider> = {},
  fileActionsEnabled = false,
) => {
  const dataProvider = buildDataProvider(
    linkedShadchanim,
    item,
    dataProviderOverrides,
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = vi.fn();
  let pathname: string | undefined;

  const screen = await render(
    <TestMemoryRouter
      locationCallback={(location) => {
        pathname = location.pathname;
      }}
    >
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <InboxResolveDialog
          item={item}
          open
          fileActionsEnabled={fileActionsEnabled}
          onClose={onClose}
        />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return {
    screen,
    dataProvider,
    onClose,
    queryClient,
    getPathname: () => pathname,
  };
};

const buildAttachment = (
  overrides: Partial<InboxAttachment> = {},
): InboxAttachment => ({
  title: "resume.pdf",
  type: "application/pdf",
  path: "1/abc-123.pdf",
  src: "https://stale.example/1/abc-123.pdf?token=expired",
  ...overrides,
});

describe("InboxResolveDialog — origin selection (AC-4)", () => {
  it("a non-shadchan-sourced item resolves with origin: 'channel' and an unlocked shadchan_id field", async () => {
    // Arrange
    const item = buildItem({ source: "email", sender: "Miriam Cohen" });
    const { screen, dataProvider } = await renderDialog(item);

    // Assert the field is not locked before submitting.
    await expect
      .element(screen.getByRole("combobox", { name: "Who is the shadchan?" }))
      .not.toBeDisabled();

    // Act
    await screen
      .getByLabelText("Name of the person being suggested")
      .fill("Chaya");
    await screen.getByRole("button", { name: "File as a suggestion" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.createShidduch as ReturnType<typeof vi.fn>).mock.calls
            .length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.createShidduch).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "channel",
        suggested_by_name: "Miriam Cohen",
        suggested_by_phone: null,
      }),
    );
  });

  it("a shadchan-sourced item resolves with origin: 'shadchan', never 'channel' or 'manual'", async () => {
    // Arrange
    const item = buildItem({ source: "shadchan", connection_id: 7 });
    const { screen, dataProvider } = await renderDialog(item, [
      buildShadchan(),
    ]);

    // Act
    await screen
      .getByLabelText("Name of the person being suggested")
      .fill("Chaya");
    await screen.getByRole("button", { name: "File as a suggestion" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.createShidduch as ReturnType<typeof vi.fn>).mock.calls
            .length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.createShidduch).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "shadchan" }),
    );
  });
});

describe("InboxResolveDialog — the locked shadchan_id field (AC-3)", () => {
  it("locks the field to the connection's linked shadchanim row and submits that id, not one the household could pick", async () => {
    // Arrange
    const item = buildItem({ source: "shadchan", connection_id: 7 });
    const { screen, dataProvider } = await renderDialog(item, [
      buildShadchan({ id: 55 }),
    ]);

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

    // Assert
    await expect
      .element(screen.getByRole("combobox", { name: "Who is the shadchan?" }))
      .toBeDisabled();

    // Act
    await screen
      .getByLabelText("Name of the person being suggested")
      .fill("Chaya");
    await screen.getByRole("button", { name: "File as a suggestion" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.createShidduch as ReturnType<typeof vi.fn>).mock.calls
            .length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.createShidduch).toHaveBeenCalledWith(
      expect.objectContaining({ shadchan_id: 55 }),
    );
  });

  it("review fix (Finding 2): when the connection's linked shadchanim row cannot be found, the field stays LOCKED — never falls open to a freely editable field", async () => {
    // Arrange — the lookup resolves to zero rows (the book entry was
    // deleted, or never created): `lockedShadchanId` is null, but the item
    // is still shadchan-sourced, so the lock must hold regardless.
    const item = buildItem({ source: "shadchan", connection_id: 7 });
    const { screen, dataProvider } = await renderDialog(item, []);

    // Assert — fails CLOSED: disabled and empty, never open and editable.
    await expect
      .element(screen.getByRole("combobox", { name: "Who is the shadchan?" }))
      .toBeDisabled();

    // Act — resolving is still possible, just without a shadchan credited.
    await screen
      .getByLabelText("Name of the person being suggested")
      .fill("Chaya");
    await screen.getByRole("button", { name: "File as a suggestion" }).click();

    // Assert
    await expect
      .poll(
        () =>
          (dataProvider.createShidduch as ReturnType<typeof vi.fn>).mock.calls
            .length,
      )
      .toBeGreaterThan(0);
    expect(dataProvider.createShidduch).toHaveBeenCalledWith(
      expect.objectContaining({ shadchan_id: null, origin: "shadchan" }),
    );
  });

  it("a non-shadchan-sourced item's shadchan_id field is never locked, even if the item happens to carry a connection_id", async () => {
    // Arrange
    const item = buildItem({ source: "email", connection_id: 7 });
    const { screen } = await renderDialog(item, [buildShadchan()]);

    // Assert
    await expect
      .element(screen.getByRole("combobox", { name: "Who is the shadchan?" }))
      .not.toBeDisabled();
  });
});

/**
 * Story 10.3 review fix (F-B, BLOCKING): the persisted `attachment.src` is a
 * signed URL that expires an hour after capture — before this fix it was
 * rendered as a static `href`, so it went dead with no caller ever
 * re-signing it. `handleOpenAttachment` must mint a FRESH URL, from
 * `attachment.path`, every time — never cache it in component state.
 */
describe("InboxResolveDialog — attachment links are re-signed at click time (review fix F-B)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    signInboxAttachmentUrl.mockReset();
  });

  it("signs a fresh URL from the durable path and opens it — never the persisted, expiring src", async () => {
    // Arrange
    vi.spyOn(window, "open").mockImplementation(() => null);
    signInboxAttachmentUrl.mockResolvedValue(
      "https://signed.example/1/abc-123.pdf?token=fresh",
    );
    const item = buildItem({ attachments: [buildAttachment()] });
    const { screen } = await renderDialog(item);

    // Act
    await screen.getByRole("button", { name: "resume.pdf" }).click();

    // Assert
    await expect
      .poll(() => signInboxAttachmentUrl.mock.calls.length)
      .toBeGreaterThan(0);
    expect(signInboxAttachmentUrl).toHaveBeenCalledWith("1/abc-123.pdf");
    expect(window.open).toHaveBeenCalledWith(
      "https://signed.example/1/abc-123.pdf?token=fresh",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("mints a new URL on every click — an implementation that caches the first result fails this", async () => {
    // Arrange
    vi.spyOn(window, "open").mockImplementation(() => null);
    signInboxAttachmentUrl
      .mockResolvedValueOnce("https://signed.example/first")
      .mockResolvedValueOnce("https://signed.example/second");
    const item = buildItem({ attachments: [buildAttachment()] });
    const { screen } = await renderDialog(item);
    const attachmentButton = screen.getByRole("button", { name: "resume.pdf" });

    // Act
    await attachmentButton.click();
    await attachmentButton.click();

    // Assert
    await expect.poll(() => signInboxAttachmentUrl.mock.calls.length).toBe(2);
    expect(window.open).toHaveBeenNthCalledWith(
      1,
      "https://signed.example/first",
      "_blank",
      "noopener,noreferrer",
    );
    expect(window.open).toHaveBeenNthCalledWith(
      2,
      "https://signed.example/second",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("opens a committed local demo data URL without calling the remote signer", async () => {
    // Arrange
    vi.spyOn(window, "open").mockImplementation(() => null);
    const localUrl = "data:application/pdf;base64,JVBERi0xLjQKJSVFT0Y=";
    const item = buildItem({
      attachments: [buildAttachment({ src: localUrl })],
    });
    const { screen } = await renderDialog(item);

    // Act
    await screen.getByRole("button", { name: "resume.pdf" }).click();

    // Assert
    expect(signInboxAttachmentUrl).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      localUrl,
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("shows an error notification and never opens a window when signing fails", async () => {
    // Arrange
    vi.spyOn(window, "open").mockImplementation(() => null);
    signInboxAttachmentUrl.mockRejectedValue(new Error("object not found"));
    const item = buildItem({ attachments: [buildAttachment()] });
    const { screen } = await renderDialog(item);

    // Act
    await screen.getByRole("button", { name: "resume.pdf" }).click();

    // Assert
    await expect
      .element(screen.getByText("object not found"))
      .toBeInTheDocument();
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe("InboxResolveDialog — confirm details", () => {
  it("uses the no-AI filing flow for photo-only items even when file actions are enabled", async () => {
    const item = buildItem({
      attachments: [
        buildAttachment({
          title: "photo.jpg",
          type: "image/jpeg",
          path: "1/abc-123.jpg",
        }),
      ],
    });
    const { screen } = await renderDialog(item, [], {}, true);

    await expect
      .element(screen.getByText("Confirm the details", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Auto-fill from resume" }))
      .not.toBeInTheDocument();
  });

  it("shows the From fields, defaults the safe sender, and filters active shadchanim", async () => {
    const item = buildItem({
      sender: "Sara Cohen",
      sender_phone: "+1 347-555-0182",
    });
    const { screen, dataProvider } = await renderDialog(item);

    await expect
      .element(screen.getByLabelText("Suggested by"))
      .toHaveValue("Sara Cohen");
    await expect
      .element(screen.getByLabelText("Phone number"))
      .toHaveValue("+1 347-555-0182");
    await expect
      .element(screen.getByText("· +1 347-555-0182", { exact: true }))
      .toBeInTheDocument();
    await expect
      .poll(() =>
        (dataProvider.getList as ReturnType<typeof vi.fn>).mock.calls.some(
          ([resource, params]) =>
            resource === "shadchanim" &&
            params.filter?.["archived_at@is"] === null,
        ),
      )
      .toBe(true);
  });

  it("asks only for the approved details and has no auto-fill action", async () => {
    const item = buildItem({ attachments: [buildAttachment()] });
    const { screen } = await renderDialog(item);

    await expect
      .element(screen.getByText("Confirm the details", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByLabelText("Who is the shadchan?"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByLabelText("Which child is this for?"))
      .toBeInTheDocument();
    const nameInput = screen.getByLabelText(
      "Name of the person being suggested",
    );
    await expect.element(nameInput).toBeInTheDocument();
    await expect
      .element(nameInput)
      .toHaveAttribute("aria-describedby", "name-of-person-description");
    await expect
      .element(
        screen.getByText("The person the message or resume is about", {
          exact: true,
        }),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Dovid Berkowitz, BMG", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Auto-fill from resume" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByLabelText("Name (English)"))
      .not.toBeInTheDocument();
  });

  it("blocks nameless filing with a plain validation message", async () => {
    const item = buildItem();
    const { screen, dataProvider } = await renderDialog(item);

    const nameInput = screen.getByLabelText(
      "Name of the person being suggested",
    );
    await screen.getByRole("button", { name: "File as a suggestion" }).click();

    await expect
      .element(
        screen.getByText("Name of the person being suggested is required", {
          exact: true,
        }),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Name of the person being suggested is required");
    await expect.poll(() => document.activeElement).toBe(nameInput.element());
    expect(dataProvider.createShidduch).not.toHaveBeenCalled();
  });

  it("uses automatic direction for RTL person names", async () => {
    const { screen } = await renderDialog(buildItem());
    const nameInput = screen.getByLabelText(
      "Name of the person being suggested",
    );

    await nameInput.fill("חיה לוי");

    await expect.element(nameInput).toHaveAttribute("dir", "auto");
  });

  it("puts the attached resume on the suggestion without writing extraction fields", async () => {
    const item = buildItem({ attachments: [buildAttachment()] });
    const { screen, dataProvider } = await renderDialog(item);

    await screen
      .getByLabelText("Name of the person being suggested")
      .fill("Chaya");
    await screen.getByRole("button", { name: "File as a suggestion" }).click();

    await expect
      .poll(
        () =>
          (dataProvider.createShidduch as ReturnType<typeof vi.fn>).mock.calls
            .length,
      )
      .toBe(1);
    expect(dataProvider.createShidduch).toHaveBeenCalledWith(
      expect.objectContaining({
        single_id: 42,
        name_en: "Chaya",
        origin: "channel",
      }),
    );
    expect(dataProvider.copyInboxAttachmentToResumeFile).toHaveBeenCalledWith({
      shidduchimId: 99,
      inboxItemId: 1,
      attachment: buildAttachment(),
    });
    expect(dataProvider.create).toHaveBeenCalledWith("resumes", {
      data: expect.objectContaining({
        shidduchim_id: 99,
        files: [
          expect.objectContaining({
            filename: "resume.pdf",
            mime_type: "application/pdf",
            source_inbox_item_id: item.id,
            source_inbox_attachment_path: buildAttachment().path,
          }),
        ],
      }),
    });
    const resumeCreate = (
      dataProvider.create as ReturnType<typeof vi.fn>
    ).mock.calls.find(([resource]) => resource === "resumes");
    expect(resumeCreate?.[1]).not.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          extracted: expect.anything(),
          sections: expect.anything(),
        }),
      }),
    );
  });
});
