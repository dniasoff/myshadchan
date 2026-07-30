import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { CrmDataProvider } from "../providers/types";
import type { Resume, ResumeFileVersion } from "../types";
import { ForwardResumeButton } from "./ForwardResumeButton";

/**
 * Story 5.7, AC 4: the forward/share action is disabled (with an explaining
 * tooltip, never a silent no-op) when the shidduch has no resume file yet,
 * and falls back to a plain download when the Web Share API for files is
 * unsupported. The payload-shape guarantee itself (exactly one
 * `resumes.files` entry, never anything from `resume_photos`) is
 * `resumeSharePayload.test.ts`'s own job — `buildResumeSharePayload` is a
 * pure function, tested there without driving `navigator.share`.
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

const buildResumeRow = (overrides: Partial<Resume> = {}): Resume => ({
  id: 1,
  account_id: 1,
  shidduchim_id: 1,
  files: [buildVersion()],
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const buildDataProvider = (
  overrides: Partial<CrmDataProvider> = {},
): CrmDataProvider =>
  ({
    getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    signResumeFileUrl: vi.fn().mockResolvedValue("https://signed.example/x"),
    ...overrides,
  }) as unknown as CrmDataProvider;

const renderButton = async (
  dataProviderOverrides: Partial<CrmDataProvider> = {},
) => {
  const dataProvider = buildDataProvider(dataProviderOverrides);

  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ForwardResumeButton shidduchimId={1} />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );

  return { screen, dataProvider };
};

describe("ForwardResumeButton — disabled state (AC 4)", () => {
  it("is disabled with an explaining title when the shidduch has no resume yet", async () => {
    // Arrange / Act
    const { screen } = await renderButton({
      getList: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    });

    // Assert — the button is disabled from the first (pending) render, but
    // the explaining title only settles once the "no resume" state resolves.
    const button = screen.getByRole("button", { name: "Forward resume" });
    await expect.element(button).toBeDisabled();
    await expect
      .poll(() => button.element().getAttribute("title"))
      .toBe("No resume to forward yet.");
  });

  it("is enabled, with no disabled-reason title, once a resume file exists", async () => {
    // Arrange / Act
    const { screen } = await renderButton({
      getList: vi
        .fn()
        .mockResolvedValue({ data: [buildResumeRow()], total: 1 }),
    });

    // Assert
    const button = screen.getByRole("button", { name: "Forward resume" });
    await expect.element(button).not.toBeDisabled();
    expect(button.element().getAttribute("title")).toBeNull();
  });
});

describe("ForwardResumeButton — falls back to a plain download (AC 4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "canShare");
    Reflect.deleteProperty(navigator, "share");
  });

  it("opens the signed URL when the Web Share API for files is unsupported", async () => {
    // Arrange — deterministic regardless of what the host browser actually
    // supports.
    Object.defineProperty(navigator, "canShare", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const signResumeFileUrl = vi
      .fn()
      .mockResolvedValue("https://signed.example/download");
    const { screen } = await renderButton({
      getList: vi
        .fn()
        .mockResolvedValue({ data: [buildResumeRow()], total: 1 }),
      signResumeFileUrl,
    });

    // Act
    await screen.getByRole("button", { name: "Forward resume" }).click();

    // Assert
    await expect.poll(() => signResumeFileUrl.mock.calls.length).toBe(1);
    expect(signResumeFileUrl).toHaveBeenCalledWith({
      storagePath: buildVersion().path,
      fileName: buildVersion().filename,
    });
    await expect.poll(() => openSpy.mock.calls.length).toBe(1);
    expect(openSpy).toHaveBeenCalledWith(
      "https://signed.example/download",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("shows a translated error and stays usable when signing rejects", async () => {
    // Arrange
    const signResumeFileUrl = vi.fn().mockRejectedValue(new Error("boom"));
    const { screen } = await renderButton({
      getList: vi
        .fn()
        .mockResolvedValue({ data: [buildResumeRow()], total: 1 }),
      signResumeFileUrl,
    });

    // Act
    await screen.getByRole("button", { name: "Forward resume" }).click();

    // Assert
    await expect.element(screen.getByText("boom")).toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Forward resume" }))
      .not.toBeDisabled();
  });
});

describe("ForwardResumeButton — the Web Share primary path (AC 4, review finding F3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "canShare");
    Reflect.deleteProperty(navigator, "share");
  });

  /**
   * The only other test in this file that touches `navigator.canShare`
   * forces it `undefined`, exercising the plain-download fallback exclusively
   * — `navigator.share` is never invoked anywhere in the repo's test suite
   * (review finding F3). A call site written as `navigator.share({ files:
   * [...payload.files, photoFile] })` would pass every existing test. This
   * stubs the Web Share API as supported, drives the primary path, and
   * asserts the object handed to `navigator.share` holds exactly one file
   * named `resume.pdf` — AD-9's "a photo is never included in a share unless
   * chosen" guarantee, on the path that actually calls `navigator.share`,
   * not only on `buildResumeSharePayload` in isolation
   * (`resumeSharePayload.test.ts`).
   */
  it("invokes navigator.share with exactly one file named resume.pdf, and never falls back to a download", async () => {
    // Arrange
    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "canShare", {
      value: canShare,
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: share,
      configurable: true,
    });
    const pdfBytes = new Blob(["pdf-bytes"], { type: "application/pdf" });
    const fetchSpy = vi
      .spyOn(window, "fetch")
      .mockResolvedValue(new Response(pdfBytes));
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const signResumeFileUrl = vi
      .fn()
      .mockResolvedValue("https://signed.example/share");
    const { screen } = await renderButton({
      getList: vi
        .fn()
        .mockResolvedValue({ data: [buildResumeRow()], total: 1 }),
      signResumeFileUrl,
    });

    // Act
    await screen.getByRole("button", { name: "Forward resume" }).click();

    // Assert
    await expect.poll(() => share.mock.calls.length).toBe(1);
    const payload = share.mock.calls[0][0] as { files: File[] };
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe("resume.pdf");
    expect(payload.files[0].type).toBe("application/pdf");
    // The primary path was taken end to end — no fallback download opened.
    expect(openSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
