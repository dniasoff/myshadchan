import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { ShareLink, Single } from "../types";
import { CreateShareLinkDialog } from "./CreateShareLinkDialog";

/**
 * Story 9.5 (AC-1, AC-2): the create form generates a link only after an
 * explicit "Create share link" click, sends only `single_id`/`expires_at`/
 * `include_photo` (never `token`/`account_id`/`created_by_member_id` — the
 * server derives/overwrites every one of those), and shows the resulting
 * fragment-form URL for the sharer to copy.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const buildSingle = (overrides: Partial<Single> = {}): Single => ({
  id: 42,
  account_id: 1,
  first_name_en: "Rivky",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const buildCreatedLink = (overrides: Partial<ShareLink> = {}): ShareLink => ({
  id: 1,
  account_id: 1,
  single_id: 42,
  token: "a".repeat(48),
  include_photo: false,
  expires_at: new Date(Date.now() + 7 * DAY_MS).toISOString(),
  created_at: new Date().toISOString(),
  recipient_name: "Test Recipient",
  watermark: false,
  ...overrides,
});

const renderDialog = async (
  createImpl?: (
    resource: string,
    params: { data: Record<string, unknown> },
  ) => Promise<{ data: ShareLink }>,
  onCreated?: () => void,
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const create =
    createImpl ??
    vi
      .fn()
      .mockResolvedValue({ data: buildCreatedLink() } as { data: ShareLink });
  const dataProvider = { create } as unknown as CrmDataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <CreateShareLinkDialog single={buildSingle()} onCreated={onCreated} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider, create };
};

// Story 14.6 made recipient name required — the submit button stays disabled
// until it is filled, so every test that creates a link must supply one first.
const fillAndSubmit = async (
  screen: Awaited<ReturnType<typeof renderDialog>>["screen"],
) => {
  await screen
    .getByPlaceholder("Enter recipient's name (e.g., shadchan name)")
    .fill("Test Recipient");
  await screen.getByRole("button", { name: "Create link" }).click();
};

describe("CreateShareLinkDialog", () => {
  it("sends only single_id, expires_at (~7 days ahead) and include_photo — never token/account_id/created_by_member_id", async () => {
    // Arrange
    const { screen, create } = await renderDialog();

    // Act
    await fillAndSubmit(screen);

    // Assert
    await expect
      .poll(() => (create as ReturnType<typeof vi.fn>).mock.calls.length)
      .toBeGreaterThan(0);
    const [resource, params] = (create as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(resource).toBe("share_links");
    expect(params.data.single_id).toBe(42);
    expect(params.data.include_photo).toBe(false);
    expect(params.data.token).toBeUndefined();
    expect(params.data.account_id).toBeUndefined();
    expect(params.data.created_by_member_id).toBeUndefined();

    const expiresAt = new Date(params.data.expires_at as string).getTime();
    const expected = Date.now() + 7 * DAY_MS;
    expect(Math.abs(expiresAt - expected)).toBeLessThan(60_000);
  });

  it("shows the fragment-form share URL after a successful create", async () => {
    // Arrange
    const { screen } = await renderDialog(
      vi.fn().mockResolvedValue({
        data: buildCreatedLink({ token: "b".repeat(48) }),
      }),
    );

    // Act
    await fillAndSubmit(screen);

    // Assert
    await expect
      .element(screen.getByRole("textbox"))
      .toHaveValue(`${window.location.origin}/share#${"b".repeat(48)}`);
  });

  it("calls onCreated after a successful create", async () => {
    // Arrange
    const onCreated = vi.fn();
    const { screen } = await renderDialog(undefined, onCreated);

    // Act
    await fillAndSubmit(screen);

    // Assert
    await expect.poll(() => onCreated.mock.calls.length).toBeGreaterThan(0);
  });

  it("sends include_photo: true when the switch is toggled on before creating", async () => {
    // Arrange
    const { screen, create } = await renderDialog();

    // Act
    await screen.getByRole("switch", { name: "Include photo" }).click();
    await fillAndSubmit(screen);

    // Assert
    await expect
      .poll(() => (create as ReturnType<typeof vi.fn>).mock.calls.length)
      .toBeGreaterThan(0);
    const [, params] = (create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params.data.include_photo).toBe(true);
  });

  it("sends an expires_at ~30 days ahead when the 30-day option is selected", async () => {
    // Arrange
    const { screen, create } = await renderDialog();

    // Act
    await screen.getByRole("combobox").click();
    await screen.getByRole("option", { name: "30 days" }).click();
    await fillAndSubmit(screen);

    // Assert
    await expect
      .poll(() => (create as ReturnType<typeof vi.fn>).mock.calls.length)
      .toBeGreaterThan(0);
    const [, params] = (create as ReturnType<typeof vi.fn>).mock.calls[0];
    const expiresAt = new Date(params.data.expires_at as string).getTime();
    const expected = Date.now() + 30 * DAY_MS;
    expect(Math.abs(expiresAt - expected)).toBeLessThan(60_000);
  });

  // UX audit fix: `ui/button.tsx` sets no default `type`, so this Reset
  // button defaulted to `submit` inside the <form> — tapping it cleared the
  // fields AND created a real, live share link to a single's profile.
  it("Reset clears the form without creating a link", async () => {
    // Arrange
    const { screen, create } = await renderDialog();
    const recipient = screen.getByPlaceholder(
      "Enter recipient's name (e.g., shadchan name)",
    );
    await recipient.fill("Test Recipient");

    // Act
    await screen.getByRole("button", { name: "Reset" }).click();

    // Assert — the click was handled (the field is cleared) and no share
    // link was created.
    await expect.element(recipient).toHaveValue("");
    expect(create).not.toHaveBeenCalled();
  });

  it("shows an error notification when the create is refused, and never crashes", async () => {
    // Arrange
    const { screen } = await renderDialog(
      vi.fn().mockRejectedValue(new Error("refused")),
    );

    // Act
    await fillAndSubmit(screen);

    // Assert
    await expect
      .element(screen.getByText("Couldn't create the share link. Try again."))
      .toBeInTheDocument();
  });
});
