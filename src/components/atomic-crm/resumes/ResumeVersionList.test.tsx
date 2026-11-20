import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { Resume, ResumeFileVersion } from "../types";
import {
  ResumeVersionList,
  type ResumeVersionListProps,
} from "./ResumeVersionList";

/**
 * Story 5.3's falsifiable claims for `ResumeVersionList`: loading/empty/
 * error states (AC 1 skeleton, AC 3 empty), newest-first ordering sorted
 * client-side rather than trusted from insertion order (AC 1), and a
 * signed URL minted fresh on every download click, never cached (AC 5).
 */

const buildVersion = (
  overrides: Partial<ResumeFileVersion> = {},
): ResumeFileVersion => ({
  path: "1/resumes/1/abc-resume.pdf",
  filename: "resume.pdf",
  uploaded_at: "2026-01-01T00:00:00Z",
  uploaded_by: 7,
  mime_type: "application/pdf",
  size: 2048,
  ...overrides,
});

const buildResumeRow = (overrides: Partial<Resume> = {}): Resume => ({
  id: 1,
  account_id: 1,
  shidduchim_id: 1,
  files: [buildVersion()],
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    signResumeFileUrl: vi.fn().mockResolvedValue("https://signed.example/x"),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderList = async (
  shidduchimId: number,
  dataProviderOverrides: Partial<CrmDataProvider> = {},
  canReread = false,
  listProps: Partial<
    Pick<
      ResumeVersionListProps,
      "presentation" | "emptyActionHref" | "shownFileKey" | "onShow"
    >
  > = {},
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides);

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResumeVersionList
          shidduchimId={shidduchimId}
          canReread={canReread}
          {...listProps}
        />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("ResumeVersionList — loading, empty and error states (AC 1 / AC 3)", () => {
  it("shows a skeleton placeholder while the query is in flight, with no empty-state copy", async () => {
    // Arrange
    const getList = vi.fn().mockReturnValue(new Promise(() => {}));

    // Act
    const { screen } = await renderList(1, { getList });

    // Assert
    expect(screen.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await expect
      .element(screen.getByText("No resume attached"))
      .not.toBeInTheDocument();
  });

  it("shows a translated empty message when no resumes row exists yet", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderList(1, { getList });

    // Assert
    await expect
      .element(screen.getByText("No resume attached"))
      .toBeInTheDocument();
  });

  it("shows the same empty message when a resumes row exists with an empty files array", async () => {
    // Arrange
    const getList = vi
      .fn()
      .mockResolvedValue({ data: [buildResumeRow({ files: [] })], total: 1 });

    // Act
    const { screen } = await renderList(1, { getList });

    // Assert
    await expect
      .element(screen.getByText("No resume attached"))
      .toBeInTheDocument();
  });

  it("shows a translated error message, never a blank tab", async () => {
    // Arrange
    const getList = vi.fn().mockRejectedValue(new Error("boom"));

    // Act
    const { screen } = await renderList(1, { getList });

    // Assert
    await expect.element(screen.getByRole("alert")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Could not load the resume."))
      .toBeInTheDocument();
  });
});

describe("ResumeVersionList — newest-first ordering (AC 1)", () => {
  it("renders the newest version first regardless of array insertion order", async () => {
    // Arrange — the OLDER entry is stored first in the array (append-only),
    // so a naive render-in-array-order would show it first too.
    const older = buildVersion({
      path: "1/resumes/1/older.pdf",
      filename: "older.pdf",
      uploaded_at: "2026-01-01T00:00:00Z",
    });
    const newer = buildVersion({
      path: "1/resumes/1/newer.pdf",
      filename: "newer.pdf",
      uploaded_at: "2026-02-01T00:00:00Z",
    });
    const getList = vi.fn().mockResolvedValue({
      data: [buildResumeRow({ files: [older, newer] })],
      total: 1,
    });

    // Act
    const { screen } = await renderList(1, { getList });

    // Assert
    await expect.element(screen.getByText("newer.pdf")).toBeInTheDocument();
    const items = screen.container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("newer.pdf");
    expect(items[1].textContent).toContain("older.pdf");
  });
});

describe("ResumeVersionList — original-resume picker", () => {
  it("offers newest-first versions with 12-hour times and preserves the action row", async () => {
    const older = buildVersion({
      path: "1/resumes/1/older-picker.pdf",
      filename: "older-picker.pdf",
      uploaded_at: "2026-01-01T09:34:00Z",
    });
    const newer = buildVersion({
      path: "1/resumes/1/newer-picker.pdf",
      filename: "newer-picker.pdf",
      uploaded_at: "2026-02-01T21:34:00Z",
    });
    const getList = vi.fn().mockResolvedValue({
      data: [buildResumeRow({ files: [older, newer] })],
      total: 1,
    });
    const onShow = vi.fn();

    const { screen } = await renderList(98765, { getList }, false, {
      presentation: "picker",
      onShow,
    });

    const picker = screen.getByRole("combobox", { name: "Version" });
    await expect.element(picker).toBeInTheDocument();
    const options = picker.element().querySelectorAll("option");
    expect(options[0].textContent).toContain("newer-picker.pdf");
    expect(options[0].textContent).toContain("9:34 PM");
    expect(options[1].textContent).toContain("older-picker.pdf");
    expect(options[1].textContent).toContain("9:34 AM");
    expect(screen.container.querySelectorAll("li")).toHaveLength(1);
    await expect
      .element(
        screen.getByRole("button", { name: "Download newer-picker.pdf" }),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Show older-picker.pdf" }))
      .not.toBeInTheDocument();

    await userEvent.selectOptions(
      picker,
      options[1].getAttribute("value") as string,
    );
    expect(onShow).toHaveBeenCalledWith(older);
  });

  it("uses the Original resume empty state and links back to the Resume tab", async () => {
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const { screen } = await renderList(7, { getList }, false, {
      presentation: "picker",
      emptyActionHref: "/shidduchim/7/resume",
    });

    await expect
      .element(screen.getByText("No resume yet."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Add one on the Resume tab."))
      .toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Go to the Resume tab" });
    expect(link.element().getAttribute("href")).toBe("/shidduchim/7/resume");
  });
});

describe("ResumeVersionList — signed URL minted per click, never cached (AC 5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls signResumeFileUrl again on a second click of the same row", async () => {
    // Arrange
    vi.spyOn(window, "open").mockImplementation(() => null);
    const version = buildVersion();
    const getList = vi.fn().mockResolvedValue({
      data: [buildResumeRow({ files: [version] })],
      total: 1,
    });
    const signResumeFileUrl = vi
      .fn()
      .mockResolvedValue("https://signed.example/y");

    // Act
    const { screen } = await renderList(1, { getList, signResumeFileUrl });
    const downloadButton = screen.getByRole("button", {
      name: "Download resume.pdf",
    });
    await downloadButton.click();
    await downloadButton.click();

    // Assert — an implementation that caches the URL in component state
    // fails this: it would call signResumeFileUrl once and reuse the value.
    await expect.poll(() => signResumeFileUrl.mock.calls.length).toBe(2);
    // `inline: false` is what keeps `Content-Disposition: attachment` on the
    // signed URL. Download must stay a download now that "View" sits next to
    // it asking for `inline: true` from this same call.
    expect(signResumeFileUrl).toHaveBeenCalledWith({
      storagePath: version.path,
      fileName: version.filename,
      inline: false,
    });
  });

  it("shows a translated error and stays usable when signing rejects", async () => {
    // Arrange
    const version = buildVersion();
    const getList = vi.fn().mockResolvedValue({
      data: [buildResumeRow({ files: [version] })],
      total: 1,
    });
    const signResumeFileUrl = vi.fn().mockRejectedValue(new Error("boom"));

    // Act
    const { screen } = await renderList(1, { getList, signResumeFileUrl });
    await screen.getByRole("button", { name: "Download resume.pdf" }).click();

    // Assert
    await expect.element(screen.getByText("boom")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Download resume.pdf" }))
      .toBeInTheDocument();
  });
});

describe("ResumeVersionList — automatic reads only", () => {
  it.each([
    ["one version", [buildVersion()]],
    [
      "two versions",
      [
        buildVersion(),
        buildVersion({
          path: "1/resumes/1/newer-resume.pdf",
          filename: "newer-resume.pdf",
          uploaded_at: "2026-02-01T00:00:00Z",
        }),
      ],
    ],
  ] as const)(
    "shows no per-file manual read button for managers with %s",
    async (_versionCount, files) => {
      const readResume = vi.fn().mockResolvedValue("completed");
      const getList = vi.fn().mockResolvedValue({
        data: [buildResumeRow({ files: [...files] })],
        total: 1,
      });

      const { screen } = await renderList(1, { getList, readResume }, true);

      expect(screen.container.textContent).not.toContain(
        "Make it easy to read",
      );
      expect(readResume).not.toHaveBeenCalled();
    },
  );
});
