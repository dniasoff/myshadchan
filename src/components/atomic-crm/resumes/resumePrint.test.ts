import { afterEach, describe, expect, it, vi } from "vitest";

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument,
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "worker.js",
}));

import type { ResumePhoto, ResumeFileVersion } from "../types";
import {
  getResumePrintMode,
  isIphoneFormatFile,
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
    expect(getResumePrintMode(version("image/heic", "resume.heic"))).toBe(
      "download",
    );
    expect(isIphoneFormatFile(version("image/heif", "resume.heif"))).toBe(true);
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
      photo: photo({ visibility: "private_parent" }),
      includePicture: true,
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
    const afterprintListeners = new Set<() => void>();
    const printWindow = {
      addEventListener: vi.fn((event: string, listener: () => void) => {
        if (event === "afterprint") afterprintListeners.add(listener);
      }),
      close: vi.fn(),
      document: printDocument,
      focus: vi.fn(),
      opener: null,
      print: vi.fn(),
      removeEventListener: vi.fn((event: string, listener: () => void) => {
        if (event === "afterprint") afterprintListeners.delete(listener);
      }),
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
    expect(printWindow.close).not.toHaveBeenCalled();
    afterprintListeners.forEach((listener) => listener());
    expect(printWindow.close).toHaveBeenCalledOnce();
  });

  it("closes immediately on a preparation failure and reports a typed error", async () => {
    const printWindow = {
      addEventListener: vi.fn(),
      close: vi.fn(),
      document: {
        body: { appendChild: vi.fn() },
        close: vi.fn(),
        createElement: vi.fn(),
        open: vi.fn(),
        write: vi.fn(),
      },
      focus: vi.fn(),
      opener: null,
      print: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    await expect(
      printResume({
        dataProvider: {
          signResumeFileUrl: vi.fn().mockRejectedValue(new Error("offline")),
          signResumePhotoUrl: vi.fn(),
        },
        resume: version("image/jpeg", "resume.jpg"),
        photo: null,
        includePicture: false,
        openWindow: () => printWindow,
      }),
    ).rejects.toMatchObject({
      code: "file-fetch-failed",
    });
    expect(printWindow.print).not.toHaveBeenCalled();
    expect(printWindow.close).toHaveBeenCalledOnce();
  });

  it("reports a blocked popup without signing or fetching", async () => {
    const signResumeFileUrl = vi.fn();
    await expect(
      printResume({
        dataProvider: {
          signResumeFileUrl,
          signResumePhotoUrl: vi.fn(),
        },
        resume: version("image/jpeg", "resume.jpg"),
        photo: null,
        includePicture: false,
        openWindow: () => null,
      }),
    ).rejects.toMatchObject({
      code: "popup-blocked",
    });
    expect(signResumeFileUrl).not.toHaveBeenCalled();
  });

  it("prints every PDF page and includes the picture after the resume", async () => {
    const pages = [1, 2].map((pageNumber) => ({
      getViewport: vi.fn().mockReturnValue({
        height: 100 * pageNumber,
        width: 80,
      }),
      getPage: undefined,
      render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
    }));
    const pdf = {
      getPage: vi.fn((pageNumber: number) =>
        Promise.resolve(pages[pageNumber - 1]),
      ),
      numPages: pages.length,
    };
    const destroy = vi.fn().mockResolvedValue(undefined);
    getDocument.mockReturnValue({ destroy, promise: Promise.resolve(pdf) });

    const appended: string[] = [];
    const canvas = {
      className: "",
      getContext: vi.fn().mockReturnValue({}),
      height: 0,
      width: 0,
    };
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
      body: {
        appendChild: vi.fn((element: { alt?: string }) => {
          if (element.alt) appended.push(element.alt);
        }),
      },
      close: vi.fn(),
      createElement: vi.fn((tag: string) =>
        tag === "canvas" ? canvas : image,
      ),
      getElementById: vi.fn().mockReturnValue(null),
      open: vi.fn(),
      write: vi.fn(),
    } as unknown as Document;
    const listeners = new Set<() => void>();
    const printWindow = {
      addEventListener: vi.fn((_event: string, listener: () => void) => {
        listeners.add(listener);
      }),
      close: vi.fn(),
      document: printDocument,
      focus: vi.fn(),
      opener: null,
      print: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Blob(["pdf"]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(new Blob(["photo"], { type: "image/jpeg" }), {
          status: 200,
        }),
      );

    const result = await printResume({
      dataProvider: {
        signResumeFileUrl: vi.fn().mockResolvedValue("resume-url"),
        signResumePhotoUrl: vi.fn().mockResolvedValue("photo-url"),
      },
      resume: version("application/pdf", "resume.pdf"),
      photo: photo(),
      includePicture: true,
      openWindow: () => printWindow,
      fetcher,
    });

    expect(result).toBe("printed");
    expect(getDocument).toHaveBeenCalledOnce();
    expect(pdf.getPage).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledOnce();
    expect(appended).toEqual(["photo.jpg"]);
    expect(printWindow.print).toHaveBeenCalledOnce();
    listeners.forEach((listener) => listener());
  });

  it("prints the resume when an iPhone-format picture cannot be decoded", async () => {
    const imageCalls = { count: 0 };
    const image: {
      alt: string;
      className: string;
      onerror: (() => void) | null;
      onload: (() => void) | null;
      remove: ReturnType<typeof vi.fn>;
      src: string;
    } = {
      alt: "",
      className: "",
      onerror: null as (() => void) | null,
      onload: null as (() => void) | null,
      remove: vi.fn(),
      set src(_: string) {
        queueMicrotask(() => {
          imageCalls.count += 1;
          if (imageCalls.count === 1) image.onload?.();
          else image.onerror?.();
        });
      },
    };
    const printDocument = {
      body: { appendChild: vi.fn() },
      close: vi.fn(),
      createElement: vi.fn().mockReturnValue(image),
      getElementById: vi.fn().mockReturnValue(null),
      open: vi.fn(),
      write: vi.fn(),
    } as unknown as Document;
    const printWindow = {
      addEventListener: vi.fn(),
      close: vi.fn(),
      document: printDocument,
      focus: vi.fn(),
      opener: null,
      print: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Blob(["resume"], { type: "image/jpeg" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Blob(["heic"], { type: "image/heic" }), {
          status: 200,
        }),
      );

    const result = await printResume({
      dataProvider: {
        signResumeFileUrl: vi.fn().mockResolvedValue("resume-url"),
        signResumePhotoUrl: vi.fn().mockResolvedValue("photo-url"),
      },
      resume: version("image/jpeg", "resume.jpg"),
      photo: photo({ path: "1/photos/shared/1/photo.heic" }),
      includePicture: true,
      openWindow: () => printWindow,
      fetcher,
    });

    expect(result).toBe("printed-without-picture");
    expect(printWindow.print).toHaveBeenCalledOnce();
  });
});
