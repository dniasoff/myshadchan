import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";
import { QueryClient } from "@tanstack/react-query";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { Resume } from "../types";
import { ResumeUpload } from "./ResumeUpload";
import { resetResumeReadAttemptsForTests } from "./resumeReadRequest";

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
  autoRead = false,
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides);
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ResumeUpload shidduchimId={shidduchimId} autoRead={autoRead} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider, invalidateQueries };
};

describe("ResumeUpload — upload (AC 1 / AC 2)", () => {
  beforeEach(() => {
    resetResumeReadAttemptsForTests();
  });
  it("exposes the exact attach label and hint without narrowing the picker", async () => {
    // Arrange
    const hint =
      "If the resume is in WhatsApp, Messages or email, save it to your phone first, then choose it here.";

    // Act
    const { screen } = await renderUpload(42);

    // Assert
    const button = screen.getByRole("button", {
      name: "Attach resume",
      exact: true,
    });
    const hintElement = screen.getByText(hint, { exact: true });
    await expect.element(button).toHaveAccessibleDescription(hint);
    await expect.element(hintElement).toBeInTheDocument();
    expect(
      button.element().compareDocumentPosition(hintElement.element()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const input = screen.getByLabelText("Attach resume", { exact: true });
    await expect
      .element(button)
      .toHaveAttribute("aria-describedby", hintElement.element().id);
    await expect.element(input).not.toHaveAttribute("accept");
    await expect.element(input).not.toHaveAttribute("capture");
    await expect.element(input).not.toHaveAttribute("multiple");
  });

  it("uploads the selected file for the given shidduch, never a replace call", async () => {
    // Arrange
    const uploadResumeFile = vi.fn().mockResolvedValue(buildResume());
    const file = new File(["hello"], "resume-v2.pdf", {
      type: "application/pdf",
    });

    // Act
    const { screen } = await renderUpload(42, { uploadResumeFile });
    await screen.getByLabelText("Attach resume", { exact: true }).upload(file);

    // Assert
    await expect.poll(() => uploadResumeFile.mock.calls.length).toBe(1);
    expect(uploadResumeFile).toHaveBeenCalledExactlyOnceWith({
      shidduchimId: 42,
      file,
    });
  });

  it("uses the easy-to-read explanation when auto-read is enabled", async () => {
    const { screen } = await renderUpload(42, {}, true);

    await expect
      .element(
        screen.getByText(
          "Attaching a resume also makes it easy to read and uses 1 of your monthly reads.",
        ),
      )
      .toBeInTheDocument();
  });

  it("shows a translated error and stays usable when the upload rejects", async () => {
    // Arrange
    const uploadResumeFile = vi.fn().mockRejectedValue(new Error("boom"));
    const file = new File(["hello"], "resume.pdf", {
      type: "application/pdf",
    });

    // Act
    const { screen } = await renderUpload(1, { uploadResumeFile });
    await screen.getByLabelText("Attach resume", { exact: true }).upload(file);

    // Assert
    await expect.element(screen.getByText("boom")).toBeInTheDocument();
    await expect
      .element(
        screen.getByRole("button", { name: "Attach resume", exact: true }),
      )
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
    await screen.getByLabelText("Attach resume", { exact: true }).upload(file);

    // Assert
    await expect
      .element(screen.getByText("Failed to upload the resume"))
      .toBeInTheDocument();
  });

  it("auto-reads the newest uploaded file, refreshes on success, and reports the request identity", async () => {
    const fileVersion = {
      path: "1/resumes/42/current.pdf",
      filename: "current.pdf",
      uploaded_at: "2026-11-15T12:00:00.000Z",
      uploaded_by: 7,
      mime_type: "application/pdf",
      size: 10,
    };
    const uploadResumeFile = vi
      .fn()
      .mockResolvedValue(buildResume({ files: [fileVersion] }));
    const readResume = vi.fn().mockResolvedValue("completed");
    const { screen, invalidateQueries } = await renderUpload(
      42,
      { uploadResumeFile, readResume },
      true,
    );
    await screen
      .getByLabelText("Attach resume", { exact: true })
      .upload(new File(["hello"], "current.pdf", { type: "application/pdf" }));

    await expect
      .element(
        screen.getByText("Done. The easy-to-read details are ready below."),
      )
      .toBeInTheDocument();
    expect(readResume).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        resumeId: 1,
        fileIdentity: fileVersion.path,
        mode: "fill_empty",
      }),
    );
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it("keeps the uploaded file when reading fails and uses stable static copy", async () => {
    const fileVersion = {
      path: "1/resumes/42/current.pdf",
      filename: "current.pdf",
      uploaded_at: "2026-11-15T12:00:00.000Z",
      uploaded_by: 7,
      mime_type: "application/pdf",
      size: 10,
    };
    const uploadResumeFile = vi
      .fn()
      .mockResolvedValue(buildResume({ files: [fileVersion] }));
    const readResume = vi.fn().mockRejectedValue(new Error("private detail"));
    const { screen } = await renderUpload(
      42,
      { uploadResumeFile, readResume },
      true,
    );
    await screen
      .getByLabelText("Attach resume", { exact: true })
      .upload(new File(["hello"], "current.pdf", { type: "application/pdf" }));

    await expect
      .element(
        screen.getByText(
          "Could not make this resume easy to read. The file was saved; you can try again.",
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByText("private detail"))
      .not.toBeInTheDocument();
    expect(uploadResumeFile).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "timeout",
      "This is taking too long. Nothing was changed. Please try again later.",
    ],
    ["no_allowance", "No resume reads left this month. The file was saved."],
    [
      "not_entitled",
      "AI reading is not switched on for your account yet. The file was saved.",
    ],
  ] as const)(
    "shows distinct %s copy without a raw server detail",
    async (outcome, copy) => {
      const fileVersion = {
        path: "1/resumes/42/current.pdf",
        filename: "current.pdf",
        uploaded_at: "2026-11-15T12:00:00.000Z",
        uploaded_by: 7,
        mime_type: "application/pdf",
        size: 10,
      };
      const uploadResumeFile = vi
        .fn()
        .mockResolvedValue(buildResume({ files: [fileVersion] }));
      const readResume = vi.fn().mockResolvedValue(outcome);
      const { screen } = await renderUpload(
        42,
        { uploadResumeFile, readResume },
        true,
      );
      await screen
        .getByLabelText("Attach resume", { exact: true })
        .upload(
          new File(["hello"], "current.pdf", { type: "application/pdf" }),
        );

      await expect.element(screen.getByText(copy)).toBeInTheDocument();
    },
  );

  it("keeps an unsupported file attached without starting an AI read", async () => {
    const fileVersion = {
      path: "1/resumes/42/current.doc",
      filename: "current.doc",
      uploaded_at: "2026-11-15T12:00:00.000Z",
      uploaded_by: 7,
      mime_type: "application/msword",
      size: 10,
    };
    const uploadResumeFile = vi
      .fn()
      .mockResolvedValue(buildResume({ files: [fileVersion] }));
    const readResume = vi.fn();
    const { screen } = await renderUpload(
      42,
      { uploadResumeFile, readResume },
      true,
    );
    await screen
      .getByLabelText("Attach resume", { exact: true })
      .upload(
        new File(["hello"], "current.doc", { type: "application/msword" }),
      );

    await expect
      .element(screen.getByText("This file type cannot be read automatically."))
      .toBeInTheDocument();
    expect(readResume).not.toHaveBeenCalled();
    expect(uploadResumeFile).toHaveBeenCalledOnce();
  });

  it("does not start a second upload/read while the first auto-read is busy", async () => {
    let resolve: ((outcome: "completed") => void) | undefined;
    const fileVersion = {
      path: "1/resumes/42/current.pdf",
      filename: "current.pdf",
      uploaded_at: "2026-11-15T12:00:00.000Z",
      uploaded_by: 7,
      mime_type: "application/pdf",
      size: 10,
    };
    const uploadResumeFile = vi
      .fn()
      .mockResolvedValue(buildResume({ files: [fileVersion] }));
    const readResume = vi.fn().mockReturnValue(
      new Promise<"completed">((promiseResolve) => {
        resolve = promiseResolve;
      }),
    );
    const { screen } = await renderUpload(
      42,
      { uploadResumeFile, readResume },
      true,
    );
    const input = screen.getByLabelText("Attach resume", { exact: true });
    const attachButton = screen.getByRole("button", {
      name: "Attach resume",
      exact: true,
    });
    const file = new File(["hello"], "current.pdf", {
      type: "application/pdf",
    });

    await input.upload(file);
    await expect.poll(() => readResume.mock.calls.length).toBe(1);
    await expect.element(attachButton).toBeDisabled();
    await input.upload(file);
    expect(uploadResumeFile).toHaveBeenCalledOnce();
    expect(readResume).toHaveBeenCalledOnce();

    resolve?.("completed");
  });
  it("reuses an auto-read id for a failed retry and allocates a new id after completion", async () => {
    const fileVersion = {
      path: "1/resumes/42/current.pdf",
      filename: "current.pdf",
      uploaded_at: "2026-11-15T12:00:00.000Z",
      uploaded_by: 7,
      mime_type: "application/pdf",
      size: 10,
    };
    const uploadResumeFile = vi
      .fn()
      .mockResolvedValue(buildResume({ files: [fileVersion] }));
    const readResume = vi
      .fn()
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("completed")
      .mockResolvedValueOnce("failed");
    const { screen } = await renderUpload(
      42,
      { uploadResumeFile, readResume },
      true,
    );
    const input = screen.getByLabelText("Attach resume", { exact: true });
    const attachButton = screen.getByRole("button", {
      name: "Attach resume",
      exact: true,
    });
    const file = new File(["hello"], "current.pdf", {
      type: "application/pdf",
    });

    await input.upload(file);
    await expect.poll(() => readResume.mock.calls.length).toBe(1);
    await expect.element(attachButton).not.toBeDisabled();
    await input.upload(file);
    await expect.poll(() => readResume.mock.calls.length).toBe(2);
    await expect.element(attachButton).not.toBeDisabled();
    expect(readResume.mock.calls[1][0].requestId).toBe(
      readResume.mock.calls[0][0].requestId,
    );

    await input.upload(file);
    await expect.poll(() => readResume.mock.calls.length).toBe(3);
    await expect.element(attachButton).not.toBeDisabled();
    await input.upload(file);
    await expect.poll(() => readResume.mock.calls.length).toBe(4);
    expect(readResume.mock.calls[2][0].requestId).toBe(
      readResume.mock.calls[1][0].requestId,
    );
    expect(readResume.mock.calls[3][0].requestId).not.toBe(
      readResume.mock.calls[2][0].requestId,
    );
  });
});
