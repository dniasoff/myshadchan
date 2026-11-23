import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useState } from "react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../../providers/types";
import type {
  EntityFileSummary,
  Resume,
  ResumePhoto,
  Single,
} from "../../types";
import { ChildDocumentsPanel } from "./ChildDocumentsPanel";
import * as photoResize from "./photoResize";
import { PHOTO_MAX_BYTES } from "./photoResize";

const viewerRole = vi.hoisted(() => ({
  role: "parent_admin" as
    "parent_admin" | "self_manager" | "helper" | "shadchan" | "single",
  isPending: false,
}));

vi.mock("../../entity360/useViewerRole", () => ({
  useViewerRole: () => viewerRole,
}));

const single: Single = {
  id: 11,
  account_id: 1,
  first_name_en: "Miriam",
  last_name_en: "Cohen",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
};

const resume: Resume = {
  id: 33,
  account_id: 1,
  single_id: single.id,
  files: [
    {
      path: "1/resumes/33/latest.pdf",
      filename: "Miriam-Cohen-resume.pdf",
      uploaded_at: "2026-01-03T00:00:00Z",
      uploaded_by: null,
      mime_type: "application/pdf",
      size: 12,
    },
  ],
  created_at: "2026-01-01T00:00:00Z",
};

const photo: ResumePhoto = {
  id: 44,
  account_id: 1,
  resume_id: resume.id,
  path: "1/photos/shared/33/photo.png",
  uploaded_at: "2026-01-03T00:00:00Z",
  visibility: "shared",
  hidden_at: null,
};

const paper: EntityFileSummary = {
  id: 55,
  account_id: 1,
  target_type: "single",
  target_id: single.id,
  storage_path: "1/entity-files/55/paper.pdf",
  file_name: "school-paper.pdf",
  mime_type: "application/pdf",
  size_bytes: 12,
  visibility: "private_parent",
  uploaded_by_member_id: null,
  created_at: "2026-01-03T00:00:00Z",
  slot: "paper_1",
};

const olderFile: EntityFileSummary = {
  ...paper,
  id: 56,
  storage_path: "1/entity-files/56/older.docx",
  file_name: "older-file.docx",
  slot: null,
};

function buildDataProvider(
  entityFiles: EntityFileSummary[] = [paper, olderFile],
  getListOverride?: CrmDataProvider["getList"],
): CrmDataProvider {
  const getList =
    getListOverride ??
    vi.fn((resource: string) => {
      if (resource === "resumes")
        return Promise.resolve({ data: [resume], total: 1 });
      if (resource === "resume_photos")
        return Promise.resolve({ data: [photo], total: 1 });
      if (resource === "entity_files_summary")
        return Promise.resolve({
          data: entityFiles,
          total: entityFiles.length,
        });
      return Promise.resolve({ data: [], total: 0 });
    });
  return {
    getList,
    getOne: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    uploadEntityFile: vi.fn(),
    uploadResumeFile: vi.fn().mockResolvedValue(resume),
    uploadResumePhoto: vi.fn().mockResolvedValue(photo),
    signResumeFileUrl: vi.fn().mockResolvedValue("blob:resume"),
    signResumePhotoUrl: vi.fn().mockResolvedValue("blob:photo"),
    signEntityFileUrl: vi.fn().mockResolvedValue("blob:paper"),
    hideResumePhoto: vi.fn().mockResolvedValue(photo),
    restoreResumePhoto: vi.fn().mockResolvedValue(photo),
    removeResumeFile: vi.fn().mockResolvedValue(undefined),
    softDeleteEntityFile: vi.fn().mockResolvedValue({
      id: paper.id,
      delete_token: "paper-token",
      undo_until: new Date(Date.now() + 10_000).toISOString(),
    }),
    undoEntityFileDelete: vi.fn().mockResolvedValue(paper),
    finalizeEntityFileDelete: vi.fn().mockResolvedValue(undefined),
    finalizeExpiredEntityFileDeletes: vi.fn().mockResolvedValue(0),
    replaceEntityFile: vi.fn().mockResolvedValue(paper),
  } as unknown as CrmDataProvider;
}

async function renderPanel(
  entityFiles?: EntityFileSummary[],
  getListOverride?: CrmDataProvider["getList"],
) {
  const dataProvider = buildDataProvider(entityFiles, getListOverride);
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ChildDocumentsPanel single={single} open onOpenChange={vi.fn()} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  if (vi.isFakeTimers()) {
    await vi.runAllTimersAsync();
  }
  return { dataProvider, screen };
}

async function renderControlledPanel(
  entityFiles: EntityFileSummary[] = [paper, olderFile],
) {
  const dataProvider = buildDataProvider(entityFiles);
  function ControlledDocumentsPanel() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Reopen Documents
        </button>
        <ChildDocumentsPanel
          single={single}
          open={open}
          onOpenChange={setOpen}
        />
      </>
    );
  }
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ControlledDocumentsPanel />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  if (vi.isFakeTimers()) {
    await vi.runAllTimersAsync();
  }
  return { dataProvider, screen };
}

describe("ChildDocumentsPanel", () => {
  beforeEach(() => {
    viewerRole.role = "parent_admin";
    viewerRole.isPending = false;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: undefined,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the three named slots, same-source files, and the legacy section", async () => {
    const { dataProvider, screen } = await renderPanel();

    await expect.element(screen.getByText("Documents")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Miriam-Cohen-resume.pdf"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("photo.png")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("img", { name: "Picture preview" }))
      .toHaveAttribute("src", "blob:photo");
    await expect
      .element(screen.getByText("school-paper.pdf"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Older files (1)"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("older-file.docx")).not.toBeVisible();
    expect(dataProvider.getList).toHaveBeenCalledWith(
      "resume_photos",
      expect.objectContaining({
        filter: { resume_id: resume.id, "hidden_at@is": null },
      }),
    );

    for (const name of [
      "Open Resume",
      "Replace Resume",
      "Forward Resume",
      "Delete Resume",
      "Open Picture",
      "Replace Picture",
      "Forward Picture",
      "Delete Picture",
      "Open Paper 1",
      "Replace Paper 1",
      "Forward Paper 1",
      "Delete Paper 1",
      "Add Paper 2",
    ]) {
      await expect
        .element(screen.getByRole("button", { name }))
        .toBeInTheDocument();
    }
  });

  it("opens the saved original when the picture preview is tapped", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { screen } = await renderPanel();

    await screen
      .getByRole("button", { name: "Open full-size picture preview" })
      .click();

    await expect.poll(() => open.mock.calls.length).toBe(1);
    expect(open).toHaveBeenCalledWith(
      "blob:photo",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("shows loading while Retry refetches after a failed load", async () => {
    let phase: "initial" | "retry" = "initial";
    const retryResolvers: Array<
      (result: { data: unknown[]; total: number }) => void
    > = [];
    const getList = vi.fn((resource: string) => {
      if (phase === "initial") return Promise.reject(new Error("offline"));
      if (resource === "resume_photos")
        return Promise.resolve({ data: [photo], total: 1 });
      return new Promise<{ data: unknown[]; total: number }>((resolve) => {
        retryResolvers.push(resolve);
      });
    }) as unknown as CrmDataProvider["getList"];
    const { screen } = await renderPanel(undefined, getList);

    await expect
      .element(
        screen.getByText(
          "Could not load some documents. Your files are unchanged.",
        ),
      )
      .toBeInTheDocument();

    phase = "retry";
    await screen.getByRole("button", { name: "Retry" }).click();
    await expect
      .element(screen.getByText("Loading documents…"))
      .toBeInTheDocument();
    await expect.poll(() => retryResolvers.length).toBe(2);

    const pendingResolvers = retryResolvers.splice(0);
    pendingResolvers.forEach((resolve, index) => {
      resolve(
        index === 0
          ? { data: [resume], total: 1 }
          : { data: [paper, olderFile], total: 2 },
      );
    });
    await expect
      .element(screen.getByText("Miriam-Cohen-resume.pdf"))
      .toBeInTheDocument();
  });

  it("keeps paper slots usable when the resume lookup fails", async () => {
    const getList = vi.fn((resource: string) => {
      if (resource === "resumes") {
        return Promise.reject(new Error("resume unavailable"));
      }
      if (resource === "entity_files_summary")
        return Promise.resolve({ data: [paper], total: 1 });
      return Promise.resolve({ data: [], total: 0 });
    }) as unknown as CrmDataProvider["getList"];
    const { dataProvider, screen } = await renderPanel(undefined, getList);

    await expect
      .element(screen.getByText("Resume is unavailable."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Add Resume" }))
      .toBeDisabled();
    await expect
      .element(screen.getByText("school-paper.pdf"))
      .toBeInTheDocument();

    await screen.getByRole("button", { name: "Open Paper 1" }).click();
    await expect
      .poll(() => vi.mocked(dataProvider.signEntityFileUrl).mock.calls.length)
      .toBe(1);
  });

  it("disables paper adds when the paper lookup fails", async () => {
    const getList = vi.fn((resource: string) => {
      if (resource === "entity_files_summary")
        return Promise.reject(new Error("papers unavailable"));
      if (resource === "resumes")
        return Promise.resolve({ data: [resume], total: 1 });
      if (resource === "resume_photos")
        return Promise.resolve({ data: [photo], total: 1 });
      return Promise.resolve({ data: [], total: 0 });
    }) as unknown as CrmDataProvider["getList"];
    const { screen } = await renderPanel(undefined, getList);

    await expect
      .element(screen.getByText("Papers are unavailable."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Add Paper 1" }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: "Add Paper 2" }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: "Open Resume" }))
      .not.toBeDisabled();
  });

  it("does not show Older files when no legacy rows exist", async () => {
    const { screen } = await renderPanel([paper]);

    await expect
      .element(screen.getByText("school-paper.pdf"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText(/Older files/))
      .not.toBeInTheDocument();
  });

  it("uploads into an empty named paper slot and reserves the slot while busy", async () => {
    const { dataProvider, screen } = await renderPanel([paper]);
    const upload = screen.getByLabelText("Upload child document");
    const file = new File(["paper"], "school.pdf", { type: "application/pdf" });

    await screen.getByRole("button", { name: "Add Paper 2" }).click();
    await upload.upload(file);

    await expect
      .poll(() => vi.mocked(dataProvider.uploadEntityFile).mock.calls.length)
      .toBe(1);
    expect(dataProvider.uploadEntityFile).toHaveBeenCalledWith({
      targetType: "single",
      targetId: single.id,
      file,
      slot: "paper_2",
    });
  });

  it("shows an inline accessible error for an invalid upload", async () => {
    const { screen } = await renderPanel([paper]);

    await screen.getByRole("button", { name: "Add Paper 2" }).click();
    await screen
      .getByLabelText("Upload child document")
      .upload(new File(["not a document"], "bad.txt", { type: "text/plain" }));

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent(
        "Could not add this file. Use a PDF, Word, JPEG or PNG file smaller than 8 MiB.",
      );
  });

  it("shows the picture size choices and disables full size over 8 MiB", async () => {
    const { dataProvider, screen } = await renderPanel([paper]);
    const file = new File([new Uint8Array(PHOTO_MAX_BYTES + 1)], "phone.jpg", {
      type: "image/jpeg",
    });

    await screen.getByRole("button", { name: "Replace Picture" }).click();
    await screen.getByLabelText("Upload child document").upload(file);

    await expect
      .element(screen.getByRole("region", { name: "Choose picture size" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Keep full size" }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("button", { name: "Keep full size" }))
      .toHaveAttribute("aria-describedby", "picture-full-size-disabled-reason");
    await expect
      .element(
        screen.getByRole("button", { name: "Make smaller (recommended)" }),
      )
      .toHaveFocus();
    await expect
      .element(
        screen.getByText(
          "Not available for this photo. It is over the 8 MiB limit.",
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          "The full-size photo is too large to save here. Make a smaller copy first.",
        ),
      )
      .toBeInTheDocument();
    expect(dataProvider.uploadResumePhoto).not.toHaveBeenCalled();
  });

  it("keeps a fitting picture's original bytes when Keep full size is chosen", async () => {
    const { dataProvider, screen } = await renderPanel([paper]);
    const file = new File(["small picture"], "small.jpg", {
      type: "image/jpeg",
    });

    await screen.getByRole("button", { name: "Replace Picture" }).click();
    await screen.getByLabelText("Upload child document").upload(file);
    await screen.getByRole("button", { name: "Keep full size" }).click();

    await expect
      .poll(() => vi.mocked(dataProvider.uploadResumePhoto).mock.calls.length)
      .toBe(1);
    expect(dataProvider.uploadResumePhoto).toHaveBeenCalledWith({
      singleId: single.id,
      file,
      visibility: "shared",
    });
    await expect
      .element(screen.getByRole("button", { name: "Replace Picture" }))
      .toHaveFocus();
  });

  it("keeps the inline choice and progress visible while making a photo smaller", async () => {
    let resolveResize!: (result: {
      file: File;
      resized: boolean;
      sourceDimensions: { width: number; height: number };
      outputDimensions: { width: number; height: number };
    }) => void;
    vi.spyOn(photoResize, "makeSmallerPhoto").mockReturnValue(
      new Promise((resolve) => {
        resolveResize = resolve;
      }),
    );
    const { dataProvider, screen } = await renderPanel([paper]);
    const bytes = new Uint8Array(PHOTO_MAX_BYTES + 1);
    const file = new File([bytes], "phone.jpg", { type: "image/jpeg" });

    await screen.getByRole("button", { name: "Replace Picture" }).click();
    await screen.getByLabelText("Upload child document").upload(file);
    await screen
      .getByRole("button", { name: "Make smaller (recommended)" })
      .click();

    await expect
      .element(screen.getByRole("region", { name: "Choose picture size" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Making your photo smaller…"))
      .toBeInTheDocument();
    expect(dataProvider.uploadResumePhoto).not.toHaveBeenCalled();

    resolveResize({
      file: new File(["smaller"], "phone.jpg", { type: "image/jpeg" }),
      resized: true,
      sourceDimensions: { width: 4000, height: 2000 },
      outputDimensions: { width: 3000, height: 1500 },
    });
    await expect
      .poll(() => vi.mocked(dataProvider.uploadResumePhoto).mock.calls.length)
      .toBe(1);
    await expect
      .element(screen.getByRole("button", { name: "Replace Picture" }))
      .toHaveFocus();
  });

  it("clears pending picture choices when Documents closes and reopens", async () => {
    const { screen } = await renderControlledPanel([paper]);

    await screen.getByRole("button", { name: "Replace Picture" }).click();
    await screen
      .getByLabelText("Upload child document")
      .upload(new File(["photo"], "phone.jpg", { type: "image/jpeg" }));
    await expect
      .element(screen.getByRole("region", { name: "Choose picture size" }))
      .toBeInTheDocument();

    await screen.getByRole("button", { name: "Close" }).click();
    await expect.element(screen.getByText("Documents")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Reopen Documents" }).click();
    await expect.element(screen.getByText("Documents")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("region", { name: "Choose picture size" }))
      .not.toBeInTheDocument();

    await screen.getByRole("button", { name: "Forward Picture" }).click();
    await expect
      .element(screen.getByRole("region", { name: "Forward picture" }))
      .toBeInTheDocument();
    await screen.getByRole("button", { name: "Close" }).click();
    await expect.element(screen.getByText("Documents")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Reopen Documents" }).click();
    await expect.element(screen.getByText("Documents")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("region", { name: "Forward picture" }))
      .not.toBeInTheDocument();
  });

  it("replaces a paper through the upload-before-swap provider method", async () => {
    const { dataProvider, screen } = await renderPanel([paper]);
    const upload = screen.getByLabelText("Upload child document");
    const file = new File(["replacement"], "replacement.pdf", {
      type: "application/pdf",
    });

    await screen.getByRole("button", { name: "Replace Paper 1" }).click();
    await upload.upload(file);

    await expect
      .poll(() => vi.mocked(dataProvider.replaceEntityFile).mock.calls.length)
      .toBe(1);
    expect(dataProvider.replaceEntityFile).toHaveBeenCalledWith({
      oldId: paper.id,
      targetType: "single",
      targetId: single.id,
      file,
      slot: "paper_1",
      visibility: paper.visibility,
    });
  });

  it("confirms a paper delete, permits Undo, and finalizes after the deadline", async () => {
    vi.useFakeTimers();
    const { dataProvider, screen } = await renderPanel([paper]);

    await screen
      .getByRole("button", { name: "Delete Paper 1", exact: true })
      .click();
    await screen.getByRole("button", { name: "Delete file" }).click();
    await expect
      .poll(
        () => vi.mocked(dataProvider.softDeleteEntityFile).mock.calls.length,
      )
      .toBe(1);
    await expect
      .element(
        screen.getByRole("button", {
          name: "Undo delete Paper 1: school-paper.pdf",
        }),
      )
      .toBeInTheDocument();
    await screen
      .getByRole("button", {
        name: "Undo delete Paper 1: school-paper.pdf",
      })
      .click();
    expect(dataProvider.undoEntityFileDelete).toHaveBeenCalledWith({
      id: paper.id,
      deleteToken: "paper-token",
    });

    const deletePaper = screen.getByRole("button", {
      name: "Delete Paper 1",
      exact: true,
    });
    await expect.element(deletePaper).toBeEnabled();
    await deletePaper.click();
    await screen.getByRole("button", { name: "Delete file" }).click();
    await expect
      .poll(
        () => vi.mocked(dataProvider.softDeleteEntityFile).mock.calls.length,
      )
      .toBe(2);
    vi.advanceTimersByTime(10_001);
    await expect
      .poll(
        () =>
          vi.mocked(dataProvider.finalizeEntityFileDelete).mock.calls.length,
      )
      .toBe(1);
  });

  it("keeps multiple Undo windows independent and reserves a pending slot", async () => {
    vi.useFakeTimers();
    const secondPaper = { ...paper, id: 57, slot: "paper_2" as const };
    const { dataProvider, screen } = await renderPanel([paper, secondPaper]);
    vi.mocked(dataProvider.softDeleteEntityFile).mockImplementation(
      async ({ id }) => ({
        id,
        delete_token: `token-${id}`,
        undo_until: new Date(Date.now() + 10_000).toISOString(),
      }),
    );

    await screen
      .getByRole("button", { name: "Delete Paper 1", exact: true })
      .click();
    await screen.getByRole("button", { name: "Delete file" }).click();
    await screen
      .getByRole("button", { name: "Delete Paper 2", exact: true })
      .click();
    await screen.getByRole("button", { name: "Delete file" }).click();

    await expect
      .element(
        screen.getByRole("button", {
          name: "Undo delete Paper 1: school-paper.pdf",
        }),
      )
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("button", {
          name: "Undo delete Paper 2: school-paper.pdf",
        }),
      )
      .toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Replace Paper 1" }),
    ).toBeDisabled();
    expect(dataProvider.softDeleteEntityFile).toHaveBeenCalledTimes(2);
  });

  it("does not issue two deletes when the confirmation is double-clicked", async () => {
    let resolveDelete!: (value: {
      id: number;
      delete_token: string;
      undo_until: string;
    }) => void;
    const softDelete = vi.fn(
      () =>
        new Promise<{ id: number; delete_token: string; undo_until: string }>(
          (resolve) => {
            resolveDelete = resolve;
          },
        ),
    );
    const { dataProvider, screen } = await renderPanel([paper]);
    dataProvider.softDeleteEntityFile = softDelete;

    await screen
      .getByRole("button", { name: "Delete Paper 1", exact: true })
      .click();
    const confirm = screen.getByRole("button", { name: "Delete file" });
    await confirm.click();
    await expect.element(confirm).toBeDisabled();
    expect(softDelete).toHaveBeenCalledTimes(1);
    resolveDelete({
      id: paper.id as number,
      delete_token: "paper-token",
      undo_until: new Date(Date.now() + 10_000).toISOString(),
    });
  });

  it("shows explicit desktop forwarding choices and never opens the file", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { screen } = await renderPanel([paper]);

    await screen.getByRole("button", { name: "Forward Picture" }).click();
    await expect
      .element(screen.getByRole("region", { name: "Forward picture" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Send full size" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Send full size" }))
      .toHaveFocus();
    await expect
      .element(screen.getByRole("button", { name: "Send smaller" }))
      .toBeInTheDocument();
    await screen.getByRole("button", { name: "Send full size" }).click();
    await expect
      .element(screen.getByText("Download it, then attach it yourself."))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "Download" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "Email" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: "WhatsApp" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Forward Picture" }))
      .toHaveFocus();
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Picture ready to share.");
    expect(open).not.toHaveBeenCalled();
  });

  it("uses the touch share sheet only after a successful fetch", async () => {
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 1,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("file", { status: 200 })),
    );
    const { screen } = await renderPanel([paper]);

    await screen.getByRole("button", { name: "Forward Picture" }).click();
    await screen.getByRole("button", { name: "Send full size" }).click();
    await expect
      .poll(
        () => (navigator.share as ReturnType<typeof vi.fn>).mock.calls.length,
      )
      .toBe(1);
  });

  it("does not share an error response from the touch fetch", async () => {
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 1,
    });
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    const { screen } = await renderPanel([paper]);

    await screen.getByRole("button", { name: "Forward Picture" }).click();
    await screen.getByRole("button", { name: "Send full size" }).click();
    await expect.poll(() => share.mock.calls.length).toBe(0);
    await expect
      .element(screen.getByText("Download it, then attach it yourself."))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Forward Picture" }))
      .toHaveFocus();
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Could not download this file for sharing.");
  });

  it("shows helper/shadchan read-only resume controls and paper controls", async () => {
    viewerRole.role = "helper";
    const { screen } = await renderPanel([paper]);

    await expect
      .element(screen.getByRole("button", { name: "Open Resume" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Forward Resume" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Replace Resume" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Delete Resume" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Replace Paper 1" }))
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("button", { name: "Delete Paper 1", exact: true }),
      )
      .toBeInTheDocument();
  });

  it("renders nothing for a single-role viewer", async () => {
    viewerRole.role = "single";
    const { screen } = await renderPanel();

    await expect.element(screen.getByText("Documents")).not.toBeInTheDocument();
  });

  it("reports the four-file cap instead of pretending a slot is available", async () => {
    const secondPaper = { ...paper, id: 57, slot: "paper_2" as const };
    const { screen } = await renderPanel([paper, secondPaper]);

    await expect.element(screen.getByText("4 of 4 used")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Add Paper 1" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Add Paper 2" }))
      .not.toBeInTheDocument();
  });
});
