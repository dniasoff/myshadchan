import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { Resume, ResumeFileVersion, ResumePhoto } from "../types";
import { ResumePrintButton } from "./ResumePrintButton";

const { printResume } = vi.hoisted(() => ({
  printResume: vi.fn().mockResolvedValue("printed"),
}));
vi.mock("../resumes/resumePrint", () => {
  return {
    downloadResumeFiles: vi.fn().mockResolvedValue(undefined),
    getResumePrintMode: vi.fn().mockReturnValue("browser"),
    isIphoneFormatFile: vi.fn().mockReturnValue(false),
    printResume,
    selectNewestEligiblePhoto: (photos: ResumePhoto[]) =>
      photos
        .filter(
          (photo) => photo.visibility === "shared" && photo.hidden_at == null,
        )
        .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))[0] ?? null,
  };
});

const file: ResumeFileVersion = {
  path: "1/resumes/1/resume.pdf",
  filename: "resume.pdf",
  uploaded_at: "2026-01-01T00:00:00Z",
  uploaded_by: 1,
  mime_type: "application/pdf",
  size: 1,
};

const resume: Resume = {
  id: 1,
  account_id: 1,
  shidduchim_id: 1,
  files: [file],
  created_at: "2026-01-01T00:00:00Z",
};

const eligiblePhoto: ResumePhoto = {
  id: 2,
  account_id: 1,
  resume_id: 1,
  path: "1/photos/shared/1/photo.jpg",
  uploaded_at: "2026-01-01T00:00:00Z",
  visibility: "shared",
  hidden_at: null,
};

const buildProvider = (
  resumes: Resume[] = [resume],
  photos: ResumePhoto[] = [eligiblePhoto],
): CrmDataProvider => {
  const getList = vi.fn((resource: string, _params: unknown) =>
    Promise.resolve({
      data: resource === "resumes" ? resumes : photos,
      total: resource === "resumes" ? resumes.length : photos.length,
    }),
  );
  return { getList } as unknown as CrmDataProvider;
};

const renderButton = async (dataProvider: CrmDataProvider) =>
  render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResumePrintButton shidduchimId={1} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

describe("ResumePrintButton", () => {
  it("disables Print with a visible reason when no resume exists", async () => {
    const screen = await renderButton(buildProvider([]));

    const button = screen.getByRole("button", { name: "Print" });
    await expect.element(button).toBeDisabled();
    await expect
      .element(screen.getByText("No resume available to print."))
      .toBeVisible();
  });

  it("checks Include picture by default and passes an explicit resume-only choice", async () => {
    printResume.mockClear();
    const screen = await renderButton(buildProvider());

    const checkbox = screen.getByRole("checkbox", { name: "Include picture" });
    await expect.element(checkbox).toBeChecked();
    await expect
      .element(
        screen.getByText("The latest resume and picture will be printed."),
      )
      .toBeVisible();

    await checkbox.click();
    await screen.getByRole("button", { name: "Print" }).click();

    await expect.poll(() => printResume.mock.calls.length).toBe(1);
    expect(printResume.mock.calls[0][0]).toMatchObject({
      resume: file,
      photo: eligiblePhoto,
      includePicture: false,
    });
  });

  it("queries only shared, non-hidden photos for the current resume", async () => {
    const dataProvider = buildProvider();
    await renderButton(dataProvider);

    const calls = vi.mocked(dataProvider.getList).mock.calls;
    await expect
      .poll(() => calls.find(([resource]) => resource === "resume_photos"))
      .not.toBeUndefined();
    const photoCall = calls.find(([resource]) => resource === "resume_photos");
    expect(photoCall?.[1]).toMatchObject({
      filter: {
        resume_id: resume.id,
        visibility: "shared",
        "hidden_at@is": null,
      },
      sort: { field: "uploaded_at", order: "DESC" },
    });
  });

  it("does not offer a private or hidden photo as printable", async () => {
    const screen = await renderButton(
      buildProvider(
        [resume],
        [
          { ...eligiblePhoto, visibility: "private_parent" },
          { ...eligiblePhoto, id: 3, hidden_at: "2026-02-01T00:00:00Z" },
        ],
      ),
    );

    await expect
      .element(screen.getByRole("checkbox", { name: "Include picture" }))
      .toBeDisabled();
    await expect
      .element(screen.getByText("No shared picture is available to print."))
      .toBeVisible();
  });
});
