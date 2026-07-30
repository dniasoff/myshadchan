import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import type { DataProvider } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { Resume, ResumeFileVersion } from "../types";
import {
  sortResumeFilesNewestFirst,
  useLatestResumeFile,
} from "./useLatestResumeFile";

/**
 * Story 5.7, Task 3: `useLatestResumeFile` reuses `ResumeVersionList`'s own
 * "which version is newest" sort (Story 5.3) rather than re-deriving it —
 * `sortResumeFilesNewestFirst` is the shared function both now call.
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

describe("sortResumeFilesNewestFirst", () => {
  it("returns the versions newest-first regardless of array insertion order", () => {
    // Arrange — the OLDER entry appears first in the array (append-only).
    const older = buildVersion({
      filename: "older.pdf",
      uploaded_at: "2026-01-01T00:00:00Z",
    });
    const newer = buildVersion({
      filename: "newer.pdf",
      uploaded_at: "2026-02-01T00:00:00Z",
    });

    // Act
    const result = sortResumeFilesNewestFirst([older, newer]);

    // Assert
    expect(result.map((version) => version.filename)).toEqual([
      "newer.pdf",
      "older.pdf",
    ]);
  });

  it("does not mutate the array it is given", () => {
    // Arrange
    const older = buildVersion({ filename: "older.pdf" });
    const newer = buildVersion({
      filename: "newer.pdf",
      uploaded_at: "2026-02-01T00:00:00Z",
    });
    const original = [older, newer];

    // Act
    sortResumeFilesNewestFirst(original);

    // Assert
    expect(original).toEqual([older, newer]);
  });
});

function LatestResumeFileProbe({ shidduchimId }: { shidduchimId: number }) {
  const { latestFile, isPending, error } = useLatestResumeFile(shidduchimId);
  return (
    <span>
      isPending:{String(isPending)} error:{String(!!error)} filename:
      {latestFile?.filename ?? "none"}
    </span>
  );
}

const buildResumeRow = (overrides: Partial<Resume> = {}): Resume => ({
  id: 1,
  account_id: 1,
  shidduchim_id: 1,
  files: [buildVersion()],
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const renderProbe = async (getList: DataProvider["getList"]) => {
  const dataProvider = { getList } as unknown as DataProvider;

  return render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <LatestResumeFileProbe shidduchimId={1} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
};

describe("useLatestResumeFile", () => {
  it("resolves to null while no resumes row exists yet", async () => {
    // Arrange
    const getList = vi.fn().mockResolvedValue({ data: [], total: 0 });

    // Act
    const screen = await renderProbe(getList);

    // Assert
    await expect
      .element(screen.getByText("isPending:false error:false filename:none"))
      .toBeInTheDocument();
  });

  it("resolves to the newest of several versions, not the first array entry", async () => {
    // Arrange
    const older = buildVersion({
      filename: "older.pdf",
      uploaded_at: "2026-01-01T00:00:00Z",
    });
    const newer = buildVersion({
      filename: "newer.pdf",
      uploaded_at: "2026-02-01T00:00:00Z",
    });
    const getList = vi.fn().mockResolvedValue({
      data: [buildResumeRow({ files: [older, newer] })],
      total: 1,
    });

    // Act
    const screen = await renderProbe(getList);

    // Assert
    await expect
      .element(
        screen.getByText("isPending:false error:false filename:newer.pdf"),
      )
      .toBeInTheDocument();
  });
});
