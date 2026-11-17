import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { Resume } from "../types";
import { ResumeVersionList } from "./ResumeVersionList";
import {
  pendingResumeFileDeletes,
  RESUME_FILE_DELETE_UNDO_MS,
  canDeleteResumeFile,
  readPendingResumeFileDeletes,
  rememberPendingResumeFileDelete,
  resumeFileDeleteMarkerToken,
  resumeFileTypeLabel,
} from "./resumeFileDelete";

const resume: Resume = {
  id: 42,
  account_id: 1,
  shidduchim_id: 7,
  files: [
    {
      path: "1/resumes/7/old.pdf",
      filename: "old.pdf",
      uploaded_at: "2026-01-01T00:00:00Z",
      uploaded_by: 1,
      mime_type: "application/pdf",
      size: 8,
    },
    {
      path: "1/resumes/7/photo.jpg",
      filename: "photo.jpg",
      uploaded_at: "2026-02-01T00:00:00Z",
      uploaded_by: 1,
      mime_type: "image/jpeg",
      size: 9,
    },
  ],
  sections: { keep: true },
  extracted: { keep: true },
  created_at: "2026-01-01T00:00:00Z",
};

const renderList = async (
  overrides: Partial<CrmDataProvider> = {},
  canDelete = true,
) => {
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [resume], total: 1 }),
    getShidduchReadState: vi.fn().mockResolvedValue({ inProgress: false }),
    removeResumeFile: vi.fn().mockResolvedValue({ purgePending: false }),
    signResumeFileUrl: vi.fn().mockResolvedValue("https://signed.example/x"),
    ...overrides,
  } as unknown as CrmDataProvider;
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResumeVersionList shidduchimId={7} canDelete={canDelete} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { dataProvider, screen };
};

describe("resume file deletion contract", () => {
  beforeEach(() => {
    pendingResumeFileDeletes.clear();
    window.sessionStorage.clear();
  });

  it("allows only manager roles and names common stored file types", () => {
    expect(canDeleteResumeFile("parent_admin", false)).toBe(true);
    expect(canDeleteResumeFile("self_manager", false)).toBe(true);
    expect(canDeleteResumeFile("single", false)).toBe(false);
    expect(canDeleteResumeFile(undefined, false)).toBe(false);
    expect(canDeleteResumeFile("parent_admin", true)).toBe(false);
    expect(resumeFileTypeLabel("application/pdf", "resume.pdf")).toBe("PDF");
    expect(resumeFileTypeLabel("image/jpeg", "photo.jpg")).toBe("Photo");
    expect(RESUME_FILE_DELETE_UNDO_MS).toBe(10_000);
  });

  it("persists only the resume marker needed to finish after a reload", () => {
    expect(
      rememberPendingResumeFileDelete({
        resumeId: 42,
        deadline: 123,
        file: { path: "1/resumes/7/photo.jpg" },
      }),
    ).toBe(true);
    expect(readPendingResumeFileDeletes()).toEqual([
      {
        token: resumeFileDeleteMarkerToken(42, "1/resumes/7/photo.jpg"),
        deadline: 123,
      },
    ]);
    expect(
      window.sessionStorage.getItem("myshadchan:pending-resume-file-delete"),
    ).not.toContain("photo.jpg");
  });

  it("gates the action, confirms before mutation, and lets Undo restore the row", async () => {
    const { dataProvider, screen } = await renderList();

    const deleteButton = screen.getByRole("button", {
      name: "Delete photo.jpg",
      exact: true,
    });
    await expect.element(deleteButton).toBeInTheDocument();
    await deleteButton.click();

    const cancel = screen.getByRole("button", { name: "Cancel", exact: true });
    const confirm = screen.getByRole("button", { name: "Delete", exact: true });
    await expect
      .element(screen.getByText("Delete this file?"))
      .toBeInTheDocument();
    await expect.element(cancel).toHaveFocus();
    expect(
      cancel.element().compareDocumentPosition(confirm.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await cancel.click();
    expect(dataProvider.removeResumeFile).not.toHaveBeenCalled();

    await deleteButton.click();
    await screen.getByRole("button", { name: "Delete", exact: true }).click();
    await expect.element(screen.getByText("Deleted.")).toBeInTheDocument();
    await expect.element(screen.getByText("photo.jpg")).not.toBeInTheDocument();
    expect(dataProvider.removeResumeFile).not.toHaveBeenCalled();

    await screen.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.element(screen.getByText("photo.jpg")).toBeInTheDocument();
    expect(dataProvider.removeResumeFile).not.toHaveBeenCalled();
  });

  it("disables Delete while a resume read is in progress and hides it for non-managers", async () => {
    const { screen: readingScreen } = await renderList({
      getShidduchReadState: vi.fn().mockResolvedValue({ inProgress: true }),
    });
    const readingDelete = readingScreen.getByRole("button", {
      name: "Delete photo.jpg",
      exact: true,
    });
    await expect.element(readingDelete).toBeDisabled();
    await expect
      .element(
        readingScreen.getByText(
          "Please wait: this resume is being made easy to read.",
        ),
      )
      .toBeInTheDocument();

    const { screen: hiddenScreen } = await renderList({}, false);
    expect(
      hiddenScreen.container.querySelectorAll('button[aria-label^="Delete"]'),
    ).toHaveLength(0);
  });

  it("runs the provider only after the full Undo window and keeps the exact failure copy", async () => {
    vi.useFakeTimers();
    try {
      const removeResumeFile = vi
        .fn()
        .mockRejectedValue(new Error("private detail"));
      const { dataProvider, screen } = await renderList({
        removeResumeFile,
      });
      await screen
        .getByRole("button", { name: "Delete photo.jpg", exact: true })
        .click();
      await screen.getByRole("button", { name: "Delete", exact: true }).click();
      await vi.advanceTimersByTimeAsync(RESUME_FILE_DELETE_UNDO_MS);
      await expect
        .element(screen.getByText("Could not delete. Nothing was changed."))
        .toBeInTheDocument();
      await expect.element(screen.getByText("photo.jpg")).toBeInTheDocument();
      expect(dataProvider.removeResumeFile).toHaveBeenCalledExactlyOnceWith({
        resumeId: 42,
        path: "1/resumes/7/photo.jpg",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
