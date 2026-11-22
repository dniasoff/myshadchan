import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
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
): CrmDataProvider {
  const getList = vi.fn((resource: string) => {
    if (resource === "resumes")
      return Promise.resolve({ data: [resume], total: 1 });
    if (resource === "resume_photos")
      return Promise.resolve({ data: [photo], total: 1 });
    if (resource === "entity_files_summary")
      return Promise.resolve({ data: entityFiles, total: entityFiles.length });
    return Promise.resolve({ data: [], total: 0 });
  });
  return {
    getList,
    getOne: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    uploadEntityFile: vi.fn(),
    signEntityFileUrl: vi.fn(),
  } as unknown as CrmDataProvider;
}

async function renderPanel(entityFiles?: EntityFileSummary[]) {
  const dataProvider = buildDataProvider(entityFiles);
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
  return { dataProvider, screen };
}

describe("ChildDocumentsPanel", () => {
  it("renders the three named slots, same-source files, and the legacy section", async () => {
    const { screen } = await renderPanel();

    await expect.element(screen.getByText("Documents")).toBeInTheDocument();
    await expect
      .element(screen.getByText("Miriam-Cohen-resume.pdf"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("photo.png")).toBeInTheDocument();
    await expect
      .element(screen.getByText("school-paper.pdf"))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("Older files (1)"))
      .toBeInTheDocument();
    await expect.element(screen.getByText("older-file.docx")).not.toBeVisible();

    const controls = screen.container.querySelectorAll("button");
    expect(controls.length).toBeGreaterThan(12);
    for (const control of controls)
      expect(control.className).toContain("min-h-11");
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
});
