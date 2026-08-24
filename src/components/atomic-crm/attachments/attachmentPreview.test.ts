import { describe, expect, it } from "vitest";

import {
  isAttachmentPreviewable,
  resolveAttachmentPreviewMode,
} from "./attachmentPreview";

describe("resolveAttachmentPreviewMode — what may be rendered in the page", () => {
  it("shows a PDF in a frame", () => {
    // Arrange / Act / Assert
    expect(resolveAttachmentPreviewMode("application/pdf", "resume.pdf")).toBe(
      "pdf",
    );
  });

  it("shows the raster image formats a resume photo actually arrives as", () => {
    // Arrange
    const rasterTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/heic",
    ];

    // Act / Assert
    for (const mimeType of rasterTypes) {
      expect(resolveAttachmentPreviewMode(mimeType, "photo")).toBe("image");
    }
  });

  it("ignores case and mime parameters rather than failing the match", () => {
    // Arrange / Act / Assert — a browser may report either shape.
    expect(resolveAttachmentPreviewMode("APPLICATION/PDF", "a.pdf")).toBe(
      "pdf",
    );
    expect(
      resolveAttachmentPreviewMode("image/jpeg; charset=binary", "a.jpg"),
    ).toBe("image");
  });
});

describe("resolveAttachmentPreviewMode — the security boundary", () => {
  /**
   * `mime_type` is whatever the browser reported at upload and is written to
   * the row verbatim, so a member of the account chooses it. These two types
   * are documents that can carry script, and neither may ever be rendered.
   */
  it("refuses to render HTML, however it is labelled", () => {
    // Arrange / Act / Assert
    expect(resolveAttachmentPreviewMode("text/html", "notes.html")).toBe(
      "none",
    );
    expect(
      resolveAttachmentPreviewMode("text/html; charset=utf-8", "notes.html"),
    ).toBe("none");
    expect(
      resolveAttachmentPreviewMode("application/xhtml+xml", "notes.xhtml"),
    ).toBe("none");
  });

  it("refuses SVG even though it is an image type", () => {
    // Arrange / Act / Assert — an <svg> is a document and can carry <script>;
    // putting it behind an <img> tag is not the containment it looks like.
    expect(resolveAttachmentPreviewMode("image/svg+xml", "chart.svg")).toBe(
      "none",
    );
  });

  it("does not let a hopeful extension override a mime type that was stated", () => {
    // Arrange / Act — the escape hatch that would undo the two rules above:
    // an HTML file named `resume.pdf`. The extension map is consulted ONLY
    // when the mime type says nothing at all.
    const mode = resolveAttachmentPreviewMode("text/html", "resume.pdf");

    // Assert
    expect(mode).toBe("none");
  });

  it("does not render an unknown or novel type by default", () => {
    // Arrange / Act / Assert — the list is an allow-list, so anything the
    // product gains later falls through to a download rather than a guess.
    expect(resolveAttachmentPreviewMode("application/zip", "a.zip")).toBe(
      "none",
    );
    expect(resolveAttachmentPreviewMode("video/mp4", "a.mp4")).toBe("none");
    expect(
      resolveAttachmentPreviewMode("application/x-invented", "a.xyz"),
    ).toBe("none");
  });

  it("gives a .docx its own mode, never the frame", () => {
    // Arrange / Act / Assert — `docx` is rendered by converting it to
    // sanitised HTML in this tab (`DocxPreview.tsx`), never by handing a
    // signed URL to a third-party document viewer, and never by putting the
    // file in an iframe. Returning a distinct mode is what keeps those apart.
    expect(
      resolveAttachmentPreviewMode(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "cv.docx",
      ),
    ).toBe("docx");
    expect(
      resolveAttachmentPreviewMode("application/octet-stream", "cv.docx"),
    ).toBe("docx");
  });

  it("still refuses the pre-2007 binary .doc", () => {
    // Arrange / Act / Assert — `mammoth` reads the OOXML package only, so
    // admitting `.doc` would render an empty document instead of an honest
    // download link.
    expect(resolveAttachmentPreviewMode("application/msword", "cv.doc")).toBe(
      "none",
    );
    expect(
      resolveAttachmentPreviewMode("application/octet-stream", "cv.doc"),
    ).toBe("none");
  });
});

describe("resolveAttachmentPreviewMode — uninformative mime types", () => {
  it("falls back to the extension when the type carries no information", () => {
    // Arrange / Act / Assert — `uploadEntityFile` writes
    // `application/octet-stream` whenever the browser could not identify the
    // file, which happens to real PDFs on some platforms.
    expect(
      resolveAttachmentPreviewMode("application/octet-stream", "resume.pdf"),
    ).toBe("pdf");
    expect(resolveAttachmentPreviewMode("", "photo.JPG")).toBe("image");
    expect(resolveAttachmentPreviewMode(null, "photo.png")).toBe("image");
    expect(resolveAttachmentPreviewMode(undefined, "resume.pdf")).toBe("pdf");
  });

  it("still refuses a dangerous extension under an uninformative type", () => {
    // Arrange / Act / Assert — the fallback map is an allow-list too.
    expect(
      resolveAttachmentPreviewMode("application/octet-stream", "x.svg"),
    ).toBe("none");
    expect(
      resolveAttachmentPreviewMode("application/octet-stream", "x.html"),
    ).toBe("none");
  });

  it("returns none when there is neither a type nor an extension", () => {
    // Arrange / Act / Assert
    expect(resolveAttachmentPreviewMode(undefined, undefined)).toBe("none");
    expect(resolveAttachmentPreviewMode("", "noextension")).toBe("none");
  });
});

describe("isAttachmentPreviewable", () => {
  it("agrees with resolveAttachmentPreviewMode", () => {
    // Arrange / Act / Assert
    expect(isAttachmentPreviewable("application/pdf", "a.pdf")).toBe(true);
    expect(isAttachmentPreviewable("image/png", "a.png")).toBe(true);
    expect(isAttachmentPreviewable("image/svg+xml", "a.svg")).toBe(false);
    expect(isAttachmentPreviewable("application/msword", "a.doc")).toBe(false);
  });
});
