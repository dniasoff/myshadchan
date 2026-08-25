import { afterEach, describe, expect, it, vi } from "vitest";

import { isCanvasPainted, stubFetchWithPdf } from "@/test/pdfFixture";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { AttachmentViewerDialog } from "./AttachmentViewerDialog";

const SIGNED_URL = "https://storage.example/signed/object";

/**
 * Each test renders its own dialog and queries through that render's own
 * container. There is deliberately no `cleanup()` between them: teardown in
 * this suite's neighbours left every subsequent render unqueryable, and the
 * container-scoped locator is what works here (see
 * `shidduchim/PipelineStateOptions.test.tsx` for the same note).
 */
const renderViewer = async (
  overrides: Partial<React.ComponentProps<typeof AttachmentViewerDialog>> = {},
) => {
  const signUrl = vi.fn().mockResolvedValue(SIGNED_URL);
  const screen = await render(
    <CoreAdminContext i18nProvider={testI18nProvider}>
      <AttachmentViewerDialog
        open
        onOpenChange={() => {}}
        fileName="resume.pdf"
        mimeType="application/pdf"
        signUrl={signUrl}
        {...overrides}
      />
    </CoreAdminContext>,
  );
  return { screen, signUrl };
};

/** The dialog portals out of the render container, so nodes are looked up on
 * the document. Scoped by the file name each test uses, which is unique per
 * case, so no two dialogs can be confused for one another. */
const imageFor = (alt: string) =>
  document.querySelector<HTMLImageElement>(`img[alt="${alt}"]`);
/** Any iframe at all. A PDF used to render in one; the assertion now is that
 * none exists for any type, so this is deliberately not scoped by title. */
const anyFrame = () => document.querySelector("iframe");
/** A PDF's first painted page — `PdfPreview` labels each canvas by file and
 * page, which is also what a screen reader announces. */
const pageCanvasFor = (fileName: string) =>
  document.querySelector<HTMLCanvasElement>(
    `canvas[aria-label^="${fileName} — page 1"]`,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AttachmentViewerDialog — reading without downloading", () => {
  it("paints the PDF onto a canvas, and never uses an iframe", async () => {
    // Arrange — pdf.js really parses, so real bytes and a real fetch are
    // needed; `SIGNED_URL` is what `signUrl` hands it and what it fetches.
    const fetchSpy = stubFetchWithPdf();

    // Act
    const { signUrl } = await renderViewer({ fileName: "a-pdf-case.pdf" });

    // Assert — painted, not merely mounted (see `isCanvasPainted`).
    await expect
      .poll(
        () => {
          const canvas = pageCanvasFor("a-pdf-case.pdf");
          return canvas ? isCanvasPainted(canvas) : false;
        },
        { timeout: 15000 },
      )
      .toBe(true);

    // ...via the viewing form of the URL, not the download form...
    expect(signUrl).toHaveBeenCalledWith({ inline: true });
    expect(fetchSpy).toHaveBeenCalledWith(SIGNED_URL);
    // ...and with no iframe anywhere, which is the whole point of the change:
    // an iframe depends on a PDF plugin that Chrome for Android lacks.
    expect(anyFrame()).toBeNull();
  });

  it("fetches the file once rather than range-requesting it as you scroll", async () => {
    // Arrange — pdf.js given a URL issues lazy range requests, so a signed URL
    // can expire under a document already open and fail as if it were corrupt.
    // Passing a buffer removes that class, and this is what holds it.
    const fetchSpy = stubFetchWithPdf();

    // Act
    await renderViewer({ fileName: "a-onefetch-case.pdf" });
    await expect
      .poll(
        () => {
          const canvas = pageCanvasFor("a-onefetch-case.pdf");
          return canvas ? isCanvasPainted(canvas) : false;
        },
        { timeout: 15000 },
      )
      .toBe(true);

    // Assert
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit | undefined)?.headers).toBeUndefined();
  });

  it("renders an image with an <img>, not a canvas or a frame", async () => {
    // Arrange / Act — an image is the one type still shown straight from a
    // signed URL, so this also pins that PDFs did not take images with them.
    await renderViewer({
      fileName: "a-image-case.jpg",
      mimeType: "image/jpeg",
    });

    // Assert
    await expect.poll(() => imageFor("a-image-case.jpg")?.src).toBe(SIGNED_URL);
    expect(anyFrame()).toBeNull();
  });
});

describe("AttachmentViewerDialog — types that cannot be shown", () => {
  it("offers an honest download for a type nothing can render", async () => {
    // Arrange / Act — a zip: not a document, not an image, not convertible.
    const { screen, signUrl } = await renderViewer({
      fileName: "a-zip-case.zip",
      mimeType: "application/zip",
    });

    // Assert — no frame, no image, and no URL minted at all: a file that
    // cannot be shown must not be fetched merely because a dialog opened.
    await expect
      .element(
        screen.getByText(
          "This file type cannot be shown here — PDFs, images and Word documents can.",
        ),
      )
      .toBeVisible();
    expect(anyFrame()).toBeNull();
    expect(imageFor("a-zip-case.zip")).toBeNull();
    expect(signUrl).not.toHaveBeenCalledWith({ inline: true });
  });

  it("never puts a Word document in a frame — it takes the converted path", async () => {
    // Arrange / Act — a `.docx` IS previewable, but only by conversion inside
    // this tab. Reaching an iframe would mean the browser was handed the raw
    // file, which is the thing this must never do.
    await renderViewer({
      fileName: "a-docx-case.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    // Assert
    expect(anyFrame()).toBeNull();
    expect(imageFor("a-docx-case.docx")).toBeNull();
  });

  it("never frames an HTML file that claimed to be one", async () => {
    // Arrange / Act — the case the allow-list exists for.
    await renderViewer({
      fileName: "a-html-case.html",
      mimeType: "text/html",
    });

    // Assert
    expect(anyFrame()).toBeNull();
    expect(imageFor("a-html-case.html")).toBeNull();
  });

  it("never renders an SVG as an image", async () => {
    // Arrange / Act
    await renderViewer({
      fileName: "a-svg-case.svg",
      mimeType: "image/svg+xml",
    });

    // Assert
    expect(imageFor("a-svg-case.svg")).toBeNull();
    expect(anyFrame()).toBeNull();
  });
});

describe("AttachmentViewerDialog — failures and closing", () => {
  it("says so, and still offers the download, when the URL cannot be minted", async () => {
    // Arrange
    const signUrl = vi.fn().mockRejectedValue(new Error("nope"));

    // Act
    const { screen } = await renderViewer({
      fileName: "a-error-case.pdf",
      signUrl,
    });

    // Assert
    await expect
      .element(screen.getByText("Could not open this file for reading."))
      .toBeVisible();
    expect(anyFrame()).toBeNull();
  });

  it("handles a failed download rather than leaving an unhandled rejection", async () => {
    // Arrange — the dialog has three Download buttons (footer, error panel,
    // no-preview panel) behind one handler. Unwrapped, a rejected `signUrl`
    // escapes as an unhandled rejection and the button merely appears inert,
    // which is exactly what the neighbouring download paths guard against
    // (`ResumeVersionRow`, `FileRowView`). Listening for the event is the
    // precise property; the user-visible notice needs a `<Notification>`
    // host this harness deliberately does not mount.
    const rejections: string[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      rejections.push(String(event.reason));
    };
    window.addEventListener("unhandledrejection", onUnhandled);

    try {
      const signUrl = vi
        .fn()
        .mockRejectedValue(new Error("the signing service is unreachable"));

      // Act — a Word document, so the no-preview panel renders; its Download
      // is the second of the two on screen, so scope rather than guess.
      const { screen } = await renderViewer({
        fileName: "a-dl-error-case.zip",
        mimeType: "application/zip",
        signUrl,
      });
      await screen
        .getByRole("button", { name: "Download a copy" })
        .first()
        .click();

      // Assert — the download was genuinely attempted, in its saving form...
      await expect
        .poll(() => signUrl.mock.calls.length)
        .toBeGreaterThanOrEqual(1);
      expect(signUrl).toHaveBeenCalledWith({ inline: false });
      // ...and the rejection was caught rather than escaping.
      await expect.poll(() => rejections).toEqual([]);
    } finally {
      window.removeEventListener("unhandledrejection", onUnhandled);
    }
  });

  it("fetches nothing at all while it is closed", async () => {
    // Arrange / Act — the dialog is mounted per row, so an unopened one must
    // not sign a URL for a file nobody asked to see.
    const { signUrl } = await renderViewer({
      open: false,
      fileName: "a-closed-case.pdf",
    });

    // Assert
    expect(signUrl).not.toHaveBeenCalled();
    expect(pageCanvasFor("a-closed-case.pdf")).toBeNull();
  });
});
