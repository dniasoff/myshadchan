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
  clearPendingResumeFileDelete,
  hydratePendingResumeFileDeletes,
  readPendingResumeFileDeletes,
  rememberPendingResumeFileDelete,
  resumeFileDeleteMarkerToken,
  resumeFileTypeLabel,
  schedulePendingResumeFileDelete,
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
  row = resume,
) => {
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [row], total: 1 }),
    getShidduchReadState: vi.fn().mockResolvedValue({ inProgress: false }),
    getResumeReadState: vi.fn().mockResolvedValue({ inProgress: false }),
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
    window.localStorage.clear();
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

  it("persists only a collision-resistant opaque marker needed after a reload", async () => {
    expect(
      await rememberPendingResumeFileDelete({
        resumeId: 42,
        deadline: 123,
        file: {
          path: "1/resumes/7/photo.jpg",
          size: 9,
          uploaded_at: "2026-02-01T00:00:00Z",
        },
      }),
    ).toBe(true);
    const token = await resumeFileDeleteMarkerToken(42, resume.files![1]);
    expect(readPendingResumeFileDeletes()).toEqual([
      { token, resumeToken: expect.any(String), deadline: 123 },
    ]);
    expect(Object.keys(window.localStorage)).toEqual([
      expect.stringContaining("myshadchan:pending-resume-file-delete:"),
    ]);
    expect(
      window.localStorage.getItem(Object.keys(window.localStorage)[0]!),
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
      getResumeReadState: vi.fn().mockResolvedValue({ inProgress: true }),
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

  it("disables only the file whose read is in progress", async () => {
    const getResumeReadState = vi.fn((resumeId: number, path: string) =>
      Promise.resolve({
        inProgress: resumeId === 42 && path.endsWith("photo.jpg"),
      }),
    );
    const { screen } = await renderList({ getResumeReadState });

    await expect
      .element(screen.getByRole("button", { name: "Delete photo.jpg" }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: "Delete old.pdf" }))
      .not.toBeDisabled();
    expect(getResumeReadState).toHaveBeenCalledWith(42, "1/resumes/7/old.pdf");
    expect(getResumeReadState).toHaveBeenCalledWith(
      42,
      "1/resumes/7/photo.jpg",
    );
  });

  it("runs the provider only after the full Undo window and keeps the exact failure copy", async () => {
    try {
      const removeResumeFile = vi
        .fn()
        .mockRejectedValue(new Error("private detail"));
      const { dataProvider, screen } = await renderList({
        removeResumeFile,
      });
      vi.useFakeTimers();
      await screen
        .getByRole("button", { name: "Delete photo.jpg", exact: true })
        .click();
      await screen.getByRole("button", { name: "Delete", exact: true }).click();
      await expect.element(screen.getByText("Deleted.")).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(RESUME_FILE_DELETE_UNDO_MS);
      await expect
        .element(screen.getByText("Could not delete. Nothing was changed."))
        .toBeInTheDocument();
      await expect.element(screen.getByText("photo.jpg")).toBeInTheDocument();
      expect(dataProvider.removeResumeFile).toHaveBeenCalledExactlyOnceWith({
        resumeId: 42,
        path: "1/resumes/7/photo.jpg",
        size: 9,
        uploadedAt: "2026-02-01T00:00:00Z",
        deleteToken: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews the fallback tab claim while a finalization RPC is in flight", async () => {
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
    vi.useFakeTimers();
    let release!: () => void;
    const finalize = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const file = resume.files![1]!;
    const token = await resumeFileDeleteMarkerToken(42, file);
    const marker = {
      resumeId: 42,
      file,
      deadline: Date.now() + 100,
      token,
      resumeToken: "resume-token",
    };
    try {
      await rememberPendingResumeFileDelete(marker);
      schedulePendingResumeFileDelete(marker, finalize);
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => expect(finalize).toHaveBeenCalledTimes(1));

      // The 60-second fallback lease would have expired here. A second timer
      // must still observe the renewed opaque claim and stay out of the RPC.
      await vi.advanceTimersByTimeAsync(61_000);
      schedulePendingResumeFileDelete(marker, finalize);
      await vi.advanceTimersByTimeAsync(0);
      expect(finalize).toHaveBeenCalledTimes(1);

      release();
      await vi.runOnlyPendingTimersAsync();
      // A completed callback must not be re-armed by a later Resume-tab
      // effect observing the same marker and deadline.
      schedulePendingResumeFileDelete(marker, finalize);
      await vi.advanceTimersByTimeAsync(0);
      expect(finalize).toHaveBeenCalledTimes(1);
    } finally {
      clearPendingResumeFileDelete(token);
      vi.useRealTimers();
      if (originalLocks) {
        Object.defineProperty(navigator, "locks", originalLocks);
      } else {
        Reflect.deleteProperty(navigator, "locks");
      }
    }
  });

  it("rehydrates an expired matching marker so reload finalizes instead of losing the delete", async () => {
    vi.useFakeTimers();
    const file = resume.files![1]!;
    const deadline = Date.now() - 1;
    const token = await resumeFileDeleteMarkerToken(42, file);
    try {
      await rememberPendingResumeFileDelete({
        resumeId: 42,
        file,
        deadline,
      });
      await hydratePendingResumeFileDeletes(42, [file]);
      expect([...pendingResumeFileDeletes.values()]).toEqual([
        expect.objectContaining({
          resumeId: 42,
          file,
          deadline,
          token,
        }),
      ]);

      const finalize = vi.fn();
      schedulePendingResumeFileDelete(
        { resumeId: 42, file, deadline, token },
        finalize,
      );
      await vi.runOnlyPendingTimersAsync();
      await vi.waitFor(() => expect(finalize).toHaveBeenCalledTimes(1));
    } finally {
      clearPendingResumeFileDelete(token);
      pendingResumeFileDeletes.clear();
      vi.useRealTimers();
    }
  });

  it("drops a live pending row when another tab clears its durable marker", async () => {
    const file = resume.files![1]!;
    const deadline = Date.now() + RESUME_FILE_DELETE_UNDO_MS;
    const token = await resumeFileDeleteMarkerToken(42, file);
    const marker = { resumeId: 42, file, deadline, token };
    await rememberPendingResumeFileDelete(marker);
    pendingResumeFileDeletes.set(
      `${marker.resumeId}\u0000${file.path}\u0000${file.size}\u0000${file.uploaded_at}`,
      marker,
    );
    const { screen } = await renderList();
    await expect
      .element(screen.getByText("photo.jpg", { exact: true }))
      .not.toBeInTheDocument();

    const storageKey = `myshadchan:pending-resume-file-delete:${token}`;
    const oldValue = window.localStorage.getItem(storageKey);
    window.localStorage.removeItem(storageKey);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: storageKey,
        oldValue,
        newValue: null,
      }),
    );

    await expect
      .element(screen.getByText("photo.jpg", { exact: true }))
      .toBeInTheDocument();
    expect(pendingResumeFileDeletes.size).toBe(0);
  });

  it("treats duplicate paths as independent files using their exact identity", async () => {
    const duplicatePathResume: Resume = {
      ...resume,
      files: [
        { ...resume.files![0]!, filename: "old.pdf", size: 8 },
        {
          ...resume.files![0]!,
          filename: "old-alias.pdf",
          size: 88,
          uploaded_at: "2026-01-02T00:00:00Z",
        },
      ],
    };
    const target = duplicatePathResume.files![0]!;
    await rememberPendingResumeFileDelete({
      resumeId: 42,
      file: target,
      deadline: Date.now() + RESUME_FILE_DELETE_UNDO_MS,
    });
    try {
      const { screen } = await renderList({}, true, duplicatePathResume);
      await expect
        .element(screen.getByText("old.pdf", { exact: true }))
        .not.toBeInTheDocument();
      await expect
        .element(screen.getByText("old-alias.pdf", { exact: true }))
        .toBeInTheDocument();
      await expect
        .element(screen.getByRole("button", { name: "Delete old-alias.pdf" }))
        .toBeInTheDocument();
    } finally {
      pendingResumeFileDeletes.clear();
      window.localStorage.clear();
    }
  });

  it("focuses the Resume files heading when the last visible row is finalized", async () => {
    await rememberPendingResumeFileDelete({
      resumeId: 42,
      file: resume.files![0]!,
      deadline: Date.now() + RESUME_FILE_DELETE_UNDO_MS,
    });
    try {
      const { screen, dataProvider } = await renderList();
      await expect.element(screen.getByText("old.pdf")).not.toBeInTheDocument();
      vi.useFakeTimers();
      await screen
        .getByRole("button", { name: "Delete photo.jpg", exact: true })
        .click();
      await screen.getByRole("button", { name: "Delete", exact: true }).click();
      await vi.advanceTimersByTimeAsync(RESUME_FILE_DELETE_UNDO_MS);
      await expect
        .poll(
          () =>
            (
              dataProvider.removeResumeFile as unknown as {
                mock: { calls: unknown[][] };
              }
            ).mock.calls.length,
        )
        .toBeGreaterThanOrEqual(2);
      await expect
        .element(screen.getByRole("heading", { name: "Resume files" }))
        .toHaveFocus();
    } finally {
      vi.useRealTimers();
      pendingResumeFileDeletes.clear();
      window.localStorage.clear();
    }
  });
});
