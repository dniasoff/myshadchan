import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { canViewChildDocuments } from "../singles/ChildDocuments/childDocumentUtils";
import { DashboardHeader } from "./DashboardHeader";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import {
  canDeleteResumeFile,
  clearPendingResumeFileDelete,
  pendingResumeFileDeletes,
  rememberPendingResumeFileDelete,
  resumeFileDeleteMarkerToken,
  schedulePendingResumeFileDelete,
} from "../resumes/resumeFileDelete";

const viewerRole = vi.hoisted(() => ({
  role: "parent_admin" as const,
  isPending: false,
}));

vi.mock("../entity360/useViewerRole", () => ({
  useViewerRole: () => viewerRole,
}));
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
const file = {
  path: "1/resumes/33/latest.pdf",
  filename: "latest.pdf",
  uploaded_at: "2026-01-03T00:00:00Z",
  uploaded_by: null,
  mime_type: "application/pdf",
  size: 12,
} as const;

const renderScheduler = async (removeResumeFile: ReturnType<typeof vi.fn>) => {
  const getList = vi.fn().mockResolvedValue({
    data: [{ id: 33, files: [file] }],
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

describe("DashboardHeader document visibility", () => {
  beforeEach(() => {
    viewerRole.role = "parent_admin";
    viewerRole.isPending = false;
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

  it("only hydrates durable resume cleanup for manager roles", () => {
    expect(canDeleteResumeFile("parent_admin", false)).toBe(true);
    expect(canDeleteResumeFile("self_manager", false)).toBe(true);
    expect(canDeleteResumeFile("helper", false)).toBe(false);
    expect(canDeleteResumeFile("shadchan", false)).toBe(false);
  });

  it("finalizes a durable resume delete after DashboardHeader remounts", async () => {
    vi.useFakeTimers();
    const removeResumeFile = vi.fn().mockResolvedValue(undefined);
    clearPendingResumeFileDelete(await resumeFileDeleteMarkerToken(33, file));
    await rememberPendingResumeFileDelete({
      resumeId: 33,
      file,
      deadline: Date.now() - 1,
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

  it("cleans up a durable resume marker after finalization fails", async () => {
    vi.useFakeTimers();
    const token = await resumeFileDeleteMarkerToken(33, file);
    clearPendingResumeFileDelete(token);
    const marker = {
      resumeId: 33,
      file,
      deadline: Date.now() - 1,
      token,
    };
    await rememberPendingResumeFileDelete({
      resumeId: 33,
      file,
      deadline: marker.deadline,
    });
    schedulePendingResumeFileDelete(marker, async () => {
      clearPendingResumeFileDelete(token);
      throw new Error("temporary cleanup failure");
    });
    await vi.runOnlyPendingTimersAsync();
    expect(window.localStorage.length).toBe(0);
  });
});
