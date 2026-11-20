import { afterEach, describe, expect, it, vi } from "vitest";

import { isCanvasPainted, stubFetchWithPdf } from "@/test/pdfFixture";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import type { DataProvider } from "ra-core";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import type { Resume, ResumeFileVersion } from "../types";
import { ResumeDocument } from "./ResumeDocument";
import {
  pendingResumeFileDeletes,
  rememberPendingResumeFileDelete,
} from "./resumeFileDelete";

/**
 * The Resume tab's whole subject is one document, and it used to show
 * everything except that document: an upload button, a one-line file row, and
 * the resume itself hidden behind a "View" that opened a dialog over the
 * page. These pin the embed — that the newest version renders in the page
 * without anyone clicking, that an older one can be swapped in, and that the
 * swap affordance does not appear when there is nothing to swap to.
 *
 * Each test renders its own tree and queries the document for the frame,
 * which the file name (unique per test) scopes. There is deliberately no
 * `cleanup()` — teardown between renders leaves later ones unqueryable in
 * this harness (see `shidduchim/PipelineStateOptions.test.tsx`).
 */
const SIGNED = "https://storage.example/signed";

const version = (
  overrides: Partial<ResumeFileVersion> = {},
): ResumeFileVersion => ({
  path: "acct/resumes/1/old.pdf",
  filename: "old.pdf",
  uploaded_at: "2026-01-01T00:00:00Z",
  uploaded_by: null,
  mime_type: "application/pdf",
  size: 1000,
  ...overrides,
});

function providerFor(files: ResumeFileVersion[], resumeId = 1) {
  const signResumeFileUrl = vi.fn(
    (params: { storagePath: string; inline?: boolean }) =>
      Promise.resolve(`${SIGNED}/${params.storagePath}`),
  );
  const dataProvider = {
    getList: (resource: string) =>
      resource === "resumes"
        ? Promise.resolve({
            data: [
              { id: resumeId, files, created_at: "" } as unknown as Resume,
            ],
            total: 1,
          })
        : Promise.resolve({ data: [], total: 0 }),
    signResumeFileUrl,
  } as unknown as DataProvider;
  return { dataProvider, signResumeFileUrl };
}

const renderDocument = async (files: ResumeFileVersion[], resumeId = 1) => {
  const { dataProvider, signResumeFileUrl } = providerFor(files, resumeId);
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        i18nProvider={testI18nProvider}
      >
        <ResumeDocument shidduchimId={resumeId} />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { screen, dataProvider, signResumeFileUrl };
};

/**
 * The embedded resume's first page, painted.
 *
 * These used to look for an `<iframe>`. A PDF is now parsed by pdf.js and
 * drawn onto a canvas — because an iframe needs a PDF plugin that Chrome for
 * Android does not have, and rendered a placeholder there instead of the
 * document. `isCanvasPainted` is what makes this an assertion about the
 * resume being VISIBLE rather than about an element existing.
 */
const paintedPageFor = (fileName: string) => {
  const canvas = document.querySelector<HTMLCanvasElement>(
    `canvas[aria-label^="${fileName} — page 1"]`,
  );
  return canvas !== null && isCanvasPainted(canvas);
};
const anyPageCanvas = () => document.querySelector("canvas");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ResumeDocument — the resume is on the page, not behind a click", () => {
  it("paints the newest version into the page without anyone opening anything", async () => {
    // Arrange — pdf.js really parses now, so the embed needs real bytes.
    stubFetchWithPdf();

    // Act — an older version listed first, to prove the embed picks by
    // `uploaded_at` rather than by array order.
    await renderDocument([
      version({ path: "p/older-a.pdf", filename: "older-a.pdf" }),
      version({
        path: "p/newest-a.pdf",
        filename: "newest-a.pdf",
        uploaded_at: "2026-06-01T00:00:00Z",
      }),
    ]);

    // Assert — the resume is on screen, not merely mounted.
    await expect
      .poll(() => paintedPageFor("newest-a.pdf"), { timeout: 15000 })
      .toBe(true);
    expect(paintedPageFor("older-a.pdf")).toBe(false);
  });

  it("asks for the viewing form of the URL, so it renders instead of downloading", async () => {
    // Arrange / Act
    stubFetchWithPdf();
    const { signResumeFileUrl } = await renderDocument([
      version({ path: "p/inline-b.pdf", filename: "inline-b.pdf" }),
    ]);

    // Assert — `inline: false` is what puts `Content-Disposition: attachment`
    // on the URL; the embed must never ask for that.
    await expect
      .poll(() => signResumeFileUrl.mock.calls.length)
      .toBeGreaterThanOrEqual(1);
    expect(signResumeFileUrl).toHaveBeenCalledWith(
      expect.objectContaining({ inline: true }),
    );
  });

  it("swaps the embed to an older version on Show", async () => {
    // Arrange
    stubFetchWithPdf();
    const { screen } = await renderDocument([
      version({
        path: "p/newest-c.pdf",
        filename: "newest-c.pdf",
        uploaded_at: "2026-06-01T00:00:00Z",
      }),
      version({ path: "p/older-c.pdf", filename: "older-c.pdf" }),
    ]);
    await expect
      .poll(() => paintedPageFor("newest-c.pdf"), { timeout: 15000 })
      .toBe(true);

    // Act — the newest row is already shown, so the only Show belongs to the
    // older version.
    await screen.getByRole("button", { name: "Show" }).click();

    // Assert
    await expect
      .poll(() => paintedPageFor("older-c.pdf"), { timeout: 15000 })
      .toBe(true);
    expect(
      document.querySelector('canvas[aria-label^="newest-c.pdf"]'),
    ).toBeNull();
  });

  it("offers no Show button when there is only one version to show", async () => {
    // Arrange / Act — a control that cannot change anything is the same
    // defect as pagination on a single-page list.
    stubFetchWithPdf();
    const { screen } = await renderDocument([
      version({ path: "p/only-d.pdf", filename: "only-d.pdf" }),
    ]);
    await expect
      .poll(() => paintedPageFor("only-d.pdf"), { timeout: 15000 })
      .toBe(true);

    // Assert — but Download stays, because keeping a copy is still meaningful.
    expect(screen.getByRole("button", { name: "Show" }).query()).toBeNull();
    await expect
      .element(screen.getByRole("button", { name: "Download only-d.pdf" }))
      .toBeVisible();
  });

  it("renders no embed at all when no resume has been uploaded", async () => {
    // Arrange / Act
    const { screen } = await renderDocument([]);

    // Assert — an empty bordered box would read as a broken document. Both
    // element kinds are checked: asserting only "no iframe" would now pass
    // even if a blank canvas were rendered, which is the exact vacuity this
    // change could otherwise have introduced here.
    await expect.element(screen.getByText("No resume attached")).toBeVisible();
    expect(anyPageCanvas()).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("opens fit to width with no zoom controls and an accessible viewer control", async () => {
    const { screen } = await renderDocument([
      version({
        path: "p/reader.jpg",
        filename: "reader.jpg",
        mime_type: "image/jpeg",
      }),
    ]);

    expect(screen.getByText("Zoom").query()).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom out" }).query()).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom in" }).query()).toBeNull();
    expect(
      screen.getByRole("button", { name: "Fit to width" }).query(),
    ).toBeNull();
    await expect
      .element(screen.getByRole("button", { name: "Full screen" }))
      .toBeVisible();
    await expect
      .element(screen.getByTestId("resume-document-stage"))
      .toHaveClass("min-h-[410px]");
    await expect
      .element(screen.getByTestId("resume-document-stage"))
      .toHaveClass("md:min-h-[520px]");
  });

  it("renders a PDF at the container width and caps DPR 3 at two pixels per CSS pixel", async () => {
    stubFetchWithPdf();
    const devicePixelRatio = vi
      .spyOn(window, "devicePixelRatio", "get")
      .mockReturnValue(1);
    await renderDocument([
      version({ path: "p/sharp-dpr1.pdf", filename: "sharp-dpr1.pdf" }),
    ]);
    await expect
      .poll(() => paintedPageFor("sharp-dpr1.pdf"), { timeout: 15000 })
      .toBe(true);
    const dpr1Canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label^="sharp-dpr1.pdf — page 1"]',
    );

    devicePixelRatio.mockReturnValue(3);
    await renderDocument([
      version({ path: "p/sharp-dpr3.pdf", filename: "sharp-dpr3.pdf" }),
    ]);
    await expect
      .poll(() => paintedPageFor("sharp-dpr3.pdf"), { timeout: 15000 })
      .toBe(true);
    const dpr3Canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label^="sharp-dpr3.pdf — page 1"]',
    );

    expect(dpr1Canvas).not.toBeNull();
    expect(dpr3Canvas).not.toBeNull();
    expect(dpr1Canvas?.width).toBeGreaterThan(300);
    expect(dpr3Canvas?.width).toBeGreaterThan((dpr1Canvas?.width ?? 0) * 1.8);
    expect(dpr3Canvas?.width).toBeLessThan((dpr1Canvas?.width ?? 0) * 2.2);
  });

  it("repaints at the new stage width when the viewer is resized", async () => {
    stubFetchWithPdf();
    await renderDocument([
      version({ path: "p/sharp-resize.pdf", filename: "sharp-resize.pdf" }),
    ]);
    await expect
      .poll(() => paintedPageFor("sharp-resize.pdf"), { timeout: 15000 })
      .toBe(true);

    const stage = document.querySelector<HTMLElement>(
      '[data-testid="resume-document-stage"]',
    );
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label^="sharp-resize.pdf — page 1"]',
    );
    expect(stage).not.toBeNull();
    expect(canvas).not.toBeNull();
    const before = canvas?.width ?? 0;
    if (stage) stage.style.width = "400px";
    await expect
      .poll(() => canvas?.width ?? 0, { timeout: 15000 })
      .toBeLessThan(before);
    expect(canvas?.width).toBeGreaterThan(300);
  });

  it("moves the shared preview into full screen without re-fetching", async () => {
    stubFetchWithPdf();
    const { screen, signResumeFileUrl } = await renderDocument([
      version({
        path: "p/sharp-full-screen.pdf",
        filename: "sharp-full-screen.pdf",
      }),
    ]);
    await expect
      .poll(() => paintedPageFor("sharp-full-screen.pdf"), { timeout: 15000 })
      .toBe(true);
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label^="sharp-full-screen.pdf — page 1"]',
    );
    const inlineStage = screen.getByTestId("resume-document-stage").element();
    const initialWidth = canvas?.width ?? 0;
    inlineStage.style.width = "120px";
    await expect
      .poll(() => canvas?.width ?? 0, { timeout: 15000 })
      .toBeLessThan(initialWidth);
    const compactWidth = canvas?.width ?? 0;

    await screen.getByRole("button", { name: "Full screen" }).click();
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    const dialog = screen.getByRole("dialog");
    const dialogCanvas = dialog.getByRole("img", {
      name: "sharp-full-screen.pdf — page 1 of 1",
    });
    await expect.element(dialogCanvas).toBeVisible();
    expect(dialog.element().contains(canvas)).toBe(true);
    await expect
      .poll(() => canvas?.width ?? 0, { timeout: 15000 })
      .toBeGreaterThan(compactWidth + 100);
    expect(canvas?.width).not.toBe(compactWidth);
    expect(signResumeFileUrl).toHaveBeenCalledTimes(1);
  });

  it("does not expose removed zoom controls after the viewer is remounted", async () => {
    const { screen } = await renderDocument([
      version({
        path: "p/no-zoom.jpg",
        filename: "no-zoom.jpg",
        mime_type: "image/jpeg",
      }),
    ]);
    expect(screen.getByText("100%").query()).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom out" }).query()).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom in" }).query()).toBeNull();
    expect(
      screen.getByRole("button", { name: "Fit to width" }).query(),
    ).toBeNull();
  });

  it("opens the full-screen viewer and returns focus after Escape", async () => {
    const { screen } = await renderDocument([
      version({
        path: "p/full-screen.jpg",
        filename: "full-screen.jpg",
        mime_type: "image/jpeg",
      }),
    ]);
    const fullScreenButton = screen.getByRole("button", {
      name: "Full screen",
      exact: true,
    });

    await fullScreenButton.click();
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    await expect
      .element(
        screen.getByRole("dialog").getByRole("button", { name: "Close" }),
      )
      .toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(fullScreenButton).toHaveFocus();
  });

  it("traps focus and hides the resume page behind full screen", async () => {
    const { screen } = await renderDocument([
      version({
        path: "p/focus-trap.jpg",
        filename: "focus-trap.jpg",
        mime_type: "image/jpeg",
      }),
    ]);
    await screen.getByRole("button", { name: "Full screen" }).click();

    const dialog = screen.getByRole("dialog");
    const close = dialog.getByRole("button", { name: "Close" });
    await expect.element(close).toHaveFocus();

    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expect.element(close).toHaveFocus();
    expect(dialog.element().contains(document.activeElement)).toBe(true);

    await userEvent.keyboard("{Tab}");
    await expect.element(close).toHaveFocus();
    expect(dialog.element().contains(document.activeElement)).toBe(true);

    const dialogPreview = dialog.getByRole("img", { name: "focus-trap.jpg" });
    await expect.element(dialogPreview).toBeVisible();
    expect(dialog.element().contains(dialogPreview.element())).toBe(true);
    expect(dialogPreview.element().closest('[aria-hidden="true"]')).toBeNull();

    const background = screen.getByTestId("resume-viewer-background").element();
    expect(background.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("keeps one preview instance and fetch while opening and closing full screen", async () => {
    const { screen, signResumeFileUrl } = await renderDocument([
      version({
        path: "p/shared-preview.jpg",
        filename: "shared-preview.jpg",
        mime_type: "image/jpeg",
      }),
    ]);
    await expect.poll(() => signResumeFileUrl.mock.calls.length).toBe(1);
    expect(
      document.querySelectorAll('img[alt="shared-preview.jpg"]'),
    ).toHaveLength(1);

    await screen.getByRole("button", { name: "Full screen" }).click();
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    expect(signResumeFileUrl).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole("dialog");
    const dialogPreview = dialog.getByRole("img", {
      name: "shared-preview.jpg",
    });
    await expect.element(dialogPreview).toBeVisible();
    const dialogPreviewElement = dialogPreview.element();
    expect(dialog.element().contains(dialogPreviewElement)).toBe(true);
    expect(dialogPreviewElement.closest('[aria-hidden="true"]')).toBeNull();
    expect(
      document.querySelectorAll('img[alt="shared-preview.jpg"]'),
    ).toHaveLength(1);

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(signResumeFileUrl).toHaveBeenCalledTimes(1);
    const inlinePreview = screen.getByRole("img", {
      name: "shared-preview.jpg",
    });
    const inlineStage = screen.getByTestId("resume-document-stage").element();
    expect(inlineStage.contains(inlinePreview.element())).toBe(true);
    expect(
      document.querySelectorAll('img[alt="shared-preview.jpg"]'),
    ).toHaveLength(1);
  });

  it("switches the shared viewer when the resume identity changes", async () => {
    const first = await renderDocument(
      [
        version({
          path: "p/resume-one.jpg",
          filename: "resume-one.jpg",
          mime_type: "image/jpeg",
        }),
      ],
      1,
    );
    const { dataProvider: secondDataProvider } = providerFor(
      [
        version({
          path: "p/resume-two.jpg",
          filename: "resume-two.jpg",
          mime_type: "image/jpeg",
        }),
      ],
      2,
    );
    await first.screen.rerender(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={secondDataProvider}
          i18nProvider={testI18nProvider}
        >
          <ResumeDocument shidduchimId={2} />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );

    await expect
      .element(first.screen.getByText("resume-two.jpg"))
      .toBeVisible();
  });

  it("moves the embedded preview to the next visible file during Undo", async () => {
    const older = version({
      path: "p/pending-older.pdf",
      filename: "pending-older.pdf",
      uploaded_at: "2026-01-01T00:00:00Z",
    });
    const newest = version({
      path: "p/pending-newest.pdf",
      filename: "pending-newest.pdf",
      uploaded_at: "2026-06-01T00:00:00Z",
    });
    pendingResumeFileDeletes.clear();
    window.localStorage.clear();
    stubFetchWithPdf();
    await rememberPendingResumeFileDelete({
      resumeId: 1,
      file: newest,
      deadline: Date.now() + 10_000,
    });

    await renderDocument([older, newest]);
    await expect
      .poll(() => paintedPageFor("pending-older.pdf"), { timeout: 15000 })
      .toBe(true);
    expect(paintedPageFor("pending-newest.pdf")).toBe(false);

    pendingResumeFileDeletes.clear();
    window.localStorage.clear();
  });

  it("keeps a same-path file with different identity visible", async () => {
    const first = version({
      path: "p/same-path.pdf",
      filename: "first.pdf",
      size: 100,
      uploaded_at: "2026-01-01T00:00:00Z",
    });
    const second = version({
      path: "p/same-path.pdf",
      filename: "second.pdf",
      size: 200,
      uploaded_at: "2026-01-02T00:00:00Z",
    });
    pendingResumeFileDeletes.clear();
    window.localStorage.clear();
    stubFetchWithPdf();
    await rememberPendingResumeFileDelete({
      resumeId: 1,
      file: first,
      deadline: Date.now() + 10_000,
    });

    await renderDocument([first, second]);
    await expect
      .poll(() => paintedPageFor("second.pdf"), { timeout: 15000 })
      .toBe(true);
    expect(paintedPageFor("first.pdf")).toBe(false);

    pendingResumeFileDeletes.clear();
    window.localStorage.clear();
  });
});
