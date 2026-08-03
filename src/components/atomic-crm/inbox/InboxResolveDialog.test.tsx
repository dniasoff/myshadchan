import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { InboxAttachment, InboxItem, Shadchan } from "../types";
import { InboxResolveDialog } from "./InboxResolveDialog";

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
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    // ShidduchInputs' two ReferenceInputs (single_id, shadchan_id) fetch
    // their own choice lists via a plain getList (no connection_id filter)
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
    createShidduch: vi.fn().mockResolvedValue({ id: 99 }),
    update: vi.fn().mockResolvedValue({ data: {} }),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderDialog = async (
  item: InboxItem,
  linkedShadchanim: Shadchan[] = [],
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const dataProvider = buildDataProvider(
    linkedShadchanim,
    dataProviderOverrides,
  );
  const onClose = vi.fn();

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <InboxResolveDialog item={item} open onClose={onClose} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider, onClose };
};

describe("InboxResolveDialog — origin selection (AC-4)", () => {
  it("a non-shadchan-sourced item resolves with origin: 'channel' and an unlocked shadchan_id field", async () => {
    // Arrange
    const item = buildItem({ source: "email" });
    const { screen, dataProvider } = await renderDialog(item);

    // Assert the field is not locked before submitting.
    await expect
      .element(screen.getByRole("combobox", { name: "Shadchan" }))
      .not.toBeDisabled();

    // Act
    await screen.getByLabelText("Name (English)").fill("Chaya");
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
      expect.objectContaining({ origin: "channel" }),
    );
  });

  it("a shadchan-sourced item resolves with origin: 'shadchan', never 'channel' or 'manual'", async () => {
    // Arrange
    const item = buildItem({ source: "shadchan", connection_id: 7 });
    const { screen, dataProvider } = await renderDialog(item, [
      buildShadchan(),
    ]);

    // Act
    await screen.getByLabelText("Name (English)").fill("Chaya");
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

    // Assert
    await expect
      .element(screen.getByRole("combobox", { name: "Shadchan" }))
      .toBeDisabled();
    await expect
      .element(
        screen.getByText(
          "Sent by your connected shadchan — cannot be changed here",
        ),
      )
      .toBeInTheDocument();

    // Act
    await screen.getByLabelText("Name (English)").fill("Chaya");
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
      .element(screen.getByRole("combobox", { name: "Shadchan" }))
      .toBeDisabled();
    await expect
      .element(
        screen.getByText(
          "Sent by your connected shadchan, but their book entry could not be found — this can be resolved without a shadchan credited",
        ),
      )
      .toBeInTheDocument();

    // Act — resolving is still possible, just without a shadchan credited.
    await screen.getByLabelText("Name (English)").fill("Chaya");
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
      .element(screen.getByRole("combobox", { name: "Shadchan" }))
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

  const buildAttachment = (
    overrides: Partial<InboxAttachment> = {},
  ): InboxAttachment => ({
    title: "resume.pdf",
    type: "application/pdf",
    path: "1/abc-123.pdf",
    src: "https://stale.example/1/abc-123.pdf?token=expired",
    ...overrides,
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
