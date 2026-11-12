import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResumePhoto, ResumeFileVersion } from "../types";
import {
  getResumePrintMode,
  printResume,
  selectNewestEligiblePhoto,
} from "./resumePrint";

const version = (mime_type: string, filename: string): ResumeFileVersion => ({
  path: `1/resumes/1/${filename}`,
  filename,
  uploaded_at: "2026-01-01T00:00:00Z",
  uploaded_by: 1,
  mime_type,
  size: 1,
});

const photo = (overrides: Partial<ResumePhoto> = {}): ResumePhoto => ({
  id: 1,
  account_id: 1,
  resume_id: 1,
  path: "1/photos/shared/1/photo.jpg",
  uploaded_at: "2026-01-01T00:00:00Z",
  visibility: "shared",
  hidden_at: null,
  ...overrides,
});

describe("resume print policy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the existing preview allow-list for browser-printable files", () => {
    expect(getResumePrintMode(version("application/pdf", "resume.pdf"))).toBe(
      "browser",
    );
    expect(getResumePrintMode(version("image/jpeg", "resume.jpg"))).toBe(
      "browser",
    );
    expect(
      getResumePrintMode(
        version(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "resume.docx",
        ),
      ),
    ).toBe("download");
  });

  it("selects only the newest shared, non-hidden photo", () => {
    const selected = selectNewestEligiblePhoto([
      photo({
        id: 2,
        path: "1/photos/shared/1/older.jpg",
        uploaded_at: "2026-01-01T00:00:00Z",
      }),
      photo({
        id: 3,
        path: "1/photos/shared/1/hidden.jpg",
        uploaded_at: "2026-03-01T00:00:00Z",
        hidden_at: "2026-03-02T00:00:00Z",
      }),
      photo({
        id: 4,
        path: "1/photos/shared/1/private.jpg",
        uploaded_at: "2026-04-01T00:00:00Z",
        visibility: "private_parent",
      }),
      photo({
        id: 5,
        path: "1/photos/shared/1/newest.jpg",
        uploaded_at: "2026-02-01T00:00:00Z",
      }),
    ]);

    expect(selected?.id).toBe(5);
  });

  it("downloads a Word resume without signing an excluded picture", async () => {
    const signResumeFileUrl = vi
      .fn()
      .mockResolvedValue("https://signed.example/resume");
    const signResumePhotoUrl = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(new Blob(["docx-bytes"]), {
        status: 200,
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      }),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:temporary");
    vi.spyOn(URL, "revokeObjectURL");

    const result = await printResume({
      dataProvider: { signResumeFileUrl, signResumePhotoUrl },
      resume: version(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "resume.docx",
      ),
      photo: photo(),
      includePicture: false,
      fetcher,
    });

    expect(result).toBe("downloaded");
    expect(signResumeFileUrl).toHaveBeenCalledOnce();
    expect(signResumePhotoUrl).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("prints an image in a temporary window after the bytes are ready", async () => {
    const signResumeFileUrl = vi
      .fn()
      .mockResolvedValue("https://signed.example/resume");
    const fetcher = vi.fn().mockResolvedValue(
      new Response(new Blob(["image-bytes"], { type: "image/jpeg" }), {
        status: 200,
      }),
    );
    const image = {
      alt: "",
      className: "",
      onerror: null as (() => void) | null,
      onload: null as (() => void) | null,
      set src(_: string) {
        queueMicrotask(() => image.onload?.());
      },
    };
    const printDocument = {
      body: { appendChild: vi.fn() },
      close: vi.fn(),
      createElement: vi.fn().mockReturnValue(image),
      open: vi.fn(),
      write: vi.fn(),
    } as unknown as Document;
    const printWindow = {
      close: vi.fn(),
      document: printDocument,
      focus: vi.fn(),
      opener: null,
      print: vi.fn(),
    } as unknown as Window;
    const openWindow = vi.fn().mockReturnValue(printWindow);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:temporary");
    vi.spyOn(URL, "revokeObjectURL");

    const result = await printResume({
      dataProvider: {
        signResumeFileUrl,
        signResumePhotoUrl: vi.fn(),
      },
      resume: version("image/jpeg", "resume.jpg"),
      photo: null,
      includePicture: false,
      openWindow,
      fetcher,
    });

    expect(result).toBe("printed");
    expect(openWindow).toHaveBeenCalledWith("", "_blank", "popup");
    expect(printWindow.print).toHaveBeenCalledOnce();
    expect(printWindow.close).toHaveBeenCalledOnce();
  });
});
