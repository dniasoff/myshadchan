import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { Resume } from "../types";
import { ResumeUpload } from "./ResumeUpload";

/**
 * Story 5.3's falsifiable claims for `ResumeUpload`: the upload happy path
 * (AC 1 / AC 2 — a new version, never a replace) and its failure
 * notification, with the button staying usable either way.
 */

const buildResume = (overrides: Partial<Resume> = {}): Resume => ({
  id: 1,
  account_id: 1,
  shidduchim_id: 1,
  files: [],
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    uploadResumeFile: vi.fn().mockResolvedValue(buildResume()),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderUpload = async (
  shidduchimId: number,
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides);

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResumeUpload shidduchimId={shidduchimId} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("ResumeUpload — upload (AC 1 / AC 2)", () => {
  it("uploads the selected file for the given shidduch, never a replace call", async () => {
    // Arrange
    const uploadResumeFile = vi.fn().mockResolvedValue(buildResume());
    const file = new File(["hello"], "resume-v2.pdf", {
      type: "application/pdf",
    });

    // Act
    const { screen } = await renderUpload(42, { uploadResumeFile });
    await screen.getByLabelText("Upload a new version").upload(file);

    // Assert
    await expect.poll(() => uploadResumeFile.mock.calls.length).toBe(1);
    expect(uploadResumeFile).toHaveBeenCalledExactlyOnceWith({
      shidduchimId: 42,
      file,
    });
  });

  it("shows a translated error and stays usable when the upload rejects", async () => {
    // Arrange
    const uploadResumeFile = vi.fn().mockRejectedValue(new Error("boom"));
    const file = new File(["hello"], "resume.pdf", {
      type: "application/pdf",
    });

    // Act
    const { screen } = await renderUpload(1, { uploadResumeFile });
    await screen.getByLabelText("Upload a new version").upload(file);

    // Assert
    await expect.element(screen.getByText("boom")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Upload a new version" }))
      .toBeInTheDocument();
  });

  it("shows the translated fallback error when the rejection carries no message", async () => {
    // Arrange
    const uploadResumeFile = vi.fn().mockRejectedValue("not an Error");
    const file = new File(["hello"], "resume.pdf", {
      type: "application/pdf",
    });

    // Act
    const { screen } = await renderUpload(1, { uploadResumeFile });
    await screen.getByLabelText("Upload a new version").upload(file);

    // Assert
    await expect
      .element(screen.getByText("Failed to upload the resume"))
      .toBeInTheDocument();
  });
});
