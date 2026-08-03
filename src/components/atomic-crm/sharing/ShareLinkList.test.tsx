import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { ShareAccessLog, ShareLink, Single } from "../types";
import { ShareLinkList } from "./ShareLinkList";

const DAY_MS = 24 * 60 * 60 * 1000;

const buildSingle = (overrides: Partial<Single> = {}): Single => ({
  id: 42,
  account_id: 1,
  first_name_en: "Rivky",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const buildLink = (overrides: Partial<ShareLink> = {}): ShareLink => ({
  id: 1,
  account_id: 1,
  single_id: 42,
  token: "a".repeat(48),
  include_photo: false,
  expires_at: new Date(Date.now() + 7 * DAY_MS).toISOString(),
  revoked_at: null,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const buildAccessLog = (
  overrides: Partial<ShareAccessLog> = {},
): ShareAccessLog => ({
  id: 1,
  share_link_id: 1,
  accessed_at: "2026-01-02T10:00:00Z",
  resource: "profile",
  ...overrides,
});

/** `vitest-browser-react`'s `screen` has no `getAllByRole` —
 * `SingleListingSection.test.tsx`'s own convention. */
const buttonsNamed = (
  screen: { container: HTMLElement },
  text: string,
): HTMLButtonElement[] =>
  Array.from(screen.container.querySelectorAll("button")).filter(
    (button) => button.textContent?.trim() === text,
  );

const renderList = async (dataProviderOverrides: Partial<CrmDataProvider>) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    revokeShareLink: vi.fn().mockResolvedValue(undefined),
    getShareAccessLog: vi.fn().mockResolvedValue([]),
    ...dataProviderOverrides,
  } as unknown as CrmDataProvider;

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ShareLinkList single={buildSingle()} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("ShareLinkList", () => {
  it("shows an empty state when the single has no share links", async () => {
    // Arrange / Act
    const { screen } = await renderList({});

    // Assert
    await expect.element(screen.getByText("No share links yet.")).toBeVisible();
  });

  it("labels an active, a revoked, and an expired link correctly, and shows Revoke only for the active one", async () => {
    // Arrange
    const active = buildLink({ id: 1 });
    const revoked = buildLink({
      id: 2,
      revoked_at: new Date().toISOString(),
    });
    const expired = buildLink({
      id: 3,
      expires_at: new Date(Date.now() - DAY_MS).toISOString(),
    });
    const { screen } = await renderList({
      getList: vi.fn().mockResolvedValue({
        data: [active, revoked, expired],
        total: 3,
      }),
    });

    // Assert
    await expect.element(screen.getByText("Active")).toBeVisible();
    await expect.element(screen.getByText("Revoked")).toBeVisible();
    await expect.element(screen.getByText("Expired")).toBeVisible();
    await expect.poll(() => buttonsNamed(screen, "Revoke").length).toBe(1);
  });

  it("revokes the link and refetches the list on success", async () => {
    // Arrange
    const active = buildLink({ id: 1 });
    const getList = vi.fn().mockResolvedValue({ data: [active], total: 1 });
    const revokeShareLink = vi.fn().mockResolvedValue(undefined);
    const { screen } = await renderList({ getList, revokeShareLink });

    // Act
    await screen.getByRole("button", { name: "Revoke" }).click();

    // Assert
    await expect
      .poll(() => revokeShareLink.mock.calls.length)
      .toBeGreaterThan(0);
    expect(revokeShareLink).toHaveBeenCalledWith(1);
    await expect
      .poll(() => getList.mock.calls.length)
      .toBeGreaterThanOrEqual(2);
  });

  it("shows an error notification when revoke is refused", async () => {
    // Arrange
    const active = buildLink({ id: 1 });
    const { screen } = await renderList({
      getList: vi.fn().mockResolvedValue({ data: [active], total: 1 }),
      revokeShareLink: vi.fn().mockRejectedValue(new Error("refused")),
    });

    // Act
    await screen.getByRole("button", { name: "Revoke" }).click();

    // Assert
    await expect
      .element(screen.getByText("Couldn't revoke that link. Try again."))
      .toBeInTheDocument();
  });

  it("loads the access log lazily — only once the dialog is opened — and renders each row (AC-8)", async () => {
    // Arrange
    const active = buildLink({ id: 1 });
    const getShareAccessLog = vi
      .fn()
      .mockResolvedValue([
        buildAccessLog({ id: 1, resource: "profile" }),
        buildAccessLog({ id: 2, resource: "resume:resume-0" }),
      ]);
    const { screen } = await renderList({
      getList: vi.fn().mockResolvedValue({ data: [active], total: 1 }),
      getShareAccessLog,
    });

    // Assert — not called before the dialog opens.
    expect(getShareAccessLog).not.toHaveBeenCalled();

    // Act
    await screen.getByRole("button", { name: "Access log" }).click();

    // Assert
    await expect.poll(() => getShareAccessLog.mock.calls.length).toBe(1);
    expect(getShareAccessLog).toHaveBeenCalledWith(1);
    await expect.element(screen.getByText("profile")).toBeVisible();
    await expect.element(screen.getByText("resume:resume-0")).toBeVisible();
  });

  it("shows a calm empty state in the access log dialog when nothing was ever accessed", async () => {
    // Arrange
    const active = buildLink({ id: 1 });
    const { screen } = await renderList({
      getList: vi.fn().mockResolvedValue({ data: [active], total: 1 }),
      getShareAccessLog: vi.fn().mockResolvedValue([]),
    });

    // Act
    await screen.getByRole("button", { name: "Access log" }).click();

    // Assert
    await expect
      .element(screen.getByText("No access recorded yet."))
      .toBeVisible();
  });
});
