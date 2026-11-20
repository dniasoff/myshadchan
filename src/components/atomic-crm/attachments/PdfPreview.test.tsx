import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { PdfPreview } from "./PdfPreview";

const pdfMocks = vi.hoisted(() => {
  const getDocument = vi.fn();
  const workerOptions = {};
  return { getDocument, workerOptions };
});

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: pdfMocks.workerOptions,
  getDocument: pdfMocks.getDocument,
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "worker.js",
}));

type RenderTask = {
  promise: Promise<void>;
  cancel: ReturnType<typeof vi.fn>;
};

const makePdf = (baseWidth = 600, baseHeight = 800, pageCount = 1) => {
  const tasks: Array<{
    resolve: () => void;
    reject: (reason?: unknown) => void;
    task: RenderTask;
  }> = [];
  const page = {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: baseWidth * scale,
      height: baseHeight * scale,
    })),
    render: vi.fn(() => {
      let resolve!: () => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      const task: RenderTask = {
        promise,
        cancel: vi.fn(),
      };
      tasks.push({ resolve, reject, task });
      return task;
    }),
  };
  const documentProxy = {
    numPages: pageCount,
    getPage: vi.fn().mockResolvedValue(page),
  };
  const loadingTask = {
    promise: Promise.resolve(documentProxy),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  pdfMocks.getDocument.mockReturnValue(loadingTask);
  return { documentProxy, loadingTask, page, tasks };
};

const renderPdf = async (width = 600, hidden = false) => {
  const signUrl = vi
    .fn()
    .mockResolvedValue("https://storage.example/resume.pdf");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new ArrayBuffer(0), { status: 200 }),
  );
  const screen = await render(
    <CoreAdminContext i18nProvider={testI18nProvider}>
      <div style={{ height: "800px", width: hidden ? "0px" : `${width}px` }}>
        <PdfPreview
          fileName="test.pdf"
          signUrl={signUrl}
          active
          onDownload={() => {}}
        />
      </div>
    </CoreAdminContext>,
  );
  return { screen, signUrl };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PdfPreview rendering lifecycle", () => {
  beforeEach(() => {
    pdfMocks.getDocument.mockReset();
  });

  it("uses the measured CSS width and caps DPR 3 at two device pixels per CSS pixel", async () => {
    const { page, tasks } = makePdf();
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(3);
    const { screen } = await renderPdf(600);

    await expect.poll(() => page.render.mock.calls.length).toBe(1);
    const renderScale = page.getViewport.mock.calls.at(-1)?.[0].scale;
    expect(renderScale).toBe(2);
    tasks[0].resolve();
    await expect
      .poll(() => screen.container.querySelector("canvas")?.width ?? 0)
      .toBeGreaterThan(900);
  });

  it("surfaces a real page-render rejection with the download fallback", async () => {
    const { page, tasks } = makePdf();
    const { screen } = await renderPdf();

    await expect.poll(() => page.render.mock.calls.length).toBe(1);
    tasks[0].reject(new Error("page render failed"));

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Could not open this file for reading.");
    await expect
      .element(screen.getByRole("button", { name: "Download a copy" }))
      .toBeVisible();
  });

  it("waits for a positive width and detects reveal without ResizeObserver", async () => {
    const { page, tasks } = makePdf();
    vi.stubGlobal("ResizeObserver", undefined);
    const { screen } = await renderPdf(600, true);

    await expect.poll(() => pdfMocks.getDocument.mock.calls.length).toBe(1);
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    await expect.poll(() => page.render.mock.calls.length).toBe(0);
    const wrapper = screen.container.querySelector<HTMLElement>(
      '[style*="width: 0px"]',
    );
    expect(wrapper).not.toBeNull();
    if (!wrapper) return;

    wrapper.style.width = "600px";
    await expect.poll(() => page.render.mock.calls.length).toBe(1);
    tasks[0].resolve();
  });

  it("re-renders after a container resize and cancels the stale render", async () => {
    const { page, tasks } = makePdf();
    const { screen } = await renderPdf(600);

    await expect.poll(() => page.render.mock.calls.length).toBe(1);
    const wrapper = screen.container.querySelector<HTMLElement>(
      '[style*="width: 600px"]',
    );
    expect(wrapper).not.toBeNull();
    if (wrapper) wrapper.style.width = "400px";

    await expect.poll(() => page.render.mock.calls.length).toBe(2);
    expect(tasks[0].task.cancel).toHaveBeenCalledTimes(1);
    expect(page.getViewport.mock.calls.at(-1)?.[0].scale).toBeCloseTo(2 / 3);
    tasks[1].resolve();
  });

  it("keeps unusually tall pages under the canvas area cap", async () => {
    const { page, tasks } = makePdf(600, 6000);
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(3);
    await renderPdf(600);

    await expect.poll(() => page.render.mock.calls.length).toBe(1);
    const renderScale = page.getViewport.mock.calls.at(-1)?.[0].scale ?? 0;
    expect(600 * renderScale * (6000 * renderScale)).toBeLessThanOrEqual(
      8_300_000,
    );
    expect(renderScale).toBeLessThan(2);
    tasks[0].resolve();
  });

  it("cancels a pending page render on unmount without creating another document", async () => {
    const { page, tasks, loadingTask } = makePdf();
    const { screen } = await renderPdf();

    await expect.poll(() => page.render.mock.calls.length).toBe(1);
    screen.unmount();

    expect(tasks[0].task.cancel).toHaveBeenCalledTimes(1);
    expect(loadingTask.destroy).toHaveBeenCalledTimes(1);
    expect(pdfMocks.getDocument).toHaveBeenCalledTimes(1);
  });

  it("evicts canvases for far pages and repaints only a bounded live set", async () => {
    const { page, tasks } = makePdf(600, 800, 6);
    const observers: Array<{
      element: Element | null;
      emit: (isIntersecting: boolean) => void;
    }> = [];
    class TestIntersectionObserver {
      private readonly callback: IntersectionObserverCallback;
      private element: Element | null = null;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        observers.push({
          element: null,
          emit: (isIntersecting) => {
            if (this.element) {
              this.callback(
                [
                  {
                    isIntersecting,
                    target: this.element,
                  } as IntersectionObserverEntry,
                ],
                this as unknown as IntersectionObserver,
              );
            }
          },
        });
      }

      observe(element: Element) {
        this.element = element;
        observers.at(-1)!.element = element;
      }

      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

    const { screen } = await renderPdf();
    await expect.poll(() => page.render.mock.calls.length).toBe(1);
    tasks[0].resolve();
    await expect
      .poll(() => screen.container.querySelectorAll("canvas")[0]?.width ?? 0)
      .toBeGreaterThan(0);

    for (let index = 1; index < 6; index += 1) {
      observers[index - 1]?.emit(false);
      observers[index]?.emit(true);
      await expect.poll(() => page.render.mock.calls.length).toBe(index + 1);
      tasks[index].resolve();
      await expect
        .poll(
          () =>
            [...screen.container.querySelectorAll("canvas")].filter(
              (canvas) => canvas.width > 0 && canvas.height > 0,
            ).length,
        )
        .toBeLessThanOrEqual(1);
    }

    expect(
      [...screen.container.querySelectorAll("canvas")].filter(
        (canvas) => canvas.width > 0 && canvas.height > 0,
      ),
    ).toHaveLength(1);
  });
});
