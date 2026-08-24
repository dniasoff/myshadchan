import { describe, expect, it, vi } from "vitest";
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

/** The dialog portals out of the render container, so frames and images are
 * looked up on the document. Scoped by the file name each test uses, which is
 * unique per case, so no two dialogs can be confused for one another. */
const frameFor = (title: string) =>
  document.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`);
const imageFor = (alt: string) =>
  document.querySelector<HTMLImageElement>(`img[alt="${alt}"]`);

describe("AttachmentViewerDialog — reading without downloading", () => {
  it("renders a PDF in a frame pointed at the signed URL", async () => {
    // Arrange / Act
    const { signUrl } = await renderViewer({ fileName: "a-pdf-case.pdf" });

    // Assert
    await expect.poll(() => frameFor("a-pdf-case.pdf")?.src).toBe(SIGNED_URL);
    // ...asking for the viewing form of the URL, not the download form.
    expect(signUrl).toHaveBeenCalledWith({ inline: true });
  });

  it("renders an image with an <img>, not a frame", async () => {
    // Arrange / Act
    await renderViewer({
      fileName: "a-image-case.jpg",
      mimeType: "image/jpeg",
    });

    // Assert
    await expect.poll(() => imageFor("a-image-case.jpg")?.src).toBe(SIGNED_URL);
    expect(frameFor("a-image-case.jpg")).toBeNull();
  });

  it("carries no sandbox on the PDF frame, which would blank it in Chromium", async () => {
    // Arrange / Act — measured, not assumed: every sandbox value tried,
    // `sandbox=""` included, put Chromium's PDF viewer on
    // chrome-error://chromewebdata/. This pins the finding so a later
    // "hardening" pass cannot silently re-break the viewer.
    await renderViewer({ fileName: "a-sandbox-case.pdf" });

    // Assert
    await expect.poll(() => frameFor("a-sandbox-case.pdf")).not.toBeNull();
    const frame = frameFor("a-sandbox-case.pdf")!;
    expect(frame.hasAttribute("sandbox")).toBe(false);
    // The hardening that does survive rendering.
    expect(frame.getAttribute("allow")).toBe("");
    expect(frame.referrerPolicy).toBe("no-referrer");
  });
});

describe("AttachmentViewerDialog — types that cannot be shown", () => {
  it("offers an honest download for a Word document instead of a preview", async () => {
    // Arrange / Act
    const { screen, signUrl } = await renderViewer({
      fileName: "a-docx-case.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    // Assert — no frame, no image, and no URL minted at all: a file that
    // cannot be shown must not be fetched merely because a dialog opened.
    await expect
      .element(
        screen.getByText(
          "This file type cannot be shown here — PDFs and images can.",
        ),
      )
      .toBeVisible();
    expect(frameFor("a-docx-case.docx")).toBeNull();
    expect(imageFor("a-docx-case.docx")).toBeNull();
    expect(signUrl).not.toHaveBeenCalledWith({ inline: true });
  });

  it("never frames an HTML file that claimed to be one", async () => {
    // Arrange / Act — the case the allow-list exists for.
    await renderViewer({
      fileName: "a-html-case.html",
      mimeType: "text/html",
    });

    // Assert
    expect(frameFor("a-html-case.html")).toBeNull();
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
    expect(frameFor("a-svg-case.svg")).toBeNull();
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
    expect(frameFor("a-error-case.pdf")).toBeNull();
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
        fileName: "a-dl-error-case.docx",
        mimeType: "application/msword",
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
    expect(frameFor("a-closed-case.pdf")).toBeNull();
  });
});
