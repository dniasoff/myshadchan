import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { Resume, ResumeFileVersion } from "../types";
import { ResumeVersionList } from "./ResumeVersionList";
import { isResumeUnread } from "./resumeReadableSections";

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
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides);

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResumeVersionList shidduchimId={shidduchimId} canReread={canReread} />
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
      .element(screen.getByText("No resume uploaded yet."))
      .not.toBeInTheDocument();
  });

  it("shows a translated empty message when no resumes row exists yet", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const { screen } = await renderList(1, { getList });

    // Assert
    await expect
      .element(screen.getByText("No resume uploaded yet."))
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
      .element(screen.getByText("No resume uploaded yet."))
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
    const downloadButton = screen.getByRole("button", { name: "Download" });
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
    await screen.getByRole("button", { name: "Download" }).click();

    // Assert
    await expect.element(screen.getByText("boom")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Download" }))
      .toBeInTheDocument();
  });
});

describe("ResumeVersionList — unread read mode", () => {
  it("uses the full read for an unread resume and keeps re-read for a read resume", async () => {
    const version = buildVersion();
    const readResume = vi.fn().mockResolvedValue("completed");
    const reReadResume = vi.fn().mockResolvedValue("completed");
    const unreadRow = buildResumeRow({
      sections: null,
      extracted: null,
      files: [version],
    });
    expect(isResumeUnread(unreadRow)).toBe(true);
    const unreadGetList = vi.fn().mockResolvedValue({
      data: [unreadRow],
      total: 1,
    });

    const unread = await renderList(
      1,
      { getList: unreadGetList, readResume, reReadResume },
      true,
    );
    await expect
      .element(
        unread.screen.getByRole("button", {
          name: "Read this resume",
          exact: true,
        }),
      )
      .toBeInTheDocument();
    await unread.screen
      .getByRole("button", { name: "Read this resume", exact: true })
      .click();
    await unread.screen
      .getByRole("button", { name: "Read", exact: true })
      .click();
    await expect.poll(() => readResume.mock.calls.length).toBe(1);
    expect(readResume).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeId: 1,
        fileIdentity: version.path,
        mode: "fill_empty",
      }),
    );
    expect(reReadResume).not.toHaveBeenCalled();

    const readGetList = vi.fn().mockResolvedValue({
      data: [
        buildResumeRow({
          sections: {
            learningHistory: [],
            references: [],
            additionalSections: [
              {
                key: "work",
                title: "Work",
                items: [{ label: "Role", value: "Teacher" }],
              },
            ],
          },
          extracted: null,
          files: [version],
        }),
      ],
      total: 1,
    });
    const alreadyRead = await renderList(
      1,
      { getList: readGetList, readResume, reReadResume },
      true,
    );
    await expect
      .element(
        alreadyRead.screen.getByRole("button", {
          name: "Re-read this resume",
          exact: true,
        }),
      )
      .toBeInTheDocument();
    await alreadyRead.screen
      .getByRole("button", { name: "Re-read this resume", exact: true })
      .click();
    await alreadyRead.screen
      .getByRole("button", { name: "Re-read", exact: true })
      .click();
    await expect.poll(() => reReadResume.mock.calls.length).toBe(1);
    expect(reReadResume).toHaveBeenCalledWith(
      expect.objectContaining({ resumeId: 1, fileIdentity: version.path }),
    );
  });

  it("does not offer another paid read after an accepted empty read", async () => {
    const version = buildVersion();
    const emptyReadRow = buildResumeRow({
      sections: {
        learningHistory: [],
        references: [],
        additionalSections: [],
        schemaVersion: 4,
      },
      extracted: {},
      files: [version],
    });
    expect(isResumeUnread(emptyReadRow)).toBe(false);
    const reReadResume = vi.fn().mockResolvedValue("completed");
    const { screen } = await renderList(
      1,
      {
        getList: vi.fn().mockResolvedValue({
          data: [emptyReadRow],
          total: 1,
        }),
        reReadResume,
      },
      true,
    );

    await expect
      .element(
        screen.getByRole("button", {
          name: "Re-read this resume",
          exact: true,
        }),
      )
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("button", {
          name: "Read this resume",
          exact: true,
        }),
      )
      .not.toBeInTheDocument();
  });
});
