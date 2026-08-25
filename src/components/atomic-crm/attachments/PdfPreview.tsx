import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useTranslate } from "ra-core";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type { SignAttachmentUrl } from "./AttachmentPreview";

/**
 * Renders a PDF in the page, by drawing it — not by handing it to the browser.
 *
 * `<iframe src="….pdf">` is the obvious way and it is the reason this file
 * exists. That approach depends on the browser shipping a PDF viewer plugin,
 * and **Chrome for Android does not have one**. Reproduced rather than
 * assumed: a Chromium launched with `plugins.always_open_pdf_externally`
 * (which is precisely "Blink without the PDF viewer", i.e. Android) replaces
 * the frame's content with a placeholder page — a PDF icon, the file name and
 * an "Open" button — so the reader gets a grey box where their resume should
 * be. That is exactly what was reported from a real phone.
 *
 * Worth recording because it cost a false green: **mobile EMULATION does not
 * reproduce it.** Playwright's "Pixel 7" descriptor runs the desktop engine
 * with the plugin present, so the iframe rendered perfectly under emulation.
 * Neither the mobile audit probe nor the "Mobile Chrome" e2e project could
 * ever have caught this, and neither can confirm the fix.
 *
 * `pdf.js` removes the dependency entirely: it parses the file in JavaScript
 * and paints pages onto a `<canvas>`, which every browser can do. One code
 * path for every device — deliberately, rather than keeping the iframe on
 * desktop and branching. There is no reliable signal to branch ON
 * (`navigator.pdfViewerEnabled` reported `true` in configurations measured
 * NOT to render, and iOS Safari reports `true` while showing only page one),
 * and a viewport-width branch would reintroduce a first-paint problem this
 * repo has already been bitten by. Two render paths for one file type is the
 * drift `AttachmentPreview` was extracted to prevent.
 *
 * The known cost, stated rather than hidden: a canvas has no text layer, so
 * the desktop viewer's select/search/print are lost. For a one-to-three page
 * resume with "Download a copy" still beside it, that is the right trade; a
 * pdf.js text layer is a follow-up, not a silent omission.
 */

/**
 * Two device pixels per CSS pixel is the point past which a phone screen
 * cannot show the difference, and every multiple costs memory quadratically —
 * iOS in particular kills a tab whose canvases get too large.
 */
const MAX_PIXEL_RATIO = 2;

/**
 * A hard ceiling on one page's canvas area (~8.3 MP, about a 2560×3250 page).
 * iOS Safari refuses to allocate a canvas beyond roughly 16 MP and returns a
 * BLANK one rather than throwing — a failure that would look exactly like the
 * bug this file fixes, so it is bounded here instead.
 */
const MAX_CANVAS_PIXELS = 8_300_000;

/** Used for the un-painted page placeholders before page 1 has been measured:
 * A4/Letter are both close enough that no visible shift occurs. */
const FALLBACK_PAGE_ASPECT = 1.414;

type PdfState =
  | { status: "pending" }
  | { status: "ready"; doc: PDFDocumentProxy; aspect: number }
  | { status: "error" };

/**
 * Loads the library, its worker, and the document — all dynamically.
 *
 * `pdfjs-dist` is ~1 MB and only a minority of attachments are PDFs, so a
 * top-level import would tax every page load in the app for a file most
 * visitors never open (`docxSanitizer.guard.test.ts` holds this, and covers
 * this package too). The worker is imported `?url` from our own bundle, never
 * a CDN: a signed link to a family's resume must not be handed to a third
 * party, which is the same rule `DocxPreview` follows.
 *
 * The bytes are FETCHED and passed as `data`, rather than giving pdf.js the
 * URL. That is deliberate: handed a URL, pdf.js issues HTTP range requests
 * lazily as the reader scrolls, so a signed URL that expires mid-read starts
 * returning 401 to a document already on screen — and that failure looks like
 * a corrupt PDF, not an expiry. One up-front fetch removes the whole class.
 */
async function loadPdf(url: string): Promise<PDFDocumentLoadingTask> {
  const [pdfjs, workerUrl] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url").then((m) => m.default),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`storage responded ${response.status}`);
  }
  const data = await response.arrayBuffer();
  // The LOADING TASK is returned, not the document: `destroy()` lives on the
  // task (it is what owns the worker), and tearing that down is what stops a
  // worker leaking for every file opened in a session.
  return pdfjs.getDocument({ data });
}

export interface PdfPreviewProps {
  fileName: string;
  signUrl: SignAttachmentUrl;
  active: boolean;
  onDownload: () => void;
}

export function PdfPreview({
  fileName,
  signUrl,
  active,
  onDownload,
}: PdfPreviewProps): ReactElement {
  const translate = useTranslate();
  const [state, setState] = useState<PdfState>({ status: "pending" });

  useEffect(() => {
    if (!active) {
      setState({ status: "pending" });
      return;
    }

    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setState({ status: "pending" });

    (async () => {
      const url = await signUrl({ inline: true });
      const task = await loadPdf(url);
      loadingTask = task;
      const doc = await task.promise;
      // Page 1's shape sizes every placeholder, so pages that have not been
      // painted yet still occupy their real height — no layout shift as the
      // reader scrolls into them.
      const firstPage = await doc.getPage(1);
      const { width, height } = firstPage.getViewport({ scale: 1 });
      if (cancelled) return;
      setState({ status: "ready", doc, aspect: height / width });
    })().catch(() => {
      if (!cancelled) setState({ status: "error" });
    });

    return () => {
      cancelled = true;
      // Frees the worker and the parsed document; without it, opening several
      // files in sequence leaks a worker each time. It rejects if the task
      // was still loading, which is a normal unmount, not a failure.
      void loadingTask?.destroy().catch(() => {});
    };
  }, [active, signUrl]);

  if (state.status === "pending") {
    return (
      <div className="flex h-full w-full flex-col gap-2 p-4" aria-busy="true">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p role="alert" className="text-sm text-destructive">
          {translate("crm.attachments.viewer.error", {
            _: "Could not open this file for reading.",
          })}
        </p>
        <Button type="button" variant="outline" onClick={onDownload}>
          {translate("crm.attachments.viewer.download", {
            _: "Download a copy",
          })}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="h-full w-full overflow-auto bg-muted/40"
      // The document as a whole is the figure; each page carries its own
      // number, so a screen reader hears "Resume, page 1 of 2" rather than an
      // unlabelled canvas.
      role="document"
      aria-label={fileName}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 p-2 sm:p-4">
        {Array.from({ length: state.doc.numPages }, (_, index) => (
          <PdfPage
            key={index + 1}
            doc={state.doc}
            pageNumber={index + 1}
            pageCount={state.doc.numPages}
            aspect={state.aspect}
            fileName={fileName}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One page, painted only once it is near the viewport.
 *
 * A resume is one or two pages, but the Files tab accepts any PDF, and
 * painting fifty pages up front would allocate fifty canvases and freeze a
 * phone. The placeholder holds the page's real height from the start, so
 * lazy painting costs no layout stability.
 */
function PdfPage({
  doc,
  pageNumber,
  pageCount,
  aspect,
  fileName,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  pageCount: number;
  aspect: number;
  fileName: string;
}): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isNearViewport, setIsNearViewport] = useState(pageNumber === 1);

  useEffect(() => {
    if (isNearViewport) return;
    const element = containerRef.current;
    // No IntersectionObserver (a JSDOM-style environment, an old browser):
    // paint rather than leave the page permanently blank.
    if (!element || typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true);
        }
      },
      // A screen ahead, so a page is painted before it is scrolled to.
      { rootMargin: "150% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isNearViewport]);

  useEffect(() => {
    if (!isNearViewport) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;

      const base = page.getViewport({ scale: 1 });
      // Fit the page to however wide the container actually is, then sharpen
      // by the device's pixel ratio — capped twice over, so neither a huge
      // desktop window nor a high-DPI phone can allocate a canvas iOS will
      // refuse (silently, with a blank one).
      const cssWidth = container.clientWidth || 800;
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      let scale = (cssWidth / base.width) * ratio;
      const area = base.width * scale * (base.height * scale);
      if (area > MAX_CANVAS_PIXELS) {
        scale *= Math.sqrt(MAX_CANVAS_PIXELS / area);
      }

      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d");
      if (!context || cancelled) return;

      const task = page.render({ canvas, canvasContext: context, viewport });
      renderTask = task;
      await task.promise;
    })().catch(() => {
      // A cancelled render rejects by design (unmount, or scrolling away
      // mid-paint). There is nothing to report: the page simply stays a
      // placeholder, and the document's own error state covers a real
      // failure to load.
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, isNearViewport]);

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden rounded-sm bg-background shadow-sm"
      style={{ aspectRatio: `1 / ${aspect || FALLBACK_PAGE_ASPECT}` }}
    >
      <canvas
        ref={canvasRef}
        // Intrinsic size is the render resolution; CSS fits it to the column.
        className="block h-full w-full"
        aria-label={`${fileName} — page ${pageNumber} of ${pageCount}`}
        role="img"
      />
    </div>
  );
}
