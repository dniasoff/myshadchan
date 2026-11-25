import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { canViewChildDocuments } from "../singles/ChildDocuments/childDocumentUtils";
import { DashboardHeader } from "./DashboardHeader";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { ResumeFileVersion } from "../types";
import type { CrmDataProvider } from "../providers/types";
import {
  canDeleteResumeFile,
  clearPendingResumeFileDelete,
  pendingResumeFileDeletes,
  rememberPendingResumeFileDelete,
  resumeFileDeleteMarkerToken,
} from "../resumes/resumeFileDelete";

const viewerRole = vi.hoisted(() => ({
  role: "parent_admin" as const,
  isPending: false,
}));
const useIsMobile = vi.hoisted(() => vi.fn(() => false));

vi.mock("../entity360/useViewerRole", () => ({
  useViewerRole: () => viewerRole,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile }));
vi.mock("./AddSingleLink", () => ({ AddSingleLink: () => null }));
vi.mock("./SendToShadchanDialog", () => ({
  SendToShadchanButton: () => null,
}));
vi.mock("../singles/ChildDocuments/ChildDocumentsPanel", () => ({
  ChildDocumentsPanel: () => null,
}));

const single = {
  id: 11,
  account_id: 1,
  first_name_en: "Miriam",
  last_name_en: "Cohen",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
} as const;
const secondSingle = {
  ...single,
  id: 12,
  first_name_en: "Leah",
} as const;
const file = {
  path: "1/resumes/33/latest.pdf",
  filename: "latest.pdf",
  uploaded_at: "2026-01-03T00:00:00Z",
  uploaded_by: null,
  mime_type: "application/pdf",
  size: 12,
} as const;

const renderScheduler = async (
  removeResumeFile: ReturnType<typeof vi.fn>,
  resumeId = 33,
  resumeFile: ResumeFileVersion = file,
) => {
  const getList = vi.fn().mockResolvedValue({
    data: [{ id: resumeId, files: [resumeFile] }],
    total: 1,
  });
  const dataProvider = {
    getList,
    removeResumeFile,
  } as unknown as CrmDataProvider;
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <DashboardHeader
          singleList={[single]}
          singleId={single.id}
          onSelectSingle={vi.fn()}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, getList };
};

const renderSwitcher = async (isMobile: boolean) => {
  useIsMobile.mockReturnValue(isMobile);
  const onSelectSingle = vi.fn();
  const dataProvider = {
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  } as unknown as CrmDataProvider;
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <DashboardHeader
          singleList={[single, secondSingle]}
          singleId={single.id}
          onSelectSingle={onSelectSingle}
        />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, onSelectSingle };
};

describe("DashboardHeader document visibility", () => {
  beforeEach(() => {
    viewerRole.role = "parent_admin";
    viewerRole.isPending = false;
    useIsMobile.mockReturnValue(false);
    pendingResumeFileDeletes.clear();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    pendingResumeFileDeletes.clear();
    window.localStorage.clear();
  });

  it.each(["parent_admin", "self_manager", "helper", "shadchan"] as const)(
    "allows the %s role to open Documents",
    (role) => {
      expect(canViewChildDocuments(role, false)).toBe(true);
    },
  );

  it("hides Documents from the single role and while the role is pending", () => {
    expect(canViewChildDocuments("single", false)).toBe(false);
    expect(canViewChildDocuments("parent_admin", true)).toBe(false);
    expect(canViewChildDocuments(undefined, false)).toBe(false);
  });

  it("does not render the child switcher on desktop while keeping Documents", async () => {
    const { screen } = await renderSwitcher(false);

    await expect
      .element(screen.getByRole("button", { name: "Documents" }))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Miriam Cohen" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Leah Cohen" }))
      .not.toBeInTheDocument();
  });

  it("keeps the child switcher and selection callback on mobile", async () => {
    const { screen, onSelectSingle } = await renderSwitcher(true);

    await expect
      .element(screen.getByRole("button", { name: "Miriam Cohen" }))
      .toBeInTheDocument();
    await screen.getByRole("button", { name: "Leah Cohen" }).click();
    expect(onSelectSingle).toHaveBeenCalledWith(secondSingle.id);
  });

  it("only hydrates durable resume cleanup for manager roles", () => {
    expect(canDeleteResumeFile("parent_admin", false)).toBe(true);
    expect(canDeleteResumeFile("self_manager", false)).toBe(true);
    expect(canDeleteResumeFile("helper", false)).toBe(false);
    expect(canDeleteResumeFile("shadchan", false)).toBe(false);
  });

  it("cleans up a durable resume marker after DashboardHeader finalization fails", async () => {
    vi.useFakeTimers();
    const failedFile = {
      ...file,
      path: "1/resumes/34/failed.pdf",
      filename: "failed.pdf",
    };
    const token = await resumeFileDeleteMarkerToken(34, failedFile);
    clearPendingResumeFileDelete(token);
    await rememberPendingResumeFileDelete({
      resumeId: 34,
      file: failedFile,
      deadline: Date.now() - 1_000,
    });

    const removeResumeFile = vi
      .fn()
      .mockRejectedValue(new Error("temporary cleanup failure"));
    const rendered = await renderScheduler(removeResumeFile, 34, failedFile);
    await expect.poll(() => rendered.getList.mock.calls.length).toBe(1);
    await vi.runOnlyPendingTimersAsync();
    await expect.poll(() => removeResumeFile.mock.calls.length).toBe(1);
    expect(
      window.localStorage.getItem(
        `myshadchan:pending-resume-file-delete:${token}`,
      ),
    ).toBeNull();
    rendered.screen.unmount();
  });

  it("finalizes a durable resume delete after DashboardHeader remounts", async () => {
    vi.useFakeTimers();
    const removeResumeFile = vi.fn().mockResolvedValue(undefined);
    clearPendingResumeFileDelete(await resumeFileDeleteMarkerToken(33, file));
    await rememberPendingResumeFileDelete({
      resumeId: 33,
      file,
      deadline: Date.now() - 1_000,
    });

    const first = await renderScheduler(removeResumeFile);
    await expect.poll(() => first.getList.mock.calls.length).toBe(1);
    first.screen.unmount();

    const second = await renderScheduler(removeResumeFile);
    await vi.runOnlyPendingTimersAsync();
    await expect.poll(() => removeResumeFile.mock.calls.length).toBe(1);
    expect(removeResumeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeId: 33,
        path: file.path,
        deleteToken: expect.any(String),
      }),
    );
    second.screen.unmount();
  });
});
